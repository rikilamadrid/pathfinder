/**
 * Sandbox resources Pathfinder owns, and the only way they are removed.
 *
 * Every Docker Sandboxes run the adapter creates lives in a run directory,
 * `.pathfinder/sandboxes/<key>/<runId>/`, whose `owner.json` records the
 * ticket, session, exact sandbox name, workspace and owning process. That
 * record is the whole of ownership. Docker Sandboxes documents no labels, so a
 * `pf-` prefix proves nothing: a sandbox is Pathfinder's only when a valid
 * record names it exactly and the workspace the record names is the run's own
 * and is the one `sbx` reports for it.
 *
 * Cleanup is a preview first (`cleanupPlan`, which only reads), then an
 * explicit `executeCleanup` that re-reads the record and `sbx ls` immediately
 * before every action and skips anything that changed. It archives evidence
 * before removing its only copy, removes only a recorded sandbox by exact
 * name, deletes only inside the run directory, never follows a symlink, and
 * treats unknown ownership, an unreadable record, an unanswerable `sbx`, or an
 * owner process it cannot check as active. It never runs `sbx prune`,
 * `sbx rm --all`, or any `docker` command.
 *
 * Every `sbx` call goes through an injected runner (the Feature 64 shared
 * contract): `run(argv, options) → { status, signal, stdout, stderr, error }`,
 * `argv[0]` the executable. The default spawns with no shell and a timeout.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, unlinkSync } from "node:fs";
import path, { join } from "node:path";
import { atomicCheckpointWrite } from "./checkpoint-write.mjs";
import { isKey } from "./keys.mjs";
import { liveness } from "./process.mjs";

export const SANDBOXES_DIR = ".pathfinder/sandboxes";
export const ARCHIVES_DIR = ".pathfinder/archives/sandboxes";
export const OWNER_SCHEMA = "pathfinder.sandbox-owner/1";
export const OWNER_FILE = "owner.json";
export const WORKSPACE_DIR = "workspace";
/** Host ↔ sandbox exchange inside a workspace; only `out/` is evidence. */
export const EXCHANGE_DIR = ".pathfinder-sandbox";
export const LOGS_DIR = "logs";

/**
 * What happens to a run's resources once its session ends.
 *
 * - `collected` — the session finished and its results were imported: the
 *   sandbox is removed after its evidence is archived, and so is the
 *   workspace.
 * - `failed`, or `interrupted` (owner process gone before the run reached a
 *   final state): the sandbox is stopped, never removed, and kept with its
 *   workspace for inspection until a human runs an explicit cleanup.
 *
 * Archiving always precedes removal: evidence is never deleted while it is
 * the only copy.
 */
export const RETENTION = Object.freeze({
  collected: Object.freeze({ sandbox: "remove-after-archive", workspace: "remove-after-archive" }),
  failed: Object.freeze({ sandbox: "stop-and-retain", workspace: "retain-until-explicit-cleanup" }),
  interrupted: Object.freeze({ sandbox: "stop-and-retain", workspace: "retain-until-explicit-cleanup" }),
});

/** prepared → created → running → stopped → collected | failed → removed; failure can end any live state. */
export const STATES = Object.freeze(["prepared", "created", "running", "stopped", "collected", "failed", "removed"]);
const TRANSITIONS = Object.freeze({
  prepared: ["created", "failed"],
  created: ["running", "stopped", "failed"],
  running: ["stopped", "collected", "failed"],
  stopped: ["collected", "failed"],
  collected: ["removed"],
  failed: ["removed"],
  removed: [],
});
const FINAL = new Set(["collected", "failed"]);
/** Fields a later update may change. Everything else is identity, fixed at creation. */
const MUTABLE = new Set(["state", "agent", "evidence", "runtime", "updatedAt"]);

const RUN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const SESSION = /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/;
/** sbx: at least two characters, starting alphanumeric; letters, digits, hyphens, periods. */
const SBX_NAME = /^[A-Za-z0-9][A-Za-z0-9.-]+$/;
const DEFAULT_TIMEOUT_MS = 60_000;

const refuse = (message) => ({ ok: false, message });
const portable = (relativePath) => relativePath.split(path.sep).join("/");
/** The canonical spelling of an existing path, or null. */
const real = (target) => {
  try { return realpathSync.native(target); } catch { return null; }
};

/** `child` relative to `parent` when it lies strictly inside it, else null. */
function inside(parent, child) {
  const rel = path.relative(parent, child);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel;
}

// ---------------------------------------------------------------------------
// Identity

/** `YYYYMMDDTHHMMSSZ-<8 hex>`, in UTC. */
export function newRunId(now = new Date(), random = () => randomBytes(4).toString("hex")) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const id = `${stamp}-${random()}`;
  if (!RUN_ID.test(id)) throw new TypeError(`not a run id: ${id}`);
  return id;
}

export const isRunId = (value) => typeof value === "string" && RUN_ID.test(value);
export const isSession = (value) => typeof value === "string" && SESSION.test(value);
export const isSandboxName = (value) => typeof value === "string" && SBX_NAME.test(value);

/** `pf-<key with . → ->-<session>-<last 8 hex of runId>`, e.g. `pf-64-1-implementation-1a2b3c4d`. */
export function sandboxName(key, session, runId) {
  if (!isKey(key)) throw new TypeError(`\`${key}\` is not a ticket key`);
  if (!isSession(session)) throw new TypeError(`\`${session}\` is not a session name`);
  if (!isRunId(runId)) throw new TypeError(`\`${runId}\` is not a run id`);
  const name = `pf-${key.replace(/\./g, "-")}-${session}-${runId.slice(-8)}`;
  if (!isSandboxName(name)) throw new TypeError(`\`${name}\` is not a valid sbx sandbox name`);
  return name;
}

export const runDirectory = (root, key, runId) => join(root, ...SANDBOXES_DIR.split("/"), key, runId);
export const archiveDirectory = (root, key, runId) => join(root, ...ARCHIVES_DIR.split("/"), key, runId);

// ---------------------------------------------------------------------------
// Owner records

/** The reason a record is not a valid owner record for this run directory, or null. */
function recordProblem(record, runDir) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "not a JSON object";
  if (record.schema !== OWNER_SCHEMA) return `schema is not ${OWNER_SCHEMA}`;
  if (!isKey(record.key)) return "key is not a ticket key";
  if (!isRunId(record.runId)) return "runId is not a run id";
  if (!isSession(record.session)) return "session is not a session name";
  if (typeof record.role !== "string" || !record.role) return "role is missing";
  let expected;
  try { expected = sandboxName(record.key, record.session, record.runId); } catch (error) { return error.message; }
  if (record.sandbox !== expected) return `sandbox is not ${expected}`;
  if (typeof record.workspace !== "string" || !path.isAbsolute(record.workspace)) return "workspace is not an absolute path";
  if (!STATES.includes(record.state)) return `state is not one of ${STATES.join(", ")}`;
  if (!record.owner || typeof record.owner !== "object") return "owner is missing";
  if (runDir) {
    if (path.basename(runDir) !== record.runId) return "runId does not match its run directory";
    if (path.basename(path.dirname(runDir)) !== record.key) return "key does not match its run directory";
  }
  return null;
}

/**
 * Is `workspace` exactly `<runDir>/workspace`, spelled through the run
 * directory as given or its canonical path? Nothing else is accepted: the
 * workspace is writable by the sandbox, so the record — which lives beside it,
 * never inside it — must name it by position, not by anything found there.
 */
function ownWorkspace(workspace, runDir) {
  if (typeof workspace !== "string" || !path.isAbsolute(workspace)) return false;
  const given = path.resolve(workspace);
  const canonicalRun = real(runDir);
  return given === join(path.resolve(runDir), WORKSPACE_DIR) || (canonicalRun !== null && given === join(canonicalRun, WORKSPACE_DIR));
}

/** Write a run's owner record atomically: a crash leaves the old record or the new, never a torn one. */
export function writeOwnerRecord(runDir, record) {
  const problem = recordProblem(record, runDir);
  if (problem) return refuse(`owner record refused: ${problem}`);
  mkdirSync(runDir, { recursive: true });
  if (!ownWorkspace(record.workspace, runDir)) return refuse(`owner record refused: workspace must be ${join(runDir, WORKSPACE_DIR)}`);
  const file = join(runDir, OWNER_FILE);
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) return refuse(`${file} is a symlink; nothing was written`);
  atomicCheckpointWrite(file, JSON.stringify(record, null, 2) + "\n");
  return { ok: true, path: file, record };
}

/** The record in `runDir`, or `{ ok: false, reason }` when it is missing, a symlink, or malformed. */
export function readOwnerRecord(runDir) {
  const file = join(runDir, OWNER_FILE);
  let stats;
  try { stats = lstatSync(file); } catch { return { ok: false, reason: `${OWNER_FILE} is missing` }; }
  if (!stats.isFile()) return { ok: false, reason: `${OWNER_FILE} is not a regular file` };
  let record;
  try { record = JSON.parse(readFileSync(file, "utf8")); } catch { return { ok: false, reason: `${OWNER_FILE} is not valid JSON` }; }
  const problem = recordProblem(record, runDir);
  return problem ? { ok: false, reason: problem } : { ok: true, record };
}

/**
 * Change a record's mutable fields. A state change must follow the lifecycle;
 * identity fields never change. `from` refuses unless the record is still in
 * that state, so a caller acting on what it last read cannot overwrite a
 * newer transition.
 */
export function updateOwnerRecord(runDir, patch, { from = null, now = new Date() } = {}) {
  const current = readOwnerRecord(runDir);
  if (!current.ok) return refuse(`owner record unreadable: ${current.reason}`);
  const record = current.record;
  for (const field of Object.keys(patch ?? {})) {
    if (!MUTABLE.has(field)) return refuse(`\`${field}\` is fixed when the record is created`);
  }
  if (from !== null && record.state !== from) return refuse(`record is ${record.state}, not ${from}`);
  if (patch.state !== undefined && patch.state !== record.state && !TRANSITIONS[record.state]?.includes(patch.state)) {
    return refuse(`state cannot move from ${record.state} to ${patch.state}`);
  }
  if (record.state === "removed") return refuse("record is removed; it no longer changes");
  const next = { ...record, ...patch, updatedAt: now.toISOString() };
  return writeOwnerRecord(runDir, next);
}

/**
 * Every run directory under `.pathfinder/sandboxes/`, optionally for one key.
 * A malformed record, a symlinked or misnamed directory, or a missing record
 * is returned as `unreadable` with its reason — never dropped, and never
 * treated as owned.
 */
export function readOwnerRecords(root, { key = null } = {}) {
  const base = join(root, ...SANDBOXES_DIR.split("/"));
  const entries = [];
  let keys;
  try { keys = readdirSync(base); } catch { return entries; }
  for (const keyName of keys.sort()) {
    if (key !== null && keyName !== key) continue;
    const keyDir = join(base, keyName);
    const keyStats = lstatSync(keyDir);
    if (keyStats.isSymbolicLink() || !keyStats.isDirectory() || !isKey(keyName)) {
      entries.push({ status: "unreadable", runDir: keyDir, key: keyName, runId: null, reason: keyStats.isSymbolicLink() ? "a symlink; not followed" : "not a ticket key directory" });
      continue;
    }
    for (const runName of readdirSync(keyDir).sort()) {
      const runDir = join(keyDir, runName);
      const runStats = lstatSync(runDir);
      if (runStats.isSymbolicLink() || !runStats.isDirectory() || !isRunId(runName)) {
        entries.push({ status: "unreadable", runDir, key: keyName, runId: runName, reason: runStats.isSymbolicLink() ? "a symlink; not followed" : "not a run directory" });
        continue;
      }
      const read = readOwnerRecord(runDir);
      entries.push(read.ok
        ? { status: "ok", runDir, key: keyName, runId: runName, record: read.record }
        : { status: "unreadable", runDir, key: keyName, runId: runName, reason: read.reason });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// sbx

/** The sbx executable: `PATHFINDER_SBX` (an absolute path) when set, else `sbx` on PATH. */
export function sbxExecutable(env = process.env) {
  const configured = env.PATHFINDER_SBX;
  return configured && path.isAbsolute(configured) ? configured : "sbx";
}

/** The default runner: no shell, a timeout, the contract's result shape. */
export function defaultRun(argv, { timeout = DEFAULT_TIMEOUT_MS, env = process.env, cwd } = {}) {
  const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", shell: false, windowsHide: true, timeout, env, cwd });
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error ?? null };
}

/** Commands this module may run. Anything else is a programming error, refused before it reaches a process. */
const ALLOWED = Object.freeze({ ls: ["ls", "--json"], stop: ["stop", "--json"], rm: ["rm", "--force", "--json"] });

function sbx(run, env, command, name = null) {
  const args = [...ALLOWED[command]];
  if (name !== null) {
    if (!isSandboxName(name)) throw new Error(`refusing sbx ${command} on \`${name}\``);
    args.push(name);
  }
  const argv = [sbxExecutable(env), "--no-input", ...args];
  if (argv.some((arg) => arg === "prune" || arg === "--all" || arg === "-a") || /(^|[\\/])docker(\.exe)?$/i.test(argv[0])) {
    throw new Error(`refusing ${argv.join(" ")}`);
  }
  return run(argv, { env });
}

const failed = (result) => result.error || result.status !== 0;

/** Strip an extra-workspace `:ro` suffix; a path containing `:` is otherwise taken as written. */
const mountPath = (text) => (typeof text === "string" ? text.replace(/:ro$/, "") : null);

function rowWorkspaces(row) {
  const found = [];
  const add = (value) => {
    if (typeof value === "string") found.push(mountPath(value));
    else if (value && typeof value === "object" && typeof value.path === "string") found.push(mountPath(value.path));
  };
  for (const field of ["workspace", "workspaces"]) {
    const value = row[field];
    if (Array.isArray(value)) value.forEach(add);
    else add(value);
  }
  return found;
}

function observedStatus(text) {
  const status = typeof text === "string" ? text.trim().toLowerCase() : "";
  if (status === "running") return "running";
  if (status === "stopped" || status === "exited") return "stopped";
  return "unknown";
}

/**
 * `sbx ls --json`, as a map from exact name to { status, workspaces }.
 * `available: false` when sbx cannot be run or its answer cannot be read in
 * full; then every sandbox's status is unknown. A name listed twice is
 * unknown too.
 */
export function readSandboxes(run, env = process.env) {
  let result;
  try { result = sbx(run, env, "ls"); } catch (error) { return { available: false, reason: error.message, sandboxes: new Map() }; }
  if (failed(result)) return { available: false, reason: `sbx ls failed: ${result.error?.message ?? (result.stderr.trim() || `exit ${result.status}`)}`, sandboxes: new Map() };
  let rows;
  try { rows = JSON.parse(result.stdout); } catch { return { available: false, reason: "sbx ls did not answer JSON", sandboxes: new Map() }; }
  if (!Array.isArray(rows)) return { available: false, reason: "sbx ls did not answer a JSON array", sandboxes: new Map() };
  const sandboxes = new Map();
  for (const row of rows) {
    const name = row?.name ?? row?.Name;
    if (typeof name !== "string") return { available: false, reason: "sbx ls listed a sandbox without a name", sandboxes: new Map() };
    if (sandboxes.has(name)) { sandboxes.set(name, { status: "unknown", workspaces: [], duplicate: true }); continue; }
    sandboxes.set(name, { status: observedStatus(row.status ?? row.state ?? row.Status), workspaces: rowWorkspaces(row) });
  }
  return { available: true, reason: null, sandboxes };
}

// ---------------------------------------------------------------------------
// Observation

const ownerState = (owner) => {
  const alive = liveness(owner);
  return alive === true ? "alive" : alive === false ? "dead" : "unknown";
};

/**
 * Does the record's workspace belong to its own run, and does sbx agree?
 * Returns null when ownership is proven, else the reason it is not.
 */
function workspaceProblem(entry, observed) {
  const { runDir, record } = entry;
  const canonicalRun = real(runDir);
  if (!canonicalRun) return "run directory is unreadable";
  // The run directory is reached through no link: <base>/<key>/<runId>, each a plain directory.
  const keyDir = path.dirname(runDir);
  try {
    if (lstatSync(keyDir).isSymbolicLink() || lstatSync(runDir).isSymbolicLink()) return "run directory is reached through a link; ownership unknown";
  } catch { return "run directory is unreadable"; }
  if (canonicalRun !== join(real(path.dirname(keyDir)) ?? "", record.key, record.runId)) return "run directory does not resolve inside the sandboxes area; ownership unknown";
  const expected = join(canonicalRun, WORKSPACE_DIR);
  if (!ownWorkspace(record.workspace, runDir)) return `recorded workspace ${record.workspace} is not this run's own`;
  try {
    const stats = lstatSync(expected);
    if (stats.isSymbolicLink() || !stats.isDirectory()) return `workspace ${expected} is not a plain directory`;
  } catch { /* absent: nothing of it to remove */ }
  if (observed && observed.status !== "absent") {
    if (observed.workspaces.length === 0) return "sbx reports no workspace for this sandbox; ownership unknown";
    if (!observed.workspaces.some((mount) => mount === record.workspace || mount === expected)) {
      return `sbx reports workspace ${observed.workspaces.join(", ")}, not ${record.workspace}; ownership unknown`;
    }
  }
  return null;
}

function observe(entry, listing) {
  if (!listing.available) return { status: "unknown", workspaces: [] };
  const found = listing.sandboxes.get(entry.record.sandbox);
  return found ?? { status: "absent", workspaces: [] };
}

function row(root, entry, listing) {
  const observed = observe(entry, listing);
  const { record } = entry;
  const workspace = join(real(entry.runDir) ?? entry.runDir, WORKSPACE_DIR);
  return {
    key: record.key,
    runId: record.runId,
    session: record.session,
    role: record.role,
    sandbox: record.sandbox,
    state: record.state,
    status: observed.status,
    owner: ownerState(record.owner),
    runDir: entry.runDir,
    workspace,
    workspaceExists: existsSync(workspace),
    archive: record.evidence?.archive ?? null,
    archiveDir: archiveDirectory(root, record.key, record.runId),
  };
}

/**
 * The runs Pathfinder owns, joined with `sbx ls` by exact name. A sandbox with
 * no record is never listed, whatever its name. Unreadable records are listed
 * apart, as unreadable.
 */
export function listOwned({ root, run = defaultRun, key = null, env = process.env } = {}) {
  const entries = readOwnerRecords(root, { key });
  const listing = readSandboxes(run, env);
  return {
    ok: true,
    sbx: { available: listing.available, reason: listing.reason },
    owned: entries.filter((entry) => entry.status === "ok").map((entry) => row(root, entry, listing)),
    unreadable: entries.filter((entry) => entry.status !== "ok").map(({ runDir, key: k, runId, reason }) => ({ runDir, key: k, runId, reason })),
  };
}

/**
 * Stop each recorded sandbox for `key` (and `runId`, when given) that sbx
 * reports running and whose workspace agrees with its record. Stopping keeps
 * the sandbox and its state; it never removes anything.
 */
export function stopOwned({ root, run = defaultRun, key, runId = null, env = process.env, now = new Date() } = {}) {
  if (!isKey(key)) return refuse(`\`${key}\` is not a ticket key`);
  if (runId !== null && !isRunId(runId)) return refuse(`\`${runId}\` is not a run id`);
  const entries = readOwnerRecords(root, { key }).filter((entry) => runId === null || entry.runId === runId);
  const listing = readSandboxes(run, env);
  const stopped = [];
  const skipped = [];
  for (const entry of entries) {
    if (entry.status !== "ok") { skipped.push({ runDir: entry.runDir, reason: `record unreadable: ${entry.reason}` }); continue; }
    const { record } = entry;
    const observed = observe(entry, listing);
    const base = { key: record.key, runId: record.runId, sandbox: record.sandbox };
    if (observed.status === "unknown") { skipped.push({ ...base, reason: listing.available ? "sbx status unknown" : `sbx unavailable or unreadable: ${listing.reason}` }); continue; }
    if (observed.status === "absent") { skipped.push({ ...base, reason: "sandbox is not present" }); continue; }
    const problem = workspaceProblem(entry, observed);
    if (problem) { skipped.push({ ...base, reason: problem }); continue; }
    if (observed.status === "running") {
      const result = sbx(run, env, "stop", record.sandbox);
      if (failed(result)) { skipped.push({ ...base, reason: `sbx stop failed: ${result.error?.message ?? (result.stderr.trim() || `exit ${result.status}`)}` }); continue; }
    }
    // A failed or collected run keeps its final state; only a live state records the stop.
    const update = TRANSITIONS[record.state].includes("stopped") ? updateOwnerRecord(entry.runDir, { state: "stopped" }, { from: record.state, now }) : null;
    stopped.push({ ...base, wasRunning: observed.status === "running", state: update?.ok ? "stopped" : record.state, ...(update && !update.ok ? { note: update.message } : {}) });
  }
  return { ok: true, stopped, skipped };
}

// ---------------------------------------------------------------------------
// Cleanup

/** Why this run must not be cleaned up now, or null. Unknown is never safe. */
function blocker(entry, observed, listingReason) {
  const { record } = entry;
  if (record.state === "removed") return "already removed";
  if (observed.status === "unknown") return listingReason ? `sbx unavailable or unreadable (${listingReason}); status unknown` : "sbx status unknown";
  if (observed.status === "running") return "sandbox is running";
  const owner = ownerState(record.owner);
  if (owner === "alive") return "owner process is alive";
  if (owner === "unknown") return "owner process cannot be checked";
  return workspaceProblem(entry, observed);
}

/** `base/...parts` when every component below `base` is a plain directory, never a link; else null. */
function plainDirectory(base, ...parts) {
  let current = base;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stats = lstatSync(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) return null;
    } catch { return null; }
  }
  return current;
}

/** Evidence sources inside a run, as [source, archive-relative destination]. No link is followed to find them. */
function evidenceSources(runDir) {
  const sources = [[join(runDir, OWNER_FILE), OWNER_FILE]];
  const out = plainDirectory(runDir, WORKSPACE_DIR, EXCHANGE_DIR, "out");
  if (out) sources.push([out, "out"]);
  const logs = plainDirectory(runDir, LOGS_DIR);
  if (logs) sources.push([logs, LOGS_DIR]);
  for (const name of readdirSync(runDir).sort()) if (name.endsWith(".log")) sources.push([join(runDir, name), join(LOGS_DIR, name)]);
  return sources;
}

/**
 * Preview: for each owned run, the actions an explicit cleanup would take, or
 * why it is skipped. Reads records and runs `sbx ls`; changes nothing.
 */
export function cleanupPlan({ root, run = defaultRun, key = null, env = process.env, now = new Date() } = {}) {
  if (key !== null && !isKey(key)) return refuse(`\`${key}\` is not a ticket key`);
  const entries = readOwnerRecords(root, { key });
  const listing = readSandboxes(run, env);
  const runs = [];
  const skipped = [];
  for (const entry of entries) {
    if (entry.status !== "ok") { skipped.push({ key: entry.key, runId: entry.runId, runDir: entry.runDir, reason: `record unreadable (${entry.reason}); ownership unknown` }); continue; }
    const { record } = entry;
    const observed = observe(entry, listing);
    const base = { key: record.key, runId: record.runId, runDir: entry.runDir, sandbox: record.sandbox, state: record.state, status: observed.status };
    const reason = blocker(entry, observed, listing.available ? null : listing.reason);
    if (reason) { skipped.push({ ...base, reason }); continue; }
    const workspace = join(real(entry.runDir), WORKSPACE_DIR);
    const actions = [];
    if (!FINAL.has(record.state)) actions.push({ kind: "mark-failed", reason: `interrupted: recorded ${record.state}, owner process has exited` });
    actions.push({ kind: "archive", to: archiveDirectory(root, record.key, record.runId), from: evidenceSources(entry.runDir).map(([source]) => source) });
    if (observed.status === "stopped") actions.push({ kind: "sbx-rm", sandbox: record.sandbox });
    if (existsSync(workspace)) actions.push({ kind: "remove-workspace", path: workspace });
    actions.push({ kind: "mark-removed" });
    runs.push({ ...base, actions });
  }
  return { ok: true, execute: false, root, key, at: now.toISOString(), sbx: { available: listing.available, reason: listing.reason }, runs, skipped };
}

/** Copy `source` to `target` without following any symlink; returns [copied files, skipped links]. */
function copyTree(source, target, copied, links) {
  const stats = lstatSync(source);
  if (stats.isSymbolicLink()) { links.push(source); return; }
  if (stats.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(source)) copyTree(join(source, name), join(target, name), copied, links);
    return;
  }
  if (!stats.isFile()) { links.push(source); return; }
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  if (lstatSync(target).size !== stats.size) throw new Error(`archive copy of ${source} is incomplete`);
  copied.push(target);
}

function archive(root, entry) {
  const target = archiveDirectory(root, entry.record.key, entry.record.runId);
  const base = join(root, ...ARCHIVES_DIR.split("/"));
  mkdirSync(target, { recursive: true });
  const canonicalBase = real(base);
  const canonicalTarget = real(target);
  if (!canonicalBase || !canonicalTarget || inside(canonicalBase, canonicalTarget) !== join(entry.record.key, entry.record.runId)) {
    throw new Error(`archive ${target} does not resolve inside ${ARCHIVES_DIR}`);
  }
  const copied = [];
  const links = [];
  for (const [source, destination] of evidenceSources(entry.runDir)) copyTree(source, join(canonicalTarget, destination), copied, links);
  return { path: canonicalTarget, relative: portable(path.relative(root, target)), copied, links };
}

/**
 * Delete `dir` and everything below it without following a symlink: a link is
 * unlinked, never entered. Only paths strictly inside `boundary` are touched.
 */
export function removeWithin(boundary, dir) {
  if (inside(boundary, dir) === null) throw new Error(`refusing to remove ${dir}: not inside ${boundary}`);
  const visit = (current) => {
    const stats = lstatSync(current);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      try { chmodSync(current, stats.mode | 0o700); } catch { /* removal below reports what remains */ }
      for (const name of readdirSync(current)) visit(join(current, name));
      rmdirSync(current);
      return;
    }
    if (process.platform === "win32" && !stats.isSymbolicLink()) { try { chmodSync(current, 0o666); } catch { /* best effort */ } }
    unlinkSync(current);
  };
  visit(dir);
}

/**
 * Perform a plan from `cleanupPlan`. Before each action the record and
 * `sbx ls` are read again; if the record, its state, the sandbox's status, the
 * owner's liveness or the workspace agreement differ from what this run
 * expects, the rest of that run is skipped and left as it is.
 */
export function executeCleanup(plan, { run = defaultRun, env = process.env, now = new Date() } = {}) {
  if (!plan?.ok || !Array.isArray(plan.runs)) return refuse("not a cleanup plan");
  const { root } = plan;
  const results = [];
  for (const planned of plan.runs) {
    const done = [];
    let expectedState = planned.state;
    let expectedStatus = planned.status;
    let archived = null;
    let skippedReason = null;
    for (const action of planned.actions) {
      const current = readOwnerRecord(planned.runDir);
      if (!current.ok) { skippedReason = `before ${action.kind}: record unreadable (${current.reason})`; break; }
      const entry = { runDir: planned.runDir, record: current.record };
      if (current.record.sandbox !== planned.sandbox || current.record.state !== expectedState) {
        skippedReason = `before ${action.kind}: record changed since the plan (state ${current.record.state}, expected ${expectedState})`;
        break;
      }
      const listing = readSandboxes(run, env);
      const observed = observe(entry, listing);
      if (observed.status !== expectedStatus) {
        skippedReason = `before ${action.kind}: sandbox is ${observed.status}${listing.available ? "" : ` (${listing.reason})`}, expected ${expectedStatus}`;
        break;
      }
      const reason = blocker(entry, observed, listing.available ? null : listing.reason);
      if (reason) { skippedReason = `before ${action.kind}: ${reason}`; break; }
      try {
        if (action.kind === "mark-failed") {
          const update = updateOwnerRecord(planned.runDir, { state: "failed" }, { from: expectedState, now });
          if (!update.ok) { skippedReason = `mark-failed: ${update.message}`; break; }
          expectedState = "failed";
        } else if (action.kind === "archive") {
          archived = archive(root, entry);
        } else if (action.kind === "sbx-rm") {
          if (!archived) { skippedReason = "sbx-rm: evidence is not archived"; break; }
          const result = sbx(run, env, "rm", planned.sandbox);
          if (failed(result)) { skippedReason = `sbx rm failed: ${result.error?.message ?? (result.stderr.trim() || `exit ${result.status}`)}`; break; }
          expectedStatus = "absent";
        } else if (action.kind === "remove-workspace") {
          if (!archived) { skippedReason = "remove-workspace: evidence is not archived"; break; }
          const canonicalRun = real(planned.runDir);
          const workspace = join(canonicalRun, WORKSPACE_DIR);
          if (workspace !== action.path) { skippedReason = `remove-workspace: workspace is ${workspace}, planned ${action.path}`; break; }
          removeWithin(canonicalRun, workspace);
        } else if (action.kind === "mark-removed") {
          if (!archived) { skippedReason = "mark-removed: evidence is not archived"; break; }
          const update = updateOwnerRecord(planned.runDir, { state: "removed", evidence: { ...(current.record.evidence ?? {}), archive: archived.relative } }, { from: expectedState, now });
          if (!update.ok) { skippedReason = `mark-removed: ${update.message}`; break; }
          expectedState = "removed";
        } else {
          skippedReason = `unknown action ${action.kind}`;
          break;
        }
      } catch (error) {
        skippedReason = `${action.kind} failed: ${error.message}`;
        break;
      }
      done.push(action.kind);
    }
    results.push({
      key: planned.key,
      runId: planned.runId,
      sandbox: planned.sandbox,
      done,
      ...(archived ? { archive: archived.relative, archivedFiles: archived.copied.length, linksNotFollowed: archived.links } : {}),
      ...(skippedReason ? { skipped: skippedReason } : {}),
    });
  }
  return { ok: true, execute: true, results, skipped: plan.skipped ?? [] };
}
