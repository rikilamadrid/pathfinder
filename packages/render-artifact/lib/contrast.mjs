/**
 * WCAG 2.1 contrast, computed from the renderer's own tokens.
 *
 * The values are parsed out of `theme.mjs` rather than restated here, so a
 * palette change cannot leave a passing measurement behind describing colours
 * nobody uses any more. The pairings come from `style.mjs`: each is a colour
 * the diagram actually paints and the surface it actually sits on.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ENGINE_ROOT } from "./harness.mjs";

/** Token values for one theme, read from the stylesheet the renderer ships. */
export function tokens(theme) {
  const css = readFileSync(join(ENGINE_ROOT, "render", "theme.mjs"), "utf8");
  const selector = theme === "dark" ? ':root[data-pf-theme="dark"] {' : ":root {";
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no ${theme} token block in theme.mjs`);
  const block = css.slice(start, css.indexOf("}", start));

  const out = {};
  for (const [, name, value] of block.matchAll(/(--pf-[a-z0-9-]+):\s*([^;]+);/g)) {
    const hex = value.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) out[name] = hex;
  }
  return out;
}

function channel(component) {
  const c = component / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
}

export function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Every diagram surface, the token it is painted with, what it sits on, and the
 * bar it has to clear.
 *
 * WCAG 2.1 asks 4.5:1 of body text and 3:1 of interface boundaries and other
 * non-text content. Which of the two applies is a property of what the surface
 * is for, so it is recorded per pairing rather than assumed.
 */
export const DIAGRAM_SURFACES = [
  { what: "node label", fg: "--pf-ink", bg: "--pf-surface", kind: "text" },
  { what: "node role caption", fg: "--pf-muted", bg: "--pf-surface", kind: "text" },
  { what: "node border", fg: "--pf-line-strong", bg: "--pf-surface", kind: "non-text" },
  { what: "node border, actor and external", fg: "--pf-accent", bg: "--pf-surface", kind: "non-text" },
  { what: "node border, terminal", fg: "--pf-ok", bg: "--pf-surface", kind: "non-text" },
  // Recorded, not required. WCAG 1.4.11 asks 3:1 of the visual information
  // needed to identify a component, and what identifies a node here is its
  // stroke, measured above and passing in both themes. The fill is a quiet
  // ground behind the label; holding a decorative fill to the boundary bar
  // would force a high-contrast checkerboard that carries no more meaning.
  { what: "node fill against the canvas", fg: "--pf-surface", bg: "--pf-surface-2", kind: "decorative" },
  { what: "edge line", fg: "--pf-line-strong", bg: "--pf-surface", kind: "non-text" },
  { what: "edge line on an authored path", fg: "--pf-accent", bg: "--pf-surface", kind: "non-text" },
  { what: "edge label", fg: "--pf-muted", bg: "--pf-surface", kind: "text" },
  { what: "edge label on an authored path", fg: "--pf-link", bg: "--pf-surface", kind: "text" },
  { what: "boundary border", fg: "--pf-line-strong", bg: "--pf-surface-2", kind: "non-text" },
  { what: "boundary label", fg: "--pf-muted", bg: "--pf-surface-2", kind: "text" },
  { what: "boundary fill against the page", fg: "--pf-surface-2", bg: "--pf-page", kind: "decorative" },
  // The focused component, which the explorer fills with the accent so it is
  // findable in one glance. Both words sitting on that fill are held to the
  // text bar rather than waved through as emphasis: the label and the role
  // caption are the same words they are anywhere else, and a reader who has
  // just selected the component is the likeliest person to be reading them.
  // The fill itself is held to the boundary bar against both grounds it can
  // land on -- the page, and a boundary's own fill -- because unlike an
  // ordinary node's quiet ground this one *is* the visual information that
  // identifies which component is selected.
  { what: "focused node label", fg: "--pf-accent-ink", bg: "--pf-accent", kind: "text" },
  { what: "focused node role caption", fg: "--pf-accent-ink", bg: "--pf-accent", kind: "text" },
  { what: "focused node fill against the page", fg: "--pf-accent", bg: "--pf-page", kind: "non-text" },
  { what: "focused node fill against a boundary", fg: "--pf-accent", bg: "--pf-surface-2", kind: "non-text" },
];

/**
 * The bar each kind of surface has to clear.
 *
 * `decorative` is not a lowered bar, it is the absence of one: a fill whose
 * component is identified by a stroke that does clear 1.4.11 is not itself
 * information the guideline covers. Those rows are still measured and still
 * reported, so the number is visible and a later change to them is a visible
 * change rather than a silent one.
 */
export const BAR = { text: 4.5, "non-text": 3, decorative: 0 };

/** Every surface measured in one theme. */
export function measure(theme) {
  const t = tokens(theme);
  return DIAGRAM_SURFACES.map((surface) => {
    const value = ratio(t[surface.fg], t[surface.bg]);
    return {
      ...surface,
      theme,
      fgHex: t[surface.fg],
      bgHex: t[surface.bg],
      ratio: Math.round(value * 100) / 100,
      bar: BAR[surface.kind],
      passes: value >= BAR[surface.kind],
    };
  });
}
