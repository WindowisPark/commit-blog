---
title: "OpenAI Function Calling으로 AI 에이전트를 똑똑하게 만들기"
description: "취업 도우미 JobMate에 Tool Calling 기능을 도입해 8개의 실무 도구를 연동하고, 픽셀아트 오피스 환경에서 멘션과 DM 기능까지 구현한 개발 과정을 소개합니다."
pubDate: 2026-03-23
repo: jobmate
repoDisplayName: JobMate
tags: ["jobmate", "feature", "python", "react"]
commits: ["f85b30cd4c394a4bc3629c93b0c8a19b1296b6cb"]
---
## 단순한 챗봇을 넘어서

**JobMate** 프로젝트는 취업 준비생을 위한 AI 멘토링 서비스입니다. 처음에는 4명의 AI 에이전트가 단순히 대화만 나누는 수준이었지만, 이번 업데이트를 통해 실제 업무에 도움이 되는 도구들을 사용할 수 있는 똑똑한 어시스턴트로 진화했습니다.

가장 큰 변화는 **OpenAI Function Calling** 도입이었습니다. 이제 AI 에이전트들이 채용 정보 검색, 이력서 피드백, 모의면접 등 실무에 필요한 8개의 도구를 직접 호출해서 정확한 정보를 제공할 수 있게 되었습니다.

## Tool Calling으로 AI를 실무진으로

기존의 LLM 서비스는 단순한 텍스트 응답만 생성했습니다. 하지만 **Function Calling**을 통해 AI가 상황에 맞는 도구를 선택하고 실행할 수 있게 만들었습니다.

```python
async def generate_response_with_tools(
    system_prompt: str,
    user_message: str,
    tools: list[dict],
    tool_executor: Callable[[str, dict], Awaitable[dict]],
) -> tuple[str, list[dict] | None]:
    client = get_openai_client()
    
    # 1차 호출: GPT가 tool 호출 여부 판단
    response = await client.chat.completions.create(
        model=settings.openai_model,
        messages=messages,
        tools=tools if tools else None,
        tool_choice="auto",
        temperature=0.8,
    )
    
    # Tool 호출 실행 후 2차 호출로 최종 응답 생성
```

핵심은 **auto 모드**입니다. GPT가 사용자의 질문을 분석해서 필요한 도구가 있으면 자동으로 호출하고, 그 결과를 바탕으로 자연스러운 답변을 생성합니다. "백엔드 개발자 채용공고 찾아줘"라고 하면 `search_jobs` 도구를 호출해서 실제 공공데이터포털 API에서 정보를 가져온 후, 그 결과를 정리해서 알려주는 식입니다.

총 8개의 도구를 구현했습니다. 외부 API 연동 도구로는 공공데이터포털의 채용 검색과 YouTube 동기부여 콘텐츠 추천이 있고, LLM 기반 도구로는 이력서 피드백, 모의면접, 시장분석, 업계 인사이트 등을 만들었습니다.

## 픽셀아트 오피스의 생생한 상호작용

단순한 채팅 인터페이스를 벗어나 **Canvas 기반의 픽셀아트 오피스**를 구현했습니다. 4명의 AI 에이전트가 각자의 자리에서 실제로 일하는 것처럼 보이도록 만들었습니다.

```typescript
const drawCharacter = (
  ctx: CanvasRenderingContext2D,
  agent: OfficeAgent,
  currentTime: number
) => {
  const { x, y } = agent.position;
  const isTyping = agent.action === 'typing';
  
  // 타이핑 중일 때 손 애니메이션
  if (isTyping) {
    const bounce = Math.sin(currentTime * 0.01) * 2;
    ctx.fillRect(x + 8, y + 12 + bounce, 2, 2); // 움직이는 손
  }
};
```

AI가 도구를 사용할 때마다 캐릭터의 행동이 바뀝니다. 채용 정보를 검색할 때는 "searching" 상태로, 이력서를 분석할 때는 "reading" 상태로 변하면서 사용자가 AI의 작업 과정을 시각적으로 확인할 수 있습니다.

## @멘션과 1:1 DM으로 세밀한 소통

단체 채팅만으로는 한계가 있었습니다. 특정 전문가에게만 질문하고 싶거나, 개인적인 상담이 필요한 경우가 많았거든요.

**@멘션 기능**을 구현해서 "@하은 이력서 봐줘"라고 하면 해당 에이전트만 응답하도록 했습니다. 정규식으로 멘션을 파싱하고, 해당 에이전트의 모듈을 직접 호출하는 방식입니다.

```typescript
const MENTION_PATTERN = /(@하은|@준호|@민수|@서연)/g;

const MentionPopup = ({ onSelect }: MentionPopupProps) => {
  const agents = [
    { id: "ha_eun", name: "하은", role: "심리상담사" },
    { id: "jun_ho", name: "준호", role: "취업컨설턴트" },
    // ...
  ];
  
  return (
    <div className="mention-popup">
      {agents.map(agent => (
        <button onClick={() => onSelect(agent)}>
          @{agent.name} ({agent.role})
        </button>
      ))}
    </div>
  );
};
```

**1:1 DM 기능**도 추가했습니다. 사이드바에서 에이전트를 선택하면 개인 채팅방이 열리고, 해당 전문가와만 대화할 수 있습니다. 이때는 다른 에이전트들이 개입하지 않도록 필터링 로직을 적용했습니다.

## 실제 서비스로서의 완성도

Tool Calling 구현 과정에서 가장 신경 쓴 부분은 **에러 처리**였습니다. 외부 API 호출이 실패하거나 JSON 파싱에 문제가 생겨도 사용자 경험이 중단되지 않도록 했습니다.

각 에이전트마다 사용할 수 있는 도구를 제한해서 전문성을 살렸습니다. 심리상담사 하은은 호흡 운동과 동기부여 콘텐츠를, 취업컨설턴트 준호는 채용 검색과 이력서 피드백을 주로 사용하도록 설정했습니다.

프론트엔드에서는 **WebSocket**을 통해 실시간으로 AI의 작업 상태를 표시합니다. 도구를 호출하는 중에는 "thinking" 상태를 보여주고, 결과가 나오면 자연스럽게 메시지로 전환됩니다.

이번 업데이트를 통해 JobMate는 단순한 채팅봇에서 실제 취업 준비에 도움이 되는 **종합 서비스**로 발전했습니다. AI가 단순히 대화만 하는 것이 아니라 실무 도구를 활용해 구체적인 도움을 제공할 수 있게 되었죠. Function Calling의 힘을 제대로 활용한 사례라고 생각합니다.