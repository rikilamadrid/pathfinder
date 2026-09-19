/**
 * `resolve` — the one command that rewrites, held to rewriting almost nothing.
 *
 * Two properties are tested here above all others. Every illegal transition is
 * refused by name, because a status that can move anywhere records nothing.
 * And a resolution changes only the target entry's status lines: every other
 * byte of the file, including every other entry, is identical afterwards.
 * That is what makes a ledger reviewable in a diff.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { STATUSES, TRANSITIONS } from '../../../skills/reflect/engine/vocabulary.mjs';
import { cleanup, ledger, project, read, recordOne } from '../harness.mjs';

after(cleanup);

/** An entry sitting at `status`, reached only through legal transitions. */
function entryAt(status, { title = 'A thing that happened' } = {}) {
  const root = project();
  recordOne(root, { title, candidate: 'Do the thing' });

  const route = {
    'Open': [],
    'Proposed': [['Proposed', []]],
    'Approved': [['Proposed', []], ['Approved', ['--in', 'issue:129']]],
    'Applied': [['Proposed', []], ['Approved', ['--in', 'issue:129']], ['Applied', ['--in', 'pr:133']]],
    'Rejected': [['Proposed', []], ['Rejected', ['--why', 'Not worth it', '--on', '2026-09-19']]],
    'Deferred': [['Proposed', []], ['Deferred', ['--why', 'Later', '--on', '2026-09-19']]],
  }[status];

  for (const [to, extra] of route) {
    const result = ledger(root, ['resolve', '001', to, ...extra]);
    assert.equal(result.status, 0, `setting up ${status}: ${result.stderr}`);
  }
  return root;
}

test('every legal transition is accepted', () => {
  const extra = {
    'Approved': ['--in', 'issue:129'],
    'Applied': ['--in', 'pr:133'],
    'Rejected': ['--why', 'Not worth it', '--on', '2026-09-19'],
    'Deferred': ['--why', 'Later', '--on', '2026-09-19'],
  };

  for (const [from, targets] of Object.entries(TRANSITIONS)) {
    for (const to of targets) {
      const root = entryAt(from);
      const result = ledger(root, ['resolve', '001', to, ...(extra[to] ?? [])]);

      assert.equal(result.status, 0, `${from} -> ${to} is legal: ${result.stderr}`);
      assert.match(result.stdout, new RegExp(`001: ${from} -> ${to}`));
      assert.match(read(root), new RegExp(`- Status: ${to}`));
    }
  }
});

test('every illegal transition is refused, and the refusal says what is legal', () => {
  const extra = {
    'Approved': ['--in', 'issue:129'],
    'Applied': ['--in', 'pr:133'],
    'Rejected': ['--why', 'Not worth it', '--on', '2026-09-19'],
    'Deferred': ['--why', 'Later', '--on', '2026-09-19'],
  };

  for (const from of STATUSES) {
    const legal = TRANSITIONS[from];
    for (const to of STATUSES.filter((candidate) => !legal.includes(candidate))) {
      const root = entryAt(from);
      const before = read(root);
      const result = ledger(root, ['resolve', '001', to, ...(extra[to] ?? [])]);

      assert.equal(result.status, 1, `${from} -> ${to} must be refused`);
      assert.ok(result.stderr.includes(`\`${from}\``) && result.stderr.includes(`\`${to}\``),
        `the refusal names both statuses: ${result.stderr}`);
      assert.equal(read(root), before, 'a refused transition changes nothing');
    }
  }
});

test('a status outside the vocabulary is not a transition at all', () => {
  const root = entryAt('Open');
  const result = ledger(root, ['resolve', '001', 'Done']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /`Status` must be one of/);
});

test('Approved and Applied require the evidence that they happened', () => {
  for (const [status, at] of [['Approved', 'Proposed'], ['Applied', 'Approved']]) {
    const root = entryAt(at);
    const before = read(root);

    const refused = ledger(root, ['resolve', '001', status]);
    assert.equal(refused.status, 1, `${status} without --in must be refused`);
    assert.match(refused.stderr, /requires --in/);
    assert.equal(read(root), before);

    assert.equal(ledger(root, ['resolve', '001', status, '--in', 'pr:133']).status, 0);
  }
});

test('Rejected and Deferred require the human reason and its date', () => {
  for (const status of ['Rejected', 'Deferred']) {
    const root = entryAt('Proposed');
    const before = read(root);

    assert.equal(ledger(root, ['resolve', '001', status]).status, 1, 'no --why');
    assert.equal(ledger(root, ['resolve', '001', status, '--why', 'Because']).status, 1, 'no --on');
    assert.equal(ledger(root, ['resolve', '001', status, '--why', 'Because', '--on', 'soon']).status, 1, 'bad --on');
    assert.equal(read(root), before);

    const result = ledger(root, ['resolve', '001', status, '--why', 'Because', '--on', '2026-09-19']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(read(root), /- Decision: Because \(2026-09-19\)/);
  }
});

test('evidence offered where none belongs is refused rather than silently dropped', () => {
  const root = entryAt('Open');
  const result = ledger(root, ['resolve', '001', 'Proposed', '--in', 'pr:133']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /takes no --in/);
});

test('an entry with no candidate improvement cannot be Proposed', () => {
  const root = project();
  recordOne(root, { title: 'No candidate yet' });

  const result = ledger(root, ['resolve', '001', 'Proposed']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no `Candidate improvement`/);
});

test('an unknown id is refused, and the refusal says what the ledger holds', () => {
  const root = entryAt('Open');
  const before = read(root);

  const result = ledger(root, ['resolve', '404', 'Proposed']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no entry `404`/);
  assert.match(result.stderr, /it holds 001/);
  assert.equal(read(root), before);
});

test('resolving one entry leaves every other entry byte for byte', () => {
  const root = project();
  recordOne(root, { title: 'First', candidate: 'Do the thing' });
  recordOne(root, { title: 'Second', candidate: 'Do the other thing' });
  recordOne(root, { title: 'Third' });

  const before = read(root);
  assert.equal(ledger(root, ['resolve', '002', 'Proposed']).status, 0);
  const after_ = read(root);

  const section = (text, id) => {
    const start = text.indexOf(`## ${id} —`);
    const next = text.indexOf('\n## ', start + 1);
    return text.slice(start, next === -1 ? text.length : next);
  };

  assert.equal(section(after_, '001'), section(before, '001'), 'entry 001 is untouched');
  assert.equal(section(after_, '003'), section(before, '003'), 'entry 003 is untouched');
  assert.equal(after_.slice(0, after_.indexOf('## 001')), before.slice(0, before.indexOf('## 001')),
    'the file header is untouched');

  const changed = before.split('\n')
    .map((line, index) => [line, after_.split('\n')[index]])
    .filter(([was, is]) => was !== is);
  assert.equal(changed.length, 1, 'exactly one line differs');
  assert.deepEqual(changed[0], ['- Status: Open', '- Status: Proposed']);
});

test('a resolution adds its evidence line in the file\'s own field order', () => {
  const root = entryAt('Proposed');
  assert.equal(ledger(root, ['resolve', '001', 'Approved', '--in', 'issue:129', '--in', 'pr:133']).status, 0);

  const text = read(root);
  assert.match(text, /- Status: Approved\n- Tracked in: `issue:129`, `pr:133`/);
  assert.ok(text.indexOf('- Tracked in:') < text.indexOf('- Evidence:'),
    'Tracked in sits with the status fields, before the evidence');
});

test('a reference given to --in must be one, and is stored canonically', () => {
  const root = entryAt('Proposed');

  assert.equal(ledger(root, ['resolve', '001', 'Approved', '--in', 'rumour:hearsay']).status, 1);
  assert.equal(ledger(root, ['resolve', '001', 'Approved', '--in', '  issue:129  ']).status, 0);
  assert.match(read(root), /- Tracked in: `issue:129`/);
});

test('a deferred entry can come back, and its decision stays on the record', () => {
  const root = entryAt('Deferred');
  const result = ledger(root, ['resolve', '001', 'Open']);

  assert.equal(result.status, 0, result.stderr);
  const text = read(root);
  assert.match(text, /- Status: Open/);
  assert.match(text, /- Decision: Later \(2026-09-19\)/,
    'the deferral is history, not something a later transition erases');
});

test('Applied and Rejected are terminal', () => {
  for (const terminal of ['Applied', 'Rejected']) {
    const root = entryAt(terminal);
    for (const to of STATUSES) {
      const result = ledger(root, ['resolve', '001', to, '--in', 'pr:1', '--why', 'x', '--on', '2026-09-19']);
      assert.equal(result.status, 1, `${terminal} -> ${to} must be refused`);
    }
    assert.match(read(root), new RegExp(`- Status: ${terminal}`));
  }
});
