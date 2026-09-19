/**
 * A ledger keeps the line endings it arrived with.
 *
 * The byte-for-byte promise is not only about which lines change; it is about
 * the diff a reviewer sees. A file carrying one stray CRLF — a hand edit, a
 * paste, a checkout on another platform — used to be rewritten end to end by a
 * one-line status change, turning a two-line review into a seventy-line one and
 * hiding the actual change inside it.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import { cleanup, ledger, ledgerFile, project, recordOne } from '../harness.mjs';

after(cleanup);

const bytes = (root) => readFileSync(ledgerFile(root));
const carriageReturns = (buffer) => [...buffer].filter((byte) => byte === 0x0d).length;

function differingLines(before, after_) {
  const was = before.toString('utf8').split('\n');
  const is = after_.toString('utf8').split('\n');
  return was.map((line, index) => [index + 1, line, is[index]]).filter(([, a, b]) => a !== b);
}

/** A ledger with one entry, then whatever the test does to its bytes. */
function ledgerWith(edit = (buffer) => buffer) {
  const root = project();
  recordOne(root, { candidate: 'Fix it' });
  writeFileSync(ledgerFile(root), edit(bytes(root)));
  return root;
}

test('an all-LF ledger stays all-LF, and one line changes', () => {
  const root = ledgerWith();
  const before = bytes(root);

  assert.equal(ledger(root, ['resolve', '001', 'Proposed']).status, 0);

  const after_ = bytes(root);
  assert.equal(carriageReturns(after_), 0);
  assert.equal(differingLines(before, after_).length, 1);
});

test('an all-CRLF ledger stays all-CRLF, and one line changes', () => {
  const root = ledgerWith((buffer) => Buffer.from(buffer.toString('utf8').replace(/\n/g, '\r\n')));
  const before = bytes(root);

  assert.equal(ledger(root, ['resolve', '001', 'Proposed']).status, 0);

  const after_ = bytes(root);
  assert.equal(carriageReturns(after_), carriageReturns(before),
    'no ending was added or lost');
  assert.equal(differingLines(before, after_).length, 1);
});

test('one stray CRLF does not rewrite the whole file', () => {
  const root = ledgerWith((buffer) => {
    const lines = buffer.toString('utf8').split('\n');
    lines[2] = `${lines[2]}\r`;
    return Buffer.from(lines.join('\n'));
  });
  const before = bytes(root);
  assert.equal(carriageReturns(before), 1, 'precondition: exactly one');

  assert.equal(ledger(root, ['resolve', '001', 'Proposed']).status, 0);

  const after_ = bytes(root);
  assert.equal(carriageReturns(after_), 1, 'the stray ending is left exactly as it was');
  assert.equal(differingLines(before, after_).length, 1,
    'a one-line status change is a one-line diff, whatever the endings are');
});

test('an occurrence appended to a CRLF ledger carries a CRLF ending', () => {
  const root = ledgerWith((buffer) => Buffer.from(buffer.toString('utf8').replace(/\n/g, '\r\n')));
  const before = bytes(root);

  assert.equal(ledger(root, ['record', '--repeats', '001', '--observed', '2026-09-19', '--evidence', 'pr:133']).status, 0);

  const after_ = bytes(root);
  assert.equal(carriageReturns(after_), carriageReturns(before) + 1,
    'one new line, one new ending, and no existing ending disturbed');
  assert.equal(ledger(root, ['validate']).status, 0);
});
