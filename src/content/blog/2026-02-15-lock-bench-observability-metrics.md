---
title: "동시성 성능 벤치마킹 도구에 모니터링과 메트릭 시각화 구축하기"
description: "LockBench 프로젝트에 Micrometer, Prometheus, Grafana를 연동해 실시간 벤치마크 메트릭 모니터링 시스템을 구축한 과정을 소개합니다."
pubDate: 2026-02-15
repo: lock-bench
repoDisplayName: LockBench
tags: ["lock-bench", "feature"]
commits: ["8cf00770a5e8b3a0d1765ff0f09325795a16a244"]
---
## 프로젝트 배경: 동시성 성능을 어떻게 관측할 것인가

동시성 제어 메커니즘들의 성능을 비교하는 **LockBench** 프로젝트에서 가장 중요한 것은 실험 결과를 정확하게 측정하고 시각화하는 것입니다. 단순히 로그로 결과를 출력하는 것만으로는 실시간 성능 추이를 파악하기 어렵고, 여러 실험을 동시에 비교 분석하는 데 한계가 있었습니다.

이번에는 **Spring Boot Actuator**, **Micrometer**, **Prometheus**, **Grafana**를 활용해 실시간 모니터링 시스템을 구축한 과정을 정리해보겠습니다. 특히 동시성 벤치마크의 특성상 TPS, 응답시간, 실패율 등을 스레드 모델과 락 전략별로 세분화해서 관측할 수 있도록 설계했습니다.

## 메트릭 수집 아키텍처 설계

먼저 어떤 메트릭들을 수집해야 할지 정의했습니다. 동시성 성능 벤치마크에서는 단순한 요청 수뿐만 아니라 스레드 모델(`thread_model`)과 락 전략(`lock_strategy`)별로 성능을 비교할 수 있어야 합니다.

```java
@Component
public class ExperimentMetricsRecorder {
    private final Counter experimentRunCount;
    private final Counter requestSuccessCount;
    private final Counter requestFailureCount;
    private final Timer elapsedTimer;
    private final DistributionSummary throughputSummary;
    
    public ExperimentMetricsRecorder(MeterRegistry meterRegistry) {
        this.experimentRunCount = Counter.builder("lockbench.experiment.run.count")
            .description("Total experiment runs")
            .register(meterRegistry);
        // 다른 메트릭들도 유사하게 등록
    }
    
    public void recordExperimentRun(String threadModel, String lockStrategy, 
                                  ExperimentResult result) {
        experimentRunCount.increment(
            Tags.of("thread_model", threadModel, "lock_strategy", lockStrategy)
        );
        // 성공/실패 카운트, 소요시간, 처리량 등을 기록
    }
}
```

**Micrometer**의 장점은 메트릭 이름을 자동으로 Prometheus 형식으로 변환해준다는 점입니다. `lockbench.experiment.run.count`는 `lockbench_experiment_run_count_total`로 자동 변환되어 Prometheus에서 수집됩니다.

## 실험 결과 추적을 위한 Run ID 시스템

벤치마크 실행 중에 특정 실험의 상세 결과를 조회할 수 있도록 **Run ID 기반 조회 시스템**을 구축했습니다. 메트릭만으로는 개별 실험의 세부 정보를 파악하기 어렵기 때문입니다.

```java
@RestController
public class ExperimentController {
    private final RunResultStore runResultStore;
    
    @GetMapping("/api/experiments/runs/{runId}")
    public ExperimentRunSnapshot getExperimentRun(@PathVariable String runId) {
        return runResultStore.getExperimentRun(runId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
    
    @GetMapping("/api/experiments/matrix-runs/{matrixRunId}")
    public MatrixRunSnapshot getMatrixRun(@PathVariable String matrixRunId) {
        return runResultStore.getMatrixRun(matrixRunId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
}
```

**InMemoryRunResultStore**를 구현해서 최근 실행된 실험 결과들을 메모리에 보관하고, 설정 가능한 크기 제한(`lockbench.run-store.max-size`)을 통해 메모리 사용량을 관리합니다. 이렇게 하면 Grafana에서 이상 패턴을 발견했을 때, 해당 시점의 실험 세부 정보를 API로 조회해서 원인을 분석할 수 있습니다.

## Prometheus 쿼리 최적화와 Grafana 대시보드

동시성 성능 메트릭의 특성상 **레이트 기반 계산**이 중요합니다. 단순한 누적 카운터보다는 분당 처리량, 실패율, 평균 응답시간 등을 실시간으로 계산해야 합니다.

특히 실패율 계산에서는 0으로 나누기 오류를 방지하기 위해 `clamp_min` 함수를 활용했습니다:

```promql
100 * 
sum by (thread_model, lock_strategy) (rate(lockbench_experiment_request_failure_count_total[1m]))
/
clamp_min(
  sum by (thread_model, lock_strategy) (
    rate(lockbench_experiment_request_success_count_total[1m]) +
    rate(lockbench_experiment_request_failure_count_total[1m])
  ),
  1e-9
)
```

Grafana 대시보드에서는 `thread_model`과 `lock_strategy` 템플릿 변수를 제공해서 특정 조합만 필터링해서 볼 수 있도록 했습니다. 이렇게 하면 "Virtual Thread + ReentrantLock vs Platform Thread + Synchronized" 같은 구체적인 비교 분석이 가능합니다.

## 운영 관점에서의 고려사항

실제 벤치마크를 실행하면서 몇 가지 운영상 고려해야 할 점들을 발견했습니다.

메모리 기반 결과 저장소의 경우 애플리케이션 재시작 시 기존 데이터가 사라지는 문제가 있지만, 벤치마크 도구의 특성상 영구 보관보다는 실시간 분석이 더 중요하다고 판단했습니다. 대신 저장소 크기를 설정으로 관리할 수 있게 해서 메모리 사용량을 제어할 수 있도록 했습니다.

또한 Prometheus 스크래핑 주기와 Grafana 새로고침 주기(10초)를 고려해서 메트릭 계산 구간을 조정했습니다. 너무 짧은 구간은 노이즈가 많고, 너무 긴 구간은 실시간성이 떨어지기 때문에 1분(처리량)과 5분(평균값) 구간을 적절히 혼합해서 사용했습니다.

## 다음 단계: 고도화된 분석 기능

현재 구축한 모니터링 시스템은 실시간 성능 추이를 파악하는 기본 기능을 제공합니다. 향후에는 성능 임계값 기반 알림, 실험 간 성능 회귀 탐지, 히트맵을 통한 성능 분포 시각화 등을 추가할 계획입니다.

특히 동시성 제어 메커니즘별 성능 특성이 워크로드에 따라 크게 달라질 수 있기 때문에, 다양한 시나리오별 성능 프로파일을 자동으로 생성하고 비교할 수 있는 기능이 필요할 것 같습니다.