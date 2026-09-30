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

/** Pure stage selection. `repair` marks dispatch begun, retaining reviewed SHA. */
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
    if (claim.repair) {
      if (claim.repair !== findings.report.head_sha) return refuse("repair origin differs from reviewed findings");
    } else if (!currentFindings) return refuse("stale Tester findings before first repair dispatch");
    return selected("repair", "repair", { report: findings.report, repair: findings.report.head_sha });
  }
  if (claim.state === "done") {
    if (!currentFindings || findings.report.result !== "PASS") return refuse("done requires independent Tester PASS at current PR head");
    return selected(null, "done", { report: findings.report });
  }
  if (!["adversary", "review"].includes(claim.state)) return refuse(`cannot route recorded stage ${claim.state}`);
  if (claim.state === "adversary") return currentExperiments ? selected("review", "review", { experiments: experiments.report }) : selected("adversary", "adversary");
  // Findings checkpoint wins over a stale/missing experiment report: Tester
  // already independently reviewed it. Stale findings cannot become repairs.
  if (findings.ok && findings.report.ticket === claim.key && findings.report.pr === pr && findings.report.result === "findings" && claim.repair !== `completed:${findings.report.head_sha}`) {
    if (!currentFindings) return refuse("stale Tester findings; assess changed head before repair");
    return selected("repair", "repair", { report: findings.report, repair: findings.report.head_sha });
  }
  if (currentFindings && findings.report.result === "PASS") return selected(null, "done", { report: findings.report });
  if (claim.review?.startsWith("integration:")) {
    if (claim.review.slice(12).toLowerCase() !== head.toLowerCase()) return refuse("integration-only review head changed; full revalidation required");
    if (!(claim.next ?? "").includes(`verification and push complete at ${head}; Tester pending`)) return refuse("integration-only review lacks completed full verification/push checkpoint");
    return selected("review", "review", { integration: true });
  }
  if (legacy) {
    if (legacy[1].toLowerCase() !== head.toLowerCase()) return selected("adversary", "adversary");
    return selected("review", "review", { legacy: true });
  }
  return currentExperiments ? selected("review", "review", { experiments: experiments.report }) : selected("adversary", "adversary");
}
