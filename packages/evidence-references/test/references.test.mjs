/**
 * The shared grammar, tested where it lives.
 *
 * The conformance fixture is the bulk of it and is run by every consumer, so
 * this file adds only what is true of the primitive rather than of the
 * grammar: that it is the kit's single statement of it, and that it stays a
 * pure function of its argument — no filesystem, no resolution, no idea what
 * an evidence bundle or a ledger is.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as grammar from '../../../lib/evidence-references.mjs';
import { runConformance } from '../conformance.mjs';

runConformance(grammar, 'lib/evidence-references.mjs');

const SOURCE = new URL('../../../lib/evidence-references.mjs', import.meta.url);

test('the primitive exports the four grammar members and nothing else', () => {
  assert.deepEqual(Object.keys(grammar).sort(), [
    'SOURCE_TYPES', 'extractSources', 'formatSource', 'parseSource',
  ]);
});

test('the primitive imports nothing', () => {
  // Shape, not meaning: a module that reads a file or resolves a reference has
  // stopped being the grammar. The absence of any import is the cheapest true
  // statement of that, and it is what keeps `reflect` and `blog-post-redactor`
  // able to share this file without sharing anything else.
  const text = readFileSync(SOURCE, 'utf8');
  assert.equal(/^\s*import\s/m.test(text), false,
    'lib/evidence-references.mjs must depend on nothing, not even node builtins');
});

test('the type list lives here and is frozen against accidental growth', () => {
  // The count is the guard the Feature asked for: a tenth type is a deliberate
  // change to this file and the fixture together, never a quiet append.
  assert.equal(grammar.SOURCE_TYPES.length, 9);
});

test('parsing the same reference twice gives equal, independent results', () => {
  const first = grammar.parseSource('file:README.md#L1-L20');
  const second = grammar.parseSource('file:README.md#L1-L20');
  assert.deepEqual(first, second);
  assert.notEqual(first.lines, second.lines, 'each parse owns its own lines object');
});

test('a parsed reference carries no hidden state', () => {
  assert.deepEqual(Object.keys(grammar.parseSource('pr:126')), ['type', 'locator', 'lines', 'ref']);
});
