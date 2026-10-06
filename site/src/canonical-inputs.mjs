// Page membership comes from the committed repository, never local discovery.
// Bodies remain readable in place so edits to existing pages can be previewed.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isUnpublished } from './unpublished.mjs';

const DOCS_ROOT = 'site/src/content/docs/';
// Same extensions as the pinned Starlight docsLoader; selection is narrower,
// while Astro's glob loader still owns IDs, frontmatter, rendering and watching.
const DOC_EXTENSION = /\.(markdown|mdown|mkdn|mkd|mdwn|md|mdx)$/;
const visible = (path) => !path.split('/').some((part) => part.startsWith('.'));

export function canonicalPageInputs(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  let commit;
  let paths;
  try {
    commit = git('rev-parse', '--verify', 'HEAD^{commit}');
    paths = git('ls-tree', '-r', '--name-only', '-z', commit, '--',
      'skills', 'context', 'site/src/content/docs').split('\0').filter(Boolean).sort();
  } catch (error) {
    throw new Error('Canonical site inputs require a Git checkout with a HEAD commit. ' +
      'Refusing to count working-tree files as repository evidence.', { cause: error });
  }
  const skills = paths.filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path) && visible(path));
  const context = paths.filter((path) => path.startsWith('context/') && path.endsWith('.md') &&
    visible(path) && !isUnpublished(path.replace(/\.md$/, '')));
  const docs = paths.filter((path) => path.startsWith(DOCS_ROOT) && DOC_EXTENSION.test(path) &&
    visible(path) && !basename(path).startsWith('_'));
  for (const path of [...skills, ...context, ...docs]) {
    try {
      if (!statSync(join(root, path)).isFile()) throw new Error('not a file');
    } catch (error) {
      throw new Error(`Committed site input is missing: ${path}. Restore it or commit its removal.`, { cause: error });
    }
  }
  return {
    commit,
    skills: skills.map((path) => path.slice('skills/'.length)),
    context: context.map((path) => path.slice('context/'.length)),
    docs: docs.map((path) => path.slice(DOCS_ROOT.length)),
  };
}

/** Literal filenames, not patterns that can accidentally match local files. */
export const literalGlob = (path) => path.replace(/([\\*?\[\]{}()!+@])/g, '\\$1');
