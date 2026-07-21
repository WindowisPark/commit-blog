// 블로그 카테고리(테마) 구조 설정
// - 상위: 로드맵 테마(theme) / 하위: 레포(repo)
// - 이 파일만 수정하면 글목록의 2단 구조가 바뀝니다.

export interface Category {
  /** URL·data-attribute용 slug */
  id: string;
  /** 화면에 표시될 테마 이름 */
  name: string;
  /** 테마 한 줄 설명 (선택) */
  description?: string;
  /** 이 테마에 속한 레포 id 목록 (표시 순서대로) */
  repos: string[];
}

/**
 * 로드맵 테마 정의. 위에서부터 표시됩니다.
 * repos 배열의 값은 글 frontmatter의 `repo` 값과 일치해야 합니다.
 */
export const categories: Category[] = [
  {
    id: 'backend',
    name: '백엔드 · 동시성 제어',
    description: '헥사고날 아키텍처, 분산락, 벤치마크로 검증하는 백엔드 설계',
    repos: ['SpotPrice', 'lock-bench'],
  },
  {
    id: 'ai',
    name: 'AI · LLM 서비스',
    description: '멀티에이전트, ML 파이프라인, LLM 품질을 다룬 AI 서비스',
    repos: ['jobmate', 'kbo-prediction', 'newsroom-ai'],
  },
  {
    id: 'product',
    name: '풀스택 제품 실험',
    description: '실사용 문제에서 출발해 출시까지 만든 풀스택 제품',
    repos: ['fitin', 'Dividend1s'],
  },
];

/**
 * "연재가 애매한"(커밋/수정이 적은) 레포.
 * 목록에서 접힌(collapsed) 상태로 렌더링되어 시각적으로 통합·정리됩니다.
 * 여기서 제거하면 다시 펼친 상태로 노출됩니다.
 */
export const minorRepos: string[] = ['Dividend1s', 'fitin'];

/** repo id → 소속 테마 id 역참조 맵 */
export const repoToCategory = new Map<string, string>(
  categories.flatMap((c) => c.repos.map((repo) => [repo, c.id] as const))
);

/** categories에 등록되지 않은 레포가 담길 기본 테마 id */
export const UNCATEGORIZED_ID = 'etc';
