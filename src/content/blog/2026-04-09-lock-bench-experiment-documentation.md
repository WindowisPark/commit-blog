---
title: "LockBench v3: 동시성 벤치마크에서 발견한 6가지 예상 밖의 진실"
description: "재시도 늘리기, 커넥션 풀 분리, Virtual Thread 등 일반적인 성능 개선 방법들이 실제로는 어떤 결과를 가져오는지 실험으로 확인해보았습니다."
pubDate: 2026-04-09
repo: lock-bench
repoDisplayName: LockBench
tags: ["lock-bench", "docs"]
commits: ["a960d312fb69f4553df05698ad7dd85b169881a9", "615073ad03731b170940aeae8873046e590397e6"]
---
## 동시성 최적화, 우리가 잘못 알고 있던 것들

**LockBench** 프로젝트의 v3 실험 결과를 정리하면서 흥미로운 패턴을 발견했다. 개발자들이 "상식"으로 여기는 성능 개선 방법들이 실제로는 예상과 다른 결과를 보이는 경우가 많았다는 점이다.

이번 업데이트에서는 MySQL 단독 환경과 **Redisson** 분산락을 포함한 전면적인 벤치마크를 진행했다. 200개 동시 요청으로 같은 재고를 수정하는 극한 상황에서, 각 락 전략이 어떻게 동작하는지 측정해보았다.

## "재시도 늘리면 성공한다"는 위험한 착각

**OPTIMISTIC_LOCK**의 재시도 횟수를 5에서 50으로 10배 늘렸더니 성공률은 45%에서 99.9%로 극적으로 올라갔다. 하지만 이 "성공"의 대가는 컸다.

```java
// 재시도 로직의 함정
@Transactional
public OrderResult processWithRetry(long productId, int quantity, int maxRetries) {
    for (int attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return processOrder(productId, quantity);
        } catch (OptimisticLockingFailureException e) {
            if (attempt == maxRetries) throw e;
            // 재시도... 하지만 사용자는 얼마나 기다리고 있을까?
        }
    }
}
```

p95 응답시간이 3초에서 12초로 4배나 늘어났다. 기술적으로는 "성공"이지만, 사용자 입장에서는 "12초 기다리다가 떠나는 성공"이었다. 재시도는 실패를 감추는 도구이지 성능을 높이는 도구가 아니라는 교훈을 얻었다.

## 커넥션 풀 분리의 미미한 효과

**Lock Bleed** 현상을 해결하려고 읽기 전용과 쓰기 전용 HikariCP 풀을 완전히 분리했다. 이론적으로는 읽기 API가 쓰기 트랜잭션에 묶이지 않을 것으로 기대했지만, 결과는 실망스러웠다.

```yaml
# 분리된 데이터소스 설정
read-datasource:
  hikari:
    maximum-pool-size: 20
    minimum-idle: 10
    
write-datasource:
  hikari:
    maximum-pool-size: 10
    minimum-idle: 5
```

p95가 11.74초에서 11.40초로 고작 3% 개선에 그쳤다. 문제는 커넥션 풀이 아니었다. 200개 트랜잭션이 같은 row에 `SELECT FOR UPDATE`를 걸면서 InnoDB의 lock manager 자체가 병목이 되고 있었다. 병목의 위치를 정확히 파악하지 않고 엉뚱한 곳을 최적화한 전형적인 사례였다.

## 공정한 락이 더 빠른 역설

직관적으로 생각하면 "새치기하는 락이 더 빠르지 않을까?" 싶지만, 실제로는 정반대였다. **Redisson Fair Lock**이 Unfair보다 p95 응답시간을 52~71% 줄였다.

이유는 의외로 단순했다. 비공정 락에서는 운이 나쁜 스레드가 계속 밀려나면서 tail latency가 폭발한다. 반면 공정 대기열은 "최악의 경우"를 억제해서 평균과 최악 모두를 개선시킨다. concurrency ceiling도 c≤20에서 c≤50으로 2.5배 확장되었다.

## Virtual Thread의 예상 밖 역효과

**Virtual Thread**와 **PESSIMISTIC_LOCK** 조합에서 throughput이 Platform Thread의 1/3 수준(75 vs 221 rps)으로 떨어졌다. 이는 Virtual Thread 자체의 문제가 아니라 구조적 불일치 때문이었다.

200개 Virtual Thread가 10개 DB 커넥션을 놓고 경쟁하는 상황에서, 빠른 컨텍스트 스위칭이 오히려 lock contention을 증폭시켰다. Virtual Thread의 장점은 I/O 대기를 잘 양보하는 것인데, DB 커넥션 풀이 좁으면 "양보할 곳"이 없어진다.

## 락 전략 선택의 새로운 관점

결국 가장 큰 차이를 만든 것은 락의 종류가 아니라 **락을 잡는 위치**였다. DB에서 잡으면 커넥션이 묶이고 같은 DB를 쓰는 모든 서비스가 영향받는다. Redis에서 잡으면 DB 커넥션은 락 획득 후 순간만 쓰고 즉시 반환한다.

```java
// 락 위치에 따른 커넥션 사용 패턴

// PESSIMISTIC: 커넥션이 락 기간 내내 점유
@Lock(LockModeType.PESSIMISTIC_WRITE)
Stock findByIdForUpdate(Long id);

// REDISSON: 커넥션은 락 획득 후 즉시 해제
RLock lock = redisson.getFairLock("stock:" + productId);
lock.lock();
try {
    // 이 시점에서만 DB 커넥션 사용
    return stockRepository.findById(productId);
} finally {
    lock.unlock();
}
```

현재 시점에서 **Redisson Fair Lock + Platform Thread + c≤50**이 최적 조합인 이유가 여기에 있다.

## 다음 단계로의 교훈

이번 v3 실험을 통해 얻은 가장 큰 교훈은 "당연해 보이는 최적화"를 의심해보는 것의 중요성이다. 재시도 증가, 커넥션 풀 분리, Virtual Thread 도입 같은 방법들이 항상 기대한 결과를 가져오지는 않는다.

성능 최적화에서 중요한 것은 개별 컴포넌트의 성능이 아니라 전체 시스템에서의 병목 지점을 정확히 파악하는 것이다. 그리고 그 병목이 어디서 발생하는지에 따라 최적화 전략이 완전히 달라질 수 있다는 점을 명심해야 한다.