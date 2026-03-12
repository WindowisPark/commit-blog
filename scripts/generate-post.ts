import { writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { generateBlogPost, type GeneratedPost } from './utils/claude-client.js';
import type { CommitGroup } from './group-commits.js';
import type { Config } from './utils/config.js';

interface GeneratedLog {
  [slug: string]: { shas: string[]; generatedAt: string };
}

const LOG_PATH = resolve(process.cwd(), '.generated-log.json');

function loadGeneratedLog(): GeneratedLog {
  if (!existsSync(LOG_PATH)) return {};
  return JSON.parse(readFileSync(LOG_PATH, 'utf-8'));
}

function saveGeneratedLog(log: GeneratedLog): void {
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

function buildSlug(repo: string, group: CommitGroup): string {
  return `${group.date}-${repo}-${group.id}`;
}

function truncateDiff(diff: string, maxLines: number): string {
  const lines = diff.split('\n');
  if (lines.length <= maxLines) return diff;
  return lines.slice(0, maxLines).join('\n') + `\n\n... (${lines.length - maxLines} lines truncated)`;
}

function formatCommitData(group: CommitGroup, maxDiffLines: number): string {
  const parts: string[] = [];

  for (const commit of group.commits) {
    parts.push(`### Commit: ${commit.sha.slice(0, 7)}`);
    parts.push(`- **Message**: ${commit.message}`);
    parts.push(`- **Author**: ${commit.author}`);
    parts.push(`- **Date**: ${commit.date}`);

    if (commit.files.length > 0) {
      parts.push(`- **Changed files**:`);
      for (const f of commit.files) {
        parts.push(`  - ${f.filename} (+${f.additions}/-${f.deletions}) [${f.status}]`);
      }
    }

    if (commit.diff) {
      const truncated = truncateDiff(commit.diff, maxDiffLines);
      parts.push(`\n\`\`\`diff\n${truncated}\n\`\`\``);
    }

    parts.push('');
  }

  return parts.join('\n');
}

function buildFrontmatter(
  post: GeneratedPost,
  repo: string,
  displayName: string,
  group: CommitGroup,
  tags: string[],
): string {
  const shas = group.commits.map((c) => c.sha);
  return [
    '---',
    `title: "${post.title.replace(/"/g, '\\"')}"`,
    `description: "${post.description.replace(/"/g, '\\"')}"`,
    `pubDate: ${group.date}`,
    `repo: ${repo}`,
    `repoDisplayName: ${displayName}`,
    `tags: [${tags.map((t) => `"${t}"`).join(', ')}]`,
    `commits: [${shas.map((s) => `"${s}"`).join(', ')}]`,
    '---',
    '',
  ].join('\n');
}

export async function generatePosts(
  repo: string,
  displayName: string,
  groups: CommitGroup[],
  config: Config,
  dryRun: boolean,
): Promise<string[]> {
  const log = loadGeneratedLog();
  const generated: string[] = [];
  const blogDir = resolve(process.cwd(), 'src/content/blog');

  for (const group of groups) {
    if (group.commits.length === 0) continue;

    const slug = buildSlug(repo, group);
    const shas = group.commits.map((c) => c.sha).sort();
    const existingEntry = log[slug];

    // Skip if already generated with same commits
    if (existingEntry && JSON.stringify(existingEntry.shas.sort()) === JSON.stringify(shas)) {
      console.log(`[Skip] ${slug} (already generated)`);
      continue;
    }

    console.log(`[Generate] ${slug} (${group.commits.length} commits)`);

    const commitData = formatCommitData(group, config.defaults.maxDiffLines);

    if (dryRun) {
      console.log(`  [Dry Run] Would generate post for ${slug}`);
      console.log(`  Commit data preview (first 500 chars):\n${commitData.slice(0, 500)}\n`);
      generated.push(slug);
      continue;
    }

    const post = await generateBlogPost(displayName, commitData);

    // Derive tags from commit messages and file paths
    const autoTags = deriveTagsFromCommits(group);
    const tags = [repo, ...autoTags];

    const frontmatter = buildFrontmatter(post, repo, displayName, group, tags);
    const filePath = resolve(blogDir, `${slug}.md`);

    writeFileSync(filePath, frontmatter + post.content);
    console.log(`  → Saved: ${filePath}`);

    log[slug] = { shas, generatedAt: new Date().toISOString() };
    saveGeneratedLog(log);

    generated.push(slug);
  }

  return generated;
}

function deriveTagsFromCommits(group: CommitGroup): string[] {
  const tags = new Set<string>();

  for (const commit of group.commits) {
    const msg = commit.message.toLowerCase();

    // Conventional commit types
    if (msg.startsWith('feat')) tags.add('feature');
    if (msg.startsWith('fix')) tags.add('bugfix');
    if (msg.startsWith('refactor')) tags.add('refactoring');
    if (msg.startsWith('test')) tags.add('testing');
    if (msg.startsWith('docs')) tags.add('docs');
    if (msg.startsWith('style')) tags.add('style');
    if (msg.startsWith('chore')) tags.add('chore');

    // Tech keywords from file extensions
    for (const file of commit.files) {
      if (file.filename.endsWith('.tsx') || file.filename.endsWith('.jsx')) tags.add('react');
      if (file.filename.endsWith('.vue')) tags.add('vue');
      if (file.filename.endsWith('.py')) tags.add('python');
      if (file.filename.endsWith('.go')) tags.add('go');
      if (file.filename.endsWith('.rs')) tags.add('rust');
    }
  }

  return [...tags].slice(0, 5);
}
