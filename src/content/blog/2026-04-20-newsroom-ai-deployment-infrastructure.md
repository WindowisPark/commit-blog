---
title: "무료 호스팅으로 AI 뉴스룸 배포하기: Supabase + Fly.io + Vercel"
description: "Docker Compose로 구축한 AI 뉴스룸을 무료 클라우드 서비스들로 배포하는 과정과 설정 최적화 경험"
pubDate: 2026-04-20
repo: newsroom-ai
repoDisplayName: Newsroom AI
tags: ["newsroom-ai", "chore", "bugfix", "python"]
commits: ["518d6fd63c034e704c741e3ece29d949a62a9ca1", "3c51cbf170692dfc5dd8267ef5723b695ebfbe43", "c269a52051ec44379a85b24bd0bed7a58d46f079", "d8fa5c6c1d404c0013ce2ce019279ac8545aaa87"]
---
## 완전 무료로 AI 뉴스룸 배포하기

서울신문 AI 개발자 채용 과제로 만든 **Newsroom AI** 프로젝트를 실제 클라우드에 배포하는 과정을 정리해봤습니다. 로컬에서 Docker Compose로 잘 돌아가던 서비스를 **완전 무료 호스팅**으로 올리면서 마주한 문제들과 해결 방법을 공유합니다.

## 배포 전략: 3-tier를 각각 무료 서비스로

기존 Docker Compose 구성을 그대로 클라우드로 옮기는 전략을 택했습니다:

- **PostgreSQL** → Supabase (500MB 무료, JSONB 지원)
- **FastAPI 백엔드** → Fly.io (작은 VM 하나, always-on 필요)
- **Next.js 프론트엔드** → Vercel (Hobby 플랜)

핵심은 **APScheduler**가 15분마다 뉴스를 수집해야 하므로 백엔드가 항상 떠있어야 한다는 점이었습니다. 서버리스로는 불가능해서 Fly.io의 작은 VM을 선택했습니다.

## Docker 컨테이너화와 재현성 확보

배포 전에 먼저 완벽한 로컬 재현성을 만들었습니다:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: newsroom
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres", "-d", "newsroom"]
      interval: 3s
      retries: 20

  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    environment:
      DATABASE_URL: postgresql+asyncpg://postgres:postgres@postgres:5432/newsroom
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
    depends_on:
      postgres:
        condition: service_healthy
```

단순해 보이지만 **헬스체크를 통한 의존성 관리**가 핵심입니다. 백엔드가 뜨자마자 DB 연결을 시도하는데, Postgres가 완전히 준비되지 않으면 크래시가 발생하거든요.

## Fly.io 배포와 always-on 설정

Fly.io는 기본적으로 트래픽이 없으면 VM을 자동으로 멈춥니다. 하지만 뉴스 수집 스케줄러는 계속 돌아야 하므로 이를 비활성화해야 했습니다:

```toml
[http_service]
  internal_port = 8000
  auto_stop_machines = "off"  # 핵심!
  min_machines_running = 1
  
[[vm]]
  memory = "512mb"
  cpus = 1
```

`auto_stop_machines = "off"`가 없으면 몇 분 후 VM이 꺼져서 스케줄러가 멈춥니다. 무료 할당량 내에서 작은 VM 하나는 24/7 돌릴 수 있어서 이 설정이 가능했습니다.

## Supabase Connection Pooling 함정

가장 까다로웠던 부분은 **Supabase의 Connection Pooling** 설정이었습니다. 처음에 Transaction Pooler(포트 6543)를 썼다가 이런 에러를 만났습니다:

```
prepared statement does not exist
```

Asyncpg가 prepared statement를 캐시하는데, Transaction Pooler가 이를 방해했던 겁니다. **Session Pooler(포트 5432)**로 바꾸니까 깔끔하게 해결됐습니다.

```
# 잘못된 설정
postgresql+asyncpg://...@pooler.supabase.com:6543/postgres

# 올바른 설정  
postgresql+asyncpg://...@pooler.supabase.com:5432/postgres
```

## PowerShell과 JSON 설정의 악몽

Windows PowerShell에서 Fly secrets를 설정할 때 JSON 배열 때문에 고생했습니다:

```bash
# 이렇게 하면 따옴표가 깨짐
fly secrets set CORS_ORIGINS='["https://example.com"]'
```

결국 **콤마 구분 문자열**로 바꿔서 해결했습니다:

```python
class Settings(BaseSettings):
    cors_origins: str = "http://localhost:3000"
    
    @property 
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
```

이제 `fly secrets set CORS_ORIGINS="domain1.com,domain2.com"`처럼 간단하게 설정할 수 있습니다.

## 146줄의 배포 가이드

모든 시행착오를 정리해서 **완전한 배포 가이드**를 만들었습니다. Supabase 프로젝트 생성부터 Vercel 환경변수 설정까지, 단계별로 따라하면 누구나 무료로 배포할 수 있도록 했습니다.

특히 트러블슈팅 섹션에는 실제로 겪었던 문제들과 해결책을 모두 담았습니다:

- asyncpg prepared statement 오류
- Vercel 환경변수가 적용되지 않는 문제  
- Fly VM 메모리 부족 현상
- 스케줄러 중복 실행 이슈

## 마무리

로컬 Docker Compose 환경을 클라우드로 옮기는 과정에서 많은 것을 배웠습니다. 특히 **Connection Pooling의 미묘한 차이점**이나 **PowerShell의 JSON 이스케이프 문제** 같은 것들은 실제로 부딪혀봐야 알 수 있는 경험이었죠.

이제 `docker compose up`으로 로컬 개발을 하다가, 필요하면 언제든 무료 클라우드로 배포할 수 있는 완전한 파이프라인이 완성됐습니다. 다음에는 CI/CD 자동화를 추가해볼 예정입니다.