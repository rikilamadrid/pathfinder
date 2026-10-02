/** Bounded transient Adversary reports. No dispatch or lifecycle transitions. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseSource } from "../../../lib/evidence-references.mjs";
import { claimFor } from "./claims.mjs";
import { repositoryRoot } from "./git.mjs";
import { EXPERIMENT_JUDGE_KEYS, experimentJudgeErrors, secretScopeProblem } from "./judge-prose.mjs";
import { readEvidenceJudge } from "./mode.mjs";

export const EXPERIMENT_HEADING = "## Adversary experiments";
export const MAX_REPORT_BYTES = 32768;
const FIELDS = ["experiment_id", "contract", "hypothesis", "setup", "steps", "expected_result",
  "observed_result", "evidence", "reproducibility", "potential_impact", "verifier_instruction"];
const LISTS = new Set(["steps", "evidence"]);
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.trim() !== "" && value.length <= 2048;
// Verdict tokens belong to Tester. Evidence locators remain opaque.
const verdict = /\b(?:PASS|FAIL)\b|\bconfirmed\s+(?:findings?|defects?|failures?)\b|\bverdict\s*:/i;

export function validateExperimentReport(report) {
  const errors = [];
  if (!plainObject(report)) return { ok: false, errors: ["report must be an object"] };
  if (Buffer.byteLength(JSON.stringify(report, null, 2), "utf8") > MAX_REPORT_BYTES) errors.push("report exceeds 32 KiB");
  for (const key of Object.keys(report)) {
    if (!["ticket", "pr", "head_sha", "experiments"].includes(key)) errors.push(/^[a-z_]{1,32}$/.test(key) ? `unknown report field: ${key}` : "an unknown report field");
  }
  if (typeof report.ticket !== "string" || !/^\d+\.\d+$/.test(report.ticket)) errors.push("ticket must be a ticket key");
  if (!nonempty(report.pr) || !/^https:\/\/[^\s]+\/pull\/[1-9]\d*$/.test(report.pr)) errors.push("pr must be an exact pull request URL");
  if (typeof report.head_sha !== "string" || !/^[a-f0-9]{40}$/i.test(report.head_sha)) errors.push("head_sha must be the full PR head SHA");
  if (!Array.isArray(report.experiments) || report.experiments.length < 1 || report.experiments.length > 12) {
    errors.push("experiments must contain 1–12 attempted experiments");
    return { ok: false, errors };
  }
  const ids = new Set();
  for (const [index, experiment] of report.experiments.entries()) {
    const prefix = `experiment ${index + 1}`;
    if (!plainObject(experiment)) { errors.push(`${prefix} must be an object`); continue; }
    for (const key of Object.keys(experiment)) {
      if (!FIELDS.includes(key) && key !== "judge") errors.push(/^[a-z_]{1,32}$/.test(key) ? `${prefix}: unknown field ${key}` : `${prefix}: an unknown field`);
    }
    // The optional judge-facing projection: shape only here; its prose,
    // verdict words included, is checked at write time and again before any
    // judge is asked.
    if (experiment.judge !== undefined) errors.push(...experimentJudgeErrors(experiment, prefix, { prose: false }));
    for (const key of FIELDS) {
      const value = experiment[key];
      if (LISTS.has(key)) {
        if (!Array.isArray(value) || value.length < 1 || value.length > 20 || !value.every(nonempty)) {
          errors.push(`${prefix}: ${key} must contain 1–20 non-empty strings, at most 2048 characters each`);
          continue;
        }
        if (key === "evidence" && value.some((ref) => !parseSource(ref))) errors.push(`${prefix}: malformed evidence reference`);
      } else if (!nonempty(value)) {
        errors.push(`${prefix}: ${key} must be a non-empty string, at most 2048 characters`);
      }
      // Evidence locators are opaque; do not mistake a command's argument for a verdict.
      if (key !== "evidence" && (Array.isArray(value) ? value : [value]).some((item) => typeof item === "string" && verdict.test(item))) {
        errors.push(`${prefix}: ${key} declares a verdict or confirmed finding`);
      }
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(experiment.experiment_id ?? "")) errors.push(`${prefix}: invalid experiment_id`);
    if (ids.has(experiment.experiment_id)) errors.push(`${prefix}: duplicate experiment_id`);
    ids.add(experiment.experiment_id);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Problems that refuse writing this checkpoint for an Evidence Judge: each
 * experiment's projection prose, and its absence when the project names a
 * judge. Each names the field to rewrite, never its value.
 */
export function judgeProjectionErrors(report, { judgeEnabled = false } = {}) {
  return (Array.isArray(report?.experiments) ? report.experiments : []).flatMap((experiment, index) => {
    const prefix = `experiment ${index + 1}`;
    if (experiment?.judge === undefined) return judgeEnabled ? [`${prefix}: this project's Evidence Judge needs a judge-facing projection: add judge with contract_attacked, action_summary, expected_result and observation_summary`] : [];
    return experimentJudgeErrors(experiment, prefix);
  }).concat(acrossExperiments(report));
}

/** The secret-word window across experiments, in order, once each is valid on its own. */
function acrossExperiments(report) {
  const experiments = Array.isArray(report?.experiments) ? report.experiments : [];
  if (!experiments.every((experiment, index) => experiment?.judge !== undefined && experimentJudgeErrors(experiment, `experiment ${index + 1}`).length === 0)) return [];
  const problem = secretScopeProblem(experiments.flatMap((experiment) => EXPERIMENT_JUDGE_KEYS.map((key) => experiment.judge[key])));
  return problem ? [`judge prose across experiments must be rewritten: ${problem}`] : [];
}

export function renderExperimentReport(report) {
  const checked = validateExperimentReport(report);
  if (!checked.ok) throw new Error(checked.errors.join("; "));
  return `${EXPERIMENT_HEADING}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
}

/** Read exactly one section, with exactly one directly attached JSON block. */
export function readExperimentReport(text) {
  const headings = [...text.matchAll(/^## Adversary experiments[ \t]*\r?$/gm)];
  if (headings.length !== 1) return { ok: false, errors: ["expected exactly one Adversary experiments section"] };
  const start = headings[0].index;
  const rest = text.slice(start + headings[0][0].length);
  const end = rest.search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  const block = /^[ \t]*\r?\n(?:[ \t]*\r?\n)*```json\r?\n([\s\S]*?)^```[ \t]*\r?\n?[ \t\r\n]*$/m.exec(section);
  if (!block || block[0].length !== section.length) return { ok: false, errors: ["section must contain only its complete JSON report"] };
  if (Buffer.byteLength(block[1], "utf8") > MAX_REPORT_BYTES) return { ok: false, errors: ["report exceeds 32 KiB"] };
  let report;
  try { report = JSON.parse(block[1]); } catch { return { ok: false, errors: ["report is not valid JSON"] }; }
  const checked = validateExperimentReport(report);
  return checked.ok ? { ok: true, report } : checked;
}

/** Replace only this section. Claim lines, profile and other notes are untouched. */
export function replaceExperimentReport(text, report) {
  const section = renderExperimentReport(report);
  const headings = [...text.matchAll(/^## Adversary experiments[ \t]*\r?$/gm)];
  if (headings.length > 1) throw new Error("duplicate Adversary experiments sections; resolve before replacing");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const rendered = section.replace(/\n/g, eol);
  if (!headings.length) return `${text}${text.endsWith(eol) ? "" : eol}${eol}${rendered}`;
  const start = headings[0].index;
  const afterHeading = start + headings[0][0].length;
  const next = text.slice(afterHeading).search(/^## /m);
  const end = next < 0 ? text.length : afterHeading + next;
  return `${text.slice(0, start)}${rendered}${next < 0 ? "" : eol}${text.slice(end)}`;
}

// Optional report tool. Human-in-the-loop action needs no Node runtime.
// --checkpoint writes only the calling claim's transient file, never its State.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const checkpoint = args[0] === "--checkpoint";
    if (args.length !== (checkpoint ? 1 : 0)) throw new Error("usage: experiments.mjs [--checkpoint] < report.json");
    const input = readFileSync(0, "utf8");
    if (Buffer.byteLength(input, "utf8") > MAX_REPORT_BYTES) throw new Error("report exceeds 32 KiB");
    let report;
    try { report = JSON.parse(input); } catch { throw new Error("stdin is not valid JSON; nothing was written"); }
    const section = renderExperimentReport(report);
    if (checkpoint) {
      const root = repositoryRoot(process.cwd());
      const claim = root && claimFor(root, report.ticket);
      if (!claim?.worktree || resolve(root, claim.worktree) !== process.cwd()) throw new Error("run inside this ticket's claimed worktree");
      const path = join(process.cwd(), "context", "current-ticket.md");
      const text = readFileSync(path, "utf8");
      if (!new RegExp(`^- Ticket: ${report.ticket.replaceAll(".", "\\.")}(?:\\s|$)`, "m").test(text)) throw new Error("checkpoint ticket identity differs from report");
      const judge = judgeProjectionErrors(report, { judgeEnabled: readEvidenceJudge(root).explicit });
      if (judge.length) throw new Error(`judge-facing projection refused; nothing was written, and the raw evidence is unchanged: ${judge.join("; ")}`);
      writeFileSync(path, replaceExperimentReport(text, report), "utf8");
      console.log("Adversary experiments checkpoint written; State unchanged.");
    } else process.stdout.write(section);
  } catch (error) {
    console.error(`experiments: ${error.message}`);
    process.exitCode = 1;
  }
}
