---
title: "JobMate: 취준생을 위한 멀티에이전트 챗봇 프로젝트 시작기"
description: "4명의 AI 에이전트가 가상 오피스에서 근무하며 취준생을 도와주는 프로젝트의 기술 설계부터 초기 구현까지의 여정을 담았습니다."
pubDate: 2026-03-25
repo: jobmate
repoDisplayName: JobMate
tags: ["jobmate", "python", "react", "docs"]
commits: ["1670c9ed28e128963a546608fdbb6a77bf7eba1b", "c45a1d46ffdc783581269d54e641c3e4fd3b960b", "b2540c44c999563c25683c283765743392d2bac4"]
---
## 프로젝트의 출발점

최근 **JobMate**라는 새로운 프로젝트를 시작했습니다. 단순한 챗봇이 아닌, 4명의 AI 에이전트가 가상 오피스에서 근무하며 취업 준비생의 멘탈 케어와 실질적인 도움을 제공하는 서비스입니다. 기획부터 초기 구현까지의 과정을 정리해보겠습니다.

## 왜 멀티에이전트인가

일반적인 챗봇의 한계를 느꼈습니다. 하나의 AI가 모든 역할을 담당하다 보니 답변이 획일적이고, 사용자 입장에서도 재미가 떨어지더군요. 그래서 각기 다른 전문성과 성격을 가진 4명의 에이전트를 설계했습니다.

**김서연(Career Coach)**는 이력서 피드백과 면접 준비를 담당하며 따뜻하지만 직설적인 성격으로, **박준호(Job Researcher)**는 채용공고 검색과 시장 분석을 맡으며 데이터 중심적으로 접근합니다. **이하은(Mental Care)**은 감정 케어와 루틴 관리를 통해 취준생의 멘탈을 돌보고, **정민수(Industry Mentor)**는 현실적인 업계 조언을 형/누나 같은 친근함으로 전달합니다.

중요한 것은 이들이 각각 따로 동작하는 것이 아니라, **LangGraph**를 통해 자연스럽게 그룹채팅에 참여한다는 점입니다. 사용자의 메시지 의도를 분석해서 primary 에이전트가 먼저 응답하고, 필요에 따라 다른 에이전트들이 보조 의견을 제시하는 방식이죠.

## 기술 스택 선택의 고민

처음엔 **Gemini Flash**를 고려했지만, 결국 **GPT-4o mini**로 결정했습니다. 멀티에이전트 대화에서 일관성과 자연스러움이 더 중요했기 때문입니다. 백엔드는 **FastAPI**로, 실시간 채팅을 위한 WebSocket 지원과 **SQLAlchemy 2.0**의 async 기능을 활용하기 위함입니다.

프론트엔드에서 가장 고민한 부분은 가상 오피스 구현이었습니다. 처음에는 **Pixi.js**를 생각했지만, 프로젝트 복잡도를 고려해 **Canvas 2D**로 결정했습니다. 4명의 에이전트가 Tool을 실행할 때마다 실제로 오피스에서 행동하는 모습을 보여주는 것이 목표입니다.

```python
# agents/router.py - 에이전트 참여 로직
def route_message(user_message: str, emotion_score: float) -> List[AgentParticipation]:
    # 긴급 상황 체크
    if emotion_score < -0.8:  # 극도 불안/패닉
        return [AgentParticipation(agent_id="ha_eun", role="primary", delay=0)]
    
    # 의도 분류 후 primary/secondary 결정
    intent = classify_intent(user_message)
    participants = []
    
    if intent == "resume_feedback":
        participants.append(AgentParticipation("seo_yeon", "primary", 0))
        participants.append(AgentParticipation("min_su", "secondary", 1.5))
    
    return participants
```

## 실용적인 Tool Calling 설계

단순한 대화형 챗봇에서 끝나지 않고, 실제로 도움이 되는 기능들을 **Tool Calling**으로 구현했습니다. 사람인 API를 연동한 채용공고 검색, 이력서 첨삭 피드백, 모의 면접 시뮬레이션 등이 핵심 기능입니다.

특히 재미있는 부분은 각 Tool이 실행될 때 해당 에이전트의 오피스 행동이 바뀐다는 점입니다. 박준호가 `search_jobs`를 실행하면 모니터 3개를 빠르게 전환하는 애니메이션이 재생되고, 이하은이 `breathing_exercise`를 진행하면 요가매트 위에서 명상하는 모습을 보여줍니다.

```typescript
// components/office/AgentSprite.tsx
const AgentSprite: React.FC<{ agent: Agent; currentAction: string }> = ({ agent, currentAction }) => {
  const getSpriteFrame = () => {
    switch (currentAction) {
      case 'search_jobs':
        return agent.id === 'jun_ho' ? 'monitoring' : 'idle';
      case 'breathing_exercise':
        return agent.id === 'ha_eun' ? 'meditation' : 'idle';
      default:
        return 'idle';
    }
  };
  
  return (
    <canvas 
      ref={canvasRef}
      className={`agent-sprite agent-${agent.id}`}
    />
  );
};
```

## 보안과 사용자 경험 사이의 균형

인증 시스템 설계에서 가장 고민했던 부분입니다. 보안을 위해서는 **httpOnly 쿠키**를 사용하고 **Refresh Token Rotation**을 구현해야 했지만, 동시에 게스트 사용자도 부담 없이 체험할 수 있어야 했습니다.

결국 쿠키가 없으면 anonymous 유저로 처리하되, 대화 기록은 저장하지 않는 방식으로 결정했습니다. WebSocket 연결도 쿠키를 통해 자동으로 인증되므로 클라이언트 코드가 단순해졌습니다.

## 앞으로의 계획

현재는 기본 프로젝트 스캐폴딩이 완료된 상태입니다. CI/CD 워크플로우를 임시 비활성화해둔 것은 린트와 타입체크 설정을 먼저 정비하고 싶어서입니다. 다음 단계로는 LangGraph 기반의 에이전트 오케스트레이션 구현과 Canvas 기반 오피스 뷰 개발을 진행할 예정입니다.

무엇보다 중요한 것은 4명의 에이전트가 정말 자연스럽게 대화에 참여하는 느낌을 주는 것입니다. 단순히 기능을 나열하는 것이 아니라, 마치 실제 동료들과 함께 일하는 것 같은 경험을 만들어보고 싶습니다.