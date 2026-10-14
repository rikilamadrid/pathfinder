/**
 * Managed scratch runs for review sessions.
 *
 * A review run is a directory under `.pathfinder/scratch/<ticket>/` — ignored,
 * discoverable, and outside every harness's private temporary area — holding
 * the trees one Adversary or Tester round builds and every log, report, patch
 * and screenshot it writes. Its `run.json` records the ticket, role, exact
 * head, session, and the owning process, so cleanup can tell a live run from
 * an interrupted one.
 *
 * Only rebuildable directories are ever reclaimed: a `node_modules` this
 * engine materialized or npm installed, and a Next.js `.next` build directory
 * beside a package.json. Evidence is never removed. Reclaiming happens:
 *
 *   - when the run's owner records its checkpoint successfully (`scratch done`,
 *     or a checkpoint written with PATHFINDER_SCRATCH_RUN naming the run);
 *   - by `scratch prune --execute`, which is a dry run without that flag, for
 *     checkpointed runs, and for interrupted or failed runs only when the human
 *     passes --include-preserved.
 *
 * A run whose owner is alive, or cannot be checked, is never touched.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { basename, join, sep } from "node:path";
import { atomicCheckpointWrite, ownerAlive } from "./checkpoint-write.mjs";
import { DEPS_DIR, removeTree } from "./deps.mjs";
import { diskCheck, floorGate } from "./disk.mjs";
import { isIgnored } from "./git.mjs";
import { isKey } from "./keys.mjs";

export const SCRATCH_DIR = ".pathfinder/scratch";
const SCHEMA = "pathfinder.scratch-run/1";
export const ROLES = Object.freeze(["developer", "adversary", "tester", "integrator"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish", "ksh", "tcsh", "csh", "env", "timeout", "nohup", "xargs"]);
const refuse = (message) => ({ ok: false, message });

/** Scratch runs live under `.pathfinder/`, which must be ignored like the worktrees. */
export function scratchRefusal(root) {
  if (!isIgnored(root, `${SCRATCH_DIR}/run.json`)) return "`.pathfinder/` is not ignored by Git; add `/.pathfinder/` to .gitignore before creating scratch runs";
  return null;
}

function processInfo(pid) {
  if (process.platform === "win32") return null;
  const result = spawnSync("ps", ["-o", "ppid=", "-o", "comm=", "-p", String(pid)], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(result.stdout);
  return match ? { ppid: Number(match[1]), command: basename(match[2]) } : null;
}

/**
 * The long-lived process that owns this run: the nearest ancestor that is not
 * a shell or wrapper. The engine CLI and the shell a harness spawns for one
 * command both exit at once; the harness session outlives them.
 */
export function findOwner(start = process.ppid) {
  let pid = start;
  for (let depth = 0; depth < 12 && pid > 1; depth += 1) {
    const info = processInfo(pid);
    if (!info) break;
    if (!SHELLS.has(info.command.replace(/^-/, ""))) return { pid, host: hostname(), command: info.command };
    pid = info.ppid;
  }
  return { pid: start, host: hostname(), command: processInfo(start)?.command ?? null };
}

/** Is the run's owner this process or one of its ancestors? */
export function callerOwns(owner, start = process.pid) {
  if (owner?.host !== hostname()) return false;
  let pid = start;
  for (let depth = 0; depth < 16 && pid > 1; depth += 1) {
    if (pid === owner.pid) return true;
    const info = processInfo(pid);
    if (!info) return false;
    pid = info.ppid;
  }
  return false;
}

/** true, false, or null when this host cannot tell. A reused pid running another command is not the owner. */
export function ownerLiveness(owner) {
  const alive = ownerAlive({ pid: owner?.pid, host: owner?.host });
  if (alive !== true || !owner.command) return alive;
  const info = processInfo(owner.pid);
  if (!info) return null;
  return info.command === owner.command;
}

function scratchBase(root) {
  return join(root, ...SCRATCH_DIR.split("/"));
}

/** The canonical run directory, refused unless it is a run inside this root's scratch area. */
export function resolveRun(root, runDir) {
  let real;
  let base;
  try { real = realpathSync(runDir); base = realpathSync(scratchBase(root)); } catch { return refuse(`${runDir} is not a scratch run`); }
  if (!real.startsWith(base + sep) || real.slice(base.length + 1).split(sep).length !== 2) return refuse(`${runDir} is not a run directory under ${SCRATCH_DIR}/<ticket>/`);
  if (lstatSync(runDir).isSymbolicLink()) return refuse(`${runDir} is a symlink; name the run directory itself`);
  const run = readRun(real);
  if (!run) return refuse(`${real}/run.json is missing or invalid; the run is left untouched`);
  return { ok: true, path: real, run };
}

export function readRun(dir) {
  try {
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
    return run?.schema === SCHEMA && isKey(run.ticket) && ROLES.includes(run.role) ? run : null;
  } catch {
    return null;
  }
}

function writeRun(dir, run) {
  atomicCheckpointWrite(join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n");
}

/** active, interrupted, checkpointed, or failed. An unknown owner counts as active. */
export function runStatus(run) {
  if (run.state !== "active") return run.state;
  return ownerLiveness(run.owner) === false ? "interrupted" : "active";
}

/**
 * Start a run. Refused below the disk floor unless `approval` names the
 * human's explicit permission, which the run then records.
 */
export function createRun({ root, ticket, role, head, session = null, ownerPid = null, approval = null, env = process.env, now = new Date() }) {
  const refusal = scratchRefusal(root);
  if (refusal) return refuse(refusal);
  if (!isKey(ticket)) return refuse(`\`${ticket}\` is not a ticket key`);
  if (!ROLES.includes(role)) return refuse(`--role must be one of ${ROLES.join(", ")}`);
  if (!/^[0-9a-f]{7,64}$/.test(head ?? "")) return refuse("--head must be the exact commit the run reviews");
  const gate = floorGate(diskCheck({ root, env }), approval);
  if (!gate.ok) return refuse(gate.message);
  const owner = ownerPid ? { pid: ownerPid, host: hostname(), command: processInfo(ownerPid)?.command ?? null } : findOwner();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const dir = join(scratchBase(root), ticket, `${role}-${head.slice(0, 7)}-${stamp}-${randomUUID().slice(0, 4)}`);
  mkdirSync(dir, { recursive: true });
  const run = { schema: SCHEMA, ticket, role, head, session, owner, createdAt: now.toISOString(), state: "active", diskOverride: gate.override, trees: [], reclaimed: [] };
  writeRun(dir, run);
  return { ok: true, path: dir, run, disk: gate.check };
}

/** Record a materialized tree on its run. */
export function recordTree(dir, tree) {
  const run = readRun(dir);
  run.trees.push(tree);
  writeRun(dir, run);
}

/**
 * Directories under a run that are safe to rebuild: engine- or npm-made
 * node_modules, and `.next` beside a package.json. Never follows a symlink,
 * never descends into a target, and reports what it preserves and why.
 */
export function rebuildable(dir, run) {
  const recorded = new Set((run?.trees ?? []).map((tree) => join(dir, tree.tree, "node_modules")));
  const targets = [];
  const preserved = [];
  const visit = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const stats = lstatSync(path);
      if (!stats.isDirectory()) continue;
      if (name === "node_modules") {
        if (recorded.has(path) || existsSync(join(path, ".package-lock.json"))) targets.push(path);
        else preserved.push({ path, reason: "not made by this engine or npm" });
      } else if (name === ".next") {
        if (existsSync(join(current, "package.json"))) targets.push(path);
        else preserved.push({ path, reason: "no package.json beside it" });
      } else visit(path);
    }
  };
  visit(dir);
  return { targets, preserved };
}

/** Bytes the files under `dir` claim, clones counted in full: an upper bound, not physical use. */
export function logicalBytes(dir) {
  let total = 0;
  const visit = (current) => {
    for (const name of readdirSync(current)) {
      const stats = lstatSync(join(current, name));
      total += stats.blocks * 512;
      if (stats.isDirectory()) visit(join(current, name));
    }
  };
  try { visit(dir); } catch { /* best effort */ }
  return total;
}

function reclaim(dir, run, reason, now) {
  const { targets, preserved } = rebuildable(dir, run);
  const removed = [];
  const failed = [];
  for (const target of targets) {
    try { removeTree(target); removed.push(target.slice(dir.length + 1)); } catch (error) { failed.push({ path: target, reason: error.message }); }
  }
  const latest = readRun(dir);
  latest.reclaimed.push(...removed.map((path) => ({ path, reason, at: now.toISOString() })));
  if (reason === "checkpoint" && latest.state === "active") { latest.state = "checkpointed"; latest.checkpointedAt = now.toISOString(); }
  writeRun(dir, latest);
  return { removed, preserved, failed };
}

/**
 * The run's owner recorded its checkpoint: reclaim its rebuildable trees and
 * keep everything else. `ticket`, when given, must be the run's ticket.
 */
export function finishRun({ root, runDir, ticket = null, now = new Date() }) {
  const found = resolveRun(root, runDir);
  if (!found.ok) return found;
  if (ticket && found.run.ticket !== ticket) return refuse(`run ${found.path} is for ${found.run.ticket}, not ${ticket}; nothing was reclaimed`);
  if (found.run.state === "failed") return refuse(`run ${found.path} is marked failed and is preserved`);
  if (runStatus(found.run) === "active" && !callerOwns(found.run.owner)) return refuse(`run ${found.path} belongs to live process ${found.run.owner.pid}, not this session; nothing was reclaimed`);
  return { ok: true, path: found.path, ...reclaim(found.path, found.run, "checkpoint", now) };
}

/**
 * After a checkpoint is written, reclaim the review run named by
 * PATHFINDER_SCRATCH_RUN. The checkpoint already stands; a refusal here is
 * reported and changes nothing else.
 */
export function reclaimAfterCheckpoint(root, ticket, runDir = process.env.PATHFINDER_SCRATCH_RUN) {
  if (!runDir) return null;
  const result = finishRun({ root, runDir, ticket });
  if (result.ok) console.log(`Scratch run reclaimed: ${result.removed.length} rebuildable director${result.removed.length === 1 ? "y" : "ies"}; evidence kept.`);
  else console.error(`scratch: ${result.message}`);
  return result;
}

/** Preserve a run whose checkpoint failed: nothing is reclaimed automatically. */
export function failRun({ root, runDir, now = new Date() }) {
  const found = resolveRun(root, runDir);
  if (!found.ok) return found;
  writeRun(found.path, { ...found.run, state: "failed", failedAt: now.toISOString() });
  return { ok: true, path: found.path };
}

export function listRuns(root) {
  const base = scratchBase(root);
  const runs = [];
  if (!existsSync(base)) return runs;
  for (const ticket of readdirSync(base)) {
    const ticketDir = join(base, ticket);
    if (!lstatSync(ticketDir).isDirectory()) continue;
    for (const name of readdirSync(ticketDir)) {
      const dir = join(ticketDir, name);
      if (!lstatSync(dir).isDirectory()) continue;
      const run = readRun(dir);
      runs.push({ path: dir, run, status: run ? runStatus(run) : "invalid" });
    }
  }
  return runs;
}

const ownerOf = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };

/** Abandoned cache work: temporaries and locks whose owner is dead. Complete entries are kept unless `cache`. */
function cachePlan(root, { cache, olderThanMs, now, liveKeys }) {
  const base = join(root, ...DEPS_DIR.split("/"));
  const plan = [];
  if (!existsSync(base)) return plan;
  for (const name of readdirSync(base)) {
    const path = join(base, name);
    const age = now - statSync(path).mtimeMs;
    if (name.includes(".lock.stale-")) plan.push({ path, kind: "retired lock" });
    else if (name.startsWith(".tmp-") || name.endsWith(".lock")) {
      const owner = ownerOf(join(path, "owner.json"));
      const alive = owner ? ownerAlive(owner) : age > 60_000 ? false : null;
      if (alive === false) plan.push({ path, kind: name.endsWith(".lock") ? "stale lock" : "abandoned install" });
    } else if (cache && /^[0-9a-f]{32}$/.test(name) && !liveKeys.has(name)) {
      const used = existsSync(`${path}.used`) ? statSync(`${path}.used`).mtimeMs : statSync(path).mtimeMs;
      if (now - used > olderThanMs) plan.push({ path, kind: "unused cache entry", alsoRemove: `${path}.used` });
    }
  }
  return plan;
}

/**
 * Plan, and with `execute` perform, scratch reclamation.
 *
 * Checkpointed runs lose any rebuildable leftovers. Interrupted and failed
 * runs are preserved unless `includePreserved`, and even then only once older
 * than `olderThanMs`, and only their rebuildable trees. Active runs, invalid
 * runs and anything unrecognised are never touched.
 */
export function pruneScratch({ root, olderThanMs = 24 * 3_600_000, includePreserved = false, cache = false, execute = false, now = Date.now() }) {
  const refusal = scratchRefusal(root);
  if (refusal) return refuse(refusal);
  const runs = listRuns(root);
  const liveKeys = new Set(runs.filter((entry) => entry.status === "active").flatMap((entry) => entry.run.trees.map((tree) => tree.key)));
  const actions = [];
  const kept = [];
  for (const entry of runs) {
    if (!entry.run) { kept.push({ path: entry.path, reason: "invalid or foreign run.json; left untouched" }); continue; }
    const age = now - Date.parse(entry.run.createdAt);
    if (entry.status === "active") { kept.push({ path: entry.path, reason: "owner is alive or cannot be checked" }); continue; }
    if (entry.status !== "checkpointed") {
      if (!includePreserved) { kept.push({ path: entry.path, reason: `${entry.status}; preserved (pass --include-preserved to reclaim its dependencies)` }); continue; }
      if (!(age > olderThanMs)) { kept.push({ path: entry.path, reason: `${entry.status}; younger than the --older-than threshold` }); continue; }
    }
    const { targets } = rebuildable(entry.path, entry.run);
    if (targets.length) actions.push({ kind: "run", path: entry.path, status: entry.status, targets });
  }
  for (const item of cachePlan(root, { cache, olderThanMs, now, liveKeys })) actions.push({ ...item, targets: [item.path] });
  const results = [];
  if (execute) {
    for (const action of actions) {
      if (action.kind === "run") {
        const run = readRun(action.path);
        if (!run || (run.state === "active" && runStatus(run) !== "interrupted")) { results.push({ path: action.path, skipped: "state changed since planning" }); continue; }
        results.push({ path: action.path, ...reclaim(action.path, run, `prune:${action.status}`, new Date(now)) });
      } else {
        removeTree(action.path);
        if (action.alsoRemove) rmSync(action.alsoRemove, { force: true });
        results.push({ path: action.path, removed: [action.path] });
      }
    }
  }
  return { ok: true, execute, actions, kept, results };
}

/** Parse `24h`, `30m`, `2d`, or `0`. */
export function parseDuration(text) {
  const match = /^(\d+)([smhd]?)$/.exec(String(text ?? "").trim());
  if (!match) return null;
  return Number(match[1]) * { "": 1000, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
}
