---
title: "KBO 예측 모델의 데이터 정확성 개선: 복귀 선수와 포지션 중복 문제 해결하기"
description: "야구 예측 시스템에서 발생한 선수 매칭 오류와 라인업 중복 문제를 해결하며, 좌우 대전 분석까지 추가한 개발 과정을 다룹니다."
pubDate: 2026-04-12
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "bugfix", "python"]
commits: ["3d28842e3d0b40959983c04e532dc7ae736629fe", "4a8b217569c1c9d508e8cb856a7d603c1c4485c5", "f0902b6c20013afae7e84223d88b5b7667c53449"]
---
## 예측 모델의 함정: 하드코딩된 편견

야구 데이터 분석에서 가장 치명적인 실수는 **하드코딩된 편견**을 심는 것이다. KBO 예측 모델을 개발하면서 "데뷔 외국인 선수는 40% 확률로 부진하다"는 고정값을 프롬프트에 넣어두었는데, 이것이 AI 에이전트의 판단력을 크게 제한하고 있었다.

```python
# 문제가 된 하드코딩
- 매칭 데이터가 없으면 데뷔 시즌 외국인의 일반적 불확실성(약 40% 부진) 적용

# 개선된 방식
- 매칭 데이터가 없는 데뷔 외국인은 불확실성이 높지만, 고정 비율을 적용하지 말고 제공된 스탯과 맥락으로 판단
```

실제로 각 외국인 선수는 고유한 배경과 능력을 가지고 있다. 메이저리그 경력, 일본 프로야구 성적, 마이너리그 통계 등을 종합적으로 판단해야 하는데, 40%라는 숫자가 모든 맥락을 무시하고 예측을 편향시키고 있었다.

## 선수 매칭의 복잡성: 이름만으로는 부족하다

선수 데이터베이스에서 올바른 선수를 찾는 것은 생각보다 복잡한 문제다. 특히 두 가지 까다로운 케이스가 있었다:

**복귀 선수 문제**: 안우진(KIA 2026)이 메이저리그 도전 후 복귀했는데, 팀이 바뀌고 2년 공백이 있어서 기존 로직으로는 매칭되지 않았다. 이런 선수들을 위해 **공백 허용 기간을 3년으로 확대**하고, 복귀 선수 플래그를 추가했다.

**동명이인 문제**: 페디(LG 2026)를 찾을 때 NC의 페디(2023, 다른 선수)가 매칭되는 문제가 있었다. 외국인 선수는 동명이인 위험이 높으므로, **팀 정보를 우선 고려하는 단계**를 추가했다.

```python
# 개선된 선수 매칭 로직
# 3차: name + team (올시즌 아직 기록 없지만 같은 팀 과거 기록)
if match.empty:
    match = df[(df["Name"] == name) & (df["Team"] == team_raw)].sort_values("Year", ascending=False).head(1)
    if not match.empty and match.iloc[0]["Year"] < year - 3:
        match = pd.DataFrame()

# 4차: name만 (이적/복귀 — 외국인 동명이인 체크)
if match.empty:
    candidates = df[df["Name"] == name].sort_values("Year", ascending=False)
    if not candidates.empty:
        top = candidates.iloc[0]
        is_foreign_player = detect_foreign(str(top.get("Draft", "")))
        same_team = top["Team"] == team_raw
        if is_foreign_player and not same_team:
            match = pd.DataFrame()  # 외국인 동명이인 방지
```

## 라인업 예측의 정교함: 중복을 피하는 알고리즘

예상 라인업을 생성할 때 "두 명의 포수"나 "같은 선수가 두 타순에"라는 말이 안 되는 상황이 발생했다. 이를 해결하기 위해 **그리디 알고리즘**을 도입했다.

최근 10경기의 라인업 데이터에서 각 타순별로 가중 점수를 계산하고, 점수가 높은 순서대로 배정하되 이미 선택된 선수나 포지션은 제외하는 방식이다. 홈/원정 상황도 고려해서 더 정확한 예측이 가능해졌다.

```python
def _pick_lineup_no_duplicates(order_scores: dict[str, dict[str, float]]) -> list[dict]:
    candidates = []
    for order, players in order_scores.items():
        for name_pos, score in players.items():
            candidates.append((order, name_pos, score))
    candidates.sort(key=lambda x: x[2], reverse=True)
    
    used_names: set[str] = set()
    used_positions: set[str] = set()
    assigned = {}
    
    for order, name_pos, score in candidates:
        name, position = name_pos.split("|", 1)
        norm_pos = _normalize_position(position)
        
        if order in assigned or name in used_names or norm_pos in used_positions:
            continue
            
        assigned[order] = (name_pos, score)
        used_names.add(name)
        used_positions.add(norm_pos)
```

## 좌우 대전의 과학: 매치업 분석 추가

야구에서 **좌완 투수 vs 우타자**, **우완 투수 vs 좌타자**는 유리한 매치업으로 알려져 있다. 이런 전술적 요소를 AI가 고려할 수 있도록 구조화된 매치업 분석을 추가했다.

선발투수의 투구 손잡이를 파악하고, 상대팀 타선의 좌/우타 구성을 분석해서 "상대 선발 김광현(좌완) → 우타+양타 12명 유리 매치업"과 같은 정보를 제공한다. 주요 타자들의 OPS와 함께 유리한 매치업에는 ★ 표시도 추가했다.

## 데이터 품질이 예측 품질을 결정한다

이번 개선 과정에서 느낀 것은 **모델의 복잡성보다 데이터의 정확성이 더 중요하다**는 점이다. 잘못된 선수 매칭 한 건이 전체 예측을 무너뜨릴 수 있고, 하드코딩된 편견이 AI의 학습 능력을 제한할 수 있다.

특히 야구같은 도메인에서는 복귀 선수, 동명이인, 외국인 선수 등 예외 상황이 많다. 이런 엣지 케이스들을 하나씩 발견하고 해결해나가는 과정이 실용적인 AI 시스템을 만드는 핵심이라고 생각한다.

예측 모델은 결국 데이터만큼만 정확하다. 완벽한 알고리즘보다는 깨끗하고 정확한 데이터가 더 가치 있는 투자일지도 모른다.