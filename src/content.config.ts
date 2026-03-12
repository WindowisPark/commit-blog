import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    repo: z.string(),
    repoDisplayName: z.string().optional(),
    tags: z.array(z.string()).default([]),
    commits: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };
