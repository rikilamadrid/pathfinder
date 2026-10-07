/** Explicit human direction retires report authority atomically; never dispatches. */
import { join, resolve } from "node:path";
import { claimFor } from "./claims.mjs";
import { resolveRef } from "./git.mjs";
import { mutateCheckpoint } from "./checkpoint-write.mjs";
import { updateStateText } from "./statefile.mjs";
import { readFindingsReport } from "./findings.mjs";
import { readExperimentReport } from "./experiments.mjs";
import { currentPr } from "./stage.mjs";
import { checkpointDigest, followupDigest, readFollowups, requestErrors, FOLLOWUP_HEADING } from "./followup-record.mjs";
export function humanDirectedFollowup({ root, request, live, gh = "gh" }) {
  try {
    request = structuredClone(request);
    if (requestErrors(request).length) throw Error("explicit human authorization and exact concern/identity required");
    if (!Array.isArray(live) || live.includes(request.ticket)) throw Error("explicit live-worker check required; no conflicting live worker permitted");
    const claim = claimFor(root, request.ticket);
    if (!claim?.worktree || claim.orphan || !claim.stateFile || claim.worker !== request.ticket) throw Error("follow-up requires owned readable claim");
    const worktree = resolve(root, claim.worktree);
    const identity = currentPr(root, claim.branch, gh);
    if (!identity.ok || identity.pr !== request.pr || identity.head !== request.head_sha || resolveRef(worktree, "HEAD") !== request.head_sha) throw Error("stale PR/head identity");
    return mutateCheckpoint(join(worktree, "context/current-ticket.md"), text => {
      const ledger = readFollowups(text);
      if (!ledger.ok) throw Error(ledger.errors.join("; "));
      const id = followupDigest(request);
      const field = name => { const m = [...text.matchAll(new RegExp(`^- ${name}: (.*)$`, "gm"))]; return m.length === 1 ? m[0][1].trim() : null; };
      if (field("Worker") !== request.ticket || field("Branch") !== claim.branch || field("Worktree") !== claim.worktree || !new RegExp(`^- Ticket: ${request.ticket.replaceAll(".", "\\.")} \\u2014`, "m").test(text)) throw Error("checkpoint ownership changed");
      if (field("State") === "human-gate" || field("Gate")) throw Error("follow-up cannot resolve a human gate");
      if (ledger.records.some(r => r.id === id)) {
        if (ledger.records.at(-1).id !== id) throw Error("historical direction cannot be replayed");
        return { value: { ok: true, duplicate: true, id } };
      }
      if (checkpointDigest(text) !== request.checkpoint) throw Error("stale checkpoint or concern; obtain fresh human direction");
      if (!["review", "done"].includes(field("State")) || field("Adversary") !== "required" || field("Review") !== "ordinary") throw Error("follow-up requires stopped ordinary review/done boundary");
      if (ledger.records.length >= 20) throw Error("follow-up history bound reached; human reconciliation required");
      const tester = readFindingsReport(text), experiments = readExperimentReport(text);
      for (const r of [tester, experiments]) if (!r.ok || r.report.ticket !== request.ticket || r.report.pr !== request.pr || r.report.head_sha !== request.head_sha) throw Error("complete current-head reports required");
      if (tester.report.result !== "PASS") throw Error("confirmed Tester findings retain exclusive repair authority");
      const withoutBinding = ({ followup, ...report }) => report;
      const record = { id, request, tester_digest: followupDigest(withoutBinding(tester.report)), experiments_digest: followupDigest(withoutBinding(experiments.report)) };
      text = text.replace(/^## Tester findings[ \t]*\r?$/m, `## Historical Tester findings ${id}`);
      if (request.target === "adversary") text = text.replace(/^## Adversary experiments[ \t]*\r?$/m, `## Historical Adversary experiments ${id}`);
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      const section = `${FOLLOWUP_HEADING}\n\n\`\`\`json\n${JSON.stringify({ schema: "pathfinder.human-followups/1", records: [...ledger.records, record] }, null, 2)}\n\`\`\`\n`.replace(/\n/g, eol);
      if (Buffer.byteLength(section) > 65536) throw Error("follow-up history byte bound reached; human reconciliation required");
      const start = text.indexOf(FOLLOWUP_HEADING);
      if (start < 0) text += eol + section;
      else { const end = text.slice(start + FOLLOWUP_HEADING.length).search(/^## /m); text = text.slice(0, start) + section + (end < 0 ? "" : eol + text.slice(start + FOLLOWUP_HEADING.length + end)); }
      text = updateStateText(text, { set: { State: request.target === "tester" ? "review" : "adversary", Next: `fresh ${request.target} evidence for human follow-up ${id}; no automatic dispatch`, Updated: new Date().toISOString() } });
      return { text, value: { ok: true, duplicate: false, id } };
    });
  } catch (error) { return { ok: false, message: error.message }; }
}
