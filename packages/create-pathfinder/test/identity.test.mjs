/**
 * The identity block, and the phase structure it opens.
 *
 * Two kinds of test live here, and the difference between them is the point.
 *
 * The *placement* rules are exact and are asserted exactly: the block appears
 * on an interactive run, a re-run, and `--dry-run`; it does not appear on
 * `--help`; and it does not appear for the `contract` tier at all. Those are
 * decisions, and a decision that is not pinned is a decision that drifts.
 *
 * The *appearance* is deliberately not pinned. Feature 21 says in as many words
 * that expressive TTY output is not a byte contract, because pinning it would
 * turn every future wording or spacing improvement into a test rewrite and
 * would freeze an aesthetic that is meant to keep moving. So what is asserted
 * about the look is that the required devices are present and that the
 * capability rules hold — never what any decorated line looks like character by
 * character.
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { formatIdentity, run } from "../src/cli.mjs";
import { createTheme } from "../src/theme.mjs";
import { VERSION } from "../src/kit.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function makeRepository() {
  const root = mkdtempSync(join(tmpdir(), "pathfinder-identity-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, ".git"));
  return root;
}

async function dryRun({ cwd = makeRepository(), argv = ["--dry-run"], ...environment } = {}) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    cwd,
    out: (text) => (out += text),
    err: (text) => (err += text),
    env: {},
    platform: "linux",
    ...environment,
  });
  return { code, out, err };
}

const utf8Tty = { env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: true };
const asciiTty = { env: { LANG: "C" }, platform: "linux", isTTY: true };

/** The wordmark, located by its letterspacing rather than by its decoration. */
const WORDMARK = /P A T H F I N D E R/;

/** The mark's stroke widths, bottom row last, with all decoration removed. */
function strokeWidths(block, theme) {
  const stroke = theme.glyph.rule;
  return block
    .split("\n")
    .map((line) => line.replace(/\u001B\[[0-9;]*m/g, "").match(new RegExp(`${stroke}+`)))
    .filter(Boolean)
    .map((found) => found[0].length);
}

describe("formatIdentity — the required devices", () => {
  it("carries a wordmark, the mark, and a version", () => {
    const theme = createTheme(utf8Tty);
    const block = formatIdentity({ theme });

    assert.match(block, WORDMARK, "no wordmark");
    assert.equal(strokeWidths(block, theme).length, 4, "the mark is not four strokes");
    assert.match(block, new RegExp(`v${VERSION.replace(/\./g, "\\.")}`), "no version");
  });

  it("draws the mark tapering upward, in the logo's own proportions", () => {
    // assets/logo.svg is four centred strokes of 24, 18, 12.8, and 7.2 units,
    // widest at the bottom. Scaled to nine cells that is 9:7:5:3. Asserted
    // because "it looks like the logo" is the one requirement here, and a
    // transcription that silently inverts or flattens would still render.
    const widths = strokeWidths(formatIdentity({ theme: createTheme(utf8Tty) }), createTheme(utf8Tty));

    assert.deepEqual(widths, [3, 5, 7, 9]);
  });

  it("states the version the package actually declares, not a copy of it", () => {
    // The failure this prevents is a constant in src/ that `npm version` does
    // not update, which ships an installer announcing the previous release.
    assert.match(formatIdentity(), /v\d+\.\d+\.\d+/);
    assert.ok(formatIdentity().includes(`v${VERSION}`));
  });

  it("takes the version as an argument, so the assertion above cannot be circular", () => {
    assert.match(formatIdentity({ version: "9.9.9" }), /v9\.9\.9/);
  });
});

describe("formatIdentity — capability", () => {
  it("emits no escape byte when colour is off", () => {
    const block = formatIdentity({ theme: createTheme({ ...utf8Tty, env: { NO_COLOR: "1" } }) });

    assert.ok(!block.includes("\u001B"), "an escape sequence survived NO_COLOR");
  });

  it("stays inside ASCII when Unicode is not trusted", () => {
    const block = formatIdentity({ theme: createTheme(asciiTty) });

    // eslint-disable-next-line no-control-regex
    assert.match(block, /^[\x00-\x7F]*$/);
  });

  it("keeps the wordmark in every tier, because identity is not decoration", () => {
    for (const theme of [
      createTheme(utf8Tty),
      createTheme(asciiTty),
      createTheme({ ...utf8Tty, env: { NO_COLOR: "1" } }),
    ]) {
      assert.match(formatIdentity({ theme }), WORDMARK, `lost in ${theme.tier}`);
    }
  });

  it("draws the mark to a fixed count that no terminal width can change", () => {
    // The constraint being defended is that no layout here measures the printed
    // width of a decorated string. Constant stroke widths are the evidence:
    // decoration changes the byte count of every line and changes none of these.
    const plain = createTheme({ env: { LANG: "C", NO_COLOR: "1" }, platform: "linux", isTTY: true });

    for (const theme of [plain, createTheme(utf8Tty)]) {
      assert.deepEqual(strokeWidths(formatIdentity({ theme }), theme), [3, 5, 7, 9], theme.tier);
    }
  });
});

describe("formatIdentity — the brand colour degrades, the mark does not", () => {
  const at = (env) => createTheme({ env: { LANG: "en_US.UTF-8", ...env }, platform: "linux", isTTY: true });

  it("uses #E0611F exactly when the terminal claims 24-bit", () => {
    for (const env of [{ COLORTERM: "truecolor" }, { COLORTERM: "24bit" }, { TERM: "xterm-direct" }]) {
      const theme = at(env);
      assert.equal(theme.colorDepth, 24, JSON.stringify(env));
      assert.ok(formatIdentity({ theme }).includes("\u001B[38;2;224;97;31m"), JSON.stringify(env));
    }
  });

  it("uses the nearest stable orange when the terminal claims 256", () => {
    const theme = at({ TERM: "xterm-256color" });

    assert.equal(theme.colorDepth, 8);
    // 166 is #D75F00, the nearest cell of the 6x6x6 cube to #E0611F.
    assert.ok(formatIdentity({ theme }).includes("\u001B[38;5;166m"));
  });

  it("falls back to the one warm ANSI accent when the terminal claims nothing", () => {
    const theme = at({ TERM: "xterm" });

    assert.equal(theme.colorDepth, 4);
    assert.ok(!formatIdentity({ theme }).includes("\u001B[38;"), "reached for a depth it was not offered");
  });

  it("never spends a severity colour on the brand above the floor", () => {
    // The rule being defended: orange means Pathfinder, green means success,
    // yellow means warning, red means error. They are only allowed to collide
    // at depth 4, where ANSI offers no second warm value.
    for (const env of [{ COLORTERM: "truecolor" }, { TERM: "xterm-256color" }]) {
      const block = formatIdentity({ theme: at(env) });

      assert.ok(!block.includes("\u001B[33m"), `brand borrowed warn's yellow: ${JSON.stringify(env)}`);
      assert.ok(!block.includes("\u001B[31m"), `brand borrowed bad's red: ${JSON.stringify(env)}`);
      assert.ok(!block.includes("\u001B[32m"), `brand borrowed ok's green: ${JSON.stringify(env)}`);
    }
  });

  it("keeps severity on the eight ANSI values whatever the depth", () => {
    // Depth is for the brand alone. A severity that acquired a 24-bit rendering
    // would be a level whose meaning depends on a terminal capability.
    const theme = at({ COLORTERM: "truecolor" });

    assert.equal(theme.ok("x"), "\u001B[32mx\u001B[0m");
    assert.equal(theme.warn("x"), "\u001B[33mx\u001B[0m");
    assert.equal(theme.bad("x"), "\u001B[31mx\u001B[0m");
  });

  it("keeps the mark when there is no colour at all, because form carries it", () => {
    const theme = at({ NO_COLOR: "1", COLORTERM: "truecolor" });

    assert.equal(theme.colorDepth, 0);
    const block = formatIdentity({ theme });
    assert.ok(!block.includes("\u001B"), "an escape survived NO_COLOR");
    assert.deepEqual(strokeWidths(block, theme), [3, 5, 7, 9]);
    assert.match(block, WORDMARK);
  });
});

describe("run — where the identity block is allowed to appear", () => {
  it("appears on an interactive run", async () => {
    const { out } = await dryRun({ stdoutIsTTY: true });

    assert.match(out, WORDMARK);
  });

  it("appears on a re-run, which is the screen people see most", async () => {
    const cwd = makeRepository();
    await dryRun({ cwd, stdoutIsTTY: true });
    const { out } = await dryRun({ cwd, stdoutIsTTY: true });

    assert.match(out, WORDMARK);
  });

  it("appears on --dry-run", async () => {
    const { out } = await dryRun({ argv: ["--dry-run"], stdoutIsTTY: true });

    assert.match(out, WORDMARK);
  });

  it("does not appear on --help, which is reference output someone pipes to less", async () => {
    const { out } = await dryRun({ argv: ["--help"], stdoutIsTTY: true });

    assert.doesNotMatch(out, WORDMARK);
    assert.match(out, /^Usage: npx create-pathfinder/);
  });

  it("does not appear for the contract tier, which has a byte promise to keep", async () => {
    const { out } = await dryRun({ stdoutIsTTY: false });

    assert.doesNotMatch(out, WORDMARK);
    assert.ok(!out.includes("\u001B"), "an escape sequence reached a non-terminal");
  });
});

describe("run — the environment phase", () => {
  it("names the phase and rails its findings, so it reads as a block", async () => {
    const theme = createTheme(asciiTty);
    const { out } = await dryRun({ stdoutIsTTY: true, env: { LANG: "C", NO_COLOR: "1" } });

    assert.match(out, /ENVIRONMENT/);

    const findingLines = out
      .split("\n")
      .filter((line) => line.includes("Git repository detected"));
    assert.equal(findingLines.length, 1);
    assert.ok(findingLines[0].includes(theme.glyph.gutter), "finding is not on the gutter");
  });

  it("separates identity from findings by order, not by hoping", async () => {
    const { out } = await dryRun({ stdoutIsTTY: true, env: { LANG: "C", NO_COLOR: "1" } });

    assert.ok(out.indexOf("P A T H F I N D E R") < out.indexOf("ENVIRONMENT"));
    assert.ok(out.indexOf("ENVIRONMENT") < out.indexOf("Would install"));
  });

  it("keeps the severity hierarchy legible with no colour at all", async () => {
    // The plain tier is a deliverable, not a fallback. If this rendering cannot
    // tell a reader what kind of thing each line is, colour was carrying meaning
    // alone somewhere upstream.
    const { out } = await dryRun({ stdoutIsTTY: true, env: { NO_COLOR: "1", LANG: "C" } });

    assert.ok(!out.includes("\u001B"), "colour survived NO_COLOR");
    assert.match(out, /\+ Git repository detected/);
  });
});
