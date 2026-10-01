/** Independent Tester's bounded transient review handoff; no lifecycle writes. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseSource } from "../../../lib/evidence-references.mjs";
import { claimFor } from "./claims.mjs";
import { repositoryRoot } from "./git.mjs";

export const FINDINGS_HEADING = "## Tester findings";
const nonempty = (v) => typeof v === "string" && v.trim() !== "" && v.length <= 2048;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (v) => Array.isArray(v) && v.length >= 1 && v.length <= 20 && v.every(nonempty);
export function validateFindingsReport(report) {
  const errors = [];
  if (!object(report)) return { ok: false, errors: ["review must be an object"] };
  if (Buffer.byteLength(JSON.stringify(report, null, 2)) > 32768) errors.push("review exceeds 32 KiB");
  for (const key of Object.keys(report)) if (!["ticket", "pr", "head_sha", "result", "findings", "verification", "limits"].includes(key)) errors.push(`unknown review field: ${key}`);
  if (typeof report.ticket !== "string" || !/^\d+\.\d+$/.test(report.ticket)) errors.push("invalid ticket");
  if (typeof report.pr !== "string" || !/^https:\/\/[^\s]+\/pull\/[1-9]\d*$/.test(report.pr ?? "")) errors.push("invalid PR URL");
  if (typeof report.head_sha !== "string" || !/^[a-f0-9]{40}$/i.test(report.head_sha)) errors.push("invalid reviewed SHA");
  if (!["PASS", "findings"].includes(report.result)) errors.push("result must be PASS or findings");
  if (!list(report.verification) || !nonempty(report.limits)) errors.push("actual verification and limits required");
  if (!Array.isArray(report.findings) || report.findings.length > 12 || (report.result === "PASS" ? report.findings.length !== 0 : report.findings.length === 0)) errors.push("PASS has no findings; findings requires 1–12 findings");
  for (const f of Array.isArray(report.findings) ? report.findings : []) {
    if (!object(f)) { errors.push("finding must be an object"); continue; }
    const fields = ["severity", "location", "impact", "evidence", "repair_instruction"];
    if (Object.keys(f).some((key) => !fields.includes(key)) || fields.some((key) => key === "evidence" ? !list(f[key]) || f[key].some((r) => !parseSource(r)) : !nonempty(f[key]))) errors.push("complete finding severity/location/impact/evidence/repair_instruction required");
  }
  return { ok: errors.length === 0, errors };
}
export function renderFindingsReport(report) {
  const checked = validateFindingsReport(report);
  if (!checked.ok) throw new Error(checked.errors.join("; "));
  return `${FINDINGS_HEADING}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
}
export function readFindingsReport(text) {
  const headings = [...text.matchAll(/^## Tester findings[ \t]*\r?$/gm)];
  if (headings.length !== 1) return { ok: false, errors: ["expected exactly one Tester findings section"] };
  const rest = text.slice(headings[0].index + headings[0][0].length);
  const end = rest.search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  const block = /^[ \t]*\r?\n(?:[ \t]*\r?\n)*```json\r?\n([\s\S]*?)^```[ \t]*\r?\n?[ \t\r\n]*$/m.exec(section);
  if (!block || block[0].length !== section.length || Buffer.byteLength(block[1]) > 32768) return { ok: false, errors: ["incomplete bounded JSON review"] };
  let report; try { report = JSON.parse(block[1]); } catch { return { ok: false, errors: ["invalid JSON review"] }; }
  const checked = validateFindingsReport(report);
  return checked.ok ? { ok: true, report } : checked;
}
export function replaceFindingsReport(text, report) {
  const section = renderFindingsReport(report);
  const headings = [...text.matchAll(/^## Tester findings[ \t]*\r?$/gm)];
  if (headings.length > 1) throw new Error("duplicate Tester findings sections");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const rendered = section.replace(/\n/g, eol);
  if (!headings.length) return `${text}${text.endsWith(eol) ? "" : eol}${eol}${rendered}`;
  const start = headings[0].index;
  const after = start + headings[0][0].length;
  const next = text.slice(after).search(/^## /m);
  return text.slice(0, start) + rendered + (next < 0 ? "" : eol + text.slice(after + next));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.slice(2).join(" ") !== "--checkpoint") throw new Error("usage: findings.mjs --checkpoint < review.json");
    const input = readFileSync(0, "utf8");
    if (Buffer.byteLength(input) > 32768) throw new Error("review exceeds 32 KiB");
    const report = JSON.parse(input);
    const root = repositoryRoot(process.cwd());
    const claim = root && claimFor(root, report.ticket);
    if (!claim?.worktree || resolve(root, claim.worktree) !== process.cwd()) throw new Error("run inside this ticket's claimed worktree");
    const path = join(process.cwd(), "context/current-ticket.md");
    const text = readFileSync(path, "utf8");
    if (!new RegExp(`^- Ticket: ${report.ticket.replaceAll(".", "\\.")}(?:\\s|$)`, "m").test(text)) throw new Error("checkpoint ticket identity differs from review");
    writeFileSync(path, replaceFindingsReport(text, report));
    console.log("Tester findings checkpoint written; State unchanged.");
  } catch (error) { console.error(`findings: ${error.message}`); process.exitCode = 1; }
}
