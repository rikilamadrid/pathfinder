/** Recovery from the existing transient checkpoint, never Last or a live prompt. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readExperimentReport } from "./experiments.mjs";
import { readFindingsReport } from "./findings.mjs";

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
    return selected("repair", "repair", { report: findings.report, repair: origin, started });
  }
  if (claim.state === "done") {
    const prerequisite = reviewPrerequisite(claim, experiments, pr, head);
    if (!prerequisite.ok) return prerequisite;
    if (!currentFindings || findings.report.result !== "PASS") return refuse("done requires independent Tester PASS at current PR head");
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
  if (findings.ok && findings.report.ticket === claim.key && findings.report.pr === pr && findings.report.result === "findings" && claim.repair !== `completed:${findings.report.head_sha}`) {
    if (!currentFindings) return refuse("stale Tester findings; assess changed head before repair");
    return selected("repair", "repair", { report: findings.report, repair: findings.report.head_sha, legacy: prerequisite.legacy });
  }
  if (currentFindings && findings.report.result === "PASS") return selected(null, "done", { report: findings.report });
  return selected("review", "review", prerequisite);

}
