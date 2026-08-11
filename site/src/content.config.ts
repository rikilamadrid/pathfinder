import { fileURLToPath } from 'node:url';
import { defineCollection } from 'astro:content';
import { docsSchema } from '@astrojs/starlight/schema';
import { kitDocsLoader } from './loaders/kit.mjs';

// Resolved against this file rather than the working directory, so the site
// builds the same whether it is started from `site/` or from the repository
// root with `--root site`.
const skillsDir = fileURLToPath(new URL('../../skills', import.meta.url));

// Site-local pages and the kit's skills share one collection. The skills are
// read from `skills/` at the repository root, in place — nothing is copied into
// `site/`, and no `SKILL.md` is modified to suit the site. See the long note in
// `src/loaders/kit.mjs` for why, and for what it depends on.
export const collections = {
  docs: defineCollection({
    loader: kitDocsLoader({ skillsDir }),
    schema: docsSchema(),
  }),
};
