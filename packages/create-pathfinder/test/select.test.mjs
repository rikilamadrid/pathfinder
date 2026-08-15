/**
 * The keyboard selector.
 *
 * Two halves, tested differently on purpose.
 *
 * `renderBlock` is pure, so the rendering guarantees — no row ever wraps, the
 * suffix is whole or absent, the columns line up in both alphabets — are
 * asserted directly against strings at named widths. That is the prototype's
 * reproduced defect turned into a regression test, and it needs no terminal.
 *
 * `select` is driven over `PassThrough` streams with real escape sequences and
 * a real `readline` Interface, because the properties worth asserting about it
 * are properties of *borrowing*: which listeners exist before, during, and
 * after, and what bytes reach the stream. A mock of readline would be a mock of
 * the exact thing under test.
 *
 * `escapeCodeTimeout` is set small throughout. Node holds a lone `ESC` byte
 * until it can tell an Escape key from the start of an arrow sequence, and the
 * default window is 500ms — correct in production, and 500ms of wall clock per
 * assertion here.
 */

import { strict as assert } from "node:assert";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";

import { renderBlock, select } from "../src/select.mjs";
import { createTheme } from "../src/theme.mjs";

const ESC = "\u001B";
const KEY = Object.freeze({
  up: `${ESC}[A`,
  down: `${ESC}[B`,
  enter: "\r",
  space: " ",
  escape: ESC,
  interrupt: "\u0003",
});

/** A theme that offers selection, in whichever alphabet is asked for. */
function themeFor({ unicode = true, columns = 80 } = {}) {
  return createTheme({
    env: { LANG: unicode ? "en_US.UTF-8" : "C" },
    platform: "linux",
    isTTY: true,
    inputIsTTY: true,
    setRawMode: true,
    columns,
  });
}

/** The real harness prompt, the widest thing the CLI asks. */
const harnessOptions = (theme) => [
  { value: "claude-code", label: "Claude Code", hint: ".claude/skills/", note: "(detected)" },
  { value: "codex", label: "Codex", hint: ".agents/skills/" },
  { value: "other", label: `Something else${theme.glyph.ellipsis}`, hint: "nothing is generated" },
];

const editorOptions = [
  { value: "cursor", label: "Cursor" },
  { value: "code", label: "VS Code" },
  { value: null, label: "Don't open" },
];

const yesNo = [
  { value: true, label: "Yes", key: "y" },
  { value: false, label: "No", key: "n" },
];

// ---------------------------------------------------------------------------
// renderBlock — the rendering guarantees
// ---------------------------------------------------------------------------

describe("renderBlock — no row ever wraps", () => {
  it("keeps every row inside columns - 1, at every width, in both alphabets", () => {
    // The prototype's reproduced defect, as a regression test. At 24 columns it
    // drew five copies of the question for four keypresses, because a row that
    // takes two terminal rows makes every subsequent cursor-up off by one.
    for (const unicode of [true, false]) {
      for (const columns of [24, 32, 40, 49, 56, 80]) {
        const theme = themeFor({ unicode, columns });

        for (const multi of [true, false]) {
          const lines = renderBlock({
            theme,
            options: harnessOptions(theme),
            cursor: 0,
            selected: new Set([0, 1]),
            multi,
            columns,
          });

          for (const line of lines) {
            assert.ok(
              theme.width(line) <= columns - 1,
              `${unicode ? "unicode" : "ascii"} @${columns} multi=${multi}: ` +
                `${theme.width(line)} cells in ${columns - 1}: ${JSON.stringify(line)}`,
            );
          }
        }
      }
    }
  });

  it("returns one line per option plus a blank and a hint, so the row count is the line count", () => {
    const theme = themeFor();

    for (const count of [1, 2, 3, 7]) {
      const options = Array.from({ length: count }, (_, index) => ({
        value: index,
        label: `Option ${index}`,
      }));
      const lines = renderBlock({ theme, options, cursor: 0, columns: 80 });

      assert.equal(lines.length, count + 2);
      assert.equal(lines[count], "", "the blank line separating rows from the hint");
    }
  });

  it("never contains a newline inside a line, which would make one row two", () => {
    const theme = themeFor();
    const lines = renderBlock({ theme, options: harnessOptions(theme), cursor: 1, columns: 49 });

    for (const line of lines) assert.equal(line.includes("\n"), false);
  });
});

describe("renderBlock — the (detected) suffix is whole or absent", () => {
  it("appears exactly when the whole row fits, and the threshold is the ASCII one", () => {
    // Asserted as the rule rather than as a number, because the number belongs
    // to an alphabet: ASCII spends three cells on `[x]` where the decorated
    // alphabet spends one, so the suffix survives to a narrower terminal in
    // Unicode than in ASCII. Both thresholds are pinned below so a change to a
    // label or a path cannot move one silently.
    for (const unicode of [true, false]) {
      const detected = (columns) => {
        const theme = themeFor({ unicode, columns });
        const lines = renderBlock({
          theme,
          options: harnessOptions(theme),
          cursor: 0,
          multi: true,
          selected: new Set([0]),
          columns,
        });
        return { shown: lines[0].includes("(detected)"), fits: theme.width(lines[0]) <= columns - 1 };
      };

      let threshold = null;
      for (let columns = 20; columns <= 90; columns += 1) {
        const { shown, fits } = detected(columns);

        assert.ok(fits, `@${columns} the row did not fit`);
        if (shown && threshold === null) threshold = columns;
        if (threshold !== null) assert.ok(shown, `@${columns} lost a suffix it had shown at ${threshold}`);
      }

      // Pinned. The decorated alphabet keeps it from 53 columns; ASCII needs 57,
      // which is one more than the 56 the original derivation reported, because
      // that derivation measured `.claude/skills` and the CLI renders the
      // trailing slash. The floor of 49 is unaffected — the widest row is the
      // `nothing is generated` one, which carries no suffix.
      assert.equal(threshold, unicode ? 53 : 57, `${unicode ? "unicode" : "ascii"} threshold moved`);
    }
  });

  it("never leaves a fragment of it behind", () => {
    // Truncating to `(detec` would be strictly worse than dropping it: the
    // ENVIRONMENT phase already reported detection, so the suffix duplicates
    // information rather than carrying it.
    for (const unicode of [true, false]) {
      for (let columns = 20; columns <= 80; columns += 1) {
        const theme = themeFor({ unicode, columns });
        const lines = renderBlock({
          theme,
          options: harnessOptions(theme),
          cursor: 0,
          multi: true,
          selected: new Set([0]),
          columns,
        });

        for (const line of lines) {
          const fragment = /\((?!detected\))d?e?t?e?c?t?e?d?$/.test(line);
          assert.equal(fragment, false, `@${columns} left a fragment: ${JSON.stringify(line)}`);
        }
      }
    }
  });

  it("keeps the path context down to the floor, which is why the floor is 49", () => {
    for (const unicode of [true, false]) {
      const theme = themeFor({ unicode, columns: 49 });
      const lines = renderBlock({
        theme,
        options: harnessOptions(theme),
        cursor: 0,
        multi: true,
        selected: new Set(),
        columns: 49,
      });

      assert.ok(lines[2].endsWith("nothing is generated"), `@49 lost the path: ${JSON.stringify(lines[2])}`);
      assert.ok(lines[4].endsWith("enter confirm"), `@49 lost the hint: ${JSON.stringify(lines[4])}`);
    }
  });
});

describe("renderBlock — the marker column", () => {
  it("points at the highlighted row and at no other", () => {
    const theme = themeFor();
    const lines = renderBlock({ theme, options: editorOptions, cursor: 1, columns: 80 });

    assert.ok(lines[1].startsWith(theme.glyph.pointer));
    assert.equal(lines[0].startsWith(theme.glyph.pointer), false);
    assert.equal(lines[2].startsWith(theme.glyph.pointer), false);
  });

  it("spends the same width on no pointer as on one, so labels never shift", () => {
    const theme = themeFor();
    const first = renderBlock({ theme, options: editorOptions, cursor: 0, columns: 80 });
    const second = renderBlock({ theme, options: editorOptions, cursor: 1, columns: 80 });

    assert.equal(theme.width(first[0]), theme.width(second[0]));
    assert.equal(first[0].indexOf("Cursor"), second[0].indexOf("Cursor"));
  });

  it("draws a checkbox only in multi-select, and shows its state", () => {
    const theme = themeFor();

    const single = renderBlock({ theme, options: editorOptions, cursor: 0, columns: 80 });
    assert.equal(single[0].includes(theme.glyph.checked), false);
    assert.equal(single[0].includes(theme.glyph.unchecked), false);

    const multi = renderBlock({
      theme,
      options: editorOptions,
      cursor: 0,
      selected: new Set([0, 2]),
      multi: true,
      columns: 80,
    });
    assert.ok(multi[0].includes(theme.glyph.checked));
    assert.ok(multi[1].includes(theme.glyph.unchecked));
    assert.ok(multi[2].includes(theme.glyph.checked));
  });

  it("aligns the second column against rendered width, not .length", () => {
    // `Something else…` is one cell of ellipsis in the decorated alphabet and
    // three in ASCII, so an alignment computed from `.length` puts the arrows
    // in different places in the two alphabets — and in the wrong place in
    // either one the moment a label carries an escape sequence.
    for (const unicode of [true, false]) {
      const theme = themeFor({ unicode });
      const lines = renderBlock({
        theme,
        options: harnessOptions(theme),
        cursor: 0,
        multi: true,
        columns: 80,
      });

      const columnOf = (line) => theme.width(line.slice(0, line.indexOf("  -> ")));
      const columns = lines.slice(0, 3).map(columnOf);

      assert.equal(new Set(columns).size, 1, `arrows did not line up: ${JSON.stringify(lines.slice(0, 3))}`);
    }
  });

  it("adds no padding when there is no second column to align against", () => {
    const theme = themeFor();
    const lines = renderBlock({ theme, options: editorOptions, cursor: 0, columns: 80 });

    for (const line of lines) assert.equal(line, line.trimEnd(), `trailing whitespace: ${JSON.stringify(line)}`);
  });
});

describe("renderBlock — the hint line", () => {
  it("names space only where space does something", () => {
    const theme = themeFor();

    const multi = renderBlock({ theme, options: editorOptions, cursor: 0, multi: true, columns: 80 });
    assert.ok(multi.at(-1).includes("space toggle"));

    const single = renderBlock({ theme, options: editorOptions, cursor: 0, columns: 80 });
    assert.equal(single.at(-1).includes("space"), false);
  });

  it("does not advertise the hidden accelerators", () => {
    // They are a courtesy to an old habit, not a second interaction to learn.
    const theme = themeFor();
    const lines = renderBlock({ theme, options: yesNo, cursor: 0, columns: 80 });

    assert.equal(lines.at(-1).includes("y/n"), false);
    assert.equal(lines.at(-1).includes("[Y/n]"), false);
  });

  it("uses the arrow glyphs of whichever alphabet is in play", () => {
    assert.ok(
      renderBlock({ theme: themeFor(), options: yesNo, cursor: 0, columns: 80 }).at(-1).includes("↑↓"),
    );
    assert.ok(
      renderBlock({ theme: themeFor({ unicode: false }), options: yesNo, cursor: 0, columns: 80 })
        .at(-1)
        .includes("^v"),
    );
  });
});

// ---------------------------------------------------------------------------
// select — the key loop and the borrowed terminal
// ---------------------------------------------------------------------------

/**
 * A readline Interface over two pipes, plus everything a test needs to press a
 * key at it and read what came back.
 */
function harness({ columns = 80, unicode = true } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.columns = columns;

  let written = "";
  output.on("data", (chunk) => {
    written += chunk.toString();
  });

  const readline = createInterface({ input, output, terminal: true, escapeCodeTimeout: 20 });

  return {
    readline,
    input,
    output,
    theme: themeFor({ unicode, columns }),
    get written() {
      return written;
    },
    /** Press keys, one at a time, giving the decoder room between them. */
    async press(...keys) {
      for (const key of keys) {
        input.write(key);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    },
    counts: () => ({
      keypress: input.listeners("keypress").length,
      resize: output.listeners("resize").length,
    }),
    close() {
      readline.close();
    },
  };
}

describe("select — key handling", () => {
  it("confirms the highlighted row with Enter", async () => {
    const bench = harness();
    const answered = select({ readline: bench.readline, theme: bench.theme, question: "Pick one", options: editorOptions });

    await bench.press(KEY.enter);
    assert.equal(await answered, "cursor");
    bench.close();
  });

  it("moves down and up, and wraps in both directions", async () => {
    const bench = harness();
    const answered = select({ readline: bench.readline, theme: bench.theme, question: "Pick one", options: editorOptions });

    // Three rows: down past the end wraps to the top, then up wraps to the end.
    await bench.press(KEY.down, KEY.down, KEY.down, KEY.up, KEY.enter);
    assert.equal(await answered, null, "wrapped to the last row, which is Don't open");
    bench.close();
  });

  it("accepts k and j as well as the arrows", async () => {
    const bench = harness();
    const answered = select({ readline: bench.readline, theme: bench.theme, question: "Pick one", options: editorOptions });

    await bench.press("j", "j", "k", KEY.enter);
    assert.equal(await answered, "code");
    bench.close();
  });

  it("starts on the row the caller defaulted to", async () => {
    const bench = harness();
    const answered = select({
      readline: bench.readline,
      theme: bench.theme,
      question: "Pick one",
      options: editorOptions,
      initial: ["code"],
    });

    await bench.press(KEY.enter);
    assert.equal(await answered, "code");
    bench.close();
  });

  it("toggles with Space and returns the checked values in list order", async () => {
    const bench = harness();
    const answered = select({
      readline: bench.readline,
      theme: bench.theme,
      question: "Pick any",
      options: editorOptions,
      multi: true,
    });

    // Check the third, then the first, and expect them back in list order.
    await bench.press(KEY.down, KEY.down, KEY.space, KEY.up, KEY.up, KEY.space, KEY.enter);
    assert.deepEqual(await answered, ["cursor", null]);
    bench.close();
  });

  it("starts with the caller's selection already checked", async () => {
    const bench = harness();
    const answered = select({
      readline: bench.readline,
      theme: bench.theme,
      question: "Pick any",
      options: editorOptions,
      multi: true,
      initial: ["code"],
    });

    await bench.press(KEY.enter);
    assert.deepEqual(await answered, ["code"]);
    bench.close();
  });

  it("returns an empty array when everything is unchecked, which is not null", async () => {
    // An explicit choice of nothing and nobody answering are different answers,
    // and every call site already reads them differently.
    const bench = harness();
    const answered = select({
      readline: bench.readline,
      theme: bench.theme,
      question: "Pick any",
      options: editorOptions,
      multi: true,
      initial: ["cursor"],
    });

    await bench.press(KEY.space, KEY.enter);
    assert.deepEqual(await answered, []);
    bench.close();
  });

  it("ignores Space in a single-select rather than answering with it", async () => {
    const bench = harness();
    const answered = select({ readline: bench.readline, theme: bench.theme, question: "Pick one", options: editorOptions });

    await bench.press(KEY.space, KEY.down, KEY.enter);
    assert.equal(await answered, "code");
    bench.close();
  });

  it("returns null on Escape", async () => {
    const bench = harness();
    const answered = select({ readline: bench.readline, theme: bench.theme, question: "Pick one", options: editorOptions });

    await bench.press(KEY.escape);
    assert.equal(await answered, null);
    bench.close();
  });

  it("returns null when the stream ends mid-question", async () => {
    const bench = harness();
    const answered = select({ readline: bench.readline, theme: bench.theme, question: "Pick one", options: editorOptions });

    bench.readline.close();
    assert.equal(await answered, null);
  });

  it("ignores unknown keys rather than echoing them", async () => {
    const bench = harness();
    const answered = select({ readline: bench.readline, theme: bench.theme, question: "Pick one", options: editorOptions });

    await bench.press("q", "Z", "!", "\t");
    const beforeEnter = bench.written;
    assert.equal(beforeEnter.includes("q"), false, "a stray key was echoed");
    assert.equal(beforeEnter.includes("!"), false, "a stray key was echoed");

    await bench.press(KEY.enter);
    assert.equal(await answered, "cursor");
    bench.close();
  });

  it("answers in one keystroke through a hidden accelerator", async () => {
    const bench = harness();
    const answered = select({
      readline: bench.readline,
      theme: bench.theme,
      question: "Really?",
      options: yesNo,
      initial: [true],
    });

    await bench.press("n");
    assert.equal(await answered, false);
    bench.close();
  });

  it("does not let an accelerator submit a checkbox list", async () => {
    const bench = harness();
    const answered = select({
      readline: bench.readline,
      theme: bench.theme,
      question: "Pick any",
      options: [{ value: "yaml", label: "YAML", key: "y" }],
      multi: true,
    });

    await bench.press("y", KEY.enter);
    assert.deepEqual(await answered, []);
    bench.close();
  });

  it("survives a one-option list, where every movement is a no-op", async () => {
    const bench = harness();
    const answered = select({
      readline: bench.readline,
      theme: bench.theme,
      question: "Pick one",
      options: [{ value: "only", label: "The only one" }],
    });

    await bench.press(KEY.up, KEY.down, KEY.up, KEY.enter);
    assert.equal(await answered, "only");
    bench.close();
  });

  it("asks nothing at all when there is nothing to choose between", async () => {
    const bench = harness();

    assert.equal(await select({ readline: bench.readline, theme: bench.theme, question: "Pick", options: [] }), null);
    assert.equal(bench.written, "", "an empty list printed a hint nobody could dismiss");
    bench.close();
  });
});

describe("select — the borrowed terminal", () => {
  it("borrows exactly one listener from each stream and gives both back", async () => {
    const bench = harness();
    const before = bench.counts();
    assert.deepEqual(before, { keypress: 1, resize: 1 }, "readline's own listeners");

    const answered = select({ readline: bench.readline, theme: bench.theme, question: "Pick one", options: editorOptions });

    const during = bench.counts();
    assert.deepEqual(during, { keypress: 1, resize: 1 }, "the selector's, in their place");

    await bench.press(KEY.enter);
    await answered;

    assert.deepEqual(bench.counts(), before, "readline did not get its terminal back");
    bench.close();
  });

  it("restores both listeners on every exit path", async () => {
    const paths = {
      enter: [KEY.enter],
      escape: [KEY.escape],
      "escape after moving": [KEY.down, KEY.escape],
    };

    for (const [name, keys] of Object.entries(paths)) {
      const bench = harness();
      const answered = select({ readline: bench.readline, theme: bench.theme, question: "Pick one", options: editorOptions });

      await bench.press(...keys);
      await answered;

      assert.deepEqual(bench.counts(), { keypress: 1, resize: 1 }, `${name} leaked a listener`);
      bench.close();
    }
  });

  it("restores, closes readline, and re-raises on Ctrl-C", async () => {
    const bench = harness();
    let raised = 0;

    const answered = select({
      readline: bench.readline,
      theme: bench.theme,
      question: "Pick one",
      options: editorOptions,
      raiseInterrupt: () => {
        raised += 1;
      },
    });

    await bench.press(KEY.interrupt);

    assert.equal(await answered, null);
    assert.equal(raised, 1, "the signal was swallowed rather than re-raised");

    // Zero, and zero is the proof rather than an oversight. The selector gives
    // the listeners back and *then* closes readline, so readline takes its own
    // away with it and nothing is left. A selector that had failed to restore
    // would still have its own listener attached here, because `close()` only
    // removes the ones readline itself installed.
    assert.deepEqual(bench.counts(), { keypress: 0, resize: 0 }, "Ctrl-C left the selector attached");
  });

  it("never calls setRawMode, because readline owns it", async () => {
    const bench = harness();
    let calls = 0;
    bench.input.setRawMode = () => {
      calls += 1;
    };

    const answered = select({ readline: bench.readline, theme: bench.theme, question: "Pick one", options: editorOptions });
    await bench.press(KEY.down, KEY.enter);
    await answered;

    assert.equal(calls, 0);
    bench.close();
  });
});

describe("select — what reaches the terminal", () => {
  /** Every CSI sequence in a captured stream, in order. */
  const escapes = (text) => text.match(/\u001B\[[0-9;?]*[A-Za-z]/g) ?? [];

  it("emits nothing outside the three-sequence budget, on any key path", async () => {
    const bench = harness();
    const answered = select({
      readline: bench.readline,
      theme: bench.theme,
      question: "Pick any",
      options: editorOptions,
      multi: true,
    });

    await bench.press(KEY.down, KEY.space, KEY.up, "j", "k", KEY.space, "q", KEY.enter);
    await answered;

    for (const escape of escapes(bench.written)) {
      assert.match(escape, /^\u001B\[(2K|\d+A)$/, `outside the budget: ${JSON.stringify(escape)}`);
    }
    bench.close();
  });

  it("never hides the cursor", async () => {
    const bench = harness();
    const answered = select({
      readline: bench.readline,
      theme: bench.theme,
      question: "Pick any",
      options: editorOptions,
      multi: true,
    });

    await bench.press(KEY.down, KEY.space, KEY.escape);
    await answered;

    assert.equal(bench.written.includes("?25l"), false, "a cursor-hide sequence was emitted");
    assert.equal(bench.written.includes("?25h"), false);
    bench.close();
  });

  it("moves up by exactly the number of rows it last drew", async () => {
    const bench = harness();
    const answered = select({ readline: bench.readline, theme: bench.theme, question: "Pick one", options: editorOptions });

    await bench.press(KEY.down);
    const ups = escapes(bench.written).filter((escape) => escape.endsWith("A"));

    // Three options plus a blank plus the hint.
    assert.deepEqual(ups, [`${ESC}[5A`]);

    await bench.press(KEY.enter);
    await answered;
    bench.close();
  });

  it("prints the question once, above everything it repaints", async () => {
    const bench = harness();
    const answered = select({
      readline: bench.readline,
      theme: bench.theme,
      question: "Configure Pathfinder for which tools?",
      options: editorOptions,
    });

    await bench.press(KEY.down, KEY.down, KEY.up, KEY.enter);
    await answered;

    const occurrences = bench.written.split("Configure Pathfinder for which tools?").length - 1;
    assert.equal(occurrences, 1, "the question was repainted, which is what forces a 71-column floor");
    bench.close();
  });

  it("repaints from scratch on resize rather than trusting a stale row count", async () => {
    const bench = harness();
    const answered = select({ readline: bench.readline, theme: bench.theme, question: "Pick one", options: editorOptions });

    await bench.press(KEY.down);
    const before = bench.written.length;

    bench.output.columns = 50;
    bench.output.emit("resize");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const repaint = bench.written.slice(before);

    // No cursor-up at all: the previous block belongs to the old width, so the
    // honest recovery is to leave it in scrollback and draw a clean one below.
    assert.deepEqual(
      escapes(repaint).filter((escape) => escape.endsWith("A")),
      [],
    );
    assert.ok(repaint.includes("Cursor"), "the block was not redrawn");

    // And no foreign escape from readline refreshing its own line underneath us.
    for (const escape of escapes(repaint)) {
      assert.match(escape, /^\u001B\[(2K|\d+A)$/, `readline drew on top of us: ${JSON.stringify(escape)}`);
    }

    await bench.press(KEY.enter);
    await answered;
    bench.close();
  });

  it("clips against the terminal's live width, not the one the theme remembers", async () => {
    const bench = harness({ columns: 80 });
    const answered = select({
      readline: bench.readline,
      theme: bench.theme,
      question: "Pick any",
      options: harnessOptions(bench.theme),
      multi: true,
    });

    const before = bench.written.length;
    bench.output.columns = 49;
    bench.output.emit("resize");
    await new Promise((resolve) => setTimeout(resolve, 20));

    for (const line of bench.written.slice(before).split("\n")) {
      const bare = line.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
      assert.ok(bench.theme.width(bare) <= 48, `wrapped at 49: ${JSON.stringify(bare)}`);
    }

    await bench.press(KEY.enter);
    await answered;
    bench.close();
  });

  it("falls back to 80 columns when the stream reports none, and does not throw", async () => {
    const bench = harness();
    delete bench.output.columns;

    const answered = select({ readline: bench.readline, theme: bench.theme, question: "Pick one", options: editorOptions });
    await bench.press(KEY.enter);

    assert.equal(await answered, "cursor");
    bench.close();
  });
});
