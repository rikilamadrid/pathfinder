/**
 * A content-addressed dependency cache, and private copies of it for review
 * trees.
 *
 * Every Adversary and Tester round materializes several trees — base, head,
 * mutants — and each used to run its own `npm ci`, about a gigabyte apiece,
 * left behind when the session ended. Identical lockfiles install identical
 * trees, so the cache installs once per key under `.pathfinder/deps/<key>/` and
 * each review tree receives its own copy of it.
 *
 * The key hashes everything an install depends on: the lockfile, package.json,
 * any project `.npmrc`, and the Node version, npm version, platform and
 * architecture. A ticket that changes its lockfile gets a new key and a real
 * install; a Linux container never reuses a macOS entry.
 *
 * Publication is atomic. One process installs into a private temporary
 * directory under a `mkdir` lock, marks the entry complete, makes it
 * read-only, and renames it into place; readers trust only a complete entry,
 * so a partial install is never visible. A lock whose owner has died is
 * reclaimed.
 *
 * A review tree never shares a writable file with the cache or with another
 * tree. On macOS the copy is an APFS clone (`cp -c`), on Linux a reflink
 * (`cp --reflink=always`): each file is a new inode whose blocks are shared
 * copy-on-write, so a mutant's edit lands in its own tree only. Where neither
 * is available the copy is a full one, with a warning. Hard links are never
 * used — they would share one inode, and with it every write.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { ownerAlive } from "./checkpoint-write.mjs";

export const DEPS_DIR = ".pathfinder/deps";
const SCHEMA = "pathfinder.deps-entry/1";
const LOCKFILES = ["npm-shrinkwrap.json", "package-lock.json"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const refuse = (message) => ({ ok: false, message });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * What one install depends on, and the key it hashes to.
 * Every machine-dependent input can be overridden so the key is testable.
 */
export function cacheInputs({ tree, npm = "npm", node = process.version, npmVersion = null, platform = process.platform, arch = process.arch }) {
  const lockfile = LOCKFILES.find((name) => existsSync(join(tree, name)));
  if (!lockfile) return refuse(`${tree} has no package-lock.json or npm-shrinkwrap.json; the cache installs only locked trees`);
  if (!existsSync(join(tree, "package.json"))) return refuse(`${tree} has no package.json`);
  let version = npmVersion;
  if (version === null) {
    const result = spawnSync(npm, ["--version"], { encoding: "utf8" });
    if (result.status !== 0) return refuse(`cannot run \`${npm} --version\`: ${(result.stderr || result.error?.message || "").trim()}`);
    version = result.stdout.trim();
  }
  const npmrc = existsSync(join(tree, ".npmrc")) ? sha256(readFileSync(join(tree, ".npmrc"))) : null;
  const inputs = {
    lockfile,
    lock: sha256(readFileSync(join(tree, lockfile))),
    manifest: sha256(readFileSync(join(tree, "package.json"))),
    npmrc,
    node,
    npm: version,
    platform,
    arch,
  };
  return { ok: true, key: sha256(JSON.stringify({ schema: SCHEMA, ...inputs })).slice(0, 32), inputs };
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

/** A published entry: complete, for this key, with its tree present. */
export function isComplete(entry, key) {
  const record = readJson(join(entry, "entry.json"));
  return Boolean(record && record.schema === SCHEMA && record.key === key && record.complete === true && existsSync(join(entry, "node_modules")));
}

/** Visit every path under `dir` depth-first, children before parents, never following a symlink. */
function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stats = lstatSync(path);
    if (stats.isDirectory()) walk(path, visit);
    visit(path, stats);
  }
}

/**
 * Clear every file's write bits, so the shared entry cannot be edited through
 * its own paths. Directories stay writable so a plain `rm -rf` still removes it.
 */
function makeReadOnly(dir) {
  walk(dir, (path, stats) => { if (stats.isFile()) chmodSync(path, (stats.mode & 0o7777) & ~0o222); });
}

/** Give the owner write access again: metadata only, so a clone stays shared. */
export function makeWritable(dir) {
  chmodSync(dir, (statSync(dir).mode & 0o7777) | 0o200);
  walk(dir, (path, stats) => { if (!stats.isSymbolicLink()) chmodSync(path, (stats.mode & 0o7777) | 0o200); });
}

/** Remove an engine-made tree, restoring the owner write bit it removed itself. */
export function removeTree(dir) {
  if (!existsSync(dir)) return;
  try { makeWritable(dir); } catch { /* removal below reports what remains */ }
  rmSync(dir, { recursive: true, force: true });
}

function lockOwner(lock) {
  return readJson(join(lock, "owner.json"));
}

/**
 * Take the key's lock, waiting while a live owner installs. A dead owner's
 * lock is retired by rename, so two waiters cannot both reclaim it. An
 * ownerless lock older than `orphanMs` is a crash between mkdir and the owner
 * write.
 */
function acquire(lock, { entry, key, timeoutMs, pollMs, orphanMs }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, host: hostname() }));
      return { ok: true };
    } catch (error) {
      if (error.code !== "EEXIST") return refuse(`cannot create dependency lock ${lock}: ${error.message}`);
    }
    if (isComplete(entry, key)) return { ok: true, published: true };
    const owner = lockOwner(lock);
    let stale = false;
    if (owner) {
      const alive = ownerAlive(owner);
      if (alive === null) return refuse(`dependency lock ${lock} is held by ${JSON.stringify(owner)}, which this host cannot check; remove it only after confirming that install has stopped`);
      stale = alive === false;
    } else {
      try { stale = Date.now() - statSync(lock).mtimeMs > orphanMs; } catch { stale = false; }
    }
    if (stale) {
      const retired = `${lock}.stale-${randomUUID()}`;
      try { renameSync(lock, retired); rmSync(retired, { recursive: true, force: true }); } catch { /* another waiter retired it */ }
      continue;
    }
    if (Date.now() > deadline) return refuse(`timed out after ${timeoutMs} ms waiting for the install holding ${lock}`);
    sleep(pollMs);
  }
}

function release(lock) {
  const owner = lockOwner(lock);
  if (!owner || owner.pid !== process.pid || owner.host !== hostname()) return;
  rmSync(join(lock, "owner.json"), { force: true });
  try { rmdirSync(lock); } catch { /* left for the stale-lock path */ }
}

/**
 * Return the complete cache entry for `tree`'s lockfile, installing it once.
 *
 * @returns {{ok: true, key: string, path: string, installed: boolean, inputs: object} | {ok: false, message: string}}
 */
export function ensureEntry({ root, tree, npm = "npm", env = process.env, timeoutMs = 15 * 60_000, pollMs = 200, orphanMs = 60_000, inputs: given = null }) {
  const keyed = given ?? cacheInputs({ tree, npm });
  if (!keyed.ok) return keyed;
  const { key, inputs } = keyed;
  const base = join(root, DEPS_DIR);
  mkdirSync(base, { recursive: true });
  const entry = join(base, key);
  if (isComplete(entry, key)) return { ok: true, key, path: entry, installed: false, inputs };
  if (existsSync(entry)) return refuse(`${entry} exists but is not a complete entry for this key; inspect it before removing it`);

  const lock = join(base, `${key}.lock`);
  const held = acquire(lock, { entry, key, timeoutMs, pollMs, orphanMs });
  if (!held.ok) return held;
  if (held.published) return { ok: true, key, path: entry, installed: false, inputs };
  const temp = join(base, `.tmp-${key}-${randomUUID()}`);
  try {
    if (isComplete(entry, key)) return { ok: true, key, path: entry, installed: false, inputs };
    mkdirSync(temp);
    writeFileSync(join(temp, "owner.json"), JSON.stringify({ pid: process.pid, host: hostname() }));
    for (const name of ["package.json", inputs.lockfile, ".npmrc"]) {
      if (existsSync(join(tree, name))) writeFileSync(join(temp, name), readFileSync(join(tree, name)));
    }
    const result = spawnSync(npm, ["ci", "--no-audit", "--no-fund"], { cwd: temp, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(join(temp, "install.log"), `${result.stdout ?? ""}${result.stderr ?? ""}`);
    if (result.status !== 0) {
      const log = join(base, `${key}.failed-${Date.now()}.log`);
      renameSync(join(temp, "install.log"), log);
      removeTree(temp);
      return refuse(`\`${npm} ci\` failed (exit ${result.status ?? result.signal}); nothing was published; log: ${log}`);
    }
    if (!existsSync(join(temp, "node_modules", ".package-lock.json"))) {
      removeTree(temp);
      return refuse(`\`${npm} ci\` exited 0 without node_modules/.package-lock.json; nothing was published`);
    }
    rmSync(join(temp, "owner.json"));
    writeFileSync(join(temp, "entry.json"), JSON.stringify({ schema: SCHEMA, key, inputs, createdAt: new Date().toISOString(), complete: true }, null, 2) + "\n");
    makeReadOnly(join(temp, "node_modules"));
    try {
      renameSync(temp, entry);
    } catch (error) {
      removeTree(temp);
      if (!isComplete(entry, key)) return refuse(`cannot publish ${entry}: ${error.message}`);
    }
    return { ok: true, key, path: entry, installed: true, inputs };
  } catch (error) {
    removeTree(temp);
    return refuse(`dependency install for ${key} failed: ${error.message}; nothing was published`);
  } finally {
    release(lock);
  }
}

/** The copy strategies to try, best first. */
function strategies(platform) {
  if (platform === "darwin") return [{ name: "clone", args: ["-cR"] }];
  if (platform === "linux") return [{ name: "reflink", args: ["-R", "--reflink=always"] }];
  return [];
}

/** Sampled proof that no file in `copy` is the same inode as its source. */
function sharesInode(source, copy, limit = 500) {
  let checked = 0;
  let shared = false;
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (checked >= limit || shared) return;
      const from = lstatSync(join(dir, name));
      const to = lstatSync(join(copy, join(dir, name).slice(source.length)));
      if (from.isDirectory()) visit(join(dir, name));
      else if (from.isFile()) { checked += 1; if (from.dev === to.dev && from.ino === to.ino) shared = true; }
    }
  };
  visit(source);
  return shared;
}

/**
 * Give `tree` its own writable node_modules from a complete entry.
 *
 * @returns {{ok: true, strategy: "clone"|"reflink"|"copy", warning: string|null} | {ok: false, message: string}}
 */
export function materialize({ entry, tree, platform = process.platform, cp = "cp" }) {
  const source = join(entry, "node_modules");
  const target = join(tree, "node_modules");
  let exists = true;
  try { lstatSync(target); } catch { exists = false; }
  if (exists) return refuse(`${target} already exists; materialize only into a tree without dependencies`);
  let strategy = null;
  for (const candidate of strategies(platform)) {
    const result = spawnSync(cp, [...candidate.args, source, target], { encoding: "utf8" });
    if (result.status === 0) { strategy = candidate.name; break; }
    removeTree(target);
  }
  let warning = null;
  if (!strategy) {
    cpSync(source, target, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    strategy = "copy";
    warning = "copy-on-write cloning is unavailable here; this tree's dependencies were fully copied and use their full size on disk";
  }
  makeWritable(target);
  if (sharesInode(source, target)) {
    removeTree(target);
    return refuse(`${target} shared an inode with the cache; it was removed, and nothing is shared`);
  }
  try { writeFileSync(`${entry}.used`, new Date().toISOString() + "\n"); } catch { /* recency only guides eviction */ }
  return { ok: true, strategy, warning };
}
