---
title: "JobMate: Docker로 한 번에 배포하는 실전 마이크로서비스"
description: "복잡한 FastAPI + React + PostgreSQL 스택을 `docker compose up --build` 한 번으로 실행할 수 있게 만든 과정을 공유합니다."
pubDate: 2026-03-25
repo: jobmate
repoDisplayName: JobMate
tags: ["jobmate", "feature", "python"]
commits: ["9480f3bde6c32430f612ae192b9831913d045a0f"]
---
프로덕션 수준의 웹 애플리케이션을 개발하다 보면 반드시 맞닥뜨리는 문제가 있습니다. "내 컴퓨터에서는 잘 되는데?" 바로 배포와 환경 설정의 복잡성입니다. **JobMate** 프로젝트에서 FastAPI 백엔드, React 프론트엔드, PostgreSQL, Redis가 얽힌 복잡한 스택을 어떻게 원커맨드 배포로 단순화했는지 공유해보겠습니다.

## 기존 문제: 개발환경과 프로덕션의 괴리

JobMate는 AI 기반 취업 상담 서비스로, 실시간 WebSocket 통신과 데이터베이스 마이그레이션이 필요한 복잡한 애플리케이션입니다. 개발할 때는 백엔드와 프론트엔드를 각각 다른 포트에서 실행하고, 로컬 PostgreSQL과 Redis를 따로 띄워야 했습니다.

문제는 배포할 때였습니다. CORS 설정, 데이터베이스 연결, WebSocket 프록시 설정 등 수많은 설정이 환경마다 달라졌고, 특히 **Alembic 마이그레이션**을 수동으로 실행해야 하는 번거로움이 있었습니다.

## Docker Compose로 통합 아키텍처 구성

해결의 핵심은 모든 서비스를 하나의 네트워크에서 돌리되, 각각의 역할을 명확히 분리하는 것이었습니다.

```yaml
services:
  backend:
    build: ./backend
    environment:
      JOBMATE_DATABASE_URL: postgresql+asyncpg://jobmate:jobmate@postgres:5432/jobmate
      JOBMATE_REDIS_URL: redis://redis:6379/0
    depends_on:
      postgres:
        condition: service_healthy
  
  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - backend
```

가장 중요한 변화는 **환경변수를 통한 서비스 디스커버리**입니다. 각 컨테이너가 `postgres:5432`, `redis:6379` 같은 내부 네트워크 주소로 통신하게 되면서, 개발자는 더 이상 포트 충돌이나 IP 설정을 신경 쓰지 않아도 됩니다.

## 백엔드: 자동 마이그레이션과 데이터 시딩

백엔드에서 가장 까다로웠던 부분은 **데이터베이스 초기화**입니다. 컨테이너가 시작될 때마다 Alembic 마이그레이션을 실행하고, AI 에이전트 데이터를 시드해야 했습니다.

```bash
#!/bin/sh
set -e

echo "==> Running Alembic migrations..."
python -m alembic upgrade head

echo "==> Seeding agents table..."
python -c "
# ... agents 데이터 삽입 로직
"

echo "==> Starting server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`entrypoint.sh` 스크립트로 이 과정을 자동화했습니다. 특히 Alembic이 동기 드라이버(`psycopg2`)를 사용하는데 애플리케이션은 비동기 드라이버(`asyncpg`)를 쓰는 문제도 환경변수 오버라이드로 해결했습니다.

또 하나 중요한 개선은 **글로벌 예외 핸들러** 수정입니다. 기존에는 모든 예외를 500 에러로 변환했는데, FastAPI의 `HTTPException`까지 가로채서 문제가 있었습니다. 이제 HTTP 예외는 정상적으로 통과시켜 적절한 상태 코드가 반환됩니다.

## 프론트엔드: Multi-stage 빌드와 Nginx 프록시

프론트엔드는 개발용 Vite 서버에서 **프로덕션용 Nginx 정적 서빙**으로 완전히 바뀌었습니다.

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

**Multi-stage 빌드**로 최종 이미지 크기를 대폭 줄였고, Nginx 설정으로 SPA 라우팅과 API 프록시를 한 번에 해결했습니다. `/api/`와 `/ws/` 경로는 백엔드로 프록시하고, 나머지는 React 앱의 `index.html`로 fallback됩니다.

WebSocket URL도 환경에 따라 자동 전환되도록 개선했습니다:

```typescript
export const WS_BASE_URL =
  import.meta.env.DEV
    ? "ws://localhost:8000/ws"
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
```

## 배포의 새로운 경험

이제 JobMate를 실행하는 방법은 단 한 줄입니다:

```bash
docker compose up --build
```

컨테이너들이 순서대로 시작되고, 헬스체크가 통과되면 자동으로 마이그레이션과 시딩이 실행됩니다. 개발자든 운영자든 누구나 동일한 환경에서 애플리케이션을 실행할 수 있게 되었습니다.

특히 `.dockerignore` 파일로 불필요한 파일들을 제외해 빌드 속도도 크게 개선되었습니다. `node_modules`, `.git`, 테스트 파일 등을 제외하니 컨텍스트 전송 시간이 눈에 띄게 줄어들었습니다.

## 마치며

복잡한 마이크로서비스 애플리케이션을 Docker로 통합하는 과정에서 가장 중요한 것은 **각 서비스의 책임을 명확히 분리**하는 것이었습니다. 백엔드는 비즈니스 로직과 데이터 처리에만 집중하고, 프론트엔드는 정적 파일 서빙에만 집중하며, Nginx가 라우팅과 프록시를 담당하는 구조로 역할이 깔끔하게 나뉘었습니다.

이런 개선을 통해 JobMate는 개발환경과 프로덕션환경의 차이를 최소화하고, 새로운 팀원도 쉽게 프로젝트를 실행할 수 있는 환경을 갖추게 되었습니다.