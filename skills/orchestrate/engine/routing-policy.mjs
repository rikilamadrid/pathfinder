/** Pure recommendations only: never a stage selector, dispatch or approval. */
import { exactObject, validateRoutingAssessment, validateWorkflowFacts } from "./routing-contract.mjs";
export const ROUTING_POLICY = "pathfinder.routing-policy/1";
// Conservative abstention setting, not calibrated accuracy. Independent of Judge.
export const MIN_ROUTING_CONFIDENCE = 0.8;
export const ROUTING_FAILURES = Object.freeze(["configuration", "timeout", "provider-error", "malformed", "outbound", "wrong-model"]);

/** Caller derives these facts from existing deterministic checks. This does
 * not replace selectStage or validate review reports. No positive result grants
 * permission to call a provider or changes an existing human boundary.
 */
export function routingEligibility(facts) {
  if (!validateWorkflowFacts(facts).ok) return { eligible: false, reason: "invalid-workflow-facts" };
  for (const key of ["identity_current", "evidence_current", "checkpoints_complete", "ownership_valid", "human_boundary", "unresolved_concern"]) {
    if (!facts[key]) return { eligible: false, reason: key };
  }
  for (const key of ["live_worker", "failed_without_guidance", "confirmed_tester_findings", "missing_required_reports", "known_concern"]) {
    if (facts[key]) return { eligible: false, reason: key };
  }
  return { eligible: true, reason: "unresolved-review-concern" };
}

/** Local outcome envelope: {status:'assessed', assessment} or
 * {status:'failed', failure:<bounded code>}. Never provider-supplied provenance.
 * All outputs are recommendations pending human direction, including Human.
 * Existing deterministic routing/restrictions remain untouched in every case.
 */
export function recommendRouting(outcome, { workflow, evidenceIds } = {}) {
  const answer = (recommendation, reason) => ({ policy: ROUTING_POLICY, recommendation, reason, requires_human_direction: true });
  const eligibility = routingEligibility(workflow);
  if (!eligibility.eligible) return answer("human", `workflow:${eligibility.reason}`);
  if (exactObject(outcome, ["status", "failure"]) && outcome.status === "failed" && ROUTING_FAILURES.includes(outcome.failure)) return answer("human", `failure:${outcome.failure}`);
  if (!exactObject(outcome, ["status", "assessment"]) || outcome.status !== "assessed") return answer("human", "invalid-outcome");
  const checked = validateRoutingAssessment(outcome.assessment, evidenceIds);
  if (!checked.ok) return answer("human", "invalid-assessment");
  const assessment = outcome.assessment;
  if (assessment.likely_route === "human" || assessment.concern !== "none") return answer("human", "human-clarification");
  if (assessment.confidence < MIN_ROUTING_CONFIDENCE) return answer("human", "low-confidence");
  if (assessment.evidence_refs.length === 0) return answer("human", "missing-support");
  return answer(assessment.likely_route, assessment.rationale);
}
