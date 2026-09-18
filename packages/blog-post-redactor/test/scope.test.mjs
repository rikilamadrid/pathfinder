import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseScope, describeScope, isUnresolved, SCOPE_KINDS,
} from '../../../skills/blog-post-redactor/engine/scope.mjs';

test('no arguments means the current branch against its default', () => {
  const scope = parseScope([]);
  assert.equal(scope.kind, 'working');
  assert.equal(scope.value, null);
  assert.equal(isUnresolved(scope), false);
});

test('--pr takes a numeric id', () => {
  assert.deepEqual(parseScope(['--pr', '126']).kind, 'pr');
  assert.equal(parseScope(['--pr', '126']).value, '126');
});

test('--pr rejects a non-numeric id rather than guessing', () => {
  assert.throws(() => parseScope(['--pr', 'feature/x']), /numeric pull request id/);
  assert.throws(() => parseScope(['--pr']), /numeric pull request id/);
});

test('--since and --range carry their refs', () => {
  assert.equal(parseScope(['--since', 'v4.3.0']).value, 'v4.3.0');
  assert.equal(parseScope(['--range', 'v4.3.0..HEAD']).value, 'v4.3.0..HEAD');
});

test('--range insists on a range, because a single ref is a different question', () => {
  assert.throws(() => parseScope(['--range', 'v4.3.0']), /git range/);
});

test('free text is a label, and a label is never silently resolved', () => {
  const scope = parseScope(['Pathfinder', '4.4.0']);
  assert.equal(scope.kind, 'label');
  assert.equal(scope.value, 'Pathfinder 4.4.0');
  assert.equal(isUnresolved(scope), true);
});

test('an unrelated flag and its value are not mistaken for a label', () => {
  assert.equal(parseScope(['--out', 'blog-posts']).kind, 'working');
});

test('every kind describes itself for metadata.json', () => {
  for (const kind of SCOPE_KINDS) {
    const scope = { kind, value: kind === 'working' ? null : 'x', raw: [] };
    assert.equal(typeof describeScope(scope), 'string');
    assert.ok(describeScope(scope).length > 0);
  }
});
