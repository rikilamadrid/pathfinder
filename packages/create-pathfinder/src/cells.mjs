/**
 * How much room a string takes up on a terminal, and how to make it take less.
 *
 * Two functions, and the reason they exist is one measurement being wrong:
 * `theme.ok("✓ Git repository detected")` has a `.length` of 34 and occupies 25
 * cells. The nine-character difference is the SGR pair, which `.length` counts
 * as text because it is text — the terminal simply does not draw it.
 *
 * A renderer that repaints has to know the difference. If a line it believes is
 * one row wraps to two, every cursor-up it issues afterwards is off by one, and
 * the block it is redrawing walks down the screen leaving copies of itself
 * behind. That is not hypothetical: it was reproduced at 24 columns during the
 * prototype, five copies of the question for four keypresses.
 *
 * **Deliberately not a text-processing library.** No wrapping, no padding, no
 * alignment, no layout. Wrapping in particular is the tempting one and is
 * exactly what must not appear here: a function that breaks a line into several
 * is the beginning of a layout engine, and this module exists so that a caller
 * can guarantee *one* line stays one line.
 *
 * **Pure, and stricter than the theme about it.** `createTheme` at least reads
 * an environment it was handed. This reads nothing — no `process`, no glyph
 * table, no capability. The same string always measures the same, which is what
 * lets the tests state cell counts as constants.
 *
 * ## The character model, and what it is honest about
 *
 * Correct for everything Pathfinder actually prints, and not claimed to be
 * correct for everything. What it handles:
 *
 * - **ANSI escapes occupy nothing.** They are drawn by no terminal.
 * - **Wide characters occupy two cells** — CJK, Hangul, fullwidth forms, and
 *   the emoji planes the glyph table draws from.
 * - **Combining marks, zero-width joiners, and variation selectors occupy
 *   nothing**, because they modify the character before them rather than
 *   adding one.
 * - **Everything else occupies one cell.**
 *
 * What it gets wrong, on purpose, because neither can occur in this CLI:
 *
 * - **Emoji joined by ZWJ** — `👨‍👩‍👧` is one glyph of two cells, and this counts
 *   three of two, giving 6.
 * - **Skin-tone modifiers** — `👍🏽` is one glyph of two cells, counted as 4.
 *
 * Both **overcount**, and the direction is the whole reason they are tolerable.
 * Overcounting clips a line early, which is cosmetic. Undercounting lets a line
 * wrap, which is the corruption this module was written to prevent. Every
 * string that reaches a measured surface comes from a frozen registry or a
 * literal in this package, so neither case arises; if user text ever reaches
 * one, it will clip a little early rather than break the display.
 *
 * ## East Asian Ambiguous width is a policy, and the policy is "narrow"
 *
 * **Seven of the fourteen glyphs in `theme.mjs`** — `·`, `▲`, `—`, `…`, `━`,
 * `│`, `█` — are classified `Ambiguous` by Unicode, meaning they are one cell
 * beside Latin text and two in a legacy CJK context. **Feature 23's selector
 * adds five more glyphs, of which three are also Ambiguous** — `○`, `↑`, `↓`.
 * Ten of nineteen, once that lands.
 *
 * There is no correct answer available to a process that cannot ask the
 * terminal, so this is a decision rather than a lookup: **Ambiguous is
 * narrow**, which is what every modern terminal outside a CJK locale renders
 * and what the alternative implementations default to. It is asserted in the
 * tests so that changing it is a decision someone makes rather than a
 * regression someone ships.
 *
 * Note which glyphs are *not* on that list, because the grouping is not
 * intuitive: `✓`, `✗`, `░`, and `◉` are unambiguously narrow, while `○` beside
 * them is not. Ambiguity is a property of a character's history in legacy East
 * Asian encodings, not of how it looks.
 */

/**
 * A CSI sequence: ESC `[`, parameter bytes, one final letter.
 *
 * Sticky rather than global, so it can be anchored at a position instead of
 * searched for — the scanner below needs "is there an escape *here*", never
 * "is there an escape somewhere after here".
 *
 * Only CSI is recognised, because only CSI is emitted: `theme.mjs` produces SGR
 * colour codes and the two line primitives, all of which are CSI. An OSC
 * sequence would be measured as its literal characters, which would be wrong —
 * and is acceptable only because nothing in this package writes one. A stray
 * `ESC` that begins no valid sequence falls through to the character path and
 * measures zero, since it is a C0 control.
 */
const CSI = /\u001B\[[0-9;?]*[A-Za-z]/y;

/** An SGR sequence — a CSI whose final byte is `m`. The only kind that paints. */
const SGR_FINAL = "m";

/** `ESC[0m` and its abbreviation `ESC[m`. Both end every span the theme opens. */
const RESET = "\u001B[0m";
const isReset = (sequence) => sequence === RESET || sequence === "\u001B[m";

/**
 * Ranges rendered two cells wide.
 *
 * The standard Wide and Fullwidth set. Written as a sorted table of pairs and
 * searched linearly: it has twenty-one entries and is consulted once per
 * character of a handful of short lines, so a binary search would trade
 * legibility for time nobody is waiting on.
 *
 * **Sorted ascending, and `inRanges` depends on it** — that function stops as
 * soon as a range starts above the code point, so an entry inserted out of
 * order would not merely slow the search, it would silently stop matching.
 *
 * Four of these ranges cover no character this CLI prints today: `1F004`,
 * `1F200–1F2FF`, `1F7E0–1F7EB`, and `1FA70–1FAFF`. They are here anyway, and
 * the reason is the module's one safety property rather than coverage. Every
 * documented inaccuracy in this file *over*counts, which clips a line early and
 * costs a character. A missing Wide range does the opposite: it undercounts, so
 * a line that measured as fitting wraps, and a repainting caller's cursor-up
 * count is then wrong for every frame after it. Overcounting is cosmetic;
 * undercounting corrupts the display. A glyph chosen later from any of these
 * blocks — a coloured circle for a status dot is an entirely plausible future —
 * must not be able to introduce that quietly.
 */
const WIDE = Object.freeze([
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, CJK compatibility
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms, small form variants
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6], // fullwidth signs
  [0x1f004, 0x1f004], // mahjong tile red dragon
  [0x1f200, 0x1f2ff], // enclosed ideographic supplement
  [0x1f300, 0x1f64f], // symbols, pictographs, emoticons — `🔍` `📦` `📋` `🎉`
  [0x1f680, 0x1f6ff], // transport and map symbols
  [0x1f7e0, 0x1f7eb], // geometric shapes extended — the coloured circles
  [0x1f900, 0x1f9ff], // supplemental symbols and pictographs
  [0x1fa70, 0x1faff], // symbols and pictographs extended-A
  [0x20000, 0x3fffd], // CJK Extension B and beyond
]);

/**
 * Ranges that add nothing to a line's width.
 *
 * Combining marks attach to the character before them, and the joiners and
 * selectors steer how a sequence is drawn without being drawn themselves.
 * Counting any of them would overstate every accented word.
 */
const ZERO_WIDTH = Object.freeze([
  [0x0300, 0x036f], // combining diacritical marks
  [0x1ab0, 0x1aff], // combining diacriticals extended
  [0x1dc0, 0x1dff], // combining diacriticals supplement
  [0x200b, 0x200f], // zero-width space, ZWNJ, ZWJ, directional marks
  [0x20d0, 0x20f0], // combining marks for symbols
  [0xfe00, 0xfe0f], // variation selectors
  [0xfe20, 0xfe2f], // combining half marks
  [0xe0100, 0xe01ef], // variation selectors supplement
]);

/** Is `code` inside any of these `[low, high]` pairs? */
function inRanges(code, ranges) {
  for (const [low, high] of ranges) {
    if (code < low) return false; // sorted, so nothing later can match
    if (code <= high) return true;
  }
  return false;
}

/**
 * Cells occupied by one code point.
 *
 * C0 and C1 controls measure zero. They are not printable, and a terminal that
 * receives one either acts on it or discards it — either way it draws nothing,
 * so counting it would make every string containing an escape too wide.
 */
function codePointWidth(code) {
  if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return 0;
  if (inRanges(code, ZERO_WIDTH)) return 0;
  if (inRanges(code, WIDE)) return 2;
  return 1;
}

/**
 * Walk `text` as a sequence of escapes and code points.
 *
 * One scanner, shared by both public functions, so there is exactly one place
 * that decides where an escape begins and ends. Two implementations of that
 * question would eventually disagree, and the disagreement would show up as a
 * clipped line that measures correctly and renders wrong.
 *
 * @param {string} text
 * @yields {{escape: string|null, character: string|null, width: number}}
 */
function* scan(text) {
  let index = 0;

  while (index < text.length) {
    CSI.lastIndex = index;
    const match = CSI.exec(text);

    if (match !== null) {
      yield { escape: match[0], character: null, width: 0 };
      index = CSI.lastIndex;
      continue;
    }

    // `codePointAt` reads a surrogate pair as one value, and `fromCodePoint`
    // rebuilds both halves, so a character is never split down the middle.
    const code = text.codePointAt(index);
    const character = String.fromCodePoint(code);

    yield { escape: null, character, width: codePointWidth(code) };
    index += character.length;
  }
}

/**
 * How many terminal cells `text` occupies when printed.
 *
 * @param {string} text
 * @returns {number} cells, never negative
 */
export function width(text) {
  let total = 0;
  for (const token of scan(String(text))) total += token.width;
  return total;
}

/**
 * Shorten `text` to at most `cells` columns, leaving the terminal consistent.
 *
 * Three things it will not do, each of which is a way a naive slice breaks a
 * terminal rather than merely a line:
 *
 * - **Never cuts an escape sequence in half.** The tail of a severed `ESC[32m`
 *   is printed as literal text — `[32m` appears in the output — and the
 *   sequence never takes effect.
 * - **Never splits a character.** Half a surrogate pair is not a character;
 *   it renders as a replacement glyph.
 * - **Never leaves a colour open.** A cut inside a painted span drops that
 *   span's reset, and the colour then bleeds into everything printed
 *   afterwards, including output this package does not own. When that happens
 *   a reset is appended — the one byte sequence this function adds, and it adds
 *   it precisely so the damage stops at the clip.
 *
 * Escapes cost nothing against the budget, and every escape preceding text that
 * survives the cut is kept — so a clipped line keeps its colour rather than
 * losing its meaning. Severity in this CLI is carried by a glyph and a word as
 * well, but a line that silently changed colour when the window narrowed would
 * look like a different kind of message.
 *
 * What is *not* kept is an escape no visible character earned. See `pending`
 * below: a colour that paints nothing is not decoration, it is noise.
 *
 * @param {string} text
 * @param {number} cells - budget in columns. A budget of zero yields the empty
 *   string for text whose leading run is escapes and visible characters, which
 *   is every line this CLI renders. Two exceptions, both harmless and both
 *   stated rather than tidied away: a text made only of escapes occupies zero
 *   cells and is therefore already within any budget, so identity applies; and
 *   a *zero-width character* such as a leading `\r` costs nothing against the
 *   budget and is retained, so a string beginning with one clips to that
 *   character rather than to `""`. Nothing measured by this module begins with
 *   one — the progress bar does, and the progress bar is never clipped. A
 *   budget at or above the text's width yields the text unchanged.
 * @returns {string}
 */
export function clip(text, cells) {
  const source = String(text);

  // Identity when it already fits. Worth stating as its own case: the common
  // call passes a line that fits, and it should come back the same object's
  // value with nothing appended — including no reset.
  if (width(source) <= cells) return source;

  let kept = "";
  let used = 0;
  let painted = false;

  // Escapes seen but not yet earned.
  //
  // An escape costs no cells, so the tempting thing is to emit it the moment it
  // is seen. That produces two artefacts, both of which are output describing a
  // colour that paints nothing: a zero budget returns `ESC[32mESC[0m` instead of
  // the empty string, and a cut landing just after a paint leaves that paint
  // and its reset bracketing no text at all.
  //
  // Holding them until a visible character is actually kept fixes both, and
  // costs nothing else: escapes still never count against the budget, and every
  // escape preceding retained text is still emitted, in order.
  //
  // Held as tokens rather than a concatenated string on purpose — flushing has
  // to know which of them were SGR, and re-parsing a string to find out would
  // be the second escape-parsing path this module exists to avoid.
  let pending = [];

  for (const token of scan(source)) {
    if (token.escape !== null) {
      pending.push(token.escape);
      continue;
    }

    if (used + token.width > cells) break;

    for (const escape of pending) {
      kept += escape;
      // Only SGR opens or closes a paint. A cursor movement is not a colour,
      // and treating one as though it were would append resets to lines that
      // never had a span to close.
      if (escape.endsWith(SGR_FINAL)) painted = !isReset(escape);
    }
    pending = [];

    kept += token.character;
    used += token.width;
  }

  // Whatever is still pending trailed the last character we kept, so it is
  // discarded — including, possibly, the reset that would have closed a span.
  // That is exactly why `painted` is consulted here rather than trusted to the
  // input: the span is closed by the reset appended below.
  return painted ? kept + RESET : kept;
}
