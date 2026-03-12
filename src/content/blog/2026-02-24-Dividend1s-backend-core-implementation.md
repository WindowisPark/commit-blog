---
title: "Spring Boot 3.2와 Java 21로 구현하는 배당분석 플랫폼 백엔드 아키텍처"
description: "배당1초 프로젝트의 백엔드 코어 시스템을 Spring Boot 3.2와 Java 21 기반으로 설계하고 구현한 과정을 소개합니다."
pubDate: 2026-02-24
repo: Dividend1s
repoDisplayName: 배당1초
tags: ["Dividend1s", "feature"]
commits: ["b07dadca401bc57cb3fdb8963c6d175d2c44103f"]
---
## 프로젝트 개요

**배당1초**는 부동산 배당분석을 자동화하는 플랫폼입니다. 사용자가 PDF 문서를 업로드하면 AI 파싱을 통해 데이터를 추출하고, 배당 수익률을 계산하여 리포트를 생성하는 서비스죠. 이번 포스트에서는 이 복잡한 워크플로우를 지원하기 위한 백엔드 아키텍처를 어떻게 설계했는지 공유하겠습니다.

## 기술 스택과 설계 철학

최신 **Java 21**과 **Spring Boot 3.2**를 선택한 이유는 성능과 개발 생산성 두 마리 토끼를 잡기 위해서였습니다. Virtual Thread와 Record 클래스 등 Java 21의 최신 기능들을 활용하면서, Spring Boot 3.x의 개선된 보안 모델과 observability 기능을 함께 사용할 수 있었거든요.

빌드 도구로는 **Gradle Kotlin DSL**을 채택했습니다. Groovy보다 타입 안전하고 IDE 지원이 우수해서 의존성 관리가 훨씬 편리했어요. 특히 멀티 모듈 프로젝트로 확장할 때 DSL의 재사용성이 큰 장점이 될 것 같습니다.

## 도메인 주도 설계로 복잡성 관리

핵심 비즈니스 로직을 명확하게 분리하기 위해 도메인별로 모듈을 구성했습니다:

- **auth**: 사용자 인증과 JWT 토큰 관리
- **analysis**: 분석 요청의 상태 머신과 워크플로우
- **document**: PDF 파싱과 데이터 추출
- **dividend**: 배당 계산 엔진
- **payment**: 토스페이먼츠 연동과 결제 처리
- **report**: PDF 리포트 생성과 페이월 제어

각 도메인은 Controller-Service-Repository 패턴을 따르되, 비즈니스 규칙은 엔티티 내부에 캡슐화했습니다. 예를 들어 `AnalysisRequest` 엔티티는 자체적으로 상태 전환 메서드를 제공합니다:

```java
public void startParsing() {
    this.status = AnalysisStatus.PARSING;
}

public void complete() {
    this.status = AnalysisStatus.COMPLETED;
}

public void fail(String errorMessage) {
    this.status = AnalysisStatus.FAILED;
    this.errorMessage = errorMessage;
}
```

이렇게 하면 상태 변경 로직이 한 곳에 집중되어 일관성을 보장할 수 있어요.

## PostgreSQL과 JSONB를 활용한 유연한 데이터 모델링

구조화된 데이터와 비구조화된 데이터를 함께 다뤄야 하는 특성상 **PostgreSQL**의 **JSONB** 타입을 적극 활용했습니다. 특히 `Right` 엔티티에서는 파싱된 원시 데이터를 JSONB로 저장하여 스키마 변경 없이도 다양한 형태의 데이터를 수용할 수 있게 했어요.

```java
@Entity
public class Right extends BaseEntity {
    @Type(JsonBinaryType.class)
    @Column(name = "raw_data", columnDefinition = "jsonb")
    private JsonNode rawData;
    
    // 구조화된 필드들
    private String rightType;
    private BigDecimal totalShares;
}
```

**hypersistence-utils** 라이브러리를 사용해서 Hibernate 6.x에서 JSONB 매핑을 깔끔하게 처리했습니다. 이렇게 하면 복잡한 JSON 데이터도 타입 안전하게 다룰 수 있어요.

## JWT 기반 Stateless 인증 시스템

마이크로서비스 아키텍처로의 확장을 고려해 **JWT 기반의 Stateless 인증**을 구현했습니다. Spring Security 6.x의 새로운 설정 방식을 적용해서 기존의 WebSecurityConfigurerAdapter 대신 SecurityFilterChain Bean을 사용했어요.

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .sessionManagement(session -> session.sessionCreationPolicy(STATELESS))
        .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/v1/auth/**", "/api/v1/payments/webhook").permitAll()
            .anyRequest().authenticated()
        )
        .build();
}
```

특히 결제 웹훅 엔드포인트는 인증 없이 접근할 수 있도록 예외 처리했습니다. 토스페이먼츠에서 오는 콜백을 안전하게 받기 위한 설정이죠.

## 통합 예외 처리와 API 응답 표준화

일관된 API 응답 형태를 위해 `ApiResponse<T>` 래퍼 클래스와 `@RestControllerAdvice` 기반의 글로벌 예외 처리기를 구현했습니다.

```java
public record ApiResponse<T>(
    boolean success,
    T data,
    String message,
    String errorCode
) {
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data, null, null);
    }
    
    public static <T> ApiResponse<T> error(ErrorCode errorCode) {
        return new ApiResponse<>(false, null, errorCode.getMessage(), errorCode.getCode());
    }
}
```

비즈니스 예외는 `ErrorCode` enum으로 관리하여 프론트엔드에서 에러 처리를 일관되게 할 수 있도록 했습니다.

## 확장 가능한 아키텍처 설계

현재는 모놀리식으로 시작했지만, 향후 마이크로서비스로 분리할 수 있도록 설계했습니다. **ParsingServiceClient**는 이미 외부 FastAPI 서비스와 통신하는 구조로 되어 있고, Spring의 RestClient를 사용해서 HTTP 통신을 추상화했어요.

또한 **Flyway**를 통한 데이터베이스 마이그레이션 관리, **Docker** 기반의 배포, **SpringDoc**을 통한 API 문서 자동 생성 등 운영 환경을 고려한 설정들도 함께 준비했습니다.

이번에 구축한 백엔드 아키텍처는 복잡한 비즈니스 로직을 안정적으로 처리하면서도 확장 가능한 구조를 갖추고 있습니다. 다음 단계에서는 실제 파싱 엔진과의 연동, 실시간 상태 업데이트를 위한 SSE 구현 등을 추가할 예정입니다.