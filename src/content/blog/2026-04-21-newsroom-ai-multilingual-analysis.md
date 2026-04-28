---
title: "AI 뉴스 분석에서 언어 장벽 뚫기: 한국어→영어 키워드 번역으로 외신 검색 정확도 높이기"
description: "한국어 토픽으로 외신을 검색할 때 매번 '관련 외신 없음'이 뜨는 문제를 Claude Haiku의 실시간 번역으로 해결한 이야기입니다."
pubDate: 2026-04-21
repo: newsroom-ai
repoDisplayName: Newsroom AI
tags: ["newsroom-ai", "bugfix", "python", "react"]
commits: ["215a5a28098bbe05c4981cc335b6e6b5d4dae911", "feb2a1522cc6ab07e149f531d970750b7c12a1af"]
---
## 문제: 한국어로 외신을 찾을 수 없다

뉴스룸 AI에서 국내외 관점 비교 기능을 만들면서 골치 아픈 문제가 하나 있었습니다. 사용자가 "윤석열 대통령"이나 "호르무즈 해협" 같은 한국어 키워드로 검색하면 국내 기사는 잘 나오는데, **외신은 항상 '관련 기사 없음'**이 떴던 겁니다.

이유는 간단했습니다. 국내 뉴스 제목은 한국어로 되어 있고, 외신 제목은 영어로 되어 있는데, 똑같은 한국어 키워드로 두 곳을 모두 검색하고 있었거든요. "윤석열"로 Reuters 기사를 찾으려 해봤자 나올 리가 없죠.

기존 코드를 보면 이런 식이었습니다:

```python
# 국내, 외신 구분 없이 동일한 한국어 키워드 사용
keywords = topic.split()
conditions = [Article.title.ilike(f"%{kw}%") for kw in keywords]
```

## 해결책: Haiku가 실시간 번역사가 되다

해결책은 의외로 심플했습니다. **Claude Haiku**를 번역기로 활용해서 한국어 토픽을 영어 검색 키워드로 변환하는 것이었죠. 단순 번역이 아니라 Reuters나 BBC에서 실제로 사용하는 표준 영문 표기로 바꿔주는 게 포인트였습니다.

새로운 번역 시스템 프롬프트를 만들었습니다:

```python
_TRANSLATE_SYSTEM = """
You convert a Korean news topic into English search keywords for foreign news.

Rules:
- Produce 3~5 English keywords/phrases (people, places, organizations, events).
- Always use the standard English spelling used by Reuters/BBC/AP.
  Korean president names, country names, currencies etc. should map to their
  English equivalents (e.g. "호르무즈 해협" → "Strait of Hormuz", "윤석열" → "Yoon Suk-yeol").
- Return STRICT JSON only:
{"english_terms": ["term1", "term2", ...]}
"""
```

핵심은 단순 번역이 아니라 **뉴스 매체에서 실제 쓰는 표준 표기**로 변환하는 것이었습니다. "윤석열"을 "Yoon Suk-yeol"로, "호르무즈 해협"을 "Strait of Hormuz"로 바꿔주는 식으로요.

## 이중 검색 시스템 구축

이제 검색이 두 갈래로 나뉩니다:

```python
# 국내는 한국어 그대로
domestic_terms = [t for t in topic.split() if t]
domestic_articles = await _fetch_articles_by_topic(
    db, domestic_terms, target_date, source_type="domestic"
)

# 외신은 영어 번역 키워드로
foreign_terms = await _expand_foreign_search_terms(topic)
foreign_articles = await _fetch_articles_by_topic(
    db, foreign_terms, target_date, source_type="foreign"
)
```

**Haiku 한 번 호출**로 3~5개의 영어 키워드를 받아와서 외신 검색에만 사용합니다. 번역이 실패하면 한국어 원문으로 폴백하도록 안전장치도 만들어뒀고요.

## 사용자 경험 개선: 영어 논조를 한국어로

기술적 문제를 해결하면서 UX 개선도 함께 했습니다. 관점 비교 결과에서 논조가 "supportive", "critical" 같은 영어로 표시되고 있었거든요. 한국 사용자에게는 직관적이지 않죠.

간단한 매핑 테이블을 만들어 해결했습니다:

```javascript
const TONE_LABEL: Record<string, string> = {
  supportive: "우호적",
  critical: "비판적", 
  neutral: "중립적",
  cautious: "신중"
};
```

이제 "논조: supportive" 대신 **"논조: 우호적"**으로 표시됩니다. 작은 변화지만 사용자 입장에서는 훨씬 자연스럽게 느껴질 거예요.

## 왜 이 방법을 선택했나

처음에는 미리 번역된 키워드 사전을 만들거나, 검색 시점에 무거운 번역 API를 쓰는 방법도 고려했습니다. 하지만 **Haiku의 실시간 번역**을 선택한 이유가 있어요:

**비용 효율성**: Haiku는 빠르고 저렴합니다. 번역 수준의 작업에는 충분하죠.

**맥락 인식**: 단순 번역이 아니라 뉴스 도메인에 특화된 키워드 추출이 가능합니다.

**유지보수성**: 새로운 인명이나 지명이 나와도 별도 업데이트 없이 자동으로 처리됩니다.

## 결과와 앞으로

이제 "윤석열 대통령 국정감사"로 검색하면 국내 기사와 함께 "Yoon Suk-yeol audit" 관련 Reuters, BBC 기사도 함께 나옵니다. 언어 장벽이 사라지면서 **진짜 국내외 관점 비교**가 가능해진 거죠.

물론 완벽하지는 않습니다. 가끔 번역이 애매하거나 너무 구체적인 한국 상황은 외신에서 다루지 않는 경우도 있어요. 하지만 '관련 외신 없음'이 기본값이던 상황에서는 확실한 개선입니다.

다음에는 번역 품질을 더 높이거나, 사용자가 직접 검색 키워드를 수정할 수 있는 기능도 추가해볼 생각입니다. AI 뉴스 분석에서 **언어는 더 이상 장벽이 아니에요**.