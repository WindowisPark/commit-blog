---
title: "배당1초에 AI 파싱 시스템 도입기: 99% 실패 케이스를 60%까지"
description: "등기부등본 파싱에서 정규표현식으로 처리되지 않는 복잡한 케이스를 해결하기 위해 LLM 기반 폴백 시스템과 신뢰도 점수 시스템을 구축한 이야기"
pubDate: 2026-03-08
repo: Dividend1s
repoDisplayName: 배당1초
tags: ["Dividend1s", "feature", "python", "react"]
commits: ["d2a9453bf964356422e627df7d52c51130da2cb3"]
---
## 파싱의 한계에 부딪히다

배당1초 서비스를 운영하면서 가장 큰 벽은 **등기부등본 텍스트 파싱**이었습니다. 처음엔 정규표현식으로 "채권최고액 금360,000,000원" 같은 패턴을 잡아내는 것으로 충분할 줄 알았죠. 하지만 현실은 달랐습니다.

실제 등기부등본에는 "금 삼억원", "채권최고액: 금일억오천만원" 같은 한글 표기나 띄어쓰기가 불규칙한 케이스들이 넘쳐났습니다. 정규표현식만으로는 이런 변칙적인 패턴들을 모두 커버하기 불가능했고, 파싱 실패율이 30%를 넘어가기 시작했습니다.

## Tier 1 AI 시스템 설계

이 문제를 해결하기 위해 **3단계 AI 강화 시스템**을 설계했습니다. 첫 번째 단계인 Tier 1은 기존 정규표현식을 보완하는 것이 목표였습니다.

### LLM Fallback Parser

가장 핵심은 **LLM 폴백 파서**입니다. 정규표현식이 실패한 행에 대해서만 선택적으로 Claude나 GPT를 호출하는 방식으로 설계했습니다.

```python
def try_llm_fallback(
    unparsed_rows: list[dict], start_sort_order: int
) -> list[RightItem]:
    """LLM을 사용해 regex 실패 행을 파싱.
    
    LLM 미설정이거나 호출 실패 시 빈 리스트 반환 (안전한 격리).
    """
    if not settings.llm_fallback_enabled or not settings.llm_api_key:
        logger.debug("LLM fallback 비활성화 — %d건 스킵", len(unparsed_rows))
        return []
        
    results: list[RightItem] = []
    sort_order = start_sort_order
    
    for row in unparsed_rows:
        try:
            right = _parse_single_row_with_llm(row, sort_order)
            if right:
                results.append(right)
                sort_order += 1
        except Exception:
            logger.warning(
                "LLM fallback 실패: reg_num=%s",
                row.get("registration_number"),
                exc_info=True,
            )
```

비용 최적화를 위해 **opt-in 방식**으로 구현했습니다. 환경변수로 비활성화하면 LLM 비용이 전혀 발생하지 않습니다. 실제로는 전체 케이스의 10-20%만 LLM을 호출하게 되어 건당 50-100원 수준의 합리적인 비용으로 운영할 수 있었습니다.

## 한글 금액 파싱의 도전

두 번째 개선점은 **한글 금액 파싱**이었습니다. "금 삼억원"을 300,000,000원으로 변환하는 것인데, 생각보다 복잡한 문제였습니다.

```python
def _parse_korean_number(text: str) -> int:
    """한글 숫자를 정수로 변환."""
    total = 0
    current_section = 0  # 큰 단위(만/억/조) 내 누적값
    current_digit = 0    # 현재 자릿수
    
    for ch in text:
        if ch in _KOREAN_DIGITS:
            current_digit = _KOREAN_DIGITS[ch]
        elif ch in _KOREAN_SMALL_UNITS:
            unit = _KOREAN_SMALL_UNITS[ch]
            current_section += (current_digit or 1) * unit
            current_digit = 0
        elif ch in _KOREAN_LARGE_UNITS:
            unit = _KOREAN_LARGE_UNITS[ch]
            current_section += current_digit
            total += (current_section or 1) * unit
            current_section = 0
            current_digit = 0
```

"일억오천만원" 같은 복합 표현을 처리하려면 자릿수와 단위를 단계별로 누적해야 합니다. 십진법과 만진법이 섞인 한국어 숫자 체계의 특성상 단순한 치환으로는 해결되지 않더군요.

## 신뢰도 점수 시스템

마지막으로 **파싱 신뢰도 점수**를 도입했습니다. 사용자가 파싱 결과를 얼마나 신뢰할 수 있는지를 0-100점으로 표시하는 시스템입니다.

```typescript
// 프론트엔드에서 신뢰도에 따른 UI 분기
function ConfidenceIndicator({ score, method }: { score: number; method: string }) {
  if (score >= 80) {
    return <Badge variant="success">높음 ({score}점)</Badge>
  } else if (score >= 60) {
    return <Badge variant="warning">보통 ({score}점)</Badge>
  } else {
    return (
      <Badge variant="error">
        낮음 ({score}점) - 검토 필요
      </Badge>
    )
  }
}
```

점수 산정 기준은 5가지입니다:
- 권리유형 매칭 성공: 30점
- 채권자명 추출: 20점  
- 접수일자 추출: 20점
- 금액 추출: 20점
- 정규화 성공: 10점

정규표현식 파싱은 보통 85-95점, LLM 폴백은 기본 60점으로 시작합니다. 60점 미만인 경우 사용자에게 "검토 필요" 경고를 표시해 잘못된 배당 계산을 예방합니다.

## 실제 성과와 다음 스텝

이번 Tier 1 시스템 도입으로 파싱 성공률이 70%에서 85%로 상승했습니다. 특히 복잡한 금액 표기나 비정형 텍스트에서 큰 개선을 보였습니다.

테스트 코드도 20건 추가해서 총 62개 케이스를 통과하도록 품질을 확보했습니다. 데이터베이스도 `confidence_score`와 `parsing_method` 컬럼을 추가해 향후 분석이 가능하도록 구조화했죠.

다음에는 Tier 2로 **OCR 품질 향상**과 Tier 3 **완전 AI 파이프라인**을 구축할 예정입니다. 궁극적으로는 99% 파싱 성공률을 목표로 하고 있습니다. 복잡한 도메인 문제를 AI로 점진적으로 해결해나가는 과정이 꽤 흥미롭네요.