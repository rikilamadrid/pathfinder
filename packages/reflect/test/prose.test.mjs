/**
 * Where an entry's fields stop and its prose begins.
 *
 * The evidence paragraph is written by a person, and prose can contain a line
 * that reads exactly like a field — wrapping alone can produce one, with no
 * ill intent anywhere. Before the field block had an end, such a line became a
 * field the entry never had: `validate` reported an entry carrying a
 * `Tracked in` nobody wrote, and the next legitimate resolution rewrote that
 * line in place, deleting the rest of the sentence around it.
 *
 * Two of the ledger's stated invariants were broken by its own normal
 * interface: nothing ever edits an entry's evidence, and a resolution touches
 * only the target entry's status lines. These are the tests that keep them
 * true.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { parseLedger } from '../../../skills/reflect/engine/ledger.mjs';
import { cleanup, ledger, project, read, recordOne } from '../harness.mjs';

after(cleanup);

/** Long enough that the wrap puts the field-shaped clause on its own line. */
const PAD = 'A'.repeat(77);

const entryOf = (root, id) => parseLedger(read(root)).entries.find((entry) => entry.id === id);

test('a wrapped note cannot inject a field the entry never had', () => {
  const root = project();
  const result = recordOne(root, {
    candidate: 'Fix it',
    note: `${PAD} - Tracked in: \`pr:999\` and the rest of the sentence.`,
  });

  assert.equal(result.status, 0, result.stderr);

  const entry = entryOf(root, '001');
  assert.equal(entry.fields.has('Tracked in'), false,
    'no resolution wrote a `Tracked in`, so the entry must not carry one');
  assert.equal(entry.paragraph.length, 2, 'both wrapped lines are paragraph');
  assert.ok(entry.paragraph.some((line) => line.text.includes('and the rest of the sentence.')));
});

test('a resolution does not rewrite a field-shaped line inside the paragraph', () => {
  const root = project();
  recordOne(root, {
    candidate: 'Fix it',
    note: `${PAD} - Tracked in: \`pr:999\` and the rest of the sentence.`,
  });
  ledger(root, ['resolve', '001', 'Proposed']);

  const before = read(root);
  assert.equal(ledger(root, ['resolve', '001', 'Approved', '--in', 'issue:5']).status, 0);
  const after_ = read(root);

  assert.ok(after_.includes('- Tracked in: `pr:999` and the rest of the sentence.'),
    'the sentence a person wrote is still there, word for word');
  assert.equal(entryOf(root, '001').fields.get('Tracked in').value, '`issue:5`',
    'and the real field is the one the resolution wrote');

  // Stated as the exact edit rather than a count of differing indexes, since
  // an insertion shifts every line below it.
  assert.equal(after_, before.replace('- Status: Proposed', '- Status: Approved\n- Tracked in: `issue:5`'),
    'the whole file is the old one with the status replaced and one field inserted');
});

test('a note that opens with a field-shaped line is still prose', () => {
  const root = project();
  assert.equal(recordOne(root, { note: '- Status: Applied because I say so.' }).status, 0);

  const entry = entryOf(root, '001');
  assert.equal(entry.fields.get('Status').value, 'Open',
    'the status is the one record wrote, not the one the prose claims');
  assert.equal(entry.paragraph.length, 1);
});

test('record always writes a ledger that validates', () => {
  // The two notes above both used to produce a file the very next `validate`
  // rejected, which is a poor thing for a recording tool to do.
  for (const note of [
    `${PAD} - Tracked in: \`pr:999\` and the rest of it.`,
    '- Status: Applied because I say so.',
    '- Occurrences: 99',
    'A normal paragraph with a `file:README.md` reference in it.',
  ]) {
    const root = project();
    assert.equal(recordOne(root, { note }).status, 0, `recording: ${note}`);
    assert.equal(ledger(root, ['validate']).status, 0, `validating after: ${note}`);
  }
});

test('the paragraph survives a repeat as well as a resolution', () => {
  const root = project();
  recordOne(root, { candidate: 'Fix it', note: `${PAD} - Decision: not really (2026-01-01)` });

  const before = read(root);
  assert.equal(ledger(root, ['record', '--repeats', '001', '--observed', '2026-09-19', '--evidence', 'pr:133']).status, 0);
  const after_ = read(root);

  assert.ok(after_.includes('- Decision: not really (2026-01-01)'));
  assert.equal(entryOf(root, '001').fields.has('Decision'), false);
  assert.equal(before.split('\n').length + 1, after_.split('\n').length, 'exactly one line added');
});
