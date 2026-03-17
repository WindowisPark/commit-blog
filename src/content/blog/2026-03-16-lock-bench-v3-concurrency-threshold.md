---
title: "LockBench v3 첫 실험: Redis 분산락의 concurrency 임계치를 찾아서"
description: "per-request concurrency 지원을 구현하고 3단계 튜닝 실험으로 Redis 분산락이 99% 성공률을 달성할 수 있는 동시성 상한을 정량적으로 도출한 기록"
pubDate: 2026-03-16
repo: lock-bench
repoDisplayName: LockBench
tags: ["lock-bench", "feature"]
commits: ["077fb7ab1c4dcd6442e98c7a9e99ce74a4b2bdbc"]
---
## v3의 첫 번째 질문

v2에서 concurrency=200으로는 Redis 분산락 99% 성공률이 구조적으로 불가능하다는 결론을 내렸다. 그렇다면 **도대체 몇까지는 되는 걸까?** 이 질문이 v3의 첫 번째 실험 주제가 됐다.

이를 위해 두 가지 준비가 필요했다. 실험마다 concurrency를 자유롭게 바꿀 수 있는 인프라와, 다양한 조합을 체계적으로 돌릴 수 있는 시나리오 스크립트다.

## per-request concurrency 지원

기존 `ExperimentOrchestrator`는 application.yml에 고정된 concurrency 값만 사용했다. 실험마다 설정 파일을 바꾸고 재시작해야 했던 것이다. 이를 **요청 단위로 concurrency를 지정**할 수 있게 수정했다.

```java
int effectiveConcurrency = request.concurrency() > 0
        ? request.concurrency()
        : threadExecutionStrategyFactory.effectiveConcurrency(request.threadModel());
```

`ThreadExecutionStrategyFactory`에도 concurrency를 받는 오버로드를 추가했다. 기존 config 기반 동작은 그대로 유지하면서, 실험 요청에 concurrency가 명시되면 그 값을 우선 적용한다.

이 과정에서 **프로파일 충돌 버그**도 발견했다. `application-mysql.yml`에 `redis-lock.enabled: false`가 명시되어 있어서 `application-mysql-redis.yml`의 `enabled: true`를 덮어쓰고 있었다. 기본값이 이미 false이므로 중복 선언을 제거하여 해결했다.

## 3라운드 16조합 실험

`s7-redis-concurrency.js` 시나리오를 새로 작성해 PLATFORM/VIRTUAL × concurrency 50/100 조합을 자동으로 순회하도록 했다. 3라운드에 걸쳐 총 16개 조합을 실험했다.

**라운드 1 — 튜닝2 (retries=10, backoff=200ms):** concurrency=50에서도 성공률 66~69%로 처참했다. retry 예산이 절대적으로 부족하다.

**라운드 2 — 튜닝3 (retries=15, backoff=500ms):** concurrency=50에서 90~91%로 개선됐지만 여전히 99%에 못 미쳤다. p95도 2.7초로 높았다.

**라운드 3 — 튜닝4 (retries=30, backoff=1000ms):** 극적인 변화가 나타났다.

| 스레드 | Concurrency | 성공률 | p95 | 처리량 |
|---|---|---|---|---|
| PLATFORM | 10 | **100%** | **12ms** | 106/s |
| PLATFORM | 20 | **100%** | 232ms | 117/s |
| PLATFORM | 50 | **100%** | 3862ms | 101/s |
| PLATFORM | 100 | **99.9%** | 6314ms | 102/s |
| VIRTUAL | 10 | **100%** | **15ms** | 101/s |
| VIRTUAL | 20 | **99.8%** | 152ms | 86/s |
| VIRTUAL | 50 | **100%** | 3461ms | 111/s |
| VIRTUAL | 100 | **100%** | 5827ms | 104/s |

tuning4에서 드디어 concurrency=100까지 99% 이상 달성했다. 하지만 숫자를 자세히 보면 성공률만으로 판단할 수 없다는 것을 알 수 있다.

## retry 예산이 전부였다

세 라운드를 관통하는 핵심 발견은 **retry budget이 성공률을 결정한다**는 것이다.

- retries=10, backoff=200ms → 총 retry window ~2초 → concurrency=50에서 53~69%
- retries=15, backoff=500ms → 총 retry window ~7.5초 → concurrency=50에서 81~91%
- retries=30, backoff=1000ms → 총 retry window ~30초 → concurrency=100에서 99.8~100%

retry window를 15배로 늘리니 성공률이 극적으로 올라갔다. 하지만 이는 **실패를 지연시킨 것이지, 경합을 해결한 것이 아니다**. concurrency=50에서 p95가 3.8초, concurrency=100에서 6.3초라는 것은 많은 요청이 수십 번 retry하며 수 초를 기다렸다는 뜻이다.

## 성공률과 지연시간의 트레이드오프

실험 결과를 기준별로 정리하면 명확한 가이드라인이 나온다.

| 기준 | 최대 Concurrency | 필요 설정 |
|---|---|---|
| 99% 성공 + p95 < 500ms | **10~20** | retries=30, backoff=1000ms |
| 99% 성공 (지연 무관) | **100** | retries=30, backoff=1000ms |
| retries ≤ 15로 99% | **불가능** (c=50 이상) | — |

concurrency=10~20이면 p95가 12~232ms로 프로덕션에서도 쓸 만하다. 50 이상부터는 성공은 하지만 3~6초의 tail latency가 발생하므로 용도에 따라 판단이 필요하다.

## spinlock의 구조적 한계

이번 실험으로 **Redis spinlock 기반 분산락의 근본적인 concurrency 천장**을 확인했다. retry 기반 락 획득은 경합 증폭(contention amplification)을 일으킨다. 동시성이 높아질수록 더 많은 스레드가 같은 락을 놓고 경쟁하고, 각 스레드가 retry를 더 빨리 소진한다.

v2에서 "200은 안 된다"를 확인했고, v3에서 "20까지는 쾌적하고, 100까지는 가능하다"를 정량화했다. 다음 단계는 Redisson/Pub-Sub 기반 락처럼 spinlock이 아닌 알림 방식의 분산락이 이 한계를 어떻게 돌파하는지 비교하는 것이다. 폴링 대신 락 해제를 구독하면 빈 슬롯을 놓치는 문제 자체가 사라지기 때문이다.
