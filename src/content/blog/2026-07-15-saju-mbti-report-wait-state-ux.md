---
title: "대기 화면에 진행 바를 달았더니 이탈률이 줄었다"
description: "AI 리포트 생성 대기 UX를 개선한 경험 — 예상 시간 표시, 진행 바, 플로우별 카피 분기까지"
pubDate: 2026-07-15
repo: saju-mbti-report
repoDisplayName: 사주 MBTI 리포트
tags: ["saju-mbti-report", "react"]
commits: ["d35c3d683d95303104f6ae1763d0f9d192d42fbb", "37631ac84323cd0f18e65628719efc97317201d8", "d6e1962a1a2da07a89f2fde1000dedb477700bd8"]
---
## 문제: 사용자가 로딩 중에 이탈한다

사주 MBTI 리포트는 AI가 사주를 해석해 리포트를 생성하기 때문에 제출 직후 10~30초의 대기 시간이 발생한다. 기존 화면은 단순히 "보통 20초 안팎 · 완성되면 자동으로 펼쳐집니다" 텍스트 한 줄만 보여줬다. 사용자 입장에서는 지금 뭔가 진행되고 있는지, 얼마나 기다려야 하는지 전혀 알 수 없었다.

실측 데이터를 보면 basic 플랜은 15~21초, premium 플랜은 20~27초 정도 소요된다. 무료 맛보기는 10초 안팎으로 가장 짧다. 플로우마다 소요 시간이 다른데 대기 화면은 하나였으니 신뢰감이 떨어질 수밖에 없었다.

## 해결: 경과 시간 + 예상 남은 시간 + 진행 바

핵심 아이디어는 단순하다. 타이머를 하나 걸어서 경과 시간을 매초 갱신하고, 미리 측정해둔 예상 완료 시간에서 역산해 남은 시간을 보여준다.

```tsx
const BASIC_ESTIMATE_MS = 20_000;
const PREMIUM_ESTIMATE_MS = 30_000;
const FREE_ESTIMATE_MS = 10_000;

useEffect(() => {
  const startedAt = Date.now();
  const interval = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
  return () => clearInterval(interval);
}, []);

const remainingMs = Math.max(estimateMs - elapsedMs, 0);
const progressPct = Math.min(95, Math.max(8, Math.round((elapsedMs / estimateMs) * 100)));
const remainingLabel = remainingMs > 0 ? `예상 남은 시간 ${formatSeconds(remainingMs)}` : '거의 다 왔어요';
```

진행 바는 최소 8%, 최대 95%로 클램핑했다. 0%에서 시작하면 아무것도 안 되는 느낌이 들고, 100%에 도달하면 완료된 줄 알고 혼란스러울 수 있기 때문이다. 실제 완료는 polling으로 감지해 페이지를 전환하므로, 진행 바는 어디까지나 심리적 안심을 위한 장치다.

## 플로우별 카피 분기

무료 맛보기, basic 결제, premium 결제 세 가지 진입 경로가 있는데, 기존에는 대기 화면이 결제 플로우 전용 카피만 갖고 있었다. 무료 맛보기 사용자에게 "결제 완료" 배지를 보여주는 건 명백한 오류다.

```tsx
const isFreePreview = !awaiting;
const doneLabel = isFreePreview ? '입력 완료' : '결제 완료';
const title = isFreePreview ? '맛보기 문을 여는 중…' : '사주몬이 깨어나는 중…';
const firstStep = isFreePreview ? '입력 확인' : '결제 확인';
const activeStep = isFreePreview ? '맛보기 해석 생성 중…' : '해석 생성 중…';
```

`awaiting` prop의 유무로 플로우를 구분했다. 결제 플로우는 `awaiting='basic'` 또는 `awaiting='premium'`을 넘기고, 무료 맛보기는 prop 없이 렌더한다. 분기가 늘어났지만 한 컴포넌트 안에서 관리해 일관성을 유지했다.

입력 폼의 제출 버튼에도 같은 패턴을 적용했다. **useFormStatus**의 `pending` 상태를 감지해 제출 중일 때만 타이머를 시작하고, 완료되면 초기화한다.

## 카피 다듬기

같은 커밋에서 프리미엄 기능 설명 카피도 손봤다. 기존에는 "새 이웃과의 어울림 · 함께 태어난 해치"처럼 기능 이름만 나열했는데, 사용자가 그게 뭔지 바로 이해하기 어렵다는 피드백이 있었다.

"이웃과 얼마나 편하게 맞는지, 둘의 결이 만나면 어떤 상징이 되는지"처럼 혜택 중심으로 바꿨다. 해치도 "함께 태어난 해치"에서 "두 사람의 결을 합쳐 만든 관계 상징 해치"로 풀어썼다. 기능명보다 사용자가 얻는 것을 먼저 보여주는 방향이다.

## 테스트 안정화

fake timer와 `act()` 조합이 React 18에서 경고를 뱉는 문제가 있었다. `vi.advanceTimersByTimeAsync`를 `act()` 안으로 감싸서 해결했다. 대기 시간 표시 테스트도 추가해, 5초 경과 후 "지난 시간 5초 · 예상 남은 시간 15초"가 제대로 렌더되는지 검증한다.

로딩 화면은 흔히 소홀히 여기는 영역이지만, 실제로 사용자가 가장 불안을 느끼는 순간이다. 숫자 하나, 진행 바 하나가 이탈을 막는 데 생각보다 큰 역할을 한다.