---
title: "KBO 야구 예측 시스템에 실전급 라인업 분석 기능 구현하기"
description: "경기 전 확정 라인업부터 예상 라인업, 그리고 외국인 투수 유사도 매칭까지 - 야구 데이터의 복잡성을 다루는 엔지니어링 이야기"
pubDate: 2026-04-03
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "python", "react"]
commits: ["9f3099a8d0eb3de2adb372495fb78070c2ad0ff4", "8354ba6901bfaded162f603a6865189aa6ef34f4", "6b571ba5160a97660656ad24a28b85a66d25de99", "c0febb2a5d336f7212fe5a95d64f66ba3497ee2c", "bde021737f0d2891bf1398b95922973843177c1a"]
---
## 라인업이 없으면 야구 예측이 불가능하다

야구 예측 시스템을 만들면서 가장 큰 고민 중 하나가 **라인업 정보**였습니다. 아무리 정교한 ML 모델과 통계 분석을 해도, 실제로 누가 경기에 나서는지 모르면 예측의 의미가 반감되죠. 특히 KBO는 라인업 공개 시점이 들쭉날쭉해서 더욱 까다로웠습니다.

이번에 KBO 공식 API를 활용해서 **3단계 라인업 수집 시스템**을 구축했습니다. 경기 전 확정 라인업, 경기 후 박스스코어 라인업, 그리고 데이터가 없을 때는 최근 경기 패턴을 분석한 예상 라인업까지 제공하는 시스템입니다.

## Phase별 예측 전략의 진화

예측 시스템은 **Phase 1**(경기 당일 오전)과 **Phase 2**(경기 1시간 전)로 나누어 운영하고 있는데, 각 단계마다 다른 라인업 정보를 활용하도록 설계했습니다.

Phase 1에서는 아직 라인업이 공개되지 않은 상황이므로, 최근 5경기의 라인업 패턴을 분석해서 **예상 타선**을 생성합니다. 포지션별로 가장 자주 출전한 선수를 뽑아내는 방식이죠.

```python
def get_expected_lineup(team_name: str, num_games: int = 5) -> dict:
    # 최근 경기들의 라인업 수집
    collected_lineups: list[list[dict]] = []
    
    # 타순별 최빈 선수 추출
    order_players: dict[str, Counter] = {}
    for lineup in collected_lineups:
        for p in lineup:
            order = p["order"]
            if order not in order_players:
                order_players[order] = Counter()
            order_players[order][f"{p['name']}|{p['position']}"] += 1
```

Phase 2에서는 KBO의 **GetLineUpAnalysis API**를 통해 확정된 라인업을 가져옵니다. 이 API는 경기 시작 약 1.5시간 전에 공개되는 공식 라인업 정보를 제공하는데, 타순과 포지션, 심지어 WAR 정보까지 포함되어 있어서 예측 품질을 크게 높일 수 있었습니다.

## API 계층화로 안정성 확보

라인업 조회 엔드포인트(`/game/{id}/lineup`)는 **3단계 폴백 전략**으로 구현했습니다:

```python
@app.get("/game/{game_id}/lineup")
async def game_lineup(game_id: str):
    # 1차: 경기 전 확정 라인업 시도
    pregame = get_pregame_lineup(game_id)
    if pregame and pregame.get("available"):
        return {"source": "pregame", **pregame}
    
    # 2차: 박스스코어 라인업 (경기 후)
    result = get_lineup(game_id)
    if result and result.get("home_lineup"):
        return {"source": "boxscore", **result}
    
    # 3차: 예상 라인업 (최근 경기 빈도 기반)
    away_expected = get_expected_lineup(g["away_team"])
    home_expected = get_expected_lineup(g["home_team"])
    return {"source": "expected", ...}
```

이렇게 하면 언제 API를 호출해도 "라인업 없음" 상황을 최소화할 수 있습니다. 프론트엔드에서도 `source` 필드를 보고 "확정 라인업" vs "예상 라인업 (최근 N경기 기반)" 배지를 다르게 표시해서 사용자가 정보의 신뢰도를 직관적으로 파악할 수 있도록 했습니다.

## 외국인 투수의 불확실성을 데이터로 해결

KBO 예측에서 가장 어려운 변수 중 하나가 **데뷔 시즌 외국인 투수**입니다. 아무리 MLB에서 좋은 성적을 냈어도 KBO 적응에 실패하는 경우가 빈번하거든요. 기존에는 단순히 "불확실하다"고 플래그만 달았는데, 이번에는 **유사도 매칭 시스템**을 도입했습니다.

역대 외국인 투수들의 데뷔 시즌 데이터를 인덱싱하고, 현재 투수와 가장 비슷한 프로필의 선수들을 찾아서 그들의 KBO 적응 결과(성공/평균/부진)를 제공하는 방식입니다:

```python
def find_similar_pitchers(target: dict, index_df: pd.DataFrame, k: int = 5):
    target_gs = target.get("GS", 0)
    
    if target_gs >= 5:  # 성적 축적 시
        # ERA, FIP, WHIP, K/9, BB/9 기반 매칭
        return _match_by_stats(target, candidates, k)
    else:  # 시즌 초반
        # 나이 + 투구손 기반 매칭
        return _match_by_profile(target, candidates, k)
```

## UX의 디테일이 완성도를 결정한다

기술적 구현만큼 중요한 게 사용자 경험입니다. 라인업 조회 버튼에 **로딩 스피너**를 추가하고, 버튼 텍스트도 "Lineup"에서 "라인업"으로 현지화했습니다. 작은 변화같지만 사용자 입장에서는 훨씬 자연스럽게 느껴지죠.

또한 예상 라인업의 경우 "최근 경기 출전 기록을 바탕으로 구성한 예상 라인업입니다"라는 설명 배너를 추가해서 정보의 한계를 투명하게 공개했습니다. 이런 디테일이 사용자의 신뢰를 쌓는 중요한 요소라고 생각합니다.

## 데이터 엔지니어링의 진짜 가치

이번 작업을 통해 느낀 건, **좋은 예측 시스템은 모델의 성능보다 데이터 파이프라인의 안정성**에서 나온다는 점입니다. 라인업 정보 하나를 제대로 처리하기 위해 API 계층화, 폴백 전략, 캐싱, 에러 핸들링까지 고려해야 했으니까요.

특히 외국인 투수 유사도 매칭 같은 경우는 단순한 통계를 넘어서 **도메인 지식을 코드로 구현**하는 작업이었습니다. 야구라는 스포츠의 특성을 이해하고, 그것을 데이터 구조와 알고리즘으로 번역하는 과정이죠.

앞으로는 타자 라인업의 상성 분석이나, 불펜 투수 운용 패턴 예측 같은 더 세밀한 분석을 추가할 예정입니다. 야구 데이터의 깊이는 정말 끝이 없네요.