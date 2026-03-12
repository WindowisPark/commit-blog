---
title: "동시성 제어 벤치마킹 도구의 매트릭스 실험 기능 구현기"
description: "2x4 매트릭스 형태로 Thread 모델과 Lock 전략 조합을 자동화하고, 실행 환경을 표준화하여 일관성 있는 성능 측정을 가능하게 만든 과정"
pubDate: 2026-02-14
repo: lock-bench
repoDisplayName: LockBench
tags: ["lock-bench", "feature"]
commits: ["fb3772348ebf97ffba04eb83a668b462b47a6f13"]
---
## 동시성 벤치마킹의 새로운 차원

**LockBench** 프로젝트에 매트릭스 실험 기능을 추가했습니다. 기존에는 Thread 모델과 Lock 전략을 하나씩 선택해서 실험해야 했다면, 이제는 모든 조합을 한 번에 실행할 수 있게 되었습니다. 2개의 Thread 모델(Platform, Virtual)과 4개의 Lock 전략을 조합한 **8가지 시나리오**를 자동으로 실행하는 시스템을 만든 것입니다.

## Thread 실행 환경의 표준화

가장 중요한 변화는 동시성 수준을 고정값으로 관리하기 시작한 점입니다. 기존에는 API 요청마다 다른 동시성 값을 받아서 실험했는데, 이렇게 되면 실험 간 비교가 어려워집니다.

```java
public ThreadExecutionStrategy create(ThreadModelType threadModelType) {
    return switch (threadModelType) {
        case PLATFORM -> new PlatformThreadExecutionStrategy(platformConcurrency);
        case VIRTUAL -> new VirtualThreadExecutionStrategy(virtualConcurrency);
    };
}
```

이제 `ThreadExecutionStrategyFactory`는 설정 파일에서 정의된 고정값을 사용합니다. Platform Thread는 200개, Virtual Thread도 200개로 기본 설정했지만, 운영 환경에 따라 조정할 수 있습니다.

특히 **Virtual Thread**에 세마포어 기반 동시성 제한을 추가한 점이 흥미롭습니다. Virtual Thread는 본래 무제한 생성이 가능하지만, 벤치마킹에서는 공정한 비교를 위해 동시성을 제한해야 했습니다.

```java
@Override
public <T> CompletableFuture<T> submit(Supplier<T> task) {
    return CompletableFuture.supplyAsync(() -> {
        semaphore.acquireUninterruptibly();
        try {
            return task.get();
        } finally {
            semaphore.release();
        }
    }, executorService);
}
```

## 매트릭스 실험의 구현

새로운 `/api/experiments/matrix-run` 엔드포인트는 하나의 요청으로 모든 Thread/Lock 조합을 실험합니다. `MatrixExperimentOrchestrator`가 핵심 역할을 담당합니다.

```java
for (ThreadModelType threadModel : ThreadModelType.values()) {
    for (LockStrategyType lockStrategy : LockStrategyType.values()) {
        try {
            ExperimentResponse result = experimentOrchestrator.run(new ExperimentRequest(
                threadModel, lockStrategy, request.productId(),
                request.initialStock(), request.quantity(),
                request.totalRequests(), 1, request.optimisticRetries()
            ));
            // 성공 케이스 처리
        } catch (Exception e) {
            // 실패 케이스 처리
        }
    }
}
```

각 시나리오 실행 전에는 `initialStock`으로 재고를 재초기화합니다. 이전 실험의 결과가 다음 실험에 영향을 주지 않도록 깨끗한 상태에서 시작하는 것이 중요했습니다.

## Redis 설정 검증 강화

**Redis Distributed Lock** 전략을 사용할 때 Redis가 비활성화되어 있다면 즉시 실패하도록 개선했습니다. 기존에는 런타임에서 애매하게 실패했다면, 이제는 명확한 메시지와 함께 빠르게 실패합니다.

```java
if (!redisLockEnabled) {
    throw new IllegalStateException("Redis distributed lock is disabled. Set lockbench.redis-lock.enabled=true.");
}
```

이런 명시적 검증은 특히 매트릭스 실험에서 중요합니다. 8개 시나리오 중 Redis 관련 시나리오만 실패하고 나머지는 정상 실행되어야 하기 때문입니다.

## 실험 결과의 구조화

매트릭스 실험의 결과는 `MatrixRunResponse`로 구조화됩니다. 전체 시나리오 수, 성공/실패 개수, 그리고 각 시나리오별 상세 결과를 포함합니다.

각 `MatrixScenarioResult`는 Thread 모델과 Lock 전략 조합별로 성공/실패 상태와 상세 메시지를 담고 있어서, 어떤 조합에서 문제가 발생했는지 쉽게 파악할 수 있습니다.

## 포트폴리오 관점에서의 의미

이번 구현에서 가장 인상적인 부분은 **공정한 비교를 위한 환경 표준화**였습니다. 단순히 기능을 추가하는 것이 아니라, 실험의 신뢰성을 높이기 위해 실행 조건을 통일하고, 각 실험 간 독립성을 보장한 점이 핵심입니다.

또한 실패 케이스에 대한 우아한 처리도 주목할 만합니다. 8개 시나리오 중 일부가 실패해도 전체 실험이 중단되지 않고, 성공한 결과는 그대로 반환하는 설계입니다. 이런 견고함이 실제 운영 환경에서 중요한 차이를 만듭니다.