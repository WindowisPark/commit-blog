import { Octokit } from '@octokit/rest';

let _octokit: Octokit | null = null;

export function getOctokit(): Octokit {
  if (!_octokit) {
    _octokit = new Octokit({
      auth: process.env.GH_PAT || process.env.GITHUB_TOKEN,
    });
  }
  return _octokit;
}

export interface CommitInfo {
  sha: string;
  message: string;
  date: string;
  author: string;
  diff: string;
  files: { filename: string; additions: number; deletions: number; status: string }[];
}

export async function fetchCommits(
  owner: string,
  repo: string,
  since: string,
  until: string,
  excludePaths: string[] = [],
): Promise<CommitInfo[]> {
  const octokit = getOctokit();
  const commits: CommitInfo[] = [];

  const listResponse = await octokit.rest.repos.listCommits({
    owner,
    repo,
    since,
    until,
    per_page: 100,
  });

  for (const item of listResponse.data) {
    const detail = await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref: item.sha,
    });

    const files = (detail.data.files ?? [])
      .filter((f) => !excludePaths.some((ep) => f.filename?.startsWith(ep)))
      .map((f) => ({
        filename: f.filename ?? '',
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        status: f.status ?? 'modified',
      }));

    const diff = (detail.data.files ?? [])
      .filter((f) => !excludePaths.some((ep) => f.filename?.startsWith(ep)))
      .map((f) => f.patch ?? '')
      .join('\n');

    commits.push({
      sha: item.sha,
      message: item.commit.message,
      date: item.commit.author?.date ?? item.commit.committer?.date ?? '',
      author: item.commit.author?.name ?? 'unknown',
      diff,
      files,
    });

    // Basic rate limit handling
    if (listResponse.data.length > 30) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return commits;
}
