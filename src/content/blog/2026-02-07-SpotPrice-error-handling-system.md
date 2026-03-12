---
title: "SpotPrice API에 일관된 에러 응답 체계 도입기"
description: "도메인 예외를 구체화하고 API 레벨에서 통일된 응답 구조를 만들어 에러 정책을 체계화한 과정을 소개합니다."
pubDate: 2026-02-07
repo: SpotPrice
repoDisplayName: SpotPrice
tags: ["SpotPrice", "feature"]
commits: ["92042739748fbfc2939f3e8185978d63444f039c"]
---
## 문제 상황: 일관성 없는 에러 응답

SpotPrice 프로젝트를 개발하며 API 에러 처리에 대한 고민이 생겼습니다. 기존에는 Spring의 **ProblemDetail**을 사용해서 각각의 예외를 처리하고 있었는데, 프론트엔드에서 에러를 일관되게 처리하기 어렵다는 피드백을 받았습니다.

기존 코드를 보면 `NoSuchElementException`, `IllegalStateException` 같은 범용 예외를 사용하거나, 각 에러마다 다른 응답 형태를 반환하고 있었습니다. API 문서에서 정의한 에러 정책을 제대로 구현하지 못한 상태였죠.

## 도메인 예외 구체화: 의미 있는 에러 만들기

먼저 도메인 레벨에서 발생할 수 있는 예외들을 구체적으로 정의했습니다. 기존에 `NoSuchElementException`으로 뭉뚱그려 처리하던 것을 각각의 의미에 맞게 분리했습니다.

```java
public class OfferNotFoundException extends DomainException {
    public OfferNotFoundException(Long offerId) {
        super("Offer not found: " + offerId);
    }
}

public class OrderNotFoundException extends DomainException {
    public OrderNotFoundException(Long orderId) {
        super("Order not found: " + orderId);
    }
}

public class InvalidOrderStatusException extends DomainException {
    public InvalidOrderStatusException(String currentStatus) {
        super("Invalid order status: " + currentStatus);
    }
}
```

이제 각 서비스에서 발생하는 에러가 명확해졌습니다. `OrderService`에서 주문을 찾지 못했을 때와 `OfferQuoteService`에서 오퍼를 찾지 못했을 때를 구분할 수 있게 되었죠.

## API 응답 구조 통일: Envelope 패턴 적용

다음으로는 모든 API 응답이 일관된 형태를 갖도록 **ApiResponse** 래퍼를 만들었습니다. 성공과 실패 모두 동일한 구조로 반환하는 envelope 패턴을 적용했습니다.

```java
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(
        boolean success,
        T data,
        ErrorDetail error
) {
    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>(true, data, null);
    }

    public static ApiResponse<Void> error(ErrorCode code) {
        return new ApiResponse<>(false, null, new ErrorDetail(code.name(), code.getMessage()));
    }
}
```

성공 시에는 `{"success": true, "data": {...}}` 형태로, 실패 시에는 `{"success": false, "error": {...}}` 형태로 일관되게 응답합니다. 프론트엔드에서는 `success` 필드만 확인하면 에러 처리 로직을 분기할 수 있게 됐습니다.

## ErrorCode로 중앙화된 에러 관리

에러 코드와 HTTP 상태 코드, 메시지를 한 곳에서 관리하기 위해 **ErrorCode** 열거형을 만들었습니다.

```java
public enum ErrorCode {
    OFFER_NOT_FOUND(HttpStatus.NOT_FOUND, "Offer not found"),
    OFFER_EXPIRED(HttpStatus.GONE, "Offer has expired"),
    PRICE_INCREASED(HttpStatus.CONFLICT, "Price has increased since quote"),
    ORDER_NOT_FOUND(HttpStatus.NOT_FOUND, "Order not found"),
    INVALID_ORDER_STATUS(HttpStatus.BAD_REQUEST, "Invalid order status");
    
    private final HttpStatus httpStatus;
    private final String message;
}
```

이제 새로운 에러가 생기면 여기에 추가하기만 하면 되고, HTTP 상태 코드와 에러 메시지가 일관되게 관리됩니다.

## GlobalExceptionHandler 개선: 타입 안전한 에러 처리

기존의 `GlobalExceptionHandler`는 범용 예외를 잡아서 처리하는 방식이었는데, 이를 구체적인 도메인 예외별로 처리하도록 개선했습니다.

각 예외 핸들러가 적절한 `ErrorCode`로 매핑되어 일관된 응답을 반환합니다. 특히 `PriceMismatchException`의 경우 서버의 현재 가격 정보를 추가로 전달해야 해서 `extra` 필드를 활용했습니다.

## 결과: 체계적인 에러 처리 완성

이번 작업으로 얻은 효과는 다음과 같습니다:

- **일관된 API 응답**: 모든 엔드포인트가 동일한 형태로 응답하므로 프론트엔드에서 예측 가능한 에러 처리가 가능해졌습니다.
- **명확한 에러 의미**: `OfferNotFoundException`과 `OrderNotFoundException`을 구분해서 더 정확한 에러 처리가 가능해졌습니다.
- **중앙화된 관리**: 에러 코드와 메시지, HTTP 상태가 한 곳에서 관리되어 유지보수가 쉬워졌습니다.

API 설계에서 에러 응답의 일관성은 생각보다 중요합니다. 특히 실시간 가격 변동이 있는 SpotPrice 같은 시스템에서는 에러 상황을 명확히 구분해서 처리하는 것이 사용자 경험에 직결되거든요. 이제 가격이 변동됐을 때와 오퍼가 만료됐을 때를 구분해서 적절한 안내를 제공할 수 있게 되었습니다.