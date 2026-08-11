// Renders the kit — `skills/` and `context/` — from where it actually lives.
//
// The kit at the repository root is the single source of truth. Copying those
// files into `site/` would be the obvious way to get these pages and is exactly
// the drift this project warns about elsewhere: every edit would need a second
// commit, and the copies would rot quietly. So the site reads the real files in
// place, through an Astro content-layer loader.
//
// The rule this file exists to hold: **the site adapts Pathfinder content for
// presentation; it never becomes the canonical source of it.** Nothing here
// rewrites meaning, invents prose, or asks a kit file to change shape. Where the
// two disagree, the kit wins and the site adapts.
//
// Two things make that possible without touching a single kit file:
//
//   1. `vite.server.fs.allow: ['..']` in `astro.config.mjs`, which lets the dev
//      server read above the site root.
//   2. Two small, separate shims. Skills carry `name` and `description`,
//      because that is what an agent needs to discover them; Starlight wants
//      `title`. Context files carry no frontmatter at all, so their title comes
//      from their own H1. Neither shim reaches back into the kit — a skill
//      edited to please the site would break feature 02's validation and, more
//      importantly, agent discovery in every destination project.
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
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '@astrojs/markdown-remark';
import { docsLoader } from '@astrojs/starlight/loaders';
import { WORKFLOW_LOOPS } from '../nav.mjs';

const SKILL_FILE = 'SKILL.md';

/** Where the generated skill index lands. `/skills/` — the index of the section. */
const REFERENCE_ID = 'skills';

/**
 * The skill index, generated from what was just read off disk.
 *
 * The spec asks for a reference "generated from `skills/`, never hand-copied",
 * and this is the literal form of that: every name, link, and one-line summary
 * below comes from the frontmatter of the file it names, in the same pass that
 * built the skill pages themselves. There is no second list to update. A skill
 * whose description changes changes here; a skill added to the kit appears here
 * whether or not anyone remembers this file exists.
 *
 * What is *not* generated is the loop grouping and the boundary blocks, which
 * are editorial claims declared in `nav.mjs` — see the note there. Anything a
 * group does not claim is still listed, under an honestly-named heading, for the
 * same reason the sidebar does it: a missing skill must be visible, not silent.
 *
 * @param {Map<string, { name: string, description: string }>} skills
 * @returns {string} markdown
 */
function buildSkillReference(skills) {
  const entry = (name) =>
    `- [\`${name}\`](/skills/${name}/) — ${skills.get(name).description}`;

  const claimed = new Set(WORKFLOW_LOOPS.flatMap((loop) => loop.skills));
  const unclaimed = [...skills.keys()].filter((name) => !claimed.has(name));

  const sections = WORKFLOW_LOOPS.filter((loop) =>
    loop.skills.some((name) => skills.has(name))
  ).map((loop) => {
    const body = [`## ${loop.label}`, ''];
    if (loop.boundary) {
      body.push('```text', ...loop.boundary, '```', '');
    }
    body.push(...loop.skills.filter((name) => skills.has(name)).map(entry), '');
    return body.join('\n');
  });

  if (unclaimed.length > 0) {
    sections.push(['## Ungrouped skills', '', ...unclaimed.map(entry), ''].join('\n'));
  }

  return [
    'Every skill in the kit, grouped by the loop it runs in. Each summary is the',
    "skill's own `description`, read from `skills/<name>/SKILL.md` when this page",
    'was built — the page holds no copy of it. Follow a link for the skill itself,',
    'which is the file your agent reads.',
    '',
    'Where two neighboring skills are easy to confuse, the boundary between them',
    'is stated above the group.',
    '',
    ...sections,
  ].join('\n');
}

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
  const leading = leadingHeading(content);
  if (!leading) return content;
  const normalized = leading.text.toLowerCase().replace(/\s+/g, '-');
  if (normalized !== name) return content;
  return leading.rest;
}

/**
 * The opening H1 of a document, if it has one. Only the very first heading is a
 * candidate, so the body is read from its first non-whitespace character rather
 * than searched anywhere.
 *
 * @returns {{ text: string, rest: string } | null}
 */
function leadingHeading(content) {
  const body = content.replace(/^\s+/, '');
  const match = /^#[ \t]+(.+?)[ \t]*(\n|$)/.exec(body);
  if (!match) return null;
  return { text: match[1], rest: body.slice(match[0].length).replace(/^\n+/, '') };
}

/** Every `.md` file under a directory, depth-first, as paths relative to it. */
async function markdownFiles(root, prefix = '') {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const found = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await markdownFiles(root, path)));
    else if (extname(entry.name) === '.md') found.push(path);
  }
  return found;
}

/**
 * Composes Starlight's own loader for site-local pages with the kit's two
 * content sources: `skills/` and `context/`.
 *
 * Order matters and is not cosmetic: Astro's glob loader — which is what
 * `docsLoader()` is — deletes every store entry it did not itself touch during
 * its load. Running it second would silently wipe every kit page. It runs
 * first, and the kit is added afterwards.
 *
 * @param {{ skillsDir: string, contextDir: string }} options
 */
export function kitDocsLoader({ skillsDir, contextDir }) {
  const skillsRoot = resolve(skillsDir);
  const contextRoot = resolve(contextDir);
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

      /**
       * Writes one kit file into the store. Both sources share this; only the
       * decision about title and description differs between them, and that
       * decision is made by the caller.
       */
      const publish = async ({ id, file, raw, title, description, body }) => {
        const data = await parseData({
          id,
          // The shims, in full. Everything else Starlight understands is left
          // at its default rather than being synthesised here.
          data: description ? { title, description } : { title },
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
      };

      /**
       * Ids each source owns, so a re-sync retires only what actually vanished.
       * Never `store.clear()`: that would take the site-local pages, and the
       * other source, down with it.
       */
      const owned = { skills: new Set(), context: new Set() };

      const retire = (source, present) => {
        for (const id of owned[source]) {
          if (!present.has(id)) store.delete(id);
        }
        owned[source] = present;
        return present.size;
      };

      /**
       * Skills. One directory each, and the frontmatter an agent already needs
       * for discovery — `name` and `description` — is what the page is built
       * from.
       */
      const syncSkills = async () => {
        const present = new Set();
        const summaries = new Map();

        const dirs = (await readdir(skillsRoot, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map((entry) => entry.name)
          .sort();

        for (const dir of dirs) {
          const file = join(skillsRoot, dir, SKILL_FILE);
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
              `${relative(skillsRoot, file)} is missing frontmatter \`name\` or \`description\`. ` +
                `The site reads skills in place and cannot invent them; fix the skill, not the site.`
            );
          }

          const id = `skills/${dir}`;
          present.add(id);
          summaries.set(frontmatter.name, {
            name: frontmatter.name,
            description: frontmatter.description,
          });
          await publish({
            id,
            file,
            raw,
            title: frontmatter.name,
            description: frontmatter.description,
            body: stripRedundantHeading(content, frontmatter.name),
          });
        }

        // The index is generated in the same pass, from the same frontmatter, so
        // it cannot describe a kit that is not the one just loaded. Its source is
        // the directory rather than a file, because that is the truth: it has no
        // file, and pointing `filePath` at a plausible one would be a small lie
        // in every error message that mentions it.
        const reference = buildSkillReference(summaries);
        present.add(REFERENCE_ID);
        await publish({
          id: REFERENCE_ID,
          file: skillsRoot,
          raw: reference,
          title: 'All skills',
          description:
            'Every skill in the kit, grouped by workflow loop, summarized from its own frontmatter.',
          body: reference,
        });

        retire('skills', present);
        // The count is the skills, not the store entries — the generated index
        // is not a twenty-first skill and a log line that implies it is would be
        // the first thing to mislead someone counting.
        return summaries.size;
      };

      /**
       * Project context. A deliberately smaller shim than the skills one: these
       * files carry no frontmatter at all, and requiring them to grow some
       * would make the site the reason a kit file changed — which is the one
       * thing this loader exists to avoid. The title is the document's own H1,
       * and that H1 is then dropped from the body because Starlight has already
       * rendered it. A file with no H1 keeps its path as the title rather than
       * having a prettier one invented for it.
       *
       * There is no description: these files do not state one, and a summary
       * written here would be site-authored content masquerading as kit
       * content.
       */
      const syncContext = async () => {
        const present = new Set();

        for (const path of await markdownFiles(contextRoot)) {
          const file = join(contextRoot, path);
          const raw = await readFile(file, 'utf8');
          const heading = leadingHeading(raw);

          const id = `context/${path.replace(/\.md$/, '')}`;
          present.add(id);
          await publish({
            id,
            file,
            raw,
            title: heading ? heading.text : path.replace(/\.md$/, ''),
            body: heading ? heading.rest : raw,
          });
        }

        return retire('context', present);
      };

      logger.info(`Loaded ${await syncSkills()} skills from ${fromRoot(skillsRoot)}`);
      logger.info(`Loaded ${await syncContext()} context pages from ${fromRoot(contextRoot)}`);

      if (!watcher) return;

      // Live reload has to be wired by hand, and the obvious version does not
      // work. `watcher.add(root)` alone makes chokidar emit events for these
      // files, but nothing re-runs the loader: editing a skill changed nothing
      // and a newly added one 404'd. The handlers below are what actually
      // rebuild the store. Astro's own glob watcher ignores anything relative
      // to it that starts with `../`, so it never competes for these paths.
      watcher.add(skillsRoot);
      watcher.add(contextRoot);

      const onChange = (path) => {
        const resolved = resolve(path);
        const source = resolved.startsWith(skillsRoot + sep)
          ? { name: 'skills', root: skillsRoot, sync: syncSkills }
          : resolved.startsWith(contextRoot + sep)
            ? { name: 'context', root: contextRoot, sync: syncContext }
            : null;
        if (!source) return;

        source
          .sync()
          .then(() =>
            logger.info(`Reloaded ${source.name} after change to ${relative(source.root, path)}`)
          )
          .catch((error) => logger.error(String(error)));
      };

      watcher.on('change', onChange);
      watcher.on('add', onChange);
      watcher.on('unlink', onChange);
    },
  };
}
