---
title: "죽었던 ML 모델을 살려낸 실시간 피처 생성 시스템 구축기"
description: "XGBoost와 LightGBM 모델이 모든 경기에 0.5 확률만 뱉던 문제를 실시간 피처 생성과 데이터 중복 제거로 해결한 경험담"
pubDate: 2026-04-12
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "bugfix", "python"]
commits: ["aaa70c445f4a5e0ea56599a92b1e8d94887760ac", "b2f6a7ed18eff0a4eef6948cb98dd42529abecd6"]
---
## 문제 발견: 모든 예측이 0.5?

**KBO 야구 경기 예측 시스템**을 운영하면서 심각한 문제를 발견했습니다. XGBoost와 LGBM 모델이 2026년 시즌 모든 경기에 대해 똑같이 **0.5 확률**만 출력하고 있었던 것입니다. 마치 동전 던지기와 다를 바 없는 상황이었죠.

원인을 파악해보니 피처 매트릭스에는 3월 31일까지의 경기 데이터만 9개 행으로 저장되어 있었습니다. 4월 이후 경기들은 매칭되는 피처 행을 찾지 못해 하드코딩된 기본값 0.5로 폴백되고 있었던 겁니다. 게다가 daily_results.jsonl 파일에는 **중복된 경기 결과**가 70개나 쌓여있어 ELO 레이팅과 순위 계산도 왜곡되고 있었습니다.

## 해결책 1: 실시간 피처 생성 시스템

가장 핵심적인 해결책은 **_build_live_features() 메소드** 구현이었습니다. 피처 매트릭스에 해당 경기 데이터가 없을 때 최근 경기 기록과 ELO 레이팅을 바탕으로 실시간으로 피처를 생성하는 시스템을 만들었습니다.

```python
def _build_live_features(self, home_team: str, away_team: str, date: str) -> pd.DataFrame:
    """피처 매트릭스에 없는 경기의 피처를 실시간 생성."""
    df = self.features_df
    all_games = df.sort_values("date")
    
    # 팀별 최근 30경기에서 rolling stats 추출
    def get_team_rolling(team, side):
        as_home = all_games[all_games["home_team"] == team].tail(30)
        as_away = all_games[all_games["away_team"] == team].tail(30)
        return as_home, as_away
    
    # ELO 레이팅 적용
    feat["home_elo"] = self.elo.ratings.get(home_team, {}).get("elo", 1500)
    feat["away_elo"] = self.elo.ratings.get(away_team, {}).get("elo", 1500)
    feat["elo_diff"] = feat["home_elo"] - feat["away_elo"]
    
    return pd.DataFrame([feat])
```

이 시스템은 홈/원정팀의 최근 승률, 득실차, 연속 경기 결과, 그리고 상대전적까지 모두 고려해 실시간으로 피처를 계산합니다.

## 해결책 2: 중복 데이터 제거와 자동 재빌드

데이터 품질 문제를 근본적으로 해결하기 위해 **game_id 기반 중복 제거** 로직을 추가했습니다.

```python
# 중복 방지 — game_id 기준
existing_ids: set[str] = set()
if results_file.exists():
    for line in results_file.read_text(encoding="utf-8").strip().split("\n"):
        if line.strip():
            try:
                existing_ids.add(json.loads(line).get("game_id", ""))
            except json.JSONDecodeError:
                pass

new_games = [g for g in completed if g.get("game_id") not in existing_ids]
```

또한 일일 배치 프로세스에 **step6_rebuild_features()** 단계를 추가해 새로운 경기 결과가 추가될 때마다 피처 매트릭스를 자동으로 재빌드하도록 했습니다. 이제 XGBoost와 LGBM이 항상 최신 데이터로 학습된 피처를 사용할 수 있게 되었습니다.

## 극적인 성능 개선 결과

수정 전후의 차이는 극명했습니다:

- **수정 전**: XGBoost=0.500, LGBM=0.500 (모든 경기 동일)
- **수정 후**: XGBoost=0.55-0.57, LGBM=0.55-0.61 (경기별 차별화)

이제 모델들이 팀 상황, ELO 레이팅 차이, 최근 폼 등을 제대로 반영해 각 경기마다 다른 예측 확률을 제공합니다. 특히 ELO 차이가 큰 경기나 최근 폼이 확연히 다른 팀들의 경기에서는 더욱 극명한 확률 차이를 보여줍니다.

## 배운 점과 시스템 안정성

이번 경험을 통해 **데이터 파이프라인에서 폴백 메커니즘의 중요성**을 깨달았습니다. 단순히 하드코딩된 기본값으로 폴백하는 것보다, 실시간으로 의미있는 피처를 생성하는 것이 훨씬 효과적이었습니다.

또한 GitHub Actions 워크플로우를 수정해 피처 CSV 파일 변경사항도 자동으로 커밋되도록 설정했습니다. 이제 전체 시스템이 데이터 수집부터 피처 생성, 모델 예측까지 완전히 자동화되어 안정적으로 운영됩니다.

머신러닝 모델의 성능은 결국 데이터 품질에 달려있다는 것을 다시 한 번 확인할 수 있었던 프로젝트였습니다.