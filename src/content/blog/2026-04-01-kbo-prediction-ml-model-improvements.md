---
title: "KBO 예측 AI의 진화: Stacking 앙상블과 실시간 컨텍스트 주입"
description: "ML 모델 성능을 2%p 향상시킨 Stacking 앙상블 구현과 에이전트 시스템의 실시간 시즌 스탯 활용 전략"
pubDate: 2026-04-01
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "python", "react"]
commits: ["5940bee60e2681862335c95dbccc3cd7fbc63232", "1c327a5f95d63984fce3d2832d9077c5168da8da", "5e7e296af4b0c21f01e2d078a55efdea011b3b3b", "73fe56fc4e503eb8d7dd6dc00905ddf80c55af8c"]
---
## 메타 러너가 만든 변화: Stacking 앙상블

**XGBoost**, **ELO**, **EnsembleLGBM** 세 모델이 각각 다른 관점에서 KBO 경기를 분석하고 있었다면, 이제 이들의 예측을 종합하는 **Stacking 앙상블**이 등장했다. 단순 평균이 아닌 LogisticRegression 메타 러너가 각 모델의 강점을 학습해 최종 판단을 내리는 구조다.

```python
def _build_meta_features(self, probas: np.ndarray) -> np.ndarray:
    # probas shape: (n, 3) — [xgb_prob, elo_prob, lgbm_prob]
    mean = probas.mean(axis=1, keepdims=True)
    std = probas.std(axis=1, keepdims=True)
    max_min_diff = (probas.max(axis=1, keepdims=True) - probas.min(axis=1, keepdims=True))
    return np.hstack([probas, mean, std, max_min_diff])
```

메타 피처는 3개 베이스 모델의 확률값과 함께 평균, 표준편차, 최대-최소 차이를 포함한다. 모델들의 **합의 정도**까지 학습에 활용하는 셈이다. 2023-2024 검증 데이터에서 학습한 결과, 테스트 정확도는 61.6%에 도달했다.

## 홈 선발투수 개인 스탯으로 2%p 도약

피처 엔지니어링 v4에서는 **홈팀 선발투수의 개인 스탯**을 추가했다. 기존에는 팀 전체 투수 스탯만 사용했다면, 이제 당일 선발투수의 ERA, FIP, WAR, WHIP을 직접 반영한다.

```python
# Features v4 (104 cols → with home SP stats):
# home_sp_era/fip/war/whip_actual added (98.4% match rate)
# XGBoost: 59.9% → 61.8% (+1.9%p)
# EnsembleLGBM: 59.6% → 62.0% (+2.4%p)
```

선발투수 매칭률 98.4%로 거의 모든 경기에서 투수 정보를 활용할 수 있게 되었다. **EnsembleLGBM**에서 특히 큰 향상(+2.4%p)을 보인 것은 개별 투수의 컨디션이 경기 결과에 미치는 영향이 상당함을 의미한다.

## Optuna 자동 튜닝으로 극한 최적화

50번의 시행착오 끝에 **Optuna**가 찾아낸 최적 하이퍼파라미터로 XGBoost 성능이 62.9%까지 올랐다. learning_rate부터 reg_alpha까지 9개 파라미터를 동시에 최적화하면서 과적합을 피하고 일반화 성능을 끌어올렸다.

홈 어드밴티지도 30에서 20으로 조정했다. KBO 실측 홈팀 승률 52.2%에 맞춘 세밀한 튜닝이다. 이런 디테일들이 모여 전체 시스템의 정확도를 한 단계 끌어올렸다.

## 실시간 컨텍스트 vs 데이터 누수 딜레마

흥미로운 전략적 선택이 이루어졌다. **ML 모델은 전년도 스탯만 사용**해 데이터 누수를 완전히 차단하지만, **에이전트들은 올시즌 실시간 스탯을 받는다**는 것이다.

```python
# 올시즌 팀 스탯 (에이전트 맥락용 — ML 피처와 별도)
if pitcher_df is not None and not pitcher_df.empty:
    tp = pitcher_df[(pitcher_df["Year"] == year) & (pitcher_df["Team"] == team)]
    if not tp.empty:
        era = pd.to_numeric(tp["ERA"], errors="coerce").mean()
        lines.append(f"### {team} {year} 시즌 투수 현황: ERA {era:.2f}")
```

수치적 예측은 엄격한 룰 기반으로, 정성적 분석은 최신 정보로 무장하는 하이브리드 접근법이다. "2026 시즌 투수 현황: ERA 3.80"같은 실시간 컨텍스트가 에이전트들의 토론에 반영되면서, 사람이 경기를 예측할 때와 비슷한 직관적 판단이 가능해진다.

## UI 메시지의 전략적 변화

"3개 ML 모델 + Claude & GPT"라는 직설적 표현이 "독자적 AI 분석 엔진 기반 경기 분석"으로 바뀌었다. 기술 스택 나열에서 **가치 제안 중심**으로 메시징을 전환한 것이다.

프론트엔드에도 "AI 종합" 바가 추가되어 **Stacking 앙상블의 결과**를 시각적으로 보여준다. 오렌지 그라디언트로 구분된 이 막대는 단순 모델 평균이 아닌, 메타 러너가 학습한 지능적 종합 판단의 결과물이다.

## 비용 투명성과 시스템 성숙도

```python
def log_cost(model: str, input_tokens: int, output_tokens: int, agent: str = ""):
    cost = (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000
    entry = {
        "timestamp": datetime.now().isoformat(),
        "model": model,
        "cost_usd": round(cost, 6),
    }
```

LLM API 호출마다 실시간 비용 추적이 도입되었다. Gemini 2.5 Pro, GPT-4o, Claude Sonnet 4 등 각 모델의 토큰 단가를 정확히 계산해 `/costs` API로 확인할 수 있다. 이는 단순한 기능을 넘어 **프로덕션 레벨 시스템**으로서의 성숙도를 보여준다.

**Calibration 검증**도 완료해 예측 확률과 실제 결과 간 격차가 3% 이내임을 확인했다. 모델이 "70% 확률"이라고 말하면 실제로 70% 정도 맞아떨어진다는 뜻이다.

이제 KBO 예측 AI는 단순한 실험적 프로젝트에서 **신뢰할 수 있는 분석 도구**로 진화했다. Stacking 앙상블의 지능적 종합, 실시간 컨텍스트 주입, 그리고 투명한 비용 관리까지 - 모든 요소가 하나의 완성된 시스템으로 통합되었다.