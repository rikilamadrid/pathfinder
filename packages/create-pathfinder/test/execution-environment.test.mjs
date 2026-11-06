/**
 * `--environment <local|sandbox>`: recorded only when chosen, preserved
 * exactly as the routing policy and Evidence Judge are, and read by the
 * engine the project receives.
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";

import { run } from "../src/cli.mjs";
import { parseExecutionEnvironmentFlag, readExecutionEnvironmentMarker, renderExecutionMode } from "../src/execution-mode.mjs";

const roots = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function repository() {
  const cwd = mkdtempSync(join(tmpdir(), "pathfinder-environment-"));
  roots.push(cwd);
  mkdirSync(join(cwd, ".git"));
  return cwd;
}
const modeFile = (cwd) => join(cwd, "context", "execution-mode.md");
const marker = (cwd) => (existsSync(modeFile(cwd)) ? readExecutionEnvironmentMarker(readFileSync(modeFile(cwd), "utf8")) : null);
const silent = { interactive: false, confirm: async () => { throw new Error("asked"); }, chooseMany: async () => { throw new Error("asked"); }, chooseOne: async () => { throw new Error("asked"); }, text: async () => null, close: () => {} };

async function install(argv, { cwd, stdoutIsTTY = false } = {}) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    cwd, out: (text) => (out += text), err: (text) => (err += text),
    env: { LANG: "en_US.UTF-8", NO_COLOR: "1" }, platform: "linux", stdoutIsTTY, prompter: silent,
  });
  return { code, out, err };
}

async function engineReading(cwd) {
  const mode = await import(pathToFileURL(join(cwd, "skills/orchestrate/engine/mode.mjs")).href + `?${Math.random()}`);
  return mode.readExecutionEnvironment(cwd);
}

describe("--environment", () => {
  it("parses local and sandbox, and refuses anything else by name", () => {
    assert.deepEqual(parseExecutionEnvironmentFlag("sandbox"), { executionEnvironment: "sandbox" });
    assert.deepEqual(parseExecutionEnvironmentFlag("local"), { executionEnvironment: "local" });
    assert.match(parseExecutionEnvironmentFlag("cloud").error, /unknown execution environment `cloud`\. Valid values: local, sandbox/);
    assert.match(parseExecutionEnvironmentFlag(undefined).error, /`--environment` needs a value: local or sandbox/);
  });

  it("records nothing unless chosen, so existing files keep their bytes", async () => {
    const cwd = repository();
    assert.equal((await install(["--mode", "orchestrator"], { cwd })).code, 0);
    assert.equal(readFileSync(modeFile(cwd), "utf8"), renderExecutionMode("orchestrator"));
    assert.equal(marker(cwd), null);
    assert.deepEqual(await engineReading(cwd), { environment: "local", explicit: false, valid: true });
  });

  it("writes sandbox with truthful prose, read by the installed engine", async () => {
    const cwd = repository();
    const result = await install(["--mode", "orchestrator", "--environment", "sandbox"], { cwd });
    assert.equal(result.code, 0, result.err);
    assert.equal(readFileSync(modeFile(cwd), "utf8"), renderExecutionMode("orchestrator", { executionEnvironment: "sandbox" }));
    assert.match(readFileSync(modeFile(cwd), "utf8"), /never runs workers locally\ninstead/);
    assert.deepEqual(await engineReading(cwd), { environment: "sandbox", explicit: true, valid: true });
    assert.match(result.out, /Execution environment: sandbox recorded \(context\/execution-mode\.md\)/);
    assert.match(result.out, /orchestrate\.mjs environment/);
  });

  it("is kept across re-runs, mode changes and judge changes, until --environment changes it", async () => {
    const cwd = repository();
    await install(["--mode", "orchestrator", "--environment=sandbox"], { cwd });
    await install([], { cwd });
    assert.equal(marker(cwd), "sandbox", "a plain re-run keeps it");
    await install(["--mode", "human-in-the-loop"], { cwd });
    assert.equal(marker(cwd), "sandbox", "a mode change is not a decision about the environment");
    await install(["--mode", "orchestrator", "--evidence-judge", "jev"], { cwd });
    assert.equal(marker(cwd), "sandbox", "a judge choice is not either");
    const back = await install(["--environment", "local"], { cwd });
    assert.equal(back.code, 0);
    assert.equal(marker(cwd), "local");
    assert.match(back.out, /Execution mode already orchestrator/, "an environment change is not reported as a mode change");
    assert.match(readFileSync(modeFile(cwd), "utf8"), /<!-- pathfinder:evidence-judge jev -->/);
  });

  it("preserves an existing line exactly, even a value it would not write", async () => {
    const cwd = repository();
    mkdirSync(join(cwd, "context"), { recursive: true });
    writeFileSync(modeFile(cwd), "# Execution Mode\n\n<!-- pathfinder:execution-mode orchestrator -->\n<!-- pathfinder:execution-environment cloud -->\n");
    await install(["--mode", "human-in-the-loop"], { cwd });
    assert.equal(marker(cwd), "cloud");
    assert.deepEqual(await engineReading(cwd), { environment: "cloud", explicit: true, valid: false });
  });

  it("keeps a malformed line verbatim, so the engine still refuses it, until --environment replaces it", async () => {
    for (const line of [
      "<!-- pathfinder:execution-environment: sandbox -->",
      "<!-- pathfinder:execution-environment=sandbox -->",
      "<!-- pathfinder:execution-environment sandbox (pinned) -->",
      "<!-- pathfinder:execution-environment sandbox --> <!-- chosen 2026-11 -->",
    ]) {
      const cwd = repository();
      await install(["--mode", "orchestrator"], { cwd });
      writeFileSync(modeFile(cwd), readFileSync(modeFile(cwd), "utf8").replace("<!-- pathfinder:execution-mode orchestrator -->", `<!-- pathfinder:execution-mode orchestrator -->\n  ${line}\r`));
      const invalid = { environment: line, explicit: true, valid: false };
      assert.deepEqual(await engineReading(cwd), invalid);
      for (const argv of [["--mode", "human-in-the-loop"], ["--mode", "orchestrator", "--evidence-judge", "none"]]) {
        assert.equal((await install(argv, { cwd })).code, 0);
        assert.equal(marker(cwd), line, `${argv.join(" ")} keeps it`);
        assert.ok(readFileSync(modeFile(cwd), "utf8").split("\n").includes(line), "written back exactly as read");
        assert.deepEqual(await engineReading(cwd), invalid, "never dropped, which would read local");
      }
      assert.equal((await install(["--environment", "sandbox"], { cwd })).code, 0);
      assert.equal(marker(cwd), "sandbox");
      assert.deepEqual(await engineReading(cwd), { environment: "sandbox", explicit: true, valid: true });
    }
  });

  it("keeps the sandbox permission mode and agent-auth lines across re-renders", async () => {
    const cwd = repository();
    await install(["--mode", "orchestrator", "--environment", "sandbox"], { cwd });
    const extra = "<!-- pathfinder:sandbox-permission-mode acceptEdits -->\n<!-- pathfinder:sandbox-agent-auth subscription -->\n";
    writeFileSync(modeFile(cwd), readFileSync(modeFile(cwd), "utf8") + extra);
    await install(["--mode", "human-in-the-loop"], { cwd });
    await install(["--environment", "sandbox", "--evidence-judge", "none"], { cwd });
    const content = readFileSync(modeFile(cwd), "utf8");
    assert.match(content, /^<!-- pathfinder:sandbox-permission-mode acceptEdits -->$/m);
    assert.match(content, /^<!-- pathfinder:sandbox-agent-auth subscription -->$/m);
    const mode = await import(pathToFileURL(join(cwd, "skills/orchestrate/engine/mode.mjs")).href + `?${Math.random()}`);
    assert.deepEqual(mode.readSandboxSettings(cwd).permissionMode, { mode: "acceptEdits", explicit: true, valid: true });
    assert.deepEqual(mode.readSandboxSettings(cwd).agentAuth, { value: "subscription", explicit: true, valid: true });
  });

  it("leaves a file with no valid mode untouched and says the environment was not recorded", async () => {
    const cwd = repository();
    mkdirSync(join(cwd, "context"), { recursive: true });
    const invalid = renderExecutionMode("orchestrator").replace("execution-mode orchestrator", "execution-mode turbo");
    writeFileSync(modeFile(cwd), invalid);
    const result = await install(["--environment", "sandbox"], { cwd });
    assert.notEqual(result.code, 0);
    assert.equal(readFileSync(modeFile(cwd), "utf8"), invalid);
    assert.match(`${result.out}${result.err}`, /Execution environment not recorded/);
    assert.match(`${result.out}${result.err}`, /no valid execution mode, so the execution environment was not recorded[\s\S]*--environment/);
  });

  it("says a sandbox applies only to orchestrated dispatch in human-in-the-loop mode, and is in --help", async () => {
    const cwd = repository();
    const result = await install(["--environment", "sandbox"], { cwd, stdoutIsTTY: true });
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /applies only to orchestrated dispatch/);
    assert.match((await install(["--help"], { cwd })).out, /--environment <environment>/);
  });

  it("refuses an unknown environment and writes nothing", async () => {
    const cwd = repository();
    const result = await install(["--environment", "cloud"], { cwd });
    assert.equal(result.code, 2);
    assert.match(result.err, /unknown execution environment `cloud`/);
    assert.equal(existsSync(modeFile(cwd)), false);
  });
});
