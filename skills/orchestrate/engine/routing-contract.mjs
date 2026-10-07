/** Local routing contracts. No provider, transport, persistence or lifecycle code. */
export const ROUTING_CONTRACT = "pathfinder.routing-assessment/1";
export const PREPARATION_SCHEMA = "pathfinder.routing-preparation/1";
export const PROVENANCE_SCHEMA = "pathfinder.routing-provenance/1";
export const ROUTES = Object.freeze(["tester", "adversary", "human"]);
export const RATIONALES = Object.freeze(["missing_observation", "untested_assumption", "security_or_high_risk", "scope_or_requirement_ambiguity", "insufficient_context"]);
export const CONCERNS = Object.freeze(["none", "security", "high_risk", "scope"]);
export const MAX_EVIDENCE = 40;

// Accept JSON data only; do not execute accessors or silently drop authority fields.
export function exactObject(value, keys) {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, "value");
  });
}
const text = (value, max = 2048) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const digest = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const id = (value) => typeof value === "string" && /^e[1-9]\d{0,3}$/.test(value);
const result = (errors) => ({ ok: errors.length === 0, errors });
// Check the complete array shape before reading members or invoking iteration.
// Frozen JSON arrays are valid; subclasses, holes, accessors and extra keys are not.
function jsonArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return false;
  }
  return true;
}
const refsValid = (refs) => jsonArray(refs) && refs.length <= MAX_EVIDENCE &&
  refs.every(id) && new Set(refs).size === refs.length;

/** Validate against generated IDs from a locally prepared bundle, never provider IDs. */
export function validateRoutingAssessment(value, evidenceIds) {
  const errors = [];
  if (!refsValid(evidenceIds)) return result(["invalid local evidence IDs"]);
  if (!exactObject(value, ["schema", "likely_route", "confidence", "rationale", "evidence_refs", "concern"])) return result(["assessment must contain exactly the routing contract fields"]);
  if (value.schema !== ROUTING_CONTRACT) errors.push("unknown assessment schema");
  if (!ROUTES.includes(value.likely_route)) errors.push("unsupported route");
  if (!RATIONALES.includes(value.rationale)) errors.push("unsupported rationale");
  if (!CONCERNS.includes(value.concern)) errors.push("unsupported concern");
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) errors.push("confidence must be finite and between zero and one");
  if (!refsValid(value.evidence_refs) || !value.evidence_refs.every((ref) => evidenceIds.includes(ref))) errors.push("references must be unique generated IDs in the prepared evidence");
  // Human/uncertainty classifications are valid conservative answers. A claimed
  // investigative route must match its one supported semantic classification.
  if (value.likely_route !== "human" && !(
    (value.likely_route === "tester" && value.rationale === "missing_observation") ||
    (value.likely_route === "adversary" && value.rationale === "untested_assumption")
  )) errors.push("unsupported route and rationale combination");
  return result(errors);
}

/** Facts come from deterministic local checks, not assessment or coordinator prose.
 * A true human_boundary does not mean that boundary is resolved by this module.
 */
export const WORKFLOW_FIELDS = Object.freeze([
  "identity_current", "evidence_current", "checkpoints_complete", "ownership_valid",
  "human_boundary", "unresolved_concern", "live_worker", "failed_without_guidance",
  "confirmed_tester_findings", "missing_required_reports", "known_concern",
]);
export function validateWorkflowFacts(value) {
  return result(exactObject(value, WORKFLOW_FIELDS) && WORKFLOW_FIELDS.every((key) => typeof value[key] === "boolean")
    ? [] : ["workflow facts must contain exactly the local boolean checks"]);
}

/**
 * Minimal local preparation interface shared by preparation (57.2) and storage
 * (57.4). This validates structure only, NOT outbound prose/DLP or freshness.
 * source fields identify local originals; source_digest binds their exact bytes.
 * Both remain local and must never be exported.
 * Arrays retain order; generated IDs bind that order to the outbound projection.
 */
export function validatePreparation(value) {
  if (!exactObject(value, ["schema", "identity", "workflow", "concern", "requirements", "evidence"])) return result(["invalid preparation fields"]);
  const errors = [];
  const identity = value.identity;
  if (value.schema !== PREPARATION_SCHEMA) errors.push("unknown preparation schema");
  if (!exactObject(identity, ["ticket", "pr", "head_sha"]) || typeof identity.ticket !== "string" || !/^\d+\.\d+$/.test(identity.ticket) ||
    typeof identity.pr !== "string" || !/^https:\/\/[^\s]+\/pull\/[1-9]\d*$/.test(identity.pr) ||
    typeof identity.head_sha !== "string" || !/^[a-f0-9]{40}$/.test(identity.head_sha)) errors.push("invalid local identity");
  errors.push(...validateWorkflowFacts(value.workflow).errors);
  if (!exactObject(value.concern, ["source", "source_digest", "summary"]) || !text(value.concern.source) || !digest(value.concern.source_digest) || !text(value.concern.summary)) errors.push("invalid concern provenance");
  const rows = (items, keys, prefix, check) => {
    if (!jsonArray(items) || items.length === 0 || items.length > MAX_EVIDENCE) return false;
    const seen = new Set();
    for (const entry of items) {
      if (!exactObject(entry, keys) || typeof entry.id !== "string" || !new RegExp(`^${prefix}[1-9]\\d{0,3}$`).test(entry.id) || seen.has(entry.id) || !check(entry)) return false;
      seen.add(entry.id);
    }
    return true;
  };
  if (!rows(value.requirements, ["id", "source", "source_digest", "summary", "summarized"], "r", (entry) => text(entry.source) && digest(entry.source_digest) && text(entry.summary) && typeof entry.summarized === "boolean")) errors.push("invalid requirement provenance");
  if (!rows(value.evidence, ["id", "role", "source", "source_digest", "action", "observation"], "e", (entry) => ["tester", "adversary"].includes(entry.role) && text(entry.source) && digest(entry.source_digest) && text(entry.action) && text(entry.observation))) errors.push("invalid evidence provenance");
  return result(errors);
}

/**
 * Fingerprint input interface, not a digest/cache implementation. preparation
 * binds local originals; projection is the exact separately validated outbound
 * JSON object. The caller must validate restricted prose and model identity.
 * Policy identity is explicit so changed policy cannot silently reuse an answer.
 */
export function serializeRoutingFingerprintInput(value) {
  if (!exactObject(value, ["schema", "contract", "policy", "provider", "model", "preparation", "projection"]) ||
      value.schema !== PROVENANCE_SCHEMA || value.contract !== ROUTING_CONTRACT ||
      !text(value.policy, 128) || !text(value.provider, 64) || !text(value.model, 64) ||
      !validatePreparation(value.preparation).ok || !value.projection || Array.isArray(value.projection) || typeof value.projection !== "object") {
    throw new Error("invalid routing fingerprint input");
  }
  // Canonical JSON: object key order is immaterial, array order is significant.
  // Reject lossy JSON values, cycles, accessors and non-JSON objects.
  const ancestors = new Set();
  const canonical = (entry) => {
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return JSON.stringify(entry);
    if (typeof entry === "number" && Number.isFinite(entry)) return JSON.stringify(entry);
    if (typeof entry !== "object" || ancestors.has(entry)) throw new Error("fingerprint input must be finite acyclic JSON data");
    ancestors.add(entry);
    let output;
    if (Array.isArray(entry)) {
      if (!jsonArray(entry)) throw new Error("invalid JSON array");
      const values = Array.from({ length: entry.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(entry, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("invalid JSON array member");
        return canonical(descriptor.value);
      });
      output = `[${values.join(",")}]`;
    } else {
      const keys = Object.keys(entry).sort();
      if (!exactObject(entry, keys)) throw new Error("invalid JSON object");
      output = `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(entry[key])}`).join(",")}}`;
    }
    ancestors.delete(entry);
    return output;
  };
  return canonical(value);
}
