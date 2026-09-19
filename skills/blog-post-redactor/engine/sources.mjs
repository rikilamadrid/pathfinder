/**
 * Source references: the identity of a piece of evidence.
 *
 * Every fact the pipeline carries names where it came from, in one grammar, so
 * that verification can ask a decidable question — does this reference resolve
 * against the bundle that was actually collected? Prose cannot answer that.
 * A string can.
 *
 * Grammar: `type:locator`, with an optional `#L<from>-L<to>` line range on
 * file references. Locators are opaque to this module; it owns the shape, not
 * the meaning.
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

/**
 * The set of references an evidence bundle can support. Built once and then
 * asked, rather than re-derived at every check.
 */
export function knownSources(bundle) {
  const known = new Set();
  if (!bundle || typeof bundle !== 'object') return known;

  for (const commit of bundle.commits ?? []) {
    if (commit.sha) known.add(`commit:${commit.sha}`);
  }
  for (const file of bundle.files ?? []) {
    if (file.path) known.add(`diff:${file.path}`);
  }
  for (const pr of bundle.prs ?? []) {
    if (pr.number != null) known.add(`pr:${pr.number}`);
  }
  for (const issue of bundle.issues ?? []) {
    if (issue.number != null) known.add(`issue:${issue.number}`);
  }
  for (const doc of bundle.docs ?? []) {
    if (doc.path) known.add(`doc:${doc.path}`);
  }
  for (const section of bundle.changelog?.sections ?? []) {
    if (section.heading) known.add(`changelog:${section.heading}`);
  }
  for (const suite of bundle.tests ?? []) {
    if (suite.path) known.add(`test:${suite.path}`);
  }
  for (const command of bundle.commands ?? []) {
    if (command.command) known.add(`cmd:${command.command}`);
  }
  return known;
}

/**
 * Whether a reference is supported by the bundle.
 *
 * A short commit sha is accepted against a longer collected one, because git
 * itself abbreviates and a reader copying a sha out of `git log --oneline`
 * should not produce an unsupported claim. A file reference with a line range
 * resolves on the path; the range is a reading aid, not a separate fact.
 */
export function resolves(ref, known) {
  const parsed = typeof ref === 'string' ? parseSource(ref) : ref;
  if (!parsed) return false;

  const bare = `${parsed.type}:${parsed.locator}`;
  if (known.has(bare)) return true;

  if (parsed.type === 'commit') {
    for (const candidate of known) {
      if (!candidate.startsWith('commit:')) continue;
      const sha = candidate.slice('commit:'.length);
      if (sha.startsWith(parsed.locator) || parsed.locator.startsWith(sha)) return true;
    }
  }

  // A `file:` reference is a claim about the repository rather than about the
  // change, so it resolves against collected docs and changed files alike.
  if (parsed.type === 'file') {
    return known.has(`doc:${parsed.locator}`) || known.has(`diff:${parsed.locator}`);
  }

  return false;
}
