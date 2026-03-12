---
title: "동시성 처리 성능 테스트 자동화: k6와 PowerShell로 구현한 Matrix Runner"
description: "LockBench 프로젝트에서 4가지 락 전략과 2가지 스레드 모델을 자동으로 조합 테스트하는 k6 스크립트와 결과 분석 시스템을 구축한 이야기"
pubDate: 2026-02-16
repo: lock-bench
repoDisplayName: LockBench
tags: ["lock-bench", "feature", "docs"]
commits: ["3e5ea8b69f2065295b53af61922a1d572eb185e5", "2dfe4ec75d6a062d2a0181d744cc946bf2aeb616"]
---
## 성능 테스트 자동화의 필요성

대용량 트래픽 환경에서 동시성 제어는 핵심적인 기술 과제입니다. **LockBench** 프로젝트에서는 네 가지 락 전략(NO_LOCK, OPTIMISTIC_LOCK, PESSIMISTIC_LOCK, REDIS_DISTRIBUTED_LOCK)과 두 가지 스레드 모델(PLATFORM, VIRTUAL)의 성능을 비교 분석해야 했습니다. 총 8가지 조합을 반복 실행하며 신뢰할 수 있는 성능 데이터를 수집하는 것이 목표였죠.

수동으로 각 조합을 테스트하기에는 너무 많은 시간이 소요되고 실수 가능성도 높았습니다. 이를 해결하기 위해 **k6 부하 테스트 도구**와 **PowerShell 자동화 스크립트**를 활용한 매트릭스 러너를 구축했습니다.

## k6 공통 라이브러리 설계

먼저 재사용 가능한 k6 라이브러리를 만들어 코드 중복을 줄이고 일관성을 확보했습니다.

```javascript
export function postExperiment(overrides = {}) {
  const payload = { ...defaultExperimentPayload(), ...overrides };
  const res = http.post(
    `${baseUrl()}/api/experiments/run`,
    JSON.stringify(payload),
    { headers: { "Content-Type": "application/json" } }
  );

  let parsed = null;
  try {
    parsed = res.json();
  } catch (e) {
    parsed = null;
  }

  check(res, {
    "status is 200": (r) => r.status === 200,
    "runId exists": () => parsed !== null && typeof parsed.runId === "string",
  });

  return { response: res, payload, parsed };
}
```

이 공통 함수는 환경변수를 통해 테스트 조건을 동적으로 변경할 수 있도록 설계했습니다. **threadModel**, **lockStrategy** 같은 핵심 파라미터를 외부에서 주입받아 다양한 시나리오에서 재사용할 수 있게 만들었죠.

## PowerShell 매트릭스 러너 구현

가장 핵심적인 부분은 8가지 조합을 자동으로 실행하는 PowerShell 스크립트입니다.

```powershell
$threads = @("PLATFORM", "VIRTUAL")
$locks = @("NO_LOCK", "OPTIMISTIC_LOCK", "PESSIMISTIC_LOCK", "REDIS_DISTRIBUTED_LOCK")

for ($repeat = 1; $repeat -le $Repeats; $repeat++) {
    foreach ($thread in $threads) {
        foreach ($lock in $locks) {
            $caseId = "$thread`__$lock`__R$repeat"
            $jsonPath = Join-Path $OutDir ($caseId + ".json")
            
            $args = @(
                "run",
                "-e", "THREAD_MODEL=$thread",
                "-e", "LOCK_STRATEGY=$lock",
                "-e", "TOTAL_REQUESTS=$TotalRequests",
                $scenarioPath
            )
            
            $process = Start-Process -FilePath "k6" -ArgumentList $args -Wait
        }
    }
}
```

이 스크립트는 각 조합을 순차적으로 실행하면서 **개별 JSON 파일**로 상세 결과를 저장하고, 마지막에 **aggregate.csv**와 **aggregate.json**으로 통합 분석 데이터를 생성합니다.

## 결과 파싱과 데이터 통합

실제 테스트를 실행해보니 예상치 못한 문제들이 발견되었습니다. k6 출력에서 API 응답 결과를 추출하는 부분에서 정규표현식 매칭이 복잡했고, **elapsedMillis=0** 같은 측정 정밀도 문제도 있었습니다.

```powershell
if ($resultMarker -match "LOCKBENCH_RESULT\s+(\{.*\})") {
    $resultJson = $matches[1]
    $resultJson = $resultJson -replace '\\"', '"'
    $result = $resultJson | ConvertFrom-Json
}
```

각 테스트 실행 후 API 응답 데이터를 파싱해서 **throughputPerSec**, **p95Millis** 같은 핵심 성능 지표를 CSV로 정리했습니다. 이를 통해 Excel이나 다른 분석 도구에서 바로 활용할 수 있는 형태로 데이터를 준비했죠.

## 첫 번째 배치 실행 결과

실제로 5회 반복, 3000 요청 조건으로 첫 번째 배치를 실행한 결과는 흥미로웠습니다:

- **PLATFORM 스레드**: NO_LOCK과 PESSIMISTIC_LOCK이 비슷한 성능(~35,000 req/s)
- **VIRTUAL 스레드**: NO_LOCK에서 최고 성능(~332,000 req/s)
- **REDIS_DISTRIBUTED_LOCK**: 설정 비활성화로 예상된 실패

하지만 **VIRTUAL + PESSIMISTIC_LOCK** 조합에서 처리량이 3,000~500,000 req/s로 극심하게 변동하는 현상을 발견했습니다. 이는 측정 정밀도 문제로 보이며, 향후 **elapsedNanos** 단위 측정이나 더 긴 테스트 시간이 필요함을 시사했습니다.

## 확장성과 유지보수성

이번 자동화 시스템의 핵심 가치는 **재현 가능한 성능 테스트 환경**을 구축했다는 점입니다. 새로운 락 전략이 추가되더라도 배열에 하나만 추가하면 자동으로 모든 조합이 테스트되고, 결과는 동일한 형식으로 수집됩니다.

또한 각 테스트 실행마다 **타임스탬프가 포함된 결과 디렉터리**를 생성하여 히스토리 관리가 용이하고, Git에서는 결과 파일을 제외하도록 .gitignore를 설정해 리포지터리를 깔끔하게 유지했습니다.

이제 성능 최적화 작업이 필요할 때마다 한 번의 명령으로 전체 조합을 테스트하고, 변경 사항의 영향을 정량적으로 분석할 수 있게 되었습니다. 이는 단순한 자동화를 넘어서 **데이터 기반 성능 튜닝**의 기반을 마련한 셈이죠.