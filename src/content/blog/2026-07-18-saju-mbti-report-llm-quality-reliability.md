---
title: "운영 첫날 터진 LLM 품질 게이트 버그, 3가지 원인을 한 번에 잡다"
description: "사주 MBTI 리포트 서비스의 첫 프리미엄 결제 2건이 모두 백업 템플릿으로 떨어졌다. 품질 게이트, 캐시 전략, 스키마 설계의 숨어 있던 문제를 운영 데이터로 추적해 수정한 기록."
pubDate: 2026-07-18
repo: saju-mbti-report
repoDisplayName: 사주 MBTI 리포트
tags: ["saju-mbti-report", "bugfix"]
commits: ["b668a7176315962172a4ea4d364e190185b847d6", "34881eebb7acfd55fcf4cc9bf2a2015a4d0f7e41", "a24254f1813d505dd8ad916919e2f09fd952b25a"]
---
## 첫 프리미엄 결제가 백업 템플릿으로

서비스를 오픈하자마자 운영 로그에 `failed_fallback`이 찍혔다. 첫 프리미엄 결제 2건 모두였다. LLM이 생성한 본문이 품질 게이트를 통과하지 못하면 미리 만들어 둔 백업 템플릿으로 대체되는 구조인데, 돈을 낸 사용자가 템플릿을 받아 간 것이다.

로그를 뜯어보니 원인은 `repetition` — 같은 단어가 섹션 안에서 5회 이상 나왔다는 판정이었다. 그런데 실제 텍스트를 보면 주제어가 자연스럽게 반복된 수준이었다. 250~700자짜리 섹션에서 고정 4회 초과 즉시 탈락은 너무 가혹한 기준이었다.

## 버그 1: 반복어 임계값이 섹션 길이를 무시했다

700자 섹션과 250자 섹션에 동일한 4회 한도를 적용하는 건 맞지 않는다. 주제를 다루는 글이면 핵심 단어가 자연스럽게 여러 번 나온다. 수정은 간단하다.

```typescript
const maxRepetition = Math.max(MIN_WORD_REPETITION_ALLOWANCE, Math.ceil(o[k].length / 100));
```

100자당 1회, 최소 4회로 스케일한다. 700자 섹션은 7회까지 허용된다. 품질 기준을 낮추는 게 아니라 섹션 길이에 맞게 조정하는 것이다.

## 버그 2: 게이트 탈락 시 재시도가 없었다

temperature 0으로 생성하기 때문에 같은 프롬프트로 재호출하면 같은 출력이 나온다. 탈락 즉시 백업으로 가던 기존 코드는 재시도를 포기한 구조였다.

해결책은 탈락 사유를 프롬프트에 명시해서 입력 자체를 바꾸는 것이다. `buildGateCorrectionNote`가 게이트 탈락 사유를 받아 구체적인 재작성 지시문을 만들고, 이걸 프롬프트 끝에 붙여 1회 재시도한다.

```typescript
async function generateWithGateRetry<T>(opts: { ... }): Promise<T | null> {
  let result = await opts.generate();
  let gate = opts.runGate(result.object);
  if (gate.ok) return result.object;

  // 탈락 사유를 프롬프트에 붙여 재시도
  result = await opts.generate(buildGateCorrectionNote(gate.reason, gate.detail));
  gate = opts.runGate(result.object);
  if (gate.ok) return result.object;

  return null; // 두 번 다 탈락 → 백업 처리
}
```

그런데 첫 운영 재시도 로그에서 두더지잡기가 포착됐다. 1차에서 `repetition`으로 탈락 → 교정 재시도가 반복은 고쳤지만 이번엔 `abstract_jargon`('결' 사용)으로 2차 탈락. 모델이 지적받은 문제를 고치는 데 집중하다 다른 규칙을 어긴 것이다.

이 문제는 교정 지시문에 전체 검사 항목 체크리스트를 항상 덧붙이는 방식으로 해결했다. 반복어, 금지어, 추상 명사 '결', 용어 수 제한, MBTI 코드 노출 — 5개 항목을 매번 상기시킨다.

## 버그 3: 백업이 캐시되면 영구히 백업만 반환

캐시는 생년월일 등 입력값으로 canonical key를 만든다. 백업 본문이 이 키로 캐시되면, 이후 같은 입력으로 결제하는 사람은 캐시 히트로 영구히 백업만 받게 된다. 재결제해도 마찬가지다.

수정은 단 한 줄의 조건이다.

```typescript
// 백업 본문은 캐시하지 않는다 — 캐시하면 같은 입력이 영구히 백업만 받게 됨.
if (!usedBackup) {
  await setCached(canonicalKey, llmOutput, { ... });
}
```

게이트를 통과한 본문만 캐시한다.

## 스키마 상한이 너무 좁았던 문제도 운영에서 발견됐다

며칠 후 또 다른 운영 사례가 생겼다. `AI_NoObjectGeneratedError: response did not match schema`. 프롬프트는 "길고 구체적으로"를 요구하는데, Zod 스키마의 max가 600/700자 하드캡이라 모델이 목표를 조금만 넘기면 청크 전체가 죽었다.

max를 프롬프트 목표의 1.5배 버퍼(600→900, 700→1050)로 완화했다. min(품질 바닥)과 게이트(품질 통제)는 유지하고, 스키마는 하드 실패를 막는 용도로만 쓴다.

동시에 `NoObjectGeneratedError` 발생 시 Zod issue 요약과 필드별 실제 길이를 로깅하는 진단 코드도 추가했다. `generateStructured` 함수 한 곳에 추가하면 모든 LLM 경로가 커버된다.

## 운영 데이터가 테스트를 만든다

이번 수정에서 가장 인상적인 부분은 모든 버그가 실제 운영 로그에서 발견됐다는 것이다. 반복어 임계값 문제, 두더지잡기 재시도 실패, 스키마 하드캡까지 — 사전에 설계 단계에서 잡기 어려운 종류의 버그들이었다.

각 수정마다 그 운영 사례를 재현하는 테스트가 추가됐다. "gate FAIL twice → 1회 재시도 후 backup + 백업 미캐시", "gate FAIL then retry PASS → status=ready" 같은 테스트 이름이 그 흔적이다. 운영 데이터가 테스트 케이스의 명세가 되는 과정이다.