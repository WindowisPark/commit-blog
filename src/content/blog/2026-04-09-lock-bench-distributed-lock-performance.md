---
title: "분산 락 성능 벤치마크: 동시성 한계를 2.5배 확장한 Fair Lock의 비밀"
description: "MySQL과 Redis를 이용한 6가지 락 전략의 대규모 성능 실험. Optimistic Lock의 구조적 한계부터 Redisson Fair Lock으로 concurrency ceiling을 50까지 확장한 과정을 담았습니다."
pubDate: 2026-04-09
repo: lock-bench
repoDisplayName: LockBench
tags: ["lock-bench", "feature", "docs"]
commits: ["3ce5fb8e782735915f30326b0290995bae9bdaad", "53f661098c234ec945cd66706b03a51d1fdb5907", "abce317879c4b6ebef302dc963d040abffe95763"]
---
## 실험의 배경: 분산 락의 현실적 한계를 찾아서

**LockBench** 프로젝트는 단순한 벤치마크를 넘어 실제 운영 환경에서 만날 수 있는 동시성 문제들을 체계적으로 분석하는 도구입니다. 이번 v3 실험에서는 6가지 락 전략을 MySQL 8.0과 Redis 7 환경에서 철저히 검증했습니다.

특히 주목할 점은 **동시성 한계(concurrency ceiling)**의 개념입니다. 단순히 "빠르다" "느리다"를 넘어, 실제로 99% 이상 성공률과 p95 레이턴시 500ms 이하를 동시에 만족할 수 있는 최대 동시 요청 수를 찾는 것이 목표였습니다.

## Optimistic Lock: 50회 재시도해도 극복할 수 없는 벽

**Optimistic Lock**에 대한 첫 번째 실험은 충격적이었습니다. 기존 5회 재시도에서 45% 성공률을 보이던 것을 50회까지 확대했지만, 결과는 예상을 벗어났습니다.

```java
private void backoff(int attempt) {
    long exponential = BASE_BACKOFF_MILLIS << Math.min(attempt, 10);
    long cap = Math.min(MAX_BACKOFF_MILLIS, exponential);
    long sleepMillis = ThreadLocalRandom.current().nextLong(cap + 1);
    try {
        Thread.sleep(sleepMillis);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
}
```

재시도 50회에서 Virtual Thread 환경은 99.9% 성공률을 달성했습니다. 하지만 p95 레이턴시가 11.7초에 달했습니다. **Full-jitter backoff**와 exponential backoff를 적용했음에도 불구하고, 200개의 동시 요청이 같은 레코드에 VERSION_CONFLICT를 일으키는 상황은 근본적으로 해결되지 않았습니다.

Virtual Thread가 Platform Thread보다 동일 재시도 횟수에서 6-8% 높은 성공률을 보인 것은 흥미로운 발견이었습니다. I/O 대기 시 양보하는 특성이 backoff 효과를 증폭시킨 것으로 분석됩니다.

## Lock Bleed 문제: 커넥션 풀 분리만으로는 부족하다

**Lock Bleed**는 쓰기 트랜잭션이 DB 커넥션을 장시간 점유하면서 읽기 요청까지 지연시키는 현상입니다. 이를 해결하기 위해 읽기/쓰기 커넥션 풀을 분리하는 **Routing DataSource**를 구현했습니다.

```java
@Bean
@Primary
public DataSource routingDataSource(DataSourceProperties properties) {
    DataSource writeDs = createPool(properties, "write-pool", writePoolSize);
    DataSource readDs = createPool(properties, "read-pool", readPoolSize);

    ReadWriteRoutingDataSource routing = new ReadWriteRoutingDataSource();
    routing.setTargetDataSources(Map.of(
            ReadWriteRoutingDataSource.DataSourceType.WRITE, writeDs,
            ReadWriteRoutingDataSource.DataSourceType.READ, readDs
    ));
    return routing;
}
```

결과는 실망스러웠습니다. 단일 커넥션 풀에서 읽기 p95가 11.74초였던 것이 11.40초로 불과 3% 개선에 그쳤습니다. **HikariCP**가 문제가 아니라 **InnoDB 엔진** 자체의 lock manager가 병목이었던 것입니다.

200개의 트랜잭션이 동일한 row에 SELECT FOR UPDATE를 연쇄적으로 걸면서 MySQL의 락 매니저에 구조적 부하가 발생한 것입니다. 이는 커넥션 풀 튜닝으로는 해결할 수 없는 영역이었습니다.

## Redisson Fair Lock: 게임 체인저의 등장

가장 인상적인 결과는 **Redisson Fair Lock** 실험에서 나왔습니다. 기존 Pub-Sub 방식의 Unfair Lock과 비교했을 때, Fair Lock은 모든 동시성 구간에서 52-71%의 p95 레이턴시 개선을 보여주었습니다.

```java
@Override
public OrderResult placeOrder(Long productId, int quantity, int optimisticRetries, long holdMillis) {
    String key = "lock:stock:" + productId;
    RLock lock = redissonClient.getFairLock(key);
    
    boolean acquired;
    try {
        acquired = lock.tryLock(waitTimeMillis, leaseTimeMillis, TimeUnit.MILLISECONDS);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return OrderResult.fail(OrderFailureReason.LOCK_TIMEOUT);
    }
    // ...
}
```

특히 Platform Thread + concurrency=50에서 Fair Lock의 p95가 427ms를 기록하며 PASS 기준을 통과한 반면, Unfair Lock은 1,436ms로 3.4배 차이를 보였습니다. **FIFO 대기열**이 tail latency를 균등하게 분산시키는 효과가 확실히 입증되었습니다.

## CI 자동화: 성능 회귀 감지 시스템 구축

실험의 재현성과 지속적인 모니터링을 위해 **GitHub Actions** 기반의 벤치마크 파이프라인을 구축했습니다.

```yaml
jobs:
  benchmark:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    
    services:
      mysql:
        image: mysql:8.0
        ports:
          - 13306:3306
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
```

파이프라인은 MySQL 단독 매트릭스 테스트(3가지 락 × 2가지 스레드 모델)와 Redis 분산락 비교 테스트를 자동으로 실행합니다. 성능 회귀 감지를 위해 Redisson 성공률이 99% 아래로 떨어지면 워닝을 발생시킵니다.

## JFR 프로파일링: 성능 병목 지점 추적

성능 분석의 깊이를 더하기 위해 **Java Flight Recorder** 통합 워크플로우도 구축했습니다. 수동 디스패치를 통해 특정 시나리오에 대한 JFR 레코딩을 90일간 보관하며, 핫스팟 메서드와 GC 패턴을 자동으로 분석합니다.

## 최종 결론: 동시성 한계의 재정의

이번 실험을 통해 **동시성 천장(concurrency ceiling)**의 진화를 확인할 수 있었습니다:

- **Lettuce Spinlock**: concurrency ≤ 20
- **Redisson Unfair**: concurrency ≤ 20 (0% LOCK_TIMEOUT이지만 동일한 한계)
- **Redisson Fair**: concurrency ≤ 50 (Platform Thread 기준 **2.5배 확장**)

**Redisson Fair Lock + Platform Thread + concurrency ≤ 50** 조합이 분산 환경에서 현재까지의 최적해임을 확인했습니다. 단순히 기능적 정확성을 넘어 실제 운영 환경의 부하를 견딜 수 있는 threshold를 과학적으로 측정했다는 점에서 의미가 큽니다.

반면 Optimistic Lock은 concurrency=200 환경에서 구조적 한계를 드러냈습니다. 재시도 횟수를 아무리 늘려도 레이턴시 폭증 문제는 해결되지 않았으며, 실제 서비스에서는 concurrency를 10-20 수준으로 제한해야 사용 가능할 것으로 판단됩니다.

이러한 벤치마크 결과는 단순한 성능 수치를 넘어, 실제 서비스 아키텍처 설계 시 의사결정의 근거가 될 수 있는 구체적인 가이드라인을 제공합니다.