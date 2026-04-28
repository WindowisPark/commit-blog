---
title: "AI 뉴스룸에 팩트 체크 3층 방어선을 구축하다"
description: "LLM 할루시네이션 문제를 해결하기 위해 프롬프트 강화, 자동 검증, 편집자 확인의 3단계 방어 시스템을 구축한 과정을 다룹니다."
pubDate: 2026-04-19
repo: newsroom-ai
repoDisplayName: Newsroom AI
tags: ["newsroom-ai", "feature", "react", "python"]
commits: ["4bcc46567c26973568d6a688bfa8cfad68e76cc6", "f35c3c8708e24a93e52d1db19999ab7a1cdc26eb"]
---
## 완전 자동 팩트 체크의 한계를 인정하다

LLM 기반 뉴스 생성 시스템을 개발하면서 가장 큰 고민은 **할루시네이션** 문제였다. AI가 그럴듯하지만 틀린 정보를 생성하는 현상은 뉴스 분야에서 치명적이다. 학계에서도 완전한 자동 팩트 체크는 아직 미해결 문제라는 점을 솔직히 인정하고, 현실적인 3층 방어선을 설계했다.

첫 번째는 **프롬프트 강화**(L1 Hardening), 두 번째는 **규칙 기반 자동 검증**(L2 Detection), 세 번째는 **편집자의 개별 확인**(L3 HITL - Human-in-the-loop)이다. 각 단계가 완벽하지 않더라도, 세 겹으로 쌓인 방어막이 신뢰성을 크게 높일 수 있다고 판단했다.

## L1: 프롬프트에 팩트 보호 절대 준수 조항 추가

가장 기본적인 방어선은 LLM에게 더 엄격한 지침을 주는 것이다. 기존 프롬프트에 '팩트 보호 절대 준수' 섹션을 새로 추가했다.

```python
【팩트 보호 — 절대 준수】
입력 기사·참고 기사에 명시되지 않은 다음 항목을 임의 추가·창작하지 마세요:
- **인물의 직책·소속** (예: "○○ 대통령", "○○ 장관")
- **수치·금액·퍼센트·연도** — 근사·추정치는 '약', '~로 추정된다' 로 명시
- **발언 인용** — 직접 인용부호("") 안에는 원문에 동일하게 표기된 문구만
```

특히 **hedging**을 강제했다. 확실하지 않은 정보는 '~로 알려졌다', '~로 추정된다' 같은 유보적 표현을 쓰도록 명시했다. 완벽한 해결책은 아니지만 LLM이 단정적인 거짓 정보를 생성할 확률을 줄이는 효과가 있다.

## L2: 3종 자동 검증기로 의심 구간 플래그

두 번째 방어선은 생성된 텍스트를 자동으로 분석해 의심스러운 부분을 찾아내는 것이다. 완전한 팩트 체크는 불가능하지만, 명백한 오류는 규칙 기반으로도 잡을 수 있다.

```python
def verify_article_draft(
    title: str,
    lead: str,
    body: str,
    background: str,
    source_articles: Iterable,
) -> list[FactIssue]:
    """3종 검증기 병렬 실행"""
    combined = "\n".join([title, lead, body, background])
    corpus = _build_source_corpus(list(source_articles))
    
    issues: list[FactIssue] = []
    issues.extend(_check_entity_kb(combined))      # KB 직책 대조
    issues.extend(_check_numbers(combined, corpus))  # 수치 grounding
    issues.extend(_check_entity_grounding(combined, corpus))  # 인물 grounding
    return issues
```

**Entity KB 검증**은 공직자 직책을 체크한다. YAML 파일에 "이재명: 대통령", "홍준표: 대구시장" 같은 정보를 저장해두고, 생성문에서 "홍준표 대통령"이 나오면 즉시 플래그한다.

**Number grounding**은 생성문의 모든 숫자를 원문 기사에서 찾는다. "60만 원", "2.5%" 같은 수치가 원본에 없으면 의심 표시를 한다. 완벽하지는 않지만 명백한 수치 조작은 걸러낼 수 있다.

**Entity grounding**은 인명을 체크한다. "김철수 의원" 같은 표현에서 "김철수"를 추출해 원문에 등장하는지 확인한다. 완전히 허구의 인물이 생성되는 것을 방지한다.

## L3: 편집자의 개별 확인과 승인 가드

가장 중요한 마지막 방어선은 사람의 판단이다. 자동 검증에서 발견된 모든 이슈를 편집자가 개별적으로 확인할 수 있는 UI를 만들었다.

```tsx
const handleAckIssue = async (issue: FactIssue, acknowledged: boolean) => {
  const note = acknowledged
    ? prompt("확인 메모 (선택)", "원문 확인 완료") ?? undefined
    : undefined;
  const res = await acknowledgeFactIssue(item.id, issue.id, {
    acknowledged,
    acknowledged_by: "편집자",
    note,
  });
  setItem(res.data);
};
```

편집실 페이지에 들어가면 **FactCheckCard**가 나타나고, 각 경고마다 [확인] 버튼이 있다. 편집자가 클릭하면 메모를 남길 수 있고, 확인된 이슈는 시각적으로 구분된다. 진행바로 전체 진척도도 한눈에 볼 수 있다.

무엇보다 중요한 것은 **승인 가드** 시스템이다. HIGH 등급 경고가 하나라도 미확인 상태면 승인 버튼이 비활성화된다. 툴팁에 "미확인 팩트 경고 N건을 먼저 확인하세요"라는 메시지가 뜨고, 편집자가 모든 HIGH 이슈를 점검해야만 게시할 수 있다.

## 현실적인 한계와 향후 과제

이 시스템도 완벽하지는 않다. 근사값 변환("1만"과 "10,000")에서 false positive가 발생할 수 있고, 인과관계나 뉘앙스 같은 복잡한 팩트는 자동으로 검증할 수 없다. Entity KB도 수작업으로 관리해야 한다.

하지만 **실용적인 접근**이라고 생각한다. 완벽한 자동 팩트 체크를 기다리기보다는, 현재 기술로 가능한 최선의 방어선을 구축하는 것이 더 현실적이다. 편집자의 전문성과 AI의 효율성을 조합한 하이브리드 워크플로가 당분간은 최선의 해답일 것이다.

테스트 커버리지도 88개에서 97개로 늘어났다. 각 검증 로직의 단위 테스트와 API 통합 테스트를 추가해 시스템의 신뢰성을 높였다. 뉴스 생성 AI의 신뢰도를 높이는 것은 기술적 도전이면서 동시에 저널리즘 윤리의 문제이기도 하다는 것을 다시 한번 확인할 수 있었다.