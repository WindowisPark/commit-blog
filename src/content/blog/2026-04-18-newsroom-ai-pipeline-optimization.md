---
title: "뉴스룸 AI 파이프라인 품질 개선: 주요 이슈 판별부터 속보 감지까지"
description: "LLM 출력 검증 강화, 키워드 매칭 오탐 제거, 매체 교차 보도 기반 중요도 보정을 통한 AI 뉴스 분석 시스템 고도화"
pubDate: 2026-04-18
repo: newsroom-ai
repoDisplayName: Newsroom AI
tags: ["newsroom-ai", "refactoring", "python", "bugfix", "feature", "react"]
commits: ["34fc8513c66efd85d6793a823ce66bb64c1f6ec8", "2f04714ba60687d705536eb79198dc195aee58d1", "5d70cded0527b127bd19e1bb799cf735fa4c645d", "36e86f0b63d84d341438071aa458cd52604ac27e", "cb6a12f18a63f5d803ae0053a591f4a799ea6cec", "ddee989b83b2927ebd881e51ea5f9aad1ade6e18", "389fcc1aabe8d3c88131198075ca9b9103480d0c", "8f6302a5be8cc95b227768d427f13d597af96803"]
---
## 품질 개선의 핵심: 데이터 검증과 의제 판별 정확도 향상

**Newsroom AI** 프로젝트에서 가장 중요한 업데이트가 이루어졌습니다. 주요 이슈 판별 품질을 대폭 개선하고, LLM 출력에 대한 체계적인 검증 시스템을 도입했습니다. Sonnet 4.6 모델 업데이트와 함께 **Pydantic 스키마 검증**, **키워드 매칭 오탐 제거**, **교차 매체 기반 중요도 보정** 등 핵심 개선사항들이 적용되었습니다.

## LLM 출력 검증 시스템 구축

AI 뉴스 분석에서 가장 치명적인 문제는 **잘못된 형식의 LLM 응답**이 파이프라인을 중단시키는 것입니다. 이를 해결하기 위해 `schemas.py`에 **Pydantic 기반 검증 시스템**을 새로 구축했습니다.

```python
class ClassificationOut(BaseModel):
    category: Category  # Literal로 7개 카테고리 강제
    keywords: list[str] = Field(min_length=1, max_length=10)
    entities: list[EntityOut] = Field(default_factory=list)
    sentiment: Sentiment  # positive/negative/neutral 강제
    importance_score: float = Field(ge=1.0, le=10.0)  # 1~10 범위 검증
```

이제 LLM이 잘못된 카테고리를 반환하거나 중요도 점수를 문자열로 보내면 **즉시 ValidationError**가 발생합니다. 기존에는 런타임에서 조용히 실패하던 케이스들을 사전에 차단할 수 있게 되었습니다.

## 키워드 매칭 정확도 개선: "정" 키워드 오탐 해결

의제 분석에서 심각한 문제가 발견되었습니다. "정"이라는 1글자 키워드가 "정치", "정부", "정책" 기사를 모두 매칭하면서 **article_count와 source_count가 부풀려지는 현상**이었습니다.

```python
def _title_contains(title: str, kw: str) -> bool:
    """제목에 키워드가 '의미 있게' 포함되는지 판정"""
    if not kw:
        return False
    if kw.isascii():
        # 영숫자는 단어 경계 매칭
        return bool(re.search(rf"(?<![A-Za-z0-9]){re.escape(kw)}(?![A-Za-z0-9])", title))
    if len(kw) < 3:
        return False  # 한글 2자 이하는 substring 금지
    return kw in title
```

이제 **한글 키워드는 3자 이상**일 때만 제목 매칭을 허용하고, **영숫자 키워드는 단어 경계**를 확인합니다. "AI"는 "AI 혁신"에서 매칭되지만 "TRAINED"의 일부는 아닙니다.

## 본문 절단 방식 개선: 결론부 정보 유실 방지

기존에는 뉴스 본문을 **앞 1000자만** 잘라서 LLM에 전달했습니다. 하지만 한국 뉴스는 도입부에서 사실을 요약하고 **결론부에서 중요한 맥락이나 수치**를 제시하는 경우가 많습니다.

```python
def _truncate_content(content: str, limit: int = 1000) -> str:
    """긴 본문을 머리+꼬리 구조로 자른다"""
    if len(content) <= limit:
        return content
    head = int(limit * 0.6)  # 앞 600자
    tail = limit - head      # 뒤 400자
    return content[:head] + "\n…\n" + content[-tail:]
```

이제 **앞 60% + 뒤 40%** 방식으로 본문을 보존하여 도입부와 결론부 정보를 모두 활용할 수 있습니다.

## 교차 매체 기반 속보 감지 시스템

단독 기사의 자극적인 헤드라인이 속보로 승격되는 **오탐 문제**를 해결하기 위해 교차 매체 조건을 도입했습니다.

```python
# 속보 감지: 높은 중요도(>=8.5) + 다수 매체(>=2곳) 공통 보도만 속보로 간주
breaking = [
    a for a in analyses
    if a.importance_score >= 8.5 and getattr(a, "_source_count", 1) >= 2
]
```

이제 **2개 이상의 매체가 공통으로 보도한 사안**만 속보로 인정합니다. 편집국 관행상 주요 이슈는 여러 매체의 교차 보도로 판단하기 때문에, 이는 실제 언론 업무와 일치하는 접근입니다.

## 매체 수 기반 중요도 보정의 재설계

기존의 배치 로컬 빈도 집계를 **하루 전체 DB 기준 매체 수 집계**로 변경했습니다. 시간이 지나면서 누적되는 consensus가 점수에 반영되도록 개선된 것입니다.

```python
# 오늘 DB 전체에서 각 키워드를 보도한 고유 매체 수 집계
stmt = (
    select(ArticleAnalysis.keywords, Article.source_name)
    .join(Article, Article.id == ArticleAnalysis.article_id)
    .where(func.date(Article.collected_at) == today)
)
# 매체 2곳: +0.7, 3곳: +1.4, 4+곳: +2.0
boost = min(2.0, max(0, max_src - 1) * 0.7)
```

동일한 키워드를 **3개 매체가 보도하면 +1.4점**, **4개 이상이면 +2.0점**의 보정이 적용됩니다. 이를 통해 진짜 주요 이슈와 단발성 기사를 구분할 수 있습니다.

## 단위 테스트 15개 추가로 안정성 확보

이번 개선과 함께 **15개의 새로운 단위 테스트**를 추가하여 총 69개의 테스트가 모두 통과하는 상태를 유지했습니다. 특히 스키마 검증, 키워드 매칭, 본문 절단 로직에 대한 엣지 케이스들을 철저히 검증했습니다.

이러한 개선을 통해 **Newsroom AI**는 단순한 뉴스 수집 도구에서 편집국이 신뢰할 수 있는 의사결정 지원 시스템으로 진화하고 있습니다. 다음 단계에서는 이 고도화된 파이프라인을 바탕으로 실시간 대시보드와 브리핑 자동 생성 기능을 더욱 정교하게 다듬어 나갈 예정입니다.