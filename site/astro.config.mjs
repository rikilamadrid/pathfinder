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
        // What actually makes the site installable. The manifest is hand-written
        // and committed at `public/manifest.webmanifest` — unlike the brand
        // files beside it, it is not a copy of anything in `assets/`, so it is
        // the one tracked file in that directory. Its paths are root-relative,
        // which is what lets a preview deployment serve a manifest that is
        // correct for its own origin.
        { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' } },
        // iOS reads neither the manifest's icons nor an SVG favicon. Without
        // this line an add-to-home-screen gets a screenshot of the page.
        {
          tag: 'link',
          attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon-180.png', sizes: '180x180' },
        },
        // Must agree with `theme_color` in the manifest, and does. Blaze orange
        // is the mark's colour and the only brand value that is not one of the
        // two page grounds, so it reads as identity in both themes instead of
        // impersonating the background of one of them. `background_color` in the
        // manifest is white, matching the ground the opaque icons are drawn on,
        // so the splash screen and the icon on it share one surface.
        { tag: 'meta', attrs: { name: 'theme-color', content: '#E0611F' } },
        // The name iOS proposes in Add to Home Screen. Without it Safari falls
        // back to the document title of whatever page the reader happened to be
        // on, so adding from a deep page proposes "Getting started |
        // Pathfinder". Fixing the landing page's title only fixed the landing
        // page; this is site-wide and is what iOS actually reads. It must agree
        // with the manifest's `short_name`, and the postbuild check asserts it
        // on a deep page as well as the landing page.
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'Pathfinder' } },
      ],
      customCss: ['./src/styles/brand.css'],
      // Wraps Starlight's own footer rather than replacing it — see the
      // component. A reader who lands on a deep page from a search result
      // otherwise has no link back to the repository the site is generated from.
      components: {
        Footer: './src/components/Footer.astro',
      },
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
