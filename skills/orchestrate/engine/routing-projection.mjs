/**
 * Routing-only, local preparation. Authors supply prose; nothing summarizes,
 * reads configuration, persists a checkpoint or contacts a provider here.
 * Only `projection` is outbound. `preparation` and `originals` stay local.
 * Reference membership proves traceability, never semantic support.
 */
import { createHash } from "node:crypto";
import { exactObject, MAX_EVIDENCE, PREPARATION_SCHEMA, validatePreparation } from "./routing-contract.mjs";
import { routingEligibility } from "./routing-policy.mjs";
import { judgeProseProblem, secretScopeProblem, splitToken, tokensOf, encodedPair } from "./judge-prose.mjs";
import { credentialIn } from "./judgment.mjs";
import { validateFindingsReport } from "./findings.mjs";
import { validateExperimentReport } from "./experiments.mjs";

export const ROUTING_PROJECTION_SCHEMA = "pathfinder.routing-projection/1";
export const MAX_ROUTING_BYTES = 32768;
const MAX_LOCAL_BYTES = 262144;
const refuse = () => ({ ok: false, recommendation: "human", reason: "Routing preparation requires complete, current, safely summarized local evidence." });
const nonempty = (v) => typeof v === "string" && v.trim() !== "" && v.length <= 32768;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Reject lossy JSON, getters, extra array properties and cycles before calling
// report validators. A fresh plain copy also keeps returned records independent.
function copyJSON(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || ancestors.has(value)) throw new Error("local JSON required");
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) throw new Error("plain array required");
    result = Array.from({ length: value.length }, (_, i) => {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (!d?.enumerable || !Object.hasOwn(d, "value")) throw new Error("plain member required");
      return copyJSON(d.value, ancestors);
    });
  } else {
    const keys = Object.keys(value).sort();
    if (!exactObject(value, keys)) throw new Error("plain object required");
    result = Object.fromEntries(keys.map((key) => [key, copyJSON(value[key], ancestors)]));
  }
  ancestors.delete(value);
  return result;
}
const digest = (value) => `sha256:${createHash("sha256").update(JSON.stringify(copyJSON(value))).digest("hex")}`;
const list = (v) => Array.isArray(v) && v.length > 0 && v.length <= MAX_EVIDENCE;
const optionalKeys = (v, required, optional) => exactObject(v, [...required, ...optional.filter((key) => Object.hasOwn(v ?? {}, key))]);
const proseProblem = (v) => judgeProseProblem(v) || (/\b(?:pass(?:ed)?|fail(?:ed)?|verdicts?)\b/i.test(v) ? "verdict" : null);

/** Strict outbound validation, reusable by the later guarded transport. */
export function validateRoutingProjection(value, secrets = []) {
  try {
    const p = copyJSON(value);
    secrets = copyJSON(secrets);
    if (!Array.isArray(secrets) || secrets.some((s) => typeof s !== "string")) return { ok: false };
    if (!exactObject(p, ["schema", "concern", "requirements", "evidence"]) || p.schema !== ROUTING_PROJECTION_SCHEMA || !list(p.requirements) || !list(p.evidence)) return { ok: false };
    const texts = [p.concern];
    for (const [i, row] of p.requirements.entries()) {
      if (!exactObject(row, ["id", "summary"]) || row.id !== `r${i + 1}`) return { ok: false };
      texts.push(row.summary);
    }
    for (const [i, row] of p.evidence.entries()) {
      if (!exactObject(row, ["id", "role", "action", "observation"]) || row.id !== `e${i + 1}` || !["tester", "adversary"].includes(row.role)) return { ok: false };
      texts.push(row.action, row.observation);
    }
    const stream = texts.join(" ");
    const flat = stream.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    const joinedSecret = secrets.some((secret) => { const bare = secret.replace(/[^A-Za-z0-9]/g, "").toLowerCase(); return bare.length >= 8 && flat.includes(bare); });
    if (joinedSecret || splitToken(stream) || tokensOf(stream).some((token) => encodedPair(token.word)) || texts.some(proseProblem) || secretScopeProblem(texts) || credentialIn(p, secrets) || credentialIn(texts.join(" "), secrets) || Buffer.byteLength(JSON.stringify(p)) > MAX_ROUTING_BYTES) return { ok: false };
    return { ok: true };
  } catch { return { ok: false }; }
}

/**
 * Input (all local): identity and workflow from 57.1; concern {source,
 * original, summary}; requirements [{source, original, summary}]; complete
 * findings and optional experiments reports; evidence selections [{role,
 * index, action, observation}] (index is one-based). Summaries may be omitted
 * only to reuse a matching prior preparation or a current report's existing
 * judge projection. Explicit unsafe summaries never fall back to another one.
 * Requirement summaries are explicit: no automatic stripping of raw material.
 * `previous` is a preparation returned here, not a cached routing assessment.
 */
export function prepareRouting(input, { previous = null, secrets = [] } = {}) {
  try {
    const data = copyJSON(input);
    if (Buffer.byteLength(JSON.stringify(data)) > MAX_LOCAL_BYTES || !exactObject(data, ["identity", "workflow", "concern", "requirements", "findings", "experiments", "evidence"])) return refuse();
    const { identity, workflow, concern, requirements, findings, experiments, evidence } = data;
    if (!routingEligibility(workflow).eligible) return refuse();
    if (!validateFindingsReport(findings).ok || findings.result !== "PASS" || !equal(copyJSON(identity), copyJSON({ ticket: findings.ticket, pr: findings.pr, head_sha: findings.head_sha }))) return refuse();
    if (experiments !== null && (!validateExperimentReport(experiments).ok || !equal(copyJSON(identity), copyJSON({ ticket: experiments.ticket, pr: experiments.pr, head_sha: experiments.head_sha })))) return refuse();
    if (!optionalKeys(concern, ["source", "original"], ["summary"]) || !nonempty(concern.source) || !nonempty(concern.original) || !list(requirements) || !list(evidence)) return refuse();
    const prior = previous === null ? null : copyJSON(previous);
    if (prior && (!validatePreparation(prior).ok || !equal(copyJSON(prior.identity), identity) || !equal(copyJSON(prior.workflow), workflow))) return refuse();
    const binding = (source, original) => ({ source, source_digest: digest({ identity, source, original }) });
    const concernBinding = binding(concern.source, concern.original);
    const same = (old, fresh) => old?.source === fresh.source && old.source_digest === fresh.source_digest;
    if (prior && !same(prior.concern, concernBinding)) return refuse();
    const prepared = { schema: PREPARATION_SCHEMA, identity, workflow,
      concern: { ...concernBinding, summary: Object.hasOwn(concern, "summary") ? concern.summary : prior?.concern.summary }, requirements: [], evidence: [] };
    const originals = { concern: { source: concern.source, original: concern.original }, requirements: [], evidence: [] };
    const sources = new Set();
    for (const [i, row] of requirements.entries()) {
      if (!optionalKeys(row, ["source", "original"], ["summary"]) || !nonempty(row.source) || !nonempty(row.original) || sources.has(row.source)) return refuse();
      sources.add(row.source);
      const bound = binding(row.source, row.original);
      const old = prior?.requirements[i];
      if (prior && (!same(old, bound) || old.id !== `r${i + 1}`)) return refuse();
      const summary = Object.hasOwn(row, "summary") ? row.summary : old?.summary;
      prepared.requirements.push({ id: `r${i + 1}`, ...bound, summary, summarized: summary !== row.original });
      originals.requirements.push({ id: `r${i + 1}`, source: row.source, original: row.original });
    }
    sources.clear();
    for (const [i, row] of evidence.entries()) {
      if (!optionalKeys(row, ["role", "index"], ["action", "observation"]) || !["tester", "adversary"].includes(row.role) || !Number.isInteger(row.index) || row.index < 1) return refuse();
      const report = row.role === "tester" ? findings : experiments;
      const record = row.role === "tester" ? findings.verification[row.index - 1] : experiments?.experiments[row.index - 1];
      if (record === undefined) return refuse();
      const source = `${row.role}:${row.role === "tester" ? "verification" : "experiments"}:${row.index}`;
      if (sources.has(source)) return refuse();
      sources.add(source);
      // Bind the full current report too: changed limits, verdict, findings or
      // neighboring observations invalidate reuse even when this record matches.
      const bound = binding(source, { report, record });
      const old = prior?.evidence[i];
      if (prior && (!same(old, bound) || old.id !== `e${i + 1}` || old.role !== row.role)) return refuse();
      const existing = row.role === "tester" ? findings.judge?.verification[row.index - 1] : record.judge;
      const action = Object.hasOwn(row, "action") ? row.action : old ? old.action : existing?.action_summary;
      const observation = Object.hasOwn(row, "observation") ? row.observation : old ? old.observation : existing?.observation_summary;
      prepared.evidence.push({ id: `e${i + 1}`, role: row.role, ...bound, action, observation });
      originals.evidence.push({ id: `e${i + 1}`, source, report, record });
    }
    if (prior && (prior.requirements.length !== requirements.length || prior.evidence.length !== evidence.length)) return refuse();
    if (!validatePreparation(prepared).ok) return refuse();
    const projection = {
      schema: ROUTING_PROJECTION_SCHEMA, concern: prepared.concern.summary,
      requirements: prepared.requirements.map(({ id, summary }) => ({ id, summary })),
      evidence: prepared.evidence.map(({ id, role, action, observation }) => ({ id, role, action, observation })),
    };
    if (!validateRoutingProjection(projection, secrets).ok) return refuse();
    return { ok: true, preparation: prepared, projection, originals };
  } catch { return refuse(); }
}
