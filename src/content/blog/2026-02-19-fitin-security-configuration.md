---
title: "Spring Boot 보안 하드닝: 환경별 설정 분리와 WebSocket 보안 강화"
description: "운영 환경에서 필수인 민감 정보 보호와 환경별 설정 분리를 통해 FitIn 프로젝트의 보안을 한 단계 업그레이드한 과정을 소개합니다."
pubDate: 2026-02-19
repo: fitin
repoDisplayName: FitIn
tags: ["fitin", "refactoring"]
commits: ["89abe2a315411831acab615588090e2b5d680650"]
---
## 왜 환경별 설정 분리가 필요했나

FitIn 프로젝트를 개발하면서 가장 큰 고민 중 하나는 **보안**이었다. 초기에는 빠른 개발을 위해 모든 설정을 `application.properties` 하나에 몰아넣었지만, 운영 배포를 앞두고 심각한 문제들이 보이기 시작했다.

가장 치명적인 것은 데이터베이스 비밀번호와 **JWT Secret**이 소스코드에 하드코딩되어 있다는 점이었다. 이는 GitHub에 올라가는 순간 전 세계에 공개되는 보안 취약점이다. 또한 로컬과 운영 환경이 동일한 설정을 사용해 운영에서도 SQL 로그가 출력되고, DDL 자동 변경이 활성화되어 있어 데이터 손실 위험이 컸다.

## 3단계 환경별 설정 구조 설계

기존의 단일 설정 파일을 **공통 설정**과 **환경별 설정**으로 분리하는 구조를 설계했다. 핵심 아이디어는 민감하지 않은 공통 설정은 Git에 커밋하되, 환경별 특화 설정은 별도 파일로 관리하는 것이다.

```properties
# application.properties (공통 설정)
spring.datasource.url=jdbc:mysql://localhost:3306/fitin_db
spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver
jwt.expiration=86400000
```

로컬 개발 환경에서는 `application-local.properties`에서 실제 비밀번호를 직접 입력하고, 운영 환경에서는 `application-prod.properties`에서 환경변수를 참조하도록 구성했다. 이를 통해 개발자는 편리하게 작업하면서도 운영 보안을 확보할 수 있다.

## 민감 정보 완전 격리

가장 까다로운 부분은 **JWT Secret** 처리였다. 기존에는 256비트 Base64 문자열이 그대로 노출되어 있었는데, 이를 환경변수로 외부화했다.

```properties
# application-prod.properties
spring.datasource.username=${DB_USERNAME}
spring.datasource.password=${DB_PASSWORD}
jwt.secret=${JWT_SECRET}
```

운영 환경에서는 컨테이너나 서버의 환경변수를 통해 이 값들이 주입된다. 동시에 로컬 개발자들을 위해 `application-local.properties.example` 템플릿 파일을 제공해, 어떤 값들을 설정해야 하는지 가이드를 제공했다.

## WebSocket CORS 보안 강화

기존의 **WebSocket 설정**에서는 모든 Origin을 허용하는 `allowedOrigins("*")`를 사용하고 있었다. 이는 개발 단계에서는 편리하지만 운영에서는 보안 위험이 크다.

```java
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
    
    @Value("${websocket.allowed-origins}")
    private String allowedOrigins;
    
    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(smartMirrorHandler, "/smart-mirror")
                .setAllowedOrigins(allowedOrigins.split(","));
    }
}
```

이제 허용할 Origin을 프로퍼티 파일에서 명시적으로 관리한다. 로컬에서는 `localhost:3000,localhost:8080`을, 운영에서는 실제 도메인만을 화이트리스트로 등록해 **CSRF 공격**을 방지할 수 있다.

## JPA DDL 전략의 환경별 차별화

개발 환경과 운영 환경에서 가장 다르게 관리해야 하는 설정 중 하나가 **JPA DDL 전략**이다. 로컬에서는 스키마 변경이 자유로워야 하지만, 운영에서는 의도치 않은 테이블 변경을 막아야 한다.

로컬 환경에서는 `ddl-auto=update`로 설정해 엔티티 변경 시 자동으로 스키마가 업데이트되도록 했고, 운영에서는 `ddl-auto=validate`로 설정해 스키마 불일치 시 애플리케이션이 시작되지 않도록 했다. 이를 통해 운영 배포 전에 스키마 이슈를 미리 발견할 수 있다.

## 보안 설정의 완전성 검증

모든 변경사항을 적용한 후, **`.gitignore`**에 `application-local.properties`를 추가해 실제 민감 정보가 Git에 커밋되지 않도록 했다. 동시에 새로운 개발자가 프로젝트를 클론했을 때 어떤 설정이 필요한지 알 수 있도록 `.example` 파일을 제공했다.

이번 보안 하드닝 작업을 통해 FitIn 프로젝트는 개발 편의성을 유지하면서도 운영 수준의 보안을 확보할 수 있게 되었다. 특히 WebSocket CORS 제한과 환경변수 기반 민감 정보 관리는 실제 서비스에서 필수적인 보안 요소들이다.