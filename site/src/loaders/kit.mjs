// Renders the kit's skills from where they actually live.
//
// The kit at the repository root is the single source of truth. Copying
// `skills/*/SKILL.md` into `site/` would be the obvious way to get these pages
// and is exactly the drift this project warns about elsewhere: every skill edit
// would need a second commit, and the copies would rot quietly. So the site
// reads the real files in place, through an Astro content-layer loader.
//
// Two things make that possible without touching a single `SKILL.md`:
//
//   1. `vite.server.fs.allow: ['..']` in `astro.config.mjs`, which lets the dev
//      server read above the site root.
//   2. The frontmatter shim below. Skills carry `name` and `description`,
//      because that is what an agent needs to discover them. Starlight wants
//      `title`. The shim adapts the site to the kit, never the reverse — a
//      skill edited to please the site would break feature 02's validation and,
//      more importantly, agent discovery in every destination project.
//
// Astro APIs this depends on, all of which are why the version is pinned:
//
//   - `LoaderContext.renderMarkdown` — Astro 5.9+. Renders a body string that
//     never passed through Astro's own file pipeline.
//   - `LoaderContext.parseData` / `store` / `generateDigest` — the content
//     layer's stable loader surface.
//   - `parseFrontmatter` from `@astrojs/markdown-remark`, a direct dependency
//     of `astro`, used rather than adding a YAML parser for four lines of it.
//   - Starlight's `docsLoader()`, composed in below.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '@astrojs/markdown-remark';
import { docsLoader } from '@astrojs/starlight/loaders';

const SKILL_FILE = 'SKILL.md';

/**
 * Every skill opens with an H1 that restates its name — `# Challenge Me` under
 * `name: challenge-me`. That is right in the file, where nothing else announces
 * what you are reading, and wrong on the page, where Starlight has already
 * rendered the title as an H1. Left alone it renders two H1s, which is both a
 * visible duplicate and an accessibility fault.
 *
 * The heading is dropped only when it is genuinely redundant. A skill whose H1
 * says something the name does not keeps it, because that heading is carrying
 * information and this loader does not get to decide it is noise. The file is
 * never modified either way; this is a rendering decision.
 */
function stripRedundantHeading(content, name) {
  // Only the very first heading in the file is a candidate, so the body is
  // matched from its first non-whitespace character rather than anywhere.
  const body = content.replace(/^\s+/, '');
  const match = /^#[ \t]+(.+?)[ \t]*(\n|$)/.exec(body);
  if (!match) return content;
  const normalized = match[1].toLowerCase().replace(/\s+/g, '-');
  if (normalized !== name) return content;
  return body.slice(match[0].length).replace(/^\n+/, '');
}

/**
 * Composes Starlight's own loader for site-local pages with the kit's skills.
 *
 * Order matters and is not cosmetic: Astro's glob loader — which is what
 * `docsLoader()` is — deletes every store entry it did not itself touch during
 * its load. Running it second would silently wipe every skill page. It runs
 * first, and the skills are added afterwards.
 *
 * @param {{ skillsDir: string, slugPrefix?: string }} options
 */
export function kitDocsLoader({ skillsDir, slugPrefix = 'skills' }) {
  const root = resolve(skillsDir);
  const localPages = docsLoader();

  return {
    name: 'pathfinder-kit-loader',
    async load(context) {
      // Site-local pages first. See the note above.
      await localPages.load(context);

      const { store, parseData, renderMarkdown, generateDigest, watcher, logger, config } = context;

      // Paths are reported relative to the Astro project root, not the working
      // directory, so log lines and `filePath` read the same however the build
      // was invoked.
      const projectRoot = fileURLToPath(config.root);
      const fromRoot = (path) => relative(projectRoot, path).split(sep).join('/');

      /** Ids this loader owns, so a re-sync can retire the ones that vanished. */
      let owned = new Set();

      const syncSkills = async () => {
        const present = new Set();

        const dirs = (await readdir(root, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map((entry) => entry.name)
          .sort();

        for (const dir of dirs) {
          const file = join(root, dir, SKILL_FILE);
          try {
            await stat(file);
          } catch {
            // A directory under `skills/` without a SKILL.md is not this
            // loader's business to complain about — feature 02's validation
            // owns that rule, and duplicating it here would let the two drift.
            continue;
          }

          const raw = await readFile(file, 'utf8');
          const { frontmatter, content } = parseFrontmatter(raw);

          if (!frontmatter.name || !frontmatter.description) {
            throw new Error(
              `${relative(root, file)} is missing frontmatter \`name\` or \`description\`. ` +
                `The site reads skills in place and cannot invent them; fix the skill, not the site.`
            );
          }

          const id = `${slugPrefix}/${dir}`;
          present.add(id);

          const body = stripRedundantHeading(content, frontmatter.name);

          const data = await parseData({
            id,
            // The shim, in full. Everything else Starlight understands is left
            // at its default rather than being synthesised here.
            data: { title: frontmatter.name, description: frontmatter.description },
            filePath: file,
          });

          store.set({
            id,
            data,
            body,
            filePath: fromRoot(file),
            digest: generateDigest(raw),
            rendered: await renderMarkdown(body),
          });
        }

        for (const id of owned) {
          if (!present.has(id)) store.delete(id);
        }
        owned = present;

        return present.size;
      };

      const count = await syncSkills();
      logger.info(`Loaded ${count} skills from ${fromRoot(root)}`);

      if (!watcher) return;

      // Live reload has to be wired by hand, and the obvious version does not
      // work. `watcher.add(root)` alone makes chokidar emit events for these
      // files, but nothing re-runs the loader: editing a skill changed nothing
      // and a newly added one 404'd. The handlers below are what actually
      // rebuilds the store. Astro's own glob watcher ignores anything relative
      // to it that starts with `../`, so it never competes for these paths.
      watcher.add(root);

      const inKit = (path) => resolve(path).startsWith(root + sep);
      const onChange = (path) => {
        if (!inKit(path)) return;
        syncSkills()
          .then(() => logger.info(`Reloaded skills after change to ${relative(root, path)}`))
          .catch((error) => logger.error(String(error)));
      };

      watcher.on('change', onChange);
      watcher.on('add', onChange);
      watcher.on('unlink', onChange);
    },
  };
}
