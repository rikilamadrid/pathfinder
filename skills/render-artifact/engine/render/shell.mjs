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
import { THEME_CSS } from "./theme.mjs";
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
 * @param {string} parts.nav         rendered navigation HTML
 * @param {string} parts.body        rendered lead and content HTML
 * @param {object} parts.source      the specification's source identity
 * @param {object} [parts.verification] an attestation, when — and only when —
 *        this engine validated the specification and the validation passed
 * @returns {string} a complete HTML document
 */
export function renderShell(parts) {
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
    `<style>${THEME_CSS}</style>`,
    "</head>",
    "<body>",
    '<a class="pf-skip" href="#pf-content">Skip to content</a>',
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
    '<div class="pf-layout">',
    parts.nav,
    '<main class="pf-main" id="pf-content">',
    parts.body,
    "</main>",
    "</div>",
    renderProvenance(parts.source, parts.verification),
    `<script>${BEHAVIOR_JS}</script>`,
    "</body>",
    "</html>",
    "",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

/**
/**
 * What this artifact claims about itself, and when it is entitled to.
 *
 * The provenance rows are facts copied out of the specification and are always
 * shown. The verification sentence is a claim about work the engine performed,
 * so it appears only against a real attestation — which only
 * `verification.attest()` can mint, and only from a validation that passed.
 *
 * Rendering without one emits no verification language whatsoever. Not a
 * hedge, not "unverified", not a placeholder: an artifact that cannot vouch for
 * itself says nothing on the subject, and the absence of the sentence is the
 * signal. Saying "unverified" would still be the renderer making a claim about
 * a process it did not observe.
 *
 * Even with the attestation, note what the sentence is careful not to say. It
 * scopes itself to what was checked deterministically and hands the question of
 * whether the page reads well back to a person, because deterministic
 * validation never establishes that and must never be reported as if it did.
 */
const CHECKED =
  "This artifact was checked deterministically: its specification satisfied " +
  "the schema, its references and graphs resolved, and every citation above " +
  "was verified against the commit named here. That is what was checked. It " +
  "is not a judgement that the page reads well or looks right — a person has " +
  "to open it to know that.";

function renderProvenance(source, verification) {
  const rows = [
    ["Repository", source.repo],
    ["Commit", source.commit],
  ];
  if (source.generated_at) rows.push(["Specification generated", source.generated_at]);
  rows.push(["Renderer", `Pathfinder render-artifact ${RENDERER_VERSION}`]);

  return [
    '<footer class="pf-provenance">',
    "<dl>",
    ...rows.flatMap(([term, value]) =>
      [`<dt>${esc(term)}</dt>`, `<dd>${esc(value)}</dd>`]),
    "</dl>",
    isAttestation(verification) ? `<p class="pf-caveat">${esc(CHECKED)}</p>` : null,
    "</footer>",
  ].filter((line) => line !== null).join("\n");
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
