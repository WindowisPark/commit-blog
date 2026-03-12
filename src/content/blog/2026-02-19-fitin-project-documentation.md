---
title: "포트폴리오 백엔드를 체계화하는 4단계 리팩토링 전략"
description: "FitIn 헬스 플랫폼 백엔드 개발기: Phase 1 완료부터 Phase 2 보안 하드닝까지, 실무형 포트폴리오를 위한 단계별 개선 과정"
pubDate: 2026-02-19
repo: fitin
repoDisplayName: FitIn
tags: ["fitin", "docs"]
commits: ["f24c3720eaf60b915b6a5c0bb86bf313b06c8116", "61a9347d08c5db2673c1fd90b7d88ddbe4dada1e", "b105041c5c5e7bdd5f27575a26d207bf5f46d158"]
---
## 포트폴리오 프로젝트, 어떻게 체계적으로 만들까

헬스 플랫폼 백엔드 **FitIn**을 개발하면서 가장 고민했던 부분은 '어떻게 하면 실무에서도 통용될 만한 코드 품질을 유지할 수 있을까'였다. 단순히 기능만 돌아가는 프로토타입이 아니라, 실제 운영 환경을 고려한 아키텍처와 보안 요소들을 포함하고 싶었기 때문이다.

그래서 4단계로 나누어진 **체계적인 리팩토링 로드맵**을 세웠고, 최근 Phase 1을 완료한 후 Phase 2 보안 하드닝까지 마무리했다. 각 단계별로 어떤 고민과 선택이 있었는지 정리해보려 한다.

## Phase 1: 코드베이스 일관성 확보

첫 번째 단계는 기본기를 다지는 작업이었다. 초기 개발 과정에서 생긴 불일치들을 정리하고, 모든 API가 동일한 응답 포맷을 사용하도록 통합하는 것이 목표였다.

가장 먼저 손본 것은 **패키지 명칭**이었다. `exercise` 모듈에서는 `model` 패키지를, `community` 모듈에서는 `entity` 패키지를 사용하고 있어서 일관성이 떨어졌다. 전체를 `entity`로 통일하면서 코드 탐색이 훨씬 수월해졌다.

그 다음은 **공통 응답 포맷** 도입이었다. 19개의 컨트롤러가 각각 다른 방식으로 응답을 반환하고 있던 상황을 `ApiResponse<T>` 래퍼로 통일했다.

```java
// 성공 응답
{ "success": true, "data": { ... }, "message": "OK" }

// 실패 응답
{ "success": false, "data": null, "message": "에러 메시지" }
```

특히 `ApiResponse.fail()`을 제네릭 메서드로 만든 부분이 인상적이었다. 이전에는 타입을 명시적으로 캐스팅해야 했는데, 이제는 타입 추론이 자동으로 동작한다.

```java
// Before: 타입 캐스팅 필요
ApiResponse<Void> response = (ApiResponse<Void>) ApiResponse.fail("오류");

// After: 타입 추론 자동
public static <T> ApiResponse<T> fail(String message) {
    return new ApiResponse<>(false, null, message);
}
```

## Phase 2: 보안을 생각하는 설정 분리

Phase 2에서 가장 중요했던 작업은 **환경별 설정 분리**였다. 개발 초기에는 편의를 위해 DB 비밀번호와 JWT 시크릿을 `application.properties`에 하드코딩했었는데, 이를 환경변수 기반으로 변경했다.

```properties
# application-local.properties (개발용)
spring.datasource.password=${DB_PASSWORD:defaultpassword}
jwt.secret=${JWT_SECRET:dev-secret-key}

# application-prod.properties (운영용) 
spring.datasource.password=${DB_PASSWORD}
jwt.secret=${JWT_SECRET}
```

**JPA DDL 전략**도 환경별로 다르게 설정했다. 로컬에서는 `hibernate.ddl-auto=update`로 편의성을 높이고, 운영에서는 `validate`로 안전성을 확보하는 방식이다. Flyway 도입을 검토했지만, 포트폴리오 규모에서는 오버엔지니어링이라고 판단해 현 단계에서는 스킵했다.

**WebSocket CORS 설정**도 개선했다. 기존의 `allowedOrigins("*")` 방식에서 프로퍼티 기반 화이트리스트로 변경하고, `SmartMirrorHandler`의 직접 객체 생성을 Spring DI 주입으로 교체했다.

## README와 문서화: 포트폴리오의 완성도

Phase 2와 함께 작업한 것이 **포괄적인 README 작성**이었다. 276줄 분량의 README에는 단순한 설치 가이드를 넘어서, 프로젝트가 해결하려는 문제와 기술적 선택의 이유를 담았다.

```markdown
### 해결하려는 문제

헬스를 꾸준히 하는 사람들은 운동 기록 앱, 커뮤니티 앱, 용품 구매 앱을 각각 따로 사용한다. 데이터가 파편화되고 동기부여가 유지되기 어려운 구조다.

**Fitin**은 이 문제를 단일 플랫폼으로 해결한다.
```

특히 API 엔드포인트를 도메인별로 정리한 부분이 유용했다. 각 도메인의 핵심 기능을 한눈에 파악할 수 있도록 **접이식 테이블** 형태로 구성했다.

또한 **알려진 제한사항**을 명시적으로 기록했다. `ExerciseRecordController.getMemberStats()`가 `Object[]`를 반환하는 점, 비밀번호 재설정 이메일 발송이 미구현인 점 등을 솔직하게 드러내면서도, 각각을 어느 단계에서 개선할지 로드맵과 연결했다.

## 남은 과제와 다음 단계

현재 Phase 3(기능 완성도)와 Phase 4(프론트/영상 연동)가 남아있다. Phase 3에서는 **페이지네이션 적용**과 **N+1 쿼리 개선**에 집중할 예정이다. 특히 `Member` → `Cart`, `Order` 관계에서 JOIN FETCH를 적용하지 않아 발생할 수 있는 성능 이슈를 사전에 해결하려고 한다.

Phase 4에서는 **Swagger 도입**과 **영상 저장 경로 설정**을 통해 실제 프론트엔드 연동을 준비할 계획이다.

## 포트폴리오 개발에서 배운 것

이 과정에서 깨달은 것은 **'완벽한 코드'보다 '개선 가능한 코드'가 더 중요하다**는 점이었다. Phase 1에서 모든 구조를 완벽하게 만들려 했다면 아직도 첫 번째 단계에서 멈춰있었을 것이다.

대신 각 단계별로 명확한 목표를 설정하고, 현재 상태를 솔직하게 문서화하면서 점진적으로 개선해 나가는 방식이 훨씬 실용적이었다. 실제 업무 환경에서도 이런 단계적 접근이 더 현실적일 것 같다.

무엇보다 **CLAUDE.md**와 같은 개발 가이드 문서를 작성하면서, 프로젝트의 전체적인 맥락과 의도를 명확하게 정리할 수 있었던 점이 가장 큰 수확이다. 이제 누구든 이 프로젝트를 보고 '왜 이렇게 만들었는지' 이해할 수 있을 것이다.