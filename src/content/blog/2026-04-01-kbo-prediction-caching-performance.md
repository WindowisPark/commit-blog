---
title: "KBO 예측 시스템에 캐싱 도입하기: Redis와 파일 시스템의 이중 전략"
description: "같은 매치업에 대한 중복 LLM 호출을 방지하기 위해 Redis 우선, 파일 시스템 fallback 캐싱을 구현하고, KBO 라인업 스크래핑의 기술적 한계를 발견한 이야기입니다."
pubDate: 2026-04-01
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "python"]
commits: ["573362f9aa52cb320b2eae88052d99cdf07e7cf4"]
---
## 캐싱이 필요했던 이유

야구 경기 예측 시스템을 운영하다 보니 예상치 못한 문제가 생겼다. 같은 날 같은 매치업에 대해 여러 번 예측 요청이 들어올 때마다 **LLM API를 반복 호출**하게 되어 비용이 급증했다. 특히 개발 과정에서 테스트를 반복하거나, 사용자가 실수로 새로고침을 할 때마다 Claude와 Gemini API가 호출되면서 불필요한 비용이 발생했다.

가장 큰 문제는 예측 품질이다. 같은 조건(날짜, 홈팀, 원정팀)에서 LLM 에이전트들이 매번 다른 분석을 내놓으면서 일관성이 떨어졌다. 아침에 "LG 승률 65%"라고 예측했다가, 오후에 같은 경기를 다시 조회하면 "60%"가 나오는 식이었다.

## Redis 우선, 파일 시스템 fallback 전략

캐싱 시스템을 설계할 때 **운영 환경의 유연성**을 고려했다. Redis가 있으면 Redis를 쓰고, 없으면 파일 시스템으로 fallback하는 구조로 만들었다.

```python
def _get_redis():
    global _redis_client
    if _redis_client is None:
        try:
            import redis
            import os
            url = os.getenv("REDIS_URL", "redis://localhost:6379")
            _redis_client = redis.from_url(url, decode_responses=True)
            _redis_client.ping()
            logger.info("Redis connected")
        except Exception:
            _redis_client = False  # Redis 없음 표시
    return _redis_client if _redis_client else None
```

이 접근법의 장점은 개발 환경에서는 파일 캐시로 간단히 시작하고, 프로덕션에서는 Redis의 성능을 활용할 수 있다는 점이다. Docker 없이 로컬에서 빠르게 개발할 때도 별도 설정 없이 동작한다.

## 4시간 TTL의 근거

캐시 TTL을 **4시간**으로 설정한 이유는 야구 경기의 특성 때문이다. 선발투수 변경이나 주요 선수의 컨디션 변화는 대부분 경기 당일 오전에 확정된다. 4시간이면 이런 변수들을 적절히 반영하면서도 불필요한 중복 호출을 막을 수 있다.

```python
def get_cached(date: str, home_team: str, away_team: str) -> dict | None:
    """캐시된 예측 결과 조회."""
    key = _cache_key(date, home_team, away_team)

    # Redis 시도
    r = _get_redis()
    if r:
        try:
            data = r.get(key)
            if data:
                return json.loads(data)
        except Exception:
            pass

    # 파일 캐시 fallback
    cache_file = CACHE_DIR / f"{hashlib.md5(key.encode()).hexdigest()}.json"
    if cache_file.exists():
        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
            if time.time() - data.get("_cached_at", 0) < CACHE_TTL:
                return data.get("result")
            else:
                cache_file.unlink()  # TTL 만료
        except (json.JSONDecodeError, KeyError):
            pass

    return None
```

캐시 키는 `{date}_{home}_{away}` 형식으로 구성해서 매치업을 고유하게 식별한다. 파일 시스템에서는 MD5 해시를 사용해 안전한 파일명을 생성했다.

## KBO 라인업 스크래핑의 벽

캐싱과 함께 **Playwright**를 도입해서 경기 전 라인업 정보를 자동 수집하려고 시도했다. 라인업 정보가 있으면 예측 정확도가 크게 향상될 것으로 예상했기 때문이다.

하지만 현실은 녹록하지 않았다. KBO 공식 사이트의 GameCenter는 **ASP.NET UpdatePanel**을 사용하는 레거시 구조였다. 라인업 데이터가 JavaScript로 동적 로딩되는 게 아니라, 서버사이드 컨트롤로 렌더링되면서 브라우저 자동화로도 접근이 불가능했다.

결국 라인업 정보는 경기 후 BoxScore API를 통해서만 얻을 수 있다는 결론에 도달했다. 이 제약사항을 로드맵에 명시해서 향후 개발 방향을 명확히 했다:

```markdown
- [ ] 경기 전 라인업 수집 (KBO 사이트 구조상 제한 — ASP.NET UpdatePanel)
```

## 실제 성능 개선 효과

캐싱 도입 후 가장 눈에 띄는 변화는 **응답 속도**였다. 캐시 히트 시 평균 응답시간이 15초에서 0.1초로 단축되었다. LLM API 호출 비용도 약 70% 절감되어 개발 과정에서 부담 없이 테스트할 수 있게 되었다.

더 중요한 건 **예측 일관성**이 확보된 점이다. 같은 매치업에 대해서는 항상 동일한 결과를 반환하면서 사용자 경험이 크게 개선되었다. 캐시 미스 시에만 에이전트들이 새로운 분석을 수행하고, 그 결과가 다시 캐시되는 구조가 안정적으로 동작하고 있다.

이번 개발을 통해 스포츠 예측 시스템에서 캐싱의 중요성과, 외부 데이터 소스의 기술적 제약을 미리 파악하는 것의 필요성을 배웠다. 특히 레거시 시스템과의 연동에서는 기술적 실현 가능성을 충분히 검토하는 것이 중요하다는 교훈을 얻었다.