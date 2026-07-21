#!/usr/bin/env node
// 신규 레포 후보 감지기 (반자동 도입)
// - 계정의 공개·비포크·비아카이브 레포 중 최근 활동이 있고 repos.config.json에 아직 없는 것을 찾아
//   GitHub Issue로 알린다. 실제 도입(테마 배정 포함)은 사람이 repos.config.json에 추가해 결정한다.
//
// 사용:
//   node scripts/detect-candidates.mjs           # Issue 생성/갱신
//   node scripts/detect-candidates.mjs --dry      # 콘솔 출력만 (로컬 점검용)
//
// 요구: gh CLI 인증(GH_TOKEN 또는 로그인). Actions에서는 secrets.GH_PAT 사용.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

// ── 도입 판정 기준 ───────────────────────────────────────────────
const ACTIVE_DAYS = 90; // 최근 N일 내 push가 있어야 후보
const LABEL = 'repo-candidate';
// 블로그 소스가 될 수 없는 레포(포트폴리오/프로필/블로그 자신 등)는 제외
const IGNORE = new Set(['commit-blog', 'windowispark', 'windowispark.github.io']);

const DRY = process.argv.includes('--dry');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// ── 1. 등록된 레포(단일 소스) ────────────────────────────────────
const config = JSON.parse(readFileSync(resolve(process.cwd(), 'repos.config.json'), 'utf-8'));
const owner = config.repos[0]?.owner ?? 'WindowisPark';
const registered = new Set(config.repos.map((r) => r.repo.toLowerCase()));

// ── 2. 계정 레포 조회 (공개·비포크·비아카이브) ──────────────────
let repos = [];
try {
  const out = sh(
    `gh repo list ${owner} --limit 200 --source --no-archived --visibility public --json name,pushedAt,description,primaryLanguage`
  );
  repos = JSON.parse(out);
} catch (e) {
  console.error('gh repo list 실패:', e.message);
  process.exit(1);
}

// ── 3. 후보 필터: 미등록 + 무시목록 제외 + 최근 활동 ─────────────
const cutoff = Date.now() - ACTIVE_DAYS * 24 * 60 * 60 * 1000;
const candidates = repos
  .filter((r) => !registered.has(r.name.toLowerCase()))
  .filter((r) => !IGNORE.has(r.name.toLowerCase()))
  .filter((r) => r.pushedAt && new Date(r.pushedAt).getTime() >= cutoff)
  .sort((a, b) => new Date(b.pushedAt) - new Date(a.pushedAt));

if (candidates.length === 0) {
  console.log(`후보 없음 — 최근 ${ACTIVE_DAYS}일 내 미등록 활성 레포가 없습니다.`);
  process.exit(0);
}

// ── 4. Issue 본문 작성 ───────────────────────────────────────────
const rows = candidates
  .map((r) => {
    const lang = r.primaryLanguage?.name ?? '-';
    const pushed = r.pushedAt.slice(0, 10);
    const desc = (r.description ?? '').replace(/\|/g, '\\|').slice(0, 60);
    return `| \`${r.name}\` | ${lang} | ${pushed} | ${desc} |`;
  })
  .join('\n');

const body = `아래는 **repos.config.json에 아직 없는** 최근 ${ACTIVE_DAYS}일 내 활동한 공개 레포입니다.
블로그에 연재할 가치가 있는지(활동량·로드맵 부합) 판단해서 도입할 레포만 골라 주세요.

| 레포 | 언어 | 최근 push | 설명 |
|---|---|---|---|
${rows}

### 도입하려면
\`repos.config.json\`에 아래 형식으로 추가하면 생성 파이프라인 + 글목록에 함께 반영됩니다.

\`\`\`jsonc
{ "owner": "${owner}", "repo": "<레포명>", "displayName": "<표시명>", "groupBy": "context",
  "category": "backend | ai | product", "minor": false }
\`\`\`

- \`category\`: 로드맵 테마 (backend / ai / product) 중 하나
- \`minor\`: 커밋이 적어 접어두고 싶으면 true

> 이 이슈는 감지기(\`scripts/detect-candidates.mjs\`)가 자동 생성/갱신합니다. 도입 완료 후 닫아 주세요.`;

if (DRY) {
  console.log(`후보 ${candidates.length}건:\n`);
  console.log(body);
  process.exit(0);
}

// ── 5. Issue upsert (라벨 기준으로 기존 이슈 갱신, 없으면 생성) ──
const bodyFile = resolve(tmpdir(), 'repo-candidates-body.md');
writeFileSync(bodyFile, body, 'utf-8');

try {
  sh(`gh label create ${LABEL} --color BFD4F2 --description "블로그 미등록 신규 레포 후보" --force`);
} catch {
  /* 라벨이 이미 있으면 무시 */
}

let existing = '';
try {
  existing = sh(`gh issue list --state open --label ${LABEL} --limit 1 --json number --jq ".[0].number"`).trim();
} catch {
  existing = '';
}

const title = `신규 레포 후보 ${candidates.length}건 (${new Date().toISOString().slice(0, 10)})`;

if (existing) {
  sh(`gh issue edit ${existing} --title "${title}" --body-file "${bodyFile}"`);
  console.log(`기존 이슈 #${existing} 갱신 — 후보 ${candidates.length}건`);
} else {
  const url = sh(`gh issue create --title "${title}" --body-file "${bodyFile}" --label ${LABEL}`).trim();
  console.log(`신규 이슈 생성 — ${url}`);
}
