---
title: "KBO Prediction에 이메일 인증과 Stripe 결제 시스템 구현하기"
description: "야구 예측 서비스에 사용자 인증 강화와 유료 구독 모델을 도입하며 겪은 기술적 도전과 해결 과정"
pubDate: 2026-04-03
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "python", "react", "bugfix"]
commits: ["9534d4215db6926527bf313c184c2d2135fe48c1", "70c3c954e9885607226998f58732eb20ded2e5c1", "e7ea5716a4024eaee87e4bac294dc60c5ae65912"]
---
## 사용자 경험과 수익화, 두 마리 토끼를 잡다

야구 예측 AI 서비스를 운영하다 보니 두 가지 문제가 명확해졌다. 첫째, 무분별한 API 호출로 인한 서버 부하였고, 둘째는 지속가능한 서비스 운영을 위한 수익 모델의 필요성이었다. 이를 해결하기 위해 **이메일 인증 시스템**과 **Stripe 기반 구독 결제**를 도입했다.

## 이메일 인증으로 스팸 방지하기

기존에는 회원가입만 하면 바로 예측 서비스를 이용할 수 있었다. 하지만 이는 봇이나 악의적 사용자의 남용으로 이어질 수 있었다. 이메일 인증을 통해 실제 사용자만 서비스를 이용하도록 제한했다.

```python
# 미인증 사용자 분석 차단
if identity.startswith("user:") and not is_verified:
    return JSONResponse(
        status_code=403,
        content={"detail": "이메일 인증이 필요합니다", "code": "email_not_verified"},
    )
```

**Resend API**를 활용해 6자리 인증 코드를 생성하고 10분 만료 시간을 설정했다. JWT 토큰에 `is_verified` 클레임을 추가해 인증 상태를 실시간으로 확인할 수 있도록 구현했다. 프론트엔드에서는 미인증 사용자에게 amber 색상의 배너를 표시해 직관적으로 알 수 있게 했다.

## Stripe 결제 시스템 통합의 도전

유료 구독 모델 도입을 위해 **Stripe Checkout**을 선택했다. 단순히 결제를 받는 것을 넘어서 구독 상태 변화에 따른 사용자 티어 관리가 핵심이었다.

```python
def _handle_checkout_completed(session, db: Session):
    """결제 완료 → 티어 업그레이드."""
    metadata = session.metadata
    user_id = metadata.get("user_id") if hasattr(metadata, "get") else metadata["user_id"]
    tier = metadata.get("tier") if hasattr(metadata, "get") else metadata["tier"]
    
    user = db.query(User).filter(User.id == int(user_id)).first()
    user.tier = tier
    user.stripe_subscription_id = subscription_id
    db.commit()
```

초기 구현에서 가장 까다로웠던 부분은 **Stripe Webhook 처리**였다. Stripe SDK v8+에서는 응답 객체가 일반 딕셔너리가 아닌 StripeObject 인스턴스로 변경되어 `.get()` 메서드 호출 시 AttributeError가 발생했다. 이를 해결하기 위해 `getattr()`을 활용한 안전한 속성 접근 방식으로 전환했다.

## 실시간 구독 상태 동기화

Stripe Webhook을 통해 구독 상태가 변경될 때마다 사용자 티어를 자동으로 업데이트하도록 구현했다. `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` 이벤트를 처리해 결제 완료, 플랜 변경, 구독 취소 상황을 모두 대응했다.

```python
def _handle_subscription_updated(subscription, db: Session):
    status = getattr(subscription, "status", None)
    if status in ("active", "trialing"):
        # price_id로 티어 판별
        items_obj = getattr(subscription, "items", None)
        items = getattr(items_obj, "data", []) if items_obj else []
        if items:
            price = getattr(items[0], "price", None)
            price_id = getattr(price, "id", None) if price else None
            if price_id == BASIC_PRICE_ID:
                user.tier = "basic"
```

## 사용자 경험 개선

프론트엔드에서는 `/verify` 페이지를 새로 만들어 직관적인 인증 플로우를 구현했다. 마이페이지에서 바로 Stripe Checkout으로 이동할 수 있는 업그레이드 버튼을 추가해 결제 전환율을 높였다. 인증되지 않은 사용자에게는 대시보드 상단에 알림 배너를 표시해 자연스럽게 인증을 유도했다.

## 개발 환경에서의 유연성

개발 단계에서는 실제 이메일 발송이나 결제 처리가 번거로울 수 있다. 환경변수가 설정되지 않았을 때는 콘솔에 인증 코드를 출력하거나 결제 시스템을 비활성화하는 등 개발자 친화적인 폴백 메커니즘을 구현했다.

이번 구현을 통해 서비스의 품질과 지속가능성을 동시에 확보할 수 있었다. 특히 Stripe의 복잡한 객체 구조를 다루면서 외부 API 통합 시 타입 안정성의 중요성을 다시 한번 깨달았다. 앞으로는 사용자 행동 분석을 통해 더 정교한 티어링 전략을 수립해볼 계획이다.