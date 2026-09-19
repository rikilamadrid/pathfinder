/**
 * `harvest` — a report that is the same everywhere, and changes nothing.
 *
 * Determinism is the property under test, and it is tested the way it can
 * actually fail: by running the real command from different directories, in
 * different timezones, under different locales, and comparing bytes. An
 * ordering that used `localeCompare`, or a report that printed today's date,
 * would pass every other test in this file and fail these.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { cleanup, ledger, project, read, recordOne, snapshot, touched } from '../harness.mjs';

after(cleanup);

/** A ledger with one of everything a harvest has an opinion about. */
function populated() {
  const root = project();

  recordOne(root, { title: 'Repeated and high', impact: 'high', candidate: 'Fix the contract' });
  ledger(root, ['record', '--repeats', '001', '--observed', '2026-09-19', '--evidence', 'pr:133']);

  recordOne(root, { title: 'Repeated and low', impact: 'low', category: 'workaround', candidate: 'Something else' });
  ledger(root, ['record', '--repeats', '002', '--observed', '2026-09-19', '--evidence', 'pr:133']);

  recordOne(root, { title: 'Single, medium', impact: 'medium', source: 'review', candidate: 'A third thing' });

  recordOne(root, { title: 'Awaiting a decision', candidate: 'Decide me' });
  ledger(root, ['resolve', '004', 'Proposed']);

  recordOne(root, { title: 'Tracked somewhere', candidate: 'Tracked' });
  ledger(root, ['resolve', '005', 'Proposed']);
  ledger(root, ['resolve', '005', 'Approved', '--in', 'issue:130']);

  recordOne(root, { title: 'Shelved, then it happened again', candidate: 'Shelved' });
  ledger(root, ['resolve', '006', 'Proposed']);
  ledger(root, ['resolve', '006', 'Deferred', '--why', 'Not now', '--on', '2026-09-12']);
  ledger(root, ['record', '--repeats', '006', '--observed', '2026-09-18', '--evidence', 'issue:129']);

  return root;
}

const report = (root) => JSON.parse(ledger(root, ['harvest', '--json']).stdout).report;

test('a project with no ledger harvests nothing, and says so', () => {
  const root = project();
  const result = ledger(root, ['harvest']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /No ledger yet/);
});

test('open work is ordered by occurrences, then impact, then id', () => {
  const root = project();
  recordOne(root, { title: 'Low, once', impact: 'low' });
  recordOne(root, { title: 'High, once', impact: 'high' });
  recordOne(root, { title: 'Medium, twice', impact: 'medium' });
  ledger(root, ['record', '--repeats', '003', '--observed', '2026-09-19', '--evidence', 'pr:133']);

  assert.deepEqual(report(root).open.map((entry) => entry.id), ['003', '002', '001'],
    'twice first, then high before low');
});

test('repetition is reported both ways the file can express it', () => {
  const root = project();
  recordOne(root, { title: 'Happened twice', candidate: 'One fix' });
  ledger(root, ['record', '--repeats', '001', '--observed', '2026-09-19', '--evidence', 'pr:133']);
  recordOne(root, { title: 'Separately recorded', candidate: 'Shared fix', category: 'workaround' });
  recordOne(root, { title: 'Also separately recorded', candidate: 'Shared fix', category: 'workaround' });

  const repeated = report(root).repeated;

  const byOccurrence = repeated.find((signal) => signal.kind === 'occurrences');
  assert.deepEqual(byOccurrence.ids, ['001']);
  assert.equal(byOccurrence.occurrences, 2);

  const byCandidate = repeated.find((signal) => signal.kind === 'shared-candidate');
  assert.deepEqual(byCandidate.ids, ['002', '003'],
    'two open entries sharing a category and a candidate are one signal');
});

test('two entries sharing a candidate are reported, never merged', () => {
  const root = project();
  recordOne(root, { title: 'One', candidate: 'Shared', category: 'workaround' });
  recordOne(root, { title: 'Two', candidate: 'Shared', category: 'workaround' });

  const before = read(root);
  const result = report(root);

  assert.equal(result.entries, 2, 'both entries are still there');
  assert.equal(read(root), before, 'harvest changed nothing');
});

test('a deferred entry that happened again since the decision is surfaced', () => {
  const root = populated();
  const recurred = report(root).recurredSinceDeferral;

  assert.deepEqual(recurred.map((entry) => entry.id), ['006']);
});

test('a deferred entry that has not recurred since is not surfaced', () => {
  const root = project();
  recordOne(root, { title: 'Shelved', candidate: 'Shelved', observed: '2026-09-01' });
  ledger(root, ['resolve', '001', 'Proposed']);
  ledger(root, ['resolve', '001', 'Deferred', '--why', 'Not now', '--on', '2026-09-19']);

  assert.deepEqual(report(root).recurredSinceDeferral, []);
});

test('proposed and approved entries are listed with what they are tracked in', () => {
  const root = populated();
  const result = report(root);

  assert.deepEqual(result.proposed.map((entry) => entry.id), ['004']);
  assert.deepEqual(result.approved.map((entry) => entry.id), ['005']);
  assert.equal(result.approved[0].trackedIn, '`issue:130`');
});

test('counts are reported by category, source and status', () => {
  const root = populated();
  const counts = report(root).counts;

  const total = (rows) => rows.reduce((sum, row) => sum + row.count, 0);
  assert.equal(total(counts.category), 6);
  assert.equal(total(counts.source), 6);
  assert.equal(total(counts.status), 6);
  assert.deepEqual(counts.status.find((row) => row.value === 'Approved'), { value: 'Approved', count: 1 });
});

test('harvest writes nothing, anywhere', () => {
  const root = populated();
  const before = snapshot(root);

  assert.equal(ledger(root, ['harvest']).status, 0);
  assert.equal(ledger(root, ['harvest', '--json']).status, 0);

  assert.deepEqual(touched(before, snapshot(root)), []);
});

test('the same ledger harvests to the same bytes across directory, timezone and locale', () => {
  const root = populated();

  const runs = [
    ledger(root, ['harvest']),
    ledger(root, ['harvest'], { cwd: '/' }),
    ledger(root, ['harvest'], { cwd: root, env: { TZ: 'UTC' } }),
    ledger(root, ['harvest'], { cwd: '/tmp', env: { TZ: 'Asia/Tokyo' } }),
    ledger(root, ['harvest'], { env: { LANG: 'C', LC_ALL: 'C' } }),
    ledger(root, ['harvest'], { env: { LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8', TZ: 'Pacific/Kiritimati' } }),
  ];

  for (const run of runs) assert.equal(run.status, 0, run.stderr);
  for (const run of runs.slice(1)) {
    assert.equal(run.stdout, runs[0].stdout, 'a harvest is a function of the file and nothing else');
  }
});

test('the JSON report is as deterministic as the text one', () => {
  const root = populated();

  const a = ledger(root, ['harvest', '--json'], { cwd: root, env: { TZ: 'UTC', LC_ALL: 'C' } });
  const b = ledger(root, ['harvest', '--json'], { cwd: '/tmp', env: { TZ: 'Asia/Tokyo', LC_ALL: 'tr_TR.UTF-8' } });

  assert.equal(a.stdout, b.stdout);
});

test('a harvest carries no clock: the same file harvested twice is identical', () => {
  const root = populated();
  const first = ledger(root, ['harvest']).stdout;
  const second = ledger(root, ['harvest']).stdout;

  assert.equal(first, second);
  assert.equal(/\d{4}-\d{2}-\d{2}/.test(first.replace(/2026-\d{2}-\d{2}/g, '')), false,
    'no date appears that did not come out of the ledger');
});
