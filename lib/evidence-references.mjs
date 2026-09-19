/**
 * Evidence references: the identity of a piece of evidence.
 *
 * This is the kit's one statement of the evidence-reference grammar. Every
 * skill that lets an agent cite where a fact came from writes the citation in
 * this shape, so that a decidable question can be asked of it later: does this
 * reference name something that actually exists? Prose cannot answer that. A
 * string in one grammar can.
 *
 * Grammar: `type:locator`, with an optional `#L<from>-L<to>` line range on
 * `file:` and `doc:` references. Locators are opaque here.
 *
 * This module owns the shape and not the meaning. It reads no filesystem,
 * resolves nothing, and knows nothing about evidence bundles, articles or
 * ledgers. What a `commit:` resolves against, or whether a `file:` may stand
 * in for a `doc:`, is each consumer's decision, made in the consumer.
 *
 * Consumers:
 *   - `skills/blog-post-redactor/engine/sources.mjs`, which re-exports these
 *     four and adds resolution against a collected evidence bundle;
 *   - `reflect`'s improvement-ledger engine, which will validate the evidence
 *     lines of ledger entries against the same grammar. It does not exist
 *     yet; this file is what it will import, instead of importing another
 *     skill's engine, and that is why the grammar moved here.
 *
 * A change here changes every consumer at once, which is the point. A tenth
 * type is added here, with the conformance fixture in
 * `packages/evidence-references/fixtures/references.json` extended to match,
 * and only when a consumer genuinely needs it.
 */

export const SOURCE_TYPES = [
  'commit',   // commit:5314c14
  'diff',     // diff:skills/blog-post-redactor/SKILL.md
  'file',     // file:README.md#L1-L20
  'pr',       // pr:126
  'issue',    // issue:55
  'changelog',// changelog:[Unreleased]
  'doc',      // doc:context/history.md
  'test',     // test:packages/orchestrate
  'cmd',      // cmd:git log --oneline
];

const PATTERN = /^([a-z]+):(.+)$/;

export function parseSource(ref) {
  if (typeof ref !== 'string') return null;
  const match = PATTERN.exec(ref.trim());
  if (!match) return null;

  const [, type, rest] = match;
  if (!SOURCE_TYPES.includes(type)) return null;

  let locator = rest;
  let lines = null;

  const range = /#L(\d+)(?:-L(\d+))?$/.exec(rest);
  if (range && (type === 'file' || type === 'doc')) {
    locator = rest.slice(0, range.index);
    lines = { from: Number(range[1]), to: range[2] ? Number(range[2]) : Number(range[1]) };
  }

  if (!locator) return null;
  if (lines && lines.to < lines.from) return null;

  return { type, locator, lines, ref: ref.trim() };
}

export function formatSource(type, locator, lines = null) {
  if (!SOURCE_TYPES.includes(type)) {
    throw new Error(`unknown source type: ${type}`);
  }
  if (!lines) return `${type}:${locator}`;
  const suffix = lines.from === lines.to ? `#L${lines.from}` : `#L${lines.from}-L${lines.to}`;
  return `${type}:${locator}${suffix}`;
}

/** Every source reference mentioned in a Markdown body, in order, deduplicated. */
export function extractSources(text) {
  if (typeof text !== 'string') return [];
  const found = [];
  const seen = new Set();
  const pattern = new RegExp(`\`(${SOURCE_TYPES.join('|')}):([^\`]+)\``, 'g');

  for (const match of text.matchAll(pattern)) {
    const parsed = parseSource(`${match[1]}:${match[2]}`);
    if (parsed && !seen.has(parsed.ref)) {
      seen.add(parsed.ref);
      found.push(parsed);
    }
  }
  return found;
}
