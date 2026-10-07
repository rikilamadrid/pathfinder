/** Explicit coordinator boundary. Assessment never imports follow-up or dispatch.
 * Local reader hooks are trusted coordinator inputs, not provider capabilities.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { claimFor } from "./claims.mjs";
import { resolveRef } from "./git.mjs";
import { orchestratorRefusal } from "./mode.mjs";
import { currentPr, selectStage } from "./stage.mjs";
import { readFindingsReport } from "./findings.mjs";
import { readExperimentReport } from "./experiments.mjs";
import { criteriaOf, declaredTransportProblem } from "./judgment.mjs";
import { readTickets, resolveStore } from "./store.mjs";
import { exactObject, ROUTING_CONTRACT, PROVENANCE_SCHEMA } from "./routing-contract.mjs";
import { prepareRouting } from "./routing-projection.mjs";
import { ROUTING_POLICY, MIN_ROUTING_CONFIDENCE } from "./routing-policy.mjs";
import { authorizeRoutingAllowance, attemptRoutingAssessment, routingFingerprint } from "./routing-record.mjs";
import { assessRouting } from "./routing-provider.mjs";
import { name as providerName, model as providerModel, transport } from "./routing-providers/jev.mjs";

export const ROUTING_CONFIG_PATH = "context/routing-assessment.json";
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const freeze = v => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const snapshot = v => freeze(structuredClone(v));
const line = v => typeof v === "string" && v.trim() && v.length <= 2048 && !/[\r\n]/.test(v);
const refused = reason => ({ ok: false, recommendation: "human", reason, requires_human_direction: true });

/** Bind all non-routing checkpoint bytes; allowance/accounting cannot stale its
 * own concern. Trailing separators added by routing persistence are immaterial.
 */
export function routingCheckpointDigest(text) {
  const sections = text.split(/(?=^## )/m);
  return digest(sections.filter(s => !/^## Routing assessments[ \t]*\r?\n/.test(s)).join("").trimEnd());
}
export function readRoutingConfiguration(root) {
  try {
    const text = readFileSync(join(root, ROUTING_CONFIG_PATH), "utf8");
    if (Buffer.byteLength(text) > 4096) return refused("configuration");
    const data = JSON.parse(text);
    if (!exactObject(data, ["schema", "enabled", "provider"]) || data.schema !== "pathfinder.routing-config/1" || typeof data.enabled !== "boolean" || data.provider !== providerName) return refused("configuration");
    return data.enabled ? { ok: true, provider: providerName, model: providerModel } : refused("disabled");
  } catch (error) { return refused(error.code === "ENOENT" ? "disabled" : "configuration"); }
}
function requireClaim(root, ticket, live) {
  if (orchestratorRefusal(root)) throw Error("orchestrator-only");
  if (!Array.isArray(live) || live.some(k => typeof k !== "string") || live.includes(ticket)) throw Error("live-worker-or-missing-inventory");
  const claim = claimFor(root, ticket);
  if (!claim?.worktree || claim.orphan || !claim.stateFile || claim.worker !== ticket) throw Error("ownership");
  return claim;
}

/** Reader rebuilds facts from repository/checkpoint truth on every call. Request
 * contains authored summaries only, never caller-supplied workflow/report facts.
 */
function capture({ root, ticket, gh = "gh", store = null, readRequest, readLive, env }) {
  const config = readRoutingConfiguration(root);
  if (!config.ok) throw Error(config.reason);
  const request = snapshot(readRequest());
  if (!exactObject(request, ["schema", "ticket", "pr", "head_sha", "checkpoint", "concern", "requirements", "evidence"]) || request.schema !== "pathfinder.routing-request/1" || request.ticket !== ticket || !exactObject(request.concern, ["id", "original", "summary", "risk"]) || !line(request.concern.id) || !line(request.concern.original) || !["none", "security", "high_risk", "scope", "unknown"].includes(request.concern.risk)) throw Error("invalid-request");
  if (request.concern.risk !== "none") throw Error("known-concern");
  const claim = requireClaim(root, ticket, readLive());
  if (claim.profile?.estimate?.risk?.value === "high") throw Error("known-concern");
  if (!["review", "done"].includes(claim.state) || claim.gate || claim.review !== "ordinary" || claim.adversary !== "required") throw Error("workflow-restriction");
  const worktree = resolve(root, claim.worktree);
  const identity = currentPr(root, claim.branch, gh);
  if (!identity.ok || identity.pr !== request.pr || identity.head !== request.head_sha || resolveRef(worktree, "HEAD") !== request.head_sha) throw Error("stale-identity");
  const text = readFileSync(join(worktree, "context/current-ticket.md"), "utf8");
  const field = name => { const m = [...text.matchAll(new RegExp(`^- ${name}: (.*)$`, "gm"))]; if (m.length > 1) throw Error("duplicate-checkpoint-field"); return m.length === 1 ? m[0][1].trim() : null; };
  if (field("Worker") !== ticket || field("Branch") !== claim.branch || field("Worktree") !== claim.worktree || field("State") !== claim.state || field("Gate") || field("Review") !== "ordinary" || field("Adversary") !== "required") throw Error("ownership-or-state");
  if (request.checkpoint !== routingCheckpointDigest(text)) throw Error("stale-checkpoint");
  const stage = selectStage({ claim, text, ...identity, live: readLive() });
  if (!stage.ok || stage.state !== "done") throw Error("deterministic-state");
  const findings = readFindingsReport(text), experiments = readExperimentReport(text);
  if (!findings.ok || !experiments.ok) throw Error("missing-reports");
  const tickets = readTickets(root, resolveStore(root, { override: store }), { gh });
  const source = tickets.ok && tickets.tickets.find(t => t.key === ticket);
  if (!source || !["Ready", "In Progress"].includes(source.status)) throw Error("ticket-state");
  const criteria = criteriaOf(source.body);
  if (!Array.isArray(request.requirements) || request.requirements.length !== criteria.length) throw Error("requirements");
  const requirements = criteria.map((c, i) => {
    const row = request.requirements[i];
    if (!exactObject(row, ["source", "original", "summary"]) || row.source !== c.id || row.original !== c.text) throw Error("stale-requirements");
    return { ...row, source: `ticket:${digest(source.body)}:${row.source}` };
  });
  const input = { identity: { ticket, pr: identity.pr, head_sha: identity.head },
    workflow: { identity_current: true, evidence_current: true, checkpoints_complete: true, ownership_valid: true, human_boundary: true, unresolved_concern: true, live_worker: false, failed_without_guidance: false, confirmed_tester_findings: false, missing_required_reports: false, known_concern: false },
    concern: { source: request.concern.id, original: request.concern.original, summary: request.concern.summary },
    requirements, findings: findings.report, experiments: experiments.report, evidence: request.evidence };
  const prepared = prepareRouting(input, { secrets: [env.PATHFINDER_ROUTING_API_KEY].filter(v => typeof v === "string") });
  if (!prepared.ok) throw Error("invalid-projection");
  const current = { input, provider: config.provider, model: config.model, contract: ROUTING_CONTRACT, policy: ROUTING_POLICY };
  const semantic = routingFingerprint({ schema: PROVENANCE_SCHEMA, ...Object.fromEntries(Object.entries(current).filter(([k]) => k !== "input")), preparation: prepared.preparation, projection: prepared.projection });
  return { current, prepared, fingerprint: `sha256:${digest([semantic, request.checkpoint])}`, worktree, request, boundary: request.checkpoint };
}
const same = (a, b) => a.fingerprint === b.fingerprint && a.boundary === b.boundary && a.worktree === b.worktree;
function presentation(result, captured) {
  const a = result.ok ? result.assessment : null;
  return { ok: result.ok, recommendation: result.ok ? result.recommendation.recommendation : "human",
    rationale: a?.rationale ?? null, confidence: a?.confidence ?? null, provisional_threshold: MIN_ROUTING_CONFIDENCE,
    evidence_refs: a?.evidence_refs ?? [], provider: captured?.current.provider ?? null, model: captured?.current.model ?? null,
    fingerprint: captured?.fingerprint ?? null, provenance: result.ok ? "validated-current-inputs" : "not-reusable",
    cache: result.from ?? "none", reason: result.reason ?? result.recommendation.reason,
    requires_human_direction: true, human_direction: "Pending. This recommendation neither authorizes nor dispatches follow-up." };
}

/** Local only; can run before allowance initialization. Returns the versioned
 * preparation and originals for local inspection; none of that envelope is sent.
 */
export function prepareRoutingInvocation(options) {
  try {
    const captured = capture({ env: {}, ...options });
    return { ok: true, ...captured.prepared, fingerprint: captured.fingerprint, concern: captured.request.concern.id, provider: captured.current.provider, model: captured.current.model, requires_human_direction: true };
  } catch (error) { return refused(error.message); }
}
/** Budget authority is explicitly human and separate from service consent. */
export function authorizeRoutingInvocation({ root, ticket, authorization, readLive }) {
  try {
    const claim = requireClaim(root, ticket, readLive());
    return authorizeRoutingAllowance({ worktree: resolve(root, claim.worktree), ticket, authorization });
  } catch (error) { return refused(error.message); }
}
/** Only this explicit operation can reach the adapter. The optional adapter and
 * fetch seams are for deterministic tests, not dynamic project configuration.
 */
export async function assessRoutingInvocation(options, { adapter, fetch = globalThis.fetch } = {}) {
  let captured;
  try {
    const env = snapshot(options.env ?? {});
    const settings = { ...options, env };
    captured = capture(settings);
    const consent = snapshot(options.consent);
    if (!exactObject(consent, ["by", "capability", "ticket", "concern", "provider", "invocation", "fingerprint"]) || consent.by !== "human" || consent.capability !== "routing-assessment" || consent.ticket !== options.ticket || consent.concern !== captured.request.concern.id || consent.provider !== captured.current.provider || !line(consent.invocation) || consent.invocation !== options.invocation || consent.fingerprint !== captured.fingerprint) return presentation(refused("routing-consent-required"), captured);
    const providerEnv = { TYPESAFE_API_KEY: env.PATHFINDER_ROUTING_API_KEY, TYPESAFE_BASE_URL: env.PATHFINDER_ROUTING_BASE_URL };
    if (declaredTransportProblem(transport(providerEnv), [providerEnv.TYPESAFE_API_KEY].filter(v => typeof v === "string"))) return presentation(refused("configuration"), captured);
    const readCurrent = () => { const fresh = capture(settings); if (!same(captured, fresh)) throw Error("stale-state"); return fresh.current; };
    const result = await attemptRoutingAssessment({ worktree: captured.worktree, ticket: options.ticket, readCurrent, consent: { ticket: options.ticket, authorized: true },
      assess: projection => assessRouting({ projection, env: providerEnv, fetch }, adapter) });
    // This reread also guards cache presentation; no persisted recommendation is trusted.
    const fresh = capture(settings);
    return presentation(same(captured, fresh) ? result : refused("stale-state"), fresh);
  } catch { return presentation(refused("stale-or-invalid-state"), captured); }
}
