---
title: "Spring Security + JWT 쿠키 인증으로 안전하게 주문 시스템 구축하기"
description: "SpotPrice 프로젝트에 JWT 기반 인증 시스템을 도입하고, 사용자별 주문 관리 기능을 구현한 과정을 소개합니다."
pubDate: 2026-02-07
repo: SpotPrice
repoDisplayName: SpotPrice
tags: ["SpotPrice", "feature"]
commits: ["927306d57a9875cb9ded6a7f5148c1da9d8cd9ef"]
---
## 인증 없는 주문 시스템의 한계

기존 SpotPrice 시스템은 누구나 주문을 생성하고 결제할 수 있는 구조였습니다. 실제 서비스라면 "내 주문만 보기", "다른 사람이 내 주문을 결제하지 못하게 하기" 같은 기본적인 보안이 필요했죠. 이번 업데이트에서는 **Spring Security**와 **JWT**를 활용해 완전한 사용자 인증 시스템을 구축했습니다.

## User 도메인과 헥사고날 아키텍처

먼저 User 도메인을 설계했습니다. 헥사고날 아키텍처를 따라 도메인 레이어에 핵심 비즈니스 로직을, 애플리케이션 레이어에 유스케이스를 분리했습니다.

```java
@Entity
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(unique = true, nullable = false)
    private String email;
    
    private String encodedPassword;
    private Instant createdAt;
    
    public static User create(String email, String encodedPassword, ClockPort clock) {
        return new User(null, email, encodedPassword, clock.now());
    }
}
```

도메인 객체는 생성 팩토리 메서드를 통해 불변성을 보장하고, **PasswordEncoderPort**와 **UserRepositoryPort** 인터페이스를 통해 외부 의존성을 분리했습니다. 이렇게 하면 도메인 로직을 테스트할 때 모킹이 쉬워지고, 나중에 다른 암호화 방식이나 DB로 변경하기도 용이합니다.

## JWT + HttpOnly 쿠키 인증 전략

인증 방식으로는 **JWT 토큰을 HttpOnly 쿠키**에 저장하는 방식을 선택했습니다. Bearer 토큰 방식과 비교해 XSS 공격에 더 안전하고, 프론트엔드에서 토큰 관리 부담이 없어집니다.

```java
@PostMapping("/login")
public ResponseEntity<ApiResponse<AuthResult>> login(@RequestBody LoginRequest request,
                                                     HttpServletResponse response) {
    AuthResult result = loginUseCase.login(
            new LoginCommand(request.email(), request.password()));

    String token = jwtTokenProvider.generate(result.userId());
    ResponseCookie cookie = ResponseCookie.from("token", token)
            .httpOnly(true)
            .secure(true)
            .path("/")
            .sameSite("Lax")
            .maxAge(3600)
            .build();
    response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());

    return ResponseEntity.ok(ApiResponse.success(result));
}
```

**SameSite=Lax** 설정으로 CSRF 공격을 방어하고, **HttpOnly** 플래그로 클라이언트 스크립트에서 토큰 접근을 차단했습니다. 현재는 단일 오리진 환경을 전제로 하며, 추후 cross-origin이 필요하면 CORS 설정을 추가할 예정입니다.

## Stateless 보안 설정과 예외 처리

Spring Security를 **Stateless**로 설정해 세션을 사용하지 않고, JWT만으로 인증 상태를 관리합니다. 401과 403 에러를 명확히 분리해 클라이언트가 적절히 대응할 수 있도록 했습니다.

```java
.exceptionHandling(ex -> ex
    .authenticationEntryPoint((request, response, authException) -> {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        ApiResponse<Void> body = ApiResponse.error(ErrorCode.UNAUTHORIZED);
        response.getWriter().write(objectMapper.writeValueAsString(body));
    })
    .accessDeniedHandler((request, response, accessDeniedException) -> {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        ApiResponse<Void> body = ApiResponse.error(ErrorCode.FORBIDDEN);
        response.getWriter().write(objectMapper.writeValueAsString(body));
    })
)
```

**401 UNAUTHORIZED**는 토큰이 없거나 만료된 경우, **403 FORBIDDEN**은 인증은 되었지만 권한이 없는 경우로 구분했습니다. 향후 역할 기반 접근 제어를 도입할 때 403 응답을 더 활용할 수 있을 것입니다.

## 사용자별 주문 관리와 소유권 검증

기존 주문 시스템에 사용자 ID를 추가해 "내 주문만 조회/결제"할 수 있도록 개선했습니다. 모든 주문 관련 API에 `@AuthenticationPrincipal Long userId` 파라미터를 추가해 현재 로그인한 사용자 정보를 자동 주입받습니다.

주문 조회와 상세 조회 API를 새로 추가했고, 페이지네이션도 지원합니다. 비즈니스 로직에서는 사용자가 요청한 주문이 실제로 본인 것인지 검증하는 소유권 체크를 구현했습니다.

## 확장 지점과 향후 계획

현재 구현은 v1 범위로, 몇 가지 확장 지점을 남겨뒀습니다. 인증 Principal을 단순히 `Long userId`로 사용하고 있지만, v2에서는 `AuthPrincipal(userId, email, roles)` 객체로 확장해 역할 기반 접근 제어를 지원할 예정입니다.

로그아웃도 현재는 클라이언트에서 쿠키를 삭제하는 방식이지만, 보안이 중요한 환경에서는 서버 측 JWT 블랙리스트 관리가 필요할 수 있습니다. 또한 cross-origin 환경에서는 Bearer 토큰이나 CORS + withCredentials 조합을 고려해볼 수 있습니다.

이번 인증 시스템 구축을 통해 SpotPrice는 실제 서비스 수준의 보안을 갖춘 주문 플랫폼으로 발전했습니다. 헥사고날 아키텍처의 장점을 살려 테스트 가능하고 확장 가능한 구조를 유지하면서도, 실용적인 보안 요구사항을 충족할 수 있었습니다.