---
title: "iOS 줌 버그부터 Tailwind v4 커서까지 — 전환 퍼널을 막는 UX 지뢰 제거하기"
description: "사주 MBTI 리포트 서비스의 모바일·데스크톱 UX 리뷰에서 발견한 전환 퍼널 직결 버그들을 한 번에 처리한 과정을 정리합니다."
pubDate: 2026-07-18
repo: saju-mbti-report
repoDisplayName: 사주 MBTI 리포트
tags: ["saju-mbti-report", "bugfix", "react"]
commits: ["20569faab3167d3f6a8a1cc837dd2f209e985a38"]
---
## 결제까지 가는 길에 숨어 있던 작은 구멍들

프로덕트를 어느 정도 만들고 나면 큰 기능보다 작은 마찰이 전환율을 갉아먹는다. 이번 커밋은 그런 종류의 작업이다. 화려한 기능 추가는 없지만, 사용자가 입력 폼에서 당황하거나, 버튼 위에 올려도 아무 반응이 없거나, 결제 화면에서 커서가 일반 포인터로 뜨는 것들 — 전환 퍼널을 직접 위협하는 UX 지뢰를 한 번에 제거했다.

## iOS Safari의 자동 줌 문제

iOS Safari는 포커스된 폼 컨트롤의 폰트 크기가 **16px 미만이면 자동으로 뷰포트를 줌인**한다. 사용자가 직접 줌을 풀어야 하는 불편함이 생기고, 레이아웃이 틀어지기도 한다.

`InputWizard`, `BirthTimeSelect`, `PartnerCompat` — 세 컴포넌트의 `input`과 `select`가 모두 `text-sm`(14px)으로 선언되어 있었다. 특히 양력/음력 선택 `select`는 부모로부터 11~12px을 상속받고 있었는데, Tailwind의 클래스가 명시적으로 선언되지 않아 iPad에서 재발 가능성도 있었다.

```tsx
// text-base(16px) 고정 — 16px 미만 폼 컨트롤은 iOS Safari 포커스 시 자동 줌을 유발한다.
const inputCls =
  'w-full border-0 border-b border-bronze/60 bg-transparent py-2.5 font-sans text-base text-ink ...';
```

해결책은 단순하다. 모든 폼 컨트롤을 `text-base`(16px)로 통일하고, 상속에 의존하던 `select` 요소에도 명시적으로 `text-base`를 추가했다. 시각적으로 크게 달라지지 않으면서 iOS 줌 문제를 완전히 차단한다.

## Tailwind v4가 바꿔버린 버튼 커서

Tailwind v4는 preflight(CSS 리셋)에서 `button` 요소의 커서를 `default`로 설정한다. 네이티브 앱의 관례를 따른 결정이지만, 소비자 웹에서는 버튼에 `pointer` 커서가 없으면 클릭 가능하다는 신호를 잃는다.

```css
/* Tailwind v4 preflight 는 button 커서를 default로 둔다 — 소비자 웹 기대치대로 복구. */
button:not(:disabled) {
  cursor: pointer;
}
```

`globals.css`에 한 줄 추가로 해결했다. `:not(:disabled)` 조건을 걸어서 비활성 버튼은 `not-allowed` 커서를 유지하도록 했다.

## CTA 버튼에 hover/active 피드백 추가

버튼이 클릭 가능해 보이는 것만큼 중요한 게 클릭했을 때 반응이다. `GoldButton`, `WaxButton`, 결제 진행 버튼, 리포트 페이지의 업셀 CTA까지 — 기존에는 아무런 hover/active 피드백이 없었다.

```tsx
// GoldButton
const cls = `${buttonBase} bg-gradient-to-b from-gold-btn-from to-gold-btn-to ... hover:brightness-105`;

// WaxButton  
const cls = `${buttonBase} bg-wax text-parchment ... hover:bg-jeok-deep`;

// 결제 버튼 (disabled 상태 게이트)
className="... transition enabled:hover:brightness-105 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
```

Tailwind v4의 `hover:`는 `@media(hover: hover)` 게이트 안에서 동작한다. 터치 기기에서 탭 후 hover 스타일이 눌어붙는 부작용이 자동으로 차단된다는 뜻이다. `enabled:` 변형자를 활용해 비활성 버튼에는 hover 효과가 적용되지 않도록 했다.

리포트 페이지의 업셀 CTA는 구조가 조금 달랐다. `<a>` 태그 안에 `<div>`로 된 버튼 스타일 요소가 있어서 직접 hover를 걸 수 없었다. **Tailwind의 `group`/`group-hover`** 패턴으로 해결했다.

```tsx
<a href={upsellHref} className="group block rounded-2xl ...">
  <div className="... transition group-hover:bg-jeok-deep group-active:translate-y-px">
    사주몬 깨우기
  </div>
</a>
```

## themeColor로 모바일 브라우저 크롬 통일

마지막으로 작지만 완성도를 높이는 디테일. 모바일 브라우저 상단 바(크롬)가 기본 흰색이나 시스템 색상으로 뜨면 어두운 톤의 앱 UI와 어색하게 분리되어 보인다.

Next.js의 `viewport` export에 `themeColor: "#1c1b2a"`를 추가해서 모바일 브라우저 크롬이 앱의 다크 커버 톤과 자연스럽게 이어지도록 했다.

## 마치며

이번 작업은 단일 커밋이지만 건드린 파일이 10개다. 각각의 수정은 작지만, 묶어서 보면 iOS 입력 UX, 버튼 인터랙션, 시각적 일관성까지 전환 퍼널 전반의 마찰을 줄이는 작업이었다. 큰 기능을 추가하는 것만큼, 이런 작은 지뢰들을 주기적으로 찾아서 제거하는 게 실제 사용자 경험을 만든다.