---
title: "LLM 기반 뉴스룸 AI 시스템 개발기 - 수집부터 자동 분석까지"
description: "NewsAPI, Naver News API를 활용한 뉴스 수집과 Anthropic Claude의 멀티모델 파이프라인으로 의제설정·관점비교 분석을 자동화한 뉴스룸 AI 시스템 개발 과정을 공유합니다."
pubDate: 2026-04-17
repo: newsroom-ai
repoDisplayName: Newsroom AI
tags: ["newsroom-ai", "feature", "python", "react", "testing"]
commits: ["7a43f08b29783bf88079d7f58b3f2c3b749310e9", "5fa33c489d97bde15363ae7da2c083483f3e72cb", "39e688b73d64418e6e720b92f5e9539bd87bcad3"]
---
뉴스 편집실에서 매일 수백 건의 기사를 처리하며 핵심 의제를 파악하고 브리핑을 작성하는 일은 엄청난 시간과 노력이 필요합니다. 이런 반복적인 업무를 AI로 자동화하면 어떨까라는 생각에서 **Newsroom AI** 프로젝트를 시작했습니다.

## 시스템 아키텍처: 수집-분석-보고의 자동화 파이프라인

이 프로젝트의 핵심은 뉴스 수집부터 분석, 그리고 최종 보고까지 전체 과정을 자동화하는 것이었습니다. **FastAPI 백엔드**에서는 세 가지 주요 데이터 소스를 통해 뉴스를 수집합니다:

- **NewsAPI**: 글로벌 뉴스 매체의 실시간 헤드라인
- **Naver News API**: 국내 언론사의 최신 기사
- **RSS 피드**: 주요 언론사의 직접 피드

수집된 기사들은 PostgreSQL(Supabase)에 저장되며, URL 기반 중복 제거를 통해 데이터 품질을 유지합니다. **APScheduler**가 15분마다 이 전체 파이프라인을 실행하여 지속적으로 최신 뉴스를 확보합니다.

```python
async def collection_pipeline():
    """수집 → 1차분류 → 자동보고 파이프라인"""
    async with async_session() as db:
        # 1. 뉴스 수집 (NewsAPI + Naver + RSS)
        result = await collect_all(db)
        
        # 2. Haiku 4.5로 1차 분류 (카테고리/키워드/감성/중요도)
        new_articles = await fetch_unanalyzed_articles(db)
        analyses = await classify_batch(new_articles, db)
        
        # 3. 충분한 분석 데이터 확보시 Sonnet 4.6으로 자동 보고
        if get_settings().auto_report_enabled:
            await _auto_generate_reports(db)
```

## 멀티모델 LLM 전략: 효율성과 품질의 균형

뉴스 분석에서 가장 중요한 결정 중 하나는 **어떤 AI 모델을 언제 사용할 것인가**였습니다. 비용과 품질을 고려해 2단계 파이프라인을 설계했습니다:

**1차 분류 (Claude Haiku 4.5)**
- 빠르고 저렴한 모델로 기본 분류 수행
- 카테고리, 키워드, 감성, 중요도 점수 추출
- 대량의 기사를 실시간으로 처리하기에 적합

**2차 심화 분석 (Claude Sonnet 4.6)**
- 높은 품질의 분석이 필요한 작업에 사용
- 의제 설정 분석, 관점 비교, 브리핑 작성
- 1차 분석 결과를 바탕으로 선별된 기사들만 처리

이런 접근 방식으로 **API 비용을 70% 이상 절감**하면서도 최종 분석 품질을 유지할 수 있었습니다.

## 언론사 특화 분석 기능들

단순한 뉴스 수집을 넘어서 언론사에서 실제로 필요한 분석 기능들을 구현했습니다:

**의제 설정 분석**은 하루 수집된 모든 기사를 분석해 언론계가 주목해야 할 핵심 이슈 5개를 도출합니다. 각 이슈별로 관련 기사 수, 매체 수, 중요도를 함께 제공해 편집진이 리소스 배분을 결정할 수 있도록 도와줍니다.

```python
async def analyze_agenda(
    db: AsyncSession,
    target_date: date | None = None,
    top_n: int = 5,
) -> AgendaReport:
    # 해당 날짜 분석 완료된 기사 조회
    stmt = (
        select(Article, ArticleAnalysis)
        .join(ArticleAnalysis, Article.id == ArticleAnalysis.article_id)
        .where(func.date(Article.collected_at) == target_date)
        .order_by(ArticleAnalysis.importance_score.desc())
    )
    
    # LLM에 전달할 기사 요약 데이터 구성
    articles_summary = _build_articles_summary(rows)
    
    # Sonnet 4.6으로 의제 분석
    llm_result = await call_llm(
        system_prompt=AGENDA_SYSTEM,
        user_message=user_message,
        model=SONNET_MODEL,
    )
```

**관점 비교 분석**은 특정 이슈에 대한 국내 언론과 외신의 시각 차이를 자동으로 분석합니다. 같은 사건을 다루는 기사들을 source_type으로 분리한 후, 각각의 프레임, 논조, 강조점을 비교 분석해 보여줍니다.

## 실시간 대시보드: SSE로 구현한 라이브 모니터링

**Next.js 16 프론트엔드**는 단순한 뉴스 목록을 넘어서 편집실에서 실제 사용할 수 있는 대시보드를 목표로 했습니다. **Server-Sent Events(SSE)**를 활용해 수집·분석 진행 상황을 실시간으로 표시하고, **shadcn/ui**와 **Recharts**로 직관적인 시각화를 제공합니다.

특히 자동 보고 기능이 인상적인데, 하루 분석된 기사 수가 설정값(기본 5건)을 넘으면 자동으로 브리핑 리포트와 의제 분석을 생성합니다. 이 과정이 실시간 알림으로 편집진에게 전달되어 즉시 확인할 수 있습니다.

## 테스트 전략: 54개 테스트로 검증한 안정성

언론사에서 사용할 시스템인 만큼 안정성이 무엇보다 중요했습니다. **유닛 테스트** 30건으로 JSON 파싱, 날짜 처리, 스키마 변환 등 핵심 로직을 검증했고, **API 테스트** 16건으로 엔드포인트별 동작을 확인했습니다.

가장 중요한 것은 **E2E 테스트** 8건으로 실제 업무 흐름을 시뮬레이션한 것입니다. 수집 중복 제거부터 자동 분석, 보고서 생성까지 전체 파이프라인이 올바르게 작동하는지 검증했습니다.

```python
@pytest.mark.asyncio
async def test_전체_파이프라인_시뮬레이션(db_session):
    # 1. 뉴스 수집 (Mock)
    mock_articles = [make_article_data() for _ in range(10)]
    saved_count = await collect_all_mock(db_session, mock_articles)
    
    # 2. 1차 분류 분석
    analyses = await classify_batch_mock(db_session)
    
    # 3. 자동 보고 조건 확인 및 생성
    if saved_count >= AUTO_REPORT_MIN_ARTICLES:
        briefing = await generate_briefing_mock(db_session)
        agenda = await analyze_agenda_mock(db_session)
        
    # 전체 흐름 검증
    assert briefing.headline
    assert len(agenda.top_issues) > 0
```

## 기술적 도전과 해결 과정

개발 과정에서 가장 어려웠던 점은 **Pydantic 스키마와 SQLAlchemy ORM 간의 호환성** 문제였습니다. 특히 `AnalysisOut`과 `EntityOut` 모델에서 ORM 객체를 Pydantic으로 변환할 때 오류가 발생했는데, `model_config = {"from_attributes": True}`를 추가하여 해결했습니다.

또한 **LLM API의 응답 형태가 일관되지 않는** 문제도 있었습니다. 때로는 순수 JSON을, 때로는 마크다운 코드 블록 안에 JSON을 반환하는 경우가 있어서 강건한 파싱 로직을 구현했습니다.

## 실제 언론사 업무에 미치는 영향

이 시스템이 실제 뉴스룸에 도입된다면 편집진의 업무 방식이 크게 달라질 것입니다. 매일 아침 출근과 동시에 어제 밤부터 새벽까지의 주요 의제가 정리된 브리핑을 받아볼 수 있고, 특정 이슈에 대한 국내외 관점 차이도 즉시 파악할 수 있습니다.

특히 **헤드라인 추천 기능**과 **배경 타임라인 생성**은 기사 작성 시간을 크게 단축시킬 수 있습니다. 복잡한 이슈의 배경을 일일이 조사할 필요 없이 AI가 관련 기사들을 분석해 시계열로 정리해주기 때문입니다.

뉴스 산업의 디지털 전환이 가속화되는 지금, AI가 반복적인 업무를 담당하고 기자와 편집자는 더 창의적이고 깊이 있는 콘텐츠 제작에 집중할 수 있는 미래를 그려볼 수 있었던 프로젝트였습니다.