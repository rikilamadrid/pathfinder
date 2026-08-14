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
      rule: "━",
      gutter: "│",
      barFull: "█",
      barEmpty: "░",
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
      rule: "=",
      gutter: "|",
      barFull: "#",
      barEmpty: ".",
    });
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
      assert.equal(theme.line.start(), "", `${name} emitted a carriage return`);
      assert.equal(theme.line.clear(), "", `${name} emitted a clear sequence`);
    }
  });

  it("exposes exactly two line primitives", () => {
    assert.deepEqual(Object.keys(createTheme(utf8Tty).line).sort(), ["clear", "start"]);
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
      ].join("");

      assert.equal(everything.includes(ESC), false, `${name} emitted an escape byte`);
    }
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
