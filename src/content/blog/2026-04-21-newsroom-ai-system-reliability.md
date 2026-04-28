---
title: "AI 뉴스룸의 안정성을 위한 4가지 핵심 개선"
description: "RAG 성능 최적화부터 LLM 신뢰성까지, 대규모 뉴스 데이터 처리 시스템의 운영 안정성을 높인 기술적 도전들을 살펴봅니다."
pubDate: 2026-04-21
repo: newsroom-ai
repoDisplayName: Newsroom AI
tags: ["newsroom-ai", "feature", "python", "bugfix"]
commits: ["f89426a7d4a1a8fab6a7589ee2c1ea8f9487b643", "bdfc7ea09e4cffbeacdfd953eb598fa6a39fdb30", "0e73866ececc008be0936cc089b478fd0db8c311", "8439867f2daafbaf1c765e1710913e2e848f3097", "7cd5d997db506c149f5eb1c2ee5921f3786f481b", "32b945331db877ab94814e69128d48ceb59776e5", "091a41596adc48dba759d554f7f3960361ee6419"]
---
## 수만 건 기사에서 벗어난 RAG 검색 최적화

**Newsroom AI**의 브리핑 생성 과정에서 가장 큰 병목은 관련 기사를 찾는 검색 과정이었습니다. 기존 구현은 전체 기사 테이블을 메모리로 로드한 뒤 Python에서 티어와 키워드를 필터링하는 방식이었는데, 수만 건 이상의 데이터에서는 OOM과 지연이 발생했습니다.

새로운 접근법은 **2단계 파이프라인**입니다. 먼저 SQL 레벨에서 후보를 200건 이하로 축소한 뒤, Python에서 정확한 재랭킹을 수행합니다:

```python
# PostgreSQL의 JSONB has_any와 GIN 인덱스 활용
overlap = ArticleAnalysis.keywords.cast(JSONB).has_any(pg_array(keywords, type_=String))
stmt = (
    select(Article, ArticleAnalysis)
    .where(or_(*tier_conditions))
    .where(or_(*kw_conditions))  # JSONB + ILIKE 조합
    .limit(_RETRIEVAL_CANDIDATE_LIMIT)
)
```

핵심은 **PostgreSQL의 JSONB 연산자**를 활용한 키워드 매칭입니다. `keywords` 컬럼에 GIN 인덱스를 생성해 `has_any` 연산을 빠르게 처리하고, 제목의 부분 문자열 매칭과 조합해 정확도를 확보했습니다.

## LLM 호출의 신뢰성 확보

Anthropic API의 일시적 장애나 네트워크 문제로 인한 서비스 중단을 방지하기 위해 **tenacity 기반 재시도 메커니즘**을 도입했습니다. 하지만 모든 에러를 재시도하면 안 됩니다:

```python
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception(_should_retry)
)
async def _messages_create_with_retry(client, **kwargs):
    return await client.messages.create(**kwargs)

def _should_retry(exc: BaseException) -> bool:
    """연결/타임아웃/429/5xx만 재시도"""
    if isinstance(exc, (APIConnectionError, APITimeoutError, RateLimitError)):
        return True
    if isinstance(exc, APIStatusError):
        return 500 <= getattr(exc, "status_code", 0) < 600
    return False
```

인증 오류나 스키마 검증 실패 같은 **4xx 에러는 재시도해도 동일하게 실패**하므로 제외했습니다. 지수 백오프로 API 서버 부하도 고려했습니다.

## 반복 실패 기사 차단으로 토큰 비용 절감

일부 기사는 내용이 복잡하거나 형식이 특이해 LLM 분류에 반복적으로 실패했습니다. 매 사이클마다 동일한 기사를 재시도하면서 **토큰 비용이 지속적으로 발생**하는 문제를 해결하기 위해 blocklist 시스템을 구현했습니다:

```python
_MAX_CLASSIFICATION_FAILURES = 3
_failure_counts: dict[str, int] = {}
_blocked_article_ids: set[str] = set()

def _record_failure(article_id) -> None:
    key = str(article_id)
    _failure_counts[key] = _failure_counts.get(key, 0) + 1
    if _failure_counts[key] >= _MAX_CLASSIFICATION_FAILURES:
        _blocked_article_ids.add(key)
```

3회 연속 실패한 기사는 이후 분류 배치에서 제외됩니다. 서버 재시작 시 초기화되므로 일시적인 문제로 인한 영구 차단은 방지합니다.

## 다회성 브리핑과 비용 추적 체계

실제 편집국처럼 **하루에 여러 번 브리핑**을 생성할 수 있도록 cron 스케줄러를 확장했습니다. `briefing_schedule="09:00,18:00"`처럼 설정하면 오전·저녁 자동 브리핑이 가능합니다.

동시에 LLM 호출 비용을 추적하기 위해 `ArticleAnalysis` 모델에 `prompt_tokens`와 `completion_tokens` 필드를 추가했습니다. **Haiku 분류 비용을 누적 집계**해 운영 비용을 모니터링할 수 있게 되었습니다.

## JSON 파싱의 현실적 대응

LLM이 생성하는 JSON 응답은 완벽하지 않습니다. 코드 블록으로 래핑되거나, 닫는 펜스가 누락되거나, 심지어 **raw 개행문자가 포함**되는 경우도 있었습니다:

```python
def _parse_json(text: str) -> dict:
    candidates = [text.strip()]
    
    # 코드펜스 안쪽 추출 (닫는 펜스 없어도 OK)
    if text.startswith("```"):
        body = text[text.find("\n") + 1:]
        if body.endswith("```"):
            body = body[:-3]
        candidates.append(body.strip())
    
    for c in candidates:
        try:
            return json.loads(c, strict=False)  # raw 개행 허용
        except json.JSONDecodeError:
            continue
```

`strict=False` 옵션으로 JSON 표준을 약간 위반하더라도 모델 출력을 수용하고, 여러 후보 문자열을 순차적으로 시도해 파싱 성공률을 높였습니다.

## 운영 환경에서의 배움

이번 개선들은 모두 **실제 운영 데이터**에서 발견된 문제들입니다. 수만 건의 기사를 처리하면서 메모리 부족, API 장애, 토큰 비용 증가, JSON 파싱 실패 등 다양한 현실적 문제들을 마주했습니다.

특히 RAG 검색 최적화는 단순한 성능 문제를 넘어 **서비스 가용성**과 직결된 개선이었습니다. PostgreSQL의 고급 기능들을 적극 활용해 Python 레벨의 병목을 SQL 레벨로 이전시킨 결과, 안정적인 브리핑 생성이 가능해졌습니다.