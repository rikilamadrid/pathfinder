/** Routing-only local transactions. No adapter import, network, activation or stage writes.
 * The explicit caller supplies fresh local inputs and (separately) call consent.
 * Human authorization objects are assertions by that trusted caller, not credentials.
 * Checkpoint hashes detect corruption; they do not authenticate a hostile filesystem.
 */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { exactObject, PROVENANCE_SCHEMA, ROUTING_CONTRACT, serializeRoutingFingerprintInput, validateRoutingAssessment } from "./routing-contract.mjs";
import { prepareRouting, validateRoutingProjection } from "./routing-projection.mjs";
import { recommendRouting, ROUTING_FAILURES, ROUTING_POLICY, routingEligibility } from "./routing-policy.mjs";

export const ROUTING_RECORD_SCHEMA = "pathfinder.routing-record/1";
export const DEFAULT_ROUTING_ALLOWANCE = 2;
export const MAX_ROUTING_ATTEMPTS = 100;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const HEADING = /^## Routing assessments[ \t]*\r?$/gm;
const MARKER_SCHEMA = "pathfinder.routing-established/1";
const refuse = (reason) => ({ ok: false, recommendation: "human", reason });
const hash = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const freeze = (v) => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const snapshot = (v) => freeze(structuredClone(v));
const number = (n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_ROUTING_ATTEMPTS;
const text = (s) => typeof s === "string" && s.trim() !== "" && s.length <= 1024;
const uuid = (s) => typeof s === "string" && /^[a-f0-9-]{36}$/.test(s);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const spent = (r) => r.prior_consumed + r.attempts.length;
const paths = (worktree) => {
  const path = join(worktree, "context", "current-ticket.md");
  const local = join(worktree, ".pathfinder", "routing");
  return { path, marker: join(local, "established.json"), lock: join(local, "lock"), guard: join(local, "ownership-lock") };
};

/** All semantic inputs, including local originals' digests, bind cache identity. */
export function routingFingerprint(input) {
  if (!validateRoutingProjection(input.projection).ok) throw new Error("invalid routing projection");
  const p = input.preparation;
  const derived = { schema: input.projection.schema, concern: p.concern.summary,
    requirements: p.requirements.map(({ id, summary }) => ({ id, summary })),
    evidence: p.evidence.map(({ id, role, action, observation }) => ({ id, role, action, observation })) };
  if (!equal(derived, input.projection)) throw new Error("projection does not match preparation");
  return hash(serializeRoutingFingerprintInput(input));
}

function validRecord(r) {
  try {
    if (!exactObject(r, ["schema", "ticket", "establishment", "allowance", "prior_consumed", "grants", "preparation", "attempts"]) || r.schema !== ROUTING_RECORD_SCHEMA || typeof r.ticket !== "string" || !/^\d+\.\d+$/.test(r.ticket) || !uuid(r.establishment) || !number(r.allowance) || !number(r.prior_consumed) || !Array.isArray(r.grants) || !r.grants.length || r.grants.length > MAX_ROUTING_ATTEMPTS || !Array.isArray(r.attempts) || spent(r) > r.allowance) return false;
    if (!r.grants.every((g) => exactObject(g, ["kind", "direction", "allowance"]) && ["initialize", "extend", "reconcile"].includes(g.kind) && text(g.direction) && number(g.allowance))) return false;
    if (r.grants.at(-1).allowance !== r.allowance || r.grants.some((g, i) => i > 0 && g.allowance < r.grants[i - 1].allowance)) return false;
    if (r.preparation !== null && (r.preparation.preparation.identity.ticket !== r.ticket || !routingFingerprint(r.preparation))) return false;
    const ids = new Set();
    for (const a of r.attempts) {
      if (!exactObject(a, ["id", "fingerprint", "input", "status", "assessment", "failure"]) || !uuid(a.id) || ids.has(a.id) || a.input.preparation.identity.ticket !== r.ticket || a.fingerprint !== routingFingerprint(a.input)) return false;
      ids.add(a.id);
      if (a.status === "reserved") { if (a.assessment !== null || a.failure !== null) return false; }
      else if (a.status === "failed") { if (a.assessment !== null || ![...ROUTING_FAILURES, "interrupted", "stale-state"].includes(a.failure)) return false; }
      else if (a.status === "assessed") { if (a.failure !== null || !validateRoutingAssessment(a.assessment, a.input.projection.evidence.map((e) => e.id)).ok) return false; }
      else return false;
    }
    return Buffer.byteLength(JSON.stringify(r)) <= MAX_RECORD_BYTES;
  } catch { return false; }
}

function section(checkpoint) {
  const matches = [...checkpoint.matchAll(HEADING)];
  if (matches.length > 1) throw new Error("duplicate routing sections");
  if (!matches.length) return null;
  const start = matches[0].index, after = start + matches[0][0].length;
  const next = checkpoint.slice(after).search(/^## /m);
  return { start, end: next < 0 ? checkpoint.length : after + next };
}
export function readRoutingRecord(checkpoint) {
  try {
    const span = section(checkpoint);
    if (!span) return refuse("missing-budget");
    const block = /^## Routing assessments[ \t]*\r?\n\r?\n```json\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n)*$/.exec(checkpoint.slice(span.start, span.end));
    if (!block || Buffer.byteLength(block[1]) > MAX_RECORD_BYTES) return refuse("corrupt-budget");
    const record = JSON.parse(block[1]);
    return validRecord(record) ? { ok: true, record } : refuse("corrupt-budget");
  } catch { return refuse("corrupt-budget"); }
}
export function replaceRoutingRecord(checkpoint, record) {
  if (!validRecord(record)) throw new Error("invalid routing record");
  const span = section(checkpoint), eol = checkpoint.includes("\r\n") ? "\r\n" : "\n";
  const rendered = ["## Routing assessments", "", "```json", JSON.stringify(record), "```", ""].join(eol);
  if (!span) return `${checkpoint}${checkpoint.endsWith(eol) ? eol : eol + eol}${rendered}`;
  // Preserve the exact separator preceding the next unrelated section.
  const suffix = checkpoint.slice(span.start, span.end).match(/(?:\r?\n)*$/)[0];
  return checkpoint.slice(0, span.start) + rendered.replace(/(?:\r?\n)*$/, suffix) + checkpoint.slice(span.end);
}

// Atomic replacement + fsync both file and directory before returning. An owner
// crash leaves the exclusive lock in place: never automatically steal it or refund.
function durableWrite(path, content, tempDir = dirname(path)) {
  const temp = join(tempDir, `routing-write-${randomUUID()}`);
  let fd;
  try {
    fd = openSync(temp, "wx", 0o600); writeFileSync(fd, content); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temp, path);
    const dir = openSync(dirname(path), "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
  } finally { if (fd !== undefined) closeSync(fd); if (existsSync(temp)) rmSync(temp); }
}
// A short ownership mutex also serializes explicit dead-owner recovery against
// a new acquisition. An interrupted/unknown mutex is never automatically stolen.
function ownership(p) {
  try { mkdirSync(dirname(p.lock), { recursive: true }); mkdirSync(p.guard); return true; }
  catch { return false; }
}
function acquire(p) {
  if (!ownership(p)) return false;
  try {
    try { mkdirSync(p.lock); } catch { return false; }
    durableWrite(join(p.lock, "owner.json"), JSON.stringify({ pid: process.pid }));
    return true;
  } catch { return false; } // Leave uncertain ownership for explicit reconciliation.
  finally { rmSync(p.guard, { recursive: true }); }
}
function release(p) { rmSync(p.lock, { recursive: true }); }
function checkpoint(p, ticket) {
  const value = readFileSync(p.path, "utf8");
  const workers = [...value.matchAll(/^- Worker:[ \t]*(.*)\r?$/gm)];
  if (workers.length !== 1 || workers[0][1].trim() !== ticket) throw new Error("wrong claim");
  return value;
}
function established(p, record, ticket) {
  try {
    const marker = JSON.parse(readFileSync(p.marker, "utf8"));
    return record.ticket === ticket && exactObject(marker, ["schema", "ticket", "id"]) && marker.schema === MARKER_SCHEMA && marker.ticket === record.ticket && marker.id === record.establishment;
  } catch { return false; }
}
function save(p, ticket, previous, record) {
  const current = checkpoint(p, ticket);
  // Another checkpoint writer may update unrelated sections while the callback
  // runs. Preserve those bytes; a changed routing section is a conflict, never overwrite it.
  const before = readRoutingRecord(current);
  if (previous !== null && (!before.ok || !equal(before.record, previous))) throw new Error("routing checkpoint changed");
  durableWrite(p.path, replaceRoutingRecord(current, record), dirname(p.marker));
}
function authorized(auth, ticket) {
  return auth && auth.by === "human" && auth.ticket === ticket && text(auth.direction);
}

/** Explicit allowance administration. Does not invoke the callback or grant consent.
 * Reconciliation records a human-supplied consumed floor when accounting was lost.
 * Missing/corrupt routing data is archived before replacement; nothing is inferred.
 * Sentinel deletion as well as checkpoint deletion is outside automatic recovery:
 * first-use authorization is a human assertion, never deduced from absence.
 */
export function authorizeRoutingAllowance({ worktree, ticket, authorization }) {
  let p, held = false;
  try {
    const auth = snapshot(authorization);
    if (!authorized(auth, ticket) || !["initialize", "extend", "reconcile"].includes(auth.kind) || !exactObject(auth, ["by", "ticket", "direction", "kind", ...(auth.kind === "initialize" ? [] : auth.kind === "extend" ? ["additional"] : ["allowance", "consumed"])])) return refuse("authorization-required");
    p = paths(worktree);
    if (!(held = acquire(p))) return refuse("routing-busy-or-interrupted");
    const source = checkpoint(p, ticket), prior = readRoutingRecord(source);
    let record;
    if (prior.ok && prior.record.ticket !== ticket) return refuse("wrong-claim");
    if (auth.kind === "initialize") {
      if (section(source) || existsSync(p.marker)) return refuse("reconciliation-required");
      record = { schema: ROUTING_RECORD_SCHEMA, ticket, establishment: randomUUID(), allowance: DEFAULT_ROUTING_ALLOWANCE, prior_consumed: 0, grants: [], preparation: null, attempts: [] };
    } else if (auth.kind === "extend") {
      if (!prior.ok || !established(p, prior.record, ticket)) return refuse("reconciliation-required");
      if (!number(auth.additional) || auth.additional === 0 || !number(prior.record.allowance + auth.additional)) return refuse("invalid-allowance");
      record = structuredClone(prior.record); record.allowance += auth.additional;
    } else {
      if (!number(auth.allowance) || !number(auth.consumed) || auth.consumed > auth.allowance) return refuse("invalid-reconciliation");
      if (prior.ok && (auth.consumed !== spent(prior.record) || auth.allowance < prior.record.allowance)) return refuse("reconciliation-cannot-refund");
      durableWrite(join(dirname(p.marker), `recovery-${randomUUID()}.md`), source);
      record = prior.ok ? structuredClone(prior.record) : { schema: ROUTING_RECORD_SCHEMA, ticket, establishment: randomUUID(), prior_consumed: auth.consumed, grants: [], preparation: null, attempts: [] };
      record.allowance = auth.allowance;
      for (const a of record.attempts) if (a.status === "reserved") { a.status = "failed"; a.failure = "interrupted"; }
    }
    record.grants.push({ kind: auth.kind, direction: auth.direction, allowance: record.allowance });
    if (!validRecord(record)) return refuse("invalid-budget");
    // Establishment precedes checkpoint write. Interrupted initialization cannot
    // look like a fresh claim even if no routing section reached durable storage.
    if (auth.kind !== "extend") durableWrite(p.marker, JSON.stringify({ schema: MARKER_SCHEMA, ticket, id: record.establishment }));
    save(p, ticket, prior.ok ? prior.record : null, record);
    return { ok: true, allowance: record.allowance, consumed: spent(record) };
  } catch { return refuse("reconciliation-required"); }
  finally { if (held) release(p); }
}

/** Human-only lock recovery; a live/unknown owner is never displaced. A recovered
 * reservation remains consumed and requires allowance reconciliation before reuse.
 * PID reuse may conservatively require manual recovery, never automatic retry.
 */
export function recoverRoutingLock({ worktree, ticket, authorization }) {
  let p, guarded = false;
  try {
    const auth = snapshot(authorization);
    if (!exactObject(auth, ["by", "ticket", "direction", "kind"]) || !authorized(auth, ticket) || auth.kind !== "recover-lock") return refuse("authorization-required");
    p = paths(worktree); checkpoint(p, ticket);
    if (!(guarded = ownership(p))) return refuse("unknown-lock-owner");
    const owner = JSON.parse(readFileSync(join(p.lock, "owner.json"), "utf8"));
    if (!exactObject(owner, ["pid"]) || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return refuse("unknown-lock-owner");
    try { process.kill(owner.pid, 0); return refuse("live-lock-owner"); } catch (e) { if (e.code !== "ESRCH") return refuse("unknown-lock-owner"); }
    release(p);
    return { ok: true, reconciliation_required: true };
  } catch { return refuse("reconciliation-required"); }
  finally { if (guarded) rmSync(p.guard, { recursive: true }); }
}

function fresh(readCurrent, ticket) {
  const current = snapshot(readCurrent());
  if (!exactObject(current, ["input", "provider", "model", "contract", "policy"]) || current.contract !== ROUTING_CONTRACT || current.policy !== ROUTING_POLICY || typeof current.provider !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(current.provider) || typeof current.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(current.model)) throw new Error("invalid identity");
  const prepared = prepareRouting(current.input);
  if (!prepared.ok || prepared.preparation.identity.ticket !== ticket) throw new Error("invalid preparation");
  const input = freeze({ schema: PROVENANCE_SCHEMA, contract: current.contract, policy: current.policy, provider: current.provider, model: current.model, preparation: prepared.preparation, projection: prepared.projection });
  return { input, fingerprint: routingFingerprint(input) };
}
const recommendation = (assessment, input) => recommendRouting({ status: "assessed", assessment }, { workflow: input.preparation.workflow, evidenceIds: input.projection.evidence.map((e) => e.id) });

/** Persist a locally rebuilt preparation without call consent or spending an attempt. */
export function checkpointRoutingPreparation({ worktree, ticket, readCurrent }) {
  let p, held = false;
  try {
    p = paths(worktree);
    if (!(held = acquire(p))) return refuse("routing-busy-or-interrupted");
    const prior = readRoutingRecord(checkpoint(p, ticket));
    if (!prior.ok || !established(p, prior.record, ticket)) return refuse("reconciliation-required");
    if (prior.record.attempts.some((a) => a.status === "reserved")) return refuse("interrupted-attempt-requires-reconciliation");
    const current = fresh(readCurrent, ticket), next = structuredClone(prior.record);
    next.preparation = current.input;
    save(p, ticket, prior.record, next);
    return { ok: true, preparation: snapshot(current.input.preparation), fingerprint: current.fingerprint };
  } catch { return refuse("local-state-invalid"); }
  finally { if (held) release(p); }
}

/** Explicit local transaction seam. `readCurrent` synchronously reloads originals
 * and deterministic facts, not a cached preparation. `assess` is an injected,
 * single-invocation callback; this module has no real provider integration.
 * Consent must be supplied afresh, separately from allowance authorization.
 * A durable reserved entry always precedes that callback. No retry on any path.
 */
export async function attemptRoutingAssessment({ worktree, ticket, readCurrent, consent, assess }) {
  let p, held = false;
  try {
    p = paths(worktree);
    if (!(held = acquire(p))) return refuse("routing-busy-or-interrupted");
    const checked = readRoutingRecord(checkpoint(p, ticket));
    if (!checked.ok || !established(p, checked.record, ticket)) return refuse("reconciliation-required");
    let record = checked.record;
    if (record.attempts.some((a) => a.status === "reserved")) return refuse("interrupted-attempt-requires-reconciliation");
    const current = fresh(readCurrent, ticket);
    if (!routingEligibility(current.input.preparation.workflow).eligible) return refuse("local-refusal");
    const cached = [...record.attempts].reverse().find((a) => a.status === "assessed" && a.fingerprint === current.fingerprint);
    if (cached) return { ok: true, from: "cache", assessment: snapshot(cached.assessment), recommendation: recommendation(cached.assessment, current.input) };
    if (!exactObject(consent, ["ticket", "authorized"]) || consent.ticket !== ticket || consent.authorized !== true) return refuse("call-consent-required");
    if (typeof assess !== "function") return refuse("missing-callback");
    if (spent(record) >= record.allowance) return refuse("allowance-exhausted");
    const attempt = { id: randomUUID(), fingerprint: current.fingerprint, input: current.input, status: "reserved", assessment: null, failure: null };
    const reserved = structuredClone(record); reserved.preparation = current.input; reserved.attempts.push(attempt);
    save(p, ticket, record, reserved); record = reserved;
    let supplied;
    try { supplied = snapshot(await assess(current.input.projection)); }
    catch { supplied = { ok: false, failure: "provider-error" }; }
    const completed = structuredClone(record), last = completed.attempts.at(-1);
    last.status = "failed"; last.failure = "malformed";
    let stillCurrent = false;
    try { stillCurrent = fresh(readCurrent, ticket).fingerprint === current.fingerprint; } catch { /* Human. */ }
    if (!stillCurrent) last.failure = "stale-state";
    else if (exactObject(supplied, ["ok", "model", "assessment"]) && supplied.ok === true && supplied.model === current.input.model && validateRoutingAssessment(supplied.assessment, current.input.projection.evidence.map((e) => e.id)).ok) {
      last.status = "assessed"; last.assessment = supplied.assessment; last.failure = null;
    } else if (exactObject(supplied, ["ok", "failure"]) && supplied.ok === false && ROUTING_FAILURES.includes(supplied.failure)) last.failure = supplied.failure;
    save(p, ticket, record, completed);
    return last.status === "assessed" ? { ok: true, from: "assessment", assessment: snapshot(last.assessment), recommendation: recommendation(last.assessment, current.input) } : refuse(last.failure);
  } catch { return refuse("local-state-invalid"); }
  finally { if (held) release(p); }
}
