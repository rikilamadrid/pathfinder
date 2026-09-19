/**
 * Kit files the documentation site does not publish.
 *
 * One statement, imported by both readers of `context/` — the content loader
 * in `loaders/kit.mjs`, which decides what becomes a page, and `nav.mjs`,
 * which decides what appears in the sidebar. Two lists would agree until the
 * day one of them was updated and the other was not, and the failure would be
 * a live project record quietly published on the public site. So there is one.
 *
 * `context/improvement-ledger.md` is this repository's own improvement ledger.
 * It is durable project truth and it is tracked in Git, but it is not
 * documentation: it holds real operational evidence — human interventions,
 * recovery failures, deferred review findings — and references into this
 * repository's own issues, pull requests and commits. What the site documents
 * is the mechanism and the shape of an entry, from
 * `templates/improvement-ledger.template.md` and the `reflect` skill page.
 * Pathfinder's own entries are for Pathfinder and for `reflect`, not for
 * readers of the site.
 *
 * A destination project is unaffected either way: its ledger is its own, and
 * this site never saw it.
 *
 * Paths are kit-relative and forward-slashed, matching a file's id without its
 * `.md`, so that both readers can ask the same question the same way.
 */
export const UNPUBLISHED = Object.freeze([
  'context/improvement-ledger.md',
]);

/** Ids, as the loader and the sidebar spell them: no extension. */
const IDS = new Set(UNPUBLISHED.map((path) => path.replace(/\.md$/, '')));

/**
 * Is this kit file one the site leaves alone?
 *
 * @param {string} id a kit-relative path without its extension, such as
 *   `context/improvement-ledger`
 */
export function isUnpublished(id) {
  return IDS.has(id);
}
