---
title: "모달 하나 제대로 만들기: useModalChrome 훅 설계기"
description: "Escape 키, 스크롤 잠금, 초기 포커스. 모달의 기본기를 공용 훅으로 정리한 과정을 소개합니다."
pubDate: 2026-07-18
repo: saju-mbti-report
repoDisplayName: 사주 MBTI 리포트
tags: ["saju-mbti-report", "bugfix", "react"]
commits: ["140ff5b8f7a5c312abf4649479010d09b2b8aa0b"]
---
## 모달은 생각보다 손이 많이 간다

모달을 처음 만들 때는 단순히 열고 닫는 토글 상태 하나면 충분하다고 생각하기 쉽다. 그런데 UI 리뷰를 한 번 돌리고 나면 빠진 것들이 눈에 들어오기 시작한다. Escape 키로 안 닫힌다, 모달 뒤 배경이 스크롤된다, 열었을 때 포커스가 어디로 가는지 모르겠다.

사주 MBTI 리포트 프로젝트에서 정확히 이 상황이 벌어졌다. `FeedbackModal`과 `BunsinMapModal` 두 모달이 각자 Escape 처리를 따로 구현하거나 아예 빠뜨린 채였고, 스크롤 잠금과 초기 포커스는 둘 다 없었다. 이번 작업의 목표는 이 세 가지를 하나의 훅으로 묶어 두 모달이 공유하게 만드는 것이었다.

## AppShell이 스크롤 컨테이너라는 문제

일반적인 모달 스크롤 잠금은 `document.body`에 `overflow: hidden`을 거는 방식으로 해결한다. 그런데 이 프로젝트는 데스크톱에서 앱을 스마트폰 프레임처럼 보여주는 구조라, 실제 스크롤은 `body`가 아니라 `AppShell` 내부의 div에서 일어난다.

`body`를 잠궈봤자 배경 스크롤이 막히지 않는다. 그래서 **`data-app-scroll`** 마커를 스크롤 컨테이너에 붙이고, 훅이 이 요소를 직접 찾아 잠그는 방식을 택했다.

```ts
export function useModalChrome(active: boolean, onClose: () => void) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);

    const scroller = document.querySelector<HTMLElement>('[data-app-scroll]');
    const prevOverflowY = scroller?.style.overflowY ?? '';
    if (scroller) scroller.style.overflowY = 'hidden';

    closeButtonRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', onKey);
      if (scroller) scroller.style.overflowY = prevOverflowY;
    };
  }, [active, onClose]);

  return closeButtonRef;
}
```

훅은 `active`와 `onClose` 두 인자만 받는다. 반환값은 닫기 버튼에 붙일 ref. 모달이 열리면 Escape 리스너 등록, 스크롤 잠금, 닫기 버튼 포커스 이동이 한 번에 일어나고, 정리 함수에서 모두 원복된다.

## 기존 코드 교체

`BunsinMapModal`에는 자체적으로 구현된 Escape 핸들러가 있었다. `useEffect` 안에서 `keydown` 이벤트를 직접 붙이는 방식이었는데, 이걸 `useModalChrome`으로 교체하면서 스크롤 잠금과 초기 포커스까지 한 번에 얻었다.

```tsx
const close = useCallback(() => setOpen(false), []);
const closeButtonRef = useModalChrome(open, close);
```

`FeedbackModal`은 Escape 처리 자체가 없었다. 훅 한 줄 추가로 해결됐다.

모바일 대응도 함께 챙겼다. `85vh`로 되어 있던 최대 높이를 **`85dvh`**로 바꿔 iOS에서 주소창이 올라오고 내려갈 때 모달이 잘리는 현상을 잡았다. 토스트 위치는 `right-3`에서 `left-1/2 -translate-x-1/2`로 바꿔 데스크톱 프레임 중앙에 정렬되도록 했다.

## 테스트로 동작을 명문화

훅이 제대로 동작하는지 확인하기 위해 4개의 테스트를 작성했다.

- Escape 키 입력 시 `onClose` 호출
- 모달 열릴 때 닫기 버튼에 포커스
- 열릴 때 스크롤러 잠금, 닫힐 때 복원
- `modal`이 `null`이면 렌더와 잠금 모두 없음

스크롤 잠금 테스트는 jsdom 환경에서 `data-app-scroll` 마커를 가진 div를 직접 만들어 붙이고, 마운트/언마운트 전후로 `overflowY` 값을 확인하는 방식으로 작성했다. DOM 마커 기반 설계 덕분에 실제 환경과 가깝게 테스트할 수 있었다.

## 작은 것들이 사용성을 만든다

닫기 버튼 히트 영역도 이번에 함께 손봤다. `×` 버튼에 `-m-2 p-2`를 추가해 시각적 크기는 유지하면서 실제 탭 가능한 영역을 넓혔다. 토스트의 닫기 버튼도 마찬가지로 `-m-1.5 p-2.5`를 적용했다.

이런 변경들은 각각 따로 보면 사소하다. 그런데 Escape가 안 되고, 배경이 스크롤되고, 포커스가 사라지고, 버튼이 잘 안 눌리는 모달은 사용자 입장에서 분명히 어딘가 덜 된 느낌을 준다. 공용 훅 하나로 이 네 가지를 한 번에 정리했다는 점에서 만족스러운 작업이었다.