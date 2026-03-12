---
title: "동시성 락 성능 벤치마크: Redis vs MySQL, 그리고 가상 스레드의 진실"
description: "MySQL과 Redis 기반 분산락의 성능을 체계적으로 비교하고, 가상 스레드 환경에서의 성능 특성을 분석한 실험 결과를 공유합니다."
pubDate: 2026-02-19
repo: lock-bench
repoDisplayName: LockBench
tags: ["lock-bench", "feature", "docs"]
commits: ["bec2cff9b8e9f57f96d64b826f06b096c5735423", "7a37fbbabbfb54b2074b401c6ce221a640ff2f44"]
---
## 성능 측정의 필요성

동시성 제어는 고성능 웹 애플리케이션의 핵심이다. 특히 재고 관리나 주문 처리처럼 데이터 정합성이 중요한 영역에서는 락 전략 선택이 서비스 성능을 좌우한다. **LockBench** 프로젝트에서 MySQL과 Redis 기반 락을 체계적으로 비교 분석한 결과, 흥미로운 사실들이 드러났다.

## 실험 설계와 측정 지표

성능 비교를 위해 3단계 실험을 설계했다. 베이스라인 측정, 1차 튜닝, 2차 튜닝 순으로 진행하며 각 단계에서 성공률, p95 지연시간, 처리량을 측정했다. 특히 **성공률을 최우선 지표**로 두었다. 아무리 처리량이 높아도 락 획득에 실패해 비즈니스 로직이 정상 동작하지 않으면 의미가 없기 때문이다.

측정 대상은 4가지 전략이다: NO_LOCK, OPTIMISTIC_LOCK, PESSIMISTIC_LOCK, REDIS_DISTRIBUTED_LOCK. 각각을 **Platform Thread**와 **Virtual Thread** 환경에서 테스트했다.

```java
public class RedisDistributedLockStrategy implements StockLockStrategy {
    private final long ttlMillis;
    private final int maxRetries;
    private final long baseBackoffMillis;
    
    // TTL 2초 → 8초, 재시도 3회 → 10회로 튜닝
    public StockOperationResult execute(String productId, 
                                      StockOperation operation) {
        String lockKey = "stock:lock:" + productId;
        return distributedLockClient.executeWithLock(
            lockKey, 
            Duration.ofMillis(ttlMillis),
            operation::execute
        );
    }
}
```

## Redis 분산락의 예상치 못한 취약점

베이스라인 측정 결과가 충격적이었다. MySQL 기반 락들(NO_LOCK, OPTIMISTIC, PESSIMISTIC)이 모두 100% 성공률을 기록한 반면, **Redis 분산락은 Platform Thread에서 3.53%, Virtual Thread에서 0.30%의 성공률**을 보였다. 대부분이 LOCK_TIMEOUT으로 실패했다.

이는 Redis 락 획득 경합이 예상보다 훨씬 심각했음을 의미한다. 동일한 상품에 대한 동시 요청이 몰릴 때, 짧은 TTL(2초)과 제한적인 재시도(3회) 설정으로는 락을 획득할 기회조차 없었던 것이다.

1차 튜닝에서 TTL을 3초, 재시도를 5회로 늘렸다. 결과는 극적으로 개선되어 성공률이 55-64%까지 올라갔지만, 여전히 서비스 수준에는 미달이었다.

## 2차 튜닝의 성과와 한계

2차 튜닝에서는 과감한 조정을 시도했다. TTL을 8초, 재시도를 10회, 백오프를 10-200ms로 확대했다. 결과는 놀라웠다.

```yaml
# application-mysql-redis.yml
lockbench:
  redis-lock:
    enabled: true
    ttl-millis: 8000  # 기존 2000에서 4배 증가
    max-retries: 10   # 기존 3에서 3배 증가
    base-backoff-millis: 10
    max-backoff-millis: 200
```

**Platform Thread 환경**에서는 Redis가 드디어 100% 성공률을 달성했다. 하지만 p95 지연시간이 1.36초로 치솟았다. MySQL 락들이 0ms대를 유지하는 것과 대조적이다.

**Virtual Thread 환경**은 더욱 복잡한 양상을 보였다. Redis 성공률이 90.43%에 머물렀고, p95 지연시간은 2.1초까지 증가했다. 가상 스레드의 높은 동시성이 오히려 락 경합을 악화시킨 것으로 해석된다.

## 가상 스레드의 이중적 성격

실험에서 가장 흥미로운 발견은 **가상 스레드가 MySQL과 Redis에 미치는 영향이 정반대**라는 점이다.

MySQL 락 전략들은 가상 스레드에서 처리량이 극적으로 향상되었다:
- PESSIMISTIC_LOCK: 20,864 req/s (Platform) → 537,873 req/s (Virtual)
- NO_LOCK: 15,848 req/s (Platform) → 275,330 req/s (Virtual)

반면 Redis는 정반대였다:
- Platform Thread: 468 req/s (100% 성공률)
- Virtual Thread: 344 req/s (90% 성공률)

이는 가상 스레드가 데이터베이스 I/O 대기시간을 효율적으로 활용하는 반면, 분산락의 경합 상황에서는 오히려 부담을 가중시킨다는 것을 시사한다.

## 실무 적용을 위한 인사이트

실험 결과를 통해 얻은 핵심 교훈들이다.

첫째, **Redis 분산락은 신중한 튜닝이 필수**다. 기본 설정으로는 실전에서 사용하기 어렵다. TTL과 재시도 정책을 충분히 여유 있게 설정해야 한다.

둘째, **지연시간 vs 성공률의 트레이드오프**를 고려해야 한다. Redis 락의 성공률을 높이려면 긴 TTL과 많은 재시도가 필요한데, 이는 불가피하게 지연시간 증가로 이어진다.

셋째, **가상 스레드 환경에서의 MySQL 우위**가 뚜렷하다. 특히 PESSIMISTIC_LOCK의 처리량이 25배 이상 향상되는 것은 주목할 만하다.

## 앞으로의 개선 방향

현재 Redis 락의 근본적 한계를 개선하기 위한 몇 가지 방향을 고민 중이다. 락 획득 메트릭 추가로 실패 패턴을 더 정밀하게 분석하고, 핫키 분산 전략 도입을 검토하고 있다. 또한 가상 스레드 환경에서의 백오프 전략을 더욱 정교하게 조정할 계획이다.

성능 벤치마크의 가치는 단순한 숫자 비교를 넘어, **실제 운영 환경에서 마주할 선택의 순간에 객관적 근거를 제공**하는 데 있다. 이번 실험으로 각 락 전략의 특성과 한계를 명확히 파악할 수 있었고, 특히 가상 스레드와의 조합에서 나타나는 예상치 못한 패턴들을 발견할 수 있었다.