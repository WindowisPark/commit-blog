---
title: "AI 뉴스룸에 3-Provider 판독 시스템과 기자 워크플로우 구축하기"
description: "Claude Haiku/Sonnet과 Gemini Flash를 조합한 이종 판독 시스템과 AI 초안 작성부터 워치리스트까지, 실제 편집국 관행을 반영한 뉴스룸 자동화 구현기"
pubDate: 2026-04-21
repo: newsroom-ai
repoDisplayName: Newsroom AI
tags: ["newsroom-ai", "docs"]
commits: ["6e8dccf011a368436db83cef896541fbbc03ad69", "4fcac234f6e8570ccf860f01814b2a13829eb630", "f5050276c15f5b22afba9ab2d4b6c915d2c4d0fa", "9d299c1d831c850b1a78c10c6dc7e0b034a36690"]
---
## 프로젝트의 진화: 분석에서 실제 기자 워크플로우까지

**Newsroom AI** 프로젝트가 흥미로운 방향으로 진화하고 있습니다. 단순히 뉴스를 수집하고 분석하는 것을 넘어서, 실제 편집국에서 기자들이 사용할 수 있는 완전한 워크플로우를 구현했습니다. 특히 최근 커밋에서는 **3-provider 차등 배치**와 **이종 판독 시스템**이라는 독특한 접근법을 도입했는데, 이는 AI 편향을 제거하면서도 비용을 최적화하는 정교한 설계입니다.

## 3-Provider 차등 배치: 각각의 역할이 있는 AI 조합

가장 인상적인 기술적 결정은 **Claude Haiku, Claude Sonnet, Google Gemini**를 복잡도에 따라 차등 배치한 점입니다. 단순히 하나의 모델로 모든 작업을 처리하는 대신, 각 단계의 특성에 맞는 최적의 모델을 선택했습니다.

```python
# 3단계 차등 배치 전략
- Claude Haiku 4.5: 기사 1차 분류, Korean→English 키워드 번역
- Claude Sonnet 4.6: 의제 도출, 관점 비교, 기사 초안 생성
- Gemini 3 Flash: 초안 품질 판독 (이종 judge)
```

이 설계의 핵심은 **생성과 판독을 서로 다른 회사 모델로 분리**한 것입니다. Sonnet이 작성한 기사 초안을 Gemini가 7축으로 평가하는 구조로, 자가평가 편향(self-critique bias)을 원천적으로 차단합니다.

## 이종 판독 시스템: AI의 AI 검증

특히 주목할 만한 것은 **L4' 품질 판독** 단계입니다. 기사 초안이 생성된 직후 Gemini가 자동으로 7축 평가를 수행합니다:

- 리드 강도, 6하원칙, 역피라미드 구조
- 톤, 인용정책, 사실 구체성
- **자사 독자성** (가장 중요한 평가 기준)

```python
# graceful degradation 구현
# Gemini 실패 시에도 초안 생성은 계속 진행
if gemini_review_failed:
    return ArticleDraft(
        content=draft_content,
        quality_review=None  # 판독 실패해도 초안은 유지
    )
```

이런 **graceful degradation** 설계로 판독 시스템이 장애를 일으켜도 핵심 플로우는 중단되지 않습니다.

## 편집국 관행을 코드로 구현하기

시스템 설계에서 가장 인상 깊은 부분은 실제 편집국의 관행을 알고리즘으로 녹여낸 점입니다.

**매체 수 기반 중요도 보정**이 대표적입니다. "주요 이슈는 여러 매체가 교차 보도한 사안"이라는 편집국 철칙을 다음과 같이 구현했습니다:

```python
# L1.5 부스팅 로직
keyword_media_count = defaultdict(set)
for analysis in daily_analyses:
    for keyword in analysis.keywords:
        keyword_media_count[keyword].add(analysis.article.source_name)

# 매체 수에 따른 중요도 가산
for keyword, media_set in keyword_media_count.items():
    boost = min(len(media_set) - 1, 3) * 0.7  # 2곳 +0.7, 3곳 +1.4, 4+곳 +2.0
```

또한 **wire-redistribution** 위험을 방지하기 위해 입력단 가드를 구현했습니다. 통신사 기사가 70% 이상이고 자사 기사가 0건인 경우 400 에러로 차단하여, 단순 재배포성 기사 생성을 방지합니다.

## 기자를 위한 실제 액션 UX

기술적 완성도만큼 중요한 것은 **기자가 실제로 사용할 수 있는 인터페이스**입니다. 최근 UX 확장에서는 분석-판단 루프를 **생성-행동** 단계까지 연결했습니다.

**F3 AI 기사 초안 생성**이 핵심 기능입니다. 기자가 뉴스 상세 페이지나 의제 카드에서 "초안 작성" 버튼을 클릭하면, 다음과 같은 완성된 결과물을 받을 수 있습니다:

- 제목 후보 3안
- 역피라미드 구조의 리드 문단
- 6하원칙 자체 점검 결과
- 매체별 인용 정책이 적용된 본문

```typescript
// 진입점별 차별화된 데이터 전달
const draftRequest = {
  article_ids: selectedArticles,
  style: 'straight',  // straight/analysis/feature
  topic_hint: selectedHeadline  // 맥락 힌트
};
```

## RAG와 실시간 성능 최적화

대량 뉴스 데이터를 실시간으로 처리하면서도 응답성을 유지하는 것은 쉽지 않은 도전입니다. 이 프로젝트는 **SQL 레벨 사전 필터링 + Python 재랭킹** 하이브리드 구조로 이를 해결했습니다.

```python
# drafter._retrieve_by_tier 최적화
# 1단계: SQL에서 200건 이하로 축소
candidates = await db.execute(
    select(Article)
    .where(Article.source_name.in_(tier_sources))
    .where(Article.created_at >= recent_threshold)
    .where(Article.keywords.has_any(topic_keywords))  # JSONB GIN 인덱스 활용
    .limit(200)
)

# 2단계: Python에서 의미적 재랭킹
ranked = semantic_rerank(candidates, query_context)
```

**GIN 인덱스**를 `keywords` JSONB 컬럼에 구성하여, 수만 건 규모에서도 LLM 호출 시간 대비 검색 지연을 무시할 수 있는 수준으로 최적화했습니다.

## 비용 추적과 관측성

프로덕션 환경을 고려한 **비용 투명성**도 인상적입니다. 모든 LLM 호출에 대해 토큰 사용량을 추적하고, 모델별로 분리하여 저장합니다:

```sql
-- 일일 LLM 비용 집계 쿼리 예시
SELECT 
  DATE(created_at) as date,
  'haiku' as model,
  SUM(prompt_tokens + completion_tokens) as total_tokens
FROM article_analyses 
UNION ALL
SELECT 
  DATE(generated_at),
  'sonnet',
  SUM(prompt_tokens + completion_tokens)
FROM briefing_reports;
```

## 확장성을 고려한 아키텍처 설계

현재는 APScheduler 기반의 단일 프로세스 구조이지만, 프로덕션 전환을 위한 확장 경로가 명확히 제시되어 있습니다. **Redis + ARQ/Celery** 기반 분산 워커 구조로 전환하면 대선이나 재난 같은 뉴스 폭증 상황에도 대응할 수 있습니다.

무엇보다 **entity_kb 자동 갱신**, **외부 채널 연동**, **멀티워커 blocklist 공유** 등 실제 운영에서 마주칠 이슈들을 미리 고려한 설계가 돋보입니다.

## 마무리: AI 도구의 협업 방식

이 프로젝트에서 특히 인상 깊은 것은 **AI 도구 사용 내역**을 명확히 구분한 점입니다. 런타임에서 실제 서비스 기능을 담당하는 Haiku/Sonnet/Gemini와, 개발 과정에서 도움을 준 Claude Code를 명확히 분리하여 기술했습니다.

결국 좋은 AI 시스템은 단일 모델의 성능이 아니라, **각 모델의 특성을 이해하고 적재적소에 배치하는 시스템 설계**에서 나온다는 것을 보여주는 사례입니다. 3-provider 차등 배치, 이종 판독, 편집국 관행 반영까지 - 기술적 완성도와 실용성을 모두 갖춘 프로젝트라고 할 수 있겠습니다.