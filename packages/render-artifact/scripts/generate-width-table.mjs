#!/usr/bin/env node
/**
 * Generate the renderer's pinned character-width table.
 *
 * The render path may not ask the engine it is running on how wide a character
 * is. Unicode property escapes — `\p{Mn}`, `\p{Emoji_Presentation}` — resolve
 * against whatever Unicode version the running JavaScript engine was built
 * with, and that version moves between Node releases. A renderer that consulted
 * them would lay a label out differently on two machines whose Node differed by
 * a minor version, which is precisely the class of ambient dependency the
 * determinism invariant exists to forbid.
 *
 * So the data is resolved once, here, and committed as literal ranges. This
 * script is maintainer tooling: it never ships, and the renderer never runs it.
 * Re-run it deliberately to adopt a newer Unicode version, and expect the
 * diagram goldens to move when you do — that is a renderer output change and is
 * governed by the version policy, not something to absorb quietly.
 *
 *   node scripts/generate-width-table.mjs
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { ENGINE_ROOT } from "../lib/harness.mjs";

/**
 * East Asian Wide and Fullwidth blocks that are not emoji.
 *
 * Hand-listed because `East_Asian_Width` is not a property escape JavaScript
 * exposes — `\p{East_Asian_Width=Wide}` throws — so unlike everything else in
 * this file it cannot be derived from the running engine at all. These are the
 * CJK, Hangul, Kana, and fullwidth-form blocks of Unicode's EastAsianWidth.txt,
 * the same set every terminal's `wcwidth` carries. The emoji half of the `W`
 * class is generated below from `\p{Emoji_Presentation}` rather than repeated
 * here, which is what keeps this list short enough to check by eye.
 */
const EAST_ASIAN_WIDE = [
  [0x1100, 0x115F], [0x231A, 0x231B], [0x2329, 0x232A],
  [0x2E80, 0x2E99], [0x2E9B, 0x2EF3], [0x2F00, 0x2FD5], [0x2FF0, 0x2FFB],
  [0x3000, 0x303E], [0x3041, 0x3096], [0x3099, 0x30FF], [0x3105, 0x312F],
  [0x3131, 0x318E], [0x3190, 0x31E3], [0x31F0, 0x321E], [0x3220, 0x3247],
  [0x3250, 0x4DBF], [0x4E00, 0xA48C], [0xA490, 0xA4C6], [0xA960, 0xA97C],
  [0xAC00, 0xD7A3], [0xF900, 0xFAFF], [0xFE10, 0xFE19], [0xFE30, 0xFE52],
  [0xFE54, 0xFE66], [0xFE68, 0xFE6B], [0xFF01, 0xFF60], [0xFFE0, 0xFFE6],
  [0x16FE0, 0x16FE4], [0x17000, 0x187F7], [0x18800, 0x18CD5],
  [0x1B000, 0x1B122], [0x1B150, 0x1B152], [0x1B164, 0x1B167],
  [0x1B170, 0x1B2FB],
  [0x20000, 0x2FFFD], [0x30000, 0x3FFFD],
];

/** Every code point matching a property escape, as merged ranges. */
function rangesMatching(test) {
  const ranges = [];
  let start = -1;
  for (let cp = 0; cp <= 0x10FFFF; cp += 1) {
    // Surrogates are not characters; skip rather than let them join a range.
    if (cp >= 0xD800 && cp <= 0xDFFF) { if (start >= 0) { ranges.push([start, cp - 1]); start = -1; } continue; }
    if (test(String.fromCodePoint(cp))) {
      if (start < 0) start = cp;
    } else if (start >= 0) {
      ranges.push([start, cp - 1]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, 0x10FFFF]);
  return ranges;
}

function merge(lists) {
  const all = lists.flat().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [lo, hi] of all) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) { if (hi > last[1]) last[1] = hi; continue; }
    out.push([lo, hi]);
  }
  return out;
}

const hex = (n) => `0x${n.toString(16).toUpperCase()}`;

function format(ranges, indent = "  ") {
  const lines = [];
  let row = [];
  for (const [lo, hi] of ranges) {
    row.push(`[${hex(lo)}, ${hex(hi)}]`);
    if (row.length === 4) { lines.push(indent + row.join(", ") + ","); row = []; }
  }
  if (row.length > 0) lines.push(indent + row.join(", ") + ",");
  return lines.join("\n");
}

// Width 0 — marks and formatting characters that occupy no column of their own.
// Mn and Me are the non-spacing and enclosing marks; Mc is deliberately absent,
// because a spacing combining mark does take a column. Cf carries the joiners
// and the bidi controls, including U+200D ZERO WIDTH JOINER, which is what
// makes an emoji ZWJ sequence measure as its parts rather than as its glyph —
// an over-estimate, and over-estimating reserves too much room rather than too
// little. Variation selectors are Mn and arrive with that set.
const zero = merge([rangesMatching((c) => /\p{Mn}/u.test(c) || /\p{Me}/u.test(c) || /\p{Cf}/u.test(c))]);

// Width 2 — the wide and fullwidth blocks, plus everything that defaults to an
// emoji presentation and is therefore drawn in a square cell.
const wide = merge([EAST_ASIAN_WIDE, rangesMatching((c) => /\p{Emoji_Presentation}/u.test(c))]);

const unicode = process.versions.unicode;

const source = `/**
 * How many columns a code point occupies. Generated, pinned, and never derived
 * at run time.
 *
 * GENERATED FILE — do not edit by hand.
 * Regenerate with \`node scripts/generate-width-table.mjs\` in
 * \`packages/render-artifact\`, deliberately, as an adopted Unicode upgrade.
 *
 * Pinned to **Unicode ${unicode}**, the version the generating engine carried.
 * The renderer does not consult the engine it runs on: \`\\p{Mn}\` and friends
 * resolve against whatever Unicode data that engine was compiled with, and that
 * moves between Node releases. Two machines would then lay the same label out
 * differently, which is the ambient dependency the determinism invariant
 * forbids. So the answer is frozen here as literal ranges.
 *
 * Three widths, and a total function:
 *
 *   0  non-spacing and enclosing marks, and format characters — including
 *      U+200D ZERO WIDTH JOINER and the variation selectors
 *   2  East Asian Wide and Fullwidth blocks, and default-emoji-presentation
 *   1  everything else, including every code point not named below
 *
 * The default of 1 is what makes this total. A code point Unicode assigns after
 * this table was pinned is measured as one column rather than throwing or
 * returning undefined, so a label in a script newer than the renderer still
 * lays out — narrower than it should be if that character is actually wide,
 * which the box's headroom absorbs.
 */

/** The Unicode version this table was generated from. */
export const UNICODE_VERSION = ${JSON.stringify(unicode)};

/** Code points that occupy no column. */
const ZERO_WIDTH = [
${format(zero)}
];

/** Code points that occupy two columns. */
const WIDE = [
${format(wide)}
];

/** Binary search over sorted, non-overlapping, inclusive ranges. */
function inRanges(ranges, cp) {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cp < ranges[mid][0]) { high = mid - 1; continue; }
    if (cp > ranges[mid][1]) { low = mid + 1; continue; }
    return true;
  }
  return false;
}

/**
 * The width of one code point, in columns.
 *
 * @param {number} cp a Unicode code point
 * @returns {0|1|2}
 */
export function codePointWidth(cp) {
  if (inRanges(ZERO_WIDTH, cp)) return 0;
  if (inRanges(WIDE, cp)) return 2;
  return 1;
}

/**
 * The width of a string, in columns.
 *
 * Iterates by code point — \`for...of\` over a string yields code points, not
 * UTF-16 units — so an astral character is measured once rather than twice.
 * No locale API, no segmenter, no normalization: each is either engine-version
 * dependent or locale dependent, and both are forbidden here.
 *
 * @param {string} text
 * @returns {number} columns
 */
export function cellWidth(text) {
  let width = 0;
  for (const character of String(text)) width += codePointWidth(character.codePointAt(0));
  return width;
}
`;

const target = join(ENGINE_ROOT, "render", "graph", "width.mjs");
writeFileSync(target, source, "utf8");
process.stdout.write(
  `wrote ${target}\n` +
  `  Unicode ${unicode}\n` +
  `  ${zero.length} zero-width range(s), ${wide.length} wide range(s)\n`);
