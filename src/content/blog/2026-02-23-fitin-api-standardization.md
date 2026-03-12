---
title: "Spring Boot API의 검증 시스템 완성하기 — 통합 예외 처리와 페이지네이션 구축기"
description: "FitIn 프로젝트에서 Bean Validation과 페이지네이션을 도입하여 견고한 API 응답 체계를 구축한 과정을 다룹니다."
pubDate: 2026-02-23
repo: fitin
repoDisplayName: FitIn
tags: ["fitin", "feature"]
commits: ["996d637bbeb7fcc3e7c6a609f4a0c145587646ae", "c815ab66169683acd59e303aa8b23550b9904ebb"]
---
## 개발자라면 누구나 겪는 검증의 딜레마

개발을 하다 보면 항상 마주치는 문제가 있습니다. 사용자 입력 검증을 어디서, 어떻게 처리할 것인가? 컨트롤러마다 `BindingResult`를 체크하고, 각각 다른 방식으로 에러를 반환하다 보니 코드가 중복되고 일관성이 떨어지는 문제를 겪었습니다.

FitIn 프로젝트에서도 마찬가지였습니다. 로그인, 회원가입, 상품 등록 등 각 컨트롤러마다 제각각 검증 로직을 처리하고 있었죠. 특히 `MemberController`의 회원가입 메서드는 이런 모습이었습니다.

```java
@PostMapping("/signup")
public ResponseEntity<ApiResponse<String>> signup(
        @Valid @RequestBody MemberCreateForm memberCreateForm,
        BindingResult bindingResult) {
    
    if (bindingResult.hasErrors()) {
        return ResponseEntity.badRequest().body(ApiResponse.fail("입력값이 올바르지 않습니다"));
    }
    // ... 실제 비즈니스 로직
}
```

매번 `BindingResult`를 확인하는 코드가 반복되고, 에러 메시지도 획일적이었습니다. 이런 상황에서 **Bean Validation**과 **GlobalExceptionHandler**를 활용한 통합 검증 시스템을 구축하기로 결정했습니다.

## 통합 검증 시스템 구축하기

가장 먼저 해결해야 할 것은 검증 실패 시 일관된 응답 형식이었습니다. 단순히 "입력값이 올바르지 않습니다"라는 메시지보다는 어떤 필드에서 무엇이 잘못되었는지 구체적으로 알려주는 것이 중요했죠.

```java
public record ValidationError(String field, String message) {
}
```

심플한 레코드 클래스로 필드명과 에러 메시지를 담을 구조를 만들었습니다. 그 다음은 `GlobalExceptionHandler`에 **MethodArgumentNotValidException** 핸들러를 추가하는 것이었습니다.

```java
@ExceptionHandler(MethodArgumentNotValidException.class)
public ResponseEntity<ApiResponse<List<ValidationError>>> handleValidationException(MethodArgumentNotValidException ex) {
    List<ValidationError> errors = ex.getBindingResult().getFieldErrors().stream()
            .map(e -> new ValidationError(e.getField(), e.getDefaultMessage()))
            .toList();
    
    return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .body(new ApiResponse<>(false, errors, "입력값이 올바르지 않습니다"));
}
```

이제 컨트롤러에서는 `@Valid` 어노테이션만 붙이면 자동으로 검증이 처리됩니다. DTO에는 적절한 검증 어노테이션을 추가했죠.

```java
public class AdminSignupRequest {
    @NotBlank(message = "이름은 필수입니다.")
    private String membername;
    
    @NotBlank(message = "이메일은 필수입니다.")
    @Email(message = "이메일 형식이 올바르지 않습니다.")
    private String email;
    
    @NotBlank(message = "비밀번호는 필수입니다.")
    private String password;
}
```

## 페이지네이션으로 성능 최적화하기

검증 시스템을 정리하고 나니, 또 다른 문제가 보였습니다. 모든 목록 API가 전체 데이터를 한 번에 반환하고 있었던 것이죠. 상품이 수천 개, 리뷰가 수만 개가 되면 성능상 큰 문제가 될 수 있었습니다.

**PageResponse**라는 공통 응답 객체를 만들어 Spring Data의 `Page` 객체를 감싸도록 했습니다.

```java
public record PageResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages,
        boolean hasNext
) {
    public static <T> PageResponse<T> of(Page<T> page) {
        return new PageResponse<>(
                page.getContent(),
                page.getNumber(),
                page.getSize(),
                page.getTotalElements(),
                page.getTotalPages(),
                page.hasNext()
        );
    }
}
```

컨트롤러에서는 `@PageableDefault`로 기본값을 설정하여 클라이언트가 페이징 정보를 전달하지 않아도 합리적인 기본값이 적용되도록 했습니다.

## 도메인별 최적화된 정렬 기준

단순히 페이지네이션을 적용하는 것을 넘어, 각 도메인에 맞는 정렬 기준을 설정하는 것이 중요했습니다. 상품은 최신 등록순, 리뷰는 작성일 역순, 주문은 주문일 역순 등 사용자 경험을 고려한 기본 정렬을 적용했습니다.

예를 들어 상품 목록 API는 이런 형태가 되었습니다.

```java
@GetMapping
public ResponseEntity<ApiResponse<PageResponse<ProductDto>>> getAllProducts(
        @PageableDefault(size = 20, sort = "id", direction = Sort.Direction.DESC) Pageable pageable) {
    return ResponseEntity.ok(ApiResponse.success(productService.getAllProducts(pageable)));
}
```

클라이언트에서는 `?page=0&size=20&sort=createdAt,desc` 같은 쿼리 파라미터로 원하는 페이징과 정렬을 요청할 수 있게 되었습니다.

## 일관된 API 응답 체계의 완성

이번 작업을 통해 FitIn 프로젝트의 모든 API가 일관된 형태의 응답을 제공하게 되었습니다. 검증 실패 시에는 구체적인 필드별 에러를 받을 수 있고, 목록 조회 시에는 페이지네이션 정보와 함께 적절한 양의 데이터만 받을 수 있게 되었죠.

특히 프론트엔드 개발자 입장에서는 예측 가능한 API 응답 구조 덕분에 훨씬 안정적인 클라이언트 코드를 작성할 수 있게 되었습니다. 검증 실패든 성공이든, 목록 조회든 단일 조회든 모든 응답이 `ApiResponse` 형태로 통일되었으니까요.

이런 기반 작업이 있었기에 이후 새로운 기능을 추가할 때도 일관된 품질을 유지할 수 있었습니다. 때로는 겉으로 보이지 않는 이런 인프라 작업이 프로젝트의 장기적인 성공을 좌우한다고 생각합니다.