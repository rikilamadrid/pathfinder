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
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, rmdirSync, statfsSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { formatGb } from "./disk.mjs";
import { isWsl, liveness, ownerRecord } from "./process.mjs";

export const DEPS_DIR = ".pathfinder/deps";
const SCHEMA = "pathfinder.deps-entry/1";
const LOCKFILES = ["npm-shrinkwrap.json", "package-lock.json"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const refuse = (message) => ({ ok: false, message });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);

/**
 * The program and leading arguments that run npm, never through a shell.
 *
 * A `.js`/`.cjs`/`.mjs` path runs under this Node. On Windows, plain `npm` is
 * a .cmd shim that Node starts only through cmd.exe — which would make the
 * path shell syntax and search the current directory, the reviewed tree,
 * first — so it resolves to the npm-cli.js installed beside this Node instead,
 * and any other Windows value must name a script.
 */
export function npmCommand(npm = "npm", platform = process.platform, execPath = process.execPath) {
  // A path is made absolute once, so `--version` and `ci` (run in another
  // directory) name the same program.
  const named = /[\\/]/.test(npm) || /\.(?:c|m)?js$/i.test(npm) ? (platform === "win32" ? win32.resolve(npm) : resolve(npm)) : npm;
  if (/\.(?:c|m)?js$/i.test(named)) return { ok: true, file: execPath, args: [named] };
  if (platform !== "win32") return { ok: true, file: named, args: [] };
  if (npm !== "npm") return refuse(`on Windows --npm must name npm's npm-cli.js (or another .js entry point), not ${npm}; shims run only through cmd.exe`);
  const cli = join(dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(cli)) return refuse(`cannot find npm beside this Node at ${cli}; pass --npm <path to npm-cli.js>`);
  return { ok: true, file: execPath, args: [cli] };
}

export function runNpm(npm, args, options = {}) {
  const command = npmCommand(npm);
  if (!command.ok) return { status: null, stdout: "", stderr: command.message, error: new Error(command.message) };
  return spawnSync(command.file, [...command.args, ...args], { encoding: "utf8", windowsHide: true, ...options });
}

/** Rename, retrying the transient sharing violations Windows reports while a scanner holds a file open. */
function renameRetrying(from, to, attempts = process.platform === "win32" ? 8 : 1) {
  for (let n = 1; ; n += 1) {
    try { return renameSync(from, to); } catch (error) {
      if (n >= attempts || !TRANSIENT.has(error.code) || existsSync(to)) throw error;
      sleep(50 * 2 ** n);
    }
  }
}

/**
 * What one install depends on, and the key it hashes to.
 * Every machine-dependent input can be overridden so the key is testable.
 */
/**
 * A hash of the configuration npm reads besides the project: NODE_ENV, the
 * install-affecting npm_config_* variables, and the user and global npmrc.
 * Lifecycle scripts that read other variables or files are not keyed; a
 * project that depends on them should review with `--ignore-scripts` trees or
 * install directly. NODE_ENV=production alone
 * changes what `npm ci` installs. Values are hashed, never stored: they can
 * hold registry tokens.
 */
const INSTALL_SETTINGS = new Set([
  "omit", "include", "production", "only", "also", "dev", "optional", "registry", "ignore_scripts", "legacy_peer_deps",
  "strict_peer_deps", "install_links", "install_strategy", "global_style", "legacy_bundling", "engine_strict", "force",
  "os", "cpu", "libc", "arch", "platform", "target", "target_arch", "target_platform", "runtime", "disturl",
  "build_from_source", "python", "msvs_version", "script_shell", "sharp_binary_host", "sharp_libvips_binary_host",
  "bin_links", "workspace", "workspaces", "include_workspace_root", "nodedir", "globalconfig", "userconfig", "prefix",
]);
const installSetting = (name) => {
  const match = /^npm_config_(.+)$/i.exec(name);
  if (!match) return false;
  const setting = match[1].toLowerCase().replace(/-/g, "_");
  return INSTALL_SETTINGS.has(setting) || setting.endsWith(":registry") || setting.endsWith("_registry");
};

export function npmEnvironment(env = process.env) {
  // Only settings that change what gets installed: npm also sets per-run
  // variables (prefix, user agent, cache) that would split one key per tree.
  const names = Object.keys(env).filter((name) => installSetting(name) || name === "NODE_ENV").sort();
  const setting = (name) => env[`npm_config_${name}`] || env[`NPM_CONFIG_${name.toUpperCase()}`];
  const prefix = setting("prefix") || (process.platform === "win32" ? dirname(process.execPath) : dirname(dirname(process.execPath)));
  const files = {
    user: setting("userconfig") || join(env.HOME || env.USERPROFILE || homedir(), ".npmrc"),
    global: setting("globalconfig") || join(prefix, "etc", "npmrc"),
  };
  const content = {};
  for (const [which, file] of Object.entries(files)) {
    try { content[which] = sha256(readFileSync(file)); } catch { content[which] = null; }
  }
  return sha256(JSON.stringify({ env: names.map((name) => [name, env[name]]), ...content }));
}

export function cacheInputs({ tree, npm = "npm", env = process.env, node = process.version, npmVersion = null, platform = process.platform, arch = process.arch }) {
  const lockfile = LOCKFILES.find((name) => existsSync(join(tree, name)));
  if (!lockfile) return refuse(`${tree} has no package-lock.json or npm-shrinkwrap.json; the cache installs only locked trees`);
  if (!existsSync(join(tree, "package.json"))) return refuse(`${tree} has no package.json`);
  let version = npmVersion;
  if (version === null) {
    const result = runNpm(npm, ["--version"], { env });
    if (result.status !== 0) return refuse(`cannot run \`${npm} --version\`: ${(result.stderr || result.error?.message || "").trim()}`);
    version = result.stdout.trim();
  }
  const npmrc = existsSync(join(tree, ".npmrc")) ? sha256(readFileSync(join(tree, ".npmrc"))) : null;
  const inputs = {
    lockfile,
    lock: sha256(readFileSync(join(tree, lockfile))),
    manifest: sha256(readFileSync(join(tree, "package.json"))),
    npmrc,
    environment: npmEnvironment(env),
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
  if (lstatSync(dir).isSymbolicLink()) throw new Error(`${dir} is a link; its target is not this engine's to change`);
  chmodSync(dir, (statSync(dir).mode & 0o7777) | 0o200);
  walk(dir, (path, stats) => { if (!stats.isSymbolicLink()) chmodSync(path, (stats.mode & 0o7777) | 0o200); });
}

/** Remove an engine-made tree, restoring the owner write bit it removed itself. */
export function removeTree(dir) {
  let stats;
  try { stats = lstatSync(dir); } catch { return; }
  if (stats.isSymbolicLink()) { unlinkSync(dir); return; }
  try { makeWritable(dir); } catch { /* removal below reports what remains */ }
  rmSync(dir, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 8 : 0, retryDelay: 100 });
}

/**
 * Links in a dependency tree that would be shared once copied: absolute
 * targets (every Windows junction, and npm's links to local packages) and
 * relative targets that leave the tree. npm's own `.bin` links stay inside.
 */
export function escapingLinks(dir, limit = 5) {
  const found = [];
  const visit = (current) => {
    for (const name of readdirSync(current)) {
      if (found.length >= limit) return;
      const path = join(current, name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) {
        let target;
        try { target = readlinkSync(path); } catch { found.push(path); continue; }
        const rel = relative(dir, resolve(dirname(path), target));
        if (isAbsolute(target) || !rel || rel.startsWith("..") || isAbsolute(rel)) found.push(`${path} -> ${target}`);
      } else if (stats.isDirectory()) visit(path);
    }
  };
  visit(dir);
  return found;
}

/**
 * Bytes a full copy of `dir` would occupy: allocated blocks where the platform
 * reports them, else each file rounded up to a 4 KiB cluster. Sizes alone
 * undercount a tree of many small files by a fifth.
 */
export function treeBytes(dir) {
  let total = 0;
  const visit = (current) => {
    for (const name of readdirSync(current)) {
      const stats = lstatSync(join(current, name));
      if (stats.isDirectory()) visit(join(current, name));
      else total += stats.blocks ? stats.blocks * 512 : Math.ceil(stats.size / 4096) * 4096;
    }
  };
  visit(dir);
  return total;
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
function acquire(lock, { entry, key, timeoutMs, pollMs, orphanMs, shortcut = true }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "owner.json"), JSON.stringify(ownerRecord(process.pid)));
      return { ok: true };
    } catch (error) {
      if (error.code !== "EEXIST") return refuse(`cannot create dependency lock ${lock}: ${error.message}`);
    }
    if (shortcut && isComplete(entry, key)) return { ok: true, published: true };
    const owner = lockOwner(lock);
    let stale = false;
    if (owner) {
      const alive = liveness(owner);
      if (alive === null) return refuse(`dependency lock ${lock} is held by ${JSON.stringify(owner)}, which this host cannot check; remove it only after confirming that install has stopped`);
      stale = alive === false;
    } else {
      try { stale = Date.now() - statSync(lock).mtimeMs > orphanMs; } catch { stale = false; }
    }
    if (stale && breakStale(lock, owner, orphanMs)) continue;
    if (Date.now() > deadline) return refuse(`timed out after ${timeoutMs} ms waiting for ${lock}${stale ? " (its owner is gone; another process is retiring it)" : ", held by a live install or copy"}`);
    sleep(pollMs);
  }
}

const sameOwner = (a, b) => Boolean(a && b && a.pid === b.pid && a.host === b.host && a.platform === b.platform);

/**
 * Retire a stale lock, one breaker at a time. Without the breaker, two waiters
 * that both saw the same dead owner could race: the first retires it, a third
 * process takes a fresh lock, and the second retires that live lock. Under the
 * breaker the lock is re-read and retired only if it still has the dead owner
 * (or is still an old ownerless directory). A breaker left by a crash expires.
 */
function breakStale(lock, observed, orphanMs) {
  const breaker = `${lock}.break`;
  try {
    mkdirSync(breaker);
  } catch {
    // Another waiter is breaking it, or one crashed doing so: report no
    // progress, so the caller honours its deadline and sleeps.
    try { if (Date.now() - statSync(breaker).mtimeMs > orphanMs) { rmdirSync(breaker); return true; } } catch { /* gone already */ }
    return false;
  }
  try {
    const current = lockOwner(lock);
    let still = false;
    if (observed) still = sameOwner(current, observed);
    else { try { still = !current && Date.now() - statSync(lock).mtimeMs > orphanMs; } catch { still = false; } }
    if (!still) return true;
    const retired = `${lock}.stale-${randomUUID()}`;
    try { renameSync(lock, retired); rmSync(retired, { recursive: true, force: true }); } catch { /* already retired */ }
  } finally {
    try { rmdirSync(breaker); } catch { /* expires */ }
  }
  return true;
}

function release(lock) {
  const owner = lockOwner(lock);
  const self = ownerRecord(process.pid);
  if (!owner || owner.pid !== self.pid || owner.host !== self.host || owner.platform !== self.platform) return;
  rmSync(join(lock, "owner.json"), { force: true });
  try { rmdirSync(lock); } catch { /* left for the stale-lock path */ }
}

/**
 * Return the complete cache entry for `tree`'s lockfile, installing it once.
 *
 * @returns {{ok: true, key: string, path: string, installed: boolean, inputs: object} | {ok: false, message: string}}
 */
export function ensureEntry({ root, tree, npm = "npm", env = process.env, timeoutMs = 15 * 60_000, pollMs = 200, orphanMs = 60_000, inputs: given = null }) {
  const keyed = given ?? cacheInputs({ tree, npm, env });
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
    writeFileSync(join(temp, "owner.json"), JSON.stringify(ownerRecord(process.pid)));
    for (const name of ["package.json", inputs.lockfile, ".npmrc"]) {
      if (existsSync(join(tree, name))) writeFileSync(join(temp, name), readFileSync(join(tree, name)));
    }
    const result = runNpm(npm, ["ci", "--no-audit", "--no-fund"], { cwd: temp, env, maxBuffer: 64 * 1024 * 1024 });
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
    const links = escapingLinks(join(temp, "node_modules"));
    if (links.length) {
      removeTree(temp);
      return refuse(`the install links outside its own tree (${links.join("; ")}); copies would share those targets, so nothing was published — install this tree directly`);
    }
    rmSync(join(temp, "owner.json"));
    const bytes = treeBytes(join(temp, "node_modules"));
    writeFileSync(join(temp, "entry.json"), JSON.stringify({ schema: SCHEMA, key, inputs, bytes, createdAt: new Date().toISOString(), complete: true }, null, 2) + "\n");
    makeReadOnly(join(temp, "node_modules"));
    try {
      renameRetrying(temp, entry);
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

/**
 * Hold `key`'s lock: the same lock an install takes. Copying from an entry
 * and removing it both hold it, so an entry is never removed mid-copy.
 *
 * @returns {{ok: true, release: () => void} | {ok: false, message: string}}
 */
export function holdKey({ root, key, timeoutMs = 15 * 60_000, pollMs = 200, orphanMs = 60_000 }) {
  const base = join(root, DEPS_DIR);
  mkdirSync(base, { recursive: true });
  const lock = join(base, `${key}.lock`);
  const held = acquire(lock, { entry: join(base, key), key, timeoutMs, pollMs, orphanMs, shortcut: false });
  return held.ok ? { ok: true, release: () => release(lock) } : held;
}

/**
 * Remove a published entry without ever exposing a partial one: under its
 * lock, rename it out of the published name, then delete the renamed tree.
 * Refused while any install or copy holds the key.
 */
export function unpublish({ root, key }) {
  const base = join(root, DEPS_DIR);
  const entry = join(base, key);
  if (lstatSync(entry).isSymbolicLink()) return refuse(`${entry} is a link, not an entry; left untouched`);
  const held = holdKey({ root, key, timeoutMs: 0 });
  if (!held.ok) return refuse(`${key} is in use; left in place`);
  const trash = join(base, `.trash-${key}-${randomUUID()}`);
  try {
    renameRetrying(entry, trash);
    rmSync(`${entry}.used`, { force: true });
  } catch (error) {
    return refuse(`cannot unpublish ${key}: ${error.message}`);
  } finally {
    held.release();
  }
  removeTree(trash);
  return { ok: true };
}

const APFS = 0x1a;

/**
 * Whether a clone is possible from `source` into `treeDir`. macOS `cp -c`
 * silently falls back to an ordinary copy off APFS or across volumes and
 * still exits 0, so its exit status proves nothing: both ends must be on one
 * APFS volume. Linux `--reflink=always` fails loudly, so it is simply tried.
 */
export function cloneable(source, treeDir, platform = process.platform) {
  if (platform !== "darwin") return platform === "linux";
  try {
    return statfsSync(source).type === APFS && statfsSync(treeDir).type === APFS && lstatSync(source).dev === lstatSync(treeDir).dev;
  } catch {
    return false;
  }
}

/**
 * Retire `lock` only if it is still stale now: a dead owner, or ownerless and
 * old. Prune plans first and acts later, so it re-checks under the breaker
 * rather than trusting its plan.
 */
export function retireStaleLock(lock, orphanMs = 60_000) {
  const owner = lockOwner(lock);
  if (owner ? liveness(owner) !== false : (() => { try { return Date.now() - statSync(lock).mtimeMs <= orphanMs; } catch { return true; } })()) return false;
  return breakStale(lock, owner, orphanMs) && !existsSync(lock);
}

/** The copy strategies to try, best first. */
function defaultStrategies(platform) {
  if (platform === "darwin") return [{ name: "clone", args: ["-cR"] }];
  if (platform === "linux") return [{ name: "reflink", args: ["-R", "--reflink=always"] }];
  return [];
}

/** Sampled proof that no file in `copy` is the same inode as its source. Inodes are compared as bigints: NTFS file ids exceed 2^53. */
function sharesInode(source, copy, limit = 500) {
  let checked = 0;
  let shared = false;
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (checked >= limit || shared) return;
      const from = lstatSync(join(dir, name), { bigint: true });
      const to = lstatSync(join(copy, join(dir, name).slice(source.length)), { bigint: true });
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
 * `beforeCopy(bytes)` is asked before a full copy and may refuse it, so a
 * platform without cloning cannot fill the disk past its floor. A copy that
 * shares an inode or a link target with the cache is removed and refused —
 * never kept as a silent shared fallback.
 *
 * @returns {{ok: true, strategy: "clone"|"reflink"|"copy", warning: string|null} | {ok: false, message: string}}
 */
export function materialize({ entry, tree, platform = process.platform, cp = "cp", strategies = defaultStrategies(platform), beforeCopy = null, canClone = cloneable }) {
  const source = join(entry, "node_modules");
  const target = join(tree, "node_modules");
  let exists = true;
  try { lstatSync(target); } catch { exists = false; }
  if (exists) return refuse(`${target} already exists; materialize only into a tree without dependencies`);
  let strategy = null;
  let record;
  try { record = JSON.parse(readFileSync(join(entry, "entry.json"), "utf8")); } catch { record = null; }
  if (!record || !isComplete(entry, record.key)) return refuse(`${entry} is no longer a complete entry; nothing was materialized`);
  for (const candidate of canClone(source, tree, platform) ? strategies : []) {
    const result = spawnSync(cp, [...candidate.args, source, target], { encoding: "utf8", windowsHide: true });
    if (result.status === 0) { strategy = candidate.name; break; }
    removeTree(target);
    if (!existsSync(join(source, ".package-lock.json"))) return refuse(`${source} disappeared during the copy; nothing was materialized`);
  }
  let warning = null;
  if (!strategy) {
    const bytes = Number.isFinite(record.bytes) ? record.bytes : treeBytes(source);
    if (beforeCopy) {
      const verdict = beforeCopy(bytes);
      if (!verdict.ok) return refuse(`copy-on-write cloning is unavailable here and a full copy needs ${formatGb(bytes)}: ${verdict.message}`);
    }
    try {
      cpSync(source, target, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    } catch (error) {
      removeTree(target);
      return refuse(`full copy into ${target} failed: ${error.message}; nothing was materialized`);
    }
    strategy = "copy";
    const where = platform === "linux" && isWsl() && /^\/mnt\/[a-z]\//i.test(tree) ? " (a WSL Windows drive; keep review trees on the Linux filesystem to clone)" : "";
    warning = `copy-on-write cloning is unavailable here${where}; this tree's dependencies were fully copied and use about ${formatGb(bytes)} on disk`;
  }
  makeWritable(target);
  const links = escapingLinks(target);
  if (links.length || sharesInode(source, target)) {
    removeTree(target);
    return refuse(`${target} shared ${links.length ? `link targets (${links.join("; ")})` : "an inode"} with the cache; it was removed, and nothing is shared`);
  }
  try { writeFileSync(`${entry}.used`, new Date().toISOString() + "\n"); } catch { /* recency only guides eviction */ }
  return { ok: true, strategy, warning };
}
