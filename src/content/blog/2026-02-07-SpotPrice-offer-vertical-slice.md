---
title: "헥사고날 아키텍처로 Offer API 만들기: 전체 레이어를 관통하는 Vertical Slice 구현"
description: "SpotPrice 프로젝트에서 도메인부터 API까지 전 레이어를 관통하는 Quote 조회와 목록 조회 기능을 헥사고날 아키텍처로 구현한 과정을 정리했습니다."
pubDate: 2026-02-07
repo: SpotPrice
repoDisplayName: SpotPrice
tags: ["SpotPrice", "feature"]
commits: ["b2c6ea23695b00646a51bbd5fc998cbebca5f2ea", "7bb900f6beb7c2cdce289737d236234459ec4aaa"]
---
## Vertical Slice로 전체 레이어 관통하기

**헥사고날 아키텍처**를 실제로 적용할 때 가장 효과적인 방법은 하나의 유스케이스를 도메인부터 API까지 모든 레이어를 관통해서 구현하는 것입니다. SpotPrice 프로젝트에서 Offer 견적 조회 기능을 이런 방식으로 구현해보았습니다.

모든 계층이 동시에 필요한 이유는 의존성 때문입니다. API는 Application을, Application은 Domain과 Infrastructure를 필요로 하죠. 하나씩 구현하면 컴파일도 안 되고, 테스트도 할 수 없습니다.

## 도메인 중심의 복원 로직 설계

가장 먼저 도메인 객체가 데이터베이스로부터 복원되는 방식을 고민했습니다. 일반적인 생성자는 비즈니스 규칙 검증을 포함하지만, DB에서 불러올 때는 이미 검증된 데이터이므로 다른 접근이 필요했습니다.

```java
/**
 * DB 복원용 팩토리 — 이미 검증된 데이터이므로 불변식 검증을 건너뜀
 */
public static Offer restore(Long id, OfferStatus status, DecayType decayType,
                            Money basePrice, Money minPrice,
                            Instant startAt, Instant endAt, Instant expireAt) {
    Offer offer = new Offer();
    offer.id = id;
    offer.status = status;
    // ... 필드 설정
    return offer;
}
```

새로운 Offer를 생성할 때는 모든 비즈니스 규칙을 검증하지만, `restore()` 메서드는 DB 복원 전용으로 검증을 건너뜁니다. 이렇게 생성과 복원의 책임을 명확히 분리했습니다.

## Application 레이어의 유스케이스 구현

**OfferQuoteService**는 견적 조회의 핵심 비즈니스 로직을 담당합니다. 단순해 보이지만 여러 도메인 규칙이 함께 동작합니다.

```java
@Override
@Transactional(readOnly = true)
public OfferQuoteResult getQuote(Long offerId) {
    Offer offer = offerRepository.findById(offerId)
            .orElseThrow(() -> new NoSuchElementException("Offer not found: " + offerId));

    if (offer.getStatus() != OfferStatus.OPEN) {
        throw new OfferNotOpenException(offerId);
    }

    Instant now = clock.now();
    if (!now.isBefore(offer.getExpireAt())) {
        throw new OfferExpiredException(offerId);
    }

    Money currentPrice = priceCalculator.calculate(offer, now);
    return new OfferQuoteResult(offerId, currentPrice.amount(), now, offer.getExpireAt());
}
```

Offer 조회, 상태 검증, 만료 시간 검증, 가격 계산까지의 전체 플로우를 하나의 트랜잭션으로 처리합니다. 각 단계에서 발생할 수 있는 예외들을 명확한 도메인 예외로 변환하는 것도 중요한 포인트입니다.

## Infrastructure 레이어의 JPA 매핑

JPA Entity와 Domain 객체 사이의 매핑은 **OfferMapper**를 통해 처리했습니다. 중요한 것은 Entity는 단순한 데이터 컨테이너 역할만 하고, 모든 비즈니스 로직은 Domain 객체에 위임한다는 점입니다.

```java
public static Offer toDomain(OfferEntity entity) {
    return Offer.restore(
            entity.getId(),
            OfferStatus.valueOf(entity.getStatus()),
            DecayType.valueOf(entity.getDecayType()),
            Money.of(entity.getBasePrice()),
            Money.of(entity.getMinPrice()),
            entity.getStartAt(),
            entity.getEndAt(),
            entity.getExpireAt()
    );
}
```

여기서 앞서 만든 `restore()` 팩토리 메서드가 활용됩니다. Entity에서 Domain으로 변환할 때는 검증을 건너뛰고, 새로운 Offer 생성 시에만 검증을 수행하는 구조입니다.

## 목록 조회에서의 성능 최적화

두 번째 커밋에서는 Offer 목록 조회 기능을 추가했습니다. 여기서 중요한 결정 사항은 **DB 레벨에서 필터링**을 수행하는 것이었습니다.

```java
@Query("SELECT o FROM OfferEntity o WHERE o.status = 'OPEN' AND o.expireAt > :now ORDER BY o.expireAt ASC")
Page<OfferEntity> findAllOpen(@Param("now") Instant now, Pageable pageable);
```

OPEN 상태이면서 만료되지 않은 Offer만 DB에서 조회하여, 불필요한 데이터 전송과 메모리 사용을 방지했습니다. 만료 시간순 정렬도 DB에서 처리하여 성능을 최적화했습니다.

페이지네이션은 **PageQuery**와 **PageResult**라는 Application 레이어의 순수한 객체로 처리했습니다. Spring의 Pageable에 의존하지 않아 테스트하기 쉽고, 다른 프레임워크로 교체할 때도 영향을 받지 않습니다.

## 전체 레이어의 조화

이번 구현에서 가장 만족스러운 부분은 각 레이어가 자신의 책임에만 집중하면서도 전체적으로 조화롭게 동작한다는 점입니다. Domain은 비즈니스 규칙에, Application은 유스케이스 흐름에, Infrastructure는 데이터 처리에, API는 HTTP 인터페이스에만 집중합니다.

**GlobalExceptionHandler**를 통해 도메인 예외를 적절한 HTTP 상태 코드로 변환하고, **SecurityConfig**로 기본적인 보안 설정을 처리하여 실제 운영 가능한 수준의 API를 완성했습니다.

헥사고날 아키텍처는 복잡해 보일 수 있지만, 이렇게 Vertical Slice로 한 번에 구현해보면 각 레이어 간의 의존성과 책임 분리가 명확해집니다. 다음에는 Order나 Payment 같은 다른 도메인도 같은 방식으로 확장해나갈 예정입니다.