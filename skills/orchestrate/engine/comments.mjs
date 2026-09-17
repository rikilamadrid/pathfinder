/**
 * Every sentence the orchestrator writes to the ticket store, in one place.
 *
 * One spelling each, so the tracker reads the same whichever run, session, or
 * machine wrote it. Every note opens with a marker line naming its event, its
 * ticket, and the facts that make it distinct:
 *
 *     <!-- pathfinder:orchestrate claimed 53.4 ticket/53.4-integration -->
 *
 * The marker is what makes a write idempotent. Before posting, the tracker is
 * read for that exact marker, and a note already there is not posted twice —
 * so a run that dies after writing and is resumed leaves one comment, not two.
 *
 * Notes are append-only history a person reads in order. Lifecycle status
 * stays in the store's own status representation, and nothing here writes it.
 */

import { createHash } from "node:crypto";

export const GATE_LABEL = "gate: human";

/** The marker line for one event. Arguments are joined with single spaces. */
export function marker(event, ...facts) {
  return `<!-- pathfinder:orchestrate ${[event, ...facts].join(" ")} -->`;
}

/** A short, stable digest of free text, so a marker can name it without quoting it. */
export function digest(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 12);
}

/** The calendar day of an ISO timestamp. The only clock a note shows is the one it was given. */
function day(now) {
  return String(now).slice(0, 10);
}

/** A claim, announced: who owns the ticket, where, and how it will run. */
export function claimedNote({ key, worker, branch, worktree, now, profile }) {
  const e = profile.estimate;
  const s = profile.selection;
  return {
    marker: marker("claimed", key, branch),
    body: [
      marker("claimed", key, branch),
      `**Claimed** by orchestrator worker \`${worker}\` on ${day(now)}.`,
      "",
      "| Branch | Worktree |",
      "| --- | --- |",
      `| \`${branch}\` | \`${worktree}\` |`,
      "",
      `Execution profile (${profile.schema}): complexity **${e.complexity.value}**, context **${e.context.value}**, ` +
        `parallel safety **${e["parallel-safety"].value}**, risk **${e.risk.value}** (${e.risk.source}).`,
      `Selection by the \`${s.policy}\` policy: role \`${s.role}\`, model \`${s.model}\`, effort \`${s.effort}\`.`,
      "",
      "The worktree is machine-local. Lifecycle status stays in this issue's status label.",
    ].join("\n"),
  };
}

/** A worker stopped for a human decision. */
export function gateOpenedNote({ key, question, now }) {
  return {
    marker: marker("gate-opened", key, digest(question)),
    body: [
      marker("gate-opened", key, digest(question)),
      `**Human gate opened** on ${day(now)}. Worker \`${key}\` has stopped and is waiting for this decision:`,
      "",
      ...String(question)
        .split(/\r?\n/)
        .map((line) => `> ${line}`),
      "",
      `Other workers continue. Work that depends on ${key} waits for it. The \`${GATE_LABEL}\` label stays on this issue until the gate is resolved.`,
    ].join("\n"),
  };
}

/** The human answered, and the worker resumes. */
export function gateResolvedNote({ key, question, answer, now }) {
  return {
    marker: marker("gate-resolved", key, digest(question ?? answer ?? "")),
    body: [
      marker("gate-resolved", key, digest(question ?? answer ?? "")),
      `**Human gate resolved** on ${day(now)}. Worker \`${key}\` resumes.`,
      ...(answer ? ["", "Decision:", "", ...String(answer).split(/\r?\n/).map((line) => `> ${line}`)] : []),
    ].join("\n"),
  };
}

/** Why an unfinished ticket was not dispatched. */
export function blockedNote({ key, waiting, reason }) {
  const facts = waiting.length > 0 ? waiting.join(",") : digest(reason);
  return {
    marker: marker("blocked", key, facts),
    body: [
      marker("blocked", key, facts),
      waiting.length > 0
        ? `**Not dispatched:** ${key} is blocked by ${waiting.map((k) => `\`${k}\``).join(", ")}. ` +
          "It becomes eligible when each is Complete."
        : `**Not dispatched:** ${reason}.`,
    ].join("\n"),
  };
}

/** A completion satisfied this ticket's last blocker. */
export function unblockedNote({ key, by }) {
  return {
    marker: marker("unblocked", key, by),
    body: [
      marker("unblocked", key, by),
      `**Now eligible:** ${by} is Complete, which was the last blocker of ${key}. ` +
        "The running orchestration may dispatch it under the approval it already holds.",
    ].join("\n"),
  };
}

/**
 * What one approval authorizes, stated in full before it is asked for.
 *
 * Deliberately excludes merging: a merge is presented per ticket by the
 * integrator, under the project's own merge policy.
 */
export function approvalScope({ scope, keys, workers }) {
  const tickets = keys.length > 0 ? keys.join(", ") : "none yet";
  return [
    `Approving this orchestration run (${scope}, at most ${workers} worker${workers === 1 ? "" : "s"}) authorizes:`,
    "",
    `- executing the approved tickets in scope as they become eligible (now: ${tickets}), which moves each from Proposed to Ready and then In Progress through the ordinary ticket lifecycle;`,
    "- claiming each in its own worktree under .pathfinder/worktrees, on its own ticket/<key>-<slug> branch;",
    "- commits and pushes on those ticket branches, and a draft pull request per ticket;",
    "- the tracker notes and gate labels skills/ticket/store.md describes.",
    "",
    "It does not authorize merging, releasing, or changing any ticket's substance. Each merge is presented separately.",
  ].join("\n");
}
