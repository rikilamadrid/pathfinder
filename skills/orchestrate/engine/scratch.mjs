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

import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import path, { join } from "node:path";
import { atomicCheckpointWrite } from "./checkpoint-write.mjs";
import { DEPS_DIR, removeTree, retireStaleLock, unpublish } from "./deps.mjs";
import { diskCheck, floorGate } from "./disk.mjs";
import { isIgnored } from "./git.mjs";
import { isKey } from "./keys.mjs";
import { callerOwns, findOwner, liveness, ownerRecord, processChain } from "./process.mjs";

export const SCRATCH_DIR = ".pathfinder/scratch";
const SCHEMA = "pathfinder.scratch-run/1";
export const ROLES = Object.freeze(["developer", "adversary", "tester", "integrator"]);
const refuse = (message) => ({ ok: false, message });

/** Scratch runs live under `.pathfinder/`, which must be ignored like the worktrees. */
export function scratchRefusal(root) {
  if (!isIgnored(root, `${SCRATCH_DIR}/run.json`)) return "`.pathfinder/` is not ignored by Git; add `/.pathfinder/` to .gitignore before creating scratch runs";
  return null;
}

/**
 * `child` relative to `parent` when it lies strictly inside it, else null.
 * Both must be canonical (`real`): the filesystem, not the platform, decides
 * case, so a case-sensitive APFS or Windows directory keeps distinct names
 * distinct. Windows separators and drive letters go through path.win32.
 */
export function within(parent, child, platform = process.platform) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const rel = p.relative(parent, child);
  if (!rel || rel.startsWith("..") || p.isAbsolute(rel)) return null;
  return rel;
}

/** The canonical spelling of an existing path, in the filesystem's own case. */
export const real = (target) => realpathSync.native(target);

function scratchBase(root) {
  return join(root, ...SCRATCH_DIR.split("/"));
}

/** The canonical run directory, refused unless it is a run inside this root's scratch area. */
export function resolveRun(root, runDir) {
  let canonicalRun;
  let base;
  try { canonicalRun = real(runDir); base = real(scratchBase(root)); } catch { return refuse(`${runDir} is not a scratch run`); }
  const rel = within(base, canonicalRun);
  if (rel === null || rel.split(/[\\/]/).length !== 2) return refuse(`${runDir} is not a run directory under ${SCRATCH_DIR}/<ticket>/`);
  if (lstatSync(runDir).isSymbolicLink()) return refuse(`${runDir} is a symlink or junction; name the run directory itself`);
  const run = readRun(canonicalRun);
  if (!run) return refuse(`${join(canonicalRun, "run.json")} is missing or invalid; the run is left untouched`);
  return { ok: true, path: canonicalRun, run };
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
  return liveness(run.owner) === false ? "interrupted" : "active";
}

/**
 * May this caller change a run it did not necessarily create? Only its owner
 * (this process or an ancestor), and anyone once the owner is provably dead.
 * A recorded session must match too: one harness process can host several
 * sessions, and its pid alone cannot tell them apart.
 */
export function ownerRefusal(found, session) {
  const { run, path } = found;
  if (run.session && session !== run.session) return `run ${path} was started for another session; pass the --session it was created with`;
  if (liveness(run.owner) === false) return null;
  if (!run.session) return `run ${path} records no session; it can be changed only once its owner has exited`;
  const owns = callerOwns(run.owner);
  // Without readable ancestry here, the session matched above is the only
  // evidence of ownership; every run records one.
  if (owns === true || (owns === null && run.session)) return null;
  return `run ${path} belongs to live process ${run.owner?.pid}, not this session; nothing was changed`;
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
  const owner = ownerPid ? ownerRecord(ownerPid, processChain(ownerPid, { depth: 1 })[0]?.command ?? null) : findOwner();
  if (!owner) return refuse("cannot read this process's ancestry here (no `ps` or PowerShell answer); pass --owner-pid naming the long-lived session process that owns the run");
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const dir = join(scratchBase(root), ticket, `${role}-${head.slice(0, 7)}-${stamp}-${randomUUID().slice(0, 4)}`);
  mkdirSync(dir, { recursive: true });
  // Every run has a session: one harness process hosts many sessions, so the
  // pid alone cannot tell them apart. Unless the caller names a unique one,
  // the engine mints it and the caller passes it back on deps, done and fail.
  const run = { schema: SCHEMA, ticket, role, head, session: session || `s-${randomUUID().replace(/-/g, "").slice(0, 16)}`, owner, createdAt: now.toISOString(), state: "active", diskOverride: gate.override, trees: [], reclaimed: [] };
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
export function finishRun({ root, runDir, ticket = null, session = null, now = new Date() }) {
  const found = resolveRun(root, runDir);
  if (!found.ok) return found;
  if (ticket && found.run.ticket !== ticket) return refuse(`run ${found.path} is for ${found.run.ticket}, not ${ticket}; nothing was reclaimed`);
  if (found.run.state === "failed") return refuse(`run ${found.path} is marked failed and is preserved`);
  const refusal = ownerRefusal(found, session);
  if (refusal) return refuse(refusal);
  return { ok: true, path: found.path, ...reclaim(found.path, found.run, "checkpoint", now) };
}

/**
 * After a checkpoint is written, reclaim the review run named by
 * PATHFINDER_SCRATCH_RUN, for the session in PATHFINDER_SCRATCH_SESSION when
 * the run recorded one. The checkpoint already stands; a refusal here is
 * reported and changes nothing else.
 */
export function reclaimAfterCheckpoint(root, ticket, runDir = process.env.PATHFINDER_SCRATCH_RUN) {
  if (!runDir) return null;
  let result;
  try { result = finishRun({ root, runDir, ticket, session: process.env.PATHFINDER_SCRATCH_SESSION || null }); } catch (error) { result = refuse(`reclaim failed after the checkpoint was written: ${error.message}`); }
  if (result.ok) console.log(`Scratch run reclaimed: ${result.removed.length} rebuildable director${result.removed.length === 1 ? "y" : "ies"}; evidence kept.`);
  else console.error(`scratch: ${result.message}`);
  return result;
}

/** Preserve a run whose checkpoint failed: nothing is reclaimed automatically. */
export function failRun({ root, runDir, session = null, now = new Date() }) {
  const found = resolveRun(root, runDir);
  if (!found.ok) return found;
  const refusal = ownerRefusal(found, session);
  if (refusal) return refuse(refusal);
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
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) continue;
    const age = now - stats.mtimeMs;
    if (name.includes(".lock.stale-")) plan.push({ path, kind: "retired lock" });
    else if (name.endsWith(".lock.break") && age > 60_000) plan.push({ path, kind: "abandoned lock breaker" });
    else if (name.startsWith(".trash-")) plan.push({ path, kind: "unpublished entry" });
    else if (name.startsWith(".tmp-") || name.endsWith(".lock")) {
      const owner = ownerOf(join(path, "owner.json"));
      const alive = owner ? liveness(owner) : age > 60_000 ? false : null;
      if (alive === false) plan.push({ path, kind: name.endsWith(".lock") ? "stale lock" : "abandoned install" });
    } else if (cache && /^[0-9a-f]{32}$/.test(name) && !liveKeys.has(name)) {
      const used = existsSync(`${path}.used`) ? statSync(`${path}.used`).mtimeMs : statSync(path).mtimeMs;
      if (now - used > olderThanMs) plan.push({ path, kind: "unused cache entry", key: name });
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
    if (liveness(entry.run.owner) !== false) { kept.push({ path: entry.path, reason: `${entry.status}; owner is alive or cannot be checked` }); continue; }
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
        if (!run || liveness(run.owner) !== false) { results.push({ path: action.path, skipped: "owner alive or unknown at execution" }); continue; }
        results.push({ path: action.path, ...reclaim(action.path, run, `prune:${action.status}`, new Date(now)) });
      } else if (action.kind === "stale lock") {
        results.push(retireStaleLock(action.path) ? { path: action.path, removed: [action.path] } : { path: action.path, skipped: "no longer stale at execution" });
      } else if (action.key) {
        const removed = unpublish({ root, key: action.key });
        results.push(removed.ok ? { path: action.path, removed: [action.path] } : { path: action.path, skipped: removed.message });
      } else {
        removeTree(action.path);
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
