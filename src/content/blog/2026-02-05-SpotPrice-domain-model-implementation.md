---
title: "DDD로 시간 기반 동적 가격 시스템 설계하기"
description: "Offer 애그리거트와 도메인 이벤트 패턴을 활용해 실시간 가격 변동과 상태 전이를 안전하게 구현한 과정을 소개합니다."
pubDate: 2026-02-05
repo: SpotPrice
repoDisplayName: SpotPrice
tags: ["SpotPrice", "feature"]
commits: ["547a8b86f7b522604969cb5b798683ad85ecf5a0", "d72d25fe2bfffd2371fbc8ef4e149c1539a62faf"]
---
## 동적 가격 시스템의 도메인 복잡성

시간에 따라 가격이 변하는 시스템을 만들다 보면 단순해 보이는 요구사항 뒤에 숨은 복잡성을 마주하게 됩니다. 판매 상품의 상태는 언제 바뀌어야 할까요? 두 명이 동시에 같은 상품을 구매하려고 한다면? 가격은 어떻게 계산하고 저장해야 할까요?

**SpotPrice** 프로젝트에서는 이런 문제들을 **Domain-Driven Design**으로 풀어가고 있습니다. 최근 구현한 **Offer 애그리거트**와 **PriceCalculator** 도메인 서비스를 통해 어떻게 복잡성을 관리했는지 살펴보겠습니다.

## Money 값 객체로 시작하는 정확한 금액 처리

가격을 다루는 시스템에서 가장 먼저 해결해야 할 문제는 **정확한 금액 표현**입니다. float나 double을 쓰면 부동소수점 오차 때문에 1000원이 999.9999원이 될 수 있거든요.

```java
public record Money(BigDecimal amount) {
    public Money {
        Objects.requireNonNull(amount, "금액은 필수입니다.");
        
        // 10원 단위 내림 정책 적용
        amount = amount.divide(UNIT, 0, RoundingMode.FLOOR).multiply(UNIT);
        
        if (amount.compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException("금액은 0보다 작을 수 없습니다.");
        }
    }
    
    public Money subtract(Money other) {
        if (other.isGreaterThan(this)) {
            throw new IllegalArgumentException(
                "차감 금액이 보유 금액보다 큽니다: " + this.amount + " - " + other.amount);
        }
        return new Money(this.amount.subtract(other.amount));
    }
}
```

**Money**를 record로 구현해서 불변성을 보장하고, 생성 시점에 비즈니스 규칙(10원 단위 내림, 음수 금지)을 강제했습니다. 연산 메서드도 새로운 인스턴스를 반환해서 부작용을 방지하죠.

## Offer 애그리거트의 상태 전이와 도메인 이벤트

**Offer**는 판매 상품의 핵심 애그리거트입니다. `OPEN → SOLD` 또는 `OPEN → EXPIRED`로 상태가 전이되는데, 이때 중요한 것은 **상태 변화를 안전하게 관리**하는 것입니다.

```java
public void sell(Instant now) {
    if (status != OfferStatus.OPEN) {
        throw new IllegalStateException("판매 불가능한 상태입니다. status=" + status);
    }
    
    if (!now.isBefore(expireAt)) {
        throw new IllegalStateException("만료된 Offer는 판매할 수 없습니다.");
    }
    
    this.status = OfferStatus.SOLD;
    events.register(new OfferSoldEvent(this.id, now));
}
```

상태 전이 메서드에서는 **사전 조건을 엄격하게 검증**하고, 상태 변경 후에는 **도메인 이벤트**를 등록합니다. 이벤트는 애그리거트 내부에 보관되어 있다가 저장 완료 후 발행되는 패턴을 사용했어요.

도메인 이벤트 시스템도 간단하지만 효과적으로 구현했습니다. `DomainEvents` 클래스가 이벤트 목록을 관리하고, `pullEvents()` 메서드로 한 번에 가져가면서 목록을 비우는 **getAndClear 패턴**을 적용했습니다.

## 시간 기반 가격 계산의 도메인 서비스 패턴

가격 계산 로직은 **PriceCalculator** 도메인 서비스로 분리했습니다. 가격은 "저장하는 상태"가 아니라 "매번 계산하는 함수"라는 설계 철학을 반영한 선택이었어요.

```java
public Money calculate(Offer offer, Instant at) {
    return switch (offer.getDecayType()) {
        case NONE -> offer.getBasePrice();
        case LINEAR -> calculateLinear(offer, at);
        case EXPONENTIAL -> throw new UnsupportedOperationException("미구현");
    };
}

private Money calculateLinear(Offer offer, Instant at) {
    BigDecimal progress = calculateProgress(offer, at);
    
    BigDecimal base = offer.getBasePrice().amount();
    BigDecimal min = offer.getMinPrice().amount();
    BigDecimal diff = base.subtract(min);
    
    BigDecimal price = base.subtract(diff.multiply(progress));
    return Money.of(price);
}
```

**LINEAR** 타입에서는 시간 진행률을 계산해서 기본가에서 최저가까지 선형으로 감소시킵니다. `calculateProgress()` 메서드에서 경계 조건들을 처리해서 0.0~1.0 범위로 정규화하는 것이 핵심이었어요.

## 도메인 중심 테스트로 안정성 확보

구현한 도메인 로직들은 모두 **단위 테스트**로 검증했습니다. 특히 경계값 테스트에 신경 썼는데, Money의 10원 단위 내림이나 PriceCalculator의 시간 경계 처리 같은 부분들이 정확히 동작하는지 확인했습니다.

테스트를 작성하면서 도메인 로직의 허점들도 발견할 수 있었어요. 예를 들어 `Money.subtract()`에서 음수 결과가 나올 때의 예외 처리를 더 명확하게 개선하기도 했습니다.

## 애그리거트 경계와 참조 전략

이번 설계에서 특히 중요하게 생각한 부분은 **애그리거트 간 참조 전략**입니다. Offer, Order, AccessGrant 같은 애그리거트들은 서로 객체 참조를 갖지 않고 **ID만으로 참조**하도록 했습니다.

이런 설계 선택의 이유는 향후 **마이크로서비스 분리 가능성**을 염두에 둔 것입니다. 객체 그래프로 엮여있으면 나중에 서비스를 분리하기 어려워지거든요. 지금은 모놀리식이지만 처음부터 경계를 명확히 해두면 나중에 선택의 여지가 생깁니다.

## 다음 단계를 위한 기반 완성

이제 **Offer 애그리거트**와 **도메인 이벤트 시스템**이 완성되어서, 실제 주문과 결제 플로우를 구현할 준비가 되었습니다. 가격 계산도 NONE과 LINEAR 타입이 동작하니까, 기본적인 동적 가격 시스템의 핵심은 갖춰진 셈이에요.

도메인 주도 설계의 진가는 복잡한 비즈니스 로직을 **명확한 책임과 경계**로 나누어 관리할 수 있다는 점입니다. 코드를 보는 사람이 "아, 이 시스템은 이런 규칙으로 동작하는구나"를 바로 이해할 수 있도록 만드는 것이 목표였는데, 어느 정도 달성한 것 같아 뿌듯합니다.