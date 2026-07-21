// 블로그 카테고리(테마) 구조 설정
// - 상위: 로드맵 테마(theme) / 하위: 레포(repo)
// - 레포가 "어느 테마에 속하는가 / 접힘(minor) 대상인가"는 repos.config.json 한 곳에서 관리합니다.
//   (새 레포 도입 시 repos.config.json만 수정하면 생성 파이프라인 + 글목록에 함께 반영됩니다.)
// - 이 파일은 "테마 자체의 이름·설명·순서"만 정의합니다.

import reposConfig from '../../repos.config.json';

interface RepoEntry {
  owner: string;
  repo: string;
  displayName: string;
  groupBy?: string;
  category?: string;
  minor?: boolean;
}

const repoEntries = reposConfig.repos as RepoEntry[];

export interface Category {
  /** URL·data-attribute용 slug (repos.config.json의 category 값과 일치) */
  id: string;
  /** 화면에 표시될 테마 이름 */
  name: string;
  /** 테마 한 줄 설명 (선택) */
  description?: string;
  /** 이 테마에 속한 레포 id 목록 (repos.config.json 등록 순서) */
  repos: string[];
}

/** categories에 등록되지 않은(=category 미지정) 레포가 담길 기본 테마 id */
export const UNCATEGORIZED_ID = 'etc';

/**
 * 로드맵 테마 메타데이터. 위에서부터 표시됩니다.
 * 새 테마를 추가하려면 여기에 { id, name, description }를 넣고
 * repos.config.json의 레포에 category: "<id>"를 지정하면 됩니다.
 */
const themeMeta: Omit<Category, 'repos'>[] = [
  {
    id: 'backend',
    name: '백엔드 · 동시성 제어',
    description: '헥사고날 아키텍처, 분산락, 벤치마크로 검증하는 백엔드 설계',
  },
  {
    id: 'ai',
    name: 'AI · LLM 서비스',
    description: '멀티에이전트, ML 파이프라인, LLM 품질을 다룬 AI 서비스',
  },
  {
    id: 'product',
    name: '풀스택 제품 실험',
    description: '실사용 문제에서 출발해 출시까지 만든 풀스택 제품',
  },
];

/** repo id → 소속 테마 id (repos.config.json 단일 소스에서 파생) */
export const repoToCategory = new Map<string, string>(
  repoEntries.map((r) => [r.repo, r.category ?? UNCATEGORIZED_ID] as const)
);

/**
 * "연재가 애매한"(커밋/수정이 적은) 레포 — 목록에서 접힌(collapsed) 상태로 렌더링됩니다.
 * repos.config.json에서 해당 레포에 "minor": true 를 지정/해제하면 됩니다.
 */
export const minorRepos: string[] = repoEntries.filter((r) => r.minor).map((r) => r.repo);

/**
 * 테마 메타데이터 + repos.config.json의 category를 결합한 최종 카테고리 목록.
 * 각 테마의 repos는 repos.config.json 등록 순서를 따릅니다.
 */
export const categories: Category[] = themeMeta.map((meta) => ({
  ...meta,
  repos: repoEntries
    .filter((r) => (r.category ?? UNCATEGORIZED_ID) === meta.id)
    .map((r) => r.repo),
}));
