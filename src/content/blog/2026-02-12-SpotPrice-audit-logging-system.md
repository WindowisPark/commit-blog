---
title: "헥사고날 아키텍처로 감사 로그 시스템 구현하기"
description: "SpringBoot와 헥사고날 아키텍처를 활용해 5종 비즈니스 이벤트를 추적하는 감사 로그 시스템을 구현한 과정을 소개합니다."
pubDate: 2026-02-12
repo: SpotPrice
repoDisplayName: SpotPrice
tags: ["SpotPrice", "feature"]
commits: ["673191d287b3f33ebaa30dc7c743b79ce271a02d"]
---
**SpotPrice** 프로젝트의 v1 개발이 마무리되었습니다. 마지막 퍼즐 조각은 바로 감사 로그(Audit Log) 시스템이었는데, 사용자의 모든 중요한 행동을 추적하고 기록하는 것이 목표였습니다.

## 감사 로그가 필요한 이유

실시간 가격 경매 시스템에서는 다양한 이벤트가 발생합니다. 사용자가 상품을 조회하고, 주문을 생성하며, 결제를 시도하는 모든 과정이 비즈니스적으로 중요한 의미를 가집니다. 특히 **금전적 거래**가 포함된 시스템에서는 문제 발생 시 추적 가능한 로그가 필수적입니다.

이번에 구현한 감사 로그는 5가지 핵심 이벤트를 추적합니다:
- **OFFER_VIEW**: 상품 조회 및 가격 확인
- **PAY_ATTEMPT**: 결제 시도
- **PAY_SUCCESS/PAY_FAIL**: 결제 성공/실패
- **OFFER_SOLD**: 상품 판매 완료

## 헥사고날 아키텍처로 설계하기

기존 프로젝트가 헥사고날 아키텍처를 따르고 있었기 때문에, 감사 로그도 동일한 패턴으로 구현했습니다. 핵심은 **AuditLogPort** 아웃바운드 포트를 정의하는 것이었습니다.

```java
public interface AuditLogPort {
    void log(AuditEvent event);
}

public record AuditEvent(
    AuditEventType eventType,
    Long userId,
    String aggregateType,
    Long aggregateId,
    Map<String, Object> detail,
    Instant occurredAt
) {}
```

**AuditEvent**는 단순하지만 필요한 모든 정보를 담고 있습니다. `aggregateType`과 `aggregateId`로 어떤 엔티티에 대한 이벤트인지 식별하고, `detail`에는 이벤트별 상세 정보를 JSON 형태로 저장합니다.

## 트랜잭션 분리의 중요성

감사 로그에서 가장 중요한 기술적 결정은 **REQUIRES_NEW** 트랜잭션 전파 옵션을 사용한 것입니다.

```java
@Component
public class AuditLogAdapter implements AuditLogPort {
    
    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void log(AuditEvent event) {
        try {
            AuditLogEntity entity = new AuditLogEntity(/* ... */);
            repository.save(entity);
        } catch (Exception e) {
            log.warn("감사 로그 저장 실패", e);
        }
    }
}
```

**REQUIRES_NEW**를 사용한 이유는 명확합니다. 메인 비즈니스 트랜잭션이 롤백되어도 감사 로그는 반드시 남아야 하기 때문입니다. 결제가 실패해도 그 시도 자체는 기록되어야 하고, 주문 생성이 실패해도 그 과정에서 발생한 이벤트들은 추적 가능해야 합니다.

## 서비스 레이어에 자연스럽게 통합

각 서비스에서 감사 로그를 기록하는 방식도 고민이 필요했습니다. AOP나 이벤트 기반 방식도 고려했지만, 명시적으로 서비스 코드에 포함시키는 방향을 선택했습니다.

```java
public class PaymentService implements PayOrderUseCase {
    
    @Transactional
    public PaymentStatusResult pay(Long userId, Long orderId) {
        // 결제 시도 로그
        auditLogPort.log(new AuditEvent(
            AuditEventType.PAY_ATTEMPT, userId, "ORDER", orderId,
            Map.of(), now));
            
        // 실제 결제 로직
        PaymentResult result = paymentPort.pay(order.getPaymentKey());
        
        // 결과에 따른 로그
        if (result.success()) {
            auditLogPort.log(new AuditEvent(
                AuditEventType.PAY_SUCCESS, userId, "ORDER", orderId,
                Map.of("lockedPrice", order.getLockedPrice()), now));
        } else {
            auditLogPort.log(new AuditEvent(
                AuditEventType.PAY_FAIL, userId, "ORDER", orderId,
                Map.of("reason", result.failureReason()), now));
        }
    }
}
```

명시적 방식을 선택한 이유는 **가독성**과 **제어**입니다. 어떤 시점에 어떤 정보가 로깅되는지 코드를 읽으면서 바로 알 수 있고, 필요에 따라 로깅 조건을 세밀하게 제어할 수 있습니다.

## 실패에 강한 시스템 만들기

감사 로그 시스템 자체가 메인 비즈니스 로직을 방해하면 안 됩니다. 그래서 **AuditLogAdapter**에서는 모든 예외를 잡아서 경고 로그만 남기고 넘어갑니다.

데이터베이스 연결 문제나 JSON 직렬화 오류가 발생해도 주문이나 결제 과정은 정상적으로 진행되어야 합니다. 대신 문제가 발생했다는 사실은 애플리케이션 로그로 남겨두어 나중에 추적할 수 있게 했습니다.

## v1 완성과 다음 단계

감사 로그 구현으로 **SpotPrice v1**이 완전히 마무리되었습니다. 실시간 가격 조회부터 주문, 결제, 만료 처리, 보안, 그리고 감사 로그까지 핵심적인 비즈니스 기능이 모두 구현되었습니다.

다음 단계로는 **Thymeleaf UI** 개발이 예정되어 있습니다. 지금까지 API로만 존재하던 기능들을 실제 사용자가 브라우저에서 체험할 수 있는 형태로 발전시킬 계획입니다. 헥사고날 아키텍처의 진가는 이럴 때 발휘됩니다. 기존 비즈니스 로직은 전혀 건드리지 않고 새로운 UI 어댑터만 추가하면 되니까요.