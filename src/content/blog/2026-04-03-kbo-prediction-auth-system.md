---
title: "야구 분석 플랫폼에 결제 시스템과 이메일 인증 구축하기"
description: "KBO 예측 서비스에 Stripe 구독 결제와 이메일 인증 플로우를 통합하며 마주한 기술적 도전들과 해결 과정"
pubDate: 2026-04-03
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "python", "react", "bugfix"]
commits: ["9534d4215db6926527bf313c184c2d2135fe48c1", "956a81fe4b79c47f1ba72d3e23df54e7c8c6355e", "58764fb63252f0443bc911944ca143c83ffecb44", "70c3c954e9885607226998f58732eb20ded2e5c1", "1c2dc3a4812a74c6c86447f7612e159488e12ed3", "e7ea5716a4024eaee87e4bac294dc60c5ae65912", "d11aa80712513a58c24e3bd01de86968b4c100bc"]
---
## 단순한 분석 툴에서 완성된 서비스로

**KBO Prediction** 프로젝트가 한 단계 성장했습니다. 단순히 야구 경기 결과를 예측하는 것에서 벗어나, 실제 사용자들이 안심하고 이용할 수 있는 완성된 웹 서비스로 진화했죠. 이번 작업의 핵심은 **이메일 인증**과 **Stripe 구독 결제** 시스템을 도입하는 것이었습니다.

기존에는 회원가입만 하면 바로 분석 서비스를 이용할 수 있었지만, 이제는 이메일 인증을 거쳐야 합니다. 또한 Basic/Pro 티어 사용자들은 Stripe를 통해 월 구독료를 결제할 수 있게 되었죠.

## 이메일 인증 시스템 구현

먼저 **Resend API**를 활용한 이메일 인증 플로우를 구축했습니다. 사용자가 회원가입하면 6자리 인증 코드가 이메일로 발송되고, 10분 내에 코드를 입력해야 서비스를 이용할 수 있습니다.

```python
def _create_and_send_code(db: Session, email: str) -> bool:
    # 기존 미사용 코드 삭제
    db.query(VerificationCode).filter(VerificationCode.email == email).delete()
    db.flush()

    code = generate_code()
    vc = VerificationCode(email=email, code=code, expires_at=get_expiry())
    db.add(vc)
    db.commit()

    return send_verification_email(email, code)
```

흥미로운 점은 미인증 사용자의 분석 요청을 Rate Limiter 미들웨어에서 차단한다는 것입니다. JWT 토큰에 `is_verified` 클레임을 추가하여, 토큰 검증과 동시에 인증 상태를 확인할 수 있도록 설계했습니다.

```python
def _get_identity_tier_verified(request: Request) -> tuple[str, str, bool]:
    identity = request.client.host if request.client else "unknown"
    tier = "free"
    is_verified = False

    # JWT에서 인증 상태 추출
    if auth_header.startswith("Bearer "):
        try:
            payload = verify_token(token, expected_type="access")
            identity = f"user:{payload['sub']}"
            tier = payload.get("tier", "free")
            is_verified = payload.get("is_verified", False)
        except JWTError:
            pass

    return identity, tier, is_verified
```

## Stripe 결제 시스템 통합

**Stripe Checkout**을 통한 구독 결제 시스템 구현이 이번 작업의 하이라이트였습니다. 사용자가 업그레이드 버튼을 클릭하면 Stripe Checkout 페이지로 리다이렉트되고, 결제 완료 후 웹훅을 통해 티어가 자동 업데이트됩니다.

특히 까다로웠던 부분은 **Stripe 웹훅 처리**였습니다. Stripe SDK v8+에서 반환하는 객체가 일반 딕셔너리가 아닌 `StripeObject` 인스턴스라서, `.get()` 메서드 호출 시 `AttributeError`가 발생했습니다.

```python
def _handle_checkout_completed(session, db: Session):
    # StripeObject 호환성을 위해 getattr 사용
    metadata = getattr(session, "metadata", {}) or {}
    user_id = metadata.get("user_id") if isinstance(metadata, dict) else getattr(metadata, "user_id", None)
    tier = metadata.get("tier") if isinstance(metadata, dict) else getattr(metadata, "tier", None)
    subscription_id = getattr(session, "subscription", None)
```

이런 세부적인 이슈들을 해결하면서, 프로덕션 환경에서 안정적으로 작동하는 결제 시스템을 완성할 수 있었습니다.

## 보안과 사용자 경험의 균형

이메일 인증 도입으로 보안은 강화되었지만, 사용자 경험을 해치지 않으려고 노력했습니다. 대시보드에는 미인증 사용자를 위한 황색 배너를 표시하고, 인증 코드 재발송 기능도 제공합니다.

또한 **bcrypt 의존성 충돌** 문제도 해결했습니다. `passlib`이 `bcrypt>=4.1`을 지원하지 않아 프로덕션에서 500 오류가 발생했는데, `bcrypt`를 직접 사용하는 방식으로 변경하여 문제를 해결했습니다.

## 배치 예측과 실시간 분석의 조화

기존의 배치 예측 시스템과 새로운 인증/결제 시스템이 자연스럽게 통합되도록 했습니다. 미인증 사용자는 배치로 미리 계산된 기본 분석만 볼 수 있고, Pro 사용자는 `reanalyze=true` 옵션으로 실시간 재분석을 요청할 수 있습니다.

이로써 **KBO Prediction**은 단순한 기술 데모에서 실제 수익을 창출할 수 있는 완성된 웹 서비스로 거듭났습니다. 사용자 인증부터 결제 처리까지, 현대적인 SaaS 플랫폼이 갖춰야 할 핵심 기능들을 모두 구현한 셈이죠.