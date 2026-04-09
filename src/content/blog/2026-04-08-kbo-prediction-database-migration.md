---
title: "Railway 배포를 위한 PostgreSQL 마이그레이션 - 휘발성 파일 시스템과의 결별"
description: "KBO 예측 프로젝트에서 파일 기반 데이터 저장소를 PostgreSQL로 마이그레이션한 과정과, 클라우드 환경에서 데이터 영속성을 확보하는 방법을 다룹니다."
pubDate: 2026-04-08
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "python", "bugfix"]
commits: ["3c2809b532320a8539e882cb5428b998c6922678", "9995786ef3c9bdb6065e201b9a5761f85e75ec7f"]
---
## 문제 인식: Railway는 파일을 지운다

KBO Prediction 프로젝트를 **Railway**에 배포하면서 큰 문제를 발견했습니다. 매번 재배포할 때마다 예측 기록과 LLM 비용 추적 데이터가 모두 사라지는 것이었습니다. Railway의 컨테이너는 상태를 보존하지 않기 때문에, 파일 시스템에 저장된 모든 런타임 데이터가 휘발되었습니다.

이는 야구 예측 서비스에게 치명적인 문제였습니다. 예측 정확도 계산, 사용자별 분석 이력, LLM API 비용 모니터링 - 모든 것이 파일에 의존하고 있었기 때문입니다.

## PostgreSQL로의 완전한 마이그레이션

해결책은 명확했습니다. **영구 저장이 필요한 데이터는 PostgreSQL로, 임시 데이터는 메모리나 파일 캐시로** 분리하는 것이었습니다.

### 예측 이력 테이블 설계

가장 중요한 `prediction_history`부터 마이그레이션했습니다:

```python
class PredictionHistory(Base):
    __tablename__ = "prediction_history"
    
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    date: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    home_team: Mapped[str] = mapped_column(String(50), nullable=False)
    away_team: Mapped[str] = mapped_column(String(50), nullable=False)
    predicted_winner: Mapped[str] = mapped_column(String(50), nullable=False)
    home_win_probability: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[str] = mapped_column(String(20), nullable=False)
    key_factors: Mapped[str] = mapped_column(Text, nullable=False)  # JSON
    model_probs: Mapped[str] = mapped_column(Text, nullable=False)  # JSON
    actual_winner: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
```

기존 JSON 파일 기반 저장소에서 완전히 벗어나, 각 예측을 개별 레코드로 관리하도록 변경했습니다. 특히 `key_factors`와 `model_probs`는 JSON 문자열로 저장하여 기존 구조를 유지했습니다.

### LLM 비용 추적의 데이터베이스화

비용 추적 시스템도 완전히 재작성했습니다:

```python
def log_cost(model: str, input_tokens: int, output_tokens: int, agent: str = ""):
    """API 호출 비용을 DB에 기록."""
    pricing = PRICING.get(model, {"input": 5.0, "output": 15.0})
    cost = (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000

    try:
        from backend.auth.database import SessionLocal
        from backend.auth.models import LLMCostLog

        db = SessionLocal()
        try:
            row = LLMCostLog(
                model=model, agent=agent,
                input_tokens=input_tokens, output_tokens=output_tokens,
                cost_usd=round(cost, 6),
            )
            db.add(row)
            db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"Cost logging failed: {e}")
```

기존의 JSONL 파일 방식에서 완전히 벗어나, 실시간으로 PostgreSQL에 기록하도록 변경했습니다. 에러 처리도 강화하여, 비용 추적 실패가 메인 기능에 영향을 주지 않도록 했습니다.

## 스마트한 데이터 분류 전략

흥미로운 점은 **모든 데이터를 PostgreSQL로 옮기지 않았다는 것**입니다. 4시간 TTL을 가진 예측 캐시는 여전히 파일 시스템에 둡니다:

```python
# 캐시 저장 (4시간 TTL) - 파일 그대로 유지
set_cached(req.date, req.home_team, req.away_team, response_dict)

# 이력 저장 (DB) - PostgreSQL로 마이그레이션
pred = {...}
prediction_history.append(pred)
save_prediction(pred)  # DB 저장
```

임시 캐시는 재배포 시 사라져도 문제없지만, 예측 이력은 영구 보존되어야 하기 때문입니다. 이런 **데이터의 생명주기에 따른 분류**가 핵심이었습니다.

## CI/CD 파이프라인 동기화 문제 해결

마이그레이션 후 GitHub Actions에서 새로운 문제가 발생했습니다. 일일 배치 스크립트가 `asyncpg` 비동기 드라이버 URL을 처리하지 못하는 것이었습니다:

```python
# asyncpg → psycopg2 변환 (동기 엔진용)
_sync_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

if _sync_url.startswith("sqlite"):
    engine = create_engine(_sync_url, connect_args={"check_same_thread": False})
else:
    engine = create_engine(_sync_url)
```

웹 애플리케이션은 비동기 드라이버를, 배치 스크립트는 동기 드라이버를 사용해야 하는 상황에서 **URL 변환을 통한 호환성 확보**로 해결했습니다.

## 실제 결과 동기화까지 완성

마지막으로 일일 배치에서 실제 경기 결과를 DB에 반영하는 로직도 추가했습니다:

```python
# DB에도 actual_winner 반영
for pred in history:
    key = f"{pred['date']}_{pred['home_team']}_{pred['away_team']}"
    if key not in pred_map:
        continue
    matched = pred_map[key]
    row = db.query(PredictionHistory).filter(
        PredictionHistory.date == pred["date"],
        PredictionHistory.home_team == pred["home_team"],
        PredictionHistory.away_team == pred["away_team"],
        PredictionHistory.actual_winner.is_(None),
    ).first()
    if row:
        row.actual_winner = matched["actual_winner"]
        row.is_draw = matched.get("is_draw", False)
```

이제 예측 정확도 계산이 완전히 데이터베이스 기반으로 동작하며, 재배포와 무관하게 모든 데이터가 안전하게 보존됩니다.

## 마무리: 클라우드 네이티브 아키텍처로

이번 마이그레이션을 통해 **상태를 보존하지 않는 클라우드 환경에 적합한 아키텍처**로 전환할 수 있었습니다. 파일 시스템 의존성을 제거하고, 데이터의 중요도에 따라 저장 방식을 분리한 것이 핵심이었습니다.

특히 Railway와 같은 서버리스 플랫폼에서는 "무엇이 영구적이고, 무엇이 일시적인가"를 명확히 구분하는 것이 중요합니다. 이번 경험이 비슷한 마이그레이션을 계획하는 개발자들에게 도움이 되길 바랍니다.