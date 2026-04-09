---
title: "멘탈케어 중심의 채팅 UX: 픽셀 오피스에서 따뜻한 대화방으로"
description: "JobMate의 메인 인터페이스를 캔버스 기반 픽셀 오피스에서 멘탈케어에 특화된 채팅 중심 UI로 전면 리디자인한 과정을 소개합니다."
pubDate: 2026-03-30
repo: jobmate
repoDisplayName: JobMate
tags: ["jobmate", "react"]
commits: ["9d10d7d27c4db79ee72bfa40dde30cc0b2eb4bc9"]
---
## 왜 방향을 바꿨을까

**JobMate** 프로젝트를 시작할 때는 픽셀 아트 스타일의 오피스 뷰가 메인이었습니다. 사용자가 가상 사무실을 돌아다니며 AI 에이전트들과 만나는 컨셉이죠. 하지만 실제 타겟 유저인 취업준비생들에게는 '편안하고 접근하기 쉬운 상담 공간'이 더 중요하다는 걸 깨달았습니다.

취준생들이 정말 필요로 하는 건 화려한 시각적 요소가 아니라, **언제든 털어놓을 수 있는 따뜻한 공간**이었거든요. 그래서 과감히 OfficeView 컴포넌트를 통째로 제거하고, 채팅이 전체 화면을 차지하는 구조로 바꿨습니다.

## 실시간 에이전트 상태를 보여주는 Presence Bar

기존 픽셀 아트에서 에이전트들의 움직임을 보여주던 부분을 어떻게 대체할지 고민했습니다. 해답은 **AgentPresenceBar**였어요. 화면 상단에 4명의 AI 멘토가 실시간 상태와 함께 나타나는 인터페이스입니다.

```tsx
function AgentChip({ agentId }: { agentId: AgentId }) {
  const behavior = officeAgent?.behavior || "wandering";
  const isTyping = typingAgents.includes(agentId);
  const active = isActive(behavior) || isTyping;

  return (
    <div style={{
      background: active
        ? `linear-gradient(135deg, ${agent.color}18, ${agent.color}08)`
        : "var(--bg-card)",
      border: active ? `1px solid ${agent.color}40` : "1px solid var(--border)",
      boxShadow: active ? `0 0 12px ${agent.color}20` : "none",
    }}>
      {/* 아바타 + 실시간 상태 표시 */}
    </div>
  );
}
```

각 에이전트가 "이력서 검토 중 📄", "면접 준비 중 🎯", "응답 작성 중 ✍️" 같은 상태를 실시간으로 보여주고, 활성 상태일 때는 에이전트 고유 컬러로 **부드러운 글로우 효과**가 들어갑니다. 사용자는 누가 지금 바쁜지, 누구에게 말을 걸 수 있는지 한눈에 알 수 있어요.

## 감정을 체크인하는 첫인사

멘탈케어 서비스답게 사용자가 처음 들어왔을 때 현재 기분을 물어보는 **MoodCheckIn** 컴포넌트를 추가했습니다. "좋아요 😊", "불안해요 😰", "우울해요 😢" 등 6가지 감정 옵션을 제공하죠.

```tsx
const MOODS: MoodOption[] = [
  { emoji: "😊", label: "좋아요", color: "#8dc07a" },
  { emoji: "😰", label: "불안해요", color: "#d98a90" },
  { emoji: "😢", label: "우울해요", color: "#7bb5e0" },
  // ...
];

const handleSelect = (mood: MoodOption) => {
  setSelected(mood.label);
  onSelect(mood.label);
  setTimeout(() => setDismissed(true), 1500);
};
```

사용자가 감정을 선택하면 해당 정보가 자연스럽게 대화 컨텍스트에 포함되어, AI 에이전트가 현재 감정 상태를 고려한 맞춤 상담을 할 수 있게 됩니다.

## 메시지 버블의 따뜻한 리디자인

Slack 스타일의 차가운 회색 톤을 버리고, **소프트 블루와 그린** 계열의 멘탈케어 컬러 팔레트로 전환했습니다. 특히 AI 에이전트 메시지에는 카드 배경과 좌측 컬러 바를 추가해서 시각적으로 구분되도록 했어요.

```tsx
// AI 메시지에 카드 스타일 적용
style={{
  background: "var(--bg-card)",
  borderLeft: `3px solid ${agent?.color ?? "var(--border)"}`,
  borderRadius: "var(--radius-md)",
  margin: "2px 8px",
}}
```

에이전트별로 다른 컬러를 사용해서 누가 말하는지 직관적으로 알 수 있고, 호버 시 배경색이 부드럽게 변하는 **미묘한 인터랙션**도 추가했습니다.

## 빈 화면도 따뜻하게

가장 신경 쓴 부분 중 하나가 채팅방이 비어있을 때의 화면입니다. 기존의 딱딱한 "대화를 시작하세요" 대신, **🌿 아이콘과 함께 "편하게 이야기해주세요"**라는 메시지를 보여줍니다.

```css
@keyframes gentleGlow {
  0%, 100% { box-shadow: 0 0 8px rgba(139, 192, 122, 0.3); }
  50% { box-shadow: 0 0 16px rgba(139, 192, 122, 0.5); }
}
```

아이콘 주변에는 3초 주기로 부드럽게 반짝이는 **gentleGlow** 애니메이션을 적용해서, 정적이지만 생동감 있는 느낌을 연출했습니다.

## 기술적 도전과 배움

이번 리디자인에서 가장 큰 도전은 **기존 오피스 시스템과의 연동을 유지하면서** UI를 완전히 바꾸는 것이었습니다. `useOfficeStore`에서 에이전트들의 behavior 상태는 그대로 가져오되, 픽셀 아트 렌더링은 제거하는 방식으로 해결했어요.

또한 **부드러운 애니메이션과 색상 변화**를 통해 기계적이지 않은, 인간적인 느낌을 주는 것도 중요한 포인트였습니다. CSS transition과 keyframe을 조합해서 과하지 않으면서도 생동감 있는 UI를 만들어냈죠.

결과적으로 사용자가 처음 들어왔을 때부터 마지막 대화까지, **멘탈케어에 특화된 따뜻하고 접근하기 쉬운 경험**을 제공하는 인터페이스가 완성되었습니다.