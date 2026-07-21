// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://WindowisPark.github.io',
  base: '/commit-blog',
  markdown: {
    shikiConfig: {
      // 라이트/다크 각각의 코드 하이라이팅 테마 (global.css에서 CSS 변수로 전환)
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
