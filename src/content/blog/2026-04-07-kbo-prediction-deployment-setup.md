---
title: "KBO 예측 서비스, 프로덕션 배포로 한 걸음 더"
description: "ML 모델부터 에이전트 토론까지, 완전한 KBO 예측 시스템을 Vercel과 Railway로 실제 서비스 환경에 배포한 과정을 공유합니다."
pubDate: 2026-04-07
repo: kbo-prediction
repoDisplayName: KBO Prediction
tags: ["kbo-prediction", "react", "bugfix", "python"]
commits: ["4f42b79e849b47bb1cb8ebe9762803adeeb3a696", "c57e633da63ff2281f3b0112a0aff16b67e9b228", "ee7aa5f310d5b4d7609cfd09d1263fc10ccda93a", "97793d58123822fd7dbc055bca0f21fe7d031821", "f546913218baa9d0c0c1ddbbbfbcfb301db74160", "8bcc1d0be41761d56e26bea00c9ce1d93e3eabaa", "e5313dbe8daa5099403fdc86245470b04b861c87", "ab39f437d493bac74536bd5c55fb922488dc8296"]
---
## 드디어 실제 서비스로

로컬에서만 돌아가던 KBO 예측 시스템이 실제 서비스로 태어났습니다. **Vercel**에서 프론트엔드를, **Railway**에서 백엔드를, 그리고 **GitHub Actions**로 매일 자정 데이터 업데이트까지 완전히 자동화된 배포 파이프라인을 구축했습니다.

## 배포 아키텍처: 각자 맞는 자리에

배포 환경을 선택할 때는 각 플랫폼의 특성을 고려했습니다. 프론트엔드는 **Vercel**의 강력한 Next.js 최적화와 글로벌 CDN을 활용했고, 백엔드는 **Railway**의 간단한 Docker 배포와 안정적인 서버 환경을 선택했습니다.

가장 까다로운 부분은 환경 변수 설정이었습니다. 로컬에서는 하드코딩된 `localhost:8000`을 사용했지만, 프로덕션에서는 동적으로 API URL을 설정해야 했습니다.

```typescript
// lib/config.ts
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// 모든 컴포넌트에서 하드코딩 제거
fetch(`${API_URL}/predictions?limit=500`)
```

## 컨테이너 최적화: 필요한 것만 담아서

**Railway** 배포를 위한 Docker 이미지를 만들면서 가장 신경 쓴 부분은 용량 최적화였습니다. 처음에는 모든 데이터 파일을 포함하려 했지만, 실제로는 미리 처리된 피처만 있으면 충분했습니다.

```dockerfile
# 필수 데이터만 선별적으로 복사
COPY data/processed/ data/processed/
COPY data/features/ data/features/
COPY data/standings.json data/
COPY data/elo_ratings.json data/

# LightGBM을 위한 시스템 라이브러리
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1
```

특히 **LightGBM** 라이브러리가 리눅스에서 `libgomp1` 의존성을 필요로 한다는 점을 놓쳐서 한 번 빌드 실패를 겪었습니다. 이런 세부사항들이 실제 배포에서는 중요합니다.

## 자동화의 힘: GitHub Actions로 데이터 신선도 유지

가장 만족스러운 부분은 **GitHub Actions**를 통한 자동화입니다. 매일 자정(KST)에 최신 경기 결과를 수집하고, ELO 레이팅을 업데이트하며, 예측 정확도를 추적합니다.

```yaml
name: Daily KBO Batch
on:
  schedule:
    - cron: '0 15 * * *'  # UTC 15:00 = KST 00:00
  workflow_dispatch:  # 수동 실행도 가능

jobs:
  batch:
    steps:
      - name: Run daily batch
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: python scripts/daily_batch.py

      - name: Commit updated data
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "daily: ELO update + accuracy tracking"
```

## CORS와 프리뷰 환경: 예상치 못한 복병

Vercel의 프리뷰 배포 때문에 CORS 설정에서 예상치 못한 문제가 발생했습니다. 프리뷰 배포는 `kbo-prediction-xxx.vercel.app` 형태의 동적 도메인을 사용하는데, 이를 개별적으로 허용할 수는 없었습니다.

해결책은 **정규표현식** 패턴을 사용하는 것이었습니다.

```python
# 정적 도메인과 정규식 패턴 함께 사용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://kbo-prediction-lilac.vercel.app"],
    allow_origin_regex=r"https://kbo-prediction[a-z0-9\-]*\.vercel\.app",
    allow_credentials=True,
)
```

## 서비스 안정성: 헬스체크와 모니터링

실제 서비스 운영을 위해서는 단순한 기능 구현을 넘어서는 요소들이 필요했습니다. **Railway**의 헬스체크를 위한 엔드포인트를 추가하고, 예측 에이전트가 실제 KBO 순위표 데이터를 활용할 수 있도록 개선했습니다.

특히 에이전트들이 현재 리그 순위를 바탕으로 팀의 심리적 상태를 분석할 수 있도록 맥락을 풍부하게 만들었습니다. 1위와 10위의 대결은 단순한 ELO 점수 차이 이상의 의미가 있기 때문입니다.

## 다음 단계: 실제 사용자를 위한 준비

배포는 완료됐지만, 실제 서비스로 가기 위해서는 몇 가지 중요한 단계가 남았습니다. **계정 시스템과 요금제** 도입을 통해 지속 가능한 서비스 모델을 만들고, **4월 시즌 130경기 이상**에서 실제 예측 정확도를 검증할 계획입니다.

현재 개발 환경에서 62.9%의 정확도를 보인 모델이 실제 2026시즌에서 어떤 성과를 낼지 기대됩니다. 기술적 구현도 중요하지만, 결국 사용자들이 실제로 도움을 받을 수 있는 서비스가 되는 것이 목표입니다.