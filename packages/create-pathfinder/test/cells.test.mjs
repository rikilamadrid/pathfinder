/**
 * The measurement model.
 *
 * Three things are asserted harder than the rest, because each is a decision
 * rather than a fact and would otherwise be changed by accident:
 *
 * - **`.length` disagrees, and by how much.** The whole module exists for that
 *   gap. A test that only checked `width` against itself would pass against a
 *   `width` that simply returned `.length`.
 * - **Ambiguous-width glyphs are narrow.** Nine of the theme's nineteen have no
 *   objectively correct width, so the choice is pinned here.
 * - **The known-wrong cases are known.** ZWJ and skin-tone sequences overcount.
 *   Asserting the wrong answer looks strange until you consider the
 *   alternative: someone "fixes" it, the overcount becomes an undercount
 *   somewhere else, and a line wraps in a terminal nobody was testing.
 *
 * The glyph tables below are written out literally rather than imported from
 * `theme.mjs`. Importing them would let a typo in the theme silently redefine
 * what this test checks — the point is to state, independently, what these
 * characters measure.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { clip, width } from "../src/cells.mjs";

const ESC = "\u001B";

/** Wrap text in an SGR pair, the way every `theme` paint does. */
const paint = (code, text) => `${ESC}[${code}m${text}${ESC}[0m`;

/** The decorated alphabet from `theme.mjs`, plus the selector's three. */
const UNICODE_GLYPHS = {
  ok: "✓",
  info: "·",
  warn: "▲",
  bad: "✗",
  dash: "—",
  ellipsis: "…",
  scan: "🔍",
  box: "📦",
  clipboard: "📋",
  party: "🎉",
  rule: "━",
  gutter: "│",
  barFull: "█",
  barEmpty: "░",
};

/** The ASCII alphabet. Every one of these is plain, and must measure as typed. */
const ASCII_GLYPHS = {
  ok: "+",
  info: "-",
  warn: "*",
  bad: "!",
  dash: "-",
  ellipsis: "...",
  scan: "(o)",
  box: "(=)",
  clipboard: "(:)",
  party: "\\o/",
  rule: "=",
  gutter: "|",
  barFull: "#",
  barEmpty: ".",
};

/** Glyphs the selector adds in Feature 23, measured here so 23 inherits them. */
const SELECTOR_GLYPHS = { pointer: "❯", on: "◉", off: "○", up: "↑", down: "↓" };

/**
 * Every glyph classified `Ambiguous` by Unicode, split by where it lives.
 *
 * Seven of `theme.mjs`'s fourteen, and three of the five the selector adds in
 * Feature 23 — ten of nineteen once that lands. The split is kept explicit
 * because an earlier version of this file said "nine of nineteen in theme.mjs",
 * which was wrong three ways: the theme has fourteen glyphs, `↑` and `○` are
 * not among them, and `↓` was missing from the list entirely.
 */
const AMBIGUOUS_IN_THEME = ["·", "▲", "—", "…", "━", "│", "█"];
const AMBIGUOUS_IN_SELECTOR = ["○", "↑", "↓"];
const AMBIGUOUS = [...AMBIGUOUS_IN_THEME, ...AMBIGUOUS_IN_SELECTOR];

/** Glyphs that look like they might be ambiguous and are not. */
const UNAMBIGUOUSLY_NARROW = ["✓", "✗", "░", "◉", "❯"];

describe("width — the decorated alphabet", () => {
  it("measures every non-emoji glyph as one cell", () => {
    for (const [name, glyph] of Object.entries(UNICODE_GLYPHS)) {
      if (["scan", "box", "clipboard", "party"].includes(name)) continue;
      assert.equal(width(glyph), 1, `${name} (${glyph}) should be one cell`);
    }
  });

  it("measures the four emoji as two cells", () => {
    for (const name of ["scan", "box", "clipboard", "party"]) {
      assert.equal(width(UNICODE_GLYPHS[name]), 2, `${name} should be two cells`);
    }
  });

  it("measures the selector's glyphs as one cell each", () => {
    for (const [name, glyph] of Object.entries(SELECTOR_GLYPHS)) {
      assert.equal(width(glyph), 1, `${name} (${glyph}) should be one cell`);
    }
  });
});

describe("width — the ASCII alphabet", () => {
  it("measures every ASCII glyph as its own character count", () => {
    for (const [name, glyph] of Object.entries(ASCII_GLYPHS)) {
      assert.equal(width(glyph), glyph.length, `${name} (${glyph}) is plain ASCII`);
    }
  });

  it("keeps the two alphabets the same size, so neither grows alone", () => {
    assert.deepEqual(Object.keys(UNICODE_GLYPHS), Object.keys(ASCII_GLYPHS));
  });

  it("measures the ASCII ellipsis wider than the Unicode one", () => {
    // The reason `cli.mjs` had to measure a rendered label rather than a stored
    // one. Three cells against one, in the row that decides a column's width.
    assert.equal(width(ASCII_GLYPHS.ellipsis), 3);
    assert.equal(width(UNICODE_GLYPHS.ellipsis), 1);
  });
});

describe("width — ANSI decoration", () => {
  it("counts every theme severity and emphasis paint as zero", () => {
    // green, cyan, yellow, red, bold, dim — the six `paint()` produces.
    for (const code of ["32", "36", "33", "31", "1", "2"]) {
      assert.equal(width(paint(code, "abc")), 3, `SGR ${code} should add nothing`);
    }
  });

  it("counts the brand at every colour depth as zero", () => {
    // Three different escape shapes, and the 24-bit one is the long form that a
    // naive `[0-9]` matcher would mis-parse at the semicolons.
    const depths = {
      24: `${ESC}[38;2;224;97;31m`,
      8: `${ESC}[38;5;166m`,
      4: `${ESC}[1m${ESC}[33m`,
    };

    for (const [depth, open] of Object.entries(depths)) {
      assert.equal(width(`${open}P A T H F I N D E R${ESC}[0m`), 19, `depth ${depth}`);
    }
  });

  it("counts the two line primitives as zero", () => {
    assert.equal(width(`\r${ESC}[2Kabc`), 3, "carriage return and clear-line draw nothing");
  });

  it("counts a cursor-up as zero, so Feature 23 inherits the behaviour", () => {
    assert.equal(width(`${ESC}[7Aabc`), 3);
  });

  it("measures a string that is nothing but escapes as zero", () => {
    assert.equal(width(`${ESC}[32m${ESC}[0m`), 0);
  });
});

describe("width — the disagreement with .length", () => {
  it("differs from .length by exactly the escape bytes", () => {
    // The measurement this module exists for. Pinned as constants: a `width`
    // that returned `.length` would fail here and nowhere else.
    const painted = paint(32, "✓ Git repository detected");

    assert.equal(painted.length, 34, ".length counts the escapes as text");
    assert.equal(width(painted), 25, "the terminal draws 25 cells");
  });

  it("agrees with .length for undecorated ASCII", () => {
    assert.equal(width("Claude Code"), "Claude Code".length);
  });

  it("agrees with .length for the emoji, which is a coincidence worth pinning", () => {
    // A non-BMP code point is two UTF-16 units *and* two cells. The agreement
    // is real but accidental, and it is why `.length` looked correct for so
    // long — every glyph in the table happens to match.
    assert.equal("🔍".length, 2);
    assert.equal(width("🔍"), 2);
  });
});

describe("width — East Asian Ambiguous is narrow, by policy", () => {
  it("measures the theme's seven ambiguous glyphs as one cell", () => {
    // Not a fact about these characters — a decision. Changing it is allowed;
    // changing it by accident is not.
    assert.equal(AMBIGUOUS_IN_THEME.length, 7);

    for (const glyph of AMBIGUOUS_IN_THEME) {
      assert.equal(width(glyph), 1, `${glyph} is Ambiguous and treated as narrow`);
    }
  });

  it("measures the selector's three ambiguous glyphs as one cell", () => {
    // `↓` is here because it was missing from the original list. Feature 23
    // inherits this policy, so it is pinned before 23 exists rather than after.
    assert.equal(AMBIGUOUS_IN_SELECTOR.length, 3);
    assert.ok(AMBIGUOUS_IN_SELECTOR.includes("↓"), "the one that was overlooked");

    for (const glyph of AMBIGUOUS_IN_SELECTOR) {
      assert.equal(width(glyph), 1, `${glyph} is Ambiguous and treated as narrow`);
    }
  });

  it("counts ten ambiguous glyphs across both sets", () => {
    assert.equal(AMBIGUOUS.length, 10, "seven in the theme, three in the selector");
  });

  it("does not treat lookalike glyphs as ambiguous", () => {
    // `◉` is narrow and `○` is not; `✓` is narrow and `▲` is not. Ambiguity
    // follows a character's history in legacy East Asian encodings, not its
    // shape, so the grouping cannot be guessed by eye.
    for (const glyph of UNAMBIGUOUSLY_NARROW) {
      assert.equal(width(glyph), 1, `${glyph} should measure one cell`);
      assert.ok(!AMBIGUOUS.includes(glyph), `${glyph} is not in the ambiguous set`);
    }
  });
});

describe("width — beyond the corpus", () => {
  it("measures genuinely wide scripts as two cells each", () => {
    assert.equal(width("日本語"), 6);
    assert.equal(width("한국어"), 6);
    assert.equal(width("ＡＢ"), 4, "fullwidth latin");
  });

  it("measures combining marks as adding nothing", () => {
    assert.equal(width("e\u0301"), 1, "e plus combining acute is one cell");
  });

  it("measures a variation selector as adding nothing", () => {
    assert.equal(width("▲\uFE0F"), 1);
  });

  it("overcounts ZWJ sequences, and this is the accepted limitation", () => {
    // A terminal draws one two-cell glyph. We count three. Documented in
    // `cells.mjs`, impossible in this CLI's corpus, and safe because it clips
    // early rather than wrapping.
    assert.equal(width("👨\u200D👩\u200D👧"), 6, "known overcount, not a defect to fix silently");
  });

  it("overcounts skin-tone modifiers, the same accepted limitation", () => {
    assert.equal(width("👍\uD83C\uDFFD"), 4, "known overcount");
  });
});

describe("width — no wide range may go missing", () => {
  /**
   * One representative per block a terminal draws two cells wide.
   *
   * Not about coverage of characters anyone prints — none of the four blocks
   * added in review appears in the CLI today. It exists because every other
   * inaccuracy in `cells.mjs` *over*counts, which clips early and costs a
   * character, whereas a missing Wide range *under*counts: a line measured as
   * fitting wraps, and every cursor-up a repainting caller issues afterwards is
   * wrong. Deleting a range here must fail a test, not pass quietly.
   */
  /**
   * Every sample is an *assigned* character, deliberately.
   *
   * The first draft of this table used each block's last code point — `1F2FF`,
   * `1FAFF` — which are unassigned, and which the reference implementation
   * therefore measures as one cell. The ranges in `cells.mjs` still cover the
   * whole block on purpose: blocks gain characters, and a future assignment
   * should inherit the wide default rather than silently undercount. But a test
   * that asserts a width for a character nobody can type is asserting nothing
   * useful, and it disagreed with `string-width` for a reason unrelated to the
   * property being protected.
   */
  const WIDE_SAMPLES = {
    "U+1F004 mahjong": "\u{1F004}",
    "U+1F200 enclosed ideographic": "\u{1F200}",
    "U+1F251 enclosed, near block top": "\u{1F251}",
    "U+1F7E0 coloured circle": "\u{1F7E0}",
    "U+1F7EB coloured square, block top": "\u{1F7EB}",
    "U+1FA70 pictographs ext-A": "\u{1FA70}",
    "U+1FAF8 pictographs ext-A, near top": "\u{1FAF8}",
    "U+1F50D magnifier (in the corpus)": "\u{1F50D}",
    "U+1F9FF supplemental, block top": "\u{1F9FF}",
    "U+4E00 CJK": "一",
    "U+AC00 Hangul": "가",
    "U+FF10 fullwidth digit": "０",
  };

  it("measures every wide block's representative as two cells", () => {
    for (const [name, character] of Object.entries(WIDE_SAMPLES)) {
      assert.equal(width(character), 2, `${name} must never undercount`);
    }
  });

  it("clips a wide character whole or not at all, in every block", () => {
    for (const [name, character] of Object.entries(WIDE_SAMPLES)) {
      assert.equal(clip(character, 1), "", `${name} cannot be half-drawn`);
      assert.equal(clip(character, 2), character, `${name} fits in two cells`);
    }
  });

  it("keeps the wide table sorted, which inRanges depends on", () => {
    // `inRanges` stops as soon as a range starts above the code point, so an
    // entry inserted out of order stops matching rather than merely slowing the
    // search — and the symptom is a two-cell character reported as one.
    const ascending = Object.values(WIDE_SAMPLES)
      .map((character) => character.codePointAt(0))
      .sort((a, b) => a - b);

    for (const code of ascending) {
      assert.equal(
        width(String.fromCodePoint(code)),
        2,
        `U+${code.toString(16).toUpperCase()} was not matched by the table`,
      );
    }
  });
});

describe("clip — the budget", () => {
  it("returns the text unchanged when it already fits", () => {
    const text = "Claude Code";
    assert.equal(clip(text, 11), text);
    assert.equal(clip(text, 99), text, "a budget larger than the text changes nothing");
  });

  it("appends nothing when returning unchanged, not even a reset", () => {
    const painted = paint(32, "ok");
    assert.equal(clip(painted, 99), painted);
  });

  it("returns the empty string at budget zero", () => {
    assert.equal(clip("Claude Code", 0), "");
    assert.equal(clip("", 0), "");
  });

  it("returns the empty string at budget zero for decorated text too", () => {
    // The fix from review. Emitting an escape the moment it is seen returned
    // `ESC[32mESC[0m` here — zero-width and balanced, so harmless, but a colour
    // that paints nothing is noise, and the docblock claimed "" outright.
    assert.equal(clip(paint(32, "Claude Code"), 0), "");
    assert.equal(clip(`${ESC}[1m${ESC}[33mPATHFINDER${ESC}[0m`, 0), "");
  });

  it("treats an all-escape string as already within budget", () => {
    // Distinct from the case above, and deliberately not "". This text occupies
    // zero cells, so it is already inside any budget and identity applies —
    // nothing was clipped, so there is nothing to have been dropped.
    const escapesOnly = `${ESC}[32m${ESC}[0m`;

    assert.equal(width(escapesOnly), 0);
    assert.equal(clip(escapesOnly, 0), escapesOnly);
  });

  it("never exceeds the budget, at any budget", () => {
    const text = "❯ ◉ Something else…  -> nothing is generated";

    for (let budget = 0; budget <= width(text) + 3; budget += 1) {
      assert.ok(
        width(clip(text, budget)) <= budget,
        `budget ${budget} produced ${width(clip(text, budget))} cells`,
      );
    }
  });
});

describe("clip — never breaks what it cuts", () => {
  const styled = `  ${paint(2, "│")}  ${paint(32, "✓ Claude Code")} — ${paint(1, "20")} adapters`;

  it("never emits a truncated escape sequence", () => {
    for (let budget = 0; budget <= width(styled) + 2; budget += 1) {
      const out = clip(styled, budget);
      assert.ok(
        !new RegExp(`${ESC}\\[[0-9;?]*$`).test(out),
        `budget ${budget} left a severed escape: ${JSON.stringify(out)}`,
      );
    }
  });

  it("never leaves a colour span open", () => {
    for (let budget = 0; budget <= width(styled) + 2; budget += 1) {
      const out = clip(styled, budget);

      let open = false;
      for (const sgr of out.match(new RegExp(`${ESC}\\[[0-9;]*m`, "g")) ?? []) {
        open = sgr !== `${ESC}[0m`;
      }

      assert.equal(open, false, `budget ${budget} bled colour: ${JSON.stringify(out)}`);
    }
  });

  it("keeps the escapes it passes, so a clipped line keeps its colour", () => {
    const out = clip(styled, 12);
    assert.ok(out.includes(`${ESC}[32m`), "the paint that was still open is kept");
  });

  it("emits no SGR pair that paints nothing", () => {
    // The second symptom of the same bug as `clip(decorated, 0)`: a cut landing
    // just after an opening paint used to keep that paint and its appended
    // reset around no text at all. At every budget, an opened span must have at
    // least one visible character after it.
    for (let budget = 0; budget <= width(styled) + 2; budget += 1) {
      const out = clip(styled, budget);

      assert.ok(
        !new RegExp(`${ESC}\\[[0-9;]*m${ESC}\\[0m$`).test(out),
        `budget ${budget} ended on an empty paint: ${JSON.stringify(out)}`,
      );
    }
  });

  it("drops trailing escapes that no kept character earned", () => {
    // `abc` fits; the paint and everything after it does not. The paint must
    // not survive on its own.
    const out = clip(`abc${paint(32, "def")}`, 3);
    assert.equal(out, "abc");
  });

  it("still emits leading escapes when a character does survive", () => {
    const out = clip(paint(32, "abcdef"), 3);

    assert.equal(out, `${ESC}[32mabc${ESC}[0m`);
    assert.equal(width(out), 3);
  });

  it("never splits a surrogate pair", () => {
    const text = "🔍🔍🔍";

    for (let budget = 0; budget <= 8; budget += 1) {
      const out = clip(text, budget);
      assert.ok(
        !/[\uD800-\uDBFF]$/.test(out),
        `budget ${budget} ended on a lone high surrogate`,
      );
      assert.equal(width(out) % 2, 0, "an emoji is kept whole or not at all");
    }
  });

  it("drops a two-cell character rather than half-drawing it", () => {
    // One cell of budget cannot hold a two-cell glyph, and half of one is not
    // a character. The budget goes unspent.
    assert.equal(clip("🔍", 1), "");
    assert.equal(clip("🔍", 2), "🔍");
  });

  it("clips a real selector row to a real terminal width", () => {
    // The regression the prototype found, stated as the case that produced it.
    const row = "❯ ◉ Something else…  -> nothing is generated";
    assert.ok(width(row) > 23);
    assert.ok(width(clip(row, 23)) <= 23);
  });
});

describe("cells — purity", () => {
  it("gives the same answer every time for the same input", () => {
    const text = paint(32, "✓ Git repository detected");
    assert.equal(width(text), width(text));
    assert.equal(clip(text, 10), clip(text, 10));
  });

  it("does not mutate its input", () => {
    const text = "❯ Claude Code";
    const before = String(text);
    clip(text, 4);
    width(text);
    assert.equal(text, before);
  });
});
