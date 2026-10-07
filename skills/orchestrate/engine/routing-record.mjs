/** Routing-only local transactions. No adapter import, network, activation or stage writes.
 * The explicit caller supplies fresh local inputs and (separately) call consent.
 * Human authorization objects are assertions by that trusted caller, not credentials.
 * Checkpoint hashes detect corruption; they do not authenticate a hostile filesystem.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { atomicCheckpointWrite as durableWrite, checkpointOwner, mutateCheckpoint, ownerAlive, recoverCheckpointLock } from "./checkpoint-write.mjs";
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
  return { path, marker: join(local, "established.json") };
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

const digestPattern = (s) => typeof s === "string" && /^sha256:[a-f0-9]{64}$/.test(s);
const boundFingerprint = (input, checkpoint) => hash(JSON.stringify([routingFingerprint(input), checkpoint]));
// Canonical validated fields, independent of JSON object insertion order. This
// detects isolated record changes, not a writer able to recompute this digest.
function integrity(a) {
  const v = a.assessment;
  const assessment = v === null ? null : [v.schema, v.likely_route, v.confidence, v.rationale, v.evidence_refs, v.concern];
  return hash(JSON.stringify([a.id, a.fingerprint, a.checkpoint_digest, a.owner.pid, a.owner.host, a.status, assessment, a.failure]));
}
const seal = (a) => { a.integrity = integrity(a); return a; };

function validRecord(r) {
  try {
    if (!exactObject(r, ["schema", "ticket", "establishment", "allowance", "prior_consumed", "grants", "preparation", "attempts"]) || r.schema !== ROUTING_RECORD_SCHEMA || typeof r.ticket !== "string" || !/^\d+\.\d+$/.test(r.ticket) || !uuid(r.establishment) || !number(r.allowance) || !number(r.prior_consumed) || !Array.isArray(r.grants) || !r.grants.length || r.grants.length > MAX_ROUTING_ATTEMPTS || !Array.isArray(r.attempts) || spent(r) > r.allowance) return false;
    if (!r.grants.every((g) => exactObject(g, ["kind", "direction", "allowance"]) && ["initialize", "extend", "reconcile"].includes(g.kind) && text(g.direction) && number(g.allowance))) return false;
    if (r.grants.at(-1).allowance !== r.allowance || r.grants.some((g, i) => i > 0 && g.allowance < r.grants[i - 1].allowance)) return false;
    if (r.preparation !== null && (r.preparation.preparation.identity.ticket !== r.ticket || !routingFingerprint(r.preparation))) return false;
    const ids = new Set();
    for (const a of r.attempts) {
      if (!exactObject(a, ["id", "fingerprint", "input", "checkpoint_digest", "owner", "status", "assessment", "failure", "integrity"]) || !uuid(a.id) || ids.has(a.id) || a.input.preparation.identity.ticket !== r.ticket || a.fingerprint !== boundFingerprint(a.input, a.checkpoint_digest) || !digestPattern(a.checkpoint_digest) || !exactObject(a.owner, ["pid", "host"]) || !Number.isSafeInteger(a.owner.pid) || a.owner.pid < 1 || typeof a.owner.host !== "string" || a.owner.host.length > 255) return false;
      ids.add(a.id);
      if (a.status === "reserved") { if (a.assessment !== null || a.failure !== null) return false; }
      else if (a.status === "failed") { if (a.assessment !== null || ![...ROUTING_FAILURES, "interrupted", "stale-state"].includes(a.failure)) return false; }
      else if (a.status === "assessed") { if (a.failure !== null || !validateRoutingAssessment(a.assessment, a.input.projection.evidence.map((e) => e.id)).ok) return false; }
      else return false;
      if (a.integrity !== integrity(a)) return false;
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

function checkpoint(p, ticket, value = readFileSync(p.path, "utf8")) {
  const workers = [...String(value).matchAll(/^- Worker:[ \t]*(.*)\r?$/gm)];
  if (workers.length !== 1 || workers[0][1].trim() !== ticket) throw new Error("wrong claim");
  return value;
}
function established(p, record, ticket) {
  try {
    const marker = JSON.parse(readFileSync(p.marker, "utf8"));
    return record.ticket === ticket && exactObject(marker, ["schema", "ticket", "id"]) && marker.schema === MARKER_SCHEMA && marker.ticket === record.ticket && marker.id === record.establishment;
  } catch { return false; }
}
function checkpointDigest(source) {
  const span = section(source);
  return hash(span ? source.slice(0, span.start) + source.slice(span.end) : source);
}
function transaction(p, ticket, update) {
  return mutateCheckpoint(p.path, (latest) => update(checkpoint(p, ticket, latest)));
}
const noWrite = (value) => ({ value });
const changed = (source, record, value) => ({ text: replaceRoutingRecord(source, record), value });
const caught = (error) => refuse(error.code === "CHECKPOINT_CONFLICT" ? "checkpoint-busy-or-interrupted" : "local-state-invalid");
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
  try {
    const auth = snapshot(authorization);
    if (!authorized(auth, ticket) || !["initialize", "extend", "reconcile"].includes(auth.kind) || !exactObject(auth, ["by", "ticket", "direction", "kind", ...(auth.kind === "initialize" ? [] : auth.kind === "extend" ? ["additional"] : ["allowance", "consumed"])])) return refuse("authorization-required");
    const p = paths(worktree);
    return transaction(p, ticket, (source) => {
      const prior = readRoutingRecord(source);
      let record;
      const stop = (reason) => noWrite(refuse(reason));
      if (prior.ok && prior.record.ticket !== ticket) return stop("wrong-claim");
      if (prior.ok && prior.record.attempts.some((a) => a.status === "reserved" && ownerAlive(a.owner) !== false)) return stop("attempt-in-flight-or-unknown");
      if (auth.kind === "initialize") {
        if (section(source) || existsSync(p.marker)) return stop("reconciliation-required");
        record = { schema: ROUTING_RECORD_SCHEMA, ticket, establishment: randomUUID(), allowance: DEFAULT_ROUTING_ALLOWANCE, prior_consumed: 0, grants: [], preparation: null, attempts: [] };
      } else if (auth.kind === "extend") {
        if (!prior.ok || !established(p, prior.record, ticket)) return stop("reconciliation-required");
        if (!number(auth.additional) || auth.additional === 0 || !number(prior.record.allowance + auth.additional)) return stop("invalid-allowance");
        record = structuredClone(prior.record); record.allowance += auth.additional;
      } else {
        if (!number(auth.allowance) || !number(auth.consumed) || auth.consumed > auth.allowance) return stop("invalid-reconciliation");
        if (prior.ok && (auth.consumed !== spent(prior.record) || auth.allowance < prior.record.allowance)) return stop("reconciliation-cannot-refund");
        mkdirSync(dirname(p.marker), { recursive: true });
        durableWrite(join(dirname(p.marker), `recovery-${randomUUID()}.md`), source);
        record = prior.ok ? structuredClone(prior.record) : { schema: ROUTING_RECORD_SCHEMA, ticket, establishment: randomUUID(), prior_consumed: auth.consumed, grants: [], preparation: null, attempts: [] };
        record.allowance = auth.allowance;
        for (const a of record.attempts) if (a.status === "reserved") { a.status = "failed"; a.failure = "interrupted"; seal(a); }
      }
      record.grants.push({ kind: auth.kind, direction: auth.direction, allowance: record.allowance });
      if (!validRecord(record)) return stop("invalid-budget");
      if (auth.kind !== "extend") {
        mkdirSync(dirname(p.marker), { recursive: true });
        durableWrite(p.marker, JSON.stringify({ schema: MARKER_SCHEMA, ticket, id: record.establishment }));
      }
      return changed(source, record, { ok: true, allowance: record.allowance, consumed: spent(record) });
    });
  } catch (error) { return caught(error); }
}

/** Explicit shared-lock recovery; interrupted reservations remain consumed and
 * require budget reconciliation. A live or unknown attempt owner is not retired.
 */
export function recoverRoutingLock({ worktree, ticket, authorization }) {
  try {
    const auth = snapshot(authorization);
    if (!exactObject(auth, ["by", "ticket", "direction", "kind"]) || !authorized(auth, ticket) || auth.kind !== "recover-lock") return refuse("authorization-required");
    const p = paths(worktree), record = readRoutingRecord(checkpoint(p, ticket));
    if (record.ok && record.record.attempts.some((a) => a.status === "reserved" && ownerAlive(a.owner) !== false)) return refuse("live-or-unknown-attempt-owner");
    const result = recoverCheckpointLock(p.path, { by: "human", kind: "recover-checkpoint-lock", direction: auth.direction });
    return result.ok ? { ok: true, reconciliation_required: true } : refuse(result.reason);
  } catch { return refuse("reconciliation-required"); }
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

// The arbitrary caller-supplied reader runs outside the mutex. Bind the actual
// checkpoint before that read, then compare under the lock: a concurrent edit
// invalidates the captured facts instead of extending the critical section.
function capture(p, ticket, readCurrent) {
  const digest = checkpointDigest(checkpoint(p, ticket));
  const current = fresh(readCurrent, ticket);
  return { ...current, checkpoint_digest: digest, fingerprint: boundFingerprint(current.input, digest) };
}

/** Persist a locally rebuilt preparation without call consent or spending. */
export function checkpointRoutingPreparation({ worktree, ticket, readCurrent }) {
  try {
    const p = paths(worktree), current = capture(p, ticket, readCurrent);
    return transaction(p, ticket, (source) => {
      const prior = readRoutingRecord(source);
      if (!prior.ok || !established(p, prior.record, ticket)) return noWrite(refuse("reconciliation-required"));
      if (prior.record.attempts.some((a) => a.status === "reserved")) return noWrite(refuse("attempt-in-flight-or-interrupted"));
      if (checkpointDigest(source) !== current.checkpoint_digest) return noWrite(refuse("stale-state"));
      const next = structuredClone(prior.record); next.preparation = current.input;
      return changed(source, next, { ok: true, preparation: snapshot(current.input.preparation), fingerprint: current.fingerprint });
    });
  } catch (error) { return caught(error); }
}

/** Reserve under the shared mutex, release before the single fake callback,
 * reacquire to record its outcome against fresh state. No retry or refund.
 */
export async function attemptRoutingAssessment({ worktree, ticket, readCurrent, consent, assess }) {
  try {
    const p = paths(worktree), current = capture(p, ticket, readCurrent);
    const reservation = transaction(p, ticket, (source) => {
      const checked = readRoutingRecord(source);
      if (!checked.ok || !established(p, checked.record, ticket)) return noWrite(refuse("reconciliation-required"));
      const record = checked.record;
      if (record.attempts.some((a) => a.status === "reserved")) return noWrite(refuse("attempt-in-flight-or-interrupted"));
      if (checkpointDigest(source) !== current.checkpoint_digest || !routingEligibility(current.input.preparation.workflow).eligible) return noWrite(refuse("stale-state"));
      const cached = [...record.attempts].reverse().find((a) => a.status === "assessed" && a.fingerprint === current.fingerprint);
      if (cached) return noWrite({ ok: true, from: "cache", assessment: snapshot(cached.assessment), recommendation: recommendation(cached.assessment, current.input) });
      if (!exactObject(consent, ["ticket", "authorized"]) || consent.ticket !== ticket || consent.authorized !== true) return noWrite(refuse("call-consent-required"));
      if (typeof assess !== "function") return noWrite(refuse("missing-callback"));
      if (spent(record) >= record.allowance) return noWrite(refuse("allowance-exhausted"));
      const attempt = seal({ id: randomUUID(), fingerprint: current.fingerprint, input: current.input, checkpoint_digest: current.checkpoint_digest, owner: checkpointOwner(), status: "reserved", assessment: null, failure: null });
      const reserved = structuredClone(record); reserved.preparation = current.input; reserved.attempts.push(attempt);
      return changed(source, reserved, { reserved: true, id: attempt.id });
    });
    if (!reservation.reserved) return reservation;
    let supplied;
    try { supplied = snapshot(await assess(current.input.projection)); }
    catch { supplied = { ok: false, failure: "provider-error" }; }
    let latest;
    try { latest = capture(p, ticket, readCurrent); } catch { /* Recorded as stale. */ }
    return transaction(p, ticket, (source) => {
      const checked = readRoutingRecord(source);
      if (!checked.ok || !established(p, checked.record, ticket)) return noWrite(refuse("reconciliation-required"));
      const completed = structuredClone(checked.record), last = completed.attempts.find((a) => a.id === reservation.id);
      if (!last || last.status !== "reserved" || last.fingerprint !== current.fingerprint) return noWrite(refuse("reservation-changed"));
      last.status = "failed"; last.failure = "malformed";
      if (!latest || latest.fingerprint !== current.fingerprint || checkpointDigest(source) !== latest.checkpoint_digest) last.failure = "stale-state";
      else if (exactObject(supplied, ["ok", "model", "assessment"]) && supplied.ok === true && supplied.model === current.input.model && validateRoutingAssessment(supplied.assessment, current.input.projection.evidence.map((e) => e.id)).ok) {
        last.status = "assessed"; last.assessment = supplied.assessment; last.failure = null;
      } else if (exactObject(supplied, ["ok", "failure"]) && supplied.ok === false && ROUTING_FAILURES.includes(supplied.failure)) last.failure = supplied.failure;
      seal(last);
      return changed(source, completed, last.status === "assessed" ? { ok: true, from: "assessment", assessment: snapshot(last.assessment), recommendation: recommendation(last.assessment, current.input) } : refuse(last.failure));
    });
  } catch (error) { return caught(error); }
}
