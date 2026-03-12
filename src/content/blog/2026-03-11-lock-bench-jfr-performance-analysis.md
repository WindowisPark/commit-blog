---
title: "LockBench v2 마무리: JFR 분석과 Redis 최종 튜닝으로 성능 한계 탐구하기"
description: "분산락 성능 벤치마킹 프로젝트 LockBench의 v2 종료를 앞두고, JFR 프로파일링 설정과 Redis 분산락 최종 튜닝을 통해 성능 병목을 분석하는 과정을 다룹니다."
pubDate: 2026-03-11
repo: lock-bench
repoDisplayName: LockBench
tags: ["lock-bench", "feature"]
commits: ["1e8a1500b24111ff399120531428720cf9d99fa7"]
---
## 프로젝트 막바지의 정밀한 분석 준비

**LockBench** v2의 마지막 실험을 앞두고 있습니다. 그동안 PESSIMISTIC_LOCK의 커넥션 풀 고갈 문제부터 Redis 분산락의 backoff 버그 수정까지, 다양한 성능 이슈들을 하나씩 해결해왔습니다. 이제 남은 것은 두 가지 핵심 실험입니다: **JFR 프로파일링**을 통한 깊이 있는 병목 분석과 Redis 분산락의 마지막 튜닝 시도입니다.

이번 커밋에서는 이 두 실험을 위한 모든 준비 작업을 완료했습니다. 특히 주목할 점은 v2 프로젝트의 종료 보고서까지 미리 작성해둔 것입니다. 실험 결과가 나오면 바로 채워넣을 수 있는 체계적인 문서화 시스템을 구축한 셈입니다.

## JFR로 JVM 내부까지 들여다보기

Java Flight Recorder를 활용한 성능 분석 환경을 구축했습니다. **Gradle 빌드 스크립트**에 JFR 설정을 통합하여, 애플리케이션 실행과 동시에 프로파일링이 시작되도록 했습니다.

```kotlin
tasks.named<org.springframework.boot.gradle.tasks.run.BootRun>("bootRun") {
    jvmArgs(
        "-XX:+FlightRecorder",
        "-XX:StartFlightRecording=duration=120s,filename=jfr/lockbench.jfr,settings=profile"
    )
}
```

120초 동안 JFR 데이터를 수집하여 `jfr/lockbench.jfr` 파일로 저장합니다. 이를 통해 PESSIMISTIC_LOCK 전략에서 발생하는 JVM 레벨의 락 대기, 스레드 파킹, CPU 사용률, GC 패턴까지 상세히 분석할 예정입니다.

특히 이전에 수행한 **Lock Bleed 실험**에서 PESSIMISTIC_LOCK이 HikariCP 커넥션 풀을 고갈시켜 무관한 읽기 API까지 30초간 차단시켰던 현상을, 이번엔 JVM 내부 관점에서 관찰할 수 있을 것입니다. JFR의 Lock Instances 탭에서 ReentrantLock 대기 시간과 ThreadPark 이벤트를 통해 정확한 병목 지점을 찾아낼 계획입니다.

## Redis 분산락의 마지막 도전

Redis 분산락 튜닝도 3단계에 돌입했습니다. 이전 튜닝에서 **full-jitter backoff 버그**를 수정한 후에도 VIRTUAL 스레드 환경에서 concurrency=200일 때 성공률이 84.8%에 머물렀습니다. 목표인 99%에는 여전히 부족한 상황입니다.

이번 튜닝3에서는 두 가지 파라미터를 조정했습니다:

```yaml
lockbench:
  redis-lock:
    max-retries: 10 → 15  # 재시도 기회 50% 증가
    max-backoff-millis: 200 → 500  # 최대 백오프 2.5배 증가
```

**max-retries**를 15로 늘려 락 획득 실패 시 더 많은 재시도 기회를 제공하고, **max-backoff-millis**를 500ms로 확장하여 높은 경합 상황에서 재시도 간격을 더욱 분산시켰습니다. 특히 attempt 4 이후의 재시도에서 0~500ms 범위로 대기하게 되어, 기존 0~200ms보다 훨씬 넓은 스펙트럼에서 경합을 회피할 수 있을 것으로 예상됩니다.

## 체계적인 문서화와 실험 관리

이번 커밋에서 가장 인상적인 부분은 **실험 결과를 채워넣을 템플릿**들을 미리 준비해둔 것입니다. `v2-redis-tuning3-summary-2026-03-11.md`와 `v2-jfr-pessimistic-summary-2026-03-11.md` 파일들을 보면, 실험 전후 비교표, 판정 기준, 다음 액션까지 모든 구조가 완비되어 있습니다.

특히 v2 종료 보고서인 `v2-closeout.md`는 151줄에 걸쳐 프로젝트 전체의 성과와 한계를 정리했습니다. 4개 스프린트 중 측정 정밀도 개선(Sprint 1)과 Lock Bleed 검증(Sprint 3 일부)은 완료했지만, Redis 튜닝(Sprint 2)과 관측 가능성(Sprint 3 나머지)은 아직 실험 결과 대기 상태입니다.

흥미로운 점은 이미 **구조적 한계**에 대한 가능성을 열어두고 있다는 것입니다. 만약 튜닝3에서도 99% 성공률을 달성하지 못한다면, concurrency=200에서의 Redis 분산락은 구조적 한계가 있다고 판정하고 권장 concurrency 수준을 문서화할 예정입니다.

## 성능 벤치마킹 프로젝트의 교훈

지금까지 LockBench v2를 통해 얻은 핵심 성과들을 보면, 단순한 성능 측정을 넘어서 **실제 운영에서 만날 수 있는 함정들**을 하나씩 발견해온 과정이었습니다.

가장 임팩트 있었던 발견은 **PESSIMISTIC_LOCK의 Lock Bleed 현상**입니다. SELECT FOR UPDATE로 인한 커넥션 장기 점유가 읽기 전용 API까지 차단시키는 현상을 p95 latency 30초, 실패율 20%로 정량화했습니다. 또한 Redis 분산락에서 **full-jitter backoff 구현 버그**를 찾아내어 처리량을 2배 향상시킨 것도 의미있는 성과였습니다.

## 마지막 실험을 앞두고

이제 남은 것은 실제 실험 실행입니다. JFR 분석을 통해 PESSIMISTIC_LOCK의 JVM 내부 대기 패턴을 관찰하고, MySQL slow query log와 연계하여 전체 스택의 병목 지도를 완성할 예정입니다. Redis 튜닝3 결과에 따라서는 VIRTUAL 스레드 환경에서 분산락의 권장 concurrency 가이드라인도 제시할 수 있을 것입니다.

LockBench v2는 곧 막을 내리지만, 여기서 얻은 인사이트들은 v3 로드맵의 토대가 될 것입니다. CI 자동화부터 분산 환경 실험까지, 아직 탐구할 영역이 많이 남아있습니다. 성능 벤치마킹이 단순한 숫자 비교가 아니라, 시스템의 한계와 특성을 깊이 이해하는 과정이라는 것을 보여주는 프로젝트였습니다.