import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";
import { cleanUpTemporaryDirectories, ENGINE_BIN, ENGINE_ROOT, gitEnv, json, makeProject, orchestrate, temporaryDirectory } from "../lib/harness.mjs";

const { cacheInputs, ensureEntry, materialize } = await import(pathToFileURL(join(ENGINE_ROOT, "deps.mjs")));
const { freeBytes, readDiskPolicy } = await import(pathToFileURL(join(ENGINE_ROOT, "disk.mjs")));
const { reclaimAfterCheckpoint } = await import(pathToFileURL(join(ENGINE_ROOT, "scratch.mjs")));

after(cleanUpTemporaryDirectories);

const LOCK = '{"lockfileVersion":3,"packages":{"node_modules/left-pad":{"version":"1.3.0"}}}\n';
const HEAD = "abcdef1234567890abcdef1234567890abcdef12";

/**
 * A stand-in for npm: `--version`, and `ci`, which writes a small tree derived
 * from the lockfile, logs each install, and can be slowed, made to fail half
 * way, or given one large file. Its last act is npm's own hidden lockfile.
 */
function fakeNpm() {
  const path = join(temporaryDirectory("fake-npm-"), "npm");
  writeFileSync(path, `#!/usr/bin/env node
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
fs.symlinkSync("../left-pad/index.js", "node_modules/.bin/left-pad");
const big = Number(process.env.FAKE_NPM_BIG_MB || 0);
if (big) fs.writeFileSync("node_modules/left-pad/big.bin", randomBytes(big * 1024 * 1024));
if (process.env.FAKE_NPM_FAIL) process.exit(1);
const delay = Number(process.env.FAKE_NPM_DELAY_MS || 0);
if (delay) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
fs.writeFileSync("node_modules/.package-lock.json", lock);
`);
  chmodSync(path, 0o755);
  return path;
}

function deadPid() {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

function newRun(root, { extra = [], env = {}, ticket = "1.1" } = {}) {
  const result = orchestrate(["scratch", "new", ticket, "--role", "tester", "--head", HEAD, "--json", ...extra], { root, env });
  assert.equal(result.status, 0, result.stderr);
  return json(result).path;
}

function tree(run, name, lock = LOCK) {
  mkdirSync(join(run, name), { recursive: true });
  writeFileSync(join(run, name, "package.json"), '{"name":"t","version":"1.0.0"}\n');
  writeFileSync(join(run, name, "package-lock.json"), lock);
  return join(run, name);
}

function deps(root, run, name, npm, env = {}) {
  return orchestrate(["scratch", "deps", run, "--tree", name, "--npm", npm, "--json"], { root, env });
}

function installs(log) {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0;
}

function depsDir(root) {
  return join(root, ".pathfinder", "deps");
}

function keyFor(treePath) {
  return cacheInputs({ tree: treePath, npmVersion: "10.9.9" }).key;
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
      const child = spawn(process.execPath, [ENGINE_BIN, "scratch", "deps", run, "--tree", name, "--npm", npm, "--json"], { cwd: root, env: gitEnv({ FAKE_NPM_LOG: log, FAKE_NPM_DELAY_MS: "1500" }) });
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
    writeFileSync(join(depsDir(root), `${keyFor(head)}.lock`, "owner.json"), JSON.stringify({ pid: deadPid(), host: hostname() }));
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
    const child = spawn(process.execPath, [ENGINE_BIN, "scratch", "deps", run, "--tree", "head", "--npm", npm], { cwd: root, env: gitEnv({ FAKE_NPM_DELAY_MS: "20000" }) });
    const deadline = Date.now() + 10_000;
    while (!(existsSync(depsDir(root)) && readdirSync(depsDir(root)).some((n) => n.startsWith(".tmp-")))) {
      assert.ok(Date.now() < deadline, "install never started");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    child.kill("SIGKILL");
    await new Promise((resolve) => child.on("close", resolve));
    spawnSync("pkill", ["-9", "-f", npm]);
    assert.equal(existsSync(join(depsDir(root), keyFor(head))), false, "a partial entry was published");
    const recovered = deps(root, run, "head", npm);
    assert.equal(recovered.status, 0, recovered.stderr);
    const dry = orchestrate(["scratch", "prune", "--json"], { root });
    const planned = json(dry).actions.filter((a) => a.kind === "abandoned install");
    assert.equal(planned.length, 1);
    assert.ok(existsSync(planned[0].path), "dry run removed something");
    assert.equal(orchestrate(["scratch", "prune", "--execute"], { root }).status, 0);
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
      const copy = lstatSync(join(run, name, "node_modules", file));
      assert.notEqual(copy.ino, lstatSync(join(cache, file)).ino);
      assert.equal(copy.nlink, 1, "a hard link was created");
    }
    assert.equal(lstatSync(join(run, "head", "node_modules", ".bin", "left-pad")).isSymbolicLink(), true);
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
      const result = materialize({ entry: entry.path, tree: target, platform, cp: failingCp });
      assert.equal(result.ok, true, result.message);
      assert.equal(result.strategy, "copy");
      assert.match(result.warning, /fully copied/);
      if (flag) assert.match(readFileSync(argsLog, "utf8"), new RegExp(flag.replace(/[-=]/g, "\\$&")));
      const copied = lstatSync(join(target, "node_modules", "left-pad", "index.js"));
      assert.notEqual(copied.ino, lstatSync(join(entry.path, "node_modules", "left-pad", "index.js")).ino);
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
    for (const name of ["a", "b", "c"]) tree(run, name);
    const before = freeBytes(root);
    for (const name of ["a", "b", "c"]) assert.equal(json(deps(root, run, name, npm)).strategy, "clone");
    const used = before - freeBytes(root);
    assert.ok(used < 24 * 1024 * 1024, `three clones used ${used} bytes; three copies would use ${3 * 64 * 1024 * 1024}`);
  });
});

describe("scratch lifecycle", () => {
  function evidenceRun(root) {
    const npm = fakeNpm();
    const run = newRun(root);
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
    symlinkSync(outside, join(run, "linked"));
    return { run, outside };
  }

  it("done reclaims only rebuildable directories and keeps every piece of evidence", () => {
    const root = makeProject();
    const { run, outside } = evidenceRun(root);
    const result = json(orchestrate(["scratch", "done", run, "--json"], { root }));
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
    const sleeper = spawn("sleep", ["30"]);
    try {
      const run = newRun(root, { extra: ["--owner-pid", String(sleeper.pid)] });
      tree(run, "head");
      const refused = orchestrate(["scratch", "done", run], { root });
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /belongs to live process/);
      assert.equal(orchestrate(["scratch", "done", temporaryDirectory("elsewhere-")], { root }).status, 1);
      const alias = join(temporaryDirectory("alias-"), "run");
      symlinkSync(run, alias);
      assert.equal(orchestrate(["scratch", "done", alias], { root }).status, 1);
    } finally { sleeper.kill(); }
  });

  it("the checkpoint hook reclaims the named run, and refuses a run for another ticket", () => {
    const root = makeProject();
    const { run } = evidenceRun(root);
    const wrong = reclaimAfterCheckpoint(root, "2.1", run);
    assert.equal(wrong.ok, false);
    assert.equal(existsSync(join(run, "head", "node_modules")), true);
    const right = reclaimAfterCheckpoint(root, "1.1", run);
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
    assert.equal(orchestrate(["scratch", "done", finished], { root }).status, 0);
    mkdirSync(join(finished, "late", "node_modules"), { recursive: true });
    writeFileSync(join(finished, "late", "node_modules", ".package-lock.json"), "{}\n");
    writeFileSync(join(finished, "late", "package.json"), "{}\n");
    const dry = json(orchestrate(["scratch", "prune", "--older-than", "0", "--json"], { root }));
    assert.equal(dry.execute, false);
    assert.equal(existsSync(join(finished, "late", "node_modules")), true);
    assert.ok(dry.kept.some((item) => item.path === active && /alive/.test(item.reason)));
    assert.equal(orchestrate(["scratch", "prune", "--older-than", "0", "--execute", "--include-preserved"], { root }).status, 0);
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
    const failed = newRun(root);
    tree(failed, "head");
    assert.equal(deps(root, failed, "head", npm).status, 0);
    assert.equal(orchestrate(["scratch", "fail", failed], { root }).status, 0);
    const listed = json(orchestrate(["scratch", "list", "--json"], { root })).runs;
    assert.deepEqual(listed.map((r) => r.status).sort(), ["failed", "interrupted"]);
    assert.equal(orchestrate(["scratch", "prune", "--older-than", "0", "--execute"], { root }).status, 0);
    for (const run of [interrupted, failed]) assert.equal(existsSync(join(run, "head", "node_modules")), true, "preserved run pruned");
    const young = json(orchestrate(["scratch", "prune", "--include-preserved", "--older-than", "1d", "--execute", "--json"], { root }));
    assert.equal(young.actions.length, 0);
    assert.equal(orchestrate(["scratch", "prune", "--include-preserved", "--older-than", "0", "--execute"], { root }).status, 0);
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
    assert.equal(orchestrate(["scratch", "done", old], { root }).status, 0);
    assert.equal(orchestrate(["scratch", "prune", "--older-than", "0", "--execute"], { root }).status, 0);
    assert.equal(existsSync(join(depsDir(root), keyFor(other))), true, "removed a cache entry without --cache");
    assert.equal(orchestrate(["scratch", "prune", "--older-than", "0", "--cache", "--execute"], { root }).status, 0);
    assert.equal(existsSync(join(depsDir(root), keyFor(other))), false);
    assert.equal(existsSync(join(depsDir(root), keyFor(head))), true, "removed an entry an active run uses");
  });

  it("refuses scratch runs when .pathfinder/ is not ignored", () => {
    const root = makeProject({ ignorePathfinder: false });
    const result = orchestrate(["scratch", "new", "1.1", "--role", "tester", "--head", HEAD], { root });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not ignored/);
  });
});

describe("disk safeguards", () => {
  const LOW = { PATHFINDER_DISK_WARN_GB: "999999", PATHFINDER_DISK_FLOOR_GB: "999999" };

  it("refuse new runs and new dependency trees below the floor without explicit approval", () => {
    const root = makeProject();
    const refused = orchestrate(["scratch", "new", "1.1", "--role", "tester", "--head", HEAD], { root, env: LOW });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /below the .* floor.*--allow-low-disk/);
    assert.equal(existsSync(join(root, ".pathfinder", "scratch")), false);
    const blank = orchestrate(["scratch", "new", "1.1", "--role", "tester", "--head", HEAD, "--allow-low-disk", "  "], { root, env: LOW });
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

  it("status and disk report physical free space", () => {
    const root = makeProject({ tickets: { "1.1": { title: "Alpha" } } });
    assert.match(orchestrate(["status"], { root }).stdout, /^disk: \d+\.\d GB free \(warn 25\.0 GB, floor 10\.0 GB, default\)$/m);
    assert.equal(typeof json(orchestrate(["status", "--json"], { root })).disk.freeBytes, "number");
    const report = orchestrate(["disk"], { root, env: LOW });
    assert.equal(report.status, 0);
    assert.match(report.stdout, /BELOW FLOOR/);
    assert.match(report.stdout, /counted in full/);
  });
});
