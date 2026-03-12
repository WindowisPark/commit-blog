---
title: "LockBench v1 완료: 스레드 모델과 락 전략 비교 벤치마크 플랫폼 구축기"
description: "1주 스프린트로 동시성 제어 전략을 체계적으로 비교할 수 있는 벤치마크 시스템을 구축하고, 성능 측정 결과를 바탕으로 권장 운영 전략을 도출한 여정"
pubDate: 2026-02-16
repo: lock-bench
repoDisplayName: LockBench
tags: ["lock-bench", "docs"]
commits: ["27bee9fb6be73e59afa236761ee2cd891d1c506e"]
---
## 프로젝트 개요와 목표

**LockBench**는 동시성 제어 전략을 정량적으로 비교하기 위해 시작한 프로젝트입니다. 실제 애플리케이션에서 스레드 모델(Platform vs Virtual Thread)과 락 전략(낙관적, 비관적, 분산락 등)의 성능 차이를 측정하고 싶었지만, 기존 벤치마킹 도구들로는 우리의 특정 시나리오를 재현하기 어려웠습니다.

1주라는 짧은 스프린트 내에서 **Spring Boot 기반 벤치마크 API**부터 **k6 자동화 스크립트**까지 완성하여, 재현 가능한 성능 비교 환경을 구축하는 것이 v1의 목표였습니다.

## 아키텍처와 핵심 설계 결정

가장 중요했던 설계 결정은 **전략 패턴을 통한 교체 가능한 구조**였습니다. 스레드 모델과 락 전략을 런타임에 조합할 수 있도록 팩토리 패턴을 적용했습니다.

```java
public class ThreadExecutionStrategyFactory {
    public ThreadExecutionStrategy create(ThreadModel threadModel) {
        return switch (threadModel) {
            case PLATFORM -> new PlatformThreadStrategy();
            case VIRTUAL -> new VirtualThreadStrategy();
        };
    }
}

public class StockLockStrategyFactory {
    public StockLockStrategy create(LockType lockType) {
        return switch (lockType) {
            case NO_LOCK -> new NoLockStrategy();
            case OPTIMISTIC_LOCK -> new OptimisticLockStrategy();
            case PESSIMISTIC_LOCK -> new PessimisticLockStrategy();
            case REDIS_DISTRIBUTED_LOCK -> redisLockEnabled ? 
                new RedisDistributedLockStrategy() : new DisabledLockStrategy();
        };
    }
}
```

이 구조 덕분에 2×4 매트릭스(스레드 모델 2개 × 락 전략 4개) 조합을 동적으로 실행하고 비교할 수 있었습니다.

## 성능 측정과 자동화의 도전

단순히 API를 만드는 것을 넘어서 **반복 가능하고 신뢰할 수 있는 측정 환경**을 구축하는 것이 핵심 과제였습니다. k6를 선택한 이유는 JavaScript 기반으로 유연한 시나리오 작성이 가능하면서도, 대용량 부하 생성에 최적화되어 있기 때문입니다.

```javascript
// k6 매트릭스 자동화 스크립트
const combinations = [
  { thread: 'PLATFORM', lock: 'NO_LOCK' },
  { thread: 'PLATFORM', lock: 'OPTIMISTIC_LOCK' },
  { thread: 'PLATFORM', lock: 'PESSIMISTIC_LOCK' },
  { thread: 'VIRTUAL', lock: 'PESSIMISTIC_LOCK' }
  // ... 총 8개 조합
];

combinations.forEach(combo => {
  for (let i = 0; i < repeats; i++) {
    const result = http.post(`${BASE_URL}/api/experiments/matrix-run`, {
      threadModel: combo.thread,
      lockType: combo.lock,
      totalRequests: 3000
    });
    // 결과 수집 및 집계
  }
});
```

하지만 측정 과정에서 예상치 못한 문제들을 발견했습니다. 가장 큰 이슈는 **매우 짧은 실행 시간으로 인한 처리량 계산 왜곡**이었습니다. `elapsedMillis`가 0에 가까울 때 처리량이 과대 측정되는 현상을 확인했고, 이는 v2에서 나노초 단위 측정으로 개선하기로 했습니다.

## 실험 결과와 인사이트

5회 반복 실행을 통해 수집한 데이터를 분석한 결과, 흥미로운 패턴들을 발견할 수 있었습니다:

**Platform Thread 기준**:
- NO_LOCK: 34,835 req/s
- OPTIMISTIC_LOCK: 29,529 req/s
- PESSIMISTIC_LOCK: 35,417 req/s

**Virtual Thread 기준**:
- NO_LOCK: 332,381 req/s
- PESSIMISTIC_LOCK: 232,779 req/s

놀랍게도 Platform Thread에서는 **PESSIMISTIC_LOCK이 가장 높은 처리량**을 보였습니다. 이는 락 오버헤드보다는 데이터 정합성 보장으로 인한 안정적인 실행이 더 큰 영향을 미쳤을 가능성을 시사합니다.

Virtual Thread에서는 전반적으로 높은 처리량을 보였지만, 짧은 실행 시간으로 인한 측정 신뢰도 문제가 있어 추가 검증이 필요한 상황입니다.

## v1 권장 운영 전략과 다음 단계

수집된 데이터와 안정성을 종합적으로 고려하여, v1에서는 **PLATFORM + PESSIMISTIC_LOCK** 조합을 권장 기본값으로 선정했습니다. 이 조합은 반복 실행에서 가장 안정적인 성능을 보였고, 정확성을 우선하는 운영 환경에 적합하다고 판단했습니다.

Redis 분산락의 경우 현재 설정에서는 연결 오류로 인해 정상 측정이 불가능했지만, 이는 의도된 것입니다. v2에서는 실제 Redis 환경을 구성하여 분산락의 성능 특성을 정확히 측정할 계획입니다.

v2 로드맵에서는 측정 정밀도 개선, MySQL 기반 병목 분석, CI 자동화 등을 통해 더욱 신뢰할 수 있는 벤치마크 플랫폼으로 발전시켜 나갈 예정입니다.

1주라는 짧은 기간 동안 구상부터 실행 가능한 결과물까지 완성할 수 있었던 것은, 처음부터 **최소 기능으로 시작하되 확장 가능한 구조**를 염두에 두고 설계했기 때문입니다. 완벽한 측정보다는 반복 가능하고 비교 가능한 기준선을 만드는 것에 집중한 것이 v1 성공의 핵심이었습니다.