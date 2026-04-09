---
title: "멀티에이전트 챗봇의 대화 히스토리 영속화: PostgreSQL과 LLM 컨텍스트 통합"
description: "WebSocket 기반 채팅 데이터를 DB에 저장하고, LLM 호출 시 이전 대화 컨텍스트를 전달하여 자연스러운 대화 흐름을 구현한 과정을 소개합니다."
pubDate: 2026-03-25
repo: jobmate
repoDisplayName: JobMate
tags: ["jobmate", "feature", "python"]
commits: ["042058d84576e1e053a670027d91930465591be0"]
---
## 메모리 기반에서 영속화로

JobMate 프로젝트를 진행하면서 가장 큰 기술적 도전 중 하나는 **실시간 채팅과 데이터 영속화를 어떻게 조화시킬 것인가**였습니다. 초기에는 WebSocket으로 주고받는 메시지들이 메모리에만 존재해서, 페이지를 새로고침하면 모든 대화 내용이 사라지는 문제가 있었습니다.

취업 준비생의 멘탈 케어라는 서비스 특성상 이전 대화 맥락을 기억하는 것이 중요했고, 더 나아가 LLM이 과거 대화를 참조해서 더 개인화된 조언을 제공할 필요가 있었습니다.

## WebSocket과 PostgreSQL의 만남

첫 번째 해결해야 할 문제는 **WebSocket 메시지를 어떻게 DB에 저장할 것인가**였습니다. 기존 코드에서는 메시지가 WebSocket을 통해 실시간으로 주고받아지지만, 어디에도 저장되지 않았습니다.

```python
# 사용자 메시지 저장
async with async_session() as db:
    conv = await get_or_create_conversation(
        db, conversation_id, user_id="anonymous"
    )
    history = await load_conversation_history(db, conv.id)
    await save_user_message(db, conv.id, user_message)
```

핵심은 **WebSocket 핸들러 내부에서 데이터베이스 세션을 관리**하는 것이었습니다. 사용자 메시지를 받자마자 DB에 저장하고, LLM 처리가 완료되면 에이전트 응답도 즉시 저장하는 구조로 설계했습니다.

## LLM 컨텍스트에 히스토리 주입

두 번째 도전은 **저장된 대화 히스토리를 LLM 호출 시 어떻게 전달할 것인가**였습니다. 단순히 현재 메시지만 보내는 것이 아니라, 이전 대화 맥락을 함께 제공해야 더 자연스러운 응답을 받을 수 있습니다.

```python
# 각 에이전트 노드에서 히스토리 추가
history = state.get("conversation_history", [])

content, tool_records = await generate_response_with_tools(
    system, state["user_message"], tools, execute_tool, history=history
)
```

**최근 20개 메시지로 제한**한 이유는 토큰 비용과 응답 속도를 고려한 결정이었습니다. 너무 긴 히스토리는 LLM 호출 비용을 급격히 증가시키고, 응답 시간도 늘어나기 때문입니다.

## 대화 관리 API의 완성

히스토리 기능과 함께 **Conversation CRUD API**도 구현했습니다. 사용자가 이전 대화를 다시 볼 수 있고, 필요 없는 대화는 삭제할 수 있어야 했기 때문입니다.

```python
@router.get("/{conversation_id}")
async def get_conversation(conversation_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conversation_id)
        .options(selectinload(Conversation.messages))
    )
    # 메시지를 시간순으로 정렬하여 반환
    messages = sorted(conv.messages, key=lambda m: m.created_at)
```

특히 **대화 제목 자동 생성** 기능을 추가해서, 사용자가 별도로 제목을 입력하지 않아도 첫 번째 메시지를 기반으로 의미 있는 제목이 생성되도록 했습니다.

## 멀티에이전트 시스템에서의 메시지 저장

JobMate는 4명의 AI 에이전트가 서로 다른 역할을 담당하는 멀티에이전트 시스템입니다. 이런 구조에서는 **어떤 에이전트가 언제 응답했는지를 정확히 추적**하는 것이 중요했습니다.

사용자가 `@서연` 같은 멘션을 사용하거나 DM 모드를 선택할 때, 해당 에이전트의 응답만 저장되어야 하고, 각 메시지에는 `agent_id`와 `tool_calls` 정보가 함께 저장되어야 했습니다.

## JWT 구현 전 임시 사용자 처리

현재는 사용자 인증 기능이 구현되기 전이라서 **anonymous 사용자를 자동 생성**하는 방식으로 임시 해결했습니다. 이는 나중에 JWT 인증이 완성되면 실제 사용자 ID로 대체될 예정입니다.

```python
# 고정된 anonymous 사용자 ID 사용
ANONYMOUS_USER_ID = uuid.uuid5(uuid.NAMESPACE_URL, "anonymous")

async def ensure_anonymous_user(db: AsyncSession) -> uuid.UUID:
    # anonymous 유저가 없으면 생성
    if result.scalar_one_or_none() is None:
        user = User(id=ANONYMOUS_USER_ID, email="anonymous@jobmate.local")
```

## 성능과 사용자 경험의 균형

이번 구현에서 가장 신경 쓴 부분은 **실시간성을 해치지 않으면서도 데이터를 안전하게 저장하는 것**이었습니다. WebSocket 연결이 유지된 상태에서 DB 작업을 수행해야 하므로, 비동기 처리와 적절한 에러 핸들링이 필수였습니다.

또한 대화 히스토리를 LLM에 전달할 때는 **사용자와 에이전트의 메시지를 올바른 순서로 재구성**하는 것도 중요했습니다. 잘못된 순서로 전달되면 LLM이 대화의 맥락을 제대로 이해하지 못하기 때문입니다.

## 다음 단계: 더 스마트한 컨텍스트 관리

현재는 단순히 최근 20개 메시지를 전달하는 방식이지만, 향후에는 **감정 상태나 주요 키워드를 기반으로 더 스마트하게 컨텍스트를 선별**하는 방향으로 발전시킬 계획입니다. 또한 JWT 인증이 완성되면 사용자별 개인화된 대화 관리 기능도 제공할 수 있을 것입니다.