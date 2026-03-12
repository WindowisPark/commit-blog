import { z } from 'zod';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const RepoSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  displayName: z.string(),
  groupBy: z.enum(['date', 'pr', 'branch']).optional(),
  excludePaths: z.array(z.string()).optional(),
});

const DefaultsSchema = z.object({
  groupBy: z.enum(['date', 'pr', 'branch']).default('date'),
  language: z.string().default('ko'),
  maxDiffLines: z.number().default(500),
});

const ConfigSchema = z.object({
  repos: z.array(RepoSchema).min(1),
  defaults: DefaultsSchema,
});

export type RepoConfig = z.infer<typeof RepoSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const configPath = resolve(process.cwd(), 'repos.config.json');
  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  return ConfigSchema.parse(raw);
}

export function getRepoConfig(config: Config, repoName?: string): RepoConfig[] {
  if (!repoName) return config.repos;
  const filtered = config.repos.filter((r) => r.repo === repoName);
  if (filtered.length === 0) {
    throw new Error(`Repo "${repoName}" not found in config`);
  }
  return filtered;
}
