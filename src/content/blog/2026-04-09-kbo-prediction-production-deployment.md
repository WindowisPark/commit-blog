---
title: "KBO 야구 예측 모델 배포를 위한 Railway 최적화 작업기"
description: "Docker 배포 환경에서 데이터 파일 처리 문제를 해결하고, ELO 시스템과 AI 에이전트에 실시간 순위표 데이터를 통합한 과정을 기록했습니다."
pubDate: 2026-04-09
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "bugfix", "python"]
commits: ["8bcc1d0be41761d56e26bea00c9ce1d93e3eabaa", "e5313dbe8daa5099403fdc86245470b04b861c87", "00b2b58a803c17f8b273578a16d0c6325bed5575", "ceea63806c10c1b61b5197ea0d9711e4326dda1c"]
---
## 배포 환경에서 마주한 데이터 파일 문제

**Railway** 클라우드 플랫폼에 KBO 야구 예측 시스템을 배포하면서 흥미로운 문제에 직면했습니다. 로컬에서는 완벽하게 동작하던 Docker 컨테이너가 Railway에서는 빌드조차 되지 않는 상황이었죠.

문제의 핵심은 `.gitignore`에 등록된 원본 CSV 파일이었습니다. `data/raw/kbo_games_2000_2025.csv`는 용량이 크고 민감한 데이터라서 Git 저장소에는 포함하지 않았는데, Dockerfile에서는 이 파일을 복사하려고 시도하고 있었습니다. 클라우드 빌드 환경에서는 당연히 이 파일이 존재하지 않으니 빌드가 실패할 수밖에 없었죠.

```dockerfile
# 문제가 되었던 부분 (제거됨)
-COPY data/raw/kbo_games_2000_2025.csv data/raw/

# 실제로 필요한 것들만
+COPY data/standings.json data/
+COPY data/elo_ratings.json data/
+COPY data/daily_results.jsonl data/
```

## 실시간 데이터 기반 AI 에이전트 강화

단순히 파일을 제거하는 것으로 끝나지 않았습니다. 이번 기회에 AI 예측 에이전트들이 더 풍부한 맥락 정보를 활용할 수 있도록 시스템을 개선했습니다.

가장 중요한 변화는 **실시간 KBO 순위표 데이터**를 AI 에이전트의 분석 맥락에 주입한 것입니다. 기존에는 단순히 팀 간 통계만 비교했다면, 이제는 현재 리그 순위, 연승/연패 흐름, 승률 등 실제 시즌 상황을 종합적으로 고려할 수 있게 되었습니다.

```python
# standings.json 기반 KBO 순위표 (프론트엔드와 동일 소스)
standings_file = Path(__file__).parent.parent.parent / "data" / "standings.json"
if standings_file.exists():
    standings_data = json.loads(standings_file.read_text(encoding="utf-8"))
    standings = standings_data.get("teams", {})
    if standings:
        ranked = sorted(standings.items(),
                        key=lambda x: x[1].get("win_pct", 0), reverse=True)
        season = standings_data.get("season", datetime.now().year)
        lines.append(f"\n### {season} KBO 현재 순위표")
```

## ELO 레이팅 시스템의 정교한 튜닝

배포 과정에서 발견한 또 다른 버그는 **ELO 홈 어드밴티지** 설정이었습니다. 하드코딩된 30점이 실제 설정값인 20점과 달라서 예측 확률이 부정확했던 것이죠. 이런 작은 차이가 누적되면 모델 성능에 상당한 영향을 미칠 수 있습니다.

```python
# 수정 전: 하드코딩된 값
-elo_prob = 1 / (1 + 10 ** ((elo_away - elo_home - 30) / 400))

# 수정 후: 설정값 사용
+elo_prob = 1 / (1 + 10 ** ((elo_away - elo_home - self.elo.home_adv) / 400))
```

현재 시스템에서 ELO 모델의 홈 어드밴티지는 20점으로 설정되어 있으며, 이는 KBO 리그의 홈팀 승률 분석을 통해 도출된 최적값입니다.

## AI 에이전트 프롬프트 개선

세 개의 AI 에이전트(Analyst, Scout, Critic)가 더 정교한 분석을 할 수 있도록 프롬프트도 개선했습니다. 특히 **Analyst 에이전트**는 이제 현재 리그 순위 차이를 바탕으로 상위권 vs 하위권 대결의 의미를 분석하고, **Scout 에이전트**는 순위표를 기준으로 팀의 상승세/하락세를 판단할 수 있게 되었습니다.

순위 정보는 GameContext 객체에 `home_rank`와 `away_rank` 필드로 추가되어, 에이전트들이 "현재 2위 팀과 8위 팀의 대결"이라는 맥락을 이해하고 분석에 반영할 수 있습니다.

## 최근 10경기 기반 폼 분석

마지막으로 순위표의 승률 계산 로직도 개선했습니다. 시즌 전체 승률 대신 **최근 10경기 승률**을 기본으로 표시하도록 변경했는데, 이는 팀의 현재 컨디션을 더 정확하게 반영하기 위함입니다.

```python
# 최근 10경기 승률 계산
recent = s["results"][-10:]
recent_w = sum(1 for r in recent if r == "W")
recent_l = sum(1 for r in recent if r == "L")
recent_total = recent_w + recent_l  # 무승부 제외
recent_win_pct = round(recent_w / recent_total, 3) if recent_total > 0 else 0.5
```

시즌 초반에는 전체 승률과 최근 10경기 승률이 큰 차이가 없지만, 시즌이 진행될수록 팀의 현재 폼을 더 정확하게 보여주는 지표가 됩니다.

## 배포 최적화의 교훈

이번 작업을 통해 몇 가지 중요한 교훈을 얻었습니다. 첫째, **로컬 개발 환경과 클라우드 배포 환경의 차이**를 항상 고려해야 한다는 점입니다. `.gitignore`된 파일들은 배포 시점에서 존재하지 않는다는 기본적인 사실을 놓치기 쉽죠.

둘째, **데이터 흐름의 일관성**이 중요합니다. 프론트엔드와 백엔드가 같은 `standings.json` 파일을 참조하도록 함으로써 데이터 불일치 문제를 방지했습니다.

셋째, **AI 모델의 성능은 데이터의 품질과 맥락의 풍부함에 직결**됩니다. 단순한 통계 수치뿐만 아니라 현재 순위, 연승/연패 흐름 등 실제 야구팬이 고려하는 요소들을 AI에게도 제공함으로써 더 인간적이고 정교한 분석이 가능해졌습니다.

현재 시스템은 Railway에서 안정적으로 운영되고 있으며, 일일 배치 작업을 통해 ELO 레이팅과 순위표가 실시간으로 업데이트되고 있습니다.