import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSource, formatSource, extractSources, knownSources, resolves, SOURCE_TYPES,
} from '../../../skills/blog-post-redactor/engine/sources.mjs';

const BUNDLE = {
  commits: [{ sha: 'a1b2c3d4e5f6a7b8' }],
  files: [{ path: 'src/stage.mjs' }],
  prs: [{ number: 126 }],
  issues: [{ number: 55 }],
  docs: [{ path: 'context/history.md' }],
  changelog: { sections: [{ heading: '[Unreleased]' }] },
  tests: [{ path: 'packages/blog-post-redactor/test' }],
  commands: [{ command: 'git log v4.3.0..HEAD' }],
};

test('every declared type round-trips', () => {
  for (const type of SOURCE_TYPES) {
    const ref = formatSource(type, 'x');
    assert.equal(parseSource(ref).type, type);
  }
});

test('an undeclared type is not a source reference', () => {
  assert.equal(parseSource('rumour:someone said so'), null);
  assert.throws(() => formatSource('rumour', 'x'), /unknown source type/);
});

test('file references carry an optional line range', () => {
  assert.deepEqual(parseSource('file:README.md#L1-L20').lines, { from: 1, to: 20 });
  assert.deepEqual(parseSource('file:README.md#L7').lines, { from: 7, to: 7 });
  assert.equal(parseSource('file:README.md').lines, null);
  assert.equal(formatSource('file', 'README.md', { from: 1, to: 20 }), 'file:README.md#L1-L20');
});

test('a backwards line range is not a reference', () => {
  assert.equal(parseSource('file:README.md#L20-L1'), null);
});

test('references are extracted from prose in order, without duplicates', () => {
  const text = 'It landed in `commit:a1b2c3d4` and again in `commit:a1b2c3d4`, see `pr:126`.';
  assert.deepEqual(extractSources(text).map((s) => s.ref), ['commit:a1b2c3d4', 'pr:126']);
});

test('the bundle publishes exactly what it can support', () => {
  const known = knownSources(BUNDLE);
  assert.ok(known.has('commit:a1b2c3d4e5f6a7b8'));
  assert.ok(known.has('diff:src/stage.mjs'));
  assert.ok(known.has('pr:126'));
  assert.ok(known.has('changelog:[Unreleased]'));
  assert.ok(known.has('test:packages/blog-post-redactor/test'));
  assert.equal(known.has('pr:999'), false);
});

test('a short sha resolves against the collected long one', () => {
  const known = knownSources(BUNDLE);
  assert.ok(resolves('commit:a1b2c3d', known));
  assert.equal(resolves('commit:ffffffff', known), false);
});

test('a file reference resolves against docs or changed files', () => {
  const known = knownSources(BUNDLE);
  assert.ok(resolves('file:context/history.md', known));
  assert.ok(resolves('file:src/stage.mjs#L1-L4', known));
  assert.equal(resolves('file:src/invented.mjs', known), false);
});

test('an empty bundle supports nothing', () => {
  assert.equal(knownSources(null).size, 0);
  assert.equal(resolves('commit:a1b2c3d', knownSources({})), false);
});
