/**
 * The capability layer.
 *
 * Two things are asserted harder than the rest, because both are promises made
 * to people who cannot come back and complain: that a run without colour
 * capability emits no escape byte at all, and that the plain tier is a complete
 * way to read this tool rather than a lossy one.
 *
 * The environments below are written out as literal objects rather than built
 * by a helper. A helper would supply the inputs and then confirm its own
 * assumptions about them; these are the shapes `run()` actually receives.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { createTheme } from "../src/theme.mjs";

const ESC = "\u001B";

/** A UTF-8 terminal with nothing unusual set. The common interactive case. */
const utf8Tty = { env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: true };

describe("createTheme — tier and capability matrix", () => {
  it("gives a UTF-8 TTY the expressive tier with everything on", () => {
    const theme = createTheme(utf8Tty);

    assert.equal(theme.tier, "expressive");
    assert.equal(theme.color, true);
    assert.equal(theme.unicode, true);
    assert.equal(theme.dynamic, true);
  });

  it("drops a terminal to plain when NO_COLOR is set", () => {
    const theme = createTheme({ ...utf8Tty, env: { LANG: "en_US.UTF-8", NO_COLOR: "1" } });

    assert.equal(theme.tier, "plain");
    assert.equal(theme.color, false);
    assert.equal(theme.unicode, true, "NO_COLOR says nothing about the alphabet");
  });

  it("honours NO_COLOR on presence, whatever its value", () => {
    for (const value of ["1", "0", "", "false", "no"]) {
      const theme = createTheme({ ...utf8Tty, env: { LANG: "en_US.UTF-8", NO_COLOR: value } });

      assert.equal(theme.color, false, `NO_COLOR=${JSON.stringify(value)} should disable colour`);
    }
  });

  it("drops a terminal to plain when TERM is dumb", () => {
    const theme = createTheme({ ...utf8Tty, env: { LANG: "en_US.UTF-8", TERM: "dumb" } });

    assert.equal(theme.tier, "plain");
    assert.equal(theme.color, false);
    assert.equal(theme.dynamic, false);
  });

  it("lets FORCE_COLOR turn colour on without a TTY", () => {
    const theme = createTheme({ env: { LANG: "en_US.UTF-8", FORCE_COLOR: "1" }, platform: "linux", isTTY: false });

    assert.equal(theme.color, true);
    assert.equal(theme.tier, "contract", "FORCE_COLOR answers colour, not whether anyone is watching");
    assert.equal(theme.dynamic, false, "nothing can be repainted in a pipe");
  });

  it("lets FORCE_COLOR=0 refuse colour on a terminal that would otherwise have it", () => {
    const theme = createTheme({ ...utf8Tty, env: { LANG: "en_US.UTF-8", FORCE_COLOR: "0" } });

    assert.equal(theme.color, false);
    assert.equal(theme.tier, "plain");
  });

  it("lets NO_COLOR outrank FORCE_COLOR", () => {
    const theme = createTheme({ ...utf8Tty, env: { LANG: "en_US.UTF-8", FORCE_COLOR: "1", NO_COLOR: "1" } });

    assert.equal(theme.color, false);
  });

  it("gives a non-UTF-8 locale ASCII, and the plain tier with it", () => {
    const theme = createTheme({ ...utf8Tty, env: { LANG: "C" } });

    assert.equal(theme.unicode, false);
    assert.equal(theme.color, true, "an ASCII locale is not a statement about colour");
    assert.equal(theme.tier, "plain");
    assert.equal(theme.dynamic, false, "repainting is reserved for the expressive tier");
  });

  it("reads the locale from LC_ALL, then LC_CTYPE, then LANG", () => {
    const utf8 = "en_US.UTF-8";

    assert.equal(createTheme({ ...utf8Tty, env: { LC_ALL: utf8, LANG: "C" } }).unicode, true);
    assert.equal(createTheme({ ...utf8Tty, env: { LC_CTYPE: utf8, LANG: "C" } }).unicode, true);
    assert.equal(createTheme({ ...utf8Tty, env: { LC_ALL: "C", LANG: utf8 } }).unicode, false);
  });

  it("gives an empty environment ASCII and the contract tier", () => {
    const theme = createTheme();

    assert.equal(theme.unicode, false, "an unanswerable environment gets the readable alphabet");
    assert.equal(theme.color, false);
    assert.equal(theme.tier, "contract");
    assert.equal(theme.dynamic, false);
  });
});

describe("createTheme — Windows", () => {
  const win = { env: { LANG: "en_US.UTF-8" }, platform: "win32", isTTY: true };

  it("refuses the decorated glyphs on a bare win32 console, UTF-8 locale or not", () => {
    assert.equal(createTheme(win).unicode, false);
    assert.equal(createTheme({ ...win, env: {} }).unicode, false);
  });

  it("trusts Windows Terminal", () => {
    assert.equal(createTheme({ ...win, env: { WT_SESSION: "b4a1" } }).unicode, true);
  });

  it("trusts the VS Code terminal", () => {
    assert.equal(createTheme({ ...win, env: { TERM_PROGRAM: "vscode" } }).unicode, true);
  });
});

describe("createTheme — colour helpers are total functions", () => {
  it("wraps text in SGR codes when colour is on", () => {
    const theme = createTheme(utf8Tty);

    assert.equal(theme.ok("done"), `${ESC}[32mdone${ESC}[0m`);
    assert.equal(theme.info("noted"), `${ESC}[36mnoted${ESC}[0m`);
    assert.equal(theme.warn("careful"), `${ESC}[33mcareful${ESC}[0m`);
    assert.equal(theme.bad("failed"), `${ESC}[31mfailed${ESC}[0m`);
    assert.equal(theme.bold("Pathfinder"), `${ESC}[1mPathfinder${ESC}[0m`);
    assert.equal(theme.dim("aside"), `${ESC}[2maside${ESC}[0m`);
  });

  it("returns the plain string from every helper when colour is off", () => {
    const theme = createTheme({ env: {}, platform: "linux", isTTY: false });

    for (const name of ["ok", "info", "warn", "bad", "bold", "dim"]) {
      assert.equal(theme[name]("text"), "text", `${name} must not decorate without colour`);
    }
  });

  it("offers four severity levels, named for meaning rather than colour", () => {
    const theme = createTheme(utf8Tty);

    for (const level of ["ok", "info", "warn", "bad"]) {
      assert.equal(typeof theme[level], "function");
    }
  });
});

describe("createTheme — glyphs", () => {
  it("uses the decorated table when Unicode is trusted", () => {
    const { glyph } = createTheme(utf8Tty);

    assert.deepEqual(glyph, {
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
      pointer: "❯",
      checked: "◉",
      unchecked: "○",
      arrowUp: "↑",
      arrowDown: "↓",
    });
  });

  it("uses the ASCII table otherwise", () => {
    const { glyph } = createTheme({ ...utf8Tty, env: { LANG: "C" } });

    assert.deepEqual(glyph, {
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
      pointer: ">",
      checked: "[x]",
      unchecked: "[ ]",
      arrowUp: "^",
      arrowDown: "v",
    });
  });

  it("makes ASCII the binding alphabet for width, which is why the floor is measured against it", () => {
    // Not decoration — this asymmetry is the reason `SELECTION_MIN_COLUMNS` is
    // 49 rather than the smaller number the decorated alphabet alone would
    // support. If a future ASCII counterpart got *narrower* than its decorated
    // twin, the floor would have been derived against the wrong alphabet.
    const theme = createTheme(utf8Tty);
    const ascii = createTheme({ ...utf8Tty, env: { LANG: "C" } }).glyph;

    for (const name of ["checked", "unchecked", "ellipsis"]) {
      assert.ok(
        theme.width(ascii[name]) >= theme.width(theme.glyph[name]),
        `${name}: ASCII must not be narrower than the decorated glyph`,
      );
    }
  });

  it("names the same glyphs in both alphabets, so no call site can lose one in ASCII", () => {
    // The deepEqual pair above pins the values; this pins the *keys* being the
    // same set. Without it, adding an emoji to the decorated table and
    // forgetting its counterpart yields `undefined` printed into an ASCII
    // terminal, which is precisely the failure the fallback exists to prevent
    // and precisely the one a value-by-value test does not catch.
    const decorated = createTheme(utf8Tty).glyph;
    const ascii = createTheme({ ...utf8Tty, env: { LANG: "C" } }).glyph;

    assert.deepEqual(Object.keys(decorated).sort(), Object.keys(ascii).sort());
  });

  it("keeps every ASCII glyph inside ASCII", () => {
    const { glyph } = createTheme({ ...utf8Tty, env: { LANG: "C" } });

    for (const [name, value] of Object.entries(glyph)) {
      assert.match(value, /^[\x00-\x7F]+$/, `${name} escaped the ASCII table`);
    }
  });

  it("gives each severity its own ASCII glyph, so the plain tier keeps the distinction", () => {
    const { glyph } = createTheme({ ...utf8Tty, env: { LANG: "C" } });
    const severities = [glyph.ok, glyph.info, glyph.warn, glyph.bad];

    assert.equal(new Set(severities).size, severities.length, "two severities share a mark");
  });

  it("carries the punctuation that used to be hardcoded at call sites", () => {
    assert.equal(createTheme(utf8Tty).glyph.ellipsis, "…");
    assert.equal(createTheme({ ...utf8Tty, env: { LANG: "C" } }).glyph.ellipsis, "...");
  });
});

describe("createTheme — line primitives", () => {
  it("returns real escape sequences only in the expressive tier", () => {
    const theme = createTheme(utf8Tty);

    assert.equal(theme.line.start(), "\r");
    assert.equal(theme.line.clear(), `${ESC}[2K`);
  });

  it("returns the empty string wherever repainting is not allowed", () => {
    const cases = {
      piped: { env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: false },
      NO_COLOR: { ...utf8Tty, env: { LANG: "en_US.UTF-8", NO_COLOR: "1" } },
      "TERM=dumb": { ...utf8Tty, env: { LANG: "en_US.UTF-8", TERM: "dumb" } },
      ascii: { ...utf8Tty, env: { LANG: "C" } },
    };

    for (const [name, options] of Object.entries(cases)) {
      const theme = createTheme(options);

      assert.equal(theme.dynamic, false, `${name} should not be dynamic`);
      assert.equal(theme.selection, false, `${name} should not offer selection`);
      assert.equal(theme.line.start(), "", `${name} emitted a carriage return`);
      assert.equal(theme.line.clear(), "", `${name} emitted a clear sequence`);
      assert.equal(theme.line.up(3), "", `${name} emitted a cursor movement`);
    }
  });

  it("exposes exactly three line primitives", () => {
    assert.deepEqual(Object.keys(createTheme(utf8Tty).line).sort(), ["clear", "start", "up"]);
  });

  it("moves the cursor up by the row count it is given", () => {
    const theme = createTheme(utf8Tty);

    assert.equal(theme.line.up(1), `${ESC}[1A`);
    assert.equal(theme.line.up(7), `${ESC}[7A`);
    assert.equal(theme.line.up(12), `${ESC}[12A`);
  });

  it("declines to move rather than emitting a movement nobody can predict", () => {
    // The first paint of a block has nothing above it, so `up(0)` is the normal
    // case rather than a caller's mistake — and `ESC[0A` is read as one row by
    // some terminals and none by others, which is exactly the ambiguity a
    // repainting renderer cannot afford.
    const theme = createTheme(utf8Tty);

    for (const n of [0, -1, 1.5, Number.NaN, undefined, null, "3"]) {
      assert.equal(theme.line.up(n), "", `up(${JSON.stringify(n)}) emitted a movement`);
    }
  });

  it("grants the primitives to a selection-capable terminal that is not dynamic", () => {
    // The gate is `dynamic || selection`, not `dynamic`. A NO_COLOR terminal is
    // still offered the selector — NO_COLOR is a statement about decoration, not
    // about repainting — and a selector handed "" for `clear` would leave the
    // tail of every longer row behind it.
    const theme = createTheme({
      ...utf8Tty,
      env: { LANG: "en_US.UTF-8", NO_COLOR: "1" },
      inputIsTTY: true,
      setRawMode: true,
      columns: 80,
    });

    assert.equal(theme.dynamic, false, "the presentation tier is unchanged");
    assert.equal(theme.selection, true);
    assert.equal(theme.line.start(), "\r");
    assert.equal(theme.line.clear(), `${ESC}[2K`);
    assert.equal(theme.line.up(4), `${ESC}[4A`);
  });
});

describe("createTheme — the selection capability", () => {
  /** A terminal on both ends, wide enough, able to deliver keypresses. */
  const capable = {
    ...utf8Tty,
    inputIsTTY: true,
    setRawMode: true,
    columns: 80,
  };

  it("says yes to a terminal that can do all of it", () => {
    assert.equal(createTheme(capable).selection, true);
  });

  it("is decided independently of the presentation tier", () => {
    // Three environments that all lose `dynamic` and none of which said anything
    // about whether a line may be repainted.
    const cases = {
      NO_COLOR: { LANG: "en_US.UTF-8", NO_COLOR: "1" },
      "FORCE_COLOR=0": { LANG: "en_US.UTF-8", FORCE_COLOR: "0" },
      ascii: { LANG: "C" },
    };

    for (const [name, env] of Object.entries(cases)) {
      const theme = createTheme({ ...capable, env });

      assert.equal(theme.dynamic, false, `${name} should not be dynamic`);
      assert.equal(theme.selection, true, `${name} lost the keyboard it never gave up`);
    }
  });

  it("refuses without a terminal on both ends", () => {
    assert.equal(createTheme({ ...capable, isTTY: false }).selection, false, "no stdout");
    assert.equal(createTheme({ ...capable, inputIsTTY: false }).selection, false, "no stdin");
  });

  it("defaults both TTY answers to no, so an unanswerable environment gets classic", () => {
    assert.equal(createTheme().selection, false);
    assert.equal(createTheme(utf8Tty).selection, false, "stdin was never claimed to be a terminal");
  });

  it("refuses when TERM says the terminal is dumb", () => {
    const theme = createTheme({ ...capable, env: { LANG: "en_US.UTF-8", TERM: "dumb" } });

    assert.equal(theme.selection, false);
  });

  it("refuses when the input stream cannot be put into raw mode", () => {
    assert.equal(createTheme({ ...capable, setRawMode: false }).selection, false);
  });

  it("lets PATHFINDER_PROMPT=classic outrank a fully capable terminal", () => {
    const theme = createTheme({
      ...capable,
      env: { LANG: "en_US.UTF-8", PATHFINDER_PROMPT: "classic" },
    });

    assert.equal(theme.selection, false);
    assert.equal(theme.tier, "expressive", "the override is about the question, not the presentation");
  });

  it("ignores any other value of PATHFINDER_PROMPT", () => {
    // One documented value, and anything else is not a second opinion about the
    // interaction. A typo must not silently take the keyboard away.
    for (const value of ["", "classical", "CLASSIC", "keyboard", "1"]) {
      const theme = createTheme({ ...capable, env: { LANG: "en_US.UTF-8", PATHFINDER_PROMPT: value } });

      assert.equal(theme.selection, true, `PATHFINDER_PROMPT=${JSON.stringify(value)} disabled selection`);
    }
  });
});

describe("createTheme — the 49-column floor", () => {
  const capable = { ...utf8Tty, inputIsTTY: true, setRawMode: true };

  it("offers selection at 49 columns and refuses at 48", () => {
    // The two sides of the measured floor. 49 is the narrowest width that keeps
    // the marker, the whole label, the whole hint line, and the `-> path`
    // context; 48 loses one of them, and a selector that renders a fragment of
    // its own instructions is worse than a numbered list.
    assert.equal(createTheme({ ...capable, columns: 49 }).selection, true);
    assert.equal(createTheme({ ...capable, columns: 48 }).selection, false);
  });

  it("refuses every width below the floor and offers every width above it", () => {
    for (const columns of [1, 20, 24, 32, 40, 47]) {
      assert.equal(createTheme({ ...capable, columns }).selection, false, `${columns} columns`);
    }
    for (const columns of [50, 56, 80, 200]) {
      assert.equal(createTheme({ ...capable, columns }).selection, true, `${columns} columns`);
    }
  });

  it("falls back to 80 columns when the terminal reports nothing, and does not throw", () => {
    // `process.stdout.columns` is undefined whenever stdout is not a terminal,
    // and every comparison against NaN is false — which would answer "too
    // narrow" to a question nobody asked.
    for (const columns of [undefined, null, Number.NaN, 0, -1, 49.5, "49", {}]) {
      const theme = createTheme({ ...capable, columns });

      assert.equal(theme.columns, 80, `columns=${JSON.stringify(columns)} did not fall back`);
      assert.equal(theme.selection, true);
    }
  });

  it("reports the width the capability was decided against", () => {
    assert.equal(createTheme({ ...capable, columns: 56 }).columns, 56);
    assert.equal(createTheme({ ...capable, columns: 30 }).columns, 30);
  });
});

describe("createTheme — zero escape bytes when colour is off", () => {
  const colourless = {
    piped: { env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: false },
    NO_COLOR: { ...utf8Tty, env: { LANG: "en_US.UTF-8", NO_COLOR: "1" } },
    "TERM=dumb": { ...utf8Tty, env: { LANG: "en_US.UTF-8", TERM: "dumb" } },
    "FORCE_COLOR=0": { ...utf8Tty, env: { LANG: "en_US.UTF-8", FORCE_COLOR: "0" } },
    empty: {},
  };

  it("emits no ESC from any helper, glyph, or primitive", () => {
    for (const [name, options] of Object.entries(colourless)) {
      const theme = createTheme(options);

      const everything = [
        ...["ok", "info", "warn", "bad", "bold", "dim"].map((level) => theme[level]("text")),
        ...Object.values(theme.glyph),
        theme.line.start(),
        theme.line.clear(),
        theme.line.up(2),
      ].join("");

      assert.equal(everything.includes(ESC), false, `${name} emitted an escape byte`);
    }
  });

  it("narrows that promise to colour, and only for a terminal driving a selector", () => {
    // Worth stating rather than discovering. Feature 23 made this promise
    // *about colour* instead of about every byte: a NO_COLOR terminal that is
    // offered the keyboard selector repaints, and repainting is escape
    // sequences. What NO_COLOR still buys, exactly, is that no *paint* is
    // emitted — which is the thing it was ever asked to buy.
    const theme = createTheme({
      ...utf8Tty,
      env: { LANG: "en_US.UTF-8", NO_COLOR: "1" },
      inputIsTTY: true,
      setRawMode: true,
      columns: 80,
    });

    const paints = [
      ...["ok", "info", "warn", "bad", "bold", "dim"].map((level) => theme[level]("text")),
      theme.brand("Pathfinder"),
    ].join("");

    assert.equal(paints.includes(ESC), false, "a colour escape survived NO_COLOR");
    assert.equal(theme.line.clear().includes(ESC), true, "the selector needs to clear a line");
  });
});

describe("createTheme — it decorates, it does not draw", () => {
  it("exposes no cursor visibility control", () => {
    const theme = createTheme(utf8Tty);

    for (const name of Object.keys(theme)) {
      assert.doesNotMatch(name, /cursor/i, `${name} is a cursor control this feature decided against`);
    }
    assert.equal(Object.keys(theme.line).some((name) => /cursor|hide|show/i.test(name)), false);
  });

  it("holds no state that survives a call", () => {
    const theme = createTheme(utf8Tty);

    assert.equal(theme.ok("x"), theme.ok("x"));
    assert.equal(theme.line.clear(), theme.line.clear());
  });

  it("is frozen, so no consumer can redefine a capability for everyone else", () => {
    const theme = createTheme(utf8Tty);

    assert.equal(Object.isFrozen(theme), true);
    assert.equal(Object.isFrozen(theme.glyph), true);
    assert.throws(() => {
      "use strict";
      theme.color = false;
    });
  });

  it("reads nothing but its arguments", () => {
    const before = { ...process.env };
    process.env.NO_COLOR = "1";

    try {
      assert.equal(createTheme(utf8Tty).color, true, "the ambient environment must not reach in");
    } finally {
      delete process.env.NO_COLOR;
      Object.assign(process.env, before);
    }
  });
});

/**
 * The measurement seam.
 *
 * `cells.test.mjs` proves the algorithm. What is proved here is that the theme
 * publishes it, and — the part that is easy to get wrong — that it publishes it
 * *unconditionally*. Every other capability on this object varies with the
 * terminal. These two must not, because a string's printed width is a fact
 * about the string.
 */
describe("createTheme — width and clip", () => {
  const noTty = { env: {}, platform: "linux", isTTY: false };

  it("exposes both as functions on every theme", () => {
    for (const theme of [createTheme(utf8Tty), createTheme(noTty), createTheme()]) {
      assert.equal(typeof theme.width, "function");
      assert.equal(typeof theme.clip, "function");
    }
  });

  it("measures its own paints as the text inside them", () => {
    const theme = createTheme(utf8Tty);

    assert.equal(theme.width(theme.ok(`${theme.glyph.ok} Git repository detected`)), 25);
    assert.equal(theme.width(theme.bold("20")), 2);
    assert.equal(theme.width(theme.dim(theme.glyph.gutter)), 1);
  });

  it("measures the brand at every depth as the text inside it", () => {
    const depths = {
      24: { LANG: "en_US.UTF-8", COLORTERM: "truecolor" },
      8: { LANG: "en_US.UTF-8", TERM: "xterm-256color" },
      4: { LANG: "en_US.UTF-8" },
    };

    for (const [depth, env] of Object.entries(depths)) {
      const theme = createTheme({ env, platform: "linux", isTTY: true });

      assert.equal(theme.colorDepth, Number(depth), `depth ${depth} was not selected`);
      assert.equal(
        theme.width(theme.brand("P A T H F I N D E R")),
        19,
        `the depth-${depth} brand escape must measure zero`,
      );
    }
  });

  it("gives the same answer in every tier, unlike every other capability here", () => {
    // The property that separates these from `line`: a pipe and a terminal
    // disagree about what may be *emitted*, never about what a string measures.
    const painted = `${ESC}[32m✓ done${ESC}[0m`;

    const widths = [createTheme(utf8Tty), createTheme(noTty), createTheme()].map((t) =>
      t.width(painted),
    );

    assert.deepEqual(widths, [6, 6, 6]);
  });

  it("clips through the seam without breaking a paint", () => {
    const theme = createTheme(utf8Tty);
    const line = theme.ok(`${theme.glyph.ok} Claude Code`);
    const clipped = theme.clip(line, 5);

    assert.ok(theme.width(clipped) <= 5);
    assert.ok(clipped.endsWith(`${ESC}[0m`), "a cut inside a paint must still reset");
  });

  it("measures the ASCII alphabet correctly too", () => {
    const ascii = createTheme({ env: { LANG: "C" }, platform: "linux", isTTY: true });

    assert.equal(ascii.unicode, false);
    assert.equal(ascii.width(`${ascii.glyph.ellipsis}`), 3, "ASCII ellipsis is three cells");
  });
});
