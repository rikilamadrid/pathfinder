import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(
  new URL('../../../skills/blog-post-redactor/engine/bin/blog-post.mjs', import.meta.url),
);

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const cli = (cwd, ...args) => spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8' });

/** A real repository with real history, because the guarantee is about git. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'blog-posts-'));

  git(dir, 'init', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');

  writeFileSync(join(dir, 'README.md'), '# Thing\n\n## Usage\n');
  writeFileSync(join(dir, 'CHANGELOG.md'), '## [Unreleased]\n\n### Added\n- a stage\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'chore: initial');
  git(dir, 'tag', 'v1.0.0');

  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'test'));
  writeFileSync(join(dir, 'src/stage.mjs'), 'export const stage = 1;\n');
  writeFileSync(join(dir, 'test/stage.test.mjs'), 'import "node:test";\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'feat: add the stage');

  return dir;
}

const snapshot = (dir) => ({
  log: git(dir, 'log', '--format=%H %s').stdout,
  refs: git(dir, 'show-ref').stdout,
  status: git(dir, 'status', '--porcelain').stdout,
  readme: readFileSync(join(dir, 'README.md'), 'utf8'),
  source: readFileSync(join(dir, 'src/stage.mjs'), 'utf8'),
});

test('collect reads a real repository and changes nothing in it', () => {
  const dir = repo();
  try {
    const before = snapshot(dir);
    const result = cli(dir, 'collect', '--since', 'v1.0.0');

    assert.equal(result.status, 0, result.stderr);

    const bundle = JSON.parse(readFileSync(join(dir, 'blog-posts/evidence.json'), 'utf8'));
    assert.equal(bundle.range, 'v1.0.0..HEAD');
    assert.equal(bundle.commits.length, 1);
    assert.equal(bundle.commits[0].subject, 'feat: add the stage');
    assert.ok(bundle.files.some((file) => file.path === 'src/stage.mjs'));
    assert.equal(bundle.tests.length, 1);
    assert.equal(bundle.changelog.sections[0].heading, '[Unreleased]');

    const after = snapshot(dir);
    assert.equal(after.log, before.log, 'git history was rewritten');
    assert.equal(after.refs, before.refs, 'refs changed');
    assert.equal(after.readme, before.readme, 'a source file was modified');
    assert.equal(after.source, before.source, 'a source file was modified');

    // The only new path is the output directory.
    const changed = after.status.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
    assert.deepEqual(changed, ['blog-posts/']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify refuses to run before evidence has been collected', () => {
  const dir = repo();
  try {
    const result = cli(dir, 'verify');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /run `collect` first/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify fails a run whose article outruns its evidence', () => {
  const dir = repo();
  try {
    // A free-text scope resolves to no range, so the bundle records a gap and
    // collects no commits. An article claiming high confidence on top of that
    // is exactly the run this stage exists to stop.
    cli(dir, 'collect', 'An unpinned release name');

    writeFileSync(join(dir, 'blog-posts/article.md'),
      '# Thing\n\nIt tripled throughput [NEEDS HUMAN CONFIRMATION].\n');
    writeFileSync(join(dir, 'blog-posts/evidence.md'),
      'Landed in `pr:4242`.\n');
    writeFileSync(join(dir, 'blog-posts/metadata.json'), `${JSON.stringify({
      title: 'Thing', slug: 'thing', summary: 's', angle: 'a',
      scope: 'An unpinned release name',
      evidenceConfidence: 'high',
      needsHumanConfirmation: [],
    }, null, 2)}\n`);

    const result = cli(dir, 'verify');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /source-resolves/);
    assert.match(result.stdout, /confirmation-listed/);
    assert.match(result.stdout, /confidence-matches-evidence/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify passes an honest run', () => {
  const dir = repo();
  try {
    cli(dir, 'collect', '--since', 'v1.0.0');
    const bundle = JSON.parse(readFileSync(join(dir, 'blog-posts/evidence.json'), 'utf8'));
    const sha = bundle.commits[0].sha.slice(0, 8);

    writeFileSync(join(dir, 'blog-posts/article.md'),
      '# The stage\n\nA stage was added, with a test beside it.\n');
    writeFileSync(join(dir, 'blog-posts/evidence.md'),
      `Added in \`commit:${sha}\`, touching \`diff:src/stage.mjs\`.\n`);
    writeFileSync(join(dir, 'blog-posts/metadata.json'), `${JSON.stringify({
      title: 'The stage', slug: 'the-stage', summary: 's', angle: 'a',
      scope: 'commits since v1.0.0',
      evidenceConfidence: 'medium',
      needsHumanConfirmation: [],
    }, null, 2)}\n`);

    const result = cli(dir, 'verify');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the engine refuses a scope it cannot parse rather than inventing one', () => {
  const dir = repo();
  try {
    const result = cli(dir, 'collect', '--pr', 'not-a-number');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /numeric pull request id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
