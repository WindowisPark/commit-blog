---
title: "REST API에서 풀스택으로 - Thymeleaf + htmx로 실시간 동적 가격 UI 구현하기"
description: "SpotPrice 프로젝트에 Pico CSS와 htmx를 활용한 웹 UI를 추가하면서 REST API와 웹 UI를 하나의 애플리케이션에서 함께 서빙하는 하이브리드 아키텍처를 구현했습니다."
pubDate: 2026-02-12
repo: SpotPrice
repoDisplayName: SpotPrice
tags: ["SpotPrice", "feature"]
commits: ["c43d01a6b87a6a59deafcbd5edba6647e5eedadb"]
---
## API와 Web UI의 완벽한 공존

SpotPrice 프로젝트를 진행하면서 흥미로운 도전에 직면했습니다. 기존 **REST API**는 유지하면서도, 포트폴리오를 위한 시각적인 웹 인터페이스가 필요했습니다. 단순히 별도의 프론트엔드 프로젝트를 만들 수도 있었지만, 하나의 애플리케이션에서 API와 Web UI를 모두 제공하는 하이브리드 구조를 선택했습니다.

가장 흥미로운 부분은 **SecurityConfig**의 이중화 처리였습니다. API 요청에는 JSON 응답과 401 상태 코드를, 웹 요청에는 로그인 페이지 리다이렉트를 제공해야 했거든요.

```java
.exceptionHandling(ex -> ex
    .authenticationEntryPoint((request, response, authException) -> {
        if (request.getRequestURI().startsWith("/api/")) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            ApiResponse<Void> body = ApiResponse.error(ErrorCode.UNAUTHORIZED);
            response.getWriter().write(objectMapper.writeValueAsString(body));
        } else {
            response.sendRedirect("/login");
        }
    })
)
```

이런 방식으로 `/api/`로 시작하는 요청과 일반 웹 요청을 구분해서 처리할 수 있었습니다. 하나의 Spring Security 설정으로 두 가지 클라이언트 타입을 모두 지원하는 우아한 해결책이었죠.

## Thymeleaf + Pico CSS로 빠른 프로토타이핑

프론트엔드 개발에 시간을 많이 투자하고 싶지 않았기 때문에, **Pico CSS**를 선택했습니다. 클래스 기반이 아닌 시맨틱 HTML 기반의 스타일링이 매력적이었거든요. 별도의 CSS 작성 없이도 깔끔한 디자인을 얻을 수 있었습니다.

**Thymeleaf**의 fragment 기능을 적극 활용해서 레이아웃을 모듈화했습니다. 특히 가격 정보를 표시하는 부분을 별도의 fragment로 분리한 것이 나중에 htmx와 조합할 때 빛을 발했습니다.

```html
<div th:fragment="content">
    <p class="price">현재가: ₩<span th:text="${#numbers.formatInteger(quote.currentPrice, 1, 'COMMA')}"></span></p>
    <p class="price-sub">
        만료: <span th:text="${#temporals.format(quote.expiresAt, 'yyyy-MM-dd HH:mm')}"></span>
        | 조회 시각: <span th:text="${#temporals.format(quote.quotedAt, 'HH:mm:ss')}"></span>
    </p>
</div>
```

## htmx로 구현한 실시간 가격 갱신

가장 신경 쓴 부분은 SpotPrice의 핵심인 **동적 가격 갱신**이었습니다. JavaScript 없이도 3초마다 자동으로 가격이 업데이트되어야 했거든요. htmx가 이 문제를 정말 우아하게 해결해주었습니다.

별도의 컨트롤러 메서드를 만들어 가격 fragment만 반환하도록 했고, htmx의 `hx-get`과 `hx-trigger="every 3s"`를 사용해서 자동 갱신을 구현했습니다. 페이지 전체를 새로고침하지 않고도 가격만 부드럽게 업데이트되는 경험을 제공할 수 있었죠.

```java
@GetMapping("/offers/{id}/price-fragment")
public String priceFragment(@PathVariable Long id, Model model) {
    OfferQuoteResult quote = getOfferQuoteUseCase.getQuote(id);
    model.addAttribute("quote", quote);
    return "fragments/price-fragment";
}
```

## 전체 플로우의 완성

Offer 목록 조회부터 주문 생성, 결제, 그리고 Access Grant 발급까지의 전체 플로우를 웹 UI로 구현했습니다. 특히 **WebOrderController**에서는 Spring Security의 `@AuthenticationPrincipal`을 활용해서 현재 로그인한 사용자 ID를 자연스럽게 주입받을 수 있었습니다.

폼 기반의 인증 방식과 JWT 토큰을 쿠키로 관리하는 방식을 조합한 것도 인상적이었습니다. 웹 브라우저에서는 HttpOnly 쿠키로 토큰을 안전하게 저장하면서도, 기존 API의 Authorization 헤더 방식은 그대로 유지할 수 있었거든요.

## 하이브리드 아키텍처의 장점

이번 구현을 통해 하나의 애플리케이션에서 API와 Web UI를 함께 제공하는 방식의 장점을 체감할 수 있었습니다. 동일한 비즈니스 로직과 도메인 모델을 공유하면서도, 클라이언트 타입에 따라 적절한 응답 형태를 제공할 수 있었습니다.

특히 포트폴리오 관점에서는 REST API의 기술적 깊이와 웹 UI의 시각적 임팩트를 모두 보여줄 수 있는 효과적인 구조가 되었습니다. **Thymeleaf**와 **htmx**의 조합은 복잡한 JavaScript 프레임워크 없이도 현대적인 사용자 경험을 제공할 수 있음을 보여주는 좋은 사례였죠.

개발자로서 가장 만족스러운 부분은 기존 아키텍처를 전혀 손상시키지 않고 새로운 기능을 추가할 수 있었다는 점입니다. Clean Architecture의 힘이 다시 한 번 증명된 순간이었습니다.