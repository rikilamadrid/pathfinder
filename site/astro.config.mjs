// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// The site reads the kit from the repository root, one directory up. Astro and
// Vite both refuse to serve files outside the project root by default, so the
// parent is allowed explicitly. This is what lets `logo.src` below — and, from
// chunk 2, the skills content loader — point at real files instead of copies.
export default defineConfig({
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
      // Navigation is filled in with real skill pages in chunk 3. The shell
      // deliberately ships with none rather than with placeholder entries.
      sidebar: [],
    }),
  ],
});
