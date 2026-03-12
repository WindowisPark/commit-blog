---
title: "Java 21 가상스레드와 분산락을 비교하는 동시성 벤치마크 플랫폼 구축"
description: "Spring Boot 3와 Java 21 기반으로 Platform Thread vs Virtual Thread, 다양한 락 전략을 체계적으로 비교할 수 있는 실험 플랫폼을 설계했습니다."
pubDate: 2026-02-13
repo: lock-bench
repoDisplayName: LockBench
tags: ["lock-bench", "chore"]
commits: ["b6d1c371bb4e00797943c760aba19df3fb068d63"]
---
## 동시성 실험을 위한 체계적인 접근

최근 **Java 21**의 가상스레드가 정식 출시되면서, 기존 플랫폼 스레드와의 성능 차이에 대한 궁금증이 높아졌습니다. 단순히 "가상스레드가 빠르다"는 이야기를 넘어서, 실제 동시성 제어 상황에서 어떤 조합이 최적인지 체계적으로 실험해보고 싶었습니다.

**LockBench** 프로젝트는 이런 호기심에서 시작된 동시성 실험 플랫폼입니다. Thread 모델과 Lock 전략을 교체하며 성능을 측정하고, 재현 가능한 실험 환경을 제공하는 것이 목표입니다.

## 실험 설계의 핵심 아이디어

프로젝트의 핵심은 **전략 패턴을 활용한 교체 가능한 구조**입니다. 2가지 스레드 모델과 4가지 락 전략을 조합해 총 8가지 시나리오를 비교할 수 있도록 설계했습니다.

```java
@Component
public class ThreadExecutionStrategyFactory {
    public ThreadExecutionStrategy create(ThreadModelType type) {
        return switch (type) {
            case PLATFORM -> new PlatformThreadExecutionStrategy();
            case VIRTUAL -> new VirtualThreadExecutionStrategy();
        };
    }
}
```

스레드 모델은 **Platform Thread**와 **Virtual Thread** 두 가지로 구분했습니다. Virtual Thread의 경우 `Executors.newVirtualThreadPerTaskExecutor()`를 사용해 태스크마다 새로운 가상스레드를 생성하도록 구현했습니다.

락 전략은 더욱 다양합니다. No Lock(락 없음), **Optimistic Lock**, **Pessimistic Lock**, 그리고 **Redis 분산락**까지 총 4가지를 지원합니다. 각 전략은 동일한 인터페이스를 구현해 런타임에 교체 가능합니다.

## 헥사고날 아키텍처로 확장성 확보

실험 플랫폼이라는 특성상 다양한 저장소와 락 구현체를 쉽게 교체할 수 있어야 했습니다. 이를 위해 **헥사고날 아키텍처** 원칙을 적용했습니다.

```java
public interface StockAccessPort {
    StockSnapshot getStock(Long productId);
    void decreaseStock(Long productId, int quantity);
    void decreaseStockOptimistically(Long productId, int quantity, int maxRetries);
    void decreaseStockPessimistically(Long productId, int quantity);
}
```

도메인 계층에서는 포트(Port) 인터페이스만 의존하고, 실제 구현체는 인프라 계층의 어댑터(Adapter)에서 제공합니다. 현재는 **InMemoryStockAccessAdapter**로 시작했지만, 향후 JPA나 JDBC 기반 어댑터도 쉽게 추가할 수 있습니다.

## 실험 오케스트레이션과 성능 측정

실험의 핵심은 **ExperimentOrchestrator** 클래스입니다. 이 클래스는 지정된 동시성 수준으로 요청을 실행하고, 응답시간을 수집해 통계를 생성합니다.

```java
@Component
public class ExperimentOrchestrator {
    public ExperimentResponse runExperiment(ExperimentRequest request) {
        var threadStrategy = threadStrategyFactory.create(request.getThreadModel());
        var lockStrategy = lockStrategyFactory.create(request.getLockStrategy());
        
        var latencies = executeRequests(threadStrategy, lockStrategy, request);
        return buildResponse(LatencySummary.from(latencies));
    }
}
```

측정 결과는 P50, P95, P99 등의 **퍼센타일 메트릭**과 평균 응답시간으로 제공됩니다. 이를 통해 단순한 평균값이 아닌, 실제 서비스에서 중요한 꼬리 지연시간(tail latency)까지 분석할 수 있습니다.

## Redis 분산락과 설정 기반 전환

특히 흥미로운 부분은 **Redis 분산락** 구현입니다. 로컬 환경에서는 Redis 없이도 실험할 수 있도록 NoopDistributedLockClient를 제공하고, 프로덕션 환경에서는 실제 Redis를 사용할 수 있도록 설정 기반으로 전환됩니다.

```java
@Component
public class RedisDistributedLockStrategy implements StockLockStrategy {
    private final DistributedLockClient lockClient;
    
    @Override
    public void execute(Long productId, int quantity, StockAccessPort stockAccess) {
        String lockKey = "stock:" + productId;
        if (lockClient.tryLock(lockKey, Duration.ofSeconds(5))) {
            try {
                stockAccess.decreaseStock(productId, quantity);
            } finally {
                lockClient.unlock(lockKey);
            }
        }
    }
}
```

## 앞으로의 실험 계획

1주 타이트 개발 로드맵을 세워두었습니다. 현재 기본 골격을 완성했고, 앞으로는 실제 데이터베이스 연동, **Micrometer** 기반 메트릭 수집, **k6**를 활용한 부하 테스트 자동화를 진행할 예정입니다.

특히 **Grafana** 대시보드를 구성해 실험 결과를 시각화하고, 다양한 부하 패턴에서의 성능 특성을 분석해볼 계획입니다. Java 21의 가상스레드가 정말로 모든 상황에서 우수한지, 아니면 특정 조건에서만 효과적인지 데이터로 검증해보겠습니다.