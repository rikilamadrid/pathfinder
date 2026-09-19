/**
 * One runner, one fixture, every consumer of the evidence-reference grammar.
 *
 * The fixture states what the grammar does. This file states how to ask an
 * implementation whether it agrees. Both are here, in the primitive's own test
 * package, so that a consumer's suite adds a single call rather than a second
 * copy of the expectations — two copies of an expectation agree only until the
 * day they matter.
 *
 * Every consumer hands in the module a *reader of that skill* would import:
 * `lib/evidence-references.mjs` for the primitive itself,
 * `skills/blog-post-redactor/engine/sources.mjs` for the redactor, whose
 * re-export this proves transparent, and the ledger engine for `reflect` when
 * it exists. The label goes into every test name, so a disagreement names the
 * implementation that disagreed and the reference it disagreed on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const FIXTURE_PATH = new URL('./fixtures/references.json', import.meta.url);

export const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

const show = (value) => JSON.stringify(value);

/**
 * Run the whole fixture against one implementation of the grammar.
 *
 * @param {object} grammar module exposing SOURCE_TYPES, parseSource,
 *   formatSource and extractSources
 * @param {string} label how this implementation is named in test output
 */
export function runConformance(grammar, label) {
  const { SOURCE_TYPES, parseSource, formatSource, extractSources } = grammar;

  test(`${label}: declares exactly the nine grammar types, in order`, () => {
    assert.deepEqual([...SOURCE_TYPES], fixture.types);
  });

  for (const testCase of fixture.parse) {
    const name = `${label}: parse ${show(testCase.ref)}`;
    test(testCase.parses === null ? `${name} is refused` : name, () => {
      assert.deepEqual(parseSource(testCase.ref), testCase.parses, testCase.why);
    });
  }

  for (const testCase of fixture.parseNonString) {
    test(`${label}: parse refuses the non-string ${show(testCase.value)}`, () => {
      assert.equal(parseSource(testCase.value), null, testCase.why);
    });
  }

  // JSON cannot carry `undefined`, so the one case the fixture cannot state
  // lives here rather than going unchecked.
  test(`${label}: parse refuses undefined`, () => {
    assert.equal(parseSource(undefined), null);
  });

  for (const testCase of fixture.extract) {
    test(`${label}: extract from ${show(testCase.text)}`, () => {
      assert.deepEqual(
        extractSources(testCase.text).map((source) => source.ref),
        testCase.expect,
        testCase.why,
      );
    });
  }

  test(`${label}: extract returns parsed references, not strings`, () => {
    const [first] = extractSources('see `file:README.md#L1-L20`');
    assert.deepEqual(first, {
      type: 'file', locator: 'README.md', lines: { from: 1, to: 20 },
      ref: 'file:README.md#L1-L20',
    });
  });

  for (const testCase of fixture.extractNonString) {
    test(`${label}: extract from the non-string ${show(testCase.value)} is empty`, () => {
      assert.deepEqual(extractSources(testCase.value), [], testCase.why);
    });
  }

  test(`${label}: extract from undefined is empty`, () => {
    assert.deepEqual(extractSources(undefined), []);
  });

  for (const testCase of fixture.format) {
    test(`${label}: format ${testCase.type}:${testCase.locator} as ${show(testCase.expect)}`, () => {
      assert.equal(
        formatSource(testCase.type, testCase.locator, testCase.lines),
        testCase.expect,
        testCase.why,
      );
    });
  }

  for (const testCase of fixture.formatRefuses) {
    test(`${label}: format refuses the type ${show(testCase.type)}`, () => {
      assert.throws(
        () => formatSource(testCase.type, testCase.locator),
        new RegExp(testCase.message),
        testCase.why,
      );
    });
  }

  test(`${label}: format defaults to no line range`, () => {
    assert.equal(formatSource('file', 'README.md'), 'file:README.md');
  });

  for (const type of fixture.types) {
    test(`${label}: ${type} round-trips through format and parse`, () => {
      const parsed = parseSource(formatSource(type, fixture.roundTrip.locator));
      assert.equal(parsed.type, type, fixture.roundTrip.why);
      assert.equal(parsed.locator, fixture.roundTrip.locator);
      assert.equal(parsed.lines, null);
    });
  }
}
