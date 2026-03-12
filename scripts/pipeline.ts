import { loadConfig, getRepoConfig } from './utils/config.js';
import { fetchAllCommits } from './fetch-commits.js';
import { groupCommits, groupCommitsAsync } from './group-commits.js';
import { generatePosts } from './generate-post.js';

interface PipelineOptions {
  dateFrom?: string;
  dateTo?: string;
  targetRepo?: string;
  dryRun?: boolean;
}

function parseArgs(): PipelineOptions {
  const args = process.argv.slice(2);
  const opts: PipelineOptions = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--from':
        opts.dateFrom = args[++i];
        break;
      case '--to':
        opts.dateTo = args[++i];
        break;
      case '--repo':
        opts.targetRepo = args[++i];
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
    }
  }

  return opts;
}

function getDefaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  return {
    from: weekAgo.toISOString().slice(0, 10) + 'T00:00:00Z',
    to: now.toISOString().slice(0, 10) + 'T23:59:59Z',
  };
}

async function main() {
  console.log('=== Commit Blog Pipeline ===\n');

  const opts = parseArgs();
  const config = loadConfig();

  const defaultRange = getDefaultDateRange();
  const since = opts.dateFrom ? `${opts.dateFrom}T00:00:00Z` : defaultRange.from;
  const until = opts.dateTo ? `${opts.dateTo}T23:59:59Z` : defaultRange.to;

  console.log(`Date range: ${since} ~ ${until}`);
  console.log(`Dry run: ${opts.dryRun ?? false}\n`);

  const repos = getRepoConfig(config, opts.targetRepo);
  console.log(`Target repos: ${repos.map((r) => r.repo).join(', ')}\n`);

  // Fetch commits
  const allRepoCommits = await fetchAllCommits(repos, config, since, until);

  let totalGenerated = 0;

  for (const repoCommits of allRepoCommits) {
    if (repoCommits.commits.length === 0) {
      console.log(`[${repoCommits.repo}] No commits found, skipping.\n`);
      continue;
    }

    // Find groupBy strategy for this repo
    const repoConfig = repos.find((r) => r.repo === repoCommits.repo)!;
    const groupBy = repoConfig.groupBy ?? config.defaults.groupBy;

    console.log(`\n[${repoCommits.repo}] Grouping by: ${groupBy}`);
    const groups = await groupCommitsAsync(repoCommits.commits, groupBy);
    console.log(`  → ${groups.length} groups\n`);

    // Generate posts
    const generated = await generatePosts(
      repoCommits.repo,
      repoCommits.displayName,
      groups,
      config,
      opts.dryRun ?? false,
    );

    totalGenerated += generated.length;
  }

  console.log(`\n=== Done! Generated ${totalGenerated} posts ===`);
}

main().catch((err) => {
  console.error('Pipeline error:', err);
  process.exit(1);
});
