// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://WindowisPark.github.io',
  base: '/commit-blog',
  vite: {
    plugins: [tailwindcss()],
  },
});
