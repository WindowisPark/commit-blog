---
title: "동시성 제어의 현실: LockBench에서 실패 분류와 백오프 전략 구현기"
description: "동시성 제어 성능 측정 프로젝트에서 실패 원인을 세밀하게 분류하고, 충돌 상황에서의 백오프 전략을 도입한 경험을 공유합니다."
pubDate: 2026-02-14
repo: lock-bench
repoDisplayName: LockBench
tags: ["lock-bench", "feature"]
commits: ["8a39c9fc6ad080460a49049692058d3264fa37d3"]
---
## 문제의 시작: 단순한 성공/실패로는 부족하다

동시성 제어 성능을 측정하는 **LockBench** 프로젝트를 진행하면서, 초기 구현의 한계가 명확해졌습니다. 주문이 실패했을 때 단순히 `boolean` 값으로만 결과를 반환하다 보니, 정작 중요한 정보들이 사라지고 있었습니다.

재고 부족인지, 버전 충돌인지, 락 획득 실패인지 알 수 없으니 각 전략의 특성을 제대로 분석할 수 없었습니다. 특히 **Optimistic Lock**에서는 충돌이 발생할 때마다 즉시 재시도를 반복하다 보니, 동시 요청이 몰리면 오히려 성능이 악화되는 현상까지 관찰했습니다.

## 실패 분류 체계 설계

가장 먼저 해결한 것은 실패 원인의 명확한 분류였습니다. 각 전략별로 발생할 수 있는 실패 케이스를 정리하고, 이를 enum으로 체계화했습니다.

```java
public enum OrderFailureReason {
    OUT_OF_STOCK,           // 재고 부족
    VERSION_CONFLICT,       // 낙관적 락 충돌
    LOCK_TIMEOUT,          // 분산 락 획득 실패
    INVALID_QUANTITY,      // 잘못된 주문 수량
    PRODUCT_NOT_FOUND      // 존재하지 않는 상품
}
```

이제 각 전략에서 발생하는 실패를 정확히 구분할 수 있게 되었습니다. **Optimistic Lock**에서는 `VERSION_CONFLICT`가, **Redis Distributed Lock**에서는 `LOCK_TIMEOUT`이 주요 지표가 되었죠. 실험 결과에서도 실패 유형별 건수를 별도로 집계하여, 각 전략의 특성을 한눈에 파악할 수 있게 했습니다.

## 백오프 전략으로 충돌 완화하기

**Optimistic Lock**의 가장 큰 문제는 충돌 발생 시 무작정 재시도를 반복한다는 점이었습니다. 동시 요청들이 모두 같은 타이밍에 재시도하면서 충돌이 계속 발생하는 악순환이 반복되었습니다.

이를 해결하기 위해 **지수 백오프와 지터(Jitter)**를 조합한 전략을 도입했습니다.

```java
private void backoff(int attempt) {
    long exponential = BASE_BACKOFF_MILLIS << Math.min(attempt, 4);
    long baseDelay = Math.min(MAX_BACKOFF_MILLIS, exponential);
    long jitter = ThreadLocalRandom.current().nextLong(baseDelay + 1);
    long sleepMillis = baseDelay + jitter;
    
    try {
        Thread.sleep(sleepMillis);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
}
```

기본 2ms에서 시작해 32ms까지 지수적으로 증가시키되, 각 시도마다 랜덤 지연을 추가해 동시 재시도를 분산시켰습니다. 또한 서버 보호를 위해 최대 재시도 횟수를 5회로 제한했습니다.

## 책임 분리: 락 vs 트랜잭션

**Pessimistic Lock** 전략을 구현하면서 중요한 설계 결정을 내려야 했습니다. 동시성 제어(락)와 데이터 일관성(트랜잭션)의 책임을 어떻게 나눌 것인가였습니다.

최종적으로는 전략 패턴 내부에서는 순수하게 임계 영역 보호에만 집중하고, 트랜잭션 경계는 상위 서비스 계층에서 관리하도록 분리했습니다.

```java
// 전략은 락으로 보호된 임계 영역에만 집중
boolean updated = stockAccessPort.decreaseWithPessimisticLock(productId, quantity);
if (updated) {
    return OrderResult.ok();
}
```

이런 분리를 통해 향후 **JPA**나 **Redis**로 확장할 때도 각 전략이 동일한 인터페이스를 유지하면서, 트랜잭션 정책만 서비스 계층에서 조정할 수 있는 유연성을 확보했습니다.

## 동시성 테스트로 검증하기

가장 중요한 것은 이런 개선사항들이 실제로 동작하는지 검증하는 일이었습니다. 단순한 단위 테스트를 넘어서 동시성 상황을 재현하는 테스트를 작성했습니다.

특히 **Optimistic Lock**에서는 의도적으로 충돌을 발생시키는 테스트 포트를 만들어, 재시도 상한선이 제대로 작동하는지 확인했습니다. 100회 재시도를 요청해도 실제로는 6회(초기 시도 + 5회 재시도)만 수행되는 것을 검증할 수 있었습니다.

## 마치며

이번 작업을 통해 동시성 제어에서 가장 중요한 것은 단순히 락을 거는 것이 아니라, **실패 상황을 제대로 이해하고 대응하는 것**임을 깨달았습니다. 실패 분류 체계로 각 전략의 특성을 명확히 파악할 수 있게 되었고, 백오프 전략으로 충돌 상황에서의 성능 악화를 방지했습니다.

무엇보다 책임을 명확히 분리함으로써 확장 가능한 아키텍처의 기반을 마련했습니다. 앞으로 실제 데이터베이스 환경에서 테스트할 때도 이 구조가 큰 도움이 될 것 같습니다.