import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, it } from 'node:test';
import { canonicalPageInputs } from '../src/canonical-inputs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = [];
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'pathfinder-site-inputs-'));
  temporary.push(root);
  return root;
}
after(() => { for (const root of temporary) rmSync(root, { recursive: true, force: true }); });
function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(root, path, body) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
}
function init(root) {
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.com');
}
function commit(root) {
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'canonical inputs');
}
function fixture() {
  const root = scratch();
  init(root);
  for (const file of ['skills/one/SKILL.md', 'context/ai-interaction.md', 'context/history.md',
    'context/improvement-ledger.md', 'site/src/content/docs/index.md',
    'site/src/content/docs/_draft.md', 'site/src/content/docs/.hidden.md']) write(root, file, '# Example\n');
  write(root, '.gitignore', '/context/current-ticket.md\n/skills/ignored/\n');
  commit(root);
  return root;
}

it('uses HEAD membership across all sources, retaining the existing publication policy', () => {
  const root = fixture();
  const before = canonicalPageInputs(root);
  assert.deepEqual(before.skills, ['one/SKILL.md']);
  assert.deepEqual(before.context, ['ai-interaction.md', 'history.md']);
  assert.deepEqual(before.docs, ['index.md']);
  for (const file of ['context/current-ticket.md', 'context/untracked/note.md',
    'skills/ignored/SKILL.md', 'skills/untracked/SKILL.md', 'site/src/content/docs/local.md'])
    write(root, file, 'invalid local frontmatter is never read');
  assert.equal(git(root, 'check-ignore', 'context/current-ticket.md'), 'context/current-ticket.md');
  write(root, 'context/staged.md', '# Staged but uncommitted\n');
  git(root, 'add', 'context/staged.md');
  assert.deepEqual(canonicalPageInputs(root), before);
  write(root, 'context/ai-interaction.md', '# Existing page can be edited\n');
  assert.deepEqual(canonicalPageInputs(root), before);
});

it('includes committed additions and removes committed deletions', () => {
  const root = fixture();
  write(root, 'context/new.md', '# New\n');
  commit(root);
  assert.ok(canonicalPageInputs(root).context.includes('new.md'));
  git(root, 'rm', '--quiet', 'context/new.md');
  assert.throws(() => canonicalPageInputs(root), /Committed site input is missing/);
  git(root, 'commit', '--quiet', '-m', 'remove page');
  assert.equal(canonicalPageInputs(root).context.includes('new.md'), false);
});

it('fails clearly without Git metadata or a committed input instead of reporting a smaller local count', () => {
  assert.throws(() => canonicalPageInputs(scratch()), /require a Git checkout with a HEAD commit/);
  const root = fixture();
  rmSync(join(root, 'skills/one/SKILL.md'));
  assert.throws(() => canonicalPageInputs(root), /Committed site input is missing: skills\/one\/SKILL.md/);
});

it('works from a linked worktree without depending on the invoking cwd', () => {
  const root = fixture();
  const linked = join(scratch(), 'linked');
  git(root, 'worktree', 'add', '--quiet', '--detach', linked, 'HEAD');
  assert.deepEqual(canonicalPageInputs(linked), canonicalPageInputs(root));
});

it('builds identical routes and sidebar content despite local files and stale Astro content state', () => {
  const root = scratch();
  const archive = execFileSync('git', ['archive', 'HEAD'], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', root], { input: archive });
  for (const file of ['site/src/canonical-inputs.mjs', 'site/src/loaders/kit.mjs', 'site/src/nav.mjs'])
    cpSync(join(ROOT, file), join(root, file));
  // Include a literal glob metacharacter in a committed filename. An untracked
  // glob near-match below must neither add a route nor replace this document.
  write(root, 'site/src/content/docs/guides/probe[95].md', '---\ntitle: Committed probe\n---\nCommitted body.\n');
  init(root);
  commit(root);
  cpSync(join(ROOT, 'site/node_modules'), join(root, 'site/node_modules'), {
    recursive: true, filter: (path) => !path.split('/').includes('.vite'),
  });
  const site = join(root, 'site');
  execFileSync(process.execPath, ['scripts/sync-brand.mjs'], { cwd: site, stdio: 'pipe' });
  function build() {
    // Direct Astro CLI avoids recursively invoking npm's prebuild test hook.
    const result = spawnSync(process.execPath, [join(site, 'node_modules/astro/astro.js'), 'build'], {
      cwd: site, encoding: 'utf8', timeout: 60000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    execFileSync(process.execPath, ['scripts/check-manifest.mjs'], { cwd: site, stdio: 'pipe' });
    const pages = new Map();
    function walk(dir, prefix = '') {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = prefix + entry.name;
        if (entry.isDirectory()) walk(join(dir, entry.name), path + '/');
        else if (entry.name.endsWith('.html')) pages.set(path, readFileSync(join(dir, entry.name), 'utf8'));
      }
    }
    walk(join(site, 'dist'));
    return pages;
  }
  const clean = build();
  assert.ok([...clean.values()].some((page) => page.includes('Committed body.')));
  const probes = {
    'context/current-ticket.md': '# PRIVATE-95\nLocal session state\n',
    'context/handoff.md': '# PRIVATE-95\nLocal handoff\n',
    'context/tracker.md': '# PRIVATE-95\nLocal tracker\n',
    'context/local-95/note.md': '# PRIVATE-95\nLocal note\n',
    'skills/local-95/SKILL.md': '---\nthis is invalid: [\n---\nPRIVATE-95',
    'site/src/content/docs/local-95.md': '---\nthis is invalid: [\n---\nPRIVATE-95',
    'site/src/content/docs/guides/probe9.md': '---\ntitle: PRIVATE-95\n---\nLocal glob near-match.\n',
  };
  const canonicalCommit = git(root, 'rev-parse', 'HEAD');
  // Seed Astro's cache with pages belonging to a different commit. Returning
  // to the canonical commit must retire them, even if local copies remain.
  write(root, 'context/previous-page.md', '# Previous page\n');
  write(root, 'site/src/content/docs/previous-page.md', '---\ntitle: Previous page\n---\nPrevious body.\n');
  commit(root);
  assert.equal(build().size, clean.size + 2);
  git(root, 'checkout', '--quiet', '--detach', canonicalCommit);
  write(root, 'context/previous-page.md', '# PRIVATE-95\n');
  write(root, 'site/src/content/docs/previous-page.md', '---\ntitle: PRIVATE-95\n---\nPrivate body.\n');
  for (const [path, contents] of Object.entries(probes)) write(root, path, contents);
  const polluted = build();
  assert.deepEqual([...polluted.keys()].sort(), [...clean.keys()].sort());
  for (const [path, html] of polluted) {
    assert.equal(html.includes('PRIVATE-95'), false, path);
    // This includes the sidebar, generated skill index and every page body.
    assert.equal(html, clean.get(path), path);
  }
  for (const [path, contents] of Object.entries(probes)) assert.equal(readFileSync(join(root, path), 'utf8'), contents);
  assert.equal(existsSync(join(site, 'dist/context/improvement-ledger/index.html')), false);
  assert.equal(existsSync(join(site, 'dist/context/history/index.html')), true);
});
