---
title: "동시성 실험 플랫폼에서 발견한 분산 락의 숨겨진 함정들"
description: "Redis 백오프 버그 수정과 비관적 락의 커넥션 블리딩 현상을 실험으로 검증하며 얻은 실무 인사이트"
pubDate: 2026-02-21
repo: lock-bench
repoDisplayName: LockBench
tags: ["lock-bench", "feature"]
commits: ["094e66770e4de4aad212fec698413c963ae49d6d"]
---
## 백오프 알고리즘의 미묘한 버그

**LockBench** 프로젝트에서 Redis 분산 락 성능을 측정하던 중 흥미로운 버그를 발견했다. **RedisDistributedLockStrategy**의 exponential backoff 구현이 표준과 달랐던 것이다.

```java
// 버그가 있던 코드
long baseDelay = Math.min(maxBackoffMillis, exponential);
long jitter = ThreadLocalRandom.current().nextLong(baseDelay + 1);
long sleepMillis = baseDelay + jitter;  // [baseDelay, 2×baseDelay]

// 수정된 코드  
long cap = Math.min(maxBackoffMillis, exponential);
long sleepMillis = ThreadLocalRandom.current().nextLong(cap + 1);  // [0, cap]
```

기존 구현은 `[baseDelay, 2×baseDelay]` 범위에서 대기 시간을 선택했지만, 표준 full-jitter는 `[0, cap]` 범위를 사용한다. 작은 차이처럼 보이지만 성능에 미치는 영향은 상당했다.

버그 수정 후 **Redis 분산 락의 p95 지연시간이 60% 감소**했다. PLATFORM 스레드에서 1358ms → 540ms, VIRTUAL 스레드에서 2103ms → 819ms로 대폭 개선됐다. 처리량 역시 2배 이상 향상되어 백오프 알고리즘의 중요성을 다시 한번 깨달았다.

## 비관적 락이 시스템을 마비시키는 순간

더 흥미로운 실험은 **락 블리드(Lock Bleed)** 테스트였다. 비관적 락이 DB 커넥션을 장기간 점유할 때, 락과 무관한 읽기 API까지 차단되는지 검증하는 실험이었다.

실험 설정은 단순했다. HikariCP 기본 풀 크기 10개, 200개 동시 스레드가 `SELECT FOR UPDATE` + 100ms sleep으로 커넥션을 점유하는 동안, 별도의 읽기 요청을 초당 10개씩 보내며 응답 시간을 측정했다.

```java
@Transactional
public OrderResult placeOrder(Long productId, int quantity, int optimisticRetries, long holdMillis) {
    boolean updated = stockAccessPort.decreaseWithPessimisticLock(productId, quantity);
    if (updated) {
        if (holdMillis > 0) {
            Thread.sleep(holdMillis);  // 커넥션 + 행 락 유지 상태에서 대기
        }
        return OrderResult.ok();
    }
    // ...
}
```

결과는 충격적이었다. **PESSIMISTIC_LOCK은 읽기 API의 p95를 30초까지 끌어올리고 20%의 요청을 실패**시켰다. 반면 다른 전략들은 모두 15ms 이하의 지연시간과 0% 실패율을 기록했다.

## 커넥션 풀 고갈의 연쇄 반응

원인 분석 결과 **커넥션 풀 고갈로 인한 연쇄 반응**이었다. 200개 스레드가 `SELECT FOR UPDATE`로 순차 직렬화되면서 약 20초간 처리가 지연되고, 그 동안 HikariCP 풀 10개가 모두 소진된다. 무관한 읽기 요청들이 커넥션을 얻지 못해 대기 큐에 쌓이다가 30초 타임아웃에 걸려 실패하는 것이다.

반면 **REDIS_DISTRIBUTED_LOCK**은 Redis 키만 점유하고 DB 커넥션은 쿼리 후 즉시 반환하므로 읽기 API에 전혀 영향을 주지 않았다. NO_LOCK과 OPTIMISTIC_LOCK도 마찬가지로 비즈니스 로직 처리 시에는 커넥션을 반환한 상태였다.

## 실험 자동화와 측정의 중요성

k6 멀티 시나리오 테스트로 이런 복잡한 상황을 정량적으로 측정할 수 있었다. `tags: { type: "read" }` 필터링으로 쓰기 부하 중 읽기 성능을 분리 측정하고, PowerShell 스크립트로 4가지 락 전략을 자동 실행하며 결과를 비교했다.

```javascript
// k6 읽기 프로브 시나리오
readProbe: {
  executor: 'constant-arrival-rate',
  rate: READ_RATE,  // 초당 10req
  timeUnit: '1s',
  duration: '90s',
  preAllocatedVUs: 20,
  startTime: '3s',  // 쓰기 실험 시작 3초 후
  exec: 'readStock',
}
```

자동화된 측정 없이는 이런 미묘한 성능 차이나 사이드 이펙트를 놓치기 쉽다. 특히 분산 락처럼 복잡한 동시성 제어에서는 **정량적 성능 측정이 필수**다.

## 실무에서 얻은 교훈

첫째, **PESSIMISTIC_LOCK은 락 범위를 최소화**해야 한다. 외부 API 호출이나 이벤트 발행 같은 비즈니스 로직을 트랜잭션 내에서 실행하면 무관한 읽기 API까지 차단될 수 있다.

둘째, **HikariCP 풀 크기를 과소평가하면 안 된다**. 기본값 10은 고부하 환경에서 즉시 한계에 부딪힌다. 예상 동시 트랜잭션 수를 고려한 적절한 설정이 필요하다.

셋째, **Redis 분산 락의 숨겨진 장점**을 발견했다. 단순히 여러 서버 간 동기화뿐만 아니라, DB 커넥션을 조기 반환함으로써 쓰기 부하가 읽기를 차단하는 것을 방지한다.

마지막으로 **백오프 알고리즘의 정확한 구현**이 성능에 미치는 영향은 생각보다 크다. 표준을 벗어난 구현은 예상치 못한 성능 저하를 일으킬 수 있다.

동시성 제어는 미묘한 영역이다. 이론적 지식만으로는 부족하고, 실제 부하 상황에서의 정량적 측정과 검증이 필수다. LockBench 같은 실험 플랫폼을 통해 다양한 시나리오를 체계적으로 검증하는 것이 안정적인 시스템 구축의 열쇠라고 생각한다.