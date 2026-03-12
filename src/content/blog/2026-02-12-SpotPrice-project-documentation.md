---
title: "SpotPrice v1.5 완성: 실시간 가격 변동 웹 UI와 체계적인 개발 로드맵"
description: "API 전용이었던 SpotPrice 프로젝트에 Thymeleaf 기반 웹 UI를 추가하고, v1 완성부터 v2 확장까지 체계적인 로드맵을 수립한 과정을 소개합니다."
pubDate: 2026-02-12
repo: SpotPrice
repoDisplayName: SpotPrice
tags: ["SpotPrice", "docs"]
commits: ["fcfd31411b5a7dbc2037d25deecd45591fa87f59", "36827c9a29a4fe1842c6c29d8deaa4566da5f9cb", "d520c39d414ef3dcf13631b015c51e3d963ce373"]
---
## 프로젝트 현황: v1 완성에서 v1.5로

SpotPrice는 **실시간 가격 변동이 있는 한정 상품 거래 시스템**입니다. 최근 몇 주간의 커밋을 통해 v1 핵심 기능을 완료하고, Thymeleaf 기반 웹 UI를 추가한 v1.5까지 완성했습니다.

핵심 플로우는 간단하지만 강력합니다: **Offer 조회(Quote) → 주문 생성(CreateOrder) → 결제(PayOrder) → 접근 권한 발급(IssueAccessGrant)**. 이 과정에서 가격은 시간에 따라 상승하고, 동시성 제어를 통해 단 한 명만 구매할 수 있습니다.

## v1 잔여 작업들의 완성

로드맵을 처음 작성할 때는 v1에서 해결해야 할 과제들이 여러 개 남아있었습니다. **API 에러 정책**, **Offer 만료 처리**, **보안** 구현이 핵심이었죠.

가장 먼저 해결한 것은 **API 에러 정책**이었습니다. 도메인 예외를 HTTP 상태 코드로 매핑하는 체계를 만들었습니다:

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    @ExceptionHandler(OfferExpiredException.class)
    public ResponseEntity<ApiResponse<?>> handleOfferExpired(OfferExpiredException e) {
        return ResponseEntity.status(410)
            .body(ApiResponse.error(ErrorCode.OFFER_EXPIRED));
    }
    
    @ExceptionHandler(OfferAlreadySoldException.class)
    public ResponseEntity<ApiResponse<?>> handleOfferSold(OfferAlreadySoldException e) {
        return ResponseEntity.status(409)
            .body(ApiResponse.error(ErrorCode.OFFER_ALREADY_SOLD));
    }
}
```

**Offer 만료 처리**는 데이터베이스 레벨에서 해결했습니다. 목록 조회 시 `expire_at`을 확인하는 쿼리 필터링과 함께 **PageQuery/PageResult** 구조로 페이지네이션까지 함께 구현했습니다.

**보안** 구현에서는 User 도메인을 새로 추가하고 **JWT Cookie 기반 인증**을 도입했습니다. 특히 API와 웹 UI가 공존하는 환경에서 401/403 응답을 적절히 분리하는 것이 핵심이었습니다.

## Thymeleaf UI: API를 눈으로 확인하다

v1.5의 하이라이트는 **Thymeleaf 웹 UI** 추가입니다. API만으로는 실제 동작을 확인하기 어려웠는데, 이제 브라우저에서 직접 전체 플로우를 체험할 수 있게 되었습니다.

기술 스택은 실용성에 집중했습니다:
- **Thymeleaf**: Spring Boot 기본 내장, 별도 빌드 도구 불필요
- **Pico CSS**: CDN으로 로드하는 classless CSS 프레임워크
- **htmx**: 페이지 새로고침 없이 부분 업데이트

가장 인상적인 부분은 **실시간 가격 갱신**입니다. Offer 상세 페이지에서 htmx가 3초마다 현재 가격을 자동으로 업데이트합니다:

```html
<div hx-get="/htmx/offers/{{offerId}}/current-price" 
     hx-trigger="every 3s" 
     hx-target="#price-display">
    <span id="price-display">{{currentPrice}}원</span>
</div>
```

이렇게 구현한 페이지들은 실제 사용자 경험을 시뮬레이션합니다:
- Offer 목록에서 카드 형태로 상품 탐색
- 상세 페이지에서 실시간 가격 변동 확인
- 주문/결제 후 AccessGrant PIN 발급까지

## 보안 설정의 스마트한 분기

웹 UI와 API가 공존하면서 발생한 흥미로운 문제는 **인증 실패 시 응답 방식**이었습니다. API 호출에는 JSON 형태의 401 응답을, 웹 페이지 접근에는 로그인 페이지 리다이렉트를 해야 했죠.

이를 **SecurityConfig의 스마트 EntryPoint**로 해결했습니다. 요청 헤더의 `Accept`나 `Content-Type`을 확인해서 API 요청인지 웹 페이지 요청인지 구분하는 방식입니다.

## 체계적인 로드맵 수립

가장 만족스러운 부분은 **체계적인 로드맵 문서화**입니다. 단순히 TODO 리스트가 아니라, 각 기능이 어떤 정책 문서의 몇 번째 섹션을 구현하는지, 어떤 커밋에서 완료되었는지까지 추적 가능하게 만들었습니다.

로드맵은 3단계로 구성되어 있습니다:
- **v1**: 핵심 비즈니스 로직 (완료)
- **v1.5**: 웹 UI 프로토타입 (완료)
- **v2**: User 도메인 확장, 외부 PG 연동, 프론트엔드 분리

v2에서는 공급자(Host)와 구매자(Guest) 역할 분리, Offer 생성 관리 기능, 외부 결제 연동 등 실제 서비스로 발전시키기 위한 기능들을 계획하고 있습니다.

## 남은 과제와 다음 스텝

v1에서 유일하게 남은 작업은 **감사 로그** 구현입니다. OFFER_VIEW, PAY_ATTEMPT, PAY_SUCCESS 등의 이벤트를 로깅하는 시스템인데, 이는 실제 운영 환경에서 사용자 행동 분석과 보안 모니터링에 필수적입니다.

v1.5 완성으로 이제 SpotPrice는 완전히 작동하는 웹 애플리케이션이 되었습니다. API의 모든 기능을 브라우저에서 직접 확인할 수 있고, 실시간 가격 변동도 눈으로 볼 수 있습니다.

다음 단계는 v2로 넘어가서 **User 도메인 확장**부터 시작할 예정입니다. 현재는 단순한 이메일/패스워드 인증만 있지만, 프로필 관리, 역할 기반 접근 제어, JWT 서버 무효화 등 더 정교한 사용자 관리 시스템으로 발전시킬 계획입니다.