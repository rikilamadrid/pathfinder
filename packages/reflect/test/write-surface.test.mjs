/**
 * The engine's write surface is one file, and this is the test that says so.
 *
 * Rather than asserting the claim, it enumerates: every file in a whole project
 * tree is hashed before and after each subcommand, and the set of paths that
 * differ is compared against the one path allowed to. Anything the engine
 * created, edited or deleted anywhere else would show up here by name —
 * including a stray lock file, a backup, or a temporary file it forgot to
 * clean up.
 *
 * The project is given decoys: files at the paths an engine like this one might
 * plausibly reach for, including the template it reads and a `context/` full of
 * the other files a real project has.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LEDGER_PATH } from '../../../skills/reflect/engine/ledger.mjs';
import { cleanup, ledger, project, recordOne, snapshot, touched } from '../harness.mjs';

after(cleanup);

/** A project that looks lived-in, so a stray write has somewhere to land. */
function furnished() {
  const root = project();

  mkdirSync(join(root, 'skills', 'reflect'), { recursive: true });
  mkdirSync(join(root, 'roles'), { recursive: true });
  mkdirSync(join(root, '.git'), { recursive: true });

  const decoys = {
    'context/history.md': '# History\n\n- something completed\n',
    'context/ai-interaction.md': '# AI Interaction\n',
    'context/coding-standards.md': '# Coding Standards\n',
    'context/current-ticket.md': '# Current Ticket\n\n- Ticket: 54.2\n',
    'context/tracker.md': '# Tracker\n',
    'skills/reflect/SKILL.md': '---\nname: reflect\n---\n',
    'roles/developer.md': '# Developer\n',
    'templates/history.template.md': '# History\n',
    '.git/HEAD': 'ref: refs/heads/main\n',
    'README.md': '# A project\n',
  };

  for (const [path, contents] of Object.entries(decoys)) {
    writeFileSync(join(root, ...path.split('/')), contents, 'utf8');
  }
  return root;
}

/** Run one command and return every path in the tree it changed. */
function changedBy(root, args) {
  const before = snapshot(root);
  const result = ledger(root, args);
  return { touched: touched(before, snapshot(root)), result };
}

test('record touches the ledger and nothing else', () => {
  const root = furnished();
  const { touched: paths, result } = changedBy(root, ['record',
    '--observed', '2026-09-18', '--source', 'review', '--scope', 'workflow',
    '--category', 'workflow-friction', '--intervention', 'decision', '--impact', 'low',
    '--title', 'A thing', '--note', 'It happened.', '--evidence', 'issue:1']);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(paths, [LEDGER_PATH]);
});

test('record --repeats touches the ledger and nothing else', () => {
  const root = furnished();
  recordOne(root);

  const { touched: paths, result } = changedBy(root,
    ['record', '--repeats', '001', '--observed', '2026-09-19', '--evidence', 'pr:133']);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(paths, [LEDGER_PATH]);
});

test('resolve touches the ledger and nothing else', () => {
  const root = furnished();
  recordOne(root, { candidate: 'Do the thing' });

  const proposed = changedBy(root, ['resolve', '001', 'Proposed']);
  assert.equal(proposed.result.status, 0, proposed.result.stderr);
  assert.deepEqual(proposed.touched, [LEDGER_PATH]);

  const approved = changedBy(root, ['resolve', '001', 'Approved', '--in', 'issue:130']);
  assert.equal(approved.result.status, 0, approved.result.stderr);
  assert.deepEqual(approved.touched, [LEDGER_PATH]);
});

test('harvest and validate touch nothing at all', () => {
  const root = furnished();
  recordOne(root, { candidate: 'Do the thing' });

  for (const args of [['harvest'], ['harvest', '--json'], ['validate'], ['validate', '--json']]) {
    assert.deepEqual(changedBy(root, args).touched, [], `${args.join(' ')} is read-only`);
  }
});

test('a refusal touches nothing, in every subcommand', () => {
  const root = furnished();
  recordOne(root);

  const refusals = [
    ['record', '--observed', '2026-09-18', '--source', 'nope', '--scope', 'workflow',
      '--category', 'workaround', '--intervention', 'none', '--impact', 'low',
      '--title', 'x', '--note', 'y', '--evidence', 'issue:1'],
    ['record', '--repeats', '404', '--observed', '2026-09-18', '--evidence', 'issue:1'],
    ['resolve', '001', 'Applied', '--in', 'pr:1'],
    ['resolve', '404', 'Proposed'],
  ];

  for (const args of refusals) {
    const { touched: paths, result } = changedBy(root, args);
    assert.equal(result.status, 1, `${args.join(' ')} must be refused`);
    assert.deepEqual(paths, [], `${args.join(' ')} must write nothing`);
  }
});

test('the whole lifecycle, end to end, touches exactly one path', () => {
  const root = furnished();
  const before = snapshot(root);

  ledger(root, ['record', '--observed', '2026-09-18', '--source', 'orchestration',
    '--scope', 'workflow', '--category', 'manual-recovery', '--intervention', 'recovery',
    '--impact', 'high', '--title', 'One', '--candidate', 'Fix it',
    '--note', 'It happened.', '--evidence', 'issue:111']);
  ledger(root, ['record', '--repeats', '001', '--observed', '2026-09-19', '--evidence', 'pr:133']);
  ledger(root, ['resolve', '001', 'Proposed']);
  ledger(root, ['resolve', '001', 'Approved', '--in', 'issue:130']);
  ledger(root, ['resolve', '001', 'Applied', '--in', 'pr:133']);
  ledger(root, ['harvest']);
  ledger(root, ['validate']);

  assert.deepEqual(touched(before, snapshot(root)), [LEDGER_PATH]);
});

test('the engine reaches for no network, no git and no store', () => {
  // Asserted from the source rather than by observation, because a call that
  // only fires on some path would not show up in a run that did not take it.
  const sources = [
    'ledger.mjs', 'record.mjs', 'resolve.mjs', 'harvest.mjs', 'validate.mjs', 'vocabulary.mjs',
    'bin/ledger.mjs',
  ];

  for (const name of sources) {
    const source = snapshotOf(name);
    for (const forbidden of ['child_process', 'node:http', 'node:https', 'fetch(', 'execSync', 'spawnSync']) {
      assert.equal(source.includes(forbidden), false,
        `${name} must not reach for ${forbidden}`);
    }
    for (const clock of ['Date.now(', 'new Date()']) {
      assert.equal(source.includes(clock), false,
        `${name} must read no clock: every date in the ledger is one a person gave it`);
    }
  }
});

function snapshotOf(name) {
  return readFileSync(new URL(`../../../skills/reflect/engine/${name}`, import.meta.url), 'utf8');
}
