import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  collect, assertReadOnlyGit, READ_ONLY_GIT,
} from '../../../skills/blog-post-redactor/engine/collect.mjs';

// The same unit and record separators `collect.mjs` asks git for. Built from
// char codes rather than written literally so the file stays readable in a
// terminal and a diff.
const FIELD = String.fromCharCode(0x1f);
const RECORD = String.fromCharCode(0x1e);

/** A fake repository. Nothing here touches a real one, on purpose. */
function fakeIo({ commits = [], numstat = '', files = {}, gh = null } = {}) {
  const calls = [];

  const log = commits
    .map((c) => [
      c.sha,
      c.author ?? 'A',
      c.date ?? '2026-01-01T00:00:00Z',
      c.subject,
      c.body ?? '',
    ].join(FIELD) + RECORD)
    .join('');

  const run = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));

    if (cmd === 'gh') {
      return gh ? { status: 0, stdout: JSON.stringify(gh) } : { status: 1, stdout: '' };
    }
    if (cmd !== 'git') return { status: 1, stdout: '' };

    const [sub] = args;
    if (sub === 'rev-parse' && args.includes('HEAD')) return { status: 0, stdout: 'deadbeef\n' };
    if (sub === 'rev-parse') return { status: 0, stdout: 'ref\n' };
    if (sub === 'symbolic-ref') return { status: 0, stdout: 'refs/remotes/origin/main\n' };
    if (sub === 'merge-base') return { status: 0, stdout: 'basesha\n' };
    if (sub === 'log') return { status: 0, stdout: log };
    if (sub === 'diff') return { status: 0, stdout: numstat };
    return { status: 1, stdout: '' };
  };

  return {
    calls,
    run,
    readFile: (path) => (path in files ? files[path] : null),
    exists: (path) => path in files,
  };
}

test('the git allowlist is the read-only guarantee, not a convention', () => {
  for (const sub of READ_ONLY_GIT) assert.ok(assertReadOnlyGit([sub]));

  for (const forbidden of ['commit', 'push', 'add', 'checkout', 'reset', 'rebase', 'tag', 'stash']) {
    assert.throws(() => assertReadOnlyGit([forbidden]), /read-only/,
      `git ${forbidden} must be refused`);
  }
});

test('a read-only subcommand with a writing flag is still refused', () => {
  assert.ok(assertReadOnlyGit(['config', '--get', 'user.name']));
  assert.throws(() => assertReadOnlyGit(['config', '--unset', 'user.name']), /read-only/);
  assert.throws(() => assertReadOnlyGit(['config', '--add', 'x', 'y']), /read-only/);
});

test('collect never issues a writing git command', () => {
  const io = fakeIo({ commits: [{ sha: 'a1b2c3d4', subject: 'feat: a thing (#12)' }] });
  collect({ ...io, argv: [] });

  const gitCalls = io.calls.filter((call) => call.startsWith('git '));
  assert.ok(gitCalls.length > 0, 'the fake repository was never consulted');

  for (const call of gitCalls) {
    const sub = call.split(' ')[1];
    assert.ok(READ_ONLY_GIT.has(sub), `unexpected git subcommand in: ${call}`);
  }
});

test('a populated range produces commits, files, tests and a changelog', () => {
  const io = fakeIo({
    commits: [{ sha: 'a1b2c3d4e5', subject: 'feat: add a stage (#12)', body: 'why it was needed' }],
    numstat: '10\t2\tsrc/stage.mjs\n4\t0\ttest/stage.test.mjs\n',
    files: {
      'CHANGELOG.md': '## [Unreleased]\n\n### Added\n- a stage\n\n## [1.0.0] - 2026-01-01\n',
      'README.md': '# Project\n\n## Usage\n',
    },
  });

  const bundle = collect({ ...io, argv: [] });

  assert.equal(bundle.commits.length, 1);
  assert.equal(bundle.commits[0].sha, 'a1b2c3d4e5');
  assert.equal(bundle.commits[0].body, 'why it was needed');
  assert.equal(bundle.files.length, 2);
  assert.equal(bundle.tests.length, 1);
  assert.equal(bundle.changelog.sections[0].heading, '[Unreleased]');
  assert.deepEqual(bundle.changelog.sections[0].entries, ['a stage']);
  assert.ok(bundle.docs.some((doc) => doc.path === 'README.md'));
});

test('incomplete evidence is recorded, not filled in', () => {
  const io = fakeIo({
    commits: [{ sha: 'a1b2c3d4', subject: 'chore: tidy' }],
    numstat: '1\t1\tsrc/only.mjs\n',
  });

  const bundle = collect({ ...io, argv: [] });

  assert.ok(bundle.missing.some((m) => m.includes('CHANGELOG')));
  assert.ok(bundle.missing.some((m) => m.includes('no test files')));
  assert.equal(bundle.changelog, null);
  assert.deepEqual(bundle.tests, []);
});

test('an empty range says so instead of inventing a story', () => {
  const bundle = collect({ ...fakeIo({}), argv: [] });
  assert.equal(bundle.commits.length, 0);
  assert.ok(bundle.missing.some((m) => m.includes('no commits found')));
});

test('a repository with no commits degrades to an empty bundle', () => {
  const io = {
    run: () => ({ status: 1, stdout: '' }),
    readFile: () => null,
    exists: () => false,
  };
  const bundle = collect({ ...io, argv: [] });

  assert.equal(bundle.head, null);
  assert.deepEqual(bundle.commits, []);
  assert.ok(bundle.missing.some((m) => m.includes('not a git repository')));
});

test('a free-text scope is carried as unresolved and recorded as a gap', () => {
  const bundle = collect({ ...fakeIo({}), argv: ['Pathfinder', '4.4.0'] });

  assert.equal(bundle.scope.kind, 'label');
  assert.equal(bundle.range, null);
  assert.ok(bundle.missing.some((m) => m.includes('not pinned to a git ref')));
});

test('a missing ref is a gap rather than a crash', () => {
  const io = fakeIo({});
  io.run = (cmd, args) => {
    if (args[0] === 'rev-parse' && args.includes('HEAD')) return { status: 0, stdout: 'deadbeef' };
    if (args[0] === 'rev-parse') return { status: 1, stdout: '' };
    return { status: 1, stdout: '' };
  };

  const bundle = collect({ ...io, argv: ['--since', 'v9.9.9'] });
  assert.ok(bundle.missing.some((m) => m.includes('does not exist')));
});

test('an unavailable host CLI warns and continues', () => {
  const io = fakeIo({ commits: [{ sha: 'a1b2c3d4', subject: 'feat: thing (#126)' }] });
  const bundle = collect({ ...io, argv: [] });

  assert.deepEqual(bundle.prs, []);
  assert.ok(bundle.warnings.some((w) => w.includes('#126')));
});

test('an available host CLI contributes the pull request', () => {
  const io = fakeIo({
    commits: [{ sha: 'a1b2c3d4', subject: 'feat: thing (#126)' }],
    gh: { number: 126, title: 'Add a thing', body: 'because X', state: 'MERGED' },
  });
  const bundle = collect({ ...io, argv: [] });

  assert.equal(bundle.prs.length, 1);
  assert.equal(bundle.prs[0].number, 126);
});
