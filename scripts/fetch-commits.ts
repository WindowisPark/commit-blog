import { fetchCommits, type CommitInfo } from './utils/github-client.js';
import type { RepoConfig, Config } from './utils/config.js';

export interface RepoCommits {
  owner: string;
  repo: string;
  displayName: string;
  commits: CommitInfo[];
}

export async function fetchAllCommits(
  repos: RepoConfig[],
  config: Config,
  since: string,
  until: string,
): Promise<RepoCommits[]> {
  const results: RepoCommits[] = [];

  for (const repoConfig of repos) {
    console.log(`[Fetch] ${repoConfig.owner}/${repoConfig.repo} (${since} ~ ${until})`);

    const commits = await fetchCommits(
      repoConfig.owner,
      repoConfig.repo,
      since,
      until,
      repoConfig.excludePaths ?? [],
    );

    console.log(`  → ${commits.length} commits found`);

    results.push({
      owner: repoConfig.owner,
      repo: repoConfig.repo,
      displayName: repoConfig.displayName,
      commits,
    });
  }

  return results;
}
