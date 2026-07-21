---
title: "결제 심사 직전, 보안을 전면 재검토한 일주일"
description: "사주 MBTI 리포트 서비스의 PortOne 결제 심사를 앞두고 비회원 결제, Rate Limit, 보안 헤더, 모바일 엣지 케이스까지 전방위로 강화한 과정을 정리합니다."
pubDate: 2026-07-18
repo: saju-mbti-report
repoDisplayName: 사주 MBTI 리포트
tags: ["saju-mbti-report", "react", "bugfix"]
commits: ["d9ea55427b47113c214d1749edf1b53a5964a7b4", "25900eaf9e3d73b1f8b2f34f23b15f9d78fbebd7", "90fa8186983ca893fed7ae3bb325de0848226441", "e8abbd5be6630dce5b1caa2c214d43025f71745c", "a44742b8a7054ca4a13ae11a2030df24434dd277", "82849592360b28d5aeffd712f45a6f9978cb882a", "897db692c3e35ba0b6f6fa87a6a03734d5ee452a", "58ea87c19e435506301e44250d84db21f6a2915c"]
---
## 왜 지금 보안을 다시 봤나

결제 심사는 단순히 기능이 동작하는지 확인하는 자리가 아니다. PG사 심사팀은 결제 API가 인증 없이 호출 가능한지, 에러 메시지에 내부 정보가 노출되는지, 비정상 트래픽을 어떻게 처리하는지를 본다. 사주 MBTI 리포트는 무료 체험 후 유료 업그레이드를 유도하는 구조라 비회원도 결제할 수 있어야 했는데, 이 흐름이 기존 인증 체계와 맞물리면서 구멍이 여럿 생겨 있었다.

심사 제출 전 일주일, 기능 개발을 멈추고 보안 경계를 처음부터 다시 그렸다.

## Rate Limit과 요청 검증을 새로 쌓다

기존에는 요청 검증이 사실상 없었다. POST 바디를 그냥 `request.json()`으로 읽고, 인증 여부만 확인했다. 이번에 `lib/security/` 디렉터리를 새로 만들고 두 가지 계층을 추가했다.

첫 번째는 **요청 유효성 검사**다. 모든 API 라우트에 Same-Origin 헤더 체크, Content-Type 검증, Content-Length 상한을 추가했다. 바디는 스트림을 직접 읽어 최대 크기를 초과하면 즉시 413을 반환한다.

```typescript
// lib/security/request.ts
export function isSameOriginBrowserRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  return new URL(origin).host === host;
}
```

두 번째는 **Upstash Redis 기반 Rate Limit**이다. 엔드포인트별로 다른 정책을 적용했다. 무료 리포트 생성은 동일 IP·사용자 기준 시간당 3회, 하루 6회로 제한했고, OG 이미지 API는 토큰·IP·글로벌 세 단계로 슬라이딩 윈도우를 쌓았다. Redis가 없으면 503으로 fail-closed 처리해서 미설정 상태로 프로덕션에 배포되는 상황을 원천 차단했다.

Vercel Marketplace Upstash 통합을 쓰면 환경변수 이름이 `KV_REST_API_URL`로 달라진다는 점도 이때 발견해서 fallback 처리를 추가했다.

## 워커 큐의 결제 검증 구멍 막기

QStash 워커(`/api/workers/basic`, `/api/workers/premium`)는 서명 검증 후 리포트 생성을 실행하는 구조였다. 문제는 **서명이 유효한 요청이라도 결제가 실제로 완료됐는지 확인하지 않았다**는 점이다. 재시도나 큐 조작으로 미결제 리포트가 생성될 수 있는 경로가 열려 있었다.

```typescript
// 워커 내부: 결제 테이블까지 조회해 paid 상태를 확인
const [paid] = await db
  .select({ id: payments.id })
  .from(payments)
  .where(and(
    eq(payments.id, row.paymentId),
    eq(payments.reportId, payload.reportId),
    eq(payments.status, 'paid'),
    eq(payments.tier, 'basic'),
  ));
if (!paid) {
  return NextResponse.json({ error: 'payment required' }, { status: 409 });
}
```

페이로드 파싱도 `interface`에서 `z.object().strict()`로 바꿔 예상치 못한 필드가 들어오면 즉시 거부하도록 했다.

## 모바일 결제 복귀의 엣지 케이스

보안 강화와 별개로 실제 결제 테스트에서 모바일 엣지 케이스가 두 개 터졌다.

첫 번째는 **confirm 무한 대기** 문제다. 모바일은 결제앱에서 브라우저로 돌아오는 순간 네트워크가 가장 불안정하다. 기존 코드는 `confirmPortonePayment` 서버 액션을 무기한 기다렸는데, 이 시점에 타임아웃이 나면 사용자가 막다른 화면에 갇혔다. `Promise.race`로 5초 상한을 걸고, confirm이 실패해도 폴링 화면으로 무조건 진행하도록 바꿨다. 실제 결제 확정은 ReportPendingClient의 상태 폴링이 흡수한다.

두 번째는 **다른 브라우저로 복귀**하는 케이스다. 카카오페이 같은 앱은 간혹 결제를 시작한 브라우저가 아닌 기본 브라우저로 복귀시킨다. 이때 세션 쿠키가 없어서 결제 소유자 확인이 실패하는데, 기존 코드는 그냥 `redirect('/')`로 보내버렸다. 사용자 입장에서는 결제가 됐는지 안 됐는지 알 수 없는 상태. 이제는 `paymentError=return_mismatch` 파라미터로 안내 모달을 띄워 "결제를 진행했던 브라우저에서 확인하라"는 메시지를 보여준다.

## 원시 에러 노출 제거

결제 실패 시 PortOne SDK의 `response.message`를 화면에 그대로 렌더하고 있었다. `PG_PROVIDER_ERROR: raw detail` 같은 내부 메시지가 사용자에게 그대로 보이는 상황. 심사 기준에도 맞지 않고 UX도 나쁘다.

에러 상태를 컴포넌트 로컬 state에서 관리하던 방식을 버리고, 전역 `FeedbackModal`로 고정 문구만 보여주도록 일원화했다. 원문은 `console.error`에만 남긴다. Zod `flatten()` 객체를 그대로 응답하던 API도 고정 코드 `'invalid'`만 내려보내도록 수정했다.

## CSP와 배포 설정

PortOne 브라우저 SDK는 `cdn.portone.io`에서 로드되고, 결제창은 `checkout-service.prod.iamport.co` iframe을 사용한다. **Content Security Policy**에 이 도메인들이 빠져 있어서 결제창이 아예 열리지 않았다. `script-src`, `connect-src`, `frame-src` 세 곳을 모두 업데이트했다.

`www.sajuvillage.com`으로 접근하면 `sajuvillage.com`으로 301 리다이렉트하는 설정과 `deploymentId`를 커밋 SHA로 고정하는 설정도 추가했다. 도메인이 달라지면 NextAuth 세션 쿠키가 공유되지 않아 로그인이 깨지는 문제를 막기 위한 조치다.

---

이번 작업을 마치고 보니 "결제 기능 추가"와 "결제가 안전하게 동작하는 것" 사이에 생각보다 큰 거리가 있었다. 특히 비회원 흐름과 모바일 복귀 케이스는 코드만으로는 발견하기 어렵고 실제 디바이스 테스트를 해봐야 드러나는 부분이었다. 심사 전에 발견한 게 다행이다.