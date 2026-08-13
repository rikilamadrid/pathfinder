// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { buildSidebar } from './src/nav.mjs';

const skillsDir = fileURLToPath(new URL('../skills', import.meta.url));
const contextDir = fileURLToPath(new URL('../context', import.meta.url));

// The site reads the kit from the repository root, one directory up. Astro and
// Vite both refuse to serve files outside the project root by default, so the
// parent is allowed explicitly. This is what lets `logo.src` below — and, from
// chunk 2, the skills content loader — point at real files instead of copies.
export default defineConfig({
  // The deployed origin. Starlight's bundled sitemap integration skips itself
  // without this and says so on every build, and canonical URLs need an origin
  // to be absolute against. This is the production alias, not the per-deployment
  // URL Vercel also assigns — a preview build emits canonical links pointing at
  // production, which is the correct answer for a preview of production content.
  site: 'https://pathfinder-kit.vercel.app',
  srcDir: './src',
  vite: {
    server: {
      fs: { allow: ['..'] },
    },
  },
  integrations: [
    starlight({
      title: 'Pathfinder',
      description:
        'An AI-assisted, human-in-the-loop workflow for building software — without giving up the decisions.',
      logo: {
        // Imported straight from the repository's single `assets/` directory
        // and processed by Vite. No copy exists anywhere under `site/`.
        src: '../assets/logo-wordmark.svg',
        replacesTitle: true,
      },
      favicon: '/favicon.svg',
      head: [
        {
          tag: 'link',
          attrs: { rel: 'icon', href: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
        },
      ],
      customCss: ['./src/styles/brand.css'],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/rikilamadrid/pathfinder',
        },
      ],
      // Grouped by the five workflow loops the README defines. Built from what
      // is on disk, so a new skill cannot go missing — see `src/nav.mjs`.
      // Read at config load, so a skill added while the dev server is running
      // reaches its page immediately but enters the sidebar on restart.
      sidebar: buildSidebar({ skillsDir, contextDir }),
    }),
  ],
});
