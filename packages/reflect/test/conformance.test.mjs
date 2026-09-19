/**
 * The ledger speaks the kit's evidence grammar, not a dialect of it.
 *
 * `packages/evidence-references/fixtures/references.json` is the one statement
 * of what a Pathfinder evidence reference is. The primitive's own suite runs it,
 * `blog-post-redactor` runs it through `sources.mjs`, and this runs it through
 * the ledger's two doors: `record`, which decides what may be written, and
 * `validate`, which decides what may stay written. A reference the redactor
 * accepts and the ledger refuses — or the reverse — fails here, by the
 * reference it disagreed on.
 *
 * That agreement is the whole reason the grammar moved to `lib/` in 54.1
 * instead of being restated here. This file is what turns that intention into
 * something CI can check.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import { parseSource } from '../../../lib/evidence-references.mjs';
import { cleanup, FIXTURE, ledger, ledgerFile, observation, project, read, recordOne } from '../harness.mjs';

after(cleanup);

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

const accepted = fixture.parse.filter((testCase) => testCase.parses !== null);
const refused = fixture.parse.filter((testCase) => testCase.parses === null);

test('the fixture is the shared one, and it is not empty', () => {
  assert.ok(accepted.length > 0 && refused.length > 0);
  assert.equal(String(FIXTURE).includes('evidence-references/fixtures/references.json'), true);
});

for (const testCase of accepted) {
  test(`record accepts the evidence ${JSON.stringify(testCase.ref)}`, () => {
    const root = project();
    const result = ledger(root, ['record', ...observation({ evidence: [testCase.ref] })]);

    assert.equal(result.status, 0,
      `the grammar accepts this reference, so the ledger must: ${result.stderr}`);
    assert.ok(read(root).includes(`\`${testCase.parses.ref}\``),
      'and must store it in the spelling the grammar defines');
  });
}

for (const testCase of refused) {
  test(`record refuses the evidence ${JSON.stringify(testCase.ref)}`, () => {
    const root = project();
    const result = ledger(root, ['record', ...observation({ evidence: [testCase.ref] })]);

    assert.equal(result.status, 1,
      'the grammar refuses this reference, so the ledger must too');
    assert.match(result.stderr, /is not an evidence reference|at least one evidence reference/);
  });
}

test('resolve reads --in through exactly the same grammar', () => {
  for (const testCase of accepted.slice(0, 8)) {
    const root = project();
    recordOne(root, { candidate: 'Do the thing' });
    ledger(root, ['resolve', '001', 'Proposed']);

    const result = ledger(root, ['resolve', '001', 'Approved', '--in', testCase.ref]);
    assert.equal(result.status, 0, `${testCase.ref}: ${result.stderr}`);
  }

  for (const testCase of refused.slice(0, 8)) {
    const root = project();
    recordOne(root, { candidate: 'Do the thing' });
    ledger(root, ['resolve', '001', 'Proposed']);

    const result = ledger(root, ['resolve', '001', 'Approved', '--in', testCase.ref]);
    assert.equal(result.status, 1, `${testCase.ref} must be refused`);
  }
});

test('validate refuses in the file exactly what record refuses on the command line', () => {
  for (const testCase of refused) {
    // A reference the command line would never have let through, planted in a
    // file by hand — which is the case `validate` exists for.
    if (testCase.ref.includes('`') || testCase.ref.trim() === '') continue;

    const root = project();
    recordOne(root);
    writeFileSync(ledgerFile(root),
      read(root).replace('- Evidence: `issue:111`', `- Evidence: \`${testCase.ref}\`, \`issue:111\``), 'utf8');

    const result = ledger(root, ['validate']);
    assert.equal(result.status, 1, `${testCase.ref} must not survive validation`);
    assert.match(result.stdout, /is not an evidence reference/);
  }
});

test('validate accepts in the file exactly what the grammar accepts', () => {
  for (const testCase of accepted) {
    const root = project();
    const recorded = ledger(root, ['record', ...observation({ evidence: [testCase.ref] })]);
    assert.equal(recorded.status, 0, recorded.stderr);

    const result = ledger(root, ['validate']);
    assert.equal(result.status, 0, `${testCase.ref}: ${result.stdout}`);
  }
});

test('the ledger defines no grammar of its own', () => {
  // The Feature asks for this by name: no reference-shaped regular expression
  // anywhere under the engine. A second parser would agree with the first one
  // until the day it did not.
  const sources = ['ledger.mjs', 'record.mjs', 'resolve.mjs', 'harvest.mjs', 'validate.mjs', 'vocabulary.mjs', 'bin/ledger.mjs'];

  for (const name of sources) {
    const source = readFileSync(new URL(`../../../skills/reflect/engine/${name}`, import.meta.url), 'utf8');
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    for (const type of fixture.types) {
      assert.equal(new RegExp(`['"\`]\\^?\\(?${type}\\|`).test(code), false,
        `${name} appears to list the reference types itself`);
    }
    assert.equal(/\[a-z\]\+\s*\\?:/.test(code), false,
      `${name} appears to match the \`type:locator\` shape itself`);
  }
});

test('every type the grammar declares is usable as ledger evidence', () => {
  for (const type of fixture.types) {
    const ref = `${type}:x`;
    assert.ok(parseSource(ref), 'precondition: the grammar accepts it');

    const root = project();
    const result = ledger(root, ['record', ...observation({ evidence: [ref] })]);
    assert.equal(result.status, 0, `${ref}: ${result.stderr}`);
  }
});
