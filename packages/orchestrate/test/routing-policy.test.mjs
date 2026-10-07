import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROUTING_CONTRACT, PREPARATION_SCHEMA, PROVENANCE_SCHEMA, ROUTES, RATIONALES, CONCERNS, WORKFLOW_FIELDS, validateRoutingAssessment, validatePreparation, serializeRoutingFingerprintInput } from "../../../skills/orchestrate/engine/routing-contract.mjs";
import { ROUTING_POLICY, MIN_ROUTING_CONFIDENCE, ROUTING_FAILURES, routingEligibility, recommendRouting } from "../../../skills/orchestrate/engine/routing-policy.mjs";

const workflow = () => ({ identity_current: true, evidence_current: true, checkpoints_complete: true, ownership_valid: true, human_boundary: true, unresolved_concern: true, live_worker: false, failed_without_guidance: false, confirmed_tester_findings: false, missing_required_reports: false, known_concern: false });
const assessment = (patch = {}) => ({ schema: ROUTING_CONTRACT, likely_route: "tester", confidence: 0.8, rationale: "missing_observation", evidence_refs: ["e1"], concern: "none", ...patch });
const recommend = (value, facts = workflow()) => recommendRouting({ status: "assessed", assessment: value }, { workflow: facts, evidenceIds: ["e1", "e2"] });
const preparation = () => ({
  schema: PREPARATION_SCHEMA,
  identity: { ticket: "57.1", pr: "https://github.com/example/project/pull/10", head_sha: "a".repeat(40) },
  workflow: workflow(),
  concern: { source: "local concern record", source_digest: "sha256:" + "1".repeat(64), summary: "The failure response has not been observed." },
  requirements: [{ id: "r1", source: "ticket verification item", source_digest: "sha256:" + "2".repeat(64), summary: "A failure response remains conservative.", summarized: true }],
  evidence: [{ id: "e1", role: "tester", source: "local review record", source_digest: "sha256:" + "3".repeat(64), action: "Executed the boundary cases.", observation: "The expected response was observed." }],
});
const fingerprintInput = () => ({ schema: PROVENANCE_SCHEMA, contract: ROUTING_CONTRACT, policy: ROUTING_POLICY, provider: "jev", model: "pinned-model", preparation: preparation(), projection: { concern: "The failure response has not been observed.", evidence: [{ id: "e1", observation: "The expected response was observed." }] } });

// Exhaustive cross-product proves the two positive classifications, not just examples.
test("all route/rationale/concern combinations map conservatively", () => {
  for (const likely_route of ROUTES) for (const rationale of RATIONALES) for (const concern of CONCERNS) {
    const value = assessment({ likely_route, rationale, concern });
    const supported = (likely_route === "tester" && rationale === "missing_observation") || (likely_route === "adversary" && rationale === "untested_assumption");
    assert.equal(validateRoutingAssessment(value, ["e1"]).ok, likely_route === "human" || supported);
    const result = recommend(value);
    assert.equal(result.recommendation, supported && concern === "none" ? likely_route : "human");
    assert.equal(result.requires_human_direction, true);
    assert.deepEqual(Object.keys(result).sort(), ["policy", "reason", "recommendation", "requires_human_direction"]);
  }
});

test("threshold is independent, provisional, inclusive, and cannot overcome concern", () => {
  assert.equal(MIN_ROUTING_CONFIDENCE, 0.8);
  for (const confidence of [0, 0.799999999999, 0.8, 0.800000000001, 1]) {
    assert.equal(recommend(assessment({ confidence })).recommendation, confidence >= 0.8 ? "tester" : "human");
    assert.equal(recommend(assessment({ confidence, concern: "security" })).recommendation, "human");
  }
});

test("malformed values, missing fields, authority additions and unknown enums refuse", () => {
  const bad = [null, undefined, [], true, "tester", {}, ...[NaN, Infinity, -Infinity, -0.01, 1.01, "1", null].map((confidence) => assessment({ confidence }))];
  for (const field of Object.keys(assessment())) { const value = assessment(); delete value[field]; bad.push(value); }
  for (const field of ["continue", "developer", "next_state", "dispatch", "accept", "PASS", "FAIL", "merge", "workflow", "provider", "model", "recommendation", "toJSON"]) bad.push({ ...assessment(), [field]: "authorized" });
  for (const likely_route of ["continue", "developer", "Developer", "PASS", "merge", "", null]) bad.push(assessment({ likely_route }));
  for (const patch of [{ schema: "unknown" }, { rationale: "dispatch now" }, { concern: "safe" }]) bad.push(assessment(patch));
  const symbol = assessment(); symbol[Symbol("dispatch")] = true; bad.push(symbol);
  const hidden = assessment(); Object.defineProperty(hidden, "dispatch", { value: true }); bad.push(hidden);
  const getter = assessment(); Object.defineProperty(getter, "confidence", { get() { throw new Error("must not execute"); }, enumerable: true }); bad.push(getter);
  for (const value of bad) {
    assert.equal(validateRoutingAssessment(value, ["e1"]).ok, false);
    assert.equal(recommend(value).recommendation, "human");
  }
});

test("references require bounded unique generated local IDs; empty support abstains", () => {
  for (const evidence_refs of [["e2"], ["e1", "e1"], [1], ["raw/path"], ["e0"], ["e01"], Array(1), null, "e1", Array.from({ length: 41 }, (_, i) => `e${i + 1}`)]) assert.equal(validateRoutingAssessment(assessment({ evidence_refs }), ["e1"]).ok, false);
  assert.equal(validateRoutingAssessment(assessment({ evidence_refs: [] }), ["e1"]).ok, true);
  assert.equal(recommend(assessment({ evidence_refs: [] })).recommendation, "human");
  for (const evidenceIds of [undefined, ["e1", "e1"], ["local/path"], Array(1)]) assert.equal(validateRoutingAssessment(assessment(), evidenceIds).ok, false);
  assert.equal(validateRoutingAssessment(assessment({ evidence_refs: ["e2", "e1"] }), ["e1", "e2"]).ok, true);
});

test("every deterministic restriction wins against every provider classification", () => {
  assert.equal(routingEligibility(workflow()).eligible, true);
  for (const key of WORKFLOW_FIELDS) {
    const facts = workflow(); facts[key] = !facts[key];
    assert.equal(routingEligibility(facts).eligible, false);
    for (const likely_route of ROUTES) for (const rationale of RATIONALES) assert.equal(recommend(assessment({ likely_route, rationale, confidence: 1 }), facts).recommendation, "human");
    const missing = workflow(); delete missing[key];
    assert.equal(recommend(assessment(), missing).recommendation, "human");
    assert.equal(recommend(assessment(), { ...workflow(), [key]: "true" }).recommendation, "human");
  }
  for (const facts of [null, {}, { ...workflow(), authorize_repair: true }]) assert.equal(recommend(assessment(), facts).recommendation, "human");
  // Confirmed findings belong exclusively to the pre-existing repair selector.
  assert.equal(recommend(assessment(), { ...workflow(), confirmed_tester_findings: true }).recommendation, "human");
});

test("local failures and forged outcome envelopes never advance", () => {
  const options = { workflow: workflow(), evidenceIds: ["e1"] };
  for (const failure of ROUTING_FAILURES) assert.equal(recommendRouting({ status: "failed", failure }, options).recommendation, "human");
  for (const outcome of [null, {}, { status: "assessed" }, { status: "not-configured" }, { status: "failed", failure: "unknown" }, { status: "assessed", assessment: assessment(), dispatch: true }]) assert.equal(recommendRouting(outcome, options).recommendation, "human");
  assert.equal(recommendRouting({ status: "assessed", assessment: assessment() }).recommendation, "human");
});

test("deterministic recommendations do not mutate inputs or invoke a provider", () => {
  const freeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const value = freeze(assessment()); const facts = freeze(workflow());
  const before = JSON.stringify({ value, facts });
  const fetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network forbidden"); };
  try {
    assert.deepEqual(recommend(value, facts), recommend(value, facts));
    assert.equal(JSON.stringify({ value, facts }), before);
  } finally { globalThis.fetch = fetch; }
  // The implementation dependency graph contains no I/O or provider capability.
  const contract = readFileSync(new URL("../../../skills/orchestrate/engine/routing-contract.mjs", import.meta.url), "utf8");
  const policy = readFileSync(new URL("../../../skills/orchestrate/engine/routing-policy.mjs", import.meta.url), "utf8");
  assert.equal(/^import /m.test(contract), false);
  assert.deepEqual(policy.match(/^import .*$/gm), ['import { exactObject, validateRoutingAssessment, validateWorkflowFacts } from "./routing-contract.mjs";']);
});

test("shared preparation fixture rejects missing identity, facts and provenance", () => {
  assert.deepEqual(validatePreparation(preparation()), { ok: true, errors: [] });
  for (const key of Object.keys(preparation())) { const value = preparation(); delete value[key]; assert.equal(validatePreparation(value).ok, false); }
  for (const mutate of [
    (v) => { v.identity.head_sha = "stale"; },
    (v) => { v.concern.source = ""; },
    (v) => { v.requirements[0].summarized = "yes"; },
    (v) => { v.evidence[0].role = "developer"; },
    (v) => { v.evidence.push(v.evidence[0]); },
    (v) => { v.workflow.live_worker = "false"; },
  ]) { const value = preparation(); mutate(value); assert.equal(validatePreparation(value).ok, false); }
});

test("canonical fingerprint fixture is stable under object order and binds all inputs", () => {
  const value = fingerprintInput();
  const serialized = serializeRoutingFingerprintInput(value);
  assert.deepEqual(JSON.parse(serialized), value);
  const reverse = (v) => Array.isArray(v) ? v.map(reverse) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, entry]) => [k, reverse(entry)])) : v;
  assert.equal(serializeRoutingFingerprintInput(reverse(value)), serialized);
  for (const mutate of [
    (v) => { v.policy += "-next"; }, (v) => { v.model += "-next"; }, (v) => { v.provider = "other"; },
    (v) => { v.preparation.identity.head_sha = "b".repeat(40); },
    (v) => { v.preparation.concern.summary += " Changed."; },
    (v) => { v.preparation.evidence[0].source += " changed"; },
    (v) => { v.preparation.requirements[0].summarized = false; },
    (v) => { v.preparation.evidence[0].source_digest = "sha256:" + "4".repeat(64); },
    (v) => { v.preparation.workflow.live_worker = true; },
    (v) => { v.projection.concern += " Changed."; },
  ]) { const changed = fingerprintInput(); mutate(changed); assert.notEqual(serializeRoutingFingerprintInput(changed), serialized); }
  for (const invalid of [NaN, Infinity, undefined, () => {}, new Date(), Array(1)]) {
    const changed = fingerprintInput(); changed.projection.invalid = invalid;
    assert.throws(() => serializeRoutingFingerprintInput(changed));
  }
  const cycle = fingerprintInput(); cycle.projection.cycle = cycle;
  assert.throws(() => serializeRoutingFingerprintInput(cycle));
});

test("inherited iteration cannot disguise duplicate references or execute during validation", () => {
  let calls = 0;
  const refs = ["e1", "e1"];
  Object.setPrototypeOf(refs, Object.assign(Object.create(Array.prototype), {
    *[Symbol.iterator]() { calls++; yield "e1"; yield "e2"; },
  }));
  const value = assessment({ evidence_refs: refs });
  assert.equal(validateRoutingAssessment(value, ["e1", "e2"]).ok, false);
  assert.equal(recommend(value).recommendation, "human");
  assert.equal(validateRoutingAssessment(assessment(), refs).ok, false);
  assert.equal(calls, 0);
});

test("all array boundaries reject accessors, holes, extra keys and nonstandard prototypes", () => {
  let calls = 0;
  const malformed = [
    (items) => { Object.setPrototypeOf(items, null); },
    (items) => { Object.setPrototypeOf(items, Object.create(Array.prototype)); },
    (items) => { items.dispatch = true; },
    (items) => { Object.defineProperty(items, "dispatch", { value: true }); },
    (items) => { items[Symbol("dispatch")] = true; },
    (items) => { delete items[0]; },
    (items) => { Object.defineProperty(items, "0", { enumerable: false }); },
    (items) => { Object.defineProperty(items, "0", { get() { calls++; throw new Error("getter executed"); } }); },
    (items) => { items[Symbol.iterator] = function* () { calls++; }; },
  ];
  for (const mutate of malformed) {
    const refs = ["e1"]; mutate(refs);
    assert.equal(validateRoutingAssessment(assessment({ evidence_refs: refs }), ["e1"]).ok, false);
    assert.equal(validateRoutingAssessment(assessment(), refs).ok, false);
    assert.equal(recommend(assessment({ evidence_refs: refs })).recommendation, "human");
    for (const field of ["requirements", "evidence"]) {
      const value = preparation(); mutate(value[field]);
      assert.equal(validatePreparation(value).ok, false);
      assert.throws(() => serializeRoutingFingerprintInput({ ...fingerprintInput(), preparation: value }));
    }
    const value = fingerprintInput(); mutate(value.projection.evidence);
    assert.throws(() => serializeRoutingFingerprintInput(value));
  }
  assert.equal(calls, 0);
  // Ordinary immutable JSON data remains accepted at every boundary.
  assert.equal(validateRoutingAssessment(assessment({ evidence_refs: Object.freeze(["e1"]) }), Object.freeze(["e1"])).ok, true);
  const value = fingerprintInput();
  Object.freeze(value.preparation.requirements);
  Object.freeze(value.preparation.evidence);
  Object.freeze(value.projection.evidence);
  assert.equal(validatePreparation(value.preparation).ok, true);
  assert.deepEqual(JSON.parse(serializeRoutingFingerprintInput(value)), value);
});
