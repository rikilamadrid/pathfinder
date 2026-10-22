import { readFollowups } from "./followup-record.mjs";
/** Recovery from the existing transient checkpoint, never Last or a live prompt. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readExperimentReport } from "./experiments.mjs";
import { checkpointIds, readFindingsReport, unclearRequirementIds } from "./findings.mjs";

export function currentPr(root, branch, gh = "gh") {
  const result = spawnSync(gh, ["pr", "view", branch, "--json", "url,headRefOid"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return { ok: false, message: `cannot identify current PR: ${(result.stderr || "gh failed").trim()}` };
  try {
    const data = JSON.parse(result.stdout);
    if (!/^https:\/\/[^\s]+\/pull\/[1-9]\d*$/.test(data.url) || !/^[a-f0-9]{40}$/i.test(data.headRefOid)) throw new Error("invalid PR identity");
    return { ok: true, pr: data.url, head: data.headRefOid };
  } catch { return { ok: false, message: "cannot identify exact current PR head" }; }
}
export function checkpointText(root, claim) {
  return readFileSync(join(root, claim.worktree, "context/current-ticket.md"), "utf8");
}
const refuse = (message) => ({ ok: false, message });
const selected = (session, state, extra = {}) => ({ ok: true, session, state, ...extra });
const matches = (report, claim, pr, head) => report?.ticket === claim.key && report?.pr === pr && report?.head_sha.toLowerCase() === head.toLowerCase();

/** Repair rounds a claim may run before the engine asks the human. */
export const REPAIR_ROUND_LIMIT = 2;
/** The recorded `Repair rounds`: a count, or null when it is unknown. */
export function recordedRepairRounds(claim) {
  const value = claim.repairRounds;
  if (value === undefined || value === null) return claim.repair ? null : 0;
  return /^(0|[1-9]\d{0,3})$/.test(value) ? Number(value) : null;
}
/**
 * The engine-held repair budget. Selecting a repair of a new origin counts one
 * more round; a pending or started repair of the same origin is the round
 * already counted. A round beyond the limit, or any round on an unknown
 * count, is the human's decision and dispatches nothing.
 */
export function repairBudget(claim, report, origin) {
  const recorded = recordedRepairRounds(claim);
  if ([origin, `pending:${origin}`, `started:${origin}`].includes(claim.repair)) return { ok: true, rounds: recorded };
  const ids = report.findings.map((finding, index) => typeof finding.id === "string" ? finding.id : `#${index + 1}`).join(", ");
  if (recorded === null) return { ok: false, rounds: null, gate: `repair round count unknown: ${ids}` };
  if (recorded + 1 > REPAIR_ROUND_LIMIT) return { ok: false, rounds: recorded + 1, gate: `repair budget exhausted after ${recorded} rounds: ${ids}` };
  return { ok: true, rounds: recorded + 1 };
}
/** A repair selection, or the human gate the budget opens in its place. */
function repairOrGate(claim, report, origin, extra) {
  const budget = repairBudget(claim, report, origin);
  if (!budget.ok) return selected(null, "human-gate", { gate: budget.gate, gateStage: "repair", report, repair: origin, rounds: budget.rounds, started: false, legacy: extra.legacy });
  return selected("repair", "repair", { report, repair: origin, rounds: budget.rounds, ...extra });
}

/**
 * A report's unclear-requirement ids, split into those not yet put to a human
 * (`pending`, which gate) and those a gate already asked (`answered`, which
 * need a fresh Tester review from that decision); `{ error }` on a damaged
 * `Gated requirements` line.
 */
export function unclearRequirements(claim, report) {
  let gated;
  try { gated = checkpointIds(claim.gatedRequirements, "Gated requirements"); } catch (error) { return { error: error.message }; }
  const unclear = unclearRequirementIds(report);
  return { gated, pending: unclear.filter((id) => !gated.includes(id)), answered: unclear.filter((id) => gated.includes(id)) };
}
/** Refuses a repair or done that a report's unclear requirement must stop. */
function unclearRefusal(claim, report, stage) {
  const unclear = unclearRequirements(claim, report);
  if (unclear.error) return refuse(unclear.error);
  const ids = [...unclear.pending, ...unclear.answered];
  return ids.length ? refuse(`unclear requirement ${ids.join(", ")} in the Tester report needs a human decision and a fresh Tester review; never ${stage}`) : null;
}

/** A review's required upstream evidence, also retained at the repair origin. */
function reviewPrerequisite(claim, experiments, pr, head) {
  if (claim.review?.startsWith("integration:")) {
    if (claim.review.slice(12).toLowerCase() !== head.toLowerCase()) return refuse("integration-only review head changed; full revalidation required");
    // Owning begin-repair validates full verification and exact-head freshness
    // before writing this marker. Consume that prerequisite at start: Next
    // remains a mutable progress instruction during partial repair.
    const startedOrigin = claim.state === "repair" && claim.repair === `started:${head}`;
    if (!startedOrigin && !(claim.next ?? "").includes(`verification and push complete at ${head}; Tester pending`)) return refuse("integration-only review lacks completed full verification/push checkpoint");
    return { ok: true, integration: true };
  }
  const legacy = /^legacy-review:([a-f0-9]{40})$/i.exec(claim.adversary ?? "");
  const repairLegacy = claim.state === "repair" ? /^legacy:([a-f0-9]{40})$/i.exec(claim.review ?? "") : null;
  if ((legacy?.[1] ?? repairLegacy?.[1])?.toLowerCase() === head.toLowerCase()) return { ok: true, legacy: true };
  return experiments.ok && matches(experiments.report, claim, pr, head)
    ? { ok: true, experiments: experiments.report }
    : refuse("ordinary review requires complete SHA-matching Adversary experiments before Tester evidence authorizes repair/done");
}

/** Pure stage selection. Pending dispatch never means a Developer started. */
export function selectStage({ claim, text, pr, head, live = [] }) {
  if (live.includes(claim.key)) return refuse(`${claim.key} already has a live session`);
  if (claim.orphan || !claim.stateFile) return refuse("claim has no readable checkpoint");
  if (claim.state === "human-gate") return refuse(`human gate: ${claim.gate}`);
  if (claim.state === "failed") return refuse("failed claim needs human guidance");
  const legacy = /^legacy-review:([a-f0-9]{40})$/i.exec(claim.adversary ?? "");
  if (claim.adversary !== "required" && !legacy) return refuse("missing/unreadable Adversary compatibility marker; explicit safe-boundary adoption required");
  const followups = readFollowups(text);
  if (!followups.ok) return refuse(followups.errors.join("; "));
  if (claim.state === "working") {
    const refresh = /\b(merge-and-reverify|rebase-and-reverify|resolve-conflict)\b/.exec(claim.next ?? "");
    return selected(refresh ? refresh[1] : "resume", "working");
  }
  const findings = readFindingsReport(text);
  const currentFindings = findings.ok && matches(findings.report, claim, pr, head);
  const experiments = readExperimentReport(text);
  const currentExperiments = experiments.ok && matches(experiments.report, claim, pr, head);
  if (claim.state === "repair") {
    if (!findings.ok || findings.report.result !== "findings" || findings.report.ticket !== claim.key || findings.report.pr !== pr) return refuse("repair requires complete confirmed Tester findings, never Last");
    const origin = findings.report.head_sha;
    const started = claim.repair === `started:${origin}`;
    if (claim.repair && ![origin, `pending:${origin}`, `started:${origin}`].includes(claim.repair)) return refuse("repair origin differs from reviewed findings");
    if (!started && !currentFindings) return refuse("stale Tester findings before first repair worker starts");
    const prerequisite = reviewPrerequisite(claim, experiments, pr, origin);
    if (!prerequisite.ok) return prerequisite;
    const unclear = unclearRefusal(claim, findings.report, "repair");
    if (unclear) return unclear;
    return repairOrGate(claim, findings.report, origin, { started });
  }
  if (claim.state === "done") {
    const prerequisite = reviewPrerequisite(claim, experiments, pr, head);
    if (!prerequisite.ok) return prerequisite;
    if (!currentFindings || findings.report.result !== "PASS") return refuse("done requires independent Tester PASS at current PR head");
    const unclear = unclearRefusal(claim, findings.report, "done");
    if (unclear) return unclear;
    return selected(null, "done", { report: findings.report });
  }
  if (!["adversary", "review"].includes(claim.state)) return refuse(`cannot route recorded stage ${claim.state}`);
  if (claim.state === "adversary") return currentExperiments ? selected("review", "review", { experiments: experiments.report }) : selected("adversary", "adversary");
  // Validate the required Adversary seam BEFORE any downstream report gains
  // authority. Preserve a complete review report when upstream evidence is lost.
  const prerequisite = reviewPrerequisite(claim, experiments, pr, head);
  if (!prerequisite.ok) {
    if (findings.ok || claim.review?.startsWith("integration:")) return prerequisite;
    return selected("adversary", "adversary");
  }
  // An unclear requirement at the current head is the human's, whatever else
  // the report says: it gates before any repair or done. Once that gate has
  // asked it, the report that raised it needs a fresh Tester review.
  if (currentFindings) {
    const unclear = unclearRequirements(claim, findings.report);
    if (unclear.error) return refuse(unclear.error);
    if (unclear.pending.length) return selected(null, "human-gate", { gate: `unclear requirement: ${unclear.pending.join(", ")}`, gateStage: "review", report: findings.report, gatedRequirements: [...unclear.gated, ...unclear.pending] });
    if (unclear.answered.length) return selected("review", "review", { ...prerequisite, clarified: unclear.answered });
  }
  if (findings.ok && findings.report.ticket === claim.key && findings.report.pr === pr && findings.report.result === "findings" && claim.repair !== `completed:${findings.report.head_sha}`) {
    if (!currentFindings) return refuse("stale Tester findings; assess changed head before repair");
    return repairOrGate(claim, findings.report, findings.report.head_sha, { legacy: prerequisite.legacy });
  }
  if (currentFindings && findings.report.result === "PASS") return selected(null, "done", { report: findings.report });
  return selected("review", "review", prerequisite);

}
