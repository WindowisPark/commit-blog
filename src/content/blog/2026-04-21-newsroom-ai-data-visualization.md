---
title: "차트가 점 무더기로 보이는 문제, 시간 버킷 집계로 해결하기"
description: "뉴스 분석 시스템에서 트렌드 차트가 제대로 표시되지 않는 문제를 시간 단위 집계로 해결한 과정"
pubDate: 2026-04-21
repo: newsroom-ai
repoDisplayName: Newsroom AI
tags: ["newsroom-ai", "bugfix", "python"]
commits: ["ec9c1a1c094ef4172c747c58ca5bbad2810b01d6"]
---
## 문제 발견: 선 그래프가 점 무더기로만 보이는

뉴스룸 AI 시스템에서 트렌드 분석 기능을 구현했는데, 예상과 다른 결과가 나왔습니다. 키워드, 카테고리, 감성 분석의 시간별 변화를 보여주는 **선 그래프**가 제대로 그려지지 않고 점들이 한 곳에 뭉쳐있는 상태였습니다.

원인은 간단했습니다. 전체 기간의 합계를 구한 후 `datetime.now()`라는 한 시점에 모든 데이터를 찍고 있었기 때문이었죠. 6시간, 12시간, 24시간, 7일의 기간별 트렌드를 보여주려 했지만, 실제로는 "지금 이 순간"에 모든 값을 표시하고 있었던 것입니다.

## 시간 버킷 개념 도입

문제를 해결하기 위해 **시간 버킷**(time bucket) 개념을 도입했습니다. 기간별로 적절한 시간 단위로 데이터를 그룹화하는 방식입니다:

- 6시간/12시간/24시간 기간: 1시간 단위 버킷
- 7일 기간: 1일 단위 버킷

```python
def _bucket_for_period(period: str) -> str:
    """6h/12h/24h → 'hour', 7d → 'day'."""
    return "day" if period == "7d" else "hour"
```

이제 각 시간 구간별로 데이터가 집계되어 실제 시간 흐름에 따른 변화를 보여줄 수 있게 되었습니다.

## 데이터베이스별 호환성 문제

시간 버킷을 구현하면서 **PostgreSQL**과 **SQLite** 간의 문법 차이를 해결해야 했습니다. 두 데이터베이스는 날짜/시간을 특정 단위로 자르는 함수가 다르기 때문입니다.

```python
def _bucket_expr(bucket: str, dialect_name: str):
    if dialect_name == "postgresql":
        unit = "hour" if bucket == "hour" else "day"
        return func.date_trunc(unit, Article.collected_at)
    # SQLite용
    fmt = "%Y-%m-%d %H:00" if bucket == "hour" else "%Y-%m-%d"
    return func.strftime(fmt, Article.collected_at)
```

PostgreSQL은 `date_trunc()` 함수를, SQLite는 `strftime()` 함수를 사용하는데, 이를 런타임에 구분해서 적절한 표현식을 생성하도록 했습니다. 덕분에 개발 환경에서는 SQLite를, 운영 환경에서는 PostgreSQL을 사용할 수 있게 되었습니다.

## 키워드 트렌드의 복잡성

키워드 트렌드는 다른 분석보다 복잡했습니다. 하나의 기사가 여러 키워드를 가질 수 있고, 각 키워드별로 시간대별 빈도를 계산해야 하기 때문입니다.

```python
per_bucket: dict[str, dict[datetime, int]] = {}
totals: dict[str, int] = {}
for bucket_val, keywords in rows:
    bucket_dt = _as_datetime(bucket_val)
    for kw in keywords:
        per_bucket.setdefault(kw, {})
        per_bucket[kw][bucket_dt] = per_bucket[kw].get(bucket_dt, 0) + 1
        totals[kw] = totals.get(kw, 0) + 1
```

전체 기간 동안의 키워드별 총 빈도를 계산한 후 상위 10개를 선정하고, 각 키워드의 시간대별 변화를 추적합니다. 이렇게 해서 "어떤 키워드가 언제 많이 언급되었는지"를 시각적으로 파악할 수 있게 되었습니다.

## 코드 재사용성 향상

카테고리와 감성 분석은 비슷한 패턴을 가지고 있어서 공통 함수로 추출했습니다. `_group_by_bucket()` 함수는 레이블과 시간 버킷으로 그룹화하는 로직을 재사용 가능하게 만들어줍니다.

기존에는 각 분석 타입마다 별도의 함수에서 비슷한 SQL 쿼리를 반복 작성했지만, 이제는 레이블 컬럼만 다르게 전달하면 됩니다. 코드 중복을 줄이고 유지보수성을 높일 수 있었습니다.

## 결과와 의미

이번 수정으로 트렌드 차트가 제대로 동작하게 되었습니다. 사용자는 이제 시간대별 뉴스 키워드의 변화, 카테고리별 기사 수의 흐름, 감성 분석 결과의 시간적 패턴을 명확하게 볼 수 있습니다.

단순해 보이는 "시간별 집계" 기능이지만, 데이터베이스 호환성과 복잡한 키워드 구조를 고려하면 생각보다 까다로운 문제였습니다. 하지만 이를 통해 더 견고하고 유용한 분석 도구를 만들 수 있게 되었습니다.