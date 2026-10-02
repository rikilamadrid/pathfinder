/**
 * The Evidence Judge at onboarding: an optional capability, separate from the
 * harness question, enabled only by an explicit choice.
 *
 * Jev is a separate TypeSafe API service with its own account and credential.
 * Nothing here may make it a requirement: the default installs no judge, a
 * `TYPESAFE_API_KEY` in the environment never enables one, the key's value is
 * never printed or written, and the recorded choice survives a re-run until it
 * is explicitly changed.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";

import { run } from "../src/cli.mjs";
import {
  EVIDENCE_JUDGE_QUESTION,
  EXECUTION_MODE_QUESTION,
  parseEvidenceJudgeFlag,
  renderExecutionMode,
} from "../src/execution-mode.mjs";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PACKAGE_ROOT, "bin", "create-pathfinder.mjs");
const KEY = "ts-onboarding-secret-0123456789";
const MARKER = /^<!-- pathfinder:evidence-judge (\S+) -->$/m;

const roots = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function repository() {
  const cwd = mkdtempSync(join(tmpdir(), "pathfinder-judge-"));
  roots.push(cwd);
  mkdirSync(join(cwd, ".git"));
  return cwd;
}
const modeFile = (cwd) => join(cwd, "context", "execution-mode.md");
const marker = (cwd) => (existsSync(modeFile(cwd)) ? MARKER.exec(readFileSync(modeFile(cwd), "utf8"))?.[1] ?? null : null);

/** Answers the harness, mode and judge questions as told; declines every other one. */
function prompter({ mode = "orchestrator", judge = false, harnesses = [] } = {}) {
  const asked = [];
  return {
    interactive: true,
    asked,
    confirm: async (question, config) => {
      asked.push({ question, default: config?.defaultAnswer });
      return question === EVIDENCE_JUDGE_QUESTION ? judge : false;
    },
    chooseMany: async (question) => { asked.push({ question }); return harnesses; },
    chooseOne: async (question, config) => {
      asked.push({ question });
      return question === EXECUTION_MODE_QUESTION ? config.options.find((option) => option.value === mode)?.value ?? null : null;
    },
    text: async () => "",
    close: () => {},
  };
}
const silent = { interactive: false, confirm: async () => { throw new Error("asked"); }, chooseMany: async () => { throw new Error("asked"); }, chooseOne: async () => { throw new Error("asked"); }, text: async () => null, close: () => {} };

async function install(argv, { cwd, ask = silent, env = {}, stdoutIsTTY = false } = {}) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    cwd, out: (text) => (out += text), err: (text) => (err += text),
    env: { LANG: "en_US.UTF-8", NO_COLOR: "1", ...env }, platform: "linux", stdoutIsTTY, prompter: ask,
  });
  return { code, out, err };
}

/** Every byte the install wrote, for proving a secret is nowhere in it. */
function everyFile(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path); else files.push(path);
    }
  };
  walk(root);
  return files;
}

/** The engine the project just received, reading the project's own file. */
async function installedJudge(cwd) {
  const mode = await import(pathToFileURL(join(cwd, "skills/orchestrate/engine/mode.mjs")).href + `?${Math.random()}`);
  return mode.readEvidenceJudge(cwd);
}

describe("Jev is optional at onboarding", () => {
  it("installs no judge by default, scripted or interactive, and works without TYPESAFE_API_KEY", async () => {
    const scripted = repository();
    const quiet = await install([], { cwd: scripted });
    assert.equal(quiet.code, 0, quiet.err);
    assert.equal(existsSync(modeFile(scripted)), false, "a scripted run records nothing, so no judge");
    assert.doesNotMatch(quiet.out, /Evidence Judge|TYPESAFE/);

    const yes = repository();
    assert.equal((await install(["--yes", "--mode", "orchestrator"], { cwd: yes })).code, 0);
    assert.equal(marker(yes), null, "--yes and --mode alone enable nothing");
    assert.deepEqual(await installedJudge(yes), { name: null, explicit: false });

    const asked = repository();
    const ask = prompter({ judge: false });
    const declined = await install([], { cwd: asked, ask });
    assert.equal(declined.code, 0);
    const question = ask.asked.find((entry) => entry.question === EVIDENCE_JUDGE_QUESTION);
    assert.equal(question.default, false, "the question defaults to no");
    assert.match(declined.out, /Evidence Judge \(optional\)[\s\S]*separate TypeSafe API service[\s\S]*does not include it/);
    assert.equal(marker(asked), "none");
    assert.deepEqual(await installedJudge(asked), { name: null, explicit: false }, "none is no judge to the engine");
  });

  it("never enables Jev because TYPESAFE_API_KEY happens to be set", async () => {
    for (const argv of [[], ["--yes"], ["--mode", "orchestrator"]]) {
      const cwd = repository();
      const result = await install(argv, { cwd, env: { TYPESAFE_API_KEY: KEY } });
      assert.equal(result.code, 0);
      assert.equal(marker(cwd), null, `${argv.join(" ") || "no flags"}: a key alone enables nothing`);
    }
    const cwd = repository();
    const ask = prompter({ judge: false });
    await install([], { cwd, ask, env: { TYPESAFE_API_KEY: KEY } });
    assert.equal(ask.asked.find((entry) => entry.question === EVIDENCE_JUDGE_QUESTION).default, false, "a key does not change the default");
    assert.equal(marker(cwd), "none");
  });

  it("asks only in orchestrator mode, and never as part of the harness question", async () => {
    const hitl = repository();
    const ask = prompter({ mode: "human-in-the-loop" });
    await install([], { cwd: hitl, ask });
    assert.equal(ask.asked.some((entry) => entry.question === EVIDENCE_JUDGE_QUESTION), false);
    assert.equal(marker(hitl), null);

    const orchestrated = repository();
    const both = prompter({ judge: true, harnesses: [] });
    await install([], { cwd: orchestrated, ask: both });
    const order = both.asked.map((entry) => entry.question);
    assert.ok(order.indexOf(EXECUTION_MODE_QUESTION) < order.indexOf(EVIDENCE_JUDGE_QUESTION), "asked after the mode it belongs to");
    assert.ok(order.indexOf("Configure Pathfinder for which tools?") < order.indexOf(EXECUTION_MODE_QUESTION));
  });
});

describe("an explicit choice configures exactly what it says", () => {
  it("records Jev from the question or the flag, with truthful prose, under the mode it belongs to", async () => {
    const asked = repository();
    const answered = await install([], { cwd: asked, ask: prompter({ judge: true }) });
    assert.equal(answered.code, 0);
    assert.equal(readFileSync(modeFile(asked), "utf8"), renderExecutionMode("orchestrator", { evidenceJudge: "jev" }));
    assert.match(readFileSync(modeFile(asked), "utf8"), /Jev, a separate\nTypeSafe API service[\s\S]*TYPESAFE_API_KEY[\s\S]*never\napproves/);
    assert.deepEqual(await installedJudge(asked), { name: "jev", explicit: true });

    const flagged = repository();
    const scripted = await install(["--mode", "orchestrator", "--evidence-judge", "jev"], { cwd: flagged });
    assert.equal(scripted.code, 0);
    assert.equal(marker(flagged), "jev");
    assert.match(scripted.out, /Evidence Judge: Jev \(TypeSafe\) configured \(context\/execution-mode\.md\)/);
  });

  it("shows the choice and its credential state in the terminal summary too", async () => {
    const cwd = repository();
    const { code, out } = await install(["--mode", "orchestrator", "--evidence-judge", "jev"], { cwd, stdoutIsTTY: true, env: { TYPESAFE_API_KEY: KEY } });
    assert.equal(code, 0);
    assert.match(out, /SUMMARY[\s\S]*✓ Evidence Judge: Jev \(TypeSafe\) configured[\s\S]*Credential: TYPESAFE_API_KEY detected/);
    assert.equal(out.includes(KEY), false);
  });

  it("reports a missing credential as setup to do, not a failed install", async () => {
    const cwd = repository();
    const result = await install(["--mode", "orchestrator", "--evidence-judge", "jev"], { cwd });
    assert.equal(result.code, 0, "no key does not block the install");
    assert.match(result.out, /Credential: TYPESAFE_API_KEY not detected\. Set it before using the Evidence Judge: https:\/\/docs\.typesafe\.ai\//);
  });

  it("never prints or writes the key's value", async () => {
    const cwd = repository();
    const result = await install(["--mode", "orchestrator", "--evidence-judge=jev"], { cwd, env: { TYPESAFE_API_KEY: KEY } });
    assert.equal(result.code, 0);
    assert.match(result.out, /Credential: TYPESAFE_API_KEY detected \(its value is never printed or stored\)/);
    assert.equal(`${result.out}${result.err}`.includes(KEY), false);
    for (const path of everyFile(cwd)) assert.equal(readFileSync(path, "utf8").includes(KEY), false, path);
  });

  it("says a judge chosen outside orchestrator mode is not asked until the project is one", async () => {
    const cwd = repository();
    const result = await install(["--evidence-judge", "jev"], { cwd });
    assert.equal(result.code, 0);
    assert.equal(marker(cwd), "jev");
    assert.match(readFileSync(modeFile(cwd), "utf8"), /<!-- pathfinder:execution-mode human-in-the-loop -->/);
    assert.match(result.out, /runs only in orchestrator mode/);
  });

  it("refuses an unknown judge, as it refuses an unknown mode", async () => {
    assert.deepEqual(parseEvidenceJudgeFlag("jev"), { evidenceJudge: "jev" });
    const cwd = repository();
    const result = await install(["--evidence-judge", "oracle"], { cwd });
    assert.equal(result.code, 2);
    assert.match(result.err, /unknown evidence judge `oracle`\. Valid values: none, jev/);
    assert.equal(existsSync(modeFile(cwd)), false);
  });
});

describe("the choice persists until it is explicitly changed", () => {
  it("survives re-runs, mode changes and harness changes, and is not asked again", async () => {
    const cwd = repository();
    await install(["--mode", "orchestrator", "--evidence-judge", "jev"], { cwd });
    await install([], { cwd });
    assert.equal(marker(cwd), "jev", "a plain re-run keeps it");
    const ask = prompter({ judge: false, harnesses: [] });
    await install([], { cwd, ask });
    assert.equal(ask.asked.some((entry) => entry.question === EVIDENCE_JUDGE_QUESTION), false, "an answered project is not re-asked");
    await install(["--mode", "human-in-the-loop"], { cwd });
    assert.equal(marker(cwd), "jev", "changing the mode is not a decision about the judge");
    await install(["--agents", "claude-code", "--mode", "orchestrator"], { cwd });
    assert.equal(marker(cwd), "jev", "choosing a harness is not a decision about the judge");
    assert.ok(existsSync(join(cwd, ".claude", "skills")), "and the harness is configured independently");
  });

  it("turns off with --evidence-judge none, returning the engine to no judge", async () => {
    const cwd = repository();
    await install(["--mode", "orchestrator", "--evidence-judge", "jev"], { cwd });
    const off = await install(["--evidence-judge", "none"], { cwd });
    assert.equal(off.code, 0);
    assert.equal(marker(cwd), "none");
    assert.match(off.out, /Evidence Judge: disabled; no external judge is used/);
    assert.match(off.out, /Execution mode already orchestrator/, "a judge change is not reported as a mode change");
    assert.match(readFileSync(modeFile(cwd), "utf8"), /<!-- pathfinder:execution-mode orchestrator -->/);
    assert.deepEqual(await installedJudge(cwd), { name: null, explicit: false });
    assert.doesNotMatch(readFileSync(modeFile(cwd), "utf8"), /reads its own API key/, "the prose no longer describes Jev as enabled");
  });

  it("leaves a stranger's mode file alone and says the judge was not recorded", async () => {
    const cwd = repository();
    mkdirSync(join(cwd, "context"), { recursive: true });
    writeFileSync(modeFile(cwd), "my own notes\n");
    const result = await install(["--evidence-judge", "jev"], { cwd });
    assert.equal(readFileSync(modeFile(cwd), "utf8"), "my own notes\n");
    assert.match(result.out, /Evidence Judge not recorded/);
  });
});

describe("A10: a judge choice never rewrites the execution mode", () => {
  const invalid = () => renderExecutionMode("orchestrator").replace("execution-mode orchestrator", "execution-mode turbo");
  for (const force of [false, true]) {
    it(`leaves an invalid mode file untouched and fails explicitly${force ? ", even with --force" : ""}`, async () => {
      const cwd = repository();
      mkdirSync(join(cwd, "context"), { recursive: true });
      writeFileSync(modeFile(cwd), invalid());
      const result = await install(["--evidence-judge", "jev", ...(force ? ["--force"] : [])], { cwd });
      assert.equal(readFileSync(modeFile(cwd), "utf8"), invalid(), "the recorded mode is preserved byte for byte");
      assert.notEqual(result.code, 0, "the requested judge was not recorded, and the run says so");
      assert.match(`${result.out}${result.err}`, /Evidence Judge not recorded/);
      assert.match(`${result.out}${result.err}`, /no valid execution mode[\s\S]*--mode/);
      assert.doesNotMatch(result.out, /Execution mode changed/);
    });
  }

  it("changes the mode only when the run also asked for one", async () => {
    const cwd = repository();
    mkdirSync(join(cwd, "context"), { recursive: true });
    writeFileSync(modeFile(cwd), invalid());
    const result = await install(["--mode", "orchestrator", "--evidence-judge", "jev", "--force"], { cwd });
    assert.equal(result.code, 0, result.err);
    assert.equal(readFileSync(modeFile(cwd), "utf8"), renderExecutionMode("orchestrator", { evidenceJudge: "jev" }));
  });
});

describe("the npm entry point behaves the same", () => {
  const npx = (cwd, args, env = {}) => spawnSync(process.execPath, [BIN, ...args], {
    cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: cwd, NO_COLOR: "1", ...env },
  });

  it("installs without Jev, configures it only when told, and never echoes the key", async () => {
    const plain = repository();
    const without = npx(plain, ["--mode", "orchestrator"], { TYPESAFE_API_KEY: KEY });
    assert.equal(without.status, 0, without.stderr);
    assert.equal(marker(plain), null);
    assert.equal(existsSync(join(plain, "skills/orchestrate/engine/judges/jev.mjs")), true, "the optional provider ships, inert");

    const chosen = repository();
    const withJev = npx(chosen, ["--mode", "orchestrator", "--evidence-judge", "jev"], { TYPESAFE_API_KEY: KEY });
    assert.equal(withJev.status, 0, withJev.stderr);
    assert.equal(marker(chosen), "jev");
    assert.equal(`${withJev.stdout}${withJev.stderr}`.includes(KEY), false);
    assert.match(npx(chosen, ["--help"]).stdout, /--evidence-judge <judge>/);
  });
});
