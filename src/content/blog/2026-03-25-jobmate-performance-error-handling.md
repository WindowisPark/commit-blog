---
title: "실시간 채팅 서비스의 안정성을 높이는 기술적 결정들"
description: "JobMate 프로젝트에서 성능 최적화와 에러 핸들링을 통해 실시간 멀티 에이전트 채팅 서비스의 안정성을 크게 향상시킨 과정을 소개합니다."
pubDate: 2026-03-25
repo: jobmate
repoDisplayName: JobMate
tags: ["jobmate", "feature", "python", "react"]
commits: ["aa89af1e5e9f23371155d47460a1912a7764580e"]
---
## 서비스가 커지면서 마주친 현실적 문제들

JobMate는 여러 AI 에이전트가 함께 대화하는 실시간 채팅 서비스입니다. 초기 MVP에서는 "일단 동작하게 만들자"는 마음으로 개발했지만, 사용자가 늘어나면서 여러 문제가 드러났습니다. **WebSocket 연결이 갑자기 끊어지거나, LLM API 호출이 오래 걸려 전체 서비스가 멈추거나, 데이터베이스 연결이 부족해 에러가 발생**하는 일이 빈번했습니다.

이번 업데이트는 이런 현실적인 문제들을 해결하기 위한 작업이었습니다. 단순히 기능을 추가하는 것이 아니라, 서비스의 안정성과 사용자 경험을 근본적으로 개선하는 것이 목표였죠.

## 백엔드: 연결 관리와 장애 격리

가장 먼저 해결해야 할 문제는 **데이터베이스 커넥션 풀 설정**이었습니다. 동시 사용자가 늘어나면서 DB 연결이 부족해지는 상황이 자주 발생했거든요.

```python
engine = create_async_engine(
    settings.database_url,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
)
```

`pool_pre_ping=True` 옵션이 특히 중요했습니다. 오랫동안 사용되지 않은 연결이 끊어져 있을 때 자동으로 감지하고 새 연결을 만들어주거든요. Redis도 마찬가지로 타임아웃과 재시도 설정을 추가했습니다.

또 하나의 핵심은 **에이전트별 독립적인 에러 처리**였습니다. 기존에는 한 에이전트에서 오류가 발생하면 전체 응답이 실패했는데, 이제는 각 에이전트를 개별적으로 처리합니다:

```python
try:
    response = await module.run(state, is_primary=is_primary)
    responses.append(response)
except Exception as e:
    logger.error(f"Agent {agent_id} failed: {e}", exc_info=True)
    responses.append(AgentResponse(
        agent_id=agent_id,
        content="죄송해요, 잠시 오류가 발생했어요. 다시 말씀해주시겠어요?",
        # ...
    ))
```

이렇게 하면 4명의 에이전트 중 1명에게 문제가 생겨도 나머지 3명은 정상적으로 응답할 수 있습니다.

## 프론트엔드: 자동 복구와 사용자 경험

프론트엔드에서는 **WebSocket 자동 재연결**이 가장 큰 변화였습니다. 네트워크가 불안정하거나 서버 재시작 등으로 연결이 끊어졌을 때, 사용자가 새로고침하지 않아도 자동으로 다시 연결됩니다.

```javascript
const reconnect = useCallback(async () => {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    setReconnectAttempts(prev => prev + 1);
    connect();
}, [reconnectAttempts, connect]);
```

**지수 백오프(exponential backoff)** 방식을 사용해서 재연결 간격을 점점 늘려가며, 서버에 무리를 주지 않으면서도 안정적으로 재연결을 시도합니다.

**React ErrorBoundary**도 추가했습니다. 예상치 못한 에러가 발생해도 전체 앱이 크래시되지 않고, 사용자에게 친화적인 에러 화면을 보여줍니다.

## 타임아웃과 성능 최적화

AI 서비스에서 가장 까다로운 부분은 **외부 API 의존성 관리**입니다. OpenAI API가 느리게 응답하거나 아예 응답하지 않으면 전체 서비스가 멈출 수 있거든요.

```python
LLM_TIMEOUT = 30  # seconds
GRAPH_TIMEOUT = 60  # seconds

result = await asyncio.wait_for(
    graph.ainvoke({...}),
    timeout=GRAPH_TIMEOUT,
)
```

**LLM API는 30초, 전체 그래프 실행은 60초**로 타임아웃을 설정했습니다. 타임아웃이 발생하면 데이터베이스 트랜잭션을 롤백하고, 사용자에게는 "다시 시도해주세요"라는 친화적인 메시지를 보여줍니다.

프론트엔드에서는 **디바운싱(debouncing)**을 적용해서 사용자가 연속으로 메시지를 보내는 것을 방지했습니다. 500ms 간격으로 제한해서 서버 부하를 줄이면서도 자연스러운 대화 흐름을 유지했죠.

## 마무리: 안정성이 곧 사용자 경험

이번 최적화 작업을 통해 **서비스의 안정성이 사용자 경험과 직결된다**는 것을 다시 한번 느꼈습니다. 아무리 좋은 기능이라도 서비스가 자주 멈추거나 에러가 발생하면 사용자는 떠나게 됩니다.

특히 실시간 채팅 서비스처럼 **즉각적인 반응이 중요한 서비스에서는 장애 복구 능력이 더욱 중요**합니다. 에러가 발생해도 빠르게 복구하고, 사용자에게는 최대한 자연스러운 경험을 제공하는 것이 핵심이죠.

다음 단계로는 Docker 배포와 클라우드 인프라 최적화를 계획하고 있습니다. 코드 레벨의 안정성을 확보했으니, 이제 인프라 레벨에서도 고가용성을 구현해볼 차례입니다.