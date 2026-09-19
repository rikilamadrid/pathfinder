/**
 * Source references: what a piece of evidence means to this pipeline.
 *
 * The grammar itself — `type:locator`, the nine types, the optional
 * `#L<from>-L<to>` range on `file:` and `doc:` — is not defined here. It is the
 * kit's shared primitive, `lib/evidence-references.mjs`, and this module
 * imports the four grammar exports and re-exports them so that `verify.mjs`
 * and the tests keep one import. Nothing in the redactor states the grammar a
 * second time.
 *
 * What stays here is meaning: which references a collected evidence bundle
 * can support, and whether a given reference resolves against it. That is the
 * article pipeline's question, not the grammar's, and it is answered nowhere
 * else in the kit.
 */

import {
  SOURCE_TYPES, parseSource, formatSource, extractSources,
} from '../../../lib/evidence-references.mjs';

export { SOURCE_TYPES, parseSource, formatSource, extractSources };

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
