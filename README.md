# Commit Blog

AI가 GitHub 커밋 이력을 분석하여 기술 블로그 글을 자동으로 생성하는 정적 사이트 생성기입니다.

## 기술 스택

- **프레임워크**: Astro 6, TypeScript
- **스타일링**: Tailwind CSS 4
- **AI**: Anthropic Claude API
- **GitHub 연동**: Octokit (GitHub REST API)

## 주요 기능

- GitHub 저장소의 커밋을 자동 수집 및 분석
- 커밋 그룹핑 전략 지원: `date`, `pr`, `branch`, `context`
- Claude API를 활용한 한국어 기술 블로그 글 자동 생성
- 여러 저장소를 한 블로그에서 관리
- 태그 기반 글 분류

## 프로젝트 구조

```
├── src/
│   ├── components/      # PostCard, RepoTag 등 UI 컴포넌트
│   ├── content/         # 생성된 블로그 글 (Markdown)
│   ├── layouts/         # BaseLayout
│   ├── pages/           # 라우트 (index, blog, tags, about)
│   └── styles/          # 글로벌 스타일
├── scripts/
│   ├── pipeline.ts      # 전체 파이프라인 오케스트레이션
│   ├── fetch-commits.ts # GitHub 커밋 수집
│   ├── group-commits.ts # 커밋 그룹핑
│   └── generate-post.ts # AI 블로그 글 생성
├── repos.config.json    # 저장소 설정
└── package.json
```

## 시작하기

### 요구사항

- Node.js >= 22.12.0

### 설치

```bash
npm install
```

### 환경변수 설정

프로젝트 루트에 `.env` 파일을 생성합니다:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key
GITHUB_TOKEN=your_github_token
```

### 저장소 설정

`repos.config.json`에서 블로그 글을 생성할 저장소를 설정합니다:

```json
{
  "repos": [
    { "owner": "username", "repo": "repo-name", "displayName": "표시 이름", "groupBy": "context" }
  ],
  "defaults": {
    "groupBy": "context",
    "language": "ko",
    "maxDiffLines": 500
  }
}
```

`groupBy` 옵션: `date` (날짜별), `pr` (PR별), `branch` (브랜치별), `context` (AI 컨텍스트 분석)

## 스크립트

| 명령어 | 설명 |
|:--|:--|
| `npm run generate` | 커밋 수집 → 그룹핑 → 블로그 글 생성 |
| `npm run generate:dry` | 실제 생성 없이 파이프라인 미리보기 |
| `npm run dev` | 로컬 개발 서버 실행 (`localhost:4321`) |
| `npm run build` | 프로덕션 빌드 |
| `npm run preview` | 빌드 결과 로컬 미리보기 |

## 배포

GitHub Pages를 통해 자동 배포됩니다.
