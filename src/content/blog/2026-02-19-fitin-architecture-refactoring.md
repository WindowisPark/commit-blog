---
title: "FitIn 프로젝트의 대규모 리팩토링: 순환 참조 해결과 공통 응답 체계 구축"
description: "Spring Boot 기반 헬스케어 플랫폼에서 JPA 순환 참조 문제를 해결하고, 전사 공통 API 응답 포맷을 도입한 대규모 구조 개선 작업"
pubDate: 2026-02-19
repo: fitin
repoDisplayName: FitIn
tags: ["fitin", "refactoring"]
commits: ["0c989def62d7c1dc9cb6bd5172552162ce4171af", "a38a1d0fc3ca0365ddad2f7bb1b8e90038a6e089"]
---
## 기술 부채를 해결하는 두 번의 핵심 리팩토링

헬스케어 플랫폼 FitIn을 개발하면서 마주한 두 가지 큰 기술적 도전이 있었다. JPA 엔티티 간 순환 참조로 인한 메모리 누수와 각 컨트롤러마다 제각각이던 응답 포맷이었다. 이 문제들을 해결하기 위해 진행한 대규모 리팩토링 과정을 정리해보려 한다.

## JPA 순환 참조의 함정에서 벗어나기

가장 먼저 해결해야 했던 문제는 **Member 엔티티**의 양방향 관계 설정이었다. 초기 설계에서는 Member가 Cart, Order, CommunityPost와 모두 양방향 관계를 맺고 있었다:

```java
// 문제가 있던 기존 코드
@OneToMany(mappedBy = "member", cascade = CascadeType.ALL)
@JsonManagedReference
private List<Cart> carts = new ArrayList<>();

@OneToMany(mappedBy = "member")
private List<Order> orders;

@OneToMany(mappedBy = "author")
@JsonManagedReference
private List<CommunityPost> posts;
```

이런 구조는 언뜻 편리해 보이지만, 실제로는 여러 문제를 야기했다. JSON 직렬화 시 무한 루프가 발생할 수 있고, JPA의 지연 로딩이 제대로 작동하지 않아 N+1 문제가 빈번히 발생했다.

해결책은 **단방향 관계로의 전환**이었다. 모든 양방향 컬렉션을 제거하고, 필요한 데이터는 Repository를 통해 조회하도록 변경했다:

```java
// 개선된 Member 엔티티 - 양방향 컬렉션 완전 제거
@Entity
public class Member implements UserDetails {
    // 핵심 필드만 유지
    @OneToOne(mappedBy = "member")
    private Profile profile;
    
    // Cart, Order, CommunityPost 컬렉션 모두 제거
}
```

이 변경으로 **@JsonManagedReference**와 **@JsonBackReference** 어노테이션도 모두 제거할 수 있었다. 서비스 레이어에서는 이미 Repository 기반 조회를 사용하고 있었기 때문에 비즈니스 로직의 변경은 최소화할 수 있었다.

## 통일된 API 응답 체계 구축

두 번째 도전은 **일관성 있는 응답 포맷** 구축이었다. 19개의 컨트롤러가 각각 다른 방식으로 응답을 반환하고 있어, 프론트엔드 개발자들이 API를 사용할 때 혼란을 겪고 있었다.

해결책으로 **ApiResponse<T>** 제네릭 클래스를 도입했다:

```java
@Getter
@AllArgsConstructor
public class ApiResponse<T> {
    private final boolean success;
    private final T data;
    private final String message;
    
    public static <T> ApiResponse<T> success(T data, String message) {
        return new ApiResponse<>(true, data, message);
    }
    
    public static <T> ApiResponse<T> fail(String message) {
        return new ApiResponse<>(false, null, message);
    }
}
```

이제 모든 컨트롤러가 동일한 구조로 응답을 반환한다. 회원가입 성공 시에는 `{"success": true, "data": "user@email.com", "message": "회원가입이 완료되었습니다"}`, 실패 시에는 `{"success": false, "data": null, "message": "이미 등록된 사용자입니다"}`와 같은 일관된 형태로 응답한다.

## 패키지 구조 정리와 예외 처리 체계화

리팩토링 과정에서 패키지 구조도 정리했다. 기존에 혼재되어 있던 `model`과 `entity` 패키지를 **entity**로 통일하고, exercise/video 모듈의 루즈 파일들을 적절한 서브패키지로 재배치했다.

예외 처리도 체계화했다. **BusinessException**과 **ErrorCode enum**을 도입하여 비즈니스 로직 예외를 명확히 분류하고, **GlobalExceptionHandler**에서 ApiResponse 포맷으로 일관되게 처리하도록 개선했다.

## 개발 환경 최적화

Java 툴체인도 22에서 21 LTS로 변경했다. 최신 기능보다는 안정성을 우선시한 결정이었고, 대부분의 서버 환경에서 지원하는 LTS 버전을 선택함으로써 배포 환경의 호환성을 확보했다.

## 리팩토링의 성과와 교훈

이번 리팩토링을 통해 얻은 가장 큰 성과는 **코드의 예측 가능성**이다. JPA 순환 참조 문제가 해결되면서 메모리 사용량이 안정화되었고, 통일된 API 응답 포맷으로 프론트엔드 개발 효율성이 크게 향상되었다.

특히 인상적이었던 점은 **기존 서비스 로직을 거의 변경하지 않고도** 엔티티 구조를 대폭 개선할 수 있었다는 것이다. 이는 초기 설계에서 Repository 패턴을 충실히 적용했기 때문에 가능한 일이었다.

대규모 리팩토링은 항상 위험이 따르지만, 점진적인 접근과 철저한 테스트를 통해 안전하게 진행할 수 있었다. 무엇보다 **기술 부채를 미리 정리**하여 향후 기능 개발 시 발생할 수 있는 복잡도를 크게 줄일 수 있게 되었다.