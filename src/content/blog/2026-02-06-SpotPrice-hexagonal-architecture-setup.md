---
title: "SpotPrice: 시간 기반 역경매 플랫폼의 헥사고날 아키텍처 설계"
description: "유휴 공간의 시간 기반 가격 변동과 선착순 예약을 다루는 SpotPrice 프로젝트를 헥사고날 아키텍처로 설계한 과정을 소개합니다."
pubDate: 2026-02-06
repo: SpotPrice
repoDisplayName: SpotPrice
tags: ["SpotPrice", "chore", "docs"]
commits: ["3512f97c7d827ca6ff53cbd2e51a9406fd45ad1e", "d4f9437999c2acca76dbaa506e0d91cb0ab66e7b", "e3c10907048ec4e5410fad8404978c4be217e6c8"]
---
## 프로젝트 탄생 배경

카페나 파티룸 같은 유휴 공간을 효율적으로 활용할 수 있는 방법이 없을까? **SpotPrice**는 이런 문제의식에서 시작된 프로젝트입니다. 항공료처럼 시간이 지나면서 가격이 자동으로 하락하고, 먼저 결제한 사람이 공간을 차지하는 역경매 시스템을 구현했습니다.

가장 흥미로운 점은 **가격을 데이터베이스에 저장하지 않는다**는 설계 원칙입니다. 모든 가격은 서버가 `f(now)` 함수로 실시간 계산하며, 이를 통해 데이터 정합성과 동시성 문제를 우아하게 해결했습니다.

## 헥사고날 아키텍처로 복잡성 다루기

시간 기반 가격 변동과 동시성 제어라는 복잡한 비즈니스 로직을 다루기 위해 **헥사고날 아키텍처**를 선택했습니다. 4개의 모듈로 분리하여 각각의 책임을 명확히 했습니다.

```java
// domain 모듈 - 순수 비즈니스 로직
public record PriceCalculator(
    BigDecimal basePrice,
    BigDecimal minPrice,
    LocalDateTime startAt,
    LocalDateTime expireAt
) {
    public BigDecimal calculatePrice(LocalDateTime now) {
        // 시간 기반 가격 계산 로직
    }
}
```

**spotprice-domain** 모듈은 Spring 의존성을 전혀 갖지 않는 순수 Java 코드입니다. `Offer`, `Order`, `PriceCalculator` 같은 핵심 도메인 객체들이 여기에 위치하며, 비즈니스 규칙만 담고 있습니다.

**spotprice-application** 모듈에서는 유즈케이스를 정의합니다. `GetOfferQuoteUseCase`, `CreateOrderUseCase`, `PayOrderUseCase` 인터페이스를 통해 외부 세계와의 계약을 명시하고, 포트 패턴으로 의존성 방향을 제어합니다.

## 동시성 제어의 핵심 전략

같은 공간에 여러 사용자가 동시에 결제를 시도할 때 어떻게 처리할까요? 이 프로젝트에서는 **선점(Hold) 없이 결제 순간에만 락을 획득**하는 전략을 택했습니다.

```java
// application 모듈 - 동시성 제어 로직
@Service
public class PaymentService {
    public PaymentStatusResult pay(Long orderId) {
        return lockManager.withLock("order:" + orderId, () -> {
            // 1. 주문 상태 검증
            // 2. Offer 판매 상태 변경 (DB 조건부 업데이트)
            // 3. AccessGrant 발급
        });
    }
}
```

분산락과 데이터베이스 조건부 업데이트를 조합하여 정확히 한 명만 결제에 성공하도록 보장합니다. 사용자 A가 락을 먼저 획득하면 Offer를 `SOLD` 상태로 변경하고, 이후 사용자 B는 이미 판매된 상품에 대해 `409 Conflict`를 받게 됩니다.

## 실시간 가격 계산의 설계 철학

전통적인 커머스 시스템과 달리 SpotPrice는 **가격을 저장하지 않습니다**. 대신 모든 가격은 다음 공식으로 실시간 계산됩니다.

```
price(t) = base_price - (base_price - min_price) * (elapsed / total)
```

이 설계는 몇 가지 중요한 이점을 제공합니다. 첫째, 가격 동기화 문제가 발생하지 않습니다. 여러 서버 인스턴스가 있어도 모든 서버가 동일한 시간 함수를 사용하므로 일관된 가격을 계산합니다. 둘째, 클라이언트가 표시하는 가격과 서버 가격이 다를 수 있다는 점을 명시적으로 인정하고, 서버 가격을 최종 기준으로 삼습니다.

## 멱등성과 안정성 보장

결제 시스템에서 중복 요청은 치명적인 문제입니다. **IdempotencyKey**를 도입하여 동일한 요청이 여러 번 들어와도 한 번만 처리되도록 했습니다.

```java
// domain 모듈 - 멱등성 키 객체
public record IdempotencyKey(String value) {
    public IdempotencyKey {
        // 검증 로직
    }
    
    public static IdempotencyKey generate(Long userId, Long offerId) {
        // 키 생성 로직
    }
}
```

사용자별, 오퍼별로 고유한 키를 생성하고, 데이터베이스 유니크 제약 조건으로 중복을 방지합니다. 이를 통해 네트워크 지연이나 사용자의 중복 클릭으로 인한 문제를 원천 차단했습니다.

## 문서 기반 개발 프로세스

복잡한 비즈니스 로직을 다루는 프로젝트인 만큼 문서화에 특별히 신경 썼습니다. `docs/` 디렉터리에는 6개의 문서가 체계적으로 정리되어 있습니다.

- `POLICY.md`: 비즈니스 정책의 최상위 문서
- `ERD.md`: 데이터 모델과 관계 설계
- `API_CONTRACT.md`: REST API 명세서
- `TEST_SCENARIOS.md`: 테스트 시나리오 정의

특히 **POLICY.md**를 최상위 문서로 두어 개발하면서 생기는 모든 의사결정의 근거로 삼았습니다. "가격은 저장하지 않는다", "선점 없음", "서버 가격이 기준"과 같은 핵심 원칙들이 여기에 명문화되어 있습니다.

## 협업을 위한 새로운 실험

개발 과정에서 흥미로운 실험을 했습니다. `CLAUDE.md` 파일을 통해 AI 도구와의 협업 방식을 명문화했는데, 처음에는 "힌트만 제공하고 직접 구현하게 하자"는 방침이었지만, 개발하면서 "코드를 작성하되 이해한 후 적용하자"로 변경했습니다.

이는 학습 효율성과 개발 속도 사이의 균형점을 찾는 과정이었습니다. 결국 AI 도구의 강점을 활용하되, 개발자가 코드를 이해하고 의사결정에 참여하는 것이 핵심이라는 결론에 도달했습니다.

## 다음 단계

현재 MVP 버전은 기본적인 **LINEAR** 가격 함수와 **InMemoryLockManager**로 동작합니다. v2에서는 **EXPONENTIAL** 가격 함수, Redis 기반 분산락, 외부 PG 연동 등을 추가할 예정입니다.

시간 기반 가격 변동이라는 독특한 도메인을 헥사고날 아키텍처로 깔끔하게 풀어낸 경험이었습니다. 특히 "가격을 저장하지 않는다"는 파격적인 설계가 오히려 시스템을 단순하고 안정적으로 만든다는 점이 인상적이었습니다.