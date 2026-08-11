import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// Chunk 1: site-local pages only, loaded from `src/content/docs`. Chunk 2
// composes this with a loader that reads `skills/*/SKILL.md` from the kit at
// the repository root, in place and without copying.
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
