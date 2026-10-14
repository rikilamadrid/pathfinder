import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";
import { cleanUpTemporaryDirectories, ENGINE_BIN, ENGINE_ROOT, gitEnv, json, makeProject, orchestrate, temporaryDirectory } from "../lib/harness.mjs";

const { cacheInputs, cloneable, ensureEntry, escapingLinks, holdKey, materialize, npmCommand, retireStaleLock, unpublish } = await import(pathToFileURL(join(ENGINE_ROOT, "deps.mjs")));
const { diskCheck, freeBytes, readDiskPolicy, roomFor } = await import(pathToFileURL(join(ENGINE_ROOT, "disk.mjs")));
const { real, reclaimAfterCheckpoint, runStatus, within } = await import(pathToFileURL(join(ENGINE_ROOT, "scratch.mjs")));
const { findOwner, liveness, ownerRecord, processChain } = await import(pathToFileURL(join(ENGINE_ROOT, "process.mjs")));

const WINDOWS = process.platform === "win32";
/** Tests not about disk run with no thresholds, so a nearly full CI runner cannot fail them. */
const QUIET = { PATHFINDER_DISK_WARN_GB: "0", PATHFINDER_DISK_FLOOR_GB: "0" };
/** The session each run minted; deps, done and fail carry it unless a test passes its own. */
const sessions = new Map();
const cli = (args, { env = {}, ...options } = {}) => {
  const withSession = args[0] === "scratch" && ["deps", "done", "fail"].includes(args[1]) && !args.includes("--session") && sessions.has(args[2]) ? [...args, "--session", sessions.get(args[2])] : args;
  const result = orchestrate(withSession, { ...options, env: { ...QUIET, ...env } });
  if (args[0] === "scratch" && args[1] === "new" && result.status === 0 && args.includes("--json")) {
    const created = JSON.parse(result.stdout);
    sessions.set(created.path, created.session);
  }
  return result;
};
/** The raw CLI, for tests that must omit the session. */
const bare = (args, { env = {}, ...options } = {}) => orchestrate(args, { ...options, env: { ...QUIET, ...env } });
/** A directory link any user can make: a junction on Windows, a symlink elsewhere. */
const linkDir = (target, path) => symlinkSync(target, path, WINDOWS ? "junction" : "dir");
/** A process that stays alive until killed, without POSIX `sleep`. */
const sleeper = () => spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"]);
/** Kill a process and everything it started; Windows does not kill children with the parent. */
function killTree(child, marker) {
  if (WINDOWS) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else { child.kill("SIGKILL"); spawnSync("pkill", ["-9", "-f", marker]); }
}

after(cleanUpTemporaryDirectories);

const LOCK = '{"lockfileVersion":3,"packages":{"node_modules/left-pad":{"version":"1.3.0"}}}\n';
const HEAD = "abcdef1234567890abcdef1234567890abcdef12";

/**
 * A stand-in for npm: `--version`, and `ci`, which writes a small tree derived
 * from the lockfile, logs each install, and can be slowed, made to fail half
 * way, or given one large file. Its last act is npm's own hidden lockfile.
 */
function fakeNpm() {
  const dir = temporaryDirectory("fake-npm-");
  const script = join(dir, "npm.js");
  writeFileSync(script, `#!/usr/bin/env node
const fs = require("node:fs");
const { createHash, randomBytes } = require("node:crypto");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("10.9.9"); process.exit(0); }
if (args[0] !== "ci") process.exit(2);
if (process.env.FAKE_NPM_LOG) fs.appendFileSync(process.env.FAKE_NPM_LOG, process.cwd() + "\\n");
const lock = fs.readFileSync("package-lock.json");
const hash = createHash("sha256").update(lock).digest("hex");
fs.mkdirSync("node_modules/left-pad/lib", { recursive: true });
fs.mkdirSync("node_modules/.bin", { recursive: true });
fs.writeFileSync("node_modules/left-pad/index.js", "module.exports = " + JSON.stringify(hash) + ";\\n");
fs.writeFileSync("node_modules/left-pad/lib/util.js", "exports.x = 1;\\n");
if (process.platform === "win32") fs.writeFileSync("node_modules/.bin/left-pad.cmd", "@node %~dp0\\..\\left-pad\\index.js %*\\r\\n");
else fs.symlinkSync("../left-pad/index.js", "node_modules/.bin/left-pad");
if (process.env.FAKE_NPM_ESCAPE) fs.symlinkSync(process.env.FAKE_NPM_ESCAPE, "node_modules/linked", process.platform === "win32" ? "junction" : "dir");
const big = Number(process.env.FAKE_NPM_BIG_MB || 0);
if (big) fs.writeFileSync("node_modules/left-pad/big.bin", randomBytes(big * 1024 * 1024));
if (process.env.FAKE_NPM_FAIL) process.exit(1);
const delay = Number(process.env.FAKE_NPM_DELAY_MS || 0);
if (delay) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
fs.writeFileSync("node_modules/.package-lock.json", lock);
`);
  // A .js entry runs under Node on every platform, never through a shell.
  return script;
}

function deadPid() {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

function newRun(root, { extra = [], env = {}, ticket = "1.1" } = {}) {
  const result = cli(["scratch", "new", ticket, "--role", "tester", "--head", HEAD, "--json", ...extra], { root, env });
  assert.equal(result.status, 0, result.stderr);
  return json(result).path;
}

function tree(run, name, lock = LOCK) {
  mkdirSync(join(run, name), { recursive: true });
  writeFileSync(join(run, name, "package.json"), '{"name":"t","version":"1.0.0"}\n');
  writeFileSync(join(run, name, "package-lock.json"), lock);
  return join(run, name);
}

function deps(root, run, name, npm, env = {}, extra = []) {
  return cli(["scratch", "deps", run, "--tree", name, "--npm", npm, "--json", ...extra], { root, env });
}

function installs(log) {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0;
}

function depsDir(root) {
  return join(root, ".pathfinder", "deps");
}

function keyFor(treePath) {
  return cacheInputs({ tree: treePath, npmVersion: "10.9.9", env: gitEnv() }).key;
}

describe("dependency cache keys", () => {
  it("change with the lockfile, package.json, Node, npm, platform and architecture, and nothing else", () => {
    const dir = temporaryDirectory("deps-key-");
    const a = tree(dir, "a");
    const base = cacheInputs({ tree: a, npmVersion: "10.0.0", node: "v20.0.0", platform: "darwin", arch: "arm64" });
    const same = cacheInputs({ tree: tree(dir, "b"), npmVersion: "10.0.0", node: "v20.0.0", platform: "darwin", arch: "arm64" });
    assert.equal(base.key, same.key);
    const variants = [
      cacheInputs({ tree: tree(dir, "c", LOCK.replace("1.3.0", "1.3.1")), npmVersion: "10.0.0", node: "v20.0.0", platform: "darwin", arch: "arm64" }),
      cacheInputs({ tree: a, npmVersion: "10.0.1", node: "v20.0.0", platform: "darwin", arch: "arm64" }),
      cacheInputs({ tree: a, npmVersion: "10.0.0", node: "v22.0.0", platform: "darwin", arch: "arm64" }),
      cacheInputs({ tree: a, npmVersion: "10.0.0", node: "v20.0.0", platform: "linux", arch: "arm64" }),
      cacheInputs({ tree: a, npmVersion: "10.0.0", node: "v20.0.0", platform: "darwin", arch: "x64" }),
    ];
    writeFileSync(join(dir, "b", "package.json"), '{"name":"t","version":"1.0.0","scripts":{"postinstall":"x"}}\n');
    variants.push(cacheInputs({ tree: join(dir, "b"), npmVersion: "10.0.0", node: "v20.0.0", platform: "darwin", arch: "arm64" }));
    assert.equal(new Set([base.key, ...variants.map((v) => v.key)]).size, variants.length + 1);
  });

  it("refuses a tree without a lockfile", () => {
    const dir = temporaryDirectory("deps-key-");
    mkdirSync(join(dir, "t"));
    writeFileSync(join(dir, "t", "package.json"), "{}\n");
    assert.match(cacheInputs({ tree: join(dir, "t"), npmVersion: "1" }).message, /no package-lock\.json/);
  });
});

describe("one install per key", () => {
  it("installs once, reuses it for a second tree, and installs again for a changed lockfile", () => {
    const root = makeProject();
    const npm = fakeNpm();
    const log = join(temporaryDirectory("log-"), "installs");
    const run = newRun(root);
    tree(run, "base"); tree(run, "head"); tree(run, "mut", LOCK.replace("1.3.0", "2.0.0"));
    const first = json(deps(root, run, "base", npm, { FAKE_NPM_LOG: log }));
    const second = json(deps(root, run, "head", npm, { FAKE_NPM_LOG: log }));
    assert.equal(first.installed, true);
    assert.equal(second.installed, false);
    assert.equal(first.key, second.key);
    assert.equal(installs(log), 1);
    const third = json(deps(root, run, "mut", npm, { FAKE_NPM_LOG: log }));
    assert.notEqual(third.key, first.key);
    assert.equal(installs(log), 2);
    const recorded = JSON.parse(readFileSync(join(run, "run.json"), "utf8")).trees.map((t) => t.tree);
    assert.deepEqual(recorded, ["base", "head", "mut"]);
  });

  it("refuses a tree that already has node_modules, and a tree outside the run", () => {
    const root = makeProject();
    const npm = fakeNpm();
    const run = newRun(root);
    tree(run, "head");
    mkdirSync(join(run, "head", "node_modules"));
    assert.equal(deps(root, run, "head", npm).status, 1);
    assert.equal(deps(root, run, "../..", npm).status, 1);
  });
});

describe("concurrency and crash recovery", () => {
  it("two concurrent reviewers on one key produce exactly one install and two private trees", async () => {
    const root = makeProject();
    const npm = fakeNpm();
    const log = join(temporaryDirectory("log-"), "installs");
    const run = newRun(root);
    tree(run, "a"); tree(run, "b");
    const launch = (name) => new Promise((resolve) => {
      const child = spawn(process.execPath, [ENGINE_BIN, "scratch", "deps", run, "--tree", name, "--npm", npm, "--json", "--session", sessions.get(run)], { cwd: root, env: gitEnv({ ...QUIET, FAKE_NPM_LOG: log, FAKE_NPM_DELAY_MS: "1500" }) });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (status) => resolve({ status, stderr }));
    });
    const results = await Promise.all([launch("a"), launch("b")]);
    for (const result of results) assert.equal(result.status, 0, result.stderr);
    assert.equal(installs(log), 1);
    const leftovers = readdirSync(depsDir(root)).filter((name) => name.startsWith(".tmp-") || name.endsWith(".lock"));
    assert.deepEqual(leftovers, []);
    const a = lstatSync(join(run, "a", "node_modules", "left-pad", "index.js"));
    const b = lstatSync(join(run, "b", "node_modules", "left-pad", "index.js"));
    assert.notEqual(a.ino, b.ino);
  });

  it("reclaims a lock whose owner has died", () => {
    const root = makeProject();
    const npm = fakeNpm();
    const run = newRun(root);
    const head = tree(run, "head");
    mkdirSync(join(depsDir(root), `${keyFor(head)}.lock`), { recursive: true });
    writeFileSync(join(depsDir(root), `${keyFor(head)}.lock`, "owner.json"), JSON.stringify(ownerRecord(deadPid())));
    const result = deps(root, run, "head", npm);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(depsDir(root), `${keyFor(head)}.lock`)), false);
  });

  it("a failed install publishes nothing, leaves no lock, keeps its log, and a retry succeeds", () => {
    const root = makeProject();
    const npm = fakeNpm();
    const run = newRun(root);
    const head = tree(run, "head");
    const failed = deps(root, run, "head", npm, { FAKE_NPM_FAIL: "1" });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /nothing was published/);
    const names = readdirSync(depsDir(root));
    assert.equal(names.includes(keyFor(head)), false);
    assert.deepEqual(names.filter((n) => n.startsWith(".tmp-") || n.endsWith(".lock")), []);
    assert.equal(names.filter((n) => n.endsWith(".log")).length, 1);
    assert.equal(existsSync(join(run, "head", "node_modules")), false);
    assert.equal(deps(root, run, "head", npm).status, 0);
  });

  it("an install killed mid-way is never published; the next run recovers and prune removes the debris", async () => {
    const root = makeProject();
    const npm = fakeNpm();
    const run = newRun(root);
    const head = tree(run, "head");
    const child = spawn(process.execPath, [ENGINE_BIN, "scratch", "deps", run, "--tree", "head", "--npm", npm, "--session", sessions.get(run)], { cwd: root, env: gitEnv({ ...QUIET, FAKE_NPM_DELAY_MS: "20000" }) });
    const deadline = Date.now() + 10_000;
    while (!(existsSync(depsDir(root)) && readdirSync(depsDir(root)).some((n) => n.startsWith(".tmp-")))) {
      assert.ok(Date.now() < deadline, "install never started");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const closed = new Promise((resolve) => child.on("close", resolve));
    killTree(child, npm);
    await closed;
    assert.equal(existsSync(join(depsDir(root), keyFor(head))), false, "a partial entry was published");
    const recovered = deps(root, run, "head", npm);
    assert.equal(recovered.status, 0, recovered.stderr);
    const dry = cli(["scratch", "prune", "--json"], { root });
    const planned = json(dry).actions.filter((a) => a.kind === "abandoned install");
    assert.equal(planned.length, 1);
    assert.ok(existsSync(planned[0].path), "dry run removed something");
    assert.equal(cli(["scratch", "prune", "--execute"], { root }).status, 0);
    assert.equal(existsSync(planned[0].path), false);
    assert.equal(existsSync(join(depsDir(root), keyFor(head), "node_modules", ".package-lock.json")), true);
  });
});

describe("clone isolation", () => {
  it("a mutant's edits and deletions stay in its own tree; the cache is read-only; no file shares an inode", () => {
    const root = makeProject();
    const npm = fakeNpm();
    const run = newRun(root);
    const head = tree(run, "head"); tree(run, "mut");
    assert.equal(deps(root, run, "head", npm).status, 0);
    assert.equal(deps(root, run, "mut", npm).status, 0);
    const cache = join(depsDir(root), keyFor(head), "node_modules");
    const file = join("left-pad", "index.js");
    const original = readFileSync(join(cache, file), "utf8");
    writeFileSync(join(run, "mut", "node_modules", file), "mutant\n");
    rmSync(join(run, "mut", "node_modules", "left-pad", "lib", "util.js"));
    assert.equal(readFileSync(join(cache, file), "utf8"), original);
    assert.equal(readFileSync(join(run, "head", "node_modules", file), "utf8"), original);
    assert.equal(existsSync(join(run, "head", "node_modules", "left-pad", "lib", "util.js")), true);
    assert.equal(existsSync(join(cache, "left-pad", "lib", "util.js")), true);
    assert.equal(statSync(join(cache, file)).mode & 0o222, 0, "cache file is writable");
    for (const name of ["head", "mut"]) {
      const big = { bigint: true };
      const copy = lstatSync(join(run, name, "node_modules", file), big);
      assert.notEqual(copy.ino, lstatSync(join(cache, file), big).ino);
      assert.equal(copy.nlink, 1n, "a hard link was created");
    }
    if (!WINDOWS) assert.equal(lstatSync(join(run, "head", "node_modules", ".bin", "left-pad")).isSymbolicLink(), true);
  });

  it("falls back to a full, still private copy when cloning fails, and says so", () => {
    const root = makeProject();
    const dir = temporaryDirectory("deps-fallback-");
    const t = tree(dir, "src");
    const entry = ensureEntry({ root, tree: t, npm: fakeNpm(), inputs: cacheInputs({ tree: t, npmVersion: "10.9.9" }) });
    assert.equal(entry.ok, true, entry.message);
    const argsLog = join(dir, "cp-args");
    const failingCp = join(dir, "cp");
    writeFileSync(failingCp, `#!/bin/sh\necho "$@" >> ${argsLog}\nexit 1\n`);
    chmodSync(failingCp, 0o755);
    for (const [platform, flag] of [["darwin", "-cR"], ["linux", "--reflink=always"], ["win32", null]]) {
      const target = tree(dir, `t-${platform}`);
      // Cloning is possible as far as the volume goes; it is cp that fails.
      const result = materialize({ entry: entry.path, tree: target, platform, cp: failingCp, canClone: () => platform !== "win32" });
      assert.equal(result.ok, true, result.message);
      assert.equal(result.strategy, "copy");
      assert.match(result.warning, /fully copied/);
      if (flag && !WINDOWS) assert.match(readFileSync(argsLog, "utf8"), new RegExp(flag.replace(/[-=]/g, "\\$&")));
      const copied = lstatSync(join(target, "node_modules", "left-pad", "index.js"), { bigint: true });
      assert.notEqual(copied.ino, lstatSync(join(entry.path, "node_modules", "left-pad", "index.js"), { bigint: true }).ino);
      writeFileSync(join(target, "node_modules", "left-pad", "index.js"), "mutant\n");
      assert.notEqual(readFileSync(join(entry.path, "node_modules", "left-pad", "index.js"), "utf8"), "mutant\n");
    }
  });

  it("saves physical space: clones of a 64 MB tree cost a small fraction of a copy", { skip: process.platform !== "darwin" && "APFS clones are macOS-only" }, () => {
    const root = makeProject();
    const npm = fakeNpm();
    const run = newRun(root);
    tree(run, "first");
    const first = json(deps(root, run, "first", npm, { FAKE_NPM_BIG_MB: "64" }));
    assert.equal(first.strategy, "clone", "the test volume does not support APFS clones");
    // Free space is shared with every other process writing to this volume, so
    // one quiet measurement out of three is enough; three copies would need 192 MB.
    const measurements = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const names = ["a", "b", "c"].map((name) => `${name}${attempt}`);
      for (const name of names) tree(run, name);
      const before = freeBytes(root);
      for (const name of names) assert.equal(json(deps(root, run, name, npm)).strategy, "clone");
      measurements.push(before - freeBytes(root));
      if (measurements.at(-1) < 48 * 1024 * 1024) break;
    }
    assert.ok(Math.min(...measurements) < 48 * 1024 * 1024, `three clones used ${measurements.join(", ")} bytes; three copies would use ${3 * 64 * 1024 * 1024}`);
  });
});

describe("scratch lifecycle", () => {
  function evidenceRun(root, extra = []) {
    const npm = fakeNpm();
    const run = newRun(root, { extra });
    tree(run, "head");
    assert.equal(deps(root, run, "head", npm).status, 0);
    mkdirSync(join(run, "head", ".next", "cache"), { recursive: true });
    mkdirSync(join(run, "head", "out"), { recursive: true });
    writeFileSync(join(run, "head", "out", "index.html"), "evidence\n");
    mkdirSync(join(run, "mutant", "src"), { recursive: true });
    writeFileSync(join(run, "mutant", "src", "a.js"), "mutant source\n");
    mkdirSync(join(run, "vendor", "node_modules", "patched"), { recursive: true });
    writeFileSync(join(run, "vendor", "node_modules", "patched", "index.js"), "hand-made\n");
    writeFileSync(join(run, "report.json"), "{}\n");
    const outside = temporaryDirectory("outside-");
    mkdirSync(join(outside, "node_modules"));
    writeFileSync(join(outside, "node_modules", ".package-lock.json"), "{}\n");
    linkDir(outside, join(run, "linked"));
    return { run, outside };
  }

  it("done reclaims only rebuildable directories and keeps every piece of evidence", () => {
    const root = makeProject();
    const { run, outside } = evidenceRun(root);
    const result = json(cli(["scratch", "done", run, "--json"], { root }));
    assert.deepEqual(result.removed.sort(), ["head/.next", "head/node_modules"]);
    for (const kept of ["report.json", "mutant/src/a.js", "head/out/index.html", "vendor/node_modules/patched/index.js", "head/package-lock.json"]) {
      assert.equal(existsSync(join(run, kept)), true, `${kept} was removed`);
    }
    assert.equal(existsSync(join(outside, "node_modules", ".package-lock.json")), true, "followed a symlink out of the run");
    const record = JSON.parse(readFileSync(join(run, "run.json"), "utf8"));
    assert.equal(record.state, "checkpointed");
    assert.equal(record.reclaimed.length, 2);
  });

  it("refuses a run owned by another live process, a path outside the scratch area, and a symlinked run", () => {
    const root = makeProject();
    const other = sleeper();
    try {
      const run = newRun(root, { extra: ["--owner-pid", String(other.pid)] });
      tree(run, "head");
      const refused = cli(["scratch", "done", run], { root });
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /belongs to live process/);
      assert.equal(cli(["scratch", "done", temporaryDirectory("elsewhere-")], { root }).status, 1);
      const alias = join(temporaryDirectory("alias-"), "run");
      linkDir(run, alias);
      assert.equal(cli(["scratch", "done", alias], { root }).status, 1);
    } finally { other.kill(); }
  });

  it("the checkpoint hook reclaims the named run, and refuses a run for another ticket", () => {
    const root = makeProject();
    const { run } = evidenceRun(root);
    const wrong = reclaimAfterCheckpoint(root, "2.1", run);
    assert.equal(wrong.ok, false);
    assert.equal(existsSync(join(run, "head", "node_modules")), true);
    process.env.PATHFINDER_SCRATCH_SESSION = sessions.get(run);
    let right;
    try { right = reclaimAfterCheckpoint(root, "1.1", run); } finally { delete process.env.PATHFINDER_SCRATCH_SESSION; }
    assert.equal(right.ok, true, right.message);
    assert.equal(existsSync(join(run, "head", "node_modules")), false);
    assert.equal(existsSync(join(run, "report.json")), true);
    assert.equal(reclaimAfterCheckpoint(root, "1.1", ""), null);
  });

  it("prune is a dry run by default and never touches an active run", () => {
    const root = makeProject();
    const npm = fakeNpm();
    const active = newRun(root, { extra: ["--owner-pid", String(process.pid)] });
    tree(active, "head");
    assert.equal(deps(root, active, "head", npm).status, 0);
    const finished = evidenceRun(root).run;
    assert.equal(cli(["scratch", "done", finished], { root }).status, 0);
    const record = JSON.parse(readFileSync(join(finished, "run.json"), "utf8"));
    writeFileSync(join(finished, "run.json"), JSON.stringify({ ...record, owner: ownerRecord(deadPid()) }));
    mkdirSync(join(finished, "late", "node_modules"), { recursive: true });
    writeFileSync(join(finished, "late", "node_modules", ".package-lock.json"), "{}\n");
    writeFileSync(join(finished, "late", "package.json"), "{}\n");
    const dry = json(cli(["scratch", "prune", "--older-than", "0", "--json"], { root }));
    assert.equal(dry.execute, false);
    assert.equal(existsSync(join(finished, "late", "node_modules")), true);
    assert.ok(dry.kept.some((item) => item.path === active && /alive/.test(item.reason)));
    assert.equal(cli(["scratch", "prune", "--older-than", "0", "--execute"], { root }).status, 0);
    assert.equal(existsSync(join(finished, "late", "node_modules")), false);
    assert.equal(existsSync(join(active, "head", "node_modules", "left-pad", "index.js")), true, "an active run was pruned");
  });

  it("interrupted and failed runs are preserved unless the human includes them, and then lose only dependencies", () => {
    const root = makeProject();
    const npm = fakeNpm();
    const interrupted = newRun(root, { extra: ["--owner-pid", String(deadPid())] });
    tree(interrupted, "head");
    assert.equal(deps(root, interrupted, "head", npm).status, 0);
    writeFileSync(join(interrupted, "crash.log"), "evidence\n");
    const failed = newRun(root, { extra: ["--owner-pid", String(deadPid())] });
    tree(failed, "head");
    assert.equal(deps(root, failed, "head", npm).status, 0);
    assert.equal(cli(["scratch", "fail", failed], { root }).status, 0);
    const listed = json(cli(["scratch", "list", "--json"], { root })).runs;
    assert.deepEqual(listed.map((r) => r.status).sort(), ["failed", "interrupted"]);
    assert.equal(cli(["scratch", "prune", "--older-than", "0", "--execute"], { root }).status, 0);
    for (const run of [interrupted, failed]) assert.equal(existsSync(join(run, "head", "node_modules")), true, "preserved run pruned");
    const young = json(cli(["scratch", "prune", "--include-preserved", "--older-than", "1d", "--execute", "--json"], { root }));
    assert.equal(young.actions.length, 0);
    assert.equal(cli(["scratch", "prune", "--include-preserved", "--older-than", "0", "--execute"], { root }).status, 0);
    for (const run of [interrupted, failed]) {
      assert.equal(existsSync(join(run, "head", "node_modules")), false);
      assert.equal(existsSync(join(run, "head", "package-lock.json")), true);
    }
    assert.equal(existsSync(join(interrupted, "crash.log")), true);
  });

  it("unused cache entries are removed only with --cache, never one an active run uses", () => {
    const root = makeProject();
    const npm = fakeNpm();
    const active = newRun(root, { extra: ["--owner-pid", String(process.pid)] });
    const head = tree(active, "head");
    assert.equal(deps(root, active, "head", npm).status, 0);
    const old = newRun(root);
    const other = tree(old, "head", LOCK.replace("1.3.0", "9.9.9"));
    assert.equal(deps(root, old, "head", npm).status, 0);
    assert.equal(cli(["scratch", "done", old], { root }).status, 0);
    assert.equal(cli(["scratch", "prune", "--older-than", "0", "--execute"], { root }).status, 0);
    assert.equal(existsSync(join(depsDir(root), keyFor(other))), true, "removed a cache entry without --cache");
    assert.equal(cli(["scratch", "prune", "--older-than", "0", "--cache", "--execute"], { root }).status, 0);
    assert.equal(existsSync(join(depsDir(root), keyFor(other))), false);
    assert.equal(existsSync(join(depsDir(root), keyFor(head))), true, "removed an entry an active run uses");
  });

  it("refuses scratch runs when .pathfinder/ is not ignored", () => {
    const root = makeProject({ ignorePathfinder: false });
    const result = cli(["scratch", "new", "1.1", "--role", "tester", "--head", HEAD], { root });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not ignored/);
  });
});

describe("disk safeguards", () => {
  const LOW = { PATHFINDER_DISK_WARN_GB: "999999", PATHFINDER_DISK_FLOOR_GB: "999999" };

  it("refuse new runs and new dependency trees below the floor without explicit approval", () => {
    const root = makeProject();
    const refused = cli(["scratch", "new", "1.1", "--role", "tester", "--head", HEAD], { root, env: LOW });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /below the .* floor.*--allow-low-disk/);
    assert.equal(existsSync(join(root, ".pathfinder", "scratch")), false);
    const blank = cli(["scratch", "new", "1.1", "--role", "tester", "--head", HEAD, "--allow-low-disk", "  "], { root, env: LOW });
    assert.equal(blank.status, 1);
    const run = newRun(root, { env: LOW, extra: ["--allow-low-disk", "owner approved a low-disk run"] });
    assert.equal(JSON.parse(readFileSync(join(run, "run.json"), "utf8")).diskOverride, "owner approved a low-disk run");
    tree(run, "head");
    assert.equal(deps(root, run, "head", fakeNpm(), LOW).status, 1);
  });

  it("read thresholds from the marker, let the environment override them, and reject invalid ones", () => {
    const root = makeProject({ modeFile: "# Execution Mode\n\n<!-- pathfinder:execution-mode orchestrator -->\n<!-- pathfinder:disk warn=30 floor=5 -->\n" });
    assert.deepEqual(readDiskPolicy(root, {}), { valid: true, warnGb: 30, floorGb: 5, source: "marker" });
    assert.equal(readDiskPolicy(root, { PATHFINDER_DISK_FLOOR_GB: "7" }).floorGb, 7);
    assert.equal(readDiskPolicy(root, { PATHFINDER_DISK_FLOOR_GB: "40" }).valid, false);
    assert.equal(readDiskPolicy(root, { PATHFINDER_DISK_WARN_GB: "lots" }).valid, false);
    const bad = makeProject({ modeFile: "<!-- pathfinder:execution-mode orchestrator -->\n<!-- pathfinder:disk warn=big -->\n" });
    assert.equal(readDiskPolicy(bad, {}).valid, false);
    assert.deepEqual(readDiskPolicy(makeProject(), {}), { valid: true, warnGb: 25, floorGb: 10, source: "default" });
  });

  it("status names a crossed threshold without changing figures; disk reports physical free space", () => {
    const root = makeProject({ tickets: { "1.1": { title: "Alpha" } } });
    const HIGH = { PATHFINDER_DISK_WARN_GB: "0", PATHFINDER_DISK_FLOOR_GB: "0" };
    assert.doesNotMatch(cli(["status"], { root, env: HIGH }).stdout, /disk:/);
    assert.match(cli(["status"], { root, env: LOW }).stdout, /^disk: BELOW the 999999\.0 GB floor — new review runs refused; run `orchestrate disk` for figures$/m);
    assert.deepEqual(json(cli(["status", "--json"], { root, env: LOW })).disk, { level: "below-floor", warnBytes: 999999e9, floorBytes: 999999e9 });
    assert.match(orchestrate(["disk"], { root }).stdout, /^disk: \d+\.\d GB free \(warn 25\.0 GB, floor 10\.0 GB, default\)/m);
    const report = cli(["disk"], { root, env: LOW });
    assert.equal(report.status, 0);
    assert.match(report.stdout, /BELOW FLOOR/);
    assert.match(report.stdout, /counted in full/);
  });
});

describe("cross-platform safety", () => {
  it("refuses to publish an install that links outside its own tree, so no copy can share it", () => {
    const root = makeProject();
    const run = newRun(root);
    const head = tree(run, "head");
    const outside = temporaryDirectory("linked-package-");
    const result = deps(root, run, "head", fakeNpm(), { FAKE_NPM_ESCAPE: outside });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /links outside its own tree/);
    assert.equal(existsSync(join(depsDir(root), keyFor(head))), false);
    assert.equal(existsSync(join(run, "head", "node_modules")), false);
  });

  it("escapingLinks flags absolute and escaping links and accepts links that stay inside", () => {
    const dir = temporaryDirectory("links-");
    mkdirSync(join(dir, "nm", "pkg"), { recursive: true });
    mkdirSync(join(dir, "nm", "inner"), { recursive: true });
    linkDir(join(dir, "nm", "pkg"), join(dir, "nm", "absolute"));
    assert.equal(escapingLinks(join(dir, "nm")).length, 1, "absolute link (every junction) not flagged");
    if (!WINDOWS) {
      symlinkSync("../pkg", join(dir, "nm", "inner", "relative-inside"));
      symlinkSync("../../..", join(dir, "nm", "inner", "relative-escape"));
      const found = escapingLinks(join(dir, "nm"));
      assert.equal(found.length, 2);
      assert.ok(found.some((line) => line.includes("relative-escape")));
      assert.ok(!found.some((line) => line.includes("relative-inside")));
    }
  });

  it("checks the disk floor before a full copy where cloning is unavailable, and refuses without approval", () => {
    const root = makeProject();
    const dir = temporaryDirectory("deps-guard-");
    const t = tree(dir, "src");
    const entry = ensureEntry({ root, tree: t, npm: fakeNpm(), inputs: cacheInputs({ tree: t, npmVersion: "10.9.9" }) });
    assert.equal(entry.ok, true, entry.message);
    let asked = null;
    const target = tree(dir, "copy");
    const refused = materialize({ entry: entry.path, tree: target, strategies: [], beforeCopy: (bytes) => { asked = bytes; return { ok: false, message: "no room" }; } });
    assert.equal(refused.ok, false);
    assert.match(refused.message, /no room/);
    assert.ok(asked > 0, "the guard was not told the copy size");
    assert.equal(existsSync(join(target, "node_modules")), false);
    const check = { ok: true, freeBytes: 100, floorBytes: 50, warnBytes: 80, level: "ok" };
    assert.equal(roomFor(check, 40).ok, true);
    assert.equal(roomFor(check, 60).ok, false);
    assert.equal(roomFor(check, 60, "owner approved").override, "owner approved");
    assert.equal(roomFor(diskCheck({ root, env: {} }), Number.MAX_SAFE_INTEGER).ok, false);
  });

  it("never judges an owner from another platform or host dead, so its run is never pruned", () => {
    const pid = spawnSync(process.execPath, ["-e", ""]).pid;
    const here = ownerRecord(pid);
    assert.equal(liveness(here), false);
    assert.equal(liveness({ ...here, platform: here.platform === "win32" ? "linux-wsl" : "win32" }), null);
    assert.equal(liveness({ ...here, host: "another-host" }), null);
    assert.equal(liveness({ pid, host: here.host }), null, "an owner without a platform must be unknown");
    assert.equal(runStatus({ state: "active", owner: { ...here, platform: "linux-wsl-elsewhere" } }), "active");
    const root = makeProject();
    const run = newRun(root);
    tree(run, "head");
    assert.equal(deps(root, run, "head", fakeNpm()).status, 0);
    const record = JSON.parse(readFileSync(join(run, "run.json"), "utf8"));
    writeFileSync(join(run, "run.json"), JSON.stringify({ ...record, owner: { ...here, platform: "elsewhere" } }));
    assert.equal(cli(["scratch", "prune", "--include-preserved", "--older-than", "0", "--execute"], { root }).status, 0);
    assert.equal(existsSync(join(run, "head", "node_modules")), true, "pruned a run whose owner cannot be checked");
  });

  it("contains canonical paths exactly, with Windows drive letters and either separator", () => {
    assert.equal(within("C:\\Repo\\scratch", "C:\\Repo\\scratch\\1.1\\run", "win32"), "1.1\\run");
    assert.equal(within("C:\\Repo\\scratch", "C:/Repo/scratch/1.1/run", "win32"), "1.1\\run");
    assert.equal(within("C:\\Repo\\scratch", "D:\\Repo\\scratch\\1.1", "win32"), null);
    assert.equal(within("C:\\Repo\\scratch", "C:\\Repo\\scratch-other\\x", "win32"), null);
    assert.equal(within("/Users/a/Repo", "/Users/a/Repo/run", "darwin"), "run");
    assert.equal(within("/Users/a/Repo", "/users/A/repo/run", "darwin"), null, "case is the filesystem's call, made by real()");
    assert.equal(within("/home/a/repo", "/home/a/Repo/run", "linux"), null);
    assert.equal(within("/home/a/repo", "/home/a/repo", "linux"), null);
  });

  it("real() spells a case-variant path the filesystem's way where the volume ignores case", () => {
    const dir = temporaryDirectory("case-");
    mkdirSync(join(dir, "Mixed"));
    const variant = join(dir, "MIXED");
    if (!existsSync(variant)) return; // a case-sensitive volume: nothing to fold
    assert.equal(real(variant), real(join(dir, "Mixed")));
    assert.equal(within(real(dir), real(variant)), "Mixed");
  });

  it("finds a live, non-shell owner for this process on this platform", () => {
    const chain = processChain(process.pid);
    assert.ok(chain.length >= 1, "no process information on this platform");
    assert.equal(chain[0].pid, process.pid);
    const owner = findOwner(process.pid);
    assert.equal(liveness(owner), true);
  });
});

describe("Windows native", { skip: !WINDOWS && "runs only on Windows" }, () => {
  it("materializes an independent full copy with a warning, never a junction or hard link", () => {
    const root = makeProject();
    const run = newRun(root);
    const head = tree(run, "head"); tree(run, "mut");
    const first = json(deps(root, run, "head", fakeNpm()));
    assert.equal(first.strategy, "copy");
    assert.match(first.warning, /fully copied/);
    assert.equal(json(deps(root, run, "mut", fakeNpm())).strategy, "copy");
    const cache = join(depsDir(root), keyFor(head), "node_modules", "left-pad", "index.js");
    const copy = join(run, "mut", "node_modules", "left-pad", "index.js");
    assert.equal(lstatSync(join(run, "mut", "node_modules")).isSymbolicLink(), false);
    assert.notEqual(lstatSync(copy, { bigint: true }).ino, lstatSync(cache, { bigint: true }).ino);
    writeFileSync(copy, "mutant\n");
    assert.notEqual(readFileSync(cache, "utf8"), "mutant\n");
    assert.equal(cli(["scratch", "done", run], { root }).status, 0);
    assert.equal(existsSync(join(run, "mut", "node_modules")), false);
  });

  it("resolves npm to the npm-cli.js beside Node and reports free space for the drive", () => {
    const resolved = npmCommand("npm");
    assert.equal(resolved.ok, true, resolved.message);
    assert.equal(resolved.file, process.execPath);
    assert.match(resolved.args[0], /npm-cli\.js$/);
    assert.ok(freeBytes(temporaryDirectory("win-free-")) > 0);
  });
});

describe("adversary regressions", () => {
  it("E1/E2: another live owner's run cannot be failed, extended or pruned in any state", () => {
    const root = makeProject();
    const npm = fakeNpm();
    const other = sleeper();
    try {
      const run = newRun(root, { extra: ["--owner-pid", String(other.pid)] });
      tree(run, "head");
      assert.match(deps(root, run, "head", npm).stderr, /belongs to live process/);
      assert.match(cli(["scratch", "fail", run], { root }).stderr, /belongs to live process/);
      const record = JSON.parse(readFileSync(join(run, "run.json"), "utf8"));
      mkdirSync(join(run, "head", "node_modules"));
      writeFileSync(join(run, "head", "node_modules", ".package-lock.json"), "{}\n");
      for (const state of ["checkpointed", "failed"]) {
        writeFileSync(join(run, "run.json"), JSON.stringify({ ...record, state }));
        assert.equal(cli(["scratch", "prune", "--older-than", "0", "--include-preserved", "--cache", "--execute"], { root }).status, 0);
        assert.equal(existsSync(join(run, "head", "node_modules")), true, `pruned a live owner's ${state} run`);
      }
    } finally { other.kill(); }
  });

  it("E2: a checkpointed run accepts no new trees", () => {
    const root = makeProject();
    const npm = fakeNpm();
    const run = newRun(root);
    tree(run, "head"); tree(run, "round2");
    assert.equal(deps(root, run, "head", npm).status, 0);
    assert.equal(cli(["scratch", "done", run], { root }).status, 0);
    const again = deps(root, run, "round2", npm);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /checkpointed; start a new run/);
  });

  it("E3: a run that records a session acts only for that session", () => {
    const root = makeProject();
    const run = newRun(root, { extra: ["--session", "tester-a"] });
    tree(run, "head");
    assert.match(bare(["scratch", "deps", run, "--tree", "head", "--npm", fakeNpm()], { root }).stderr, /started for another session/);
    assert.match(cli(["scratch", "done", run, "--session", "tester-b"], { root }).stderr, /started for another session/);
    assert.equal(cli(["scratch", "done", run, "--session", "tester-a"], { root }).status, 0);
  });

  it("E4: prune never follows a link planted in the cache directory", { skip: WINDOWS && "POSIX permission bits" }, () => {
    const root = makeProject();
    const outside = temporaryDirectory("outside-");
    writeFileSync(join(outside, "readonly.txt"), "x\n");
    chmodSync(join(outside, "readonly.txt"), 0o444);
    mkdirSync(join(root, ".pathfinder", "deps"), { recursive: true });
    for (const name of [".tmp-planted", "planted.lock", "0123456789abcdef0123456789abcdef"]) linkDir(outside, join(root, ".pathfinder", "deps", name));
    assert.equal(cli(["scratch", "prune", "--older-than", "0", "--cache", "--execute"], { root }).status, 0);
    assert.equal(statSync(join(outside, "readonly.txt")).mode & 0o777, 0o444);
    assert.equal(existsSync(join(outside, "readonly.txt")), true);
  });

  it("E5: a reclaim failure after a written checkpoint is reported, never thrown", { skip: WINDOWS && "POSIX permission bits" }, () => {
    const root = makeProject();
    const run = newRun(root);
    mkdirSync(join(run, "evidence", "locked"), { recursive: true });
    chmodSync(join(run, "evidence", "locked"), 0o000);
    process.env.PATHFINDER_SCRATCH_SESSION = sessions.get(run);
    try {
      const result = reclaimAfterCheckpoint(root, "1.1", run);
      assert.equal(result.ok, false);
      assert.match(result.message, /after the checkpoint was written/);
    } finally { chmodSync(join(run, "evidence", "locked"), 0o755); delete process.env.PATHFINDER_SCRATCH_SESSION; }
  });

  it("E6: npm's environment and user config are part of the cache key", () => {
    const dir = temporaryDirectory("deps-env-");
    const t = tree(dir, "t");
    const base = { tree: t, npmVersion: "1", node: "v1", platform: "linux", arch: "x64" };
    const plain = cacheInputs({ ...base, env: { HOME: dir } }).key;
    assert.notEqual(cacheInputs({ ...base, env: { HOME: dir, NODE_ENV: "production" } }).key, plain);
    assert.notEqual(cacheInputs({ ...base, env: { HOME: dir, npm_config_omit: "dev" } }).key, plain);
    writeFileSync(join(dir, ".npmrc"), "omit=dev\n");
    assert.notEqual(cacheInputs({ ...base, env: { HOME: dir } }).key, plain);
    assert.equal(cacheInputs({ ...base, env: { HOME: dir, UNRELATED: "x" } }).key, cacheInputs({ ...base, env: { HOME: dir } }).key);
  });

  it("E7/E8: prune --cache never removes an entry while a copy holds its key, and unpublishes atomically", () => {
    const root = makeProject();
    const npm = fakeNpm();
    const run = newRun(root, { extra: ["--owner-pid", String(deadPid())] });
    const head = tree(run, "head");
    assert.equal(deps(root, run, "head", npm).status, 0);
    const key = keyFor(head);
    const held = holdKey({ root, key });
    assert.equal(held.ok, true, held.message);
    try {
      const busy = json(cli(["scratch", "prune", "--older-than", "0", "--cache", "--execute", "--json"], { root }));
      assert.ok(busy.results.some((r) => /in use/.test(r.skipped ?? "")), JSON.stringify(busy.results));
      assert.equal(existsSync(join(depsDir(root), key, "entry.json")), true);
    } finally { held.release(); }
    assert.equal(cli(["scratch", "prune", "--older-than", "0", "--cache", "--execute"], { root }).status, 0);
    assert.deepEqual(readdirSync(depsDir(root)).filter((n) => n.includes(key)), []);
  });

  it("E9: a disk marker with repeated or malformed pairs is invalid", () => {
    for (const marker of ["warn=30 floor=10 floor=0", "warn=25=junk floor=10=x", "warn=30", "warn=30 floor=10 extra=1"]) {
      const root = makeProject({ modeFile: `<!-- pathfinder:execution-mode orchestrator -->\n<!-- pathfinder:disk ${marker} -->\n` });
      assert.equal(readDiskPolicy(root, {}).valid, false, marker);
    }
  });

  it("E10: a case-variant node_modules segment cannot name a tree", () => {
    const root = makeProject();
    const run = newRun(root);
    tree(run, "head/NODE_MODULES/pkg");
    assert.equal(deps(root, run, "head/NODE_MODULES/pkg", fakeNpm()).status, 1);
  });

  it("E11: without readable ancestry, a run needs an explicit owner instead of a guessed shell", { skip: WINDOWS && "POSIX PATH" }, () => {
    const root = makeProject();
    const bin = temporaryDirectory("no-ps-");
    const git = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    symlinkSync(git, join(bin, "git"));
    symlinkSync(process.execPath, join(bin, "node"));
    const result = cli(["scratch", "new", "1.1", "--role", "tester", "--head", HEAD], { root, env: { PATH: bin } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pass --owner-pid/);
    const explicit = cli(["scratch", "new", "1.1", "--role", "tester", "--head", HEAD, "--owner-pid", String(process.pid)], { root, env: { PATH: bin } });
    assert.equal(explicit.status, 0, explicit.stderr);
  });
});

describe("follow-up adversary regressions", () => {
  it("N2: npm never runs through a shell; Windows refuses shims and shell syntax", () => {
    assert.deepEqual(npmCommand("/x/npm-cli.js", "linux", "/node"), { ok: true, file: "/node", args: ["/x/npm-cli.js"] });
    assert.deepEqual(npmCommand("npm", "linux"), { ok: true, file: "npm", args: [] });
    for (const value of ["npm&calc.exe", "C:\\tools\\npm.cmd|whoami", "%COMSPEC%", "C:\\Program Files\\nodejs\\npm.cmd"]) {
      assert.equal(npmCommand(value, "win32", "C:\\node\\node.exe").ok, false, value);
    }
    assert.deepEqual(npmCommand("C:\\npm\\bin\\npm-cli.js", "win32", "C:\\node\\node.exe"), { ok: true, file: "C:\\node\\node.exe", args: ["C:\\npm\\bin\\npm-cli.js"] });
    const dir = temporaryDirectory("npm-js-");
    const inputs = cacheInputs({ tree: tree(dir, "t"), npm: fakeNpm() });
    assert.equal(inputs.ok, true, inputs.message);
    assert.equal(inputs.inputs.npm, "10.9.9");
  });

  it("N3: the checkpoint hook honours the run's session", () => {
    const root = makeProject();
    const run = newRun(root, { extra: ["--session", "session-alpha-7"] });
    tree(run, "head");
    assert.equal(deps(root, run, "head", fakeNpm(), {}, ["--session", "session-alpha-7"]).status, 0);
    const refused = reclaimAfterCheckpoint(root, "1.1", run);
    assert.equal(refused.ok, false);
    assert.doesNotMatch(refused.message, /session-alpha-7/, "the refusal names the session it expects");
    assert.equal(existsSync(join(run, "head", "node_modules")), true);
    process.env.PATHFINDER_SCRATCH_SESSION = "session-alpha-7";
    try { assert.equal(reclaimAfterCheckpoint(root, "1.1", run).ok, true); } finally { delete process.env.PATHFINDER_SCRATCH_SESSION; }
    assert.equal(existsSync(join(run, "head", "node_modules")), false);
  });

  it("N9: without readable ancestry, an owner with --session can use and reclaim its own run", { skip: WINDOWS && "POSIX PATH" }, () => {
    const root = makeProject();
    const bin = temporaryDirectory("no-ps-");
    symlinkSync(spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim(), join(bin, "git"));
    const env = { PATH: bin };
    const created = bare(["scratch", "new", "1.1", "--role", "tester", "--head", HEAD, "--owner-pid", String(process.pid), "--json"], { root, env });
    assert.equal(created.status, 0, created.stderr);
    const { path: run, session } = json(created);
    assert.match(session, /^s-[0-9a-f]{16}$/);
    tree(run, "head");
    assert.equal(bare(["scratch", "deps", run, "--tree", "head", "--npm", fakeNpm()], { root, env }).status, 1);
    assert.equal(bare(["scratch", "deps", run, "--tree", "head", "--npm", fakeNpm(), "--session", session], { root, env }).status, 0);
    assert.equal(bare(["scratch", "done", run], { root, env }).status, 1);
    assert.equal(bare(["scratch", "done", run, "--session", session], { root, env }).status, 0);
    assert.equal(existsSync(join(run, "head", "node_modules")), false);
  });

  it("N1: prune reports what it removed and what it skipped, not what it planned", () => {
    const root = makeProject();
    const run = newRun(root, { extra: ["--owner-pid", String(deadPid())] });
    const head = tree(run, "head");
    assert.equal(deps(root, run, "head", fakeNpm()).status, 0);
    const held = holdKey({ root, key: keyFor(head) });
    try {
      const out = cli(["scratch", "prune", "--older-than", "0", "--cache", "--execute"], { root }).stdout;
      assert.match(out, /skipped .*in use/);
      assert.doesNotMatch(out, new RegExp(`removed .*deps.${keyFor(head)}$`, "m"));
    } finally { held.release(); }
  });

  it("N1b: copying from an entry that was removed refuses instead of throwing", () => {
    const root = makeProject();
    const dir = temporaryDirectory("gone-");
    const t = tree(dir, "src");
    const entry = ensureEntry({ root, tree: t, npm: fakeNpm(), env: gitEnv() });
    assert.equal(entry.ok, true, entry.message);
    assert.equal(unpublish({ root, key: entry.key }).ok, true);
    const result = materialize({ entry: entry.path, tree: tree(dir, "copy") });
    assert.equal(result.ok, false);
    assert.match(result.message, /no longer a complete entry/);
  });

  it("N8: npm's per-run variables do not split the cache; install settings do", () => {
    const dir = temporaryDirectory("deps-run-env-");
    const t = tree(dir, "t");
    const base = { tree: t, npmVersion: "1", node: "v1", platform: "linux", arch: "x64" };
    const plain = cacheInputs({ ...base, env: { HOME: dir } }).key;
    const npmRun = { HOME: dir, npm_config_local_prefix: dir, npm_config_user_agent: "npm/11", npm_config_cache: "/c", npm_config_loglevel: "warn" };
    assert.equal(cacheInputs({ ...base, env: npmRun }).key, plain);
    assert.notEqual(cacheInputs({ ...base, env: { ...npmRun, npm_config_omit: "dev" } }).key, plain);
    assert.notEqual(cacheInputs({ ...base, env: { ...npmRun, "npm_config_@acme:registry": "https://r" } }).key, plain);
  });

  it("never breaks a lock whose owner is alive, however long it is held", () => {
    const root = makeProject();
    const dir = temporaryDirectory("live-lock-");
    const t = tree(dir, "t");
    const inputs = cacheInputs({ tree: t, npmVersion: "10.9.9", env: gitEnv() });
    const lock = join(depsDir(root), `${inputs.key}.lock`);
    mkdirSync(lock, { recursive: true });
    const owner = JSON.stringify(ownerRecord(process.pid));
    writeFileSync(join(lock, "owner.json"), owner);
    const result = ensureEntry({ root, tree: t, npm: fakeNpm(), inputs, timeoutMs: 300, pollMs: 50, orphanMs: 0 });
    assert.equal(result.ok, false);
    assert.match(result.message, /timed out/);
    assert.equal(readFileSync(join(lock, "owner.json"), "utf8"), owner);
  });
});

describe("third adversary pass regressions", () => {
  it("X1: a crashed breaker never makes a waiter ignore its timeout", () => {
    const root = makeProject();
    const dir = temporaryDirectory("breaker-");
    const t = tree(dir, "t");
    const inputs = cacheInputs({ tree: t, npmVersion: "10.9.9", env: gitEnv() });
    const lock = join(depsDir(root), `${inputs.key}.lock`);
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "owner.json"), JSON.stringify(ownerRecord(deadPid())));
    mkdirSync(`${lock}.break`);
    const started = Date.now();
    const held = holdKey({ root, key: inputs.key, timeoutMs: 300, pollMs: 50 });
    assert.equal(held.ok, false);
    assert.ok(Date.now() - started < 3000, `waited ${Date.now() - started} ms past a 300 ms timeout`);
  });

  it("X2: npm's global config and workspace and link settings change the key", () => {
    const dir = temporaryDirectory("deps-global-");
    const t = tree(dir, "t");
    const base = { tree: t, npmVersion: "1", node: "v1", platform: "linux", arch: "x64" };
    const plain = cacheInputs({ ...base, env: { HOME: dir } }).key;
    writeFileSync(join(dir, "global-npmrc"), "omit=dev\n");
    for (const extra of [{ npm_config_globalconfig: join(dir, "global-npmrc") }, { npm_config_bin_links: "false" }, { npm_config_workspaces: "true" }, { npm_config_include_workspace_root: "true" }, { npm_config_nodedir: "/n" }]) {
      assert.notEqual(cacheInputs({ ...base, env: { HOME: dir, ...extra } }).key, plain, JSON.stringify(extra));
    }
    assert.equal(cacheInputs({ ...base, env: { HOME: dir, npm_config_node_gyp: "/x/node-gyp.js" } }).key, plain);
  });

  it("X3: a relative --npm names the same program for --version and ci", () => {
    const root = makeProject();
    const run = newRun(root);
    tree(run, "head");
    const tools = join(root, "tools");
    mkdirSync(tools);
    writeFileSync(join(tools, "npm.js"), readFileSync(fakeNpm()));
    const result = cli(["scratch", "deps", run, "--tree", "head", "--npm", join("tools", "npm.js"), "--json"], { root });
    assert.equal(result.status, 0, result.stderr);
  });

  it("X4: every run gets a unique session, which deps, done and fail require", () => {
    const root = makeProject();
    const a = json(bare(["scratch", "new", "1.1", "--role", "tester", "--head", HEAD, "--json"], { root }));
    const b = json(bare(["scratch", "new", "1.1", "--role", "tester", "--head", HEAD, "--json"], { root }));
    assert.notEqual(a.session, b.session);
    tree(a.path, "head");
    assert.match(bare(["scratch", "deps", a.path, "--tree", "head", "--npm", fakeNpm()], { root }).stderr, /started for another session/);
    assert.match(bare(["scratch", "done", a.path, "--session", b.session], { root }).stderr, /started for another session/);
    assert.match(bare(["scratch", "new", "1.1", "--role", "tester", "--head", HEAD], { root }).stdout, /^session s-[0-9a-f]{16}$/m);
  });
});

describe("final adversary pass regressions", () => {
  it("C1: a bare relative .js --npm is made absolute too", () => {
    assert.equal(npmCommand("npm.js", process.platform, "/node").args[0], join(process.cwd(), "npm.js"));
  });

  it("A1: a run without a recorded session changes only once its owner has exited", () => {
    const root = makeProject();
    const run = newRun(root);
    tree(run, "head");
    const record = JSON.parse(readFileSync(join(run, "run.json"), "utf8"));
    delete record.session;
    writeFileSync(join(run, "run.json"), JSON.stringify(record));
    assert.match(bare(["scratch", "deps", run, "--tree", "head", "--npm", fakeNpm()], { root }).stderr, /records no session/);
    writeFileSync(join(run, "run.json"), JSON.stringify({ ...record, owner: ownerRecord(deadPid()) }));
    assert.equal(bare(["scratch", "done", run], { root }).status, 0);
  });

  it("B1: prune clears an abandoned lock breaker", () => {
    const root = makeProject();
    const breaker = join(depsDir(root), "0123456789abcdef0123456789abcdef.lock.break");
    mkdirSync(breaker, { recursive: true });
    const old = new Date(Date.now() - 120_000);
    utimesSync(breaker, old, old);
    assert.equal(cli(["scratch", "prune", "--execute"], { root }).status, 0);
    assert.equal(existsSync(breaker), false);
  });
});

describe("tester regressions", () => {
  it("F1: where cloning cannot be proven, a copy is warned, floor-checked and recorded as a copy", () => {
    const root = makeProject();
    const dir = temporaryDirectory("deps-noclone-");
    const t = tree(dir, "src");
    const entry = ensureEntry({ root, tree: t, npm: fakeNpm(), env: gitEnv() });
    assert.equal(entry.ok, true, entry.message);
    let asked = 0;
    const result = materialize({ entry: entry.path, tree: tree(dir, "copy"), platform: "darwin", canClone: () => false, beforeCopy: (bytes) => { asked = bytes; return { ok: true }; } });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.strategy, "copy");
    assert.match(result.warning, /fully copied/);
    assert.ok(asked > 0, "the floor was not consulted");
    assert.equal(cloneable("/x", "/y", "win32"), false);
    if (process.platform === "darwin") {
      const other = temporaryDirectory("clone-link-");
      linkDir(join(entry.path, "node_modules"), join(other, "looks-local"));
      assert.equal(cloneable(join(entry.path, "node_modules"), join(other, "looks-local")), cloneable(join(entry.path, "node_modules"), join(entry.path, "node_modules")), "a link must be judged by where it points");
    }
  });

  it("F1: a non-APFS macOS volume never reports a clone", { skip: process.platform !== "darwin" && "macOS disk images" }, (t) => {
    const dir = temporaryDirectory("hfs-");
    const image = join(dir, "v.dmg");
    const mount = join(dir, "mnt");
    if (spawnSync("hdiutil", ["create", "-quiet", "-size", "20m", "-fs", "HFS+", "-volname", "pfhfs", image]).status !== 0 ||
        spawnSync("hdiutil", ["attach", "-quiet", "-nobrowse", "-mountpoint", mount, image]).status !== 0) { t.skip("hdiutil cannot create or attach an HFS+ image here"); return; }
    try {
      const root = makeProject();
      const src = tree(dir, "src");
      const entry = ensureEntry({ root, tree: src, npm: fakeNpm(), env: gitEnv() });
      assert.equal(entry.ok, true, entry.message);
      assert.equal(cloneable(join(entry.path, "node_modules"), mount), false);
      const target = tree(mount, "t");
      const result = materialize({ entry: entry.path, tree: target, beforeCopy: () => ({ ok: false, message: "floor" }) });
      assert.equal(result.ok, false);
      assert.match(result.message, /floor/);
      assert.equal(existsSync(join(target, "node_modules")), false);
    } finally { spawnSync("hdiutil", ["detach", "-quiet", "-force", mount]); }
  });

  it("prune re-checks a stale lock when it acts, never retiring one that came alive", () => {
    const root = makeProject();
    const lock = join(depsDir(root), "0123456789abcdef0123456789abcdef.lock");
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "owner.json"), JSON.stringify(ownerRecord(process.pid)));
    assert.equal(retireStaleLock(lock), false);
    assert.equal(existsSync(lock), true);
    writeFileSync(join(lock, "owner.json"), JSON.stringify(ownerRecord(deadPid())));
    assert.equal(retireStaleLock(lock), true);
    assert.equal(existsSync(lock), false);
  });
});

