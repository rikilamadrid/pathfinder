/**
 * The command line contract: exit codes, `--json`, and the refusal surface.
 *
 * The exit code is the part a script depends on and a person never sees, which
 * is exactly why it needs a test. Three codes, the same three `orchestrate`
 * uses: 0 did it, 1 refused, 2 the command line was wrong.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BIN, cleanup, ledger, ledgerFile, observation, project, read, recordOne } from '../harness.mjs';

after(cleanup);

const run = (args, cwd) => {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

test('no command prints the usage and exits 2', () => {
  const result = run([]);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /improvement ledger/);
});

test('--help prints the usage and exits 0', () => {
  for (const flag of ['-h', '--help']) {
    const result = run([flag]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /record/);
    assert.match(result.stdout, /resolve/);
    assert.match(result.stdout, /harvest/);
    assert.match(result.stdout, /validate/);
  }
});

test('the usage names every subcommand the program accepts, and no other', () => {
  const usage = run(['--help']).stdout;
  for (const command of ['record', 'resolve', 'harvest', 'validate']) {
    assert.ok(usage.includes(`  ${command}`), `${command} is documented`);
  }
  assert.equal(usage.includes('ledger.mjs promote'), false);
});

test('an unknown command exits 2 and says so', () => {
  const result = run(['promote']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown command `promote`/);
});

test('a flag with no value is a command-line error, not a refusal', () => {
  const root = project();
  const result = ledger(root, ['record', '--observed']);
  assert.equal(result.status, 2);
});

test('every subcommand accepts --json', () => {
  const root = project();
  recordOne(root, { candidate: 'Do the thing' });

  for (const args of [
    ['record', '--repeats', '001', '--observed', '2026-09-19', '--evidence', 'pr:133', '--json'],
    ['resolve', '001', 'Proposed', '--json'],
    ['harvest', '--json'],
    ['validate', '--json'],
  ]) {
    const result = ledger(root, args);
    assert.equal(result.status, 0, `${args[0]}: ${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, args[0]);
  }
});

test('--json reports a refusal as data on stdout rather than prose on stderr', () => {
  const root = project();
  recordOne(root);
  const result = ledger(root, ['resolve', '404', 'Proposed', '--json']);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.command, 'resolve');
  assert.match(payload.message, /no entry `404`/);
});

test('validate exits non-zero when the ledger is broken, in both output modes', () => {
  const root = project();
  recordOne(root);
  // Broken by hand, which is the only way a ledger becomes invalid: no
  // refusal the engine makes can leave one in this state.
  writeFileSync(ledgerFile(root), read(root).replace('- Impact: high', '- Impact: enormous'), 'utf8');

  const text = ledger(root, ['validate']);
  const json = ledger(root, ['validate', '--json']);

  assert.equal(text.status, 1);
  assert.equal(json.status, 1);
  assert.equal(JSON.parse(json.stdout).ok, false);
  assert.ok(JSON.parse(json.stdout).problems.length > 0);
});

test('--root names the project, and the working directory does not', () => {
  const root = project();
  const elsewhere = project();

  const result = ledger(root, ['record', '--observed', '2026-09-18', '--source', 'review',
    '--scope', 'workflow', '--category', 'workaround', '--intervention', 'none', '--impact', 'low',
    '--title', 'Somewhere else', '--note', 'It happened.', '--evidence', 'issue:1'], { cwd: elsewhere });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(ledger(elsewhere, ['validate']).stdout.includes('No ledger'), true,
    'the other project is untouched');
});

test('there is no flag that points the write surface somewhere else', () => {
  const usage = run(['--help']).stdout;
  for (const escape of ['--file', '--out', '--ledger', '--path']) {
    assert.equal(usage.includes(escape), false,
      `${escape} would make the write surface negotiable`);
  }
});

test('--repeats refuses the fields that describe an observation rather than ignoring them', () => {
  // An occurrence is a date and its evidence; the rest belongs to the entry
  // being repeated. Accepting them would silently discard whatever was typed,
  // including a mistyped category the caller would believe was recorded.
  const root = project();
  recordOne(root, { candidate: 'Do the thing' });
  const before = read(root);

  for (const [flag, value] of [
    ['--category', 'BOGUS'], ['--category', 'workaround'], ['--impact', 'high'],
    ['--title', 'Something else'], ['--source', 'review'], ['--note', 'More prose.'],
    ['--candidate', 'A different fix'], ['--scope', 'project'], ['--intervention', 'none'],
  ]) {
    const result = ledger(root, ['record', '--repeats', '001', '--observed', '2026-09-19',
      '--evidence', 'pr:133', flag, value]);

    assert.equal(result.status, 1, `${flag} must be refused, not ignored`);
    assert.ok(result.stderr.includes(flag), `the refusal names ${flag}: ${result.stderr}`);
    assert.equal(read(root), before, 'and nothing is written');
  }

  assert.equal(ledger(root, ['record', '--repeats', '001', '--observed', '2026-09-19',
    '--evidence', 'pr:133']).status, 0, 'the applicable flags still work');
});

test('an unexpected filesystem failure still leaves by the documented door', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('running as root, where a read-only directory is not read-only');
    return;
  }

  const root = project();
  const directory = join(root, 'context');
  chmodSync(directory, 0o500);

  try {
    const text = ledger(root, ['record', ...observation()]);
    assert.equal(text.status, 1, 'exit 1, as the contract says for a failure');
    assert.match(text.stderr, /ledger: /, 'a stated refusal, not a stack trace');
    assert.equal(text.stdout.includes('at '), false);

    const json = ledger(root, ['record', ...observation(), '--json']);
    assert.equal(json.status, 1);
    const payload = JSON.parse(json.stdout);
    assert.equal(payload.ok, false, '--json callers get an envelope, never a traceback');
    assert.equal(payload.command, 'record');
  } finally {
    chmodSync(directory, 0o700);
  }
});
