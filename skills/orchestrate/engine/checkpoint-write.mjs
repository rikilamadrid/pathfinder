/** One short synchronous transaction for every current-ticket writer.
 * No waiting, retries, timeout stealing or async work. A busy/nested writer
 * refuses explicitly. Unknown ownership requires human reconciliation.
 */
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";

const problem = (message) => Object.assign(new Error(message), { code: "CHECKPOINT_CONFLICT" });
export const checkpointOwner = () => ({ pid: process.pid, host: hostname() });
export function ownerAlive(owner) {
  if (!owner || Object.keys(owner).sort().join() !== "host,pid" || owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) return null;
  try { process.kill(owner.pid, 0); return true; } catch (e) { return e.code === "ESRCH" ? false : null; }
}
function paths(path) {
  // Resolve the existing directory, not the replaceable file inode; aliases
  // and all writers therefore share the same identity before/after a rename.
  const file = join(realpathSync(dirname(resolve(path))), "current-ticket.md");
  if (resolve(path).split(/[\\/]/).at(-1) !== "current-ticket.md") throw problem("not a current-ticket checkpoint");
  const area = join(dirname(dirname(file)), ".pathfinder", "checkpoint-writes");
  mkdirSync(area, { recursive: true });
  return { file, area, lock: join(area, createHash("sha256").update(file).digest("hex") + ".lock") };
}
export function atomicCheckpointWrite(path, text, tempDir = dirname(path)) {
  const temp = join(tempDir, `checkpoint-write-${randomUUID()}`);
  let fd;
  try {
    fd = openSync(temp, "wx", 0o600); writeFileSync(fd, text); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temp, path);
    const dir = openSync(dirname(path), "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
  } finally { if (fd !== undefined) closeSync(fd); if (existsSync(temp)) rmSync(temp); }
}
function retire(p) {
  const retired = join(p.area, `retired-${randomUUID()}`);
  renameSync(p.lock, retired); rmSync(retired, { recursive: true });
}
/** mutate(latest) returns {text, value}; omitting text performs no write.
 * Callers must only compute a local mutation here, never invoke arbitrary work.
 * Nested calls refuse because the first transaction already owns this path.
 */
export function mutateCheckpoint(path, mutate) {
  if (mutate?.constructor?.name === "AsyncFunction") throw problem("checkpoint mutation must be synchronous");
  const p = paths(path);
  try { mkdirSync(p.lock); } catch { throw problem("checkpoint busy or interrupted; no write performed"); }
  let owned = false;
  try {
    atomicCheckpointWrite(join(p.lock, "owner.json"), JSON.stringify(checkpointOwner()), p.area); owned = true;
    const latest = existsSync(p.file) ? readFileSync(p.file, "utf8") : null;
    const change = mutate(latest);
    if (!change || typeof change !== "object" || typeof change.then === "function" || (change.text !== undefined && typeof change.text !== "string")) throw problem("checkpoint mutation must be synchronous");
    if (change.text !== undefined && change.text !== latest) atomicCheckpointWrite(p.file, change.text, p.area);
    return change.value;
  } finally { if (owned) retire(p); }
}
/** Existing section writers may prepare outside the mutex. Refuse a stale base
 * instead of replaying that prepared mutation against different evidence. */
export function replaceCheckpoint(path, expected, replace) {
  return mutateCheckpoint(path, (latest) => {
    if (latest !== expected) throw problem("checkpoint changed during preparation; explicit retry required");
    return { text: replace(latest) };
  });
}
/** Explicit recovery only. Owner PID reuse or another host stays conservative.
 * Recovery is serialized inside the existing lock; the old directory is renamed
 * away before cleanup, so a new writer's lock is never removed by cleanup.
 */
export function recoverCheckpointLock(path, authorization) {
  if (!authorization || authorization.by !== "human" || authorization.kind !== "recover-checkpoint-lock" || typeof authorization.direction !== "string" || !authorization.direction.trim()) return { ok: false, reason: "authorization-required" };
  let p, recovery, recoveryInode;
  try {
    p = paths(path);
    if (!existsSync(p.lock)) return { ok: true, recovered: false };
    recovery = join(p.lock, "recovery"); mkdirSync(recovery); recoveryInode = lstatSync(recovery).ino;
    const live = ownerAlive(JSON.parse(readFileSync(join(p.lock, "owner.json"), "utf8")));
    if (live !== false) return { ok: false, reason: live ? "live-lock-owner" : "unknown-lock-owner" };
    retire(p); recovery = null;
    return { ok: true, recovered: true };
  } catch { return { ok: false, reason: "unknown-lock-owner" }; }
  finally {
    if (recovery) try { if (lstatSync(recovery).ino === recoveryInode) rmdirSync(recovery); } catch { /* Owner may have released it. No inferred ownership. */ }
  }
}
