import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";
import { cleanUpTemporaryDirectories, ENGINE_ROOT, temporaryDirectory } from "../lib/harness.mjs";

const resources = await import(pathToFileURL(join(ENGINE_ROOT, "sandbox-resources.mjs")));
const { OWNER_SCHEMA, RETENTION, archiveDirectory, cleanupPlan, defaultRun, executeCleanup, isSandboxName, listOwned, newRunId, readOwnerRecords, removeWithin, runDirectory, sandboxName, sbxExecutable, stopOwned, updateOwnerRecord, writeOwnerRecord } = resources;
const { ownerRecord, processChain } = await import(pathToFileURL(join(ENGINE_ROOT, "process.mjs")));

after(cleanUpTemporaryDirectories);

const WINDOWS = process.platform === "win32";
/** chmod cannot make a directory unreadable on Windows, or to root. */
const CHMOD_IGNORED = WINDOWS || process.getuid?.() === 0;
const NOW = new Date("2026-11-06T16:25:47.123Z");
const linkDir = (target, path) => symlinkSync(target, path, WINDOWS ? "junction" : "dir");

/** Every argv any fixture runner in this file was asked to run, for the global argv assertions. */
const everyCall = [];

/**
 * FIXTURE sbx runner — labelled: a stand-in for Docker Sandboxes, never the real
 * `sbx`. It answers `ls --json` from `sandboxes`, applies `stop` and `rm`, and
 * logs every argv. `mode` makes it unavailable (spawn error), unreadable (not
 * JSON) or failing (non-zero exit).
 */
function fixtureSbx(sandboxes = [], { mode = "ok" } = {}) {
  const fixture = {
    label: "FIXTURE sbx (not Docker Sandboxes)",
    sandboxes,
    calls: [],
    mode,
    run(argv) {
      fixture.calls.push(argv);
      everyCall.push(argv);
      if (fixture.mode === "unavailable") return { status: null, signal: null, stdout: "", stderr: "", error: Object.assign(new Error("spawn sbx ENOENT"), { code: "ENOENT" }) };
      if (fixture.mode === "failing") return { status: 1, signal: null, stdout: "", stderr: "daemon not running", error: null };
      const [, noInput, command, ...rest] = argv;
      assert.equal(noInput, "--no-input", "every sbx call is prefixed with --no-input");
      if (command === "ls") {
        if (fixture.mode === "unreadable") return { status: 0, signal: null, stdout: "SANDBOX  STATUS\n", stderr: "", error: null };
        return { status: 0, signal: null, stdout: JSON.stringify(fixture.sandboxes), stderr: "", error: null };
      }
      const name = rest.at(-1);
      const found = fixture.sandboxes.find((entry) => entry.name === name);
      if (!found) return { status: 1, signal: null, stdout: "", stderr: `no sandbox ${name}`, error: null };
      if (command === "stop") found.status = "stopped";
      else if (command === "rm") fixture.sandboxes.splice(fixture.sandboxes.indexOf(found), 1);
      return { status: 0, signal: null, stdout: "[]", stderr: "", error: null };
    },
  };
  return fixture;
}

const deadOwner = () => ownerRecord(spawnSync(process.execPath, ["-e", ""]).pid, "node");
const liveOwner = () => ownerRecord(process.pid, processChain(process.pid, { depth: 1 })[0]?.command ?? null);
const unknownOwner = () => ({ pid: 4242, host: `${hostname()}-elsewhere`, platform: "linux", command: "claude" });

let counter = 0;
/** A run directory with an owner record, a workspace with outputs, and a log. */
function makeRun(root, { key = "64.3", session = "implementation", state = "collected", owner = deadOwner(), outputs = true } = {}) {
  counter += 1;
  const runId = newRunId(NOW, () => counter.toString(16).padStart(8, "0"));
  const runDir = runDirectory(root, key, runId);
  const workspace = join(runDir, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src", "index.js"), "export {};\n");
  if (outputs) {
    mkdirSync(join(workspace, ".pathfinder-sandbox", "out"), { recursive: true });
    writeFileSync(join(workspace, ".pathfinder-sandbox", "out", "result.json"), '{"schema":"pathfinder.sandbox-result/1","outcome":"DONE","message":"ok"}\n');
  }
  mkdirSync(join(runDir, "logs"), { recursive: true });
  writeFileSync(join(runDir, "logs", "exec.log"), "agent output\n");
  const record = {
    schema: OWNER_SCHEMA, key, runId, session, role: "developer",
    sandbox: sandboxName(key, session, runId), workspace,
    branch: `ticket/${key}-x`, dispatchedHead: "abcdef1234567890abcdef1234567890abcdef12",
    createdAt: NOW.toISOString(), owner, runtime: { name: "sbx", version: "0.48.0" },
    state, agent: { sessionId: null }, evidence: { archive: null },
  };
  const written = writeOwnerRecord(runDir, record);
  assert.ok(written.ok, written.message);
  return { runId, runDir, workspace, record, name: record.sandbox };
}

const listed = (run, status = "stopped", workspace = run.workspace) => ({ name: run.name, status, workspace });

/** Every path under `dir` with its kind, size and mtime: a fingerprint of the filesystem. */
function snapshot(dir) {
  const out = [];
  const visit = (current) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const stats = lstatSync(path);
      out.push(`${relative(dir, path)} ${stats.isSymbolicLink() ? "link" : stats.isDirectory() ? "dir" : stats.size} ${stats.mtimeMs}`);
      if (stats.isDirectory() && !stats.isSymbolicLink()) visit(path);
    }
  };
  visit(dir);
  return out;
}

const readRecord = (run) => JSON.parse(readFileSync(join(run.runDir, "owner.json"), "utf8"));

describe("sandbox identity", () => {
  it("run ids are a UTC timestamp and 8 hex", () => {
    assert.equal(newRunId(NOW, () => "1a2b3c4d"), "20261106T162547Z-1a2b3c4d");
    assert.match(newRunId(), /^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
    assert.notEqual(newRunId(NOW), newRunId(NOW));
    assert.throws(() => newRunId(NOW, () => "XYZ"));
  });

  it("sandbox names follow the shared contract and sbx naming rules", () => {
    assert.equal(sandboxName("64.1", "implementation", "20261106T162547Z-1a2b3c4d"), "pf-64-1-implementation-1a2b3c4d");
    assert.equal(sandboxName("64.10", "rebase-and-reverify", "20261106T162547Z-00ff00ff"), "pf-64-10-rebase-and-reverify-00ff00ff");
    for (const [key, session, runId] of [["64", "implementation", "20261106T162547Z-1a2b3c4d"], ["64.1", "Impl ementation", "20261106T162547Z-1a2b3c4d"], ["64.1", "implementation", "20261106-1a2b3c4d"], ["64.1", "-x", "20261106T162547Z-1a2b3c4d"]]) {
      assert.throws(() => sandboxName(key, session, runId), TypeError);
    }
    assert.ok(isSandboxName("pf-1-1-x-00000000"));
    for (const bad of ["p", "-pf", ".pf", "pf_1", "pf 1", "pf/1", ""]) assert.equal(isSandboxName(bad), false, bad);
  });

  it("the sbx executable is PATHFINDER_SBX when absolute, else sbx on PATH", () => {
    assert.equal(sbxExecutable({}), "sbx");
    assert.equal(sbxExecutable({ PATHFINDER_SBX: "/opt/fixture/sbx" }), "/opt/fixture/sbx");
    assert.equal(sbxExecutable({ PATHFINDER_SBX: "relative/sbx" }), "sbx");
  });

  it("the default runner spawns without a shell and returns the contract's shape", () => {
    const result = defaultRun([process.execPath, "-e", "process.stdout.write('$HOME;'); process.exit(3)"]);
    assert.deepEqual({ status: result.status, stdout: result.stdout, error: result.error }, { status: 3, stdout: "$HOME;", error: null });
    const missing = defaultRun([join(temporaryDirectory("sbx-missing-"), "sbx"), "--no-input", "ls", "--json"]);
    assert.ok(missing.error);
  });

  it("documents the retention policy", () => {
    assert.deepEqual(RETENTION.collected, { sandbox: "remove-after-archive", workspace: "remove-after-archive" });
    assert.equal(RETENTION.failed.sandbox, "stop-and-retain");
    assert.equal(RETENTION.interrupted.workspace, "retain-until-explicit-cleanup");
    assert.ok(Object.isFrozen(RETENTION) && Object.isFrozen(RETENTION.failed));
  });
});

describe("owner records", () => {
  it("are written atomically and refused when invalid, leaving the old record intact", () => {
    const root = temporaryDirectory("sbx-owner-");
    const run = makeRun(root, { state: "prepared" });
    const before = readFileSync(join(run.runDir, "owner.json"), "utf8");
    assert.equal(JSON.parse(before).schema, "pathfinder.sandbox-owner/1");
    assert.deepEqual(readdirSync(run.runDir).filter((name) => name.startsWith("checkpoint-write-")), [], "no temporary file is left behind");
    for (const bad of [{ schema: "other/1" }, { sandbox: "pf-64-3-implementation-ffffffff" }, { key: "64.4" }, { state: "paused" }, { workspace: "relative/workspace" }, { workspace: join(root, "elsewhere", "workspace") }, { workspace: join(run.workspace, "workspace") }, { workspace: run.runDir }]) {
      assert.equal(writeOwnerRecord(run.runDir, { ...run.record, ...bad }).ok, false, JSON.stringify(bad));
    }
    assert.equal(readFileSync(join(run.runDir, "owner.json"), "utf8"), before);
  });

  it("move only forward along prepared → created → running → stopped → collected | failed → removed", () => {
    const root = temporaryDirectory("sbx-transitions-");
    const run = makeRun(root, { state: "prepared" });
    for (const state of ["created", "running", "stopped", "collected", "removed"]) {
      const result = updateOwnerRecord(run.runDir, { state }, { now: NOW });
      assert.ok(result.ok, `${state}: ${result.message}`);
    }
    assert.match(updateOwnerRecord(run.runDir, { evidence: { archive: "x" } }).message, /removed/);

    const other = makeRun(root, { state: "running" });
    assert.equal(updateOwnerRecord(other.runDir, { state: "created" }).ok, false, "never backwards");
    assert.equal(updateOwnerRecord(other.runDir, { state: "removed" }).ok, false, "removed only after collected or failed");
    assert.equal(updateOwnerRecord(other.runDir, { sandbox: "pf-x-y-zzzzzzzz" }).ok, false, "identity is fixed");
    assert.equal(updateOwnerRecord(other.runDir, { owner: liveOwner() }).ok, false, "the owner is identity");
    assert.equal(updateOwnerRecord(other.runDir, { state: "stopped" }, { from: "created" }).ok, false, "a stale caller is refused");
    assert.ok(updateOwnerRecord(other.runDir, { state: "failed" }, { from: "running" }).ok, "failure ends any live state");
    assert.equal(updateOwnerRecord(other.runDir, { state: "collected" }).ok, false, "failed and collected are exclusive");
    assert.ok(updateOwnerRecord(other.runDir, { agent: { sessionId: "abc" } }).ok, "mutable fields change without a state move");
    assert.equal(readRecord(other).agent.sessionId, "abc");
  });

  it("malformed records are returned as unreadable, never dropped", () => {
    const root = temporaryDirectory("sbx-read-");
    const good = makeRun(root);
    const broken = makeRun(root);
    writeFileSync(join(broken.runDir, "owner.json"), "{ not json");
    const moved = makeRun(root, { key: "64.2" });
    writeFileSync(join(moved.runDir, "owner.json"), JSON.stringify({ ...moved.record, runId: "20261106T000000Z-00000000", sandbox: sandboxName("64.2", "implementation", "20261106T000000Z-00000000") }));
    mkdirSync(join(root, ".pathfinder", "sandboxes", "64.3", "not-a-run"));
    const elsewhere = temporaryDirectory("sbx-elsewhere-");
    linkDir(elsewhere, join(root, ".pathfinder", "sandboxes", "64.3", "20261106T000000Z-0000abcd"));

    const records = readOwnerRecords(root);
    const unreadable = records.filter((entry) => entry.status === "unreadable");
    assert.deepEqual(records.filter((entry) => entry.status === "ok").map((entry) => entry.runId), [good.runId]);
    assert.equal(unreadable.length, 4);
    assert.ok(unreadable.some((entry) => entry.runId === broken.runId && /JSON/.test(entry.reason)));
    assert.ok(unreadable.some((entry) => entry.runId === moved.runId && /run directory/.test(entry.reason)));
    assert.ok(unreadable.some((entry) => /symlink/.test(entry.reason)));
    assert.deepEqual(readOwnerRecords(root, { key: "64.2" }).map((entry) => entry.status), ["unreadable"]);
  });

  it("an unreadable key or run directory is reported with its reason, and the rest are still listed and planned", { skip: CHMOD_IGNORED && "chmod does not restrict this user here" }, () => {
    const root = temporaryDirectory("sbx-eacces-");
    const readable = makeRun(root, { key: "64.3" });
    makeRun(root, { key: "64.4" });
    const closed = makeRun(root, { key: "64.2" });
    const unlisted = makeRun(root, { key: "64.1" });
    const keyDir = join(root, ".pathfinder", "sandboxes", "64.4");
    const sbx = fixtureSbx([]);
    chmodSync(keyDir, 0o000);
    chmodSync(closed.runDir, 0o000);
    // Its record can be read, but the directory cannot be listed for evidence.
    chmodSync(unlisted.runDir, 0o300);
    try {
      const records = readOwnerRecords(root);
      const record = (runDir) => records.find((entry) => entry.runDir === runDir);
      assert.equal(record(readable.runDir).status, "ok");
      assert.deepEqual([record(keyDir).status, record(keyDir).key, record(keyDir).runId], ["unreadable", "64.4", null]);
      assert.match(record(keyDir).reason, /cannot read: EACCES/);
      assert.equal(record(closed.runDir).status, "unreadable");
      assert.match(record(closed.runDir).reason, /cannot read owner\.json: EACCES/, "a permission error is not reported as missing");

      const listing = listOwned({ root, run: sbx.run });
      assert.deepEqual(listing.owned.map((row) => row.runId).sort(), [readable.runId, unlisted.runId].sort());
      assert.ok(listing.unreadable.some((entry) => entry.runDir === keyDir && /EACCES/.test(entry.reason)));

      const plan = cleanupPlan({ root, run: sbx.run });
      assert.deepEqual(plan.runs.map((entry) => entry.runId), [readable.runId]);
      assert.match(plan.skipped.find((entry) => entry.runDir === keyDir).reason, /cannot read: EACCES/);
      assert.match(plan.skipped.find((entry) => entry.runId === closed.runId).reason, /cannot read owner\.json: EACCES/);
      assert.match(plan.skipped.find((entry) => entry.runId === unlisted.runId).reason, /cannot read run directory: EACCES/);
    } finally {
      for (const dir of [keyDir, closed.runDir, unlisted.runDir]) chmodSync(dir, 0o755);
    }
  });
});

describe("listing owned sandboxes", () => {
  it("joins records with sbx ls by exact name and never lists an unrecorded pf- sandbox", () => {
    const root = temporaryDirectory("sbx-list-");
    const running = makeRun(root, { state: "running", owner: liveOwner() });
    const stopped = makeRun(root, { state: "failed" });
    const absent = makeRun(root, { key: "64.1", state: "collected" });
    const sbx = fixtureSbx([listed(running, "running"), listed(stopped, "stopped"), { name: "pf-64-3-implementation-deadbeef", status: "stopped", workspace: join(root, "elsewhere") }, { name: "pf-64-3-implementation", status: "running", workspace: running.workspace }]);

    const result = listOwned({ root, run: sbx.run });
    assert.equal(result.sbx.available, true);
    assert.deepEqual(result.owned.map((row) => [row.key, row.runId, row.status, row.owner, row.state]).sort(), [
      ["64.1", absent.runId, "absent", "dead", "collected"],
      ["64.3", running.runId, "running", "alive", "running"],
      ["64.3", stopped.runId, "stopped", "dead", "failed"],
    ].sort());
    const row = result.owned.find((entry) => entry.runId === stopped.runId);
    assert.deepEqual(Object.keys(row).sort(), ["archive", "archiveDir", "key", "owner", "role", "runDir", "runId", "sandbox", "session", "state", "status", "workspace", "workspaceExists"].sort());
    assert.equal(row.archiveDir, archiveDirectory(root, "64.3", stopped.runId));
    assert.ok(!result.owned.some((entry) => entry.sandbox.endsWith("deadbeef")));
    assert.deepEqual(listOwned({ root, run: sbx.run, key: "64.1" }).owned.map((entry) => entry.runId), [absent.runId]);
  });

  it("reports every status unknown when sbx is unavailable or unreadable", () => {
    const root = temporaryDirectory("sbx-list-unknown-");
    const run = makeRun(root);
    for (const mode of ["unavailable", "unreadable", "failing"]) {
      const result = listOwned({ root, run: fixtureSbx([listed(run)], { mode }).run });
      assert.equal(result.sbx.available, false, mode);
      assert.deepEqual(result.owned.map((row) => row.status), ["unknown"], mode);
    }
  });
});

describe("stopping owned sandboxes", () => {
  it("stops a recorded running sandbox, records it, and never removes", () => {
    const root = temporaryDirectory("sbx-stop-");
    const run = makeRun(root, { state: "running" });
    const failed = makeRun(root, { state: "failed" });
    const sbx = fixtureSbx([listed(run, "running"), listed(failed, "running"), { name: "pf-64-3-implementation-deadbeef", status: "running", workspace: join(root, "x") }]);
    const result = stopOwned({ root, run: sbx.run, key: "64.3", now: NOW });
    assert.deepEqual(result.stopped.map((entry) => [entry.runId, entry.state, entry.wasRunning]).sort(), [[run.runId, "stopped", true], [failed.runId, "failed", true]].sort());
    assert.equal(readRecord(run).state, "stopped");
    assert.equal(readRecord(failed).state, "failed", "a final state is kept");
    assert.deepEqual(sbx.calls.filter((argv) => argv[2] !== "ls").map((argv) => argv.slice(2)).sort(), [["stop", "--json", run.name], ["stop", "--json", failed.name]].sort());
    assert.equal(sbx.sandboxes.find((entry) => entry.name.endsWith("deadbeef")).status, "running", "an unrecorded sandbox is never stopped");
    assert.ok(existsSync(run.workspace));
  });

  it("does not stop a sandbox whose workspace disagrees with its record", () => {
    const root = temporaryDirectory("sbx-stop-mismatch-");
    const run = makeRun(root, { state: "running" });
    const sbx = fixtureSbx([listed(run, "running", join(root, "someone-else"))]);
    const result = stopOwned({ root, run: sbx.run, key: "64.3", runId: run.runId });
    assert.deepEqual(result.stopped, []);
    assert.match(result.skipped[0].reason, /ownership unknown/);
    assert.ok(!sbx.calls.some((argv) => argv[2] === "stop"));
  });
});

describe("cleanup", () => {
  it("skips, with reasons, everything it cannot prove owned and inactive", () => {
    const root = temporaryDirectory("sbx-skip-");
    const running = makeRun(root, { state: "running" });
    const live = makeRun(root, { state: "failed", owner: liveOwner() });
    const unknown = makeRun(root, { state: "failed", owner: unknownOwner() });
    const mismatched = makeRun(root, { state: "failed" });
    const unreported = makeRun(root, { state: "failed" });
    const foreignWorkspace = makeRun(root, { state: "collected" });
    // Written around writeOwnerRecord, which refuses it: a record is untrusted input when read.
    writeFileSync(join(foreignWorkspace.runDir, "owner.json"), JSON.stringify({ ...foreignWorkspace.record, workspace: join(root, "elsewhere", "workspace") }));
    const nestedWorkspace = makeRun(root, { state: "collected" });
    writeFileSync(join(nestedWorkspace.runDir, "owner.json"), JSON.stringify({ ...nestedWorkspace.record, workspace: join(nestedWorkspace.workspace, "src", "workspace") }));
    const unreadable = makeRun(root, { state: "failed" });
    writeFileSync(join(unreadable.runDir, "owner.json"), "[]");
    const sbx = fixtureSbx([
      listed(running, "running"), listed(live), listed(unknown),
      listed(mismatched, "stopped", join(root, "other", "workspace")),
      { name: unreported.name, status: "stopped" },
      listed(foreignWorkspace), listed(nestedWorkspace), listed(unreadable),
    ]);

    const plan = cleanupPlan({ root, run: sbx.run, now: NOW });
    assert.deepEqual(plan.runs, []);
    const reason = (run) => plan.skipped.find((entry) => entry.runId === run.runId)?.reason;
    assert.match(reason(running), /running/);
    assert.match(reason(live), /alive/);
    assert.match(reason(unknown), /cannot be checked/);
    assert.match(reason(mismatched), /ownership unknown/);
    assert.match(reason(unreported), /no workspace.*ownership unknown/);
    assert.match(reason(foreignWorkspace), /not this run's own/);
    assert.match(reason(nestedWorkspace), /not this run's own/);
    assert.match(reason(unreadable), /unreadable.*ownership unknown/);

    for (const mode of ["unavailable", "unreadable"]) {
      const blind = cleanupPlan({ root, run: fixtureSbx([], { mode }).run });
      assert.deepEqual(blind.runs, [], mode);
      assert.ok(blind.skipped.filter((entry) => entry.status === "unknown").every((entry) => /status unknown/.test(entry.reason)), mode);
      assert.ok(blind.skipped.some((entry) => entry.runId === live.runId && /unavailable or unreadable/.test(entry.reason)), mode);
    }
    const executed = executeCleanup(plan, { run: sbx.run });
    assert.deepEqual(executed.results, []);
    for (const run of [running, live, unknown, mismatched, unreported, foreignWorkspace, nestedWorkspace, unreadable]) assert.ok(existsSync(run.workspace));
    assert.ok(!sbx.calls.some((argv) => argv[2] !== "ls"));
  });

  it("previews without changing anything", () => {
    const root = temporaryDirectory("sbx-preview-");
    const done = makeRun(root, { state: "collected" });
    makeRun(root, { state: "failed" });
    const sbx = fixtureSbx([listed(done), { name: "pf-64-3-implementation-deadbeef", status: "stopped", workspace: join(root, "x") }]);
    const before = snapshot(root);
    const sandboxesBefore = JSON.stringify(sbx.sandboxes);
    const plan = cleanupPlan({ root, run: sbx.run, now: NOW });
    assert.equal(plan.execute, false);
    assert.equal(plan.runs.length, 2);
    assert.deepEqual(plan.runs.find((entry) => entry.runId === done.runId).actions.map((action) => action.kind), ["archive", "sbx-rm", "remove-workspace", "mark-removed"]);
    assert.deepEqual(snapshot(root), before, "the filesystem is unchanged");
    assert.equal(JSON.stringify(sbx.sandboxes), sandboxesBefore);
    assert.deepEqual(sbx.calls.map((argv) => argv.slice(1)), [["--no-input", "ls", "--json"]], "only sbx ls ran");
  });

  it("archives evidence before removing the sandbox and workspace", () => {
    const root = temporaryDirectory("sbx-execute-");
    const run = makeRun(root, { state: "collected" });
    writeFileSync(join(run.runDir, "launch.log"), "launched\n");
    const sbx = fixtureSbx([listed(run), { name: "pf-64-3-implementation-deadbeef", status: "stopped", workspace: join(root, "x") }]);
    const archiveDir = archiveDirectory(root, "64.3", run.runId);
    const original = sbx.run;
    let archivedWhenRemoved = null;
    sbx.run = (argv) => {
      if (argv[2] === "rm") archivedWhenRemoved = existsSync(join(archiveDir, "out", "result.json"));
      return original(argv);
    };

    const result = executeCleanup(cleanupPlan({ root, run: sbx.run, now: NOW }), { run: sbx.run, now: NOW });
    assert.deepEqual(result.results.map((entry) => [entry.runId, entry.done, entry.skipped]), [[run.runId, ["archive", "sbx-rm", "remove-workspace", "mark-removed"], undefined]]);
    assert.equal(archivedWhenRemoved, true, "the archive existed before sbx rm ran");
    assert.equal(readFileSync(join(archiveDir, "out", "result.json"), "utf8").includes('"DONE"'), true);
    assert.equal(readFileSync(join(archiveDir, "logs", "exec.log"), "utf8"), "agent output\n");
    assert.equal(readFileSync(join(archiveDir, "logs", "launch.log"), "utf8"), "launched\n");
    assert.equal(JSON.parse(readFileSync(join(archiveDir, "owner.json"), "utf8")).runId, run.runId);
    assert.ok(!existsSync(run.workspace), "the workspace is removed");
    assert.ok(existsSync(join(run.runDir, "owner.json")), "the record stays");
    const record = readRecord(run);
    assert.equal(record.state, "removed");
    assert.equal(record.evidence.archive, `.pathfinder/archives/sandboxes/64.3/${run.runId}`);
    assert.deepEqual(sbx.sandboxes.map((entry) => entry.name), ["pf-64-3-implementation-deadbeef"], "only the recorded sandbox was removed");
    assert.deepEqual(sbx.calls.filter((argv) => argv[2] === "rm").map((argv) => argv.slice(1)), [["--no-input", "rm", "--force", "--json", run.name]]);

    const again = cleanupPlan({ root, run: sbx.run });
    assert.deepEqual(again.runs, []);
    assert.match(again.skipped.find((entry) => entry.runId === run.runId).reason, /already removed/);
  });

  it("marks an interrupted run failed, and cleans an absent sandbox without sbx rm", () => {
    const root = temporaryDirectory("sbx-interrupted-");
    const run = makeRun(root, { state: "running", outputs: false });
    const sbx = fixtureSbx([]);
    const plan = cleanupPlan({ root, run: sbx.run });
    assert.deepEqual(plan.runs[0].actions.map((action) => action.kind), ["mark-failed", "archive", "remove-workspace", "mark-removed"]);
    const result = executeCleanup(plan, { run: sbx.run });
    assert.equal(result.results[0].skipped, undefined, result.results[0].skipped);
    assert.equal(readRecord(run).state, "removed");
    assert.ok(!sbx.calls.some((argv) => argv[2] !== "ls"));
  });

  it("skips a run whose state changed between plan and execute", () => {
    const root = temporaryDirectory("sbx-changed-");
    const restarted = makeRun(root, { state: "failed" });
    const rewritten = makeRun(root, { state: "failed" });
    const adopted = makeRun(root, { state: "failed" });
    const appeared = makeRun(root, { state: "collected" });
    const sbx = fixtureSbx([listed(restarted), listed(rewritten), listed(adopted)]);
    const plan = cleanupPlan({ root, run: sbx.run });
    assert.equal(plan.runs.length, 4);

    sbx.sandboxes.find((entry) => entry.name === restarted.name).status = "running";
    writeFileSync(join(rewritten.runDir, "owner.json"), JSON.stringify({ ...rewritten.record, state: "collected" }));
    writeOwnerRecord(adopted.runDir, { ...readRecord(adopted), owner: liveOwner() });
    sbx.sandboxes.push(listed(appeared));

    const result = executeCleanup(plan, { run: sbx.run });
    const outcome = (run) => result.results.find((entry) => entry.runId === run.runId);
    assert.match(outcome(restarted).skipped, /running, expected stopped/);
    assert.match(outcome(rewritten).skipped, /record changed/);
    assert.match(outcome(adopted).skipped, /alive/);
    assert.match(outcome(appeared).skipped, /stopped, expected absent/);
    for (const run of [restarted, rewritten, adopted, appeared]) {
      assert.deepEqual(outcome(run).done, []);
      assert.ok(existsSync(run.workspace));
      assert.ok(!existsSync(archiveDirectory(root, "64.3", run.runId)));
    }
    assert.ok(!sbx.calls.some((argv) => argv[2] === "rm"));
  });

  it("never follows a symlink out of the workspace while archiving or removing", () => {
    const root = temporaryDirectory("sbx-links-");
    const outside = temporaryDirectory("sbx-outside-");
    writeFileSync(join(outside, "precious.txt"), "keep me\n");
    mkdirSync(join(outside, "tree"));
    writeFileSync(join(outside, "tree", "deep.txt"), "keep me too\n");
    const run = makeRun(root, { state: "collected" });
    linkDir(outside, join(run.workspace, "escape"));
    linkDir(join(outside, "tree"), join(run.workspace, ".pathfinder-sandbox", "out", "linked"));
    if (!WINDOWS) symlinkSync(join(outside, "precious.txt"), join(run.workspace, "file-link"));
    const sbx = fixtureSbx([listed(run)]);

    const result = executeCleanup(cleanupPlan({ root, run: sbx.run }), { run: sbx.run });
    assert.equal(result.results[0].skipped, undefined, result.results[0].skipped);
    assert.ok(!existsSync(run.workspace));
    assert.equal(readFileSync(join(outside, "precious.txt"), "utf8"), "keep me\n");
    assert.equal(readFileSync(join(outside, "tree", "deep.txt"), "utf8"), "keep me too\n");
    const archived = archiveDirectory(root, "64.3", run.runId);
    assert.ok(!existsSync(join(archived, "out", "linked")), "a link in the outputs is not copied");
    assert.deepEqual(result.results[0].linksNotFollowed.length, 1);
  });

  it("does not archive through a linked exchange directory", () => {
    const root = temporaryDirectory("sbx-linked-exchange-");
    const outside = temporaryDirectory("sbx-outside-exchange-");
    mkdirSync(join(outside, "out"));
    writeFileSync(join(outside, "out", "secret.txt"), "host secret\n");
    const run = makeRun(root, { state: "failed", outputs: false });
    linkDir(outside, join(run.workspace, ".pathfinder-sandbox"));
    const sbx = fixtureSbx([listed(run)]);
    const result = executeCleanup(cleanupPlan({ root, run: sbx.run }), { run: sbx.run });
    assert.equal(result.results[0].skipped, undefined, result.results[0].skipped);
    assert.ok(!existsSync(join(archiveDirectory(root, "64.3", run.runId), "out")));
    assert.ok(existsSync(join(outside, "out", "secret.txt")));
  });

  it("skips a run directory swapped for a link after the plan", () => {
    const root = temporaryDirectory("sbx-swapped-");
    const decoy = temporaryDirectory("sbx-decoy-");
    const run = makeRun(root, { state: "failed" });
    const sbx = fixtureSbx([listed(run)]);
    const plan = cleanupPlan({ root, run: sbx.run });
    assert.equal(plan.runs.length, 1);
    // Move the real run aside and leave a link to a copy elsewhere in its place.
    const keyDir = join(root, ".pathfinder", "sandboxes", "64.3");
    const target = join(decoy, "64.3", run.runId);
    mkdirSync(join(target, "workspace"), { recursive: true });
    writeFileSync(join(target, "workspace", "keep.txt"), "decoy\n");
    writeFileSync(join(target, "owner.json"), readFileSync(join(run.runDir, "owner.json")));
    renameSync(run.runDir, join(keyDir, "moved-aside"));
    linkDir(target, run.runDir);
    const result = executeCleanup(plan, { run: sbx.run });
    assert.match(result.results[0].skipped, /link; ownership unknown/);
    assert.ok(existsSync(join(target, "workspace", "keep.txt")));
    assert.ok(!sbx.calls.some((argv) => argv[2] === "rm"));
  });

  it("acts only on a run directory under the plan's own root, whatever the plan names", () => {
    const root = temporaryDirectory("sbx-anchor-");
    const other = temporaryDirectory("sbx-anchor-other-");
    const loose = temporaryDirectory("sbx-anchor-loose-");
    const sbx = fixtureSbx([]);
    // A genuine plan for another tree, which is then given this root.
    const victim = makeRun(other, { state: "collected" });
    const foreign = cleanupPlan({ root: other, run: sbx.run });
    assert.deepEqual(foreign.runs.map((entry) => entry.runId), [victim.runId]);
    // A plan whose key walks out of this root's sandboxes area to that same run directory.
    const walking = { ...foreign.runs[0], key: relative(join(root, ".pathfinder", "sandboxes"), join(other, ".pathfinder", "sandboxes", "64.3")) };
    assert.equal(runDirectory(root, walking.key, walking.runId), victim.runDir, "the walking key names the other tree's run");
    // A hand-built plan for <any>/64.3/<runId> holding a valid record, with no .pathfinder/sandboxes on its path.
    counter += 1;
    const runId = newRunId(NOW, () => counter.toString(16).padStart(8, "0"));
    const looseRun = join(loose, "64.3", runId);
    mkdirSync(join(looseRun, "workspace"), { recursive: true });
    writeFileSync(join(looseRun, "workspace", "keep.txt"), "keep\n");
    const looseRecord = { ...victim.record, runId, sandbox: sandboxName("64.3", "implementation", runId), workspace: join(looseRun, "workspace") };
    assert.ok(writeOwnerRecord(looseRun, looseRecord).ok);
    const handBuilt = { key: "64.3", runId, runDir: looseRun, sandbox: looseRecord.sandbox, state: "collected", status: "absent", actions: [{ kind: "archive" }, { kind: "remove-workspace", path: join(looseRun, "workspace") }, { kind: "mark-removed" }] };

    const result = executeCleanup({ ...foreign, root, runs: [foreign.runs[0], walking, handBuilt] }, { run: sbx.run });
    assert.deepEqual(result.results.map((entry) => entry.done), [[], [], []]);
    assert.match(result.results[0].skipped, /^before archive: run directory .* is not .*; ownership unknown$/);
    assert.match(result.results[1].skipped, /is not a ticket key; ownership unknown$/);
    assert.match(result.results[2].skipped, /^before archive: run directory .* is not .*; ownership unknown$/);
    assert.ok(existsSync(join(victim.workspace, "src", "index.js")));
    assert.ok(existsSync(join(looseRun, "workspace", "keep.txt")));
    assert.equal(readRecord(victim).state, "collected");
    assert.equal(JSON.parse(readFileSync(join(looseRun, "owner.json"), "utf8")).state, "collected");
    for (const tree of [root, other, loose]) assert.ok(!existsSync(join(tree, ".pathfinder", "archives")), tree);
    assert.ok(!sbx.calls.some((argv) => argv[2] !== "ls"));
    assert.equal(executeCleanup({ ...foreign, root: undefined }).ok, false, "a plan with no root is refused");
  });

  it("never follows a linked .pathfinder or sandboxes directory", () => {
    const sbx = fixtureSbx([]);
    for (const linked of [[".pathfinder"], [".pathfinder", "sandboxes"]]) {
      const label = linked.join("/");
      const root = temporaryDirectory("sbx-linked-base-");
      const elsewhere = temporaryDirectory("sbx-linked-base-target-");
      const run = makeRun(root, { state: "collected" });
      const plan = cleanupPlan({ root, run: sbx.run });
      assert.equal(plan.runs.length, 1, label);
      // After the preview, the directory moves elsewhere and a link to it takes its place.
      const moved = join(elsewhere, ...linked);
      mkdirSync(dirname(moved), { recursive: true });
      renameSync(join(root, ...linked), moved);
      linkDir(moved, join(root, ...linked));
      const movedRun = runDirectory(elsewhere, "64.3", run.runId);

      const result = executeCleanup(plan, { run: sbx.run });
      assert.deepEqual(result.results[0].done, [], label);
      assert.match(result.results[0].skipped, /is a link; ownership unknown$/, label);
      assert.ok(existsSync(join(movedRun, "workspace", "src", "index.js")), label);
      assert.equal(JSON.parse(readFileSync(join(movedRun, "owner.json"), "utf8")).state, "collected", label);
      assert.ok(!existsSync(archiveDirectory(elsewhere, "64.3", run.runId)), label);

      // Read through the link, the base is one unreadable entry: reported, never followed or dropped.
      const records = readOwnerRecords(root);
      assert.deepEqual(records.map((entry) => [entry.status, entry.key, entry.runId]), [["unreadable", null, null]], label);
      assert.match(records[0].reason, /is a link; not followed$/, label);
      const listing = listOwned({ root, run: sbx.run });
      assert.deepEqual([listing.owned.length, listing.unreadable.length], [0, 1], label);
      assert.equal(stopOwned({ root, run: sbx.run, key: "64.3", runId: run.runId }).skipped.length, 1, label);
      const again = cleanupPlan({ root, run: sbx.run });
      assert.deepEqual(again.runs, [], label);
      assert.match(again.skipped[0].reason, /is a link; not followed/, label);
      assert.deepEqual(executeCleanup(again, { run: sbx.run }).results, [], label);
      assert.ok(existsSync(join(movedRun, "workspace", "src", "index.js")), label);
    }
    assert.ok(!sbx.calls.some((argv) => argv[2] !== "ls"));
  });

  it("never lets workspace contents choose the sandbox, path, or archive it acts on", () => {
    const root = temporaryDirectory("sbx-untrusted-");
    const victim = temporaryDirectory("sbx-victim-");
    writeFileSync(join(victim, "keep.txt"), "keep\n");
    const run = makeRun(root, { state: "collected" });
    // What a hostile agent could write inside its own workspace.
    const forged = { ...run.record, runId: "20261106T000000Z-deadbeef", sandbox: "pf-64-3-implementation-deadbeef", workspace: victim };
    writeFileSync(join(run.workspace, "owner.json"), JSON.stringify(forged));
    writeFileSync(join(run.workspace, ".pathfinder-sandbox", "out", "owner.json"), JSON.stringify(forged));
    const sbx = fixtureSbx([listed(run), { name: "pf-64-3-implementation-deadbeef", status: "stopped", workspace: victim }]);
    const plan = cleanupPlan({ root, run: sbx.run });
    assert.deepEqual(plan.runs.map((entry) => entry.sandbox), [run.name]);
    const result = executeCleanup(plan, { run: sbx.run });
    assert.equal(result.results[0].skipped, undefined, result.results[0].skipped);
    assert.deepEqual(sbx.calls.filter((argv) => argv[2] === "rm").map((argv) => argv.at(-1)), [run.name]);
    assert.ok(existsSync(join(victim, "keep.txt")));
    assert.equal(result.results[0].archive, `.pathfinder/archives/sandboxes/64.3/${run.runId}`);
    assert.equal(JSON.parse(readFileSync(join(archiveDirectory(root, "64.3", run.runId), "owner.json"), "utf8")).sandbox, run.name, "the archived record is the run's own");
  });

  it("refuses to remove anything outside its boundary", () => {
    const root = temporaryDirectory("sbx-boundary-");
    mkdirSync(join(root, "a", "b"), { recursive: true });
    assert.throws(() => removeWithin(join(root, "a", "b"), join(root, "a")), /not inside/);
    assert.throws(() => removeWithin(join(root, "a"), join(root, "a")), /not inside/);
    assert.ok(statSync(join(root, "a", "b")).isDirectory());
  });
});

describe("sbx argv", () => {
  it("never contains prune, --all, docker, or a name not in a record", () => {
    assert.ok(everyCall.length > 0);
    for (const argv of everyCall) {
      assert.ok(!argv.includes("prune") && !argv.includes("--all"), argv.join(" "));
      assert.ok(!/docker/i.test(argv[0]), argv.join(" "));
      if (["stop", "rm"].includes(argv[2])) {
        assert.ok(!argv.at(-1).endsWith("deadbeef"), `unrecorded sandbox targeted: ${argv.join(" ")}`);
        assert.match(argv.at(-1), /^pf-\d+-\d+-[a-z-]+-[0-9a-f]{8}$/);
      }
    }
  });
});
