/**
 * The progress treatment, and the properties that make it honest.
 *
 * A progress bar is the easiest thing in a CLI to fake, so most of this file is
 * about what the bar must *not* do: advance on anything but a completed unit,
 * display a value it has not earned, reach a clean 100% over a failed install,
 * or emit a single byte into a pipe. The bar's appearance is not pinned — its
 * arithmetic and its silence are.
 */

import { strict as assert } from "node:assert";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { createProgress } from "../src/progress.mjs";
import { applyAdapterPlan, applyPlan, planAdapters, planInstall } from "../src/install.mjs";
import { createTheme } from "../src/theme.mjs";
import { findKitRoot } from "../src/kit.mjs";
import { HARNESSES } from "../src/harnesses/index.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) {
    try {
      chmodSync(root, 0o755);
    } catch {
      // Already writable, or already gone. Either way the cleanup below copes.
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRepository() {
  const root = mkdtempSync(join(tmpdir(), "pathfinder-progress-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, ".git"));
  return root;
}

const KIT = findKitRoot();
const claudeCode = HARNESSES.find((harness) => harness.id === "claude-code");

const expressive = createTheme({
  env: { LANG: "en_US.UTF-8", COLORTERM: "truecolor" },
  platform: "linux",
  isTTY: true,
});
const plain = createTheme({ env: { LANG: "C", NO_COLOR: "1" }, platform: "linux", isTTY: true });
const contract = createTheme({ env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: false });

/** Capture everything a progress instance writes. */
function capture(theme, total) {
  let text = "";
  const progress = createProgress({ theme, total, out: (chunk) => (text += chunk) });
  return { progress, read: () => text };
}

/** Percentages the bar actually displayed, in the order it displayed them. */
function shownPercents(text) {
  return [...text.matchAll(/(\d+)%/g)].map((match) => Number(match[1]));
}

describe("the callback fires once per unit, in plan order", () => {
  it("applyPlan reports every item exactly once, in order", () => {
    const cwd = makeRepository();
    const plan = planInstall(KIT, cwd);
    const seen = [];

    applyPlan(plan, { onProgress: ({ item }) => seen.push(item.relativePath) });

    assert.equal(seen.length, plan.length);
    assert.deepEqual(
      seen,
      plan.map((item) => item.relativePath),
    );
  });

  it("applyAdapterPlan reports every item exactly once, in order", () => {
    const cwd = makeRepository();
    applyPlan(planInstall(KIT, cwd));
    const plan = planAdapters([claudeCode], { kitRoot: KIT, targetRoot: cwd });
    const seen = [];

    applyAdapterPlan(plan, { onProgress: ({ item }) => seen.push(item.relativePath) });

    assert.deepEqual(
      seen,
      plan.map((item) => item.relativePath),
    );
  });

  it("counts a skip as a resolved unit, because the plan enumerated it", () => {
    const cwd = makeRepository();
    applyPlan(planInstall(KIT, cwd));

    // Second pass: every file already exists, so every item is a skip.
    const plan = planInstall(KIT, cwd);
    const seen = [];
    const result = applyPlan(plan, { onProgress: ({ ok }) => seen.push(ok) });

    assert.ok(result.skipped > 0, "fixture did not produce skips");
    assert.equal(seen.length, plan.length);
    assert.ok(
      seen.every((ok) => ok === true),
      "a skip was reported as a failure",
    );
  });

  it("changes nothing when no callback is given", () => {
    const withCallback = makeRepository();
    const without = makeRepository();

    const a = applyPlan(planInstall(KIT, withCallback), { onProgress: () => {} });
    const b = applyPlan(planInstall(KIT, without));

    assert.deepEqual({ ...a, errors: a.errors.length }, { ...b, errors: b.errors.length });
  });
});

describe("the denominator is the plan", () => {
  it("equals the install plan plus the adapter plan on a fresh install", () => {
    const cwd = makeRepository();
    const installPlan = planInstall(KIT, cwd);
    const adapterPlan = planAdapters([claudeCode], { kitRoot: KIT, targetRoot: cwd });

    const units = [];
    applyPlan(installPlan, { onProgress: () => units.push(1) });
    applyAdapterPlan(adapterPlan, { onProgress: () => units.push(1) });

    assert.equal(units.length, installPlan.length + adapterPlan.length);
  });

  it("equals it again on a re-run with skips and a conflict", () => {
    const cwd = makeRepository();
    applyPlan(planInstall(KIT, cwd));
    const first = planAdapters([claudeCode], { kitRoot: KIT, targetRoot: cwd });
    applyAdapterPlan(first);

    // Somebody else's file, at a path an adapter wants. Pathfinder must leave it
    // alone, and the unit still counts: the plan enumerated it.
    const victim = first[0].destination;
    writeFileSync(victim, "hand-written, not ours\n", "utf8");

    const installPlan = planInstall(KIT, cwd);
    const adapterPlan = planAdapters([claudeCode], { kitRoot: KIT, targetRoot: cwd });

    const units = [];
    const installResult = applyPlan(installPlan, { onProgress: () => units.push(1) });
    const adapterResult = applyAdapterPlan(adapterPlan, { onProgress: () => units.push(1) });

    assert.ok(installResult.skipped > 0, "fixture produced no skips");
    assert.equal(adapterResult.conflicts.length, 1, "fixture produced no conflict");
    assert.equal(units.length, installPlan.length + adapterPlan.length);
    assert.equal(readFileSync(victim, "utf8"), "hand-written, not ours\n");
  });
});

describe("the bar never displays what it has not earned", () => {
  it("shows no percentage above the fraction actually completed", () => {
    const { progress, read } = capture(expressive, 8);

    for (let unit = 0; unit < 8; unit += 1) {
      progress.advance({ ok: true });
      const shown = shownPercents(read()).at(-1);
      const earned = Math.floor(((unit + 1) / 8) * 100);
      assert.ok(shown <= earned, `showed ${shown}% having earned ${earned}%`);
    }
  });

  it("reaches 100% only on the last unit", () => {
    const { progress, read } = capture(expressive, 36);

    for (let unit = 0; unit < 35; unit += 1) progress.advance({ ok: true });
    assert.ok(!shownPercents(read()).includes(100), "hit 100% with a unit outstanding");

    progress.advance({ ok: true });
    assert.equal(shownPercents(read()).at(-1), 100);
  });

  it("does not fill the last cell early", () => {
    const { progress, read } = capture(expressive, 100);

    for (let unit = 0; unit < 99; unit += 1) progress.advance({ ok: true });

    const frames = read().split("\r").filter(Boolean);
    assert.ok(
      frames.at(-1).includes(expressive.glyph.barEmpty),
      "the track was full with a unit still outstanding",
    );
  });

  it("renders an instant run at 100% with no wait and no dropped frame", () => {
    const { progress, read } = capture(expressive, 3);

    progress.advance({ ok: true });
    progress.advance({ ok: true });
    progress.advance({ ok: true });
    progress.finish();

    assert.deepEqual(shownPercents(read()), [33, 66, 100]);
  });
});

describe("a failure is never smoothed over", () => {
  it("does not render a clean 100% when a unit failed", () => {
    const { progress, read } = capture(expressive, 4);

    progress.advance({ ok: true });
    progress.advance({ ok: false });
    progress.advance({ ok: true });
    progress.advance({ ok: true });
    progress.finish();

    const text = read();
    assert.ok(!shownPercents(text).includes(100), "showed 100% over a failed unit");
    assert.match(text, /1 failed/);
    assert.equal(progress.failures, 1);
    assert.equal(progress.completed, 3);
  });

  it("reports ok:false from a real unwritable path, not only from a stub", () => {
    // The fixture is the filesystem, not a mock: a read-only directory makes a
    // real copyFileSync fail, which is the path applyPlan actually takes.
    const cwd = makeRepository();
    const plan = planInstall(KIT, cwd);
    const blocked = dirname(plan[0].destination);
    mkdirSync(blocked, { recursive: true });
    chmodSync(cwd, 0o500);

    const outcomes = [];
    const result = applyPlan(plan, { onProgress: ({ ok }) => outcomes.push(ok) });
    chmodSync(cwd, 0o755);

    assert.ok(result.errors.length > 0, "fixture did not produce a write failure");
    assert.equal(outcomes.length, plan.length, "a failed unit skipped its callback");
    assert.ok(
      outcomes.includes(false),
      "a real write failure was reported as a success",
    );
  });
});

describe("progress is invisible outside the expressive tier", () => {
  it("writes nothing at all for the contract tier", () => {
    const { progress, read } = capture(contract, 10);

    progress.advance({ ok: true });
    progress.milestone("  a milestone");
    progress.advance({ ok: false });
    progress.finish();

    assert.equal(read(), "", "the contract tier emitted bytes");
  });

  it("keeps milestones but draws no bar in the plain tier", () => {
    const { progress, read } = capture(plain, 10);

    progress.advance({ ok: true });
    progress.milestone("  + Kit files");
    progress.finish();

    const text = read();
    assert.equal(text, "  + Kit files\n");
    assert.ok(!text.includes("\r"), "a carriage return reached the plain tier");
    assert.ok(!text.includes(plain.glyph.barFull), "a bar character reached the plain tier");
  });

  it("emits no bar character, carriage return, or escape where dynamic is false", () => {
    for (const theme of [contract, plain]) {
      const { progress, read } = capture(theme, 5);
      for (let unit = 0; unit < 5; unit += 1) progress.advance({ ok: true });
      progress.finish();

      const text = read();
      assert.ok(!text.includes("\r"), `carriage return in ${theme.tier}`);
      assert.ok(!text.includes("\u001B"), `escape sequence in ${theme.tier}`);
      assert.ok(!text.includes(theme.glyph.barFull), `bar character in ${theme.tier}`);
      assert.ok(!text.includes("%"), `a percentage in ${theme.tier}`);
    }
  });

  it("draws nothing when there is no work, so a dry run stays quiet", () => {
    const { progress, read } = capture(expressive, 0);

    progress.advance({ ok: true });
    progress.finish();

    assert.equal(read(), "");
  });
});

describe("the terminal is left as it was found", () => {
  it("never emits a hide-cursor sequence", () => {
    const { progress, read } = capture(expressive, 4);

    progress.advance({ ok: true });
    progress.milestone("  x");
    progress.finish();

    assert.ok(!read().includes("?25l"), "hid the cursor");
    assert.ok(!read().includes("?25h"), "restored a cursor it never hid");
  });

  it("leaves the completed bar on screen, ending on a newline", () => {
    const { progress, read } = capture(expressive, 2);

    progress.advance({ ok: true });
    progress.advance({ ok: true });
    progress.finish();

    const text = read();
    assert.ok(text.endsWith("\n"), "the phase did not end on a newline");

    // The last thing before that newline is the finished bar, so a summary
    // printed afterwards cannot overwrite it.
    const lastFrame = text.slice(0, -1).split("\r").at(-1);
    assert.match(lastFrame, /100%/);
    assert.ok(lastFrame.includes(expressive.glyph.barFull));
  });

  it("uses only the two escapes the theme exposes", () => {
    const { progress, read } = capture(expressive, 3);

    progress.advance({ ok: true });
    progress.milestone("  x");
    progress.finish();

    const escapes = new Set(read().match(/\u001B\[[0-9;?]*[A-Za-z]/g) ?? []);
    for (const escape of escapes) {
      const isClearLine = escape === "\u001B[2K";
      const isColor = /^\u001B\[[0-9;]*m$/.test(escape);
      assert.ok(isClearLine || isColor, `unexpected escape sequence ${JSON.stringify(escape)}`);
    }
  });
});
