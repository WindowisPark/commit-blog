---
title: "AI 기사 자동생성에서 품질 관리까지: 이종 모델 조합으로 편향 제거하기"
description: "Claude로 기사를 생성하고 Gemini로 품질을 판독하는 이종 AI 시스템을 구축하여 self-critique 편향을 해결하고, 통신사 재배치 문제까지 차단한 개발 과정을 소개합니다."
pubDate: 2026-04-21
repo: newsroom-ai
repoDisplayName: Newsroom AI
tags: ["newsroom-ai", "feature", "python", "react"]
commits: ["fc9fa79c7750e845cfde1c020c812a86bee3a285", "e4800527abf3e7d16d8c80ddef363a55d4a06450"]
---
## 문제의 시작: AI가 AI를 평가할 때의 함정

**Newsroom AI** 프로젝트를 진행하며 흥미로운 문제에 직면했다. Claude Sonnet으로 생성한 기사를 같은 모델로 검토하게 하면, 자신이 만든 결과물에 대해 너무 관대한 평가를 내리는 **self-critique 편향**이 발생했다. 마치 자신의 글을 스스로 검토할 때 실수를 놓치기 쉬운 것과 비슷한 현상이었다.

더 심각한 문제도 있었다. 사용자 시연 중 "연합뉴스에 따르면"이 반복되는 **wire redistribution** 수준의 초안이 품질 검증을 통과하는 경우가 발생했다. 이는 통신사 기사를 단순 재배열한 수준으로, 언론사의 독자적 보도 가치가 없는 콘텐츠였다.

## 이종 모델 조합: 생성과 판독의 분리

해결책은 **이종(heterogeneous) judge** 시스템이었다. 생성은 **Claude Sonnet**이, 품질 판독은 **Gemini 3 Flash**가 담당하도록 역할을 분리했다. 서로 다른 회사, 다른 학습 데이터를 가진 모델이 독립적으로 평가하게 함으로써 편향을 제거할 수 있었다.

```python
# 초안 생성 후 즉시 이종 judge 호출
quality_review = await review_draft(draft_dict)
review_result = await review_draft(draft_dict)
quality_review = review_result["review"]
review_model = review_result["model_used"]  # gemini-3-flash-preview
```

**Gemini 3 Flash**를 선택한 이유는 구조화된 출력(Structured Output)을 안정적으로 지원하면서도, 판단의 정교함이 뛰어났기 때문이다. 6개 축(리드 강도, 6하원칙, 역피라미드 구조, 톤 일관성, 인용 정책, 사실 구체성)으로 기사를 평가하고 publish/revise/reject 추천을 내리도록 설계했다.

## 통신사 의존도 차단: 7번째 평가 축 추가

단순한 이종 판독만으로는 부족했다. "이 대통령"을 "이준석"으로 확장하는 엔티티 할루시네이션과 통신사 재배열 문제를 근본적으로 차단해야 했다.

먼저 **source dependency**를 7번째 평가 축으로 추가했다. 동일 매체명이 3회 이상 반복되고 자사 관점이 없으면 4점 이하로 자동 평가하여 reject 처리한다.

```python
def _check_source_diversity(articles: list[Article]) -> None:
    agency_ratio = tier_counts["agency"] / total
    own_count = tier_counts["own"]
    
    if agency_ratio >= 0.7 and own_count == 0:
        raise ValueError(
            f"소스 다양성 부족 — 통신사/외신 비중 {int(agency_ratio * 100)}%, "
            f"자사 기사 0건. 자사 취재 없이 통신사만 재배열하는 wire-redistribution "
            f"위험이 큽니다."
        )
```

엔티티 추출에서는 **원문 등장 문자열만** 사용하도록 제약을 강화했다. "이 대통령", "김 장관" 같은 성씨+직책 조합을 임의로 풀네임으로 확장하는 것을 금지하고, 학습 시점 이후 인물에 대한 추측도 차단했다.

## 사용자 경험: 3단계 진행 표시로 대기시간 체감 단축

백엔드의 복잡성을 프론트엔드에서는 직관적으로 표현했다. 초안 생성(5-15초)과 품질 판독(3-8초)을 합쳐 최대 20초 이상의 대기시간이 발생하는데, 이를 **3단계 진행 표시**로 해결했다.

```typescript
const [loadingStep, setLoadingStep] = useState<0 | 1 | 2>(0);

// 1단계: 초안 생성 중
// 2단계: 품질 판독 중  
// 3단계: 완료
```

사용자는 현재 어떤 작업이 진행되는지 알 수 있고, 6축 점수를 바 형태로 시각화하여 AI 평가 결과를 한눈에 파악할 수 있다. critical issues와 suggested revisions도 별도 블록으로 구분해 실용성을 높였다.

## graceful degradation: 판독 실패에도 초안은 보존

시스템의 안정성을 위해 **graceful degradation** 패턴을 적용했다. Gemini 판독이 실패해도 Claude가 생성한 초안은 그대로 사용자에게 전달된다.

```python
try:
    review_result = await review_draft(draft_dict)
    quality_review = review_result["review"]
except Exception as e:
    logger.warning(f"Draft 판독 실패 (초안은 유지): {e}")
    quality_review = None
```

이는 AI 시스템에서 중요한 설계 철학이다. 핵심 기능(초안 생성)은 보장하면서, 부가 기능(품질 판독)의 실패가 전체 워크플로우를 중단시키지 않도록 하는 것이다.

## 결과와 의미

이종 모델 조합을 통해 두 가지 핵심 문제를 해결했다. 첫째, self-critique 편향을 제거하여 더 객관적인 품질 평가가 가능해졌다. 둘째, 통신사 의존도 체크로 wire redistribution을 사전 차단하여 언론사의 독자적 보도 가치를 보장할 수 있게 되었다.

무엇보다 **fact_check(규칙 기반)과 HITL(사람) 사이의 편집 품질 게이트 공백**을 메울 수 있었다. AI가 AI를 견제하는 시스템을 통해 완전 자동화와 완전 수동 검토 사이의 적절한 균형점을 찾은 것이다.

현재 이 시스템은 프로덕션에서 안정적으로 동작하며, 편집진의 워크플로우에 자연스럽게 통합되어 있다. AI 저널리즘의 품질 관리에서 이종 모델 조합이 하나의 유효한 패턴임을 입증한 사례라고 생각한다.