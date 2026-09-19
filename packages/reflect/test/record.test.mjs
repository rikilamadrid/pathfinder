/**
 * `record` — what it accepts, what it refuses, and what it leaves behind.
 *
 * The refusals carry as much of this ticket's weight as the successes. A
 * ledger is only evidence if every field means one of a known set of things,
 * and the only way that stays true is if an unknown value is refused at the
 * moment somebody tries to write it.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import {
  CATEGORIES, IMPACTS, INTERVENTIONS, SCOPES, SOURCES,
} from '../../../skills/reflect/engine/vocabulary.mjs';
import { cleanup, ledger, ledgerFile, observation, project, read, recordOne } from '../harness.mjs';

after(cleanup);

test('a first record creates the ledger from the shipped template', () => {
  const root = project();
  assert.equal(existsSync(ledgerFile(root)), false, 'the installer ships no ledger');

  const result = recordOne(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /recorded 001 \(ledger created from the template\)/);

  const text = read(root);
  assert.match(text, /^# Improvement Ledger/, 'the template header survives');
  assert.match(text, /## 001 — A thing that happened/);
  assert.match(text, /<!-- pathfinder:improvement 001 -->/);
  assert.match(text, /- Status: Open/);
  assert.match(text, /- Evidence: `issue:111`/);
  assert.match(text, /- Occurrences: 1/);
  assert.match(text, /  - 2026-09-18 — `issue:111`/);
});

test('ids run 001, 002, 003 in the order they were recorded', () => {
  const root = project();
  for (const title of ['First', 'Second', 'Third']) {
    assert.equal(recordOne(root, { title }).status, 0);
  }
  const ids = [...read(root).matchAll(/^## (\d{3}) — /gm)].map((match) => match[1]);
  assert.deepEqual(ids, ['001', '002', '003']);
});

test('a later record leaves every earlier entry byte for byte', () => {
  const root = project();
  recordOne(root, { title: 'First' });
  const before = read(root);

  recordOne(root, { title: 'Second' });
  const after_ = read(root);

  assert.equal(after_.startsWith(before.replace(/\s*$/, '')), true,
    'recording appends; it never rewrites what is already there');
});

test('an observation with no evidence reference is refused', () => {
  const root = project();
  const args = observation().filter((argument, index, all) =>
    argument !== '--evidence' && all[index - 1] !== '--evidence');

  const result = ledger(root, ['record', ...args]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /at least one evidence reference/);
  assert.equal(existsSync(ledgerFile(root)), false, 'a refusal writes nothing at all');
});

test('a malformed evidence reference is refused, and names itself', () => {
  const root = project();
  for (const bad of ['rumour:someone said so', 'commit', 'file:README.md#L20-L1', 'Commit:abc', '']) {
    const result = ledger(root, ['record', ...observation({ evidence: [bad] })]);
    assert.equal(result.status, 1, `\`${bad}\` must be refused`);
    assert.match(result.stderr, /is not an evidence reference/);
  }
  assert.equal(existsSync(ledgerFile(root)), false);
});

test('every closed vocabulary refuses an unknown value by field and allowed set', () => {
  const fields = {
    source: { field: 'Source', allowed: SOURCES },
    scope: { field: 'Scope', allowed: SCOPES },
    category: { field: 'Category', allowed: CATEGORIES },
    intervention: { field: 'Human intervention', allowed: INTERVENTIONS },
    impact: { field: 'Impact', allowed: IMPACTS },
  };

  for (const [option, { field, allowed }] of Object.entries(fields)) {
    const root = project();
    const result = ledger(root, ['record', ...observation({ [option]: 'not-a-real-value' })]);

    assert.equal(result.status, 1, `--${option} must refuse an unknown value`);
    assert.ok(result.stderr.includes(`\`${field}\``), `the refusal names \`${field}\`: ${result.stderr}`);
    for (const value of allowed) {
      assert.ok(result.stderr.includes(value), `the refusal lists \`${value}\``);
    }
    assert.equal(existsSync(ledgerFile(root)), false);
  }
});

test('every legal value of every closed vocabulary is accepted', () => {
  const cases = [
    ['source', SOURCES], ['scope', SCOPES], ['category', CATEGORIES],
    ['intervention', INTERVENTIONS], ['impact', IMPACTS],
  ];
  for (const [option, values] of cases) {
    for (const value of values) {
      const root = project();
      const result = ledger(root, ['record', ...observation({ [option]: value })]);
      assert.equal(result.status, 0, `--${option} ${value}: ${result.stderr}`);
    }
  }
});

test('the observation date is required, and must be a real day', () => {
  const root = project();
  for (const bad of ['18-09-2026', '2026-13-01', '2026-02-30', 'yesterday', '2026-9-8']) {
    const result = ledger(root, ['record', ...observation({ observed: bad })]);
    assert.equal(result.status, 1, `\`${bad}\` is not a date`);
    assert.match(result.stderr, /is not a date/);
  }
  // The calendar is real, not four-two-two digits: 2026 has no 29th of
  // February and 2024 does.
  assert.equal(ledger(root, ['record', ...observation({ observed: '2026-02-29' })]).status, 1);
  assert.equal(ledger(root, ['record', ...observation({ observed: '2024-02-29' })]).status, 0);
});

test('a title that exactly duplicates an entry is refused, and points at --repeats', () => {
  const root = project();
  recordOne(root, { title: 'The same thing' });

  const result = recordOne(root, { title: 'The same thing' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /already records/);
  assert.match(result.stderr, /--repeats 001/);
  assert.equal([...read(root).matchAll(/^## \d{3} — /gm)].length, 1);
});

test('a title that merely resembles one is a separate entry: nothing here is fuzzy', () => {
  const root = project();
  recordOne(root, { title: 'The same thing' });

  assert.equal(recordOne(root, { title: 'The same thing ' }).status, 1, 'trimmed, so still the same');
  assert.equal(recordOne(root, { title: 'The same thing.' }).status, 0, 'a different string is a different entry');
  assert.equal(recordOne(root, { title: 'the same thing' }).status, 0, 'case is not sameness to guess at');
});

test('--repeats adds a dated occurrence and raises the count, with no new heading', () => {
  const root = project();
  recordOne(root, { title: 'Recurring' });
  const headingsBefore = [...read(root).matchAll(/^## \d{3} — /gm)].length;

  const result = ledger(root, ['record', '--repeats', '001', '--observed', '2026-09-19', '--evidence', 'pr:133']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /recorded occurrence 2 of 001/);

  const text = read(root);
  assert.equal([...text.matchAll(/^## \d{3} — /gm)].length, headingsBefore, 'no new heading');
  assert.match(text, /- Occurrences: 2/);
  assert.match(text, /  - 2026-09-18 — `issue:111`/);
  assert.match(text, /  - 2026-09-19 — `pr:133`/);
});

test('--repeats against an id that does not exist is refused', () => {
  const root = project();
  recordOne(root);
  const before = read(root);

  const result = ledger(root, ['record', '--repeats', '404', '--observed', '2026-09-19', '--evidence', 'pr:133']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no entry `404`/);
  assert.equal(read(root), before, 'the file is untouched');
});

test('--repeats still demands a valid reference and a date', () => {
  const root = project();
  recordOne(root);
  const before = read(root);

  assert.equal(ledger(root, ['record', '--repeats', '001', '--observed', '2026-09-19']).status, 1);
  assert.equal(ledger(root, ['record', '--repeats', '001', '--evidence', 'pr:133']).status, 1);
  assert.equal(ledger(root, ['record', '--repeats', '001', '--observed', 'soon', '--evidence', 'pr:133']).status, 1);
  assert.equal(read(root), before);
});

test('a reference is stored in the grammar\'s own spelling', () => {
  const root = project();
  recordOne(root, { evidence: ['  pr:126  '] });
  assert.match(read(root), /- Evidence: `pr:126`/);
});

test('the entry paragraph is required, because an entry with no account of itself is not evidence', () => {
  const root = project();
  const args = observation().filter((argument, index, all) =>
    argument !== '--note' && all[index - 1] !== '--note');

  const result = ledger(root, ['record', ...args]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--note is required/);
});

test('a candidate improvement is optional at record time', () => {
  const root = project();
  assert.equal(recordOne(root, { title: 'No candidate' }).status, 0);
  assert.equal(read(root).includes('- Candidate improvement:'), false);

  assert.equal(recordOne(root, { title: 'With one', candidate: 'Do the thing' }).status, 0);
  assert.match(read(root), /- Candidate improvement: Do the thing/);
});
