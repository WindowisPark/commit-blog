import type { CommitInfo } from './utils/github-client.js';
import type { Config } from './utils/config.js';
import { groupCommitsByContext } from './utils/claude-client.js';

export interface CommitGroup {
  id: string;
  label: string;
  date: string;
  commits: CommitInfo[];
}

export function groupCommits(
  commits: CommitInfo[],
  strategy: 'date' | 'pr' | 'branch',
): CommitGroup[] {
  switch (strategy) {
    case 'date':
      return groupByDate(commits);
    case 'pr':
      return groupByPR(commits);
    case 'branch':
      return groupByBranch(commits);
    default:
      return groupByDate(commits);
  }
}

export async function groupCommitsAsync(
  commits: CommitInfo[],
  strategy: 'date' | 'pr' | 'branch' | 'context',
): Promise<CommitGroup[]> {
  if (strategy === 'context') {
    return groupByContext(commits);
  }
  return groupCommits(commits, strategy);
}

async function groupByContext(commits: CommitInfo[]): Promise<CommitGroup[]> {
  const summaries = commits.map((c) => ({
    sha: c.sha,
    message: c.message,
    files: c.files.map((f) => f.filename),
  }));

  const contextGroups = await groupCommitsByContext(summaries);

  const commitMap = new Map(commits.map((c) => [c.sha, c]));

  return contextGroups.map((group) => {
    const groupCommits = group.commitShas
      .map((sha) => {
        // Match by full sha or prefix
        return commitMap.get(sha) ?? [...commitMap.values()].find((c) => c.sha.startsWith(sha));
      })
      .filter((c): c is CommitInfo => c !== undefined);

    const latestDate = groupCommits
      .map((c) => c.date)
      .sort()
      .reverse()[0] ?? new Date().toISOString();

    return {
      id: group.id,
      label: group.label,
      date: latestDate.slice(0, 10),
      commits: groupCommits,
    };
  }).filter((g) => g.commits.length > 0);
}

function groupByDate(commits: CommitInfo[]): CommitGroup[] {
  const groups = new Map<string, CommitInfo[]>();

  for (const commit of commits) {
    const date = commit.date.slice(0, 10); // YYYY-MM-DD
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(commit);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, commits]) => ({
      id: date,
      label: date,
      date,
      commits,
    }));
}

function groupByPR(commits: CommitInfo[]): CommitGroup[] {
  const prGroups = new Map<string, CommitInfo[]>();
  const noPR: CommitInfo[] = [];

  for (const commit of commits) {
    const prMatch = commit.message.match(/\(#(\d+)\)/);
    if (prMatch) {
      const prNum = prMatch[1];
      if (!prGroups.has(prNum)) prGroups.set(prNum, []);
      prGroups.get(prNum)!.push(commit);
    } else {
      noPR.push(commit);
    }
  }

  const groups: CommitGroup[] = [];

  for (const [prNum, prCommits] of prGroups) {
    const latestDate = prCommits
      .map((c) => c.date)
      .sort()
      .reverse()[0];
    groups.push({
      id: `pr-${prNum}`,
      label: `PR #${prNum}`,
      date: latestDate.slice(0, 10),
      commits: prCommits,
    });
  }

  if (noPR.length > 0) {
    const dateGroups = groupByDate(noPR);
    groups.push(...dateGroups);
  }

  return groups.sort((a, b) => b.date.localeCompare(a.date));
}

function groupByBranch(commits: CommitInfo[]): CommitGroup[] {
  // Branch info is not available from commit data alone,
  // so fall back to grouping merge commits separately
  const mergeCommits: CommitInfo[] = [];
  const regularCommits: CommitInfo[] = [];

  for (const commit of commits) {
    if (commit.message.startsWith('Merge')) {
      mergeCommits.push(commit);
    } else {
      regularCommits.push(commit);
    }
  }

  const groups: CommitGroup[] = [];

  for (const merge of mergeCommits) {
    const branchMatch = merge.message.match(/Merge (?:pull request .+ from |branch ')(.+?)(?:'| into)/);
    const branchName = branchMatch?.[1] ?? 'unknown';
    groups.push({
      id: `branch-${branchName}-${merge.sha.slice(0, 7)}`,
      label: `Branch: ${branchName}`,
      date: merge.date.slice(0, 10),
      commits: [merge],
    });
  }

  if (regularCommits.length > 0) {
    groups.push(...groupByDate(regularCommits));
  }

  return groups.sort((a, b) => b.date.localeCompare(a.date));
}
