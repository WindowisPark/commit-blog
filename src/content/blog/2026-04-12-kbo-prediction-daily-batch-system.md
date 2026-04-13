---
title: "데이터 수집부터 예측 검증까지 — KBO 데이터 파이프라인 자동화하기"
description: "매일 실행되는 KBO 경기 데이터 수집과 ELO 레이팅 업데이트, 그리고 예측 적중률 검증을 자동화한 과정을 소개합니다."
pubDate: 2026-04-12
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "bugfix", "python"]
commits: ["9dd7fceb374ca25eaadabcfb49d4a364c995c4ba", "896ebcf9aeec9ff1f8509d27afe9c6ff87fc0875", "1c042f42d3482768fbb4a8c25bc25b130b2df5d0", "56d647b3326b8daee40a0ea7800f5144a6909864", "077322e26c668e49805be1b4f6471c6b5e66badb", "d816c20602f09e8701abeb49f7b0d1281b6895d6", "5790325ad00a6ff08946592fb1160c3b088bdf29", "9995786ef3c9bdb6065e201b9a5761f85e75ec7f"]
---
## 매일 돌아가는 야구 데이터 수집기

KBO 예측 서비스를 운영하다 보니 가장 중요한 건 **신뢰할 수 있는 데이터**였다. 경기 결과를 실시간으로 수집하고, ELO 레이팅을 업데이트하며, 예측 적중률을 검증하는 작업을 매일 수동으로 하기엔 너무 번거로웠다. 그래서 이 모든 과정을 자동화하는 배치 시스템을 만들었다.

## GitHub Actions로 매일 자동 실행

가장 먼저 해결해야 했던 건 **언제, 어떻게 실행할 것인가**였다. KBO 경기는 보통 오후 6시 30분에 시작해서 밤 10-11시경 끝나니, 다음날 새벽에 전날 경기 결과를 수집하는 게 합리적이었다.

```yaml
on:
  schedule:
    - cron: '0 15 * * *'  # UTC 15:00 = KST 00:00
  workflow_dispatch:
    inputs:
      date:
        description: '대상 날짜 (YYYYMMDD). 비워두면 어제'
        required: false
```

매일 자정에 자동 실행되지만, 수동으로도 특정 날짜를 지정해서 실행할 수 있게 했다. 데이터가 누락됐거나 재처리가 필요한 경우를 대비한 것이다.

## 3단계 데이터 처리 파이프라인

배치 작업은 크게 세 단계로 나누어 설계했다. 각 단계가 독립적으로 동작하면서도 서로 연결되는 구조다.

**1단계: 경기 결과 수집**
경기 ID, 점수, 선발 투수 등 기본 정보부터 구장, 중계 방송사까지 상세한 데이터를 수집한다. 중요한 건 팀명 통일이었다. 'KIA'와 'KIA 타이거즈', '키움'과 'Heroes' 같은 표기 차이를 `unify_team()` 함수로 정규화했다.

**2단계: 예측 적중률 검증**
여기서 가장 까다로운 문제가 있었다. **최신 예측 데이터는 PostgreSQL에만 있고 JSON 파일엔 없다**는 것이었다. API를 통해 저장된 예측들은 데이터베이스에만 존재했기 때문에, JSON 파일 기반으로 매칭하면 아무것도 찾을 수 없었다.

```python
# DB에서 미검증 예측을 직접 업데이트
unverified = db.query(PredictionHistory).filter(
    PredictionHistory.actual_winner.is_(None),
).all()

for row in unverified:
    key = f"{row.date}_{row.home_team}_{row.away_team}"
    if key in result_map:
        matched = result_map[key]
        row.actual_winner = matched["actual_winner"]
        row.is_draw = matched["is_draw"]
```

이제 DB를 우선으로 하고 JSON은 백업용으로만 사용한다. 무승부는 적중률 계산에서 제외하고, 같은 경기를 여러 번 예측한 경우엔 가장 최신 예측만 사용한다.

**3단계: ELO 레이팅과 순위표 업데이트**
ELO 시스템은 체스에서 시작된 레이팅 알고리즘인데, 야구에도 잘 적용된다. 강한 팀을 이기면 많은 포인트를 얻고, 약한 팀에게 지면 많이 잃는 방식이다.

## 인프라 연결의 함정

배치 시스템을 만들면서 **DATABASE_URL 이슈**를 겪었다. Railway에서 제공하는 내부 URL(`postgres.railway.internal`)은 Railway 내부에서만 접근 가능한데, GitHub Actions에서는 당연히 접근할 수 없었다. 환경변수를 추가하고 URL 변환 로직도 넣어야 했다.

```python
# asyncpg → psycopg2 변환 (동기 엔진용)
_sync_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
```

비동기 라이브러리용 URL을 동기 처리용으로 변환하는 작업도 필요했다.

## 결과: 안정적인 데이터 품질

이제 매일 새벽마다 자동으로 실행되는 배치가 다음 작업들을 처리한다:

- 전날 경기 결과 5경기 수집 및 저장
- 10개 팀 ELO 레이팅 업데이트  
- 미검증 예측들의 적중 여부 확인
- 팀별 승률, 연속 기록 등 순위표 갱신

특히 예측 적중률이 실시간으로 계산되니 서비스의 신뢰성이 크게 향상됐다. 사용자들은 언제든 정확한 예측 성과를 확인할 수 있고, 개발자인 나는 매일 수동으로 데이터를 업데이트할 필요가 없어졌다.

자동화의 힘은 **일관성**에 있다. 사람이 하면 가끔 빠뜨리거나 실수할 수 있지만, 시스템은 매일 정확히 같은 시간에 같은 방식으로 작업을 수행한다. KBO 시즌이 진행되는 동안 이 파이프라인이 쌓아가는 데이터가 예측 모델의 품질을 결정할 것이다.