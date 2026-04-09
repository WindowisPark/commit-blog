---
title: "KBO 예측 시스템, 실시간 순위표로 한 단계 더 진화하다"
description: "매일 배치로 계산되던 팀 순위표를 사전 계산된 JSON으로 최적화하고, 실제 2026시즌 데이터로 전환한 개발 과정"
pubDate: 2026-04-09
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "python", "react", "bugfix"]
commits: ["26b2cd5a83615d8a9e0587b703c5bde5f0a69fb8", "ceea63806c10c1b61b5197ea0d9711e4326dda1c", "3e47f8d65075ee010996636e57b6be286e9bfa2c", "5790325ad00a6ff08946592fb1160c3b088bdf29", "fd5cd69ef418c03b80bc893047ab15d3147774b8", "d64862aea60c11f0c2b36cf86775834c1931c2a1", "00b2b58a803c17f8b273578a16d0c6325bed5575"]
---
## 성능과 정확성을 동시에 잡은 리팩토링

**KBO Prediction** 프로젝트에서 가장 눈에 띄는 개선사항 중 하나는 순위표(standings) 시스템의 전면적인 재설계였다. 기존에는 사용자가 순위표를 볼 때마다 `daily_results.jsonl` 파일을 파싱해서 승률과 연승을 계산했는데, 이를 **배치 처리로 사전 계산**하여 성능을 대폭 개선했다.

가장 중요한 변화는 새로운 배치 스텝 `step4_update_standings`의 추가다. 이 함수는 매일 자정에 실행되어 모든 팀의 승-패-무 기록과 연승/연패 상태를 계산해 `data/standings.json`에 저장한다. API는 이제 매번 복잡한 계산을 하는 대신 이 파일만 읽으면 된다.

```python
def step4_update_standings(completed: list[dict]):
    """시즌 순위표 + 연승/연패 갱신 → data/standings.json 저장."""
    # 현재 시즌 경기만 필터링
    current_season = str(datetime.now().year)
    games = []
    for line in results_file.read_text().strip().split("\n"):
        if line:
            g = json.loads(line)
            if g["date"].startswith(current_season):
                games.append(g)
```

## 실시간성을 높인 데이터 구조 변경

기존 API는 훈련용 과거 데이터에서 승률을 가져왔지만, 이제는 **실제 2026시즌 경기 결과**를 기반으로 계산한다. 더 나아가 시즌 전체 승률 대신 **최근 10경기 승률**을 표시하도록 개선했다. 이는 팀의 현재 컨디션을 더 정확히 반영한다.

```python
# 최근 10경기 승률 계산
recent = s["results"][-10:]
recent_w = sum(1 for r in recent if r == "W")
recent_l = sum(1 for r in recent if r == "L")
recent_total = recent_w + recent_l  # 무승부 제외
recent_win_pct = round(recent_w / recent_total, 3) if recent_total > 0 else 0.5
```

프론트엔드에서도 승-패-무 기록을 명확히 표시하는 컬럼을 추가했다. 이전에는 ELO 레이팅과 승률만 보였다면, 이제는 `5-3-1` 같은 직관적인 성적 표시로 사용자 경험을 개선했다.

## 배치 처리 안정성 강화

흥미로운 부분은 **GitHub Actions 권한 문제 해결**이다. 배치 작업이 `standings.json` 파일을 생성하고 커밋해야 하는데, 기존에는 `contents: write` 권한이 없어서 실패했다. 이를 두 워크플로우 모두에 추가해 자동화 파이프라인을 완성했다.

```yaml
permissions:
  contents: write
```

매일 배치는 이제 6단계로 구성된다:
1. 오늘 예측 수집
2. 어제 경기 결과 수집  
3. ELO 레이팅 업데이트
4. **순위표 + 연승 갱신 (신규)**
5. 메인 데이터셋 추가
6. 일일 요약

## 개발자가 놓치기 쉬운 디테일들

커밋 히스토리를 보면 며칠간 실제 경기 결과를 **백필(backfill)**한 흔적이 보인다. 3월 28일과 4월 2일 경기 데이터를 나중에 추가했는데, 이는 실제 운영 환경에서 흔히 겪는 데이터 누락 상황이다. 시스템이 안정적으로 동작하려면 이런 예외 상황도 고려해야 한다.

또한 연승/연패 계산 로직에서 **무승부 처리**가 흥미롭다. 무승부는 승부 기록에는 포함되지만 연승 카운트는 끊지 않는다. 야구 특성상 합리적인 선택이다.

```python
for r in reversed(s["results"]):
    if r == "D":  # 무승부는 연승 계산에서 스킵
        continue
    # 연승/연패 로직...
```

이번 개선으로 **API 응답 속도는 대폭 향상**되었고, 사용자는 더 정확하고 실시간에 가까운 순위 정보를 볼 수 있게 되었다. 단순해 보이는 순위표 하나도 실제로는 성능, 정확성, 사용성을 모두 고려한 정교한 설계가 필요하다는 걸 보여주는 사례다.