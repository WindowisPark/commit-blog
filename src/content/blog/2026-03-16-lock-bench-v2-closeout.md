---
title: "LockBench v2 종료: 튜닝3 FAIL 확정과 JFR로 밝혀낸 진짜 병목"
description: "Redis 분산락 튜닝3이 오히려 성능을 악화시킨 원인을 분석하고, JFR 프로파일링으로 PESSIMISTIC_LOCK의 병목이 JVM이 아닌 InnoDB 행 락임을 정량 검증한 v2 마무리 기록"
pubDate: 2026-03-16
repo: lock-bench
repoDisplayName: LockBench
tags: ["lock-bench", "feature"]
commits: ["ccd874a1e81c2dbcf34c95b44d5ab8064f5c3809", "09e7493e0a0850152a1b7f41d060e580b62db12c", "aec48097e1be93b0e9f6699e53da6b5841fc9453"]
---
## 튜닝3, 예상을 뒤엎다

LockBench v2의 마지막 Redis 튜닝 실험이었다. 튜닝2에서 full-jitter 버그를 수정한 후에도 VIRTUAL 스레드 concurrency=200에서 성공률이 84.8%에 머물렀기 때문에, 파라미터를 더 공격적으로 조정했다.

```yaml
# 튜닝2 (버그수정) → 튜닝3
max-retries: 10 → 15     # 재시도 기회 50% 증가
max-backoff-millis: 200 → 500  # 최대 백오프 2.5배 확대
```

가설은 단순했다. backoff cap을 넓히면 고경합 구간에서 재시도 시간이 더 분산되고, retry 횟수를 늘리면 결국 락을 획득할 것이다. 2회 재현 실험을 돌렸다.

결과는 충격적이었다. **VIRTUAL Redis 성공률이 84.8%에서 73.6%로 하락**했다. PLATFORM도 98.8%에서 74.5%로 추락했다. p95 지연시간은 819ms에서 2957ms로 3.6배 악화, 처리량은 721 rps에서 107 rps로 85% 폭락했다. 모든 지표가 전면 악화다.

## 슬롯 낭비: 왜 더 많이 기다리면 더 나빠지는가

원인은 **max-backoff 500ms의 역효과**였다. Redis 분산락은 spinlock 방식이다. TTL 8초짜리 락이 해제되는 순간, 대기 중인 스레드가 즉시 SET NX를 시도해야 락을 획득한다. 이때 backoff cap이 200ms면 빈 슬롯을 놓칠 확률이 낮지만, 500ms면 락이 해제된 후에도 최대 500ms를 더 자고 있을 수 있다.

그 사이에 다른 스레드가 락을 먼저 가져가고, 깨어난 스레드는 또다시 LOCK_TIMEOUT으로 실패한다. retry 횟수를 15로 늘렸지만 매번 빈 슬롯을 놓치니 무용지물이었다. **분산락에서 backoff는 경합을 줄이는 도구이지, 무작정 늘린다고 좋아지지 않는다.**

v2-closeout 문서에 최종 판정을 기록했다. concurrency=200에서 Redis 분산락으로 99% 성공률을 달성하는 것은 구조적으로 불가능하다. 권장 파라미터는 튜닝2 버그수정 값(retries=10, backoff=200ms)으로 확정했다.

## JFR이 보여준 PESSIMISTIC_LOCK의 실체

v2의 마지막 실험은 JFR(Java Flight Recorder) 프로파일링이었다. PESSIMISTIC_LOCK 전략으로 200개 스레드가 3000건을 처리하는 동안 JVM 내부에서 무슨 일이 벌어지는지 들여다봤다.

```kotlin
// build.gradle.kts
tasks.named<BootRun>("bootRun") {
    jvmArgs(
        "-XX:+FlightRecorder",
        "-XX:StartFlightRecording=duration=120s,filename=jfr/lockbench.jfr,settings=profile"
    )
}
```

22.8초간의 부하 테스트 결과, **부하 구간에서 JVM CPU 사용률이 0~1%였다**. 200개 스레드가 동시에 일하는데 CPU가 거의 쉬고 있다는 뜻이다. GC도 병목이 아니었다. G1 GC Pause 최대 4.95ms, 120초 중 총 75ms만 차지했다. 힙 피크도 36MB에 불과했다.

JVM 레벨 `synchronized` 경합(JavaMonitorEnter)은 **0건**이었다. HikariCP 커넥션 대기를 의미하는 ThreadPark 이벤트가 290건 있었지만, JVM 내부 동기화 문제는 전혀 없었다.

## 진짜 병목은 InnoDB 행 락

MySQL performance_schema 분석이 결정적이었다. `SELECT ... FOR UPDATE` 쿼리의 평균 실행 시간 45.76ms 중 **Lock_time이 45.52ms로 99.5%**를 차지했다. 쿼리 자체의 실행 비용(인덱스 탐색, 데이터 읽기)은 0.24ms에 불과했다.

| 쿼리 | 실행 횟수 | 평균 쿼리시간 | 평균 Lock 대기 | Lock 비율 |
|---|---|---|---|---|
| SELECT ... FOR UPDATE | 13,000 | 45.76ms | 45.52ms | 99.5% |
| UPDATE stocks SET quantity - ? | 12,972 | 19.86ms | 19.59ms | 98.6% |

최악의 slow query는 512ms였고, 이 중 511ms가 Lock_time이었다. 약 100개 트랜잭션이 같은 행의 배타 락 해제를 기다리며 직렬 대기열에 쌓인 상태다. CPU는 쉬고, GC는 한가하고, JVM 동기화 경합도 없는데 성능이 나오지 않는 이유는 단 하나, **InnoDB 행 락이 모든 트랜잭션을 직렬화시키기 때문**이었다.

## v2를 마치며

v2 종료 체크리스트를 모두 완료했다. 4개 스프린트 중 Sprint 1(측정 정밀도), Sprint 2(Redis 튜닝), Sprint 3(관측 가능성)은 완료, Sprint 4(CI/자동화)는 v3로 이관했다.

v2에서 확인한 핵심 성과를 정리하면 이렇다:

1. **full-jitter backoff 버그 수정**으로 Redis 분산락 처리량 2배 향상
2. **Lock Bleed 현상 정량화** — PESSIMISTIC_LOCK이 읽기 API p95를 30초까지 끌어올리고 20% 실패
3. **Redis 분산락의 구조적 한계** — concurrency=200에서 99% 성공률 미달
4. **JFR로 병목 원인 확정** — JVM CPU 0~1%, InnoDB Lock_time이 Query_time의 99.5%

v3 로드맵도 작성했다. CI 자동화, Redis concurrency 임계치 실험, Redisson/Pub-Sub 벤치마크, HikariCP 풀 튜닝이 남아 있다. v2에서 "무엇이 안 되는지"를 충분히 확인했으니, v3에서는 "어디까지 되는지"를 탐구할 차례다.
