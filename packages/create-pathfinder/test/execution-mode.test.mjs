/**
 * The execution mode, from both sides.
 *
 * Inside: the marker is read strictly, the file renders the same bytes every
 * time, and the ownership decision reuses the adapter table rather than a
 * second one. Outside: a real run asks exactly when the spec says, writes the
 * file for either answer, never asks a project that already answered, takes
 * `--mode` without a terminal, and — the load-bearing negative — a run that
 * neither asked nor was told prints the bytes it printed before the question
 * existed and leaves no file behind.
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { run } from "../src/cli.mjs";
import {
  DEFAULT_EXECUTION_MODE,
  EXECUTION_MODES,
  EXECUTION_MODE_PATH,
  EXECUTION_MODE_QUESTION,
  applyExecutionModePlan,
  effectiveExecutionMode,
  isPathfinderExecutionMode,
  parseExecutionModeFlag,
  planExecutionMode,
  readExecutionMode,
  readExecutionModeFile,
  renderExecutionMode,
} from "../src/execution-mode.mjs";
import { detect } from "../src/detect.mjs";
import { neverShips } from "../src/kit.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function scratch(prefix = "pathfinder-mode-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

/** `findGitRoot` looks for `.git` and never runs the binary. */
function makeRepository() {
  const cwd = scratch();
  mkdirSync(join(cwd, ".git"));
  return cwd;
}

function modeFile(cwd) {
  return join(cwd, "context", "execution-mode.md");
}

function writeModeFile(cwd, contents) {
  mkdirSync(join(cwd, "context"), { recursive: true });
  writeFileSync(modeFile(cwd), contents, "utf8");
}

/**
 * A prompter that records every question and answers the mode question as
 * told. Every other question is declined, so a run reaches the summary without
 * touching a clipboard or an editor. `mode: undefined` answers the mode
 * question with nobody-there, which is what Escape and a closed stdin return.
 */
function scriptedPrompter({ interactive = true, mode = undefined, harnesses = [] } = {}) {
  const asked = [];
  const offered = [];
  return {
    interactive,
    asked,
    offered,
    confirm: async (question) => {
      asked.push(question);
      return false;
    },
    chooseMany: async (question) => {
      asked.push(question);
      return harnesses;
    },
    chooseOne: async (question, config) => {
      asked.push(question);
      offered.push(config);
      if (question !== EXECUTION_MODE_QUESTION) return null;
      const picked = config.options.find((option) => option.value === mode);
      return picked === undefined ? null : picked.value;
    },
    text: async () => "",
    close: () => {},
  };
}

/** The prompter `bin/` builds when the TTY guard says no. Reaching a question is a failure. */
function forbiddenPrompter() {
  const refuse = async (question) => {
    throw new Error(`a question was asked with no terminal to answer it: ${question}`);
  };
  return { interactive: false, confirm: refuse, chooseMany: refuse, chooseOne: refuse, text: refuse, close: () => {} };
}

async function invoke(argv, { cwd, prompter = forbiddenPrompter(), stdoutIsTTY = false } = {}) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    cwd,
    out: (text) => (out += text),
    err: (text) => (err += text),
    // No PATH: no editor is detected, so the only interactive questions a run
    // in a repository reaches are the harness, mode, and clipboard ones.
    env: { LANG: "en_US.UTF-8", NO_COLOR: "1" },
    platform: "linux",
    stdoutIsTTY,
    prompter,
  });
  return { code, out, err };
}

describe("reading the marker", () => {
  it("treats no file as absent, which is the default mode", () => {
    assert.deepEqual(readExecutionMode(null), { present: false, mode: null, valid: false });
    assert.equal(effectiveExecutionMode(readExecutionMode(null)), DEFAULT_EXECUTION_MODE);
    assert.equal(DEFAULT_EXECUTION_MODE, "human-in-the-loop");
  });

  it("reads either valid value from its marker line", () => {
    for (const mode of EXECUTION_MODES) {
      const reading = readExecutionMode(`# Execution Mode\n\n<!-- pathfinder:execution-mode ${mode} -->\n\nprose\n`);
      assert.deepEqual(reading, { present: true, mode, valid: true });
      assert.equal(effectiveExecutionMode(reading), mode);
    }
  });

  it("reports an unknown value as present and invalid, naming what it found", () => {
    const reading = readExecutionMode("<!-- pathfinder:execution-mode autopilot -->\n");
    assert.deepEqual(reading, { present: true, mode: "autopilot", valid: true === false });
    // Invalid is not mapped to a mode: the caller says so and chooses the fallback by name.
    assert.equal(effectiveExecutionMode(reading), null);
  });

  it("reports a file with no marker as present and invalid", () => {
    assert.deepEqual(readExecutionMode("# Execution Mode\n\nsomebody's notes\n"), {
      present: true,
      mode: null,
      valid: false,
    });
  });

  it("matches the marker only as a whole line", () => {
    // A marker quoted inside a sentence is not the project's answer.
    const quoted = "The line looks like `<!-- pathfinder:execution-mode orchestrator -->` in the file.\n";
    assert.equal(readExecutionMode(quoted).valid, false);
    assert.equal(isPathfinderExecutionMode(quoted), false);
  });

  it("survives CRLF line endings and surrounding whitespace", () => {
    const reading = readExecutionMode("# Mode\r\n\r\n  <!--  pathfinder:execution-mode   orchestrator  -->  \r\n");
    assert.deepEqual(reading, { present: true, mode: "orchestrator", valid: true });
  });

  it("reads the project's file, and tells absence from unreadability", () => {
    const cwd = scratch();
    assert.equal(readExecutionModeFile(cwd).present, false);
    assert.equal(readExecutionModeFile(cwd).unreadable, false);

    writeModeFile(cwd, renderExecutionMode("orchestrator"));
    assert.deepEqual(readExecutionModeFile(cwd), {
      present: true,
      mode: "orchestrator",
      valid: true,
      unreadable: false,
    });

    // A directory at the path cannot be read as a file, and must not read as absent.
    const blocked = scratch();
    mkdirSync(modeFile(blocked), { recursive: true });
    const reading = readExecutionModeFile(blocked);
    assert.equal(reading.present, true);
    assert.equal(reading.unreadable, true);
    assert.equal(reading.valid, false);
  });
});

describe("rendering the file", () => {
  it("produces the same bytes every time, LF only, marker first after the heading", () => {
    for (const mode of EXECUTION_MODES) {
      const once = renderExecutionMode(mode);
      assert.equal(once, renderExecutionMode(mode));
      assert.equal(once.includes("\r"), false);
      assert.match(once, new RegExp(`^# Execution Mode\\n\\n<!-- pathfinder:execution-mode ${mode} -->\\n`));
      assert.ok(once.endsWith("\n") && !once.endsWith("\n\n"));
      assert.deepEqual(readExecutionMode(once), { present: true, mode, valid: true });
      // The file says how to change it, because that is where a person looks.
      assert.match(once, /npx create-pathfinder --mode <value>/);
      assert.match(once, /edit the\nmarker line by hand/);
    }
  });

  it("names both values and the default in either rendering", () => {
    for (const mode of EXECUTION_MODES) {
      const text = renderExecutionMode(mode);
      assert.match(text, /`human-in-the-loop` and `orchestrator`/);
    }
    assert.match(renderExecutionMode("human-in-the-loop"), /what a project with no file at all runs/);
  });

  it("refuses to render a value that is not a mode", () => {
    assert.throws(() => renderExecutionMode("autopilot"), /unknown execution mode `autopilot`/);
    assert.throws(() => renderExecutionMode(undefined), /unknown execution mode/);
  });
});

describe("the --mode value", () => {
  it("accepts exactly the two values", () => {
    assert.deepEqual(parseExecutionModeFlag("human-in-the-loop"), { mode: "human-in-the-loop" });
    assert.deepEqual(parseExecutionModeFlag("orchestrator"), { mode: "orchestrator" });
  });

  it("refuses an unknown value and names both valid ones", () => {
    const parsed = parseExecutionModeFlag("orchestrater");
    assert.match(parsed.error, /unknown execution mode `orchestrater`/);
    assert.match(parsed.error, /human-in-the-loop, orchestrator/);
  });

  it("refuses a missing value, and a flag where a value should be", () => {
    assert.match(parseExecutionModeFlag(undefined).error, /needs a value: human-in-the-loop or orchestrator/);
    assert.match(parseExecutionModeFlag("").error, /needs a value/);
    assert.match(parseExecutionModeFlag("--dry-run").error, /needs a value/);
  });
});

describe("planning the write", () => {
  it("writes where nothing is", () => {
    const cwd = scratch();
    const item = planExecutionMode({ targetRoot: cwd, mode: "orchestrator" });

    assert.equal(item.action, "write");
    assert.equal(item.relativePath, EXECUTION_MODE_PATH);
    assert.equal(item.contents, renderExecutionMode("orchestrator"));
  });

  it("is up to date over its own identical file, and replaces its own different one", () => {
    const cwd = scratch();
    writeModeFile(cwd, renderExecutionMode("human-in-the-loop"));

    assert.equal(planExecutionMode({ targetRoot: cwd, mode: "human-in-the-loop" }).action, "up-to-date");
    assert.equal(planExecutionMode({ targetRoot: cwd, mode: "orchestrator" }).action, "replace");
  });

  it("owns a file by its marker, not its prose", () => {
    // A human edited the prose and kept the marker: still ours, so `--mode`
    // may rewrite it. That is the documented way to change the mode by hand.
    const cwd = scratch();
    writeModeFile(cwd, "# My notes\n\n<!-- pathfinder:execution-mode orchestrator -->\n\nwhatever I like\n");

    assert.equal(planExecutionMode({ targetRoot: cwd, mode: "orchestrator" }).action, "replace");
  });

  it("keeps a routing-policy marker when it rewrites the mode", () => {
    const cwd = scratch();
    writeModeFile(cwd, renderExecutionMode("human-in-the-loop", { routingPolicy: "static" }));

    const item = planExecutionMode({ targetRoot: cwd, mode: "orchestrator" });

    assert.equal(item.action, "replace");
    assert.match(item.contents, /^<!-- pathfinder:execution-mode orchestrator -->\n<!-- pathfinder:routing-policy static -->$/m);
    assert.equal(
      planExecutionMode({ targetRoot: cwd, mode: "human-in-the-loop" }).action,
      "up-to-date",
      "the same mode with the same marker is up to date",
    );
  });

  it("leaves a stranger's file alone without --force, and replaces it with", () => {
    const cwd = scratch();
    writeModeFile(cwd, "# Execution Mode\n\nsomebody's own file, no marker\n");

    assert.equal(planExecutionMode({ targetRoot: cwd, mode: "orchestrator" }).action, "conflict");
    assert.equal(planExecutionMode({ targetRoot: cwd, mode: "orchestrator", force: true }).action, "replace");
  });

  it("reports an unreadable path rather than treating it as absent", () => {
    const cwd = scratch();
    mkdirSync(modeFile(cwd), { recursive: true });

    const item = planExecutionMode({ targetRoot: cwd, mode: "orchestrator" });
    assert.equal(item.action, "unreadable");
    assert.equal(item.contents, null);
  });
});

describe("applying the plan", () => {
  it("applies nothing for a null plan, and says so with a null action", () => {
    const result = applyExecutionModePlan(null);
    assert.deepEqual(result, { action: null, mode: null, relativePath: EXECUTION_MODE_PATH, errors: [] });
  });

  it("writes the file, creating context/ if it must", () => {
    const cwd = scratch();
    const events = [];
    const result = applyExecutionModePlan(planExecutionMode({ targetRoot: cwd, mode: "orchestrator" }), {
      onProgress: (unit) => events.push(unit.ok),
    });

    assert.equal(result.action, "write");
    assert.equal(readFileSync(modeFile(cwd), "utf8"), renderExecutionMode("orchestrator"));
    assert.deepEqual(events, [true]);
  });

  it("writes nothing on a dry run and nothing for a conflict", () => {
    const fresh = scratch();
    applyExecutionModePlan(planExecutionMode({ targetRoot: fresh, mode: "orchestrator" }), { dryRun: true });
    assert.equal(existsSync(modeFile(fresh)), false);

    const theirs = scratch();
    const contents = "# Execution Mode\n\nnot ours\n";
    writeModeFile(theirs, contents);
    const result = applyExecutionModePlan(planExecutionMode({ targetRoot: theirs, mode: "orchestrator" }));
    assert.equal(result.action, "conflict");
    assert.deepEqual(result.errors, []);
    assert.equal(readFileSync(modeFile(theirs), "utf8"), contents);
  });

  it("reports an unreadable path as a failure", () => {
    const cwd = scratch();
    mkdirSync(modeFile(cwd), { recursive: true });
    const result = applyExecutionModePlan(planExecutionMode({ targetRoot: cwd, mode: "orchestrator" }));
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].relativePath, EXECUTION_MODE_PATH);
  });
});

describe("the question, from a real run", () => {
  it("is asked once, after the harness question, in a project with no mode", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({ mode: "orchestrator" });

    const { code } = await invoke([], { cwd, prompter });

    assert.equal(code, 0);
    const harnessIndex = prompter.asked.indexOf("Configure Pathfinder for which tools?");
    const modeIndex = prompter.asked.indexOf(EXECUTION_MODE_QUESTION);
    assert.ok(harnessIndex >= 0, "the harness question was asked");
    assert.ok(modeIndex > harnessIndex, "the mode question follows the harness question");
    assert.equal(prompter.asked.filter((question) => question === EXECUTION_MODE_QUESTION).length, 1);
  });

  it("offers both modes with human-in-the-loop as the default", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({ mode: "human-in-the-loop" });

    await invoke([], { cwd, prompter });

    const [config] = prompter.offered;
    assert.deepEqual(
      config.options.map((option) => option.value),
      ["human-in-the-loop", "orchestrator"],
    );
    assert.deepEqual(
      config.options.map((option) => option.label),
      ["Human-in-the-loop", "Orchestrator"],
    );
    assert.ok(config.options.every((option) => typeof option.hint === "string" && option.hint.length > 0));
    assert.equal(config.defaultValue, "human-in-the-loop");
  });

  it("writes the file for either answer, and says so in the summary", async () => {
    for (const mode of EXECUTION_MODES) {
      const cwd = makeRepository();
      const { code, out } = await invoke([], { cwd, prompter: scriptedPrompter({ mode }) });

      assert.equal(code, 0);
      assert.equal(readFileSync(modeFile(cwd), "utf8"), renderExecutionMode(mode));
      assert.ok(out.includes(`Execution mode recorded: ${mode} (${EXECUTION_MODE_PATH})`), out);
    }
  });

  it("writes nothing when nobody answers", async () => {
    const cwd = makeRepository();
    const { code, out } = await invoke([], { cwd, prompter: scriptedPrompter({ mode: undefined }) });

    assert.equal(code, 0);
    assert.equal(existsSync(modeFile(cwd)), false);
    assert.doesNotMatch(out, /Execution mode/);
  });

  it("is not asked again once the project has answered", async () => {
    const cwd = makeRepository();
    await invoke([], { cwd, prompter: scriptedPrompter({ mode: "orchestrator" }) });

    const again = scriptedPrompter({ mode: "human-in-the-loop" });
    const { out } = await invoke([], { cwd, prompter: again });

    assert.equal(again.asked.includes(EXECUTION_MODE_QUESTION), false, "asked a project that already answered");
    assert.equal(readExecutionModeFile(cwd).mode, "orchestrator", "a re-run must not change the answer");
    assert.doesNotMatch(out, /Execution mode (recorded|changed)/);
  });

  it("is not asked over a file Pathfinder did not write, either", async () => {
    const cwd = makeRepository();
    writeModeFile(cwd, "# Execution Mode\n\nours, not yours\n");
    const prompter = scriptedPrompter({ mode: "orchestrator" });

    await invoke([], { cwd, prompter });

    assert.equal(prompter.asked.includes(EXECUTION_MODE_QUESTION), false);
    assert.equal(readFileSync(modeFile(cwd), "utf8"), "# Execution Mode\n\nours, not yours\n");
  });

  it("is silenced by --yes, which records nothing", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({ mode: "orchestrator" });

    await invoke(["--yes"], { cwd, prompter });

    assert.deepEqual(prompter.asked, []);
    assert.equal(existsSync(modeFile(cwd)), false);
  });

  it("is asked on a dry run, and the answer is reported, not written", async () => {
    const cwd = makeRepository();
    const { out } = await invoke(["--dry-run"], { cwd, prompter: scriptedPrompter({ mode: "orchestrator" }) });

    assert.ok(out.includes(`Execution mode to record: orchestrator (${EXECUTION_MODE_PATH})`), out);
    assert.equal(existsSync(modeFile(cwd)), false);
  });
});

describe("the --mode flag", () => {
  it("records the mode without a terminal", async () => {
    const cwd = makeRepository();
    const { code, out } = await invoke(["--mode", "orchestrator"], { cwd });

    assert.equal(code, 0);
    assert.equal(readFileSync(modeFile(cwd), "utf8"), renderExecutionMode("orchestrator"));
    assert.ok(out.includes(`Execution mode recorded: orchestrator (${EXECUTION_MODE_PATH})`), out);
  });

  it("takes the = spelling and the last of several", async () => {
    const cwd = makeRepository();
    await invoke(["--mode=human-in-the-loop", "--mode", "orchestrator"], { cwd });
    assert.equal(readExecutionModeFile(cwd).mode, "orchestrator");
  });

  it("changes a mode Pathfinder recorded, and says it changed", async () => {
    const cwd = makeRepository();
    await invoke(["--mode", "human-in-the-loop"], { cwd });

    const { code, out } = await invoke(["--mode", "orchestrator"], { cwd });

    assert.equal(code, 0);
    assert.equal(readExecutionModeFile(cwd).mode, "orchestrator");
    assert.ok(out.includes(`Execution mode changed to orchestrator (${EXECUTION_MODE_PATH})`), out);
  });

  it("reports an unchanged mode as already recorded", async () => {
    const cwd = makeRepository();
    await invoke(["--mode", "orchestrator"], { cwd });

    const { out } = await invoke(["--mode", "orchestrator"], { cwd });

    assert.ok(out.includes(`Execution mode already orchestrator (${EXECUTION_MODE_PATH})`), out);
  });

  it("leaves a file Pathfinder did not write exactly as it was, and says so", async () => {
    const cwd = makeRepository();
    const theirs = "# Execution Mode\n\nmine, hand-written, no marker\n";
    writeModeFile(cwd, theirs);

    const { code, out } = await invoke(["--mode", "orchestrator"], { cwd });

    assert.equal(code, 0, "a conflict is an outcome, not a failure");
    assert.equal(readFileSync(modeFile(cwd), "utf8"), theirs);
    assert.ok(out.includes(`${EXECUTION_MODE_PATH} was left untouched because Pathfinder did not write it.`), out);
    assert.ok(out.includes("Re-run with --force to replace it."), out);
  });

  it("replaces that file only under --force", async () => {
    const cwd = makeRepository();
    writeModeFile(cwd, "# Execution Mode\n\nmine\n");

    await invoke(["--mode", "orchestrator", "--force"], { cwd });

    assert.equal(readFileSync(modeFile(cwd), "utf8"), renderExecutionMode("orchestrator"));
  });

  it("refuses an unknown value with exit 2, naming both valid ones", async () => {
    const cwd = makeRepository();
    const { code, err } = await invoke(["--mode", "autopilot"], { cwd });

    assert.equal(code, 2);
    assert.match(err, /unknown execution mode `autopilot`/);
    assert.match(err, /human-in-the-loop, orchestrator/);
    assert.match(err, /Usage:/);
    assert.equal(existsSync(join(cwd, "skills")), false, "nothing was installed");
  });

  it("refuses a missing value with exit 2", async () => {
    const cwd = makeRepository();
    const { code, err } = await invoke(["--mode"], { cwd });

    assert.equal(code, 2);
    assert.match(err, /`--mode` needs a value: human-in-the-loop or orchestrator/);
  });

  it("is documented in --help", async () => {
    const { out } = await invoke(["--help"], { cwd: makeRepository() });
    assert.match(out, /--mode <mode>/);
    assert.match(out, /human-in-the-loop/);
    assert.match(out, /orchestrator/);
  });

  it("speaks in the future tense under --dry-run and writes nothing", async () => {
    const cwd = makeRepository();
    const { out } = await invoke(["--dry-run", "--mode", "orchestrator"], { cwd });

    assert.ok(out.includes(`Execution mode to record: orchestrator (${EXECUTION_MODE_PATH})`), out);
    assert.equal(existsSync(modeFile(cwd)), false);
  });
});

describe("the terminal rendering", () => {
  // `NO_COLOR` is set by `invoke`, so every decorated line below is asserted
  // as plain text; the glyphs are the UTF-8 ones because `LANG` is UTF-8.
  it("names the recorded mode as a milestone and again in the summary", async () => {
    const cwd = makeRepository();
    const { out } = await invoke(["--mode", "orchestrator"], { cwd, stdoutIsTTY: true });

    assert.match(out, /INSTALLING[\s\S]*✓ Execution mode — orchestrator recorded/);
    assert.match(out, /SUMMARY[\s\S]*✓ Execution mode recorded: orchestrator \(context\/execution-mode\.md\)/);
    assert.match(out, /YOU'RE ALL SET/);
    assert.ok(out.indexOf("Execution mode recorded") < out.indexOf("YOU'RE ALL SET"), "the summary line precedes the ending");
  });

  it("speaks in the future tense on a dry run, in both places", async () => {
    const cwd = makeRepository();
    const { out } = await invoke(["--dry-run", "--mode", "orchestrator"], { cwd, stdoutIsTTY: true });

    assert.match(out, /Execution mode — orchestrator would be recorded/);
    assert.match(out, /Execution mode to record: orchestrator \(context\/execution-mode\.md\)/);
    assert.equal(existsSync(modeFile(cwd)), false);
  });

  it("says a change is a change, and an unchanged mode is already recorded", async () => {
    const cwd = makeRepository();
    await invoke(["--mode", "human-in-the-loop"], { cwd });

    const changed = await invoke(["--mode", "orchestrator"], { cwd, stdoutIsTTY: true });
    assert.match(changed.out, /✓ Execution mode — changed to orchestrator/);
    assert.match(changed.out, /✓ Execution mode changed to orchestrator \(context\/execution-mode\.md\)/);

    const same = await invoke(["--mode", "orchestrator"], { cwd, stdoutIsTTY: true });
    assert.match(same.out, /· Execution mode — already orchestrator/);
    assert.match(same.out, /· Execution mode already orchestrator \(context\/execution-mode\.md\)/);
  });

  it("warns about a stranger's file, lists it pasteably, and tempers the ending", async () => {
    const cwd = makeRepository();
    writeModeFile(cwd, "# Execution Mode\n\nmine, no marker\n");

    const { code, out } = await invoke(["--mode", "orchestrator"], { cwd, stdoutIsTTY: true });

    assert.equal(code, 0);
    assert.match(out, /▲ Execution mode — left alone \(Pathfinder did not write context\/execution-mode\.md\)/);
    assert.match(out, /▲ Execution mode left untouched \(Pathfinder did not write context\/execution-mode\.md\)/);
    assert.match(out, /▲ Conflict — 1 file at the path the execution mode is recorded in, which Pathfinder did not write:\n\n {6}context\/execution-mode\.md\n/);
    assert.match(out, /Re-run with --force to replace it/);
    assert.match(out, /1 thing to look at above/);
    assert.doesNotMatch(out, /YOU'RE ALL SET/, "celebrated over a conflict");
    assert.match(out, /READY/);
  });

  it("tells a directory at the path apart from a file with no marker", async () => {
    const cwd = makeRepository();
    mkdirSync(modeFile(cwd), { recursive: true });

    const { out } = await invoke(["--dry-run", "--yes"], { cwd, stdoutIsTTY: true });

    assert.match(out, /Execution mode: context\/execution-mode\.md could not be read/);
    assert.doesNotMatch(out, /has no valid marker/);
  });

  it("keeps every new line in ASCII when the terminal is", async () => {
    const cwd = makeRepository();
    writeModeFile(cwd, "# Execution Mode\n\nmine\n");
    let out = "";
    await run(["--mode", "orchestrator"], {
      cwd,
      out: (text) => (out += text),
      err: () => {},
      env: { LANG: "C", NO_COLOR: "1" },
      platform: "linux",
      stdoutIsTTY: true,
      prompter: forbiddenPrompter(),
    });

    // eslint-disable-next-line no-control-regex
    assert.match(out, /^[\x00-\x7F]*$/, "a non-ASCII byte reached an ASCII terminal");
    assert.match(out, /\* Execution mode - left alone/);
  });
});

describe("the scripted contract is unchanged", () => {
  it("a run with no terminal and no --mode records nothing and prints nothing about a mode", async () => {
    const cwd = makeRepository();
    const { code, out, err } = await invoke([], { cwd });

    assert.equal(code, 0);
    assert.equal(existsSync(modeFile(cwd)), false);
    assert.doesNotMatch(out + err, /[Ee]xecution mode/);
    assert.doesNotMatch(out + err, /execution-mode\.md/);
  });

  it("a legacy project — kit installed, no mode file — is never told it is missing one", async () => {
    const cwd = makeRepository();
    await invoke([], { cwd });
    const { out, err } = await invoke([], { cwd });

    assert.doesNotMatch(out + err, /[Ee]xecution mode/);
  });
});

describe("the mode as an environment finding", () => {
  it("is absent from the findings when there is no file", () => {
    const cwd = makeRepository();
    const findings = detect({ cwd, env: {}, platform: "linux" });
    assert.deepEqual(findings.executionMode, { present: false, mode: null, valid: false, unreadable: false });
  });

  it("is reported at a terminal when the project has one, valid or not", async () => {
    const cwd = makeRepository();
    writeModeFile(cwd, renderExecutionMode("orchestrator"));
    const { out } = await invoke(["--dry-run", "--yes"], { cwd, stdoutIsTTY: true });
    assert.match(out, /Execution mode: orchestrator/);

    const broken = makeRepository();
    writeModeFile(broken, "# Execution Mode\n\nno marker\n");
    const second = await invoke(["--dry-run", "--yes"], { cwd: broken, stdoutIsTTY: true });
    assert.match(second.out, /Execution mode: context\/execution-mode\.md has no valid marker/);
  });

  it("is not printed into a pipe", async () => {
    const cwd = makeRepository();
    writeModeFile(cwd, renderExecutionMode("orchestrator"));
    const { out } = await invoke(["--dry-run", "--yes"], { cwd });
    assert.doesNotMatch(out, /Execution mode/);
  });
});

describe("the mode file never ships", () => {
  it("is on the never-ships list by its kit-relative path", () => {
    assert.equal(neverShips(EXECUTION_MODE_PATH), true);
    assert.equal(neverShips("execution-mode.md"), false);
    assert.equal(neverShips("templates/execution-mode.md"), false);
    assert.equal(neverShips("docs/context/execution-mode.md"), false);
  });
});
