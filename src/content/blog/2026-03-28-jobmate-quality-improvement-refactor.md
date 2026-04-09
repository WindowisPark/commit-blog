---
title: "3-에이전트 리뷰 기반 품질 개선: JobMate의 기술적 도전과 해결책"
description: "동시성 문제와 사용자 경험 개선을 위해 DB 트랜잭션 최적화, WebSocket 메시지 큐잉, 그리고 반응형 UI를 어떻게 구현했는지 살펴봅니다."
pubDate: 2026-03-28
repo: jobmate
repoDisplayName: JobMate
tags: ["jobmate", "refactoring", "python", "react"]
commits: ["a16d3de6ceb0d4ec51cf4d2f1b13392fbf397b85"]
---
## 문제의 발견: 동시성과 UX 이슈

**JobMate**를 개발하면서 3명의 에이전트 리뷰어들로부터 Sprint 1~3에 걸쳐 받은 피드백을 바탕으로 대규모 리팩토링을 진행했습니다. 가장 심각했던 문제는 두 가지였습니다. 첫째, 여러 사용자가 동시에 같은 대화방에 접근할 때 발생하는 **race condition**, 둘째, 모바일 환경에서의 열악한 사용자 경험이었습니다.

기존에는 하나의 긴 트랜잭션 안에서 사용자 메시지 저장부터 LLM 호출, 에이전트 응답 생성까지 모든 작업을 처리했습니다. 이로 인해 AI 응답 생성에 시간이 오래 걸릴 때 데이터베이스 락이 장시간 유지되어 다른 요청들이 블로킹되는 문제가 발생했습니다.

## DB 트랜잭션 3-Phase 분리로 성능 최적화

가장 큰 변화는 **3-phase 트랜잭션 분리**였습니다. 기존의 단일 트랜잭션을 세 단계로 나누어 각각 최소한의 시간만 데이터베이스를 점유하도록 개선했습니다.

```python
# Phase 1: 유저 메시지 저장 (짧은 트랜잭션)
async with async_session() as db:
    conv = await get_or_create_conversation(db, conversation_id, user_id=user_id_str)
    conv_id = conv.id
    history = await load_conversation_history(db, conv_id)
    await save_user_message(db, conv_id, user_message)
    await db.commit()

# Phase 2: LangGraph 실행 (트랜잭션 외부)
result = await asyncio.wait_for(graph.ainvoke({...}), timeout=GRAPH_TIMEOUT)

# Phase 3: 에이전트 응답 저장 (별도 트랜잭션)
async with async_session() as db:
    for resp in responses:
        await save_agent_message(db, conv_id, ...)
    await db.commit()
```

특히 `get_or_create_conversation` 함수에서는 **PostgreSQL의 INSERT...ON CONFLICT DO NOTHING** 패턴을 활용해 race condition을 근본적으로 해결했습니다. 여러 요청이 동시에 같은 대화방을 생성하려 해도 중복 생성 없이 안전하게 처리됩니다.

## CASCADE DELETE와 데이터 일관성

데이터 무결성 개선을 위해 **Alembic migration**을 통해 Foreign Key 제약조건에 `ON DELETE CASCADE`를 추가했습니다. 이제 대화방이 삭제될 때 관련된 모든 메시지와 감정 로그가 자동으로 삭제되어, 수동으로 관련 레코드들을 하나씩 삭제할 필요가 없어졌습니다.

대화 제목 생성에서도 경쟁 조건을 방지하기 위해 atomic UPDATE를 사용합니다:

```python
# 대화 제목 자동 생성 (첫 메시지 — atomic UPDATE로 경쟁 방지)
title_text = user_message[:50] + ("..." if len(user_message) > 50 else "")
await db.execute(
    sa_update(Conversation)
    .where(Conversation.id == conv_id, Conversation.title.is_(None))
    .values(title=title_text)
)
```

## WebSocket 메시지 큐잉과 안정성 향상

실시간 채팅에서 네트워크 불안정으로 인한 연결 끊김은 피할 수 없는 문제입니다. 이를 해결하기 위해 **메시지 큐잉 시스템**을 구현했습니다. 연결이 끊어진 동안 발생한 메시지들을 큐에 저장해두었다가, 재연결 시 자동으로 전송합니다.

동시에 **Toast 알림 시스템**을 도입해 API 에러나 WebSocket 연결 상태를 사용자에게 명확히 알려줍니다. 더 이상 사용자가 "뭔가 잘못되었는데 무엇인지 모르는" 상황에 놓이지 않습니다.

## 모바일 반응형과 접근성 개선

모바일 사용자를 위해 **햄버거 메뉴와 슬라이드 토글 사이드바**를 구현했습니다. 작은 화면에서도 모든 기능에 쉽게 접근할 수 있도록 했죠. 또한 **무한 스크롤 페이지네이션**을 cursor 기반으로 구현해 대화 히스토리가 길어져도 성능 저하 없이 매끄럽게 로딩됩니다.

접근성 측면에서는 모달의 **focus trap**, Escape 키로 닫기, 키보드 탐색, aria-label 등을 체계적으로 적용했습니다. 스크린 리더 사용자도 불편함 없이 서비스를 이용할 수 있도록 했습니다.

## 사용자 보안과 폼 검증 강화

보안 강화를 위해 **비밀번호 복잡성 검증**을 서버와 클라이언트 양쪽에서 구현했습니다. 8자 이상에 영문자와 숫자를 반드시 포함해야 하며, 실시간으로 비밀번호 강도를 시각적으로 표시합니다.

폼 검증도 실시간으로 이루어져 사용자가 제출 버튼을 누르기 전에 미리 문제를 파악하고 수정할 수 있습니다. 이런 세심한 UX 개선이 사용자 만족도를 크게 높였습니다.

## 배운 점과 다음 단계

이번 리팩토링을 통해 **동시성 처리**와 **사용자 경험**이라는 두 마리 토끼를 모두 잡을 수 있었습니다. 특히 트랜잭션을 단계별로 분리한 것이 성능과 안정성 모두에 큰 도움이 되었습니다.

3명의 에이전트 리뷰어들의 꼼꼼한 피드백 덕분에 놓치기 쉬운 edge case들까지 잡아낼 수 있었습니다. 코드 리뷰의 힘을 새삼 느끼게 되는 경험이었습니다.

다음 단계로는 메시지 검색 기능과 감정 분석 시각화를 더욱 고도화할 예정입니다. 사용자가 자신의 대화 패턴을 더 잘 이해할 수 있도록 돕는 것이 목표입니다.