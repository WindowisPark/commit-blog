---
title: "야구 분석 앱 UX 대개편: 7가지 핵심 개선사항으로 사용자 경험 혁신"
description: "KBO 분석 대시보드의 사용자 경험을 크게 개선한 UI/UX 개편 작업. 네비게이션 활성화 상태부터 토스트 알림까지 7가지 핵심 기능을 추가했습니다."
pubDate: 2026-04-01
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "react"]
commits: ["db7e9a1e1b61e44097b8844114049d79794441c4", "8b7e96d0127ad10541c6a5ec6697d61c71121ab0", "4c56399d2f524fa5fc9548172fa2c075f6d453cc", "241999b19cc763a3d0a88f72d352bffbc4e3c7d7", "fb3301b1da9f56013b33dcb80baedeabf9efd4a0"]
---
## 사용자 경험이 앱의 성패를 좌우한다

**KBO Prediction** 프로젝트를 진행하면서 가장 중요하게 생각한 것은 단순히 기능이 작동하는 것이 아니라, 사용자가 자연스럽고 직관적으로 사용할 수 있는 경험을 만드는 것이었습니다. 이번 개편에서는 "작은 노력으로 큰 임팩트"를 낼 수 있는 7가지 핵심 개선사항을 적용했습니다.

## 네비게이션과 상태 표시의 혁신

가장 먼저 해결한 것은 사용자가 현재 어디에 있는지 알 수 없었던 문제였습니다. **NavLinks 컴포넌트**를 새로 만들어 `usePathname` 훅으로 현재 페이지를 감지하고, 활성 상태를 시각적으로 표현했습니다.

```tsx
const isActive = pathname === link.href;
return (
  <a
    className={`px-4 py-2 rounded-lg text-sm transition-all ${
      isActive
        ? "text-white bg-[#1a2236] font-semibold border border-blue-500/30"
        : "text-[#94a3b8] hover:text-white hover:bg-[#1a2236]"
    }`}
  >
    {link.label}
  </a>
);
```

**라이브 경기 표시**도 단순한 "Live" 텍스트에서 펄싱 애니메이션이 적용된 빨간 점으로 바꿔 시각적 임팩트를 높였습니다. 이런 작은 디테일들이 사용자에게 "살아있는" 앱이라는 느낌을 줍니다.

## 로딩 상태와 피드백의 완성

사용자가 가장 답답해하는 순간은 "뭔가 일어나고 있는지 모를 때"입니다. 이를 해결하기 위해 **스켈레톤 로딩**을 도입했습니다:

```tsx
{todayLoading ? (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
    {[...Array(5)].map((_, i) => (
      <div key={i} className="bg-[#111827] rounded-xl border border-[#1e293b] p-4 animate-pulse">
        <div className="flex justify-between mb-3">
          <div className="h-4 w-20 bg-[#1e293b] rounded" />
          <div className="h-4 w-16 bg-[#1e293b] rounded-full" />
        </div>
        {/* ... */}
      </div>
    ))}
  </div>
)
```

분석 완료나 오류 발생 시에는 **토스트 알림**으로 즉각적인 피드백을 제공합니다. 성공은 초록색, 실패는 빨간색으로 구분하고 4초 후 자동으로 사라집니다.

## 분석 결과의 몰입도 개선

분석 결과가 나오면 사용자의 시선이 자연스럽게 그곳으로 향하도록 **스크롤 자동 이동**과 **페이드업 애니메이션**을 적용했습니다:

```tsx
useEffect(() => {
  if (prediction && resultRef.current) {
    resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}, [prediction]);
```

결과 창 상단에는 **스티키 헤더**를 두어 사용자가 길어진 분석 내용을 스크롤하면서도 항상 닫기 버튼에 접근할 수 있도록 했습니다.

## 모바일 최적화와 반응형 디자인

모바일에서의 사용성을 고려해 **플렉스 레이아웃**을 개선했습니다. 데스크톱에서는 가로로 배치되던 버튼들이 모바일에서는 세로로 스택되도록 하고, 텍스트 크기도 화면에 맞게 조정됩니다.

## 데이터 지속성과 시각화 개선

사용자 편의성을 위해 **sessionStorage에서 localStorage로 전환**해 브라우저를 닫았다 열어도 분석 결과가 유지되도록 했습니다. 또한 **History 페이지를 완전히 재설계**해 단순한 로그 리스트에서 통계 대시보드로 바꿨습니다.

**Standings 페이지**에서는 텍스트 아이콘을 실제 **SVG 엠블럼**으로 교체하고, ELO 바에 팀 고유 색상을 적용해 시각적 정체성을 강화했습니다. 포스트시즌 컷라인도 5위 아래에 점선으로 표시해 한눈에 구분할 수 있게 만들었습니다.

## 작은 디테일들의 큰 차이

빈 상태 화면에도 신경을 썼습니다. 단순히 "데이터가 없습니다"라고 표시하는 대신, 적절한 이모지와 함께 다음 행동을 유도하는 버튼을 배치했습니다. 경기가 종료된 경우에는 분석 버튼을 숨기고 라인업 버튼만 전체 너비로 표시하는 등 컨텍스트에 맞는 UI를 제공합니다.

이러한 개선사항들은 각각은 작은 변화이지만, 종합적으로는 완전히 다른 수준의 사용자 경험을 만들어냅니다. "기능이 작동한다"에서 "사용하고 싶어진다"로의 전환이 바로 이런 디테일에서 나오는 것 같습니다.