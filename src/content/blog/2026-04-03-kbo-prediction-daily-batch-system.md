---
title: "KBO 예측 서비스의 실시간 백필링 시스템 구축기"
description: "배치 예측 시스템에서 일시적 장애로 누락된 데이터를 자동 복구하는 fallback 메커니즘을 구현한 과정"
pubDate: 2026-04-03
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "python", "bugfix"]
commits: ["614658d21305feab00c16a4c0611bb6ad20502e7", "9f3099a8d0eb3de2adb372495fb78070c2ad0ff4", "9409287f67edf0b2fe1a555c1f7ad041b9148731", "33c12b342dc32fb4d3aad5c2444d69d1cfe37f3b", "956a81fe4b79c47f1ba72d3e23df54e7c8c6355e"]
---
## 배치 예측의 완결성 문제

**KBO Prediction** 프로젝트를 운영하면서 가장 큰 고민 중 하나는 배치 예측 시스템의 안정성이었다. 매시간 실행되는 cron job이 네트워크 장애나 API 오류로 실패하면, 해당 시간의 예측 데이터가 영구적으로 누락되는 문제가 있었다. 특히 경기 시작 전 중요한 시점의 예측을 놓치면 사용자 경험에 치명적인 영향을 미칠 수 있었다.

## 2단계 백필링 전략

이 문제를 해결하기 위해 **fallback mechanism**을 설계했다. 핵심 아이디어는 매시간 배치 작업 시 누락된 예측을 자동으로 감지하고 보충하는 것이다.

```python
# 누락 보충: 경기 시작 전인데 아직 배치 결과가 없는 경기
upcoming = [g for g in games if g["status"] not in ("final", "cancelled")]
missing_phase1 = []
missing_phase2 = []

if upcoming:
    init_db()
    db = SessionLocal()
    try:
        for game in upcoming:
            game_time = parse_game_time(game)
            if game_time and game_time > now:
                # Phase 1 누락 체크 — 경기 시작 전이면 보충
                p1 = db.query(PreComputedPrediction).filter(
                    PreComputedPrediction.game_date == game_date,
                    PreComputedPrediction.home_team == home,
                    PreComputedPrediction.away_team == away,
                    PreComputedPrediction.batch_phase == 1,
                ).first()
                if not p1:
                    missing_phase1.append(game)
```

**Phase 1**은 경기 시작 전 언제든지 보충 가능하고, **Phase 2**는 경기 2시간 전부터만 보충한다. 이렇게 단계별로 다른 기준을 적용해 데이터의 시의성을 보장했다.

## 경기 전 라인업 수집 자동화

배치 시스템의 두 번째 개선점은 **확정 라인업 자동 수집**이었다. KBO 공식 API에서 제공하는 GetLineUpAnalysis 엔드포인트를 활용해 경기 1.5시간 전쯤 공개되는 실제 선발 라인업을 수집한다.

```python
def get_pregame_lineup(game_id: str) -> dict | None:
    """경기 전 확정 라인업 조회."""
    session = requests.Session()
    resp = session.post(
        f"{BASE_URL}/ws/Schedule.asmx/GetLineUpAnalysis",
        data={"gameId": game_id, "leId": "1", "srId": "0", "seasonId": season},
        timeout=15,
    )
    
    data = resp.json()
    # LINEUP_CK=true일 때만 라인업 공개
    lineup_ck = data[0][0].get("LINEUP_CK", False)
    
    if lineup_ck:
        home_lineup = _parse_lineup_table(data[3][0])
        away_lineup = _parse_lineup_table(data[4][0])
        return {
            "available": True,
            "home_lineup": home_lineup,  # [{"order": "1", "position": "우익수", "name": "홍창기", "war": "0.00"}, ...]
            "away_lineup": away_lineup,
        }
```

이 데이터는 **Phase 2 예측**에서 LLM 컨텍스트로 주입되어 더 정확한 분석을 가능하게 한다. 선발 투수뿐만 아니라 실제 타선 구성과 각 선수의 WAR 정보까지 반영할 수 있게 되었다.

## GitHub Actions와 데이터 동기화

배치 시스템을 **GitHub Actions**에서 운영하면서 발생한 흥미로운 문제가 있었다. 로컬 환경에서는 `kbo_games_2000_2025.csv` 같은 대용량 히스토리 데이터를 사용하지만, CI 환경에는 이 파일이 없어서 배치 작업이 중단되는 현상이었다.

```python
def step4_append_games(completed: list[dict]):
    games_file = ROOT / "data" / "raw" / "kbo_games_2000_2025.csv"
    if not games_file.exists():
        logger.warning("  games CSV not found, skipping append")
        return  # CI 환경에서는 gracefully skip
```

단순하지만 효과적인 해결책이었다. CI에서는 히스토리 업데이트를 건너뛰고 핵심 예측 기능만 실행하도록 했다. 동시에 예측 결과 파일들을 `.gitignore`에서 제외해 GitHub에 자동 커밋되도록 설정했다.

## 인증과 티어링 시스템 도입

프로젝트의 수익화를 위해 **3단계 구독 모델**을 구현했다. JWT 기반 인증과 함께 Free/Basic/Pro 티어별로 다른 수준의 예측 정보를 제공한다.

```python
def filter_prediction_response(prediction: dict, tier: str) -> dict:
    """티어별 응답 필터링"""
    if tier == "free":
        return {
            "predicted_winner": prediction.get("predicted_winner"),
            "tier_notice": "Basic 구독으로 승률과 근거를 확인하세요"
        }
    elif tier == "basic":
        return {
            "predicted_winner": prediction.get("predicted_winner"),
            "home_win_probability": prediction.get("home_win_probability"),
            "confidence": prediction.get("confidence"),
            "key_factors": prediction.get("key_factors", [])[:3],  # 3개만
        }
    # Pro는 전체 데이터 반환
```

**Rate Limiting**도 구현해 Free 티어는 1일 1회, Basic은 5회, Pro는 무제한으로 분석 횟수를 제한했다. CORS 설정도 Vercel 배포 도메인으로 제한해 보안을 강화했다.

## 운영 안정성의 가치

이번 개선을 통해 배운 점은 **운영 환경에서의 완결성**이 얼마나 중요한지였다. 기술적으로 완벽한 시스템도 일시적 장애로 데이터가 누락되면 사용자 신뢰를 잃을 수 있다. Fallback 메커니즘은 단순해 보이지만 서비스의 신뢰성을 크게 높여주는 핵심 기능이 되었다.

특히 스포츠 예측 서비스처럼 **시간에 민감한 도메인**에서는 이런 복구 메커니즘이 필수다. 경기 시작 후에는 아무리 정확한 예측도 의미가 없기 때문이다.