---
title: "멀티에이전트 채팅봇에 WebSocket 스트리밍과 LangGraph를 도입한 이유"
description: "JobMate 프로젝트에서 Gemini에서 GPT-4o mini로 전환하고, LangGraph 기반 멀티에이전트 파이프라인을 구축하며 실시간 WebSocket 채팅을 구현한 과정을 다룹니다."
pubDate: 2026-03-23
repo: jobmate
repoDisplayName: JobMate
tags: ["jobmate", "feature", "python"]
commits: ["95e41565365a62881fd654f84766dc952d5098d2"]
---
## AI 모델 전환: Gemini에서 GPT-4o mini로

개발을 진행하면서 가장 먼저 마주한 선택은 **AI 모델 변경**이었습니다. 초기에는 Gemini API를 사용했지만, 멀티에이전트 시스템에서 요구하는 안정적인 JSON 응답 생성과 감정 분석의 정확도를 고려해 **GPT-4o mini**로 전환했습니다.

```python
ANALYSIS_PROMPT = """
너는 사용자 메시지를 분석하는 시스템이야. 아래 형식의 JSON만 반환해.

{
  "emotion": "neutral" | "anxious" | "depressed" | "angry" | "hopeful" | "frustrated",
  "emotion_intensity": 1~5,
  "intent": "resume_interview" | "job_search" | "mental_care" | "career_advice" | "general"
}
"""
```

GPT-4o mini는 비용 효율성이 뛰어나면서도 구조화된 응답 생성에서 일관성을 보여줬습니다. 특히 사용자의 감정 상태와 의도를 분석하는 작업에서 **더 정확한 분류**를 할 수 있었습니다.

## LangGraph로 멀티에이전트 오케스트레이션 구현

가장 흥미로운 부분은 **LangGraph를 활용한 멀티에이전트 파이프라인** 구축이었습니다. JobMate는 4명의 AI 에이전트(서연, 준호, 하은, 민수)가 각자의 전문성을 가지고 사용자와 대화하는 시스템입니다.

```python
async def run_agents(state: JobMateState) -> dict:
    """선택된 에이전트들을 순차 실행하고 응답을 수집한다."""
    active = state.get("active_agents", [])
    responses: list[AgentResponse] = []

    for i, agent_id in enumerate(active):
        module = AGENT_MODULES.get(agent_id)
        if module is None:
            continue
        is_primary = i == 0
        response = await module.run(state, is_primary=is_primary)
        responses.append(response)

    return {"agent_responses": responses}
```

**LangGraph의 StateGraph**를 사용해 감정 분석 → 에이전트 라우팅 → 응답 생성 → 응답 조합 순서로 파이프라인을 구성했습니다. 각 단계가 명확하게 분리되어 있어 디버깅과 확장이 훨씬 쉬워졌습니다.

## 실시간 WebSocket 채팅과 타이밍 연출

단순히 응답을 반환하는 것이 아니라, **사람과 대화하는 듯한 자연스러운 경험**을 만들고 싶었습니다. 이를 위해 WebSocket을 도입하고 에이전트별로 딜레이를 차별화했습니다.

```python
for resp in result.get("agent_responses", []):
    agent_id = resp["agent_id"]
    content = resp["content"]
    delay_ms = resp.get("delay_ms", 0)

    # 딜레이 적용 (자연스러운 타이밍)
    if delay_ms > 0:
        await asyncio.sleep(delay_ms / 1000)

    # 타이핑 시작 알림
    await websocket.send_json({
        "type": "agent_typing",
        "agent_id": agent_id,
        "office_action": "thinking",
    })
```

첫 번째 에이전트는 즉시 응답하고, 보조 에이전트들은 800ms + 700ms씩 증가하는 딜레이를 적용했습니다. 또한 타이핑 인디케이터와 "오피스 행동" 상태를 함께 전송해 각 에이전트가 무엇을 하고 있는지 시각적으로 표현했습니다.

## 감정 기반 에이전트 라우팅 로직

사용자의 상태에 따라 **적절한 에이전트가 개입**하도록 하는 것이 핵심이었습니다. 감정 강도가 4 이상이고 부정적인 감정일 때는 심리 케어 전문가인 하은이가 우선적으로 응답하도록 설계했습니다.

의도별로는 이력서/면접 상담은 서연이, 채용 정보는 준호, 심리 케어는 하은이, 커리어 조언은 민수가 주도하되, 상황에 따라 보조 에이전트들이 추가로 참여합니다.

## 데이터베이스 마이그레이션과 확장성 고려

멀티에이전트 시스템을 지원하기 위해 **데이터 모델도 대폭 개선**했습니다. 기존 비동기 SQLAlchemy 설정을 동기 방식으로 변경하고, 에이전트별 메시지 추적, 감정 로그, 도구 호출 결과를 저장할 수 있는 스키마를 구축했습니다.

PostgreSQL의 JSONB 타입을 활용해 `tool_calls`와 `tool_results`를 유연하게 저장할 수 있도록 설계했습니다. 향후 에이전트가 외부 API를 호출하거나 복잡한 작업을 수행할 때를 대비한 확장성을 고려한 구조입니다.

## 마치며

이번 커밋에서는 **멀티에이전트 시스템의 기본 골격**을 완성했습니다. LangGraph의 선언적 파이프라인 구조 덕분에 복잡한 에이전트 간 상호작용을 명확하게 관리할 수 있었고, WebSocket을 통한 실시간 스트리밍으로 사용자 경험을 크게 개선했습니다.

다음 단계에서는 각 에이전트가 실제로 외부 도구를 호출하고, 더 정교한 감정 분석과 개인화된 응답을 제공하는 기능을 추가할 예정입니다.