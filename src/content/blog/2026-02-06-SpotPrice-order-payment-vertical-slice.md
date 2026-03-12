---
title: "수직적 슬라이스 아키텍처로 주문 시스템 구축하기"
description: "도메인부터 API까지 기능별로 전 레이어를 관통하는 수직적 슬라이스 방식으로 주문 생성, 결제 처리, 접근권한 발급을 구현한 과정을 소개합니다."
pubDate: 2026-02-06
repo: SpotPrice
repoDisplayName: SpotPrice
tags: ["SpotPrice", "feature"]
commits: ["d08108d10ac0b586766d5f1e4f6d0f69107819c0", "ba877a977d4682596b36a5517b7c03ad5735d3d4", "8ec089aad2c5ff910aaba9cfc92a0102915703b1"]
---
## 수직적 슬라이스가 답이었다

SpotPrice 프로젝트에서 주문 시스템을 구축하면서 **수직적 슬라이스(Vertical Slice) 아키텍처**를 적용해봤다. 전통적인 레이어별 개발 방식 대신, 하나의 기능을 도메인부터 API까지 전 레이어를 관통해서 구현하는 방식이다. 결과적으로 기능 간 의존성을 줄이고 더 응집도 높은 코드를 작성할 수 있었다.

세 개의 핵심 기능을 각각 하나의 슬라이스로 구현했다: 주문 생성(CreateOrder), 결제 처리(PayOrder), 접근권한 발급(IssueAccessGrant). 각 기능이 완전히 독립적으로 동작하면서도 이벤트를 통해 자연스럽게 연결되는 구조를 만들어갔다.

## 동시성과 멱등성을 고려한 주문 생성

주문 생성은 여러 사용자가 같은 상품에 동시 접근할 때 발생하는 **경합 상황**을 해결해야 했다. 분산 락과 비관적 락을 조합하여 안전한 주문 처리를 구현했다.

```java
public OrderResult createOrder(CreateOrderCommand command) {
    IdempotencyKey key = new IdempotencyKey(command.idempotencyKey());
    
    // 멱등성 체크 — 같은 키로 이미 주문이 있으면 그대로 반환
    Optional<Order> existing = orderRepository.findByIdempotencyKey(key);
    if (existing.isPresent()) {
        return toResult(existing.get());
    }
    
    // Offer 단위 락 획득 후 주문 처리
    return lockManager.executeWithLock("offer:" + command.offerId(), () -> {
        // 비관적 락으로 Offer 조회 및 상태 검증
        Offer offer = offerRepository.findByIdForUpdate(command.offerId())
                .orElseThrow(() -> new NoSuchElementException("Offer not found"));
        
        // 가격 검증 — 서버 가격 > 클라이언트 기대 가격이면 거부
        Money serverPrice = priceCalculator.calculate(offer, now);
        if (serverPrice.amount().compareTo(command.expectedPrice()) > 0) {
            throw new PriceMismatchException(command.expectedPrice(), serverPrice.amount());
        }
        
        offer.sell(now);
        Order order = new Order(offer.getId(), serverPrice.amount(), key, now);
        return toResult(orderRepository.save(order));
    });
}
```

**멱등성 키**를 통해 네트워크 장애로 인한 중복 요청을 방지하고, **분산 락**으로 동시 접근을 제어했다. 가격 변동이 있을 수 있는 시스템 특성상 클라이언트가 기대하는 가격과 서버 계산 가격을 비교하여 차이가 있으면 409 Conflict로 응답한다.

## 이벤트 기반 아키텍처로 결제 흐름 구현

결제 완료 후 자동으로 접근권한을 발급하는 흐름을 **이벤트 기반**으로 설계했다. PaymentService에서 결제가 완료되면 OrderPaidEvent를 발행하고, 별도의 이벤트 리스너가 이를 처리하여 PIN을 자동 발급한다.

```java
@Override
@Transactional
public PaymentStatusResult pay(Long orderId) {
    Order order = orderRepository.findById(orderId)
            .orElseThrow(() -> new NoSuchElementException("Order not found"));
    
    PaymentResult result = paymentPort.process(orderId, order.getLockedPrice());
    
    if (result.success()) {
        order.markPaid();
        eventPublisher.publish(new OrderPaidEvent(orderId, Instant.now()));
    } else {
        order.markFailed();
    }
    
    orderRepository.save(order);
    return new PaymentStatusResult(orderId, result.success(), 
                                 result.transactionId(), result.failureReason());
}
```

이벤트 기반 접근의 장점은 **느슨한 결합**이다. PaymentService는 AccessGrantService의 존재를 모르지만, 결제 완료 시 자동으로 접근권한이 발급된다. @TransactionalEventListener를 사용해 결제 트랜잭션이 커밋된 후에 이벤트가 처리되도록 보장했다.

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void handle(OrderPaidEvent event) {
    try {
        issueAccessGrantUseCase.issue(event.orderId());
        log.info("AccessGrant 발급 완료: orderId={}", event.orderId());
    } catch (Exception e) {
        log.error("AccessGrant 발급 실패: orderId={}", event.orderId(), e);
    }
}
```

## 도메인 주도 설계로 비즈니스 규칙 캡슐화

각 애그리거트는 자신만의 **불변 조건**과 **상태 전이 규칙**을 명확히 정의했다. Order 애그리거트는 PENDING 상태에서만 PAID/FAILED/CANCELLED로 전이할 수 있고, AccessGrant는 ACTIVE 상태에서만 REVOKED로 변경 가능하다.

```java
public void markPaid() {
    requirePending();
    this.status = OrderStatus.PAID;
}

public void cancel() {
    requirePending();
    this.status = OrderStatus.CANCELLED;
}

private void requirePending() {
    if (status != OrderStatus.PENDING) {
        throw new IllegalStateException(
                "PENDING 상태에서만 변경 가능합니다. 현재 status=" + status);
    }
}
```

비즈니스 규칙을 도메인 객체 내부로 캡슐화하여 **불변식 보장**과 **응집도 향상**을 달성했다. 애플리케이션 레이어는 단순히 도메인 객체의 메서드를 호출하기만 하면 된다.

## 포트와 어댑터로 유연한 인프라 구조

**헥사고날 아키텍처**의 포트와 어댑터 패턴을 적용해 인프라 계층의 변경에 유연하게 대응할 수 있도록 했다. 특히 결제 시스템은 MVP 단계에서는 FakePaymentAdapter로 구현하되, 실제 PG사 연동 시 어댑터만 교체하면 되도록 설계했다.

인프라 레이어의 JPA 엔티티와 도메인 객체를 분리하여 **순수한 도메인 모델**을 유지했다. OrderMapper를 통해 두 모델 간 변환을 처리하고, 도메인의 복원(restore) 팩토리 메서드를 활용해 DB 조회 시 올바른 상태로 객체를 복원한다.

## 수직적 슬라이스의 실전 효과

수직적 슬라이스 방식으로 개발하면서 느낀 가장 큰 장점은 **기능별 독립성**이었다. 주문 생성, 결제, 접근권한 발급이 각각 완전히 독립적인 슬라이스로 구현되어 있어 하나의 기능을 수정해도 다른 기능에 영향을 주지 않는다.

또한 **테스트 용이성**도 크게 개선됐다. 각 슬라이스는 명확한 입출력을 가지고 있어 단위 테스트와 통합 테스트를 작성하기 수월했다. 특히 도메인 로직에 대한 테스트는 외부 의존성 없이 순수하게 작성할 수 있었다.

프로젝트 초기 단계에서 수직적 슬라이스를 적용한 것이 정답이었다. 기능을 하나씩 완전히 구현해가면서 시스템의 전체적인 모습을 빠르게 확인할 수 있었고, 각 기능이 독립적으로 동작하는지 검증하며 개발할 수 있었다.