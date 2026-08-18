/**
 * The end of a run.
 *
 * The requirement this file defends is a feeling — "arrival, not receipt" — and
 * a feeling cannot be asserted. What can be asserted is that the devices which
 * produce it are present, that the run does not claim more than it did, and
 * that the celebration is earned rather than unconditional. A tool that throws
 * confetti for doing no work is a tool whose confetti means nothing, so all
 * three endings are pinned separately.
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { run } from "../src/cli.mjs";
import { MARKER_TOKEN, MARKER_VERSION } from "../src/harnesses/adapter.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function makeRepository() {
  const root = mkdtempSync(join(tmpdir(), "pathfinder-ending-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, ".git"));
  return root;
}

async function install(cwd, { argv = ["--yes", "--agents", "claude-code"], ...rest } = {}) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    cwd,
    out: (text) => (out += text),
    err: (text) => (err += text),
    env: { LANG: "en_US.UTF-8", NO_COLOR: "1" },
    platform: "linux",
    stdoutIsTTY: true,
    ...rest,
  });
  return { code, out, err };
}

/** How many times the four-stroke mark is drawn. */
function markCount(text) {
  return text.split("\n").filter((line) => /^ *[━=]{9}$/.test(line)).length;
}

describe("a successful install ends on an arrival", () => {
  it("celebrates a fresh install, and says what it did", async () => {
    const { out } = await install(makeRepository());

    assert.match(out, /YOU'RE ALL SET/);

    // Derived from the run's own summary rather than written as literals. The
    // claim being defended is "the run does not claim more than it did", which
    // is about the two lines agreeing — pinning the numbers instead made every
    // added kit file or skill fail here, with a message that named the count
    // rather than the disagreement.
    const summary = out.match(/✓ (\d+) files written/);
    const adapters = out.match(/✓ (\d+) Claude Code skill adapters generated/);
    assert.ok(summary, "the summary does not report a file count");
    assert.ok(adapters, "the summary does not report an adapter count");
    assert.match(
      out,
      new RegExp(`${summary[1]} files, ${adapters[1]} adapters, Claude Code`),
      "the closing line disagrees with the summary above it",
    );
  });

  it("bookends the run with the mark, which no intermediate phase draws", async () => {
    const { out } = await install(makeRepository());

    // Once at the top, once at the end. If a phase in between ever starts
    // drawing it, the closing mark stops meaning "this is over".
    assert.equal(markCount(out), 2, "the mark is not a bookend");
  });

  it("ends on the sign-off, not on somebody else's editor", async () => {
    // The defect this replaces: a successful first run used to end on
    // "Opening VS Code." — several hundred files installed, then a subordinate
    // clause about an editor.
    const { out } = await install(makeRepository());
    const lastLine = out.trimEnd().split("\n").at(-1);

    assert.match(lastLine, /Trail's marked\. The rest is yours\./);
  });

  it("puts the prompt after the celebration, so the next action is last", async () => {
    const { out } = await install(makeRepository());

    assert.ok(out.indexOf("YOU'RE ALL SET") < out.indexOf("Hand your agent this prompt"));
    assert.ok(out.indexOf("Hand your agent this prompt") < out.indexOf("Trail's marked"));
  });
});

describe("the celebration is earned, never unconditional", () => {
  it("does not throw confetti over a run that did nothing", async () => {
    const cwd = makeRepository();
    await install(cwd);
    const { out } = await install(cwd);

    assert.match(out, /ALREADY UP TO DATE/);
    assert.doesNotMatch(out, /YOU'RE ALL SET/, "celebrated doing no work");
    assert.match(out, /everything was already in place/);
  });

  it("tempers the ending when something wants a human", async () => {
    const cwd = makeRepository();
    await install(cwd);
    writeFileSync(join(cwd, ".claude", "skills", "prototype", "SKILL.md"), "mine\n", "utf8");

    const { out } = await install(cwd);

    assert.match(out, /READY/);
    assert.doesNotMatch(out, /YOU'RE ALL SET/, "celebrated over a conflict");
    assert.match(out, /1 thing to look at above/);
  });

  it("counts only conflicts and orphans as things to look at", async () => {
    // A re-run skips every file by design. Counting thirty-six routine skips as
    // "things to look at" would make the one number that should mean something
    // into noise nobody reads twice.
    const cwd = makeRepository();
    await install(cwd);
    writeFileSync(join(cwd, ".claude", "skills", "prototype", "SKILL.md"), "mine\n", "utf8");

    const orphan = join(cwd, ".claude", "skills", "retired-experiment");
    mkdirSync(orphan, { recursive: true });
    writeFileSync(
      join(orphan, "SKILL.md"),
      `<!-- ${MARKER_TOKEN} v${MARKER_VERSION} source=skills/retired-experiment/SKILL.md -->\nx\n`,
      "utf8",
    );

    const { out } = await install(cwd);

    assert.match(out, /2 things to look at above/);
    assert.doesNotMatch(out, /3[0-9] things to look at/, "counted routine skips as attention");
  });

  it("reports a zero rather than ticking it", async () => {
    const cwd = makeRepository();
    await install(cwd);
    const { out } = await install(cwd);

    assert.match(out, /· 0 files written/, "a zero was not marked as information");
    assert.doesNotMatch(out, /✓ 0 files written/, "a zero was celebrated as a success");
  });
});

describe("a failed run gets no ending at all", () => {
  it("prints neither the celebration nor the sign-off when a write failed", async () => {
    // The adapter path is a directory, so writing the adapter file must fail.
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude", "skills", "handoff", "SKILL.md"), { recursive: true });

    const { code, out } = await install(cwd);

    assert.equal(code, 1);
    assert.doesNotMatch(out, /YOU'RE ALL SET/, "celebrated over a failure");
    assert.doesNotMatch(out, /Trail's marked/, "signed off over a failure");
    assert.match(out, /Hand your agent this prompt/, "the prompt should still print");
  });
});

describe("the ending respects every capability rule", () => {
  it("keeps the mark, the headline, and the sign-off in ASCII with no colour", async () => {
    const { out } = await install(makeRepository(), {
      env: { LANG: "C", NO_COLOR: "1" },
    });

    assert.ok(!out.includes("\u001B"), "an escape survived NO_COLOR");
    assert.match(out, /YOU'RE ALL SET/);
    assert.match(out, /Trail's marked\. The rest is yours\./);
    assert.equal(markCount(out), 2, "the mark did not survive the ASCII fallback");
    // eslint-disable-next-line no-control-regex
    assert.match(out, /^[\x00-\x7F]*$/, "a non-ASCII byte reached an ASCII terminal");
  });

  it("prints no ending whatsoever for the contract tier", async () => {
    const { out } = await install(makeRepository(), {
      env: { LANG: "en_US.UTF-8" },
      stdoutIsTTY: false,
    });

    assert.doesNotMatch(out, /YOU'RE ALL SET/);
    assert.doesNotMatch(out, /Trail's marked/);
    assert.doesNotMatch(out, /Hand your agent/);
    assert.match(out, /Next step . give your agent this prompt:/);
    assert.equal(markCount(out), 0);
  });

  it("asks for nothing on the way out", async () => {
    // No star request, no link, no newsletter. A tool that has just written
    // several hundred files into somebody's repository has taken enough.
    const { out } = await install(makeRepository());

    assert.doesNotMatch(out, /\bstar\b/i);
    assert.doesNotMatch(out, /github\.com/i);
    assert.doesNotMatch(out, /follow|subscribe|sponsor/i);
  });
});
