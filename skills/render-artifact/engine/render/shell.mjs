/**
 * The shared shell every artifact kind renders into.
 *
 * A kind supplies a lead, a navigation list, and a body. Everything else on the
 * page — the document head, the header, the mark, the theme control, the skip
 * link, the provenance block, and every word of interface language in them — is
 * the renderer's, defined once here. That is what "adding a kind must not
 * require restating the identity" means in practice: a second kind imports this
 * function and passes strings to it.
 *
 * Every string the renderer emits about the artifact's *subject* comes from the
 * specification. Every string it emits about the *interface* is written here.
 * The renderer asserts no domain content: it never summarises, rewords, or
 * invents a producer's claim.
 */

import { RENDERER_VERSION } from "../version.mjs";
import { isAttestation } from "../verification.mjs";
import { esc } from "./escape.mjs";
import { THEME_CSS, EXPLORER_CSS } from "./theme.mjs";
import { BEHAVIOR_JS } from "./behavior.mjs";

/**
 * The Pathfinder mark: the blaze stack from `assets/logo.svg`, drawn in
 * `currentColor` so it takes the accent in both themes. Inlined rather than
 * linked — an artifact that opens from `file://` cannot fetch a logo, and a
 * broken image in the header is worse than no header.
 */
const MARK = '<svg class="pf-mark" width="26" height="26" viewBox="0 0 32 32" ' +
  'aria-hidden="true" focusable="false"><g fill="currentColor">' +
  '<rect x="4" y="23" width="24" height="6.4" rx="3.2" transform="rotate(-3 16 26.2)"/>' +
  '<rect x="7" y="14.6" width="18" height="6" rx="3" transform="rotate(4 16 17.6)"/>' +
  '<rect x="9.6" y="7" width="12.8" height="5.4" rx="2.7" transform="rotate(-6 16 9.7)"/>' +
  '<rect x="12.4" y="1" width="7.2" height="4.4" rx="2.2" transform="rotate(5 16 3.2)"/>' +
  '</g></svg>';

/** The same mark as a favicon, percent-encoded inline. No network request. */
const FAVICON = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20" +
  "viewBox='0%200%2032%2032'%3E%3Cg%20fill='%23E0611F'%3E" +
  "%3Crect%20x='4'%20y='23'%20width='24'%20height='6.4'%20rx='3.2'%20transform='rotate(-3%2016%2026.2)'/%3E" +
  "%3Crect%20x='7'%20y='14.6'%20width='18'%20height='6'%20rx='3'%20transform='rotate(4%2016%2017.6)'/%3E" +
  "%3Crect%20x='9.6'%20y='7'%20width='12.8'%20height='5.4'%20rx='2.7'%20transform='rotate(-6%2016%209.7)'/%3E" +
  "%3Crect%20x='12.4'%20y='1'%20width='7.2'%20height='4.4'%20rx='2.2'%20transform='rotate(5%2016%203.2)'/%3E" +
  "%3C/g%3E%3C/svg%3E";

/**
 * The verification sentence below is deliberately here rather than in a kind
 * renderer: it describes what the *engine* did, not what a lesson is about, so
 * every kind that renders into this shell says it the same way or not at all.
 *
 * @param {object} parts
 * @param {string} parts.lang        BCP 47 tag from the specification, or "en"
 * @param {string} parts.title       artifact title
 * @param {string} parts.eyebrow     what kind of artifact this is
 * @param {string} [parts.description] meta description
 * @param {string} [parts.style]     a kind's own stylesheet, appended to the
 *        shared theme inside the one `<style>` element. Absent for a kind that
 *        needs none, and then not one byte of the document changes.
 * @param {string} [parts.behavior]  a kind's own inline script, appended to the
 *        shared behaviour inside the one `<script>` element, on the same terms
 *        and for the same reason: a lesson has no graph to traverse, and
 *        shipping it traversal code would put script in an artifact that can
 *        never run it. Absent for a kind that needs none, and then not one
 *        byte of the document changes.
 * @param {string} parts.nav         rendered navigation HTML
 * @param {string} parts.body        rendered lead and content HTML
 * @param {"article"|"explorer"} [parts.layout] which page shape this kind
 *        renders into. Defaults to `article` — the reading column with its
 *        navigation beside it, which is what every kind had before a kind
 *        needed a canvas. `explorer` gives the kind a full-width stage that
 *        fills the first screen, with `parts.body` still rendered into the
 *        same article layout beneath it.
 *
 *        This is deliberately one choice with two values rather than a set of
 *        layout knobs. A kind picks the page shape it needs; it cannot
 *        describe a page shape, and no specification field reaches this.
 * @param {string} [parts.stage]     what fills the explorer's stage. Ignored by
 *        the article layout, and absent for a kind that has no canvas — and
 *        then not one byte of the document changes.
 * @param {object} [parts.source]    the specification's source identity, when
 *        it declares one. A kind describing a system with no repository behind
 *        it has none, and then no provenance row is invented for it.
 * @param {"derived"|"proposed"} [parts.provenance] what kind of claim the
 *        artifact makes, for the kinds that distinguish. Absent for `lesson`.
 * @param {object} [parts.verification] an attestation, when — and only when —
 *        this engine validated the specification and the validation passed
 * @returns {string} a complete HTML document
 */
export function renderShell(parts) {
  // One structural choice, resolved once. Everything below reads this rather
  // than asking which kind is rendering: the shell has never known that, and
  // an explorer flag that meant "diagram" would be the same coupling wearing a
  // different name.
  const explorer = parts.layout === "explorer";

  const lines = [
    "<!doctype html>",
    `<html lang="${esc(parts.lang)}" data-pf-theme="auto">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(parts.title)}</title>`,
    parts.description
      ? `<meta name="description" content="${esc(parts.description)}">`
      : null,
    `<meta name="generator" content="Pathfinder render-artifact ${esc(RENDERER_VERSION)}">`,
    `<link rel="icon" href="${FAVICON}">`,
    `<style>${THEME_CSS}${explorer ? `\n${EXPLORER_CSS}` : ""}${parts.style ? `\n${parts.style}\n` : ""}</style>`,
    "</head>",
    explorer ? '<body data-pf-layout="explorer">' : "<body>",
    '<a class="pf-skip" href="#pf-content">Skip to content</a>',
    // The explorer's first screen: the header and the stage in one flex
    // column, so the stage takes whatever height the header leaves instead of
    // a hard-coded offset guessing at it. The reading below is outside this
    // wrapper and scrolls normally.
    explorer ? '<div class="pf-screen">' : null,
    '<header class="pf-header">',
    MARK,
    '<div class="pf-identity">',
    `<div class="pf-eyebrow">${esc(parts.eyebrow)}</div>`,
    `<div class="pf-title">${esc(parts.title)}</div>`,
    "</div>",
    // Hidden until the script un-hides it: a control that cannot work should
    // not be offered. Without scripting the theme still follows the system.
    '<button type="button" class="pf-theme-toggle" id="pf-theme-toggle" hidden>Theme: auto</button>',
    "</header>",
    explorer ? '<div class="pf-stage">' : null,
    explorer ? parts.stage : null,
    explorer ? "</div>" : null,
    explorer ? "</div>" : null,
    '<div class="pf-layout">',
    parts.nav,
    '<main class="pf-main" id="pf-content">',
    parts.body,
    "</main>",
    "</div>",
    renderProvenance(parts.source, parts.verification, parts.provenance),
    `<script>${BEHAVIOR_JS}${parts.behavior ? `\n${parts.behavior}` : ""}</script>`,
    "</body>",
    "</html>",
    "",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

/**
 * What this artifact claims about itself, and when it is entitled to.
 *
 * The provenance rows are facts copied out of the specification, and only the
 * ones it actually carries. The verification sentence is a claim about work the
 * engine performed, so it appears only against a real attestation — which only
 * `verification.attest()` can mint, and only from a validation that passed.
 *
 * Rendering without one emits no verification language whatsoever. Not a
 * hedge, not "unverified", not a placeholder: an artifact that cannot vouch for
 * itself says nothing on the subject, and the absence of the sentence is the
 * signal. Saying "unverified" would still be the renderer making a claim about
 * a process it did not observe.
 *
 * Even with the attestation, note what the sentences are careful not to say.
 * Each scopes itself to what was checked deterministically and hands the
 * question of whether the page reads well back to a person, because
 * deterministic validation never establishes that and must never be reported as
 * if it did. None of them says the system drawn is correct, and the `derived`
 * one in particular does not: what was verified is that the cited material is
 * there at the cited commit. Provenance, not truth.
 *
 * **Three states, three sentences, and none of them selectable.** There is no
 * field in any specification that chooses between these, softens one, or asks
 * for one it has not earned. The words belong to the renderer for the same
 * reason the claim does — a producer vouching for its own work is precisely
 * what this design exists to make impossible — and they live in the shared
 * shell rather than in a kind renderer because they describe what the *engine*
 * did, which is the same whatever kind rendered into it.
 */

/**
 * `lesson`, and any kind that draws no provenance distinction. Unchanged from
 * the wording that shipped, deliberately: the lesson artifact's language is not
 * what this contract set out to alter.
 */
const CHECKED =
  "This artifact was checked deterministically: its specification satisfied " +
  "the schema, its references and graphs resolved, and every citation above " +
  "was verified against the commit named here. That is what was checked. It " +
  "is not a judgement that the page reads well or looks right — a person has " +
  "to open it to know that.";

/**
 * `derived`: the strongest sentence the engine can write, and still not a
 * statement that the architecture is right. Every node, edge and claim carried
 * a citation, and each resolved — which establishes that the cited material is
 * in the repository at that commit, not that the reading of it is correct.
 */
const CHECKED_DERIVED =
  "This diagram was checked deterministically against the commit named here: " +
  "its specification satisfied the schema, its identifiers, references and " +
  "graphs resolved, and every component, relationship and claim in it carried " +
  "a citation that was verified at that commit. What that establishes is that " +
  "the cited material is there to be read. It is not a finding that the " +
  "architecture drawn here is correct, complete, or the best reading of that " +
  "material, and it is not a judgement that the page reads well — a person " +
  "has to open it to know either.";

/**
 * `proposed`, with a source and at least one citation that resolved. The
 * citations were checked; the design was not. The second half of this sentence
 * is the load-bearing half, and it is why this state cannot borrow the wording
 * above: a reader who met "verified against the commit" on a proposed
 * architecture would reasonably conclude the architecture was the thing found
 * in the repository.
 */
const CHECKED_PROPOSED =
  "This diagram describes a proposed design. Its specification satisfied the " +
  "schema, its identifiers, references and graphs resolved, and the citations " +
  "it supplied were verified against the commit named here. Those citations " +
  "establish that the material they name exists at that commit — they do not " +
  "establish that the system drawn here exists. Nothing was checked about " +
  "whether it does, and nothing here should be read as saying it does.";

/**
 * `proposed`, with no source at all. Not a verification sentence: there is
 * nothing to verify and the artifact says so in place of claiming anything.
 * Shown whether or not an attestation exists, because it is a fact about the
 * specification's own shape rather than a report of work the engine did.
 */
const NO_SOURCE =
  "This diagram describes an intended system. It names no repository and no " +
  "commit, so it carries no citations and none were checked — there is " +
  "nothing here that was verified against a source. It is a proposal, and it " +
  "makes no claim about what currently exists.";

function renderProvenance(source, verification, provenance) {
  // Built from what is present rather than from a fixed shape. A specification
  // with no source gets no repository row, no commit row and no timestamp —
  // none of them invented from the working directory, the environment, or a
  // clock, because there is no honest value for them and a plausible one would
  // be worse than none.
  const rows = [];
  if (source?.repo) rows.push(["Repository", source.repo]);
  if (source?.commit) rows.push(["Commit", source.commit]);
  if (source?.generated_at) rows.push(["Specification generated", source.generated_at]);
  rows.push(["Renderer", `Pathfinder render-artifact ${RENDERER_VERSION}`]);

  return [
    '<footer class="pf-provenance">',
    "<dl>",
    ...rows.flatMap(([term, value]) =>
      [`<dt>${esc(term)}</dt>`, `<dd>${esc(value)}</dd>`]),
    "</dl>",
    provenanceNote(source, verification, provenance),
    "</footer>",
  ].filter((line) => line !== null).join("\n");
}

/**
 * The one sentence this artifact is entitled to, or none.
 *
 * Two conditions gate every verification claim, and both are necessary. The
 * attestation proves this engine validated the specification and that the
 * validation passed. The resolved-citation count proves there was something to
 * check: a specification carrying no citations passes the evidence layer by
 * having nothing to fail, and a claim resting on that would be a stronger
 * statement than anybody made. Vacuous success earns no sentence.
 */
function provenanceNote(source, verification, provenance) {
  const caveat = (text) => `<p class="pf-caveat">${esc(text)}</p>`;

  // A proposal with no repository behind it. Said plainly, and said whatever
  // else is true, because it is a fact about the specification rather than a
  // report of anything the engine did.
  if (provenance === "proposed" && !source) return caveat(NO_SOURCE);

  if (!isAttestation(verification)) return null;
  if (!(verification.resolvedCitations >= 1)) return null;

  if (provenance === "derived") return caveat(CHECKED_DERIVED);
  if (provenance === "proposed") return caveat(CHECKED_PROPOSED);
  return caveat(CHECKED);
}

/**
 * The navigation list. One markup shape whatever the module count: a single
 * module renders the same list a sixty-module portal does, so nothing branches
 * on the number of entries and a later kind inherits the behaviour for free.
 */
export function renderNav(entries, label) {
  if (entries.length === 0) return "";
  return [
    `<nav class="pf-nav" aria-label="${esc(label)}">`,
    `<div class="pf-nav-label">${esc(label)}</div>`,
    '<ul class="pf-nav-list">',
    ...entries.map((entry, index) => [
      "<li>",
      `<a class="pf-nav-link" href="#${esc(entry.id)}" data-pf-nav="${esc(entry.id)}">`,
      `<span class="pf-nav-index">${index + 1}</span>${esc(entry.label)}`,
      "</a>",
      "</li>",
    ].join("")),
    "</ul>",
    "</nav>",
  ].join("\n");
}
