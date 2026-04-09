---
title: "JobMate에 JWT 인증 시스템 구축하기: 보안과 UX를 모두 잡는 방법"
description: "JobMate 프로젝트에 httpOnly 쿠키 기반 JWT 인증을 구현하면서 겪은 보안 도전과 해결 과정을 소개합니다."
pubDate: 2026-03-25
repo: jobmate
repoDisplayName: JobMate
tags: ["jobmate", "feature", "python", "react", "bugfix"]
commits: ["b49725aa10729491d7b3482c9f3befeac17ce21b", "237dcc8b8c096abaa209f6cdce4cd3454181f6f9", "78c182409de28b9a120203219dea889e27ff07d1", "a0bcd475f7faa41e1717be5d5b267615519be1c9", "d5a804bdb0b02ac7566bbce44b5b431443d87bae", "63a8ac6aa01463e9bb2e7aa76e11c9b4d7c088af", "13679c381b15d4d412740fddb0503c17bd06981d"]
---
취업 준비생을 위한 AI 에이전트 채팅 서비스 **JobMate**에 사용자 인증 시스템을 구축했습니다. 단순히 토큰을 발급하는 것을 넘어서, 실제 서비스 수준의 보안과 사용자 경험을 모두 고려한 인증 시스템을 만들어야 했습니다.

## httpOnly 쿠키로 XSS 공격 차단하기

가장 먼저 고민한 것은 토큰을 어디에 저장할지였습니다. localStorage는 XSS 공격에 취약하고, Authorization 헤더는 매번 수동으로 관리해야 하는 번거로움이 있었습니다. 결국 **httpOnly 쿠키**를 선택했습니다.

```python
def _set_auth_cookies(response: Response, access: str, refresh: str) -> None:
    response.set_cookie(
        key="access_token",
        value=access,
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
        httponly=True,
        samesite="lax",
    )
    response.set_cookie(
        key="refresh_token", 
        value=refresh,
        max_age=settings.refresh_token_expire_days * 86400,
        path="/api/auth",  # refresh 전용 경로로 제한
        httponly=True,
        samesite="lax",
    )
```

httpOnly 플래그로 JavaScript에서 쿠키에 접근할 수 없게 하고, refresh token은 `/api/auth` 경로에서만 사용할 수 있도록 제한했습니다. 이렇게 하면 XSS 공격이 성공해도 토큰을 탈취할 수 없습니다.

## Redis 기반 Refresh Token Rotation

더 까다로운 문제는 **Refresh Token 보안**이었습니다. 일반적인 JWT는 stateless하지만, refresh token이 탈취되면 장기간 악용될 수 있습니다. 이를 해결하기 위해 **Token Rotation** 방식을 도입했습니다.

```python
async def refresh_token(request: Request, response: Response, redis: Redis) -> UserOut:
    token = request.cookies.get("refresh_token")
    payload = decode_token(token)
    user_id = UUID(payload["sub"])
    
    # Redis에 저장된 토큰과 일치하는지 확인
    if not await verify_refresh_token(redis, user_id, token):
        await revoke_refresh_token(redis, user_id)
        _clear_auth_cookies(response)
        raise HTTPException(401, detail="Refresh token이 재사용되었습니다.")
    
    # 새 토큰 쌍 발급 후 기존 토큰 무효화
    new_access = create_access_token(user.id)
    new_refresh = create_refresh_token(user.id) 
    await save_refresh_token(redis, user.id, new_refresh)
```

매번 refresh할 때마다 새로운 토큰 쌍을 발급하고, 기존 토큰은 Redis에서 삭제합니다. 만약 이미 사용된 토큰으로 재요청이 들어오면, 토큰 탈취로 간주하고 해당 사용자의 모든 refresh token을 무효화시킵니다.

## 게스트 모드와 점진적 인증

사용자 경험을 위해 **게스트 모드**도 구현했습니다. 회원가입 없이도 서비스를 체험할 수 있게 하되, 로그인 시에는 자연스럽게 개인 데이터로 전환되도록 했습니다.

```python
async def get_optional_user_id(request: Request) -> UUID | None:
    """쿠키에서 access_token을 읽되, 없으면 None (게스트 모드)."""
    token = request.cookies.get("access_token")
    if not token:
        return None
    
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        return UUID(payload["sub"]) if payload.get("sub") else None
    except (JWTError, ValueError):
        return None
```

WebSocket 연결에서도 쿠키를 읽어 인증된 사용자는 개인 대화방을, 게스트는 임시 세션을 사용하도록 분기 처리했습니다. 이렇게 하면 사용자가 처음 방문했을 때 부담 없이 서비스를 체험하고, 나중에 회원가입하면 자연스럽게 개인 계정으로 전환됩니다.

## 프론트엔드 자동 갱신과 인터셉터

백엔드에서 아무리 견고한 인증을 구축해도, 프론트엔드에서 토큰 만료를 우아하게 처리하지 못하면 사용자 경험이 나빠집니다. **axios 인터셉터**를 활용해서 401 에러가 발생하면 자동으로 토큰을 갱신하도록 했습니다.

```typescript
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      try {
        await api.post("/auth/refresh");
        return api.request(error.config); // 원래 요청 재시도
      } catch {
        useAuthStore.getState().clearAuth();
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);
```

사용자가 서비스를 이용하다가 토큰이 만료되어도, 백그라운드에서 자동으로 갱신되어 끊김 없는 경험을 제공합니다.

## 마무리: 보안과 편의성의 균형

인증 시스템을 구축하면서 가장 어려웠던 점은 보안과 사용자 편의성 사이의 균형이었습니다. httpOnly 쿠키와 Token Rotation으로 보안성을 높이면서도, 게스트 모드와 자동 갱신으로 사용자 경험을 해치지 않으려고 노력했습니다.

특히 이메일 중복 확인 API나 비밀번호 길이 제한 같은 세부적인 UX 개선도 함께 진행했습니다. 개발자 도구에서 "이미 등록된 이메일입니다"라는 에러 메시지를 보는 것보다, 실시간으로 중복 여부를 확인할 수 있는 것이 훨씬 좋은 경험이니까요.

결과적으로 JobMate는 보안성과 사용성을 모두 갖춘 인증 시스템을 갖게 되었습니다. 다음 단계로는 OAuth 소셜 로그인과 Docker 배포를 준비하고 있습니다.