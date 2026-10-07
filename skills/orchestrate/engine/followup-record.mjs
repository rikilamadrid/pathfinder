/** Local human follow-up provenance. No provider, state writer or dispatch. */
import { createHash } from "node:crypto";
export const FOLLOWUP_HEADING = "## Human follow-ups";
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export const followupDigest = (v) => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
export const checkpointDigest = (text) => createHash("sha256").update(text).digest("hex");
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === keys.sort().join();
const line = (v) => typeof v === "string" && v.trim() && v.length <= 2048 && !/[\r\n]/.test(v);
const hash = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function followupBindingErrors(v) {
  return exact(v, ["id", "concern", "response", "experiments_digest"]) && hash(v.id) && hash(v.concern) && line(v.response) && hash(v.experiments_digest) ? [] : ["invalid fresh follow-up binding/response"];
}
export function readFollowups(text) {
  const headings = [...text.matchAll(/^## Human follow-ups[ \t]*\r?$/gm)];
  const historical = [...text.matchAll(/^## Historical (Tester findings|Adversary experiments) ([a-f0-9]{64})[ \t]*\r?$/gm)];
  if (!headings.length) return historical.length ? { ok: false, errors: ["historical review evidence lost its follow-up checkpoint"] } : { ok: true, records: [] };
  try {
    if (headings.length !== 1) throw Error();
    const rest = text.slice(headings[0].index + headings[0][0].length).split(/^## /m)[0];
    const block = /^\s*```json\r?\n([\s\S]*?)\r?\n```\s*$/.exec(rest);
    if (!block || Buffer.byteLength(block[1]) > 65536) throw Error();
    const data = JSON.parse(block[1]);
    if (!exact(data, ["schema", "records"]) || data.schema !== "pathfinder.human-followups/1" || !Array.isArray(data.records) || !data.records.length || data.records.length > 20) throw Error();
    const ids = new Set();
    for (const r of data.records) {
      if (!exact(r, ["id", "request", "tester_digest", "experiments_digest"]) || !hash(r.id) || ids.has(r.id) || r.id !== followupDigest(r.request) || !hash(r.tester_digest) || !hash(r.experiments_digest) || requestErrors(r.request).length) throw Error();
      for (const role of ["Tester findings", ...(r.request.target === "adversary" ? ["Adversary experiments"] : [])]) {
        const archived = rawReport(text, `## Historical ${role} ${r.id}`);
        if (!archived) throw Error();
        const { followup, ...content } = archived;
        if (followupDigest(content) !== (role === "Tester findings" ? r.tester_digest : r.experiments_digest)) throw Error();
      }
      ids.add(r.id);
    }
    if (historical.some(h => !ids.has(h[2]))) throw Error();
    return { ok: true, records: data.records };
  } catch { return { ok: false, errors: ["invalid human follow-up checkpoint; human reconciliation required"] }; }
}
export function requestErrors(r) {
  return exact(r, ["schema", "ticket", "pr", "head_sha", "target", "concern", "checkpoint", "authorization"]) && r.schema === "pathfinder.human-followup/1" && /^\d+\.\d+$/.test(r.ticket) && /^https:\/\/[^\s]+\/pull\/[1-9]\d*$/.test(r.pr) && /^[a-f0-9]{40}$/.test(r.head_sha) && ["tester", "adversary"].includes(r.target) && exact(r.concern, ["id", "summary"]) && line(r.concern.id) && line(r.concern.summary) && hash(r.checkpoint) && exact(r.authorization, ["by", "kind", "direction"]) && r.authorization.by === "human" && r.authorization.kind === "review-follow-up" && line(r.authorization.direction) ? [] : ["explicit exact human follow-up request required"];
}
export function rawReport(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sections = [...text.matchAll(new RegExp(`^${escaped}[ \\t]*\\r?$`, "gm"))];
  if (sections.length !== 1) return null;
  const rest = text.slice(sections[0].index + sections[0][0].length).split(/^## /m)[0];
  try { return JSON.parse(/^\s*```json\r?\n([\s\S]*?)\r?\n```\s*$/.exec(rest)[1]); } catch { return null; }
}
/** Select only actual retirements for this report identity and role. A later
 * follow-up at another head never cancels an earlier head's obligation. */
export function applicableFollowups(records, identity, role) {
  return records.filter(({ request }) => request.ticket === identity.ticket && request.pr === identity.pr && request.head_sha === identity.head_sha && (role === "tester" || request.target === "adversary"));
}
/** Reader-side enforcement also rejects direct historical section replay. */
export function followupReportErrors(text, report, role) {
  const ledger = readFollowups(text);
  if (!ledger.ok) return ledger.errors;
  const applicable = applicableFollowups(ledger.records, report, role);
  const { followup, ...content } = report;
  if (applicable.some(retired => followupDigest(content) === (role === "tester" ? retired.tester_digest : retired.experiments_digest))) return ["retired report cannot regain authority by relabeling"];
  const r = applicable.at(-1);
  if (!r) return report.followup ? ["orphan follow-up binding"] : [];
  const binding = report.followup;
  if (followupBindingErrors(binding).length || binding.id !== r.id || binding.concern !== followupDigest(r.request.concern)) return ["fresh report must address current human-directed concern"];
  if (role === "tester") {
    const experiments = rawReport(text, "## Adversary experiments");
    if (!experiments || binding.experiments_digest !== followupDigest(experiments)) return ["Tester must independently review current experiment evidence"];
    if (followupReportErrors(text, experiments, "adversary").length) return ["fresh Adversary evidence required before Tester"];
  } else if (binding.experiments_digest !== r.experiments_digest) return ["Adversary follow-up baseline differs"];
  return [];
}
