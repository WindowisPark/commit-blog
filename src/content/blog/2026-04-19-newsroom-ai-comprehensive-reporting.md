---
title: "뉴스룸 AI 일일 보고 시스템 구축기: 5개 섹션 통합 허브로 기자 워크플로 완결하기"
description: "기자가 매일 아침 한 페이지만 열면 모든 뉴스 보고가 완료되도록 설계한 통합 대시보드와 실시간 워치리스트 시스템 개발 경험"
pubDate: 2026-04-19
repo: newsroom-ai
repoDisplayName: Newsroom AI
tags: ["newsroom-ai", "feature", "react", "bugfix", "python"]
commits: ["a404303cc69c3b3773ac0df9a09b1cbad83fd187", "c443df23c0cae03128f7e88e942d3ac6ded558b9", "4c7ae7bf6bb0748255716c74975d2e032a0cdacc"]
---
## 기자를 위한 '단일 진입점' 아이디어

뉴스룸에서 일하는 기자들의 아침은 늘 바쁘다. 여러 사이트를 돌아다니며 브리핑을 확인하고, 주요 이슈를 파악하고, 속보를 체크하는 일상을 반복한다. **Newsroom AI** 프로젝트를 진행하면서 "기자가 아침에 딱 한 페이지만 열면 오늘의 보고가 완결되도록 만들 수 있지 않을까?"라는 생각에서 시작된 것이 바로 `/reports` 페이지의 대규모 리뉴얼이다.

기존에는 단순한 브리핑 페이지였지만, 이를 **일일 보고 허브**로 재편하여 헤드라인부터 워치리스트 매칭까지 5개 핵심 섹션을 하나의 화면에 담았다. 기자의 자연스러운 아침 루틴을 코드로 구현하는 도전이었다.

## 병렬 로딩과 실시간 업데이트 아키텍처

가장 까다로운 부분은 성능이었다. 5개 섹션의 데이터를 순차적으로 불러오면 로딩 시간이 길어져 사용자 경험이 떨어진다. 이를 해결하기 위해 **병렬 로딩 전략**을 도입했다:

```typescript
const [briefingRes, agendaRes, newsRes, watchRes] = await Promise.all([
  getBriefing().catch(() => null),
  getAgenda({ top_n: "5" }).catch(() => null),
  getNews({ sort_by: "importance", limit: "20" }).catch(() => null),
  getWatchlist().catch(() => null),
]);
```

4개의 주요 API 호출을 동시에 실행하고, 개별 실패가 전체 페이지를 망가뜨리지 않도록 각각 예외 처리를 적용했다. 워치리스트의 경우 활성 키워드 상위 5개에 대해 2차 쿼리로 최근 기사를 수집하는 추가 로직도 구현했다.

실시간성을 위해서는 **SSE(Server-Sent Events)** 구독을 활용했다. `report_generated`, `analysis_complete`, `watchlist_match`, `breaking_alert` 이벤트를 수신하면 자동으로 해당 섹션을 재조회하여 항상 최신 상태를 유지한다.

## 데이터 파이프라인의 숨겨진 함정들

프론트엔드가 완성되어도 백엔드에서 예상치 못한 문제들이 터져나왔다. 특히 `/analysis/agenda` 호출 시 404가 반복되는 현상이 있었는데, 원인을 파고들어보니 세 가지 복합적인 문제였다.

첫째는 **스케줄러 쿼리 순서** 문제였다. `ORDER BY` 구문이 없어서 오래된 기사부터 30건씩 처리하다 보니, 당일 수집된 기사가 밀려 하루 뒤에야 분석되는 상황이었다. `ORDER BY collected_at DESC`를 추가해 최신순 우선 처리로 변경했다.

둘째는 **카테고리 정규화** 문제였다. Claude Haiku 모델이 가끔 정의된 카테고리 외에 `science`, `technology`, `political` 같은 변이형을 반환하면서 스키마 검증에서 실패하는 경우가 있었다:

```python
_CATEGORY_ALIASES = {
    "science": "tech",
    "technology": "tech",
    "political": "politics",
    "economic": "economy",
    # ...
}

def _normalize_category(raw: object) -> object:
    if not isinstance(raw, str):
        return raw
    key = raw.strip().lower()
    if key in CATEGORIES:
        return key
    return _CATEGORY_ALIASES.get(key, raw)
```

마지막으로는 **폴백 로직** 부재였다. 새벽이나 시스템 재기동 직후에는 오늘자 분석이 아직 없을 수 있는데, 이때도 기자가 대시보드에서 직전 의제를 확인할 수 있도록 가장 최근 `AgendaReport`로 폴백하는 로직을 추가했다.

## 워크플로 완결을 위한 인터랙션 설계

단순히 정보를 보여주는 것을 넘어서, 실제 기사 작성까지 연결되는 **워크플로 완결성**에 집중했다. 각 섹션마다 '복사' 버튼과 '초안 작성' 연결점을 배치하여 분석-판단-생성 루프를 자연스럽게 이어갔다.

헤드라인 추천에서는 주제 입력 시 관련 기사를 병렬 조회하여 `DraftDialog`에 전달하고, 의제 분석에서는 `related_article_ids`를 활용해 다중 기사 교차 참조가 가능하도록 했다. 개별 기사 상세 페이지에서는 제목·매체·발행일·요약·URL을 조립한 스니펫을 복사할 수 있게 구현했다.

새로 추가된 `/watchlist` 페이지는 **키워드 매칭 시스템**의 UI 완성체다. 기자가 관심 키워드를 등록하면 새로 수집·분석된 기사에 키워드가 포함될 때 실시간 알림을 받는다. `watchlist_match` SSE 이벤트를 수신하면 자동으로 매칭 횟수와 최근 시각을 갱신하여 항상 최신 상태를 유지한다.

## 사용자 중심 UX의 디테일

기술적 완성도도 중요하지만, 실제 기자들이 매일 사용할 도구라는 점에서 **사용자 경험**에도 많은 신경을 썼다. 사이드바에서 '리포트' → '일일 브리핑'으로 라벨을 변경하고 네비게이션 최상단에 배치했다. 메일 포맷도 기존 헤드라인+요약에서 '오늘의 주요 의제' 블록을 추가해 더 풍부한 정보를 담았다.

속보 감지는 `importance_score >= 8.5` 임계값을 적용해 정말 중요한 뉴스만 필터링하고, 각 카드마다 직관적인 복사·초안 작성 버튼을 배치했다. 워치리스트 매칭에서는 활성 키워드 최대 5개에 대해 최근 기사 3건씩만 보여주어 정보 과부하를 방지했다.

이런 세심한 디테일들이 모여 기자가 "매일 아침 이 한 페이지만 열면 된다"는 목표를 달성할 수 있게 되었다. 기술은 결국 사람을 위한 것이라는 점을 새삼 깨달은 프로젝트였다.