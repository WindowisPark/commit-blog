---
title: "AI 기반 뉴스룸 자동화 시스템 개발 - 초안 생성부터 편집실 워크플로까지"
description: "LLM을 활용한 뉴스 기사 자동 초안 생성 시스템을 구축하고, RAG 기술과 팩트체킹을 통해 언론사 실무에 적합한 편집실 워크플로를 완성한 과정을 담았습니다."
pubDate: 2026-04-20
repo: newsroom-ai
repoDisplayName: Newsroom AI
tags: ["newsroom-ai", "feature", "python", "react", "docs", "chore"]
commits: ["b31db4b59842052cd6b11c8865f2a8e9978eeb5b", "eef1535b6dbe768eec428db888f96d780be4ca1a", "54db3fe5657d78f62b39aef5eed4bbd8e3279a61", "1ecc5682b5e2f70b2d4f00201a421a3829831446", "def2113f84d3d89a20cd172288586b5cf62258bc", "b0fd48dac134ed3478e28350a87aecf241a7e151", "4bcc46567c26973568d6a688bfa8cfad68e76cc6", "f35c3c8708e24a93e52d1db19999ab7a1cdc26eb", "9ac8784012f674bb4675273fa4be5f16021fff7d", "88de7afa5dcf7641d00a46ca528f4a906dfacce7", "1fe55f792a99a2dae72d9aadf033a9d2be3de433", "781ebb1cf54949eed5fe0008d542d42863a01729"]
---
## AI 뉴스룸의 새로운 패러다임

최근 언론사들이 AI 도입을 검토하면서 가장 큰 고민은 "어떻게 기자의 전문성을 보완하면서도 신뢰할 수 있는 콘텐츠를 생성할 것인가"입니다. 단순히 ChatGPT로 기사를 쓰는 것이 아닌, 실제 편집실에서 사용할 수 있는 체계적인 시스템을 만들어보았습니다.

이 프로젝트는 **수집→분석→초안생성→편집→결재**까지 이어지는 완전한 뉴스룸 워크플로를 AI로 자동화하면서도, 저널리즘의 핵심 가치인 정확성과 신뢰성을 지키는 것이 목표였습니다.

## RAG 기반 초안 생성의 핵심 설계

가장 흥미로운 부분은 **Retrieval-Augmented Generation**을 활용한 기사 초안 생성 시스템입니다. 단순히 LLM에게 "기사를 써줘"라고 하는 것이 아니라, 세 가지 층위의 정보를 체계적으로 제공합니다.

```python
# 자사 기사 참조 검색 로직
async def _retrieve_references(
    db: AsyncSession,
    keywords: list[str],
    exclude_ids: list[UUID],
) -> list[dict]:
    # 키워드 매칭 + recency 점수로 상위 N건 반환
    # score = 0.6 × (키워드 매칭 수) + 0.4 × recency_score
```

첫 번째는 **자사 과거 보도 참조**입니다. 서울신문의 지난 90일간 기사 중에서 관련 키워드가 겹치는 것들을 찾아내고, 최신성과 연관성을 종합해 상위 3건을 선별합니다. 이를 통해 LLM이 "본사 보도에 따르면"이라는 표현으로 자연스럽게 인용할 수 있게 됩니다.

두 번째는 **스타일 앵커**입니다. 같은 카테고리의 자사 기사 1건을 few-shot 예시로 제공해 일반적인 LLM 문체가 아닌 해당 매체의 톤과 어조에 가깝게 유도합니다. 완벽한 재현은 아니지만 유의미한 개선이 있었습니다.

```python
def _build_style_anchor_block(anchor: dict | None) -> str:
    if not anchor:
        return ""
    lead = (anchor.get("description") or anchor.get("content") or "")[:300]
    return (
        "\n=== 톤 샘플 (서울신문, 동일 카테고리) ===\n"
        f"제목: {anchor['title']}\n"
        f"도입부: {lead}\n"
        "※ 위 샘플의 문장 길이·어휘 레벨·구성 패턴을 참고해 초안 본문의 톤을 맞추세요.\n"
    )
```

## 3층 방어선의 팩트체킹 시스템

 AI가 생성한 콘텐츠의 가장 큰 위험은 할루시네이션입니다. 이를 해결하기 위해 3단계 방어선을 구축했습니다.

**L1. 하드닝(Hardening)**: 프롬프트 레벨에서 "원문에 없는 직책·수치·인명·지명 추가 금지"를 명시적으로 강제합니다.

**L2. 자동 검증**: 규칙 기반으로 생성된 텍스트를 스캔합니다.

```python
def _check_entity_kb(text: str) -> list[FactIssue]:
    """생성문의 (인물, 직책) 쌍을 KB의 current_role과 대조"""
    kb = {e["name"]: e for e in _load_kb()}
    for name, role in _extract_role_claims(text):
        entry = kb.get(name)
        if not entry:
            continue
        correct = entry.get("current_role", "")
        if role != correct:
            issues.append(FactIssue(
                severity="high",
                kind="role_mismatch",
                claim=f"{name} {role}",
                evidence=f"{name}의 현재 직책은 '{correct}'",
            ))
```

예를 들어 "이준석 대통령"이라고 잘못 생성되면, Entity KB에서 "이준석"의 current_role이 "국회의원"임을 확인하고 high-severity 경고를 발생시킵니다.

**L3. Human-in-the-Loop**: 편집자가 각 경고를 개별적으로 확인하고, high-severity 경고가 모두 처리되기 전까지는 승인 버튼이 비활성화됩니다.

## 편집실 중심의 실무적 접근

기술적 완성도만큼 중요한 것이 실제 편집실에서 사용할 수 있는 워크플로입니다. 단순히 "초안을 생성해드립니다"로 끝나는 것이 아니라, 편집→검토→승인→게시까지 이어지는 완전한 시스템을 구현했습니다.

편집실 페이지에서는 **내 초안 / 결재 대기 / 게시 완료 / 반려** 4개 탭으로 상태를 관리하고, 각 기사마다 팩트체킹 결과가 진행바로 표시됩니다. 미확인된 경고가 남아있으면 상급자도 승인할 수 없도록 가드를 설정했습니다.

```javascript
const approveBlocked = canApproveReject && unackHigh.length > 0;

<Button
  disabled={approveBlocked}
  title={approveBlocked ? `미확인 팩트 경고 ${unackHigh.length}건을 먼저 확인하세요` : undefined}
>
  승인·게시
  {approveBlocked && ` (경고 ${unackHigh.length}건 미확인)`}
</Button>
```

## 학계 근거에 기반한 설계 결정

이 시스템의 모든 설계 결정은 감이 아닌 학계와 업계의 근거에 기반했습니다. RAG 품질 평가에 관한 2025년 서베이 논문들을 참조해 단순 top-k 검색이 아닌 메타데이터 인식 검색과 reranking을 적용했고, Amazon Science의 few-shot 스타일 전이 연구를 바탕으로 톤 앵커를 도입했습니다.

특히 FActScore와 FacTool 같은 자동 팩트체킹 연구들이 아직 production 수준에 도달하지 못했다는 한계를 정직하게 인정하고, 현실적인 하이브리드 접근을 택했습니다.

## 기술적 도전과 해결 과정

개발 과정에서 가장 까다로웠던 부분은 **상태 관리와 데이터 일관성**이었습니다. 초안이 편집되면 팩트체킹을 재실행해야 하는데, 기존에 편집자가 확인한 경고들은 보존해야 했습니다.

```python
# 기존 확인 상태 보존 로직
prior_ack: dict[str, dict] = {
    i.get("claim", ""): i
    for i in (item.fact_issues or [])
    if i.get("acknowledged")
}
for issue in new_issues:
    prior = prior_ack.get(issue.get("claim", ""))
    if prior:
        issue["acknowledged"] = True
        issue["acknowledged_by"] = prior.get("acknowledged_by")
        issue["acknowledged_at"] = prior.get("acknowledged_at")
```

또한 LLM provider 오류를 적절히 핸들링하는 것도 중요했습니다. Anthropic API에서 크레딧 부족이나 rate limit 에러가 발생하면 500 대신 503으로 변환해 CORS 헤더가 포함된 응답을 보내도록 했습니다.

## 실무 도입 가능성과 향후 전망

이 시스템의 가장 큰 의의는 **완전 자동화가 아닌 인간-AI 협업**에 초점을 맞춘 점입니다. AI가 초안을 생성하지만 편집자의 검토와 승인 없이는 게시될 수 없으며, 모든 과정이 투명하게 기록됩니다.

현재는 Entity KB를 수작업으로 관리하고 있지만, 향후에는 정부 공개 API나 국회 의원 정보와 연동해 자동화할 수 있을 것입니다. 또한 초안 생성뿐만 아니라 헤드라인 추천, 관련 기사 제안, 팩트체킹 결과 해석 등으로 확장 가능한 구조로 설계했습니다.

실제 언론사에 도입한다면 기자들의 반복적인 업무 부담을 줄이면서도, 저널리즘의 핵심 가치인 정확성과 신뢰성은 오히려 강화할 수 있을 것이라 기대합니다.