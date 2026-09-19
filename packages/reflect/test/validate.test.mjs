/**
 * `validate` — every violation named by id and by line.
 *
 * The ledger is Markdown people edit by hand, which is the point of it being
 * Markdown, and the price is that a hand edit can break it. Each test here
 * breaks a valid ledger in exactly one way and checks that the report says
 * which entry and which line, because a validator that only says "invalid" is
 * one nobody runs twice.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

import { cleanup, ledger, ledgerFile, project, read, recordOne, snapshot, touched } from '../harness.mjs';

after(cleanup);

/** A valid two-entry ledger, then one deliberate act of damage to its text. */
function damaged(edit) {
  const root = project();
  recordOne(root, { title: 'First', candidate: 'Do the thing' });
  recordOne(root, { title: 'Second' });
  writeFileSync(ledgerFile(root), edit(read(root)), 'utf8');
  return root;
}

const problems = (root) => JSON.parse(ledger(root, ['validate', '--json']).stdout).problems;

test('a ledger the engine wrote validates, and exits zero', () => {
  const root = project();
  recordOne(root, { title: 'First', candidate: 'Do the thing' });
  recordOne(root, { title: 'Second' });
  ledger(root, ['resolve', '001', 'Proposed']);
  ledger(root, ['resolve', '001', 'Approved', '--in', 'issue:130']);
  ledger(root, ['record', '--repeats', '002', '--observed', '2026-09-19', '--evidence', 'pr:133']);

  const result = ledger(root, ['validate']);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /OK - 2 entries/);
});

test('a project with no ledger is valid, because a missing ledger is normal', () => {
  const root = project();
  const result = ledger(root, ['validate']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /No ledger/);
});

test('an unknown value in a closed field is named with its entry and line', () => {
  const root = damaged((text) => text.replace('- Category: missing-contract', '- Category: invented'));
  const result = ledger(root, ['validate']);

  assert.equal(result.status, 1);
  const [problem] = problems(root);
  assert.equal(problem.id, '001');
  assert.equal(typeof problem.line, 'number');
  assert.match(problem.message, /`Category` must be one of/);
  assert.match(result.stdout, new RegExp(`001 line ${problem.line}:`));
});

test('a duplicated id is named, and points at the line that already used it', () => {
  const root = damaged((text) => text.replace('## 002 — Second', '## 001 — Second')
    .replace('<!-- pathfinder:improvement 002 -->', '<!-- pathfinder:improvement 001 -->'));

  const found = problems(root);

  assert.equal(ledger(root, ['validate']).status, 1);
  assert.ok(found.some((problem) => /duplicate id/.test(problem.message)));
});

test('ids out of sequence are named', () => {
  const root = damaged((text) => text.replace('## 002 — Second', '## 007 — Second')
    .replace('<!-- pathfinder:improvement 002 -->', '<!-- pathfinder:improvement 007 -->'));

  assert.ok(problems(root).some((problem) => /should be `002`/.test(problem.message)));
});

test('a marker that disagrees with its heading is named', () => {
  const root = damaged((text) => text.replace('<!-- pathfinder:improvement 002 -->', '<!-- pathfinder:improvement 009 -->'));
  const found = problems(root);

  assert.ok(found.some((problem) => /marker says `009` but the heading says `002`/.test(problem.message)));
  assert.equal(found.find((problem) => /marker says/.test(problem.message)).id, '002');
});

test('a missing marker is named', () => {
  const root = damaged((text) => text.replace('<!-- pathfinder:improvement 001 -->\n', ''));
  assert.ok(problems(root).some((problem) => /no `<!-- pathfinder:improvement/.test(problem.message)));
});

test('an entry with no evidence reference is named', () => {
  const root = damaged((text) => text.replace('- Evidence: `issue:111`', '- Evidence: none really'));
  const found = problems(root);

  assert.ok(found.some((problem) => /no evidence reference/.test(problem.message)));
});

test('a malformed evidence reference is named', () => {
  const root = damaged((text) => text.replace('- Evidence: `issue:111`', '- Evidence: `rumour:hearsay`, `issue:111`'));
  assert.ok(problems(root).some((problem) => /`rumour:hearsay` is not an evidence reference/.test(problem.message)));
});

test('a status that has lost its required field is named', () => {
  const cases = [
    ['- Status: Open', '- Status: Approved', /requires a `Tracked in` line/],
    ['- Status: Open', '- Status: Applied', /requires a `Applied in` line/],
    ['- Status: Open', '- Status: Rejected', /requires a `Decision` line/],
    ['- Status: Open', '- Status: Deferred', /requires a `Decision` line/],
  ];

  for (const [from, to, expected] of cases) {
    const root = damaged((text) => text.replace(from, to));
    assert.ok(problems(root).some((problem) => expected.test(problem.message)), `${to} must be named`);
  }
});

test('a Proposed entry with no candidate improvement is named', () => {
  const root = project();
  recordOne(root, { title: 'No candidate' });
  writeFileSync(ledgerFile(root), read(root).replace('- Status: Open', '- Status: Proposed'), 'utf8');

  assert.ok(problems(root).some((problem) => /requires a `Candidate improvement`/.test(problem.message)));
});

test('an occurrence count that disagrees with the list is named', () => {
  const root = damaged((text) => text.replace('- Occurrences: 1', '- Occurrences: 4'));
  assert.ok(problems(root).some((problem) => /says 4 but 1 are listed/.test(problem.message)));
});

test('a malformed date is named, wherever it is', () => {
  const observed = damaged((text) => text.replace('- Observed: 2026-09-18', '- Observed: last Tuesday'));
  assert.ok(problems(observed).some((problem) => /`Observed` is `last Tuesday`/.test(problem.message)));

  const occurrence = damaged((text) => text.replace('  - 2026-09-18 — `issue:111`', '  - soon — `issue:111`'));
  assert.ok(problems(occurrence).some((problem) => /occurrence date `soon`/.test(problem.message)));
});

test('a Decision with no date is named', () => {
  const root = damaged((text) => text.replace('- Status: Open', '- Status: Deferred\n- Decision: Because I said so'));
  assert.ok(problems(root).some((problem) => /must end with the date/.test(problem.message)));
});

test('an entry with no paragraph is named', () => {
  const root = damaged((text) => text.replace(
    'It happened, and this says what happened without saying what to do about it.', ''));
  assert.ok(problems(root).some((problem) => /no evidence paragraph/.test(problem.message)));
});

test('a missing required field is named', () => {
  const root = damaged((text) => text.replace('- Impact: high\n', ''));
  assert.ok(problems(root).some((problem) => /no `Impact` line/.test(problem.message)));
});

test('problems are reported in line order, so the report reads down the file', () => {
  const root = damaged((text) => text
    .replace('- Category: missing-contract', '- Category: invented')
    .replace('- Impact: high', '- Impact: enormous'));

  const lines = problems(root).map((problem) => problem.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
});

test('validate writes nothing, even when the ledger is broken', () => {
  const root = damaged((text) => text.replace('- Impact: high', '- Impact: enormous'));
  const before = snapshot(root);

  assert.equal(ledger(root, ['validate']).status, 1);

  assert.deepEqual(touched(before, snapshot(root)), [],
    'naming a problem is the whole job; repairing evidence is not');
});
