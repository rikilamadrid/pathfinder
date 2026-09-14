/**
 * The Pathfinder artifact identity: typography, spacing, colour, and chrome.
 *
 * This lives here, once, and every artifact kind inherits it by rendering into
 * the shell. Adding a kind must never mean restating, forking, or overriding
 * any of it — a kind supplies sections, not styling, and a producer supplies
 * neither.
 *
 * Colour is the project's own: blaze orange #E0611F, the paint on a real trail
 * marker, and bearing grey alongside it. Every pairing below was measured, not
 * eyeballed:
 *
 *   light  ink on page 17.25:1   muted 7.14:1   link 5.25:1   accent 3.47:1
 *   dark   ink on page 16.19:1   muted 7.89:1   link 9.51:1   accent 5.25:1
 *
 * WCAG 2.1 AA wants 4.5:1 for body text and 3:1 for interface boundaries and
 * focus indicators. Read the accent row again: 3.47:1 on the light page clears
 * the non-text bar and misses the text one. So `--pf-accent` is for the mark,
 * the focus ring, rules and fills — never for words. Words in accent colour
 * take `--pf-link`, which is the same hue darkened until it passes.
 *
 * Filled accent surfaces carry `--pf-accent-ink` rather than white for the same
 * arithmetic: white on blaze orange is 3.56:1, near-black is 4.97:1.
 *
 * No web font, no network request, no build step. The stack is whatever the
 * reader's system already has, so the artifact opens from `file://` and looks
 * the same tomorrow.
 */

export const THEME_CSS = `
:root {
  color-scheme: light;
  --pf-page: #FDFCFB;
  --pf-surface: #FFFFFF;
  --pf-surface-2: #F5F2EF;
  --pf-ink: #1B1815;
  --pf-muted: #5C5550;
  --pf-line: #E2DCD6;
  --pf-line-strong: #8C837A;
  --pf-accent: #E0611F;
  --pf-accent-ink: #1B1815;
  --pf-link: #B34A13;
  --pf-ok: #1F6F43;
  --pf-no: #A62B1E;
  --pf-shadow: 0 1px 2px rgba(27, 24, 21, .06), 0 8px 24px rgba(27, 24, 21, .05);

  --pf-space-1: .25rem;
  --pf-space-2: .5rem;
  --pf-space-3: .75rem;
  --pf-space-4: 1rem;
  --pf-space-5: 1.5rem;
  --pf-space-6: 2rem;
  --pf-space-7: 3rem;
  --pf-space-8: 4rem;

  --pf-radius: 10px;
  --pf-radius-sm: 6px;
  --pf-measure: 68ch;

  --pf-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;
  --pf-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
             "Liberation Mono", monospace;
}

/* Light is the base, so a reader whose system states no preference gets a
   readable page rather than whichever branch happened to be written first.
   "auto" follows the system; "light" and "dark" are the reader overriding it,
   and both win over the media query because they are on the element. */
:root[data-pf-theme="dark"] {
  color-scheme: dark;
  --pf-page: #14120F;
  --pf-surface: #1D1A16;
  --pf-surface-2: #262218;
  --pf-ink: #F2EEE9;
  --pf-muted: #B0A79E;
  --pf-line: #35302A;
  --pf-line-strong: #7A7168;
  --pf-accent: #E0611F;
  --pf-accent-ink: #1B1815;
  --pf-link: #F0A97E;
  --pf-ok: #6FD39B;
  --pf-no: #F09085;
  --pf-shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 8px 24px rgba(0, 0, 0, .3);
}

@media (prefers-color-scheme: dark) {
  :root[data-pf-theme="auto"] {
    color-scheme: dark;
    --pf-page: #14120F;
    --pf-surface: #1D1A16;
    --pf-surface-2: #262218;
    --pf-ink: #F2EEE9;
    --pf-muted: #B0A79E;
    --pf-line: #35302A;
    --pf-line-strong: #7A7168;
    --pf-accent: #E0611F;
    --pf-accent-ink: #1B1815;
    --pf-link: #F0A97E;
    --pf-ok: #6FD39B;
    --pf-no: #F09085;
    --pf-shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 8px 24px rgba(0, 0, 0, .3);
  }
}

*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--pf-page);
  color: var(--pf-ink);
  font-family: var(--pf-sans);
  font-size: 16px;
  line-height: 1.65;
  text-rendering: optimizeLegibility;
}

h1, h2, h3, h4 {
  line-height: 1.25;
  letter-spacing: -.011em;
  margin: 0;
  font-weight: 650;
}

p { margin: 0 0 var(--pf-space-4); max-width: var(--pf-measure); }
p:last-child { margin-bottom: 0; }

a { color: var(--pf-link); text-underline-offset: .18em; }
a:hover { text-decoration-thickness: 2px; }

:focus-visible {
  outline: 3px solid var(--pf-accent);
  outline-offset: 2px;
  border-radius: var(--pf-radius-sm);
}

code, pre, kbd { font-family: var(--pf-mono); font-size: .875em; }

/* ---------- skip link ---------- */

.pf-skip {
  position: absolute;
  left: var(--pf-space-3);
  top: var(--pf-space-3);
  z-index: 40;
  padding: var(--pf-space-2) var(--pf-space-4);
  background: var(--pf-accent);
  color: var(--pf-accent-ink);
  border-radius: var(--pf-radius-sm);
  font-weight: 600;
  transform: translateY(-200%);
}
.pf-skip:focus { transform: translateY(0); }

/* ---------- header ---------- */

.pf-header {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: var(--pf-space-4);
  padding: var(--pf-space-4) var(--pf-space-5);
  background: var(--pf-surface);
  border-bottom: 1px solid var(--pf-line);
}

.pf-mark { flex: none; color: var(--pf-accent); display: block; }

.pf-identity { min-width: 0; flex: 1 1 auto; }
.pf-title {
  font-size: 1.0625rem;
  font-weight: 650;
  letter-spacing: -.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pf-eyebrow {
  font-size: .6875rem;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--pf-muted);
}

.pf-theme-toggle {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--pf-space-2);
  padding: var(--pf-space-2) var(--pf-space-3);
  font: inherit;
  font-size: .8125rem;
  font-weight: 600;
  color: var(--pf-ink);
  background: var(--pf-surface-2);
  border: 1px solid var(--pf-line-strong);
  border-radius: 999px;
  cursor: pointer;
}
.pf-theme-toggle:hover { border-color: var(--pf-accent); }

/* ---------- layout ---------- */

.pf-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  max-width: 1180px;
  margin: 0 auto;
}

.pf-main {
  min-width: 0;
  padding: var(--pf-space-6) var(--pf-space-5) var(--pf-space-8);
}

/* ---------- navigation ---------- */

.pf-nav {
  position: sticky;
  top: 64px;
  z-index: 20;
  background: var(--pf-page);
  border-bottom: 1px solid var(--pf-line);
  padding: var(--pf-space-3) var(--pf-space-5);
  overflow-x: auto;
}

.pf-nav-label {
  display: none;
  font-size: .6875rem;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--pf-muted);
  margin-bottom: var(--pf-space-3);
}

.pf-nav-list {
  display: flex;
  gap: var(--pf-space-2);
  list-style: none;
  margin: 0;
  padding: 0;
}

.pf-nav-link {
  display: block;
  white-space: nowrap;
  padding: var(--pf-space-2) var(--pf-space-3);
  border-radius: 999px;
  border: 1px solid var(--pf-line);
  color: var(--pf-ink);
  text-decoration: none;
  font-size: .875rem;
  font-weight: 550;
}
.pf-nav-link:hover { border-color: var(--pf-accent); }
.pf-nav-link[aria-current="true"] {
  border-color: var(--pf-accent);
  background: var(--pf-surface-2);
  font-weight: 650;
}
.pf-nav-index {
  color: var(--pf-muted);
  font-variant-numeric: tabular-nums;
  margin-right: var(--pf-space-2);
}

/* ---------- lesson head ---------- */

.pf-lead {
  margin: 0 0 var(--pf-space-7);
  padding-bottom: var(--pf-space-6);
  border-bottom: 1px solid var(--pf-line);
}
.pf-lead h1 { font-size: clamp(1.75rem, 1.2rem + 2.2vw, 2.5rem); }
.pf-lead-sub {
  margin-top: var(--pf-space-3);
  font-size: 1.0625rem;
  color: var(--pf-muted);
  max-width: var(--pf-measure);
}
.pf-lead-summary { margin-top: var(--pf-space-4); }

.pf-objectives {
  margin: var(--pf-space-5) 0 0;
  padding: var(--pf-space-4) var(--pf-space-5);
  background: var(--pf-surface-2);
  border-radius: var(--pf-radius);
  border: 1px solid var(--pf-line);
  max-width: var(--pf-measure);
}
.pf-objectives ul { margin: var(--pf-space-2) 0 0; padding-left: 1.25rem; }
.pf-objectives li { margin-bottom: var(--pf-space-2); }
.pf-objectives li:last-child { margin-bottom: 0; }

/* ---------- modules and sections ---------- */

.pf-module { margin-bottom: var(--pf-space-8); scroll-margin-top: 128px; }
.pf-module-head { margin-bottom: var(--pf-space-5); }
/* --pf-link, not --pf-accent. This is 11px text, so WCAG 2.1 AA wants 4.5:1
   and the accent gives 3.47:1 on the light page — it clears the 3:1 non-text
   bar the mark and the focus ring rely on, and fails as soon as it becomes
   words. --pf-link is the accent darkened for exactly this: 5.25:1 light,
   9.51:1 dark. Any future accent-coloured *text* takes this token. */
.pf-module-index {
  font-size: .6875rem;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--pf-link);
}
.pf-module-title { font-size: 1.5rem; margin-top: var(--pf-space-2); }
.pf-module-summary { margin-top: var(--pf-space-3); color: var(--pf-muted); }

.pf-requires {
  margin-top: var(--pf-space-3);
  font-size: .8125rem;
  color: var(--pf-muted);
}
.pf-requires a { color: var(--pf-link); }

.pf-section { margin-bottom: var(--pf-space-6); scroll-margin-top: 128px; }
.pf-section-title { font-size: 1.125rem; margin-bottom: var(--pf-space-3); }

.pf-card {
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-radius);
  padding: var(--pf-space-5);
  box-shadow: var(--pf-shadow);
}
.pf-card--concept { border-left: 3px solid var(--pf-accent); }

.pf-kicker {
  display: inline-block;
  font-size: .625rem;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--pf-muted);
  margin-bottom: var(--pf-space-2);
}

/* ---------- evidence ---------- */

.pf-evidence {
  margin: var(--pf-space-5) 0 0;
  padding-top: var(--pf-space-4);
  border-top: 1px dashed var(--pf-line);
}
.pf-evidence-label {
  font-size: .625rem;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--pf-muted);
}
.pf-evidence ul { list-style: none; margin: var(--pf-space-2) 0 0; padding: 0; }
.pf-evidence li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--pf-space-2);
  padding: var(--pf-space-1) 0;
  font-family: var(--pf-mono);
  font-size: .8125rem;
  overflow-wrap: anywhere;
}
.pf-cite-path { color: var(--pf-ink); }
.pf-cite-lines, .pf-cite-commit {
  padding: 0 var(--pf-space-2);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-radius-sm);
  background: var(--pf-surface-2);
  color: var(--pf-muted);
  font-size: .75rem;
  white-space: nowrap;
}

/* ---------- code ---------- */

.pf-code { margin: 0; }
.pf-code figcaption {
  color: var(--pf-muted);
  font-size: .875rem;
  margin-bottom: var(--pf-space-3);
  max-width: var(--pf-measure);
}
.pf-code-frame {
  background: var(--pf-surface-2);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-radius);
  overflow: hidden;
}
.pf-code-lang {
  display: block;
  padding: var(--pf-space-2) var(--pf-space-4);
  border-bottom: 1px solid var(--pf-line);
  font-family: var(--pf-mono);
  font-size: .6875rem;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--pf-muted);
}
.pf-code pre {
  margin: 0;
  padding: var(--pf-space-4) 0;
  overflow-x: auto;
  line-height: 1.7;
  tab-size: 2;
}
.pf-code-line { display: block; padding: 0 var(--pf-space-4); white-space: pre; }
.pf-code-no {
  display: inline-block;
  width: 3ch;
  margin-right: var(--pf-space-4);
  text-align: right;
  color: var(--pf-muted);
  user-select: none;
  font-variant-numeric: tabular-nums;
}

/* ---------- flow ---------- */

.pf-flow { list-style: none; margin: 0; padding: 0; counter-reset: pf-step; }
.pf-flow > li {
  position: relative;
  counter-increment: pf-step;
  padding: 0 0 var(--pf-space-5) var(--pf-space-7);
}
.pf-flow > li:last-child { padding-bottom: 0; }
.pf-flow > li::before {
  content: counter(pf-step);
  position: absolute;
  left: 0;
  top: 0;
  width: 1.75rem;
  height: 1.75rem;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--pf-accent);
  color: var(--pf-accent-ink);
  font-size: .8125rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.pf-flow > li:not(:last-child)::after {
  content: "";
  position: absolute;
  left: calc(.875rem - 1px);
  top: 2rem;
  bottom: var(--pf-space-2);
  width: 2px;
  background: var(--pf-line);
}
.pf-step-title { font-weight: 650; }
.pf-step-detail { margin-top: var(--pf-space-2); color: var(--pf-muted); }
.pf-step-next {
  margin-top: var(--pf-space-2);
  font-size: .8125rem;
  color: var(--pf-muted);
}

/* ---------- quiz ---------- */

.pf-quiz { display: grid; gap: var(--pf-space-4); }
.pf-question { border: 0; margin: 0; padding: 0; }
.pf-question legend {
  padding: 0;
  font-weight: 650;
  margin-bottom: var(--pf-space-3);
  max-width: var(--pf-measure);
}
.pf-options { display: grid; gap: var(--pf-space-2); margin-bottom: var(--pf-space-3); }
.pf-option {
  display: flex;
  align-items: flex-start;
  gap: var(--pf-space-3);
  padding: var(--pf-space-3) var(--pf-space-4);
  border: 1px solid var(--pf-line-strong);
  border-radius: var(--pf-radius-sm);
  background: var(--pf-surface);
  cursor: pointer;
}
.pf-option:hover { border-color: var(--pf-accent); }
.pf-option input { margin: .35rem 0 0; accent-color: var(--pf-accent); flex: none; }
.pf-option[data-pf-verdict="correct"] {
  border-color: var(--pf-ok);
  box-shadow: inset 0 0 0 1px var(--pf-ok);
}
.pf-option[data-pf-verdict="incorrect"] {
  border-color: var(--pf-no);
  box-shadow: inset 0 0 0 1px var(--pf-no);
}
.pf-verdict { font-weight: 650; font-size: .8125rem; margin-left: auto; }
.pf-option[data-pf-verdict="correct"] .pf-verdict { color: var(--pf-ok); }
.pf-option[data-pf-verdict="incorrect"] .pf-verdict { color: var(--pf-no); }

/* ---------- disclosure ---------- */

.pf-reveal {
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-radius-sm);
  background: var(--pf-surface-2);
  padding: var(--pf-space-2) var(--pf-space-4);
}
.pf-reveal > summary {
  cursor: pointer;
  font-weight: 600;
  font-size: .875rem;
  padding: var(--pf-space-1) 0;
}
.pf-reveal[open] > summary { margin-bottom: var(--pf-space-3); }
.pf-reveal ol { margin: 0; padding-left: 1.25rem; }
.pf-reveal li { margin-bottom: var(--pf-space-2); }
.pf-reveal li:last-child { margin-bottom: 0; }

/* ---------- provenance ---------- */

.pf-provenance {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--pf-space-6) var(--pf-space-5) var(--pf-space-8);
  border-top: 1px solid var(--pf-line);
  color: var(--pf-muted);
  font-size: .8125rem;
}
.pf-provenance dl {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--pf-space-2) var(--pf-space-4);
  margin: 0 0 var(--pf-space-5);
}
.pf-provenance dt { font-weight: 650; color: var(--pf-ink); }
.pf-provenance dd { margin: 0; font-family: var(--pf-mono); overflow-wrap: anywhere; }
.pf-caveat { max-width: var(--pf-measure); }

/* ---------- wide ---------- */

@media (min-width: 900px) {
  .pf-layout {
    grid-template-columns: 248px minmax(0, 1fr);
    gap: var(--pf-space-6);
    padding: 0 var(--pf-space-5);
  }
  .pf-nav {
    top: 76px;
    align-self: start;
    max-height: calc(100vh - 96px);
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--pf-space-6) 0 var(--pf-space-6);
    border-bottom: 0;
    background: transparent;
  }
  .pf-nav-label { display: block; }
  .pf-nav-list { display: block; }
  .pf-nav-list li { margin-bottom: var(--pf-space-1); }
  .pf-nav-link {
    white-space: normal;
    border: 0;
    border-left: 2px solid var(--pf-line);
    border-radius: 0;
    padding: var(--pf-space-2) var(--pf-space-3);
  }
  .pf-nav-link[aria-current="true"] {
    border-left-color: var(--pf-accent);
    background: var(--pf-surface-2);
  }
  .pf-main { padding: var(--pf-space-7) 0 var(--pf-space-8); }
  .pf-provenance { padding-left: calc(248px + var(--pf-space-6) + var(--pf-space-5)); }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
}

@media print {
  .pf-header, .pf-nav, .pf-skip, .pf-theme-toggle { display: none; }
  .pf-card { box-shadow: none; break-inside: avoid; }
  .pf-reveal[open] > summary { list-style: none; }
}
`.trim();

/**
 * The explorer layout, shipped only to a kind that asked for it.
 *
 * Separate from `THEME_CSS` on exactly the same terms as a kind's own
 * stylesheet and a kind's own script: a lesson has no stage, and putting these
 * rules in the shared theme would send every lesson forty lines of layout it
 * can never use. The shell appends this when, and only when, a kind renders
 * into the explorer.
 *
 * It lives here rather than beside the diagram renderer because the markup it
 * styles — the screen wrapper and the stage — is the shell's, not a kind's. A
 * second kind that needs a canvas inherits this layout by choosing it, the same
 * way it inherits the header and the provenance footer.
 */
export const EXPLORER_CSS = `
/* ---------- the explorer layout ----------

   A kind with a canvas gets the first screen. The header and the stage are one
   flex column exactly one viewport tall, so the stage takes whatever the header
   leaves rather than subtracting a hard-coded header height that the next
   typography change would falsify.

   svh rather than vh, because a mobile browser's retracting toolbar makes
   vh taller than the screen and pushes the bottom of the stage out of sight;
   vh stays as the fallback for anything that does not know the unit.

   Everything below the stage is the ordinary article layout, unchanged. That is
   what keeps the written reading — every node, relationship, path, view and
   citation — a real part of the document rather than a thing the canvas
   replaced. */
[data-pf-layout="explorer"] .pf-screen {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100svh;
}
[data-pf-layout="explorer"] .pf-header { position: static; flex: 0 0 auto; }
[data-pf-layout="explorer"] .pf-stage {
  position: relative;
  flex: 1 1 auto;
  /* Without this a flex item refuses to shrink below its content, and the
     canvas would push the stage past the bottom of the screen. */
  min-height: 0;
  border-bottom: 1px solid var(--pf-line);
  background: var(--pf-surface-2);
}
/* The footer follows the page's gutter rather than the reading column's
   navigation offset. In the explorer the dominant element is full width, so
   indenting the footer to clear a 248px column it no longer sits beside would
   be aligning to something the reader cannot see. */
[data-pf-layout="explorer"] .pf-provenance { padding-left: var(--pf-space-5); }
@media (min-width: 900px) {
  [data-pf-layout="explorer"] .pf-provenance {
    padding-left: calc(var(--pf-space-5) * 2);
  }
}

/* ---------- enhanced: the map is the application ----------

   The data-pf-reading attribute exists only once scripting has run. Until then
   none of this applies, and the artifact is the article it always was: the map,
   then the whole written reading, then the provenance. That is the entire
   no-scripting obligation, and it is met by doing nothing.

   Once enhanced, the page becomes exactly the viewport -- header, stage, and
   the provenance row that is this artifact's whole point -- and the written
   reading closes behind one control. Not removed: every node, relationship,
   path, view and citation is still in the document, one press away. What is
   removed is a thirteen-thousand-pixel scroll under a map, which is what made
   an explorer read as documentation with a picture in it.

   The body becomes the flex column so the provenance is laid out with the
   screen rather than after it. Otherwise "one viewport" means one viewport
   plus a footer, and the page scrolls by exactly the amount that tells a
   reader they are in a document. */
[data-pf-layout="explorer"][data-pf-reading="closed"] {
  height: 100vh;
  height: 100svh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
[data-pf-layout="explorer"][data-pf-reading="closed"] .pf-screen {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
}
[data-pf-layout="explorer"][data-pf-reading="closed"] .pf-layout { display: none; }

/* Provenance stays on screen -- it is the point of the artifact, and an
   explorer that hides where its claims came from would be trading away the
   only thing that distinguishes it. What it does not get is forty percent of
   the first screen: closed, it is the identity strip, laid along one line so
   the map keeps the height. The caveat paragraph that qualifies the check is
   still in the document, one press from here, with the reading it belongs to.

   This is the same bargain as the reading itself. Nothing is removed, nothing
   is restated, and no second copy of any claim is made: one row is laid out
   differently and one paragraph waits to be asked for. */
[data-pf-layout="explorer"][data-pf-reading="closed"] .pf-provenance {
  flex: 0 0 auto;
  max-width: none;
  padding-block: var(--pf-space-3);
}
[data-pf-layout="explorer"][data-pf-reading="closed"] .pf-provenance dl {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--pf-space-2) var(--pf-space-4);
  margin: 0;
}
[data-pf-layout="explorer"][data-pf-reading="closed"] .pf-provenance dd {
  margin-right: var(--pf-space-4);
}
[data-pf-layout="explorer"][data-pf-reading="closed"] .pf-caveat { display: none; }

/* Reading open: the stage keeps a workable height so the map is still there to
   come back to, and the reading scrolls beneath it as it always did. */
[data-pf-layout="explorer"][data-pf-reading="open"] .pf-screen {
  height: 62vh;
  height: 62svh;
}
`.trim();
