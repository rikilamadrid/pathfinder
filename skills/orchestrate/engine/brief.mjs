/**
 * `dispatch(brief)` — the third step. This module builds the brief and says
 * how one harness would honour it; starting the session is the harness's.
 *
 * A brief carries `role`, `model`, and `effort` as first-class fields whatever
 * their values. `inherited` is a value, not an absence. That is what keeps the
 * seam open: a later routing policy changes what goes in those three fields,
 * and nothing about how a brief is built, read, or translated has to move.
 *
 * Translation is where a harness meets the brief, and it has two outcomes
 * only: honoured exactly, or refused by name. A value the harness cannot take
 * is never quietly dropped to `inherited` and never quietly rewritten into
 * something nearby — both would dispatch a different session than the one the
 * policy chose, and say nothing.
 */

import { isAbsolute } from "node:path";
import { TOKEN } from "./profile.mjs";
import { isKey } from "./keys.mjs";

export const BRIEF_FIELDS = Object.freeze([
  "ticket",
  "title",
  "ref",
  "session",
  "worktree",
  "main",
  "branch",
  "role",
  "model",
  "effort",
  "approval",
  "protocol",
]);

/**
 * The ordered steps, per session. Implementation builds the ticket; review
 * verifies it and changes nothing. 53.3's worker and resume briefs start from
 * these; a caller may pass its own `protocol`, but never one session's steps
 * for the other.
 */
export const PROTOCOLS = Object.freeze({
  implementation: Object.freeze([
    "Work only inside the worktree named above: run every command there, and write only there.",
    "Read skills, code, and tracked context from the worktree. Read context/tracker.md and the Feature spec from the main checkout named above whenever the worktree has no copy — they may be untracked there, and the main checkout is where they live.",
    "Run /ticket load <ticket>, then /ticket start, as the role named above.",
    "Verify the work as the ticket's ## Verification says.",
    "Commit on the ticket branch, push it, and open a draft pull request against the default branch whose body says <closes>.",
    "On a human decision: set State: human-gate and Gate: <question> in context/current-ticket.md, then stop and report GATE: <question>.",
    "When verified, committed, pushed, and the draft pull request is open: set State: done and report DONE: <pull request>.",
    "When the work cannot be completed inside the ticket: set State: failed and report FAILED: <reason>.",
    "Never merge, and never change another ticket's worktree.",
  ]),
  resume: Object.freeze([
    "Work only inside the worktree named above: run every command there, and write only there.",
    "Read skills, code, and tracked context from the worktree. Read context/tracker.md and the Feature spec from the main checkout named above whenever the worktree has no copy — they may be untracked there, and the main checkout is where they live.",
    "Read context/current-ticket.md first. Continue from its Next line and the commits already on the branch; do not restart work that is already done.",
    "If a human gate was just resolved, the decision is in the ticket's latest gate note: act on it.",
    "Run /ticket load <ticket>, then /ticket start, as the role named above. Both leave an In Progress ticket as it is.",
    "Verify the work as the ticket's ## Verification says.",
    "Commit on the ticket branch, push it, and keep or open a draft pull request against the default branch whose body says <closes>.",
    "On a human decision: set State: human-gate and Gate: <question> in context/current-ticket.md, then stop and report GATE: <question>.",
    "When verified, committed, pushed, and the draft pull request is open: set State: done and report DONE: <pull request>.",
    "When the work cannot be completed inside the ticket: set State: failed and report FAILED: <reason>.",
    "Never merge, and never change another ticket's worktree.",
  ]),
  "rebase-and-reverify": Object.freeze([
    "Work only inside the worktree named above: run every command there, and write only there.",
    "Read context/current-ticket.md first, then the ticket and Feature spec; read tracker and Feature from the main checkout when absent here. Preserve the ticket, branch, worktree, recorded profile, and completed work.",
    "The integration coordinator must explicitly authorise any history rewrite required by the project workflow. If that permission is absent, report GATE before rewriting or force-pushing.",
    "Rebase this existing branch onto the current default branch in this worktree, then rerun every check in the ticket’s ## Verification. If rebasing conflicts, stop and report the paths; do not discard work.",
    "Commit any repairs, push the verified branch under the approved Git policy, and update the existing pull request with verification evidence. Never open a duplicate PR.",
    "On a human decision: set State: human-gate and Gate: <question>, then report GATE: <question>.",
    "When verified and pushed: set State: done and report DONE: <pull request>. The coordinator sends it through independent review and a fresh integration check.",
    "When work cannot be completed inside this ticket: set State: failed and report FAILED: <reason>.",
    "Never merge, and never change another ticket’s worktree.",
  ]),
  "resolve-conflict": Object.freeze([
    "Work only inside the worktree named above: run every command there, and write only there.",
    "Read context/current-ticket.md first, then the ticket and Feature spec; read tracker and Feature from the main checkout when absent here. Preserve the ticket, branch, worktree, recorded profile, and completed work.",
    "The integration coordinator must explicitly authorise any history rewrite required by the project workflow. If that permission is absent, report GATE before rewriting or force-pushing.",
    "Read the integration conflict evidence appended to this brief. Resolve only those conflicts in this existing worktree against the current default branch, preserving both tickets’ accepted scope. If intent is ambiguous or resolution needs wider changes, report GATE instead of guessing. Rerun every check in the ticket’s ## Verification.",
    "Commit any repairs, push the verified branch under the approved Git policy, and update the existing pull request with verification evidence. Never open a duplicate PR.",
    "On a human decision: set State: human-gate and Gate: <question>, then report GATE: <question>.",
    "When verified and pushed: set State: done and report DONE: <pull request>. The coordinator sends it through independent review and a fresh integration check.",
    "When work cannot be completed inside this ticket: set State: failed and report FAILED: <reason>.",
    "Never merge, and never change another ticket’s worktree.",
  ]),
  review: Object.freeze([
    "Work only inside the worktree named above. Change no implementation, commit nothing, and push nothing.",
    "Read context/tracker.md and the Feature spec from the main checkout named above whenever the worktree has no copy.",
    "Set State: review in context/current-ticket.md, then run /ticket review as the role named above.",
    "Report PASS, or the findings by severity with file and line, and what was and was not verified.",
    "On a question only a human can answer: set State: human-gate and Gate: <question> in context/current-ticket.md, then stop and report GATE.",
  ]),
});

/**
 * Build a brief. Pure: same inputs, same object, same bytes.
 *
 * @returns {{ok: true, brief: object} | {ok: false, message: string}}
 */
export function buildBrief({ ticket, title, ref, session = "implementation", worktree, main, branch, selection, approval, protocol = null }) {
  if (!Object.hasOwn(PROTOCOLS, session)) {
    return { ok: false, usage: true, message: `session must be ${Object.keys(PROTOCOLS).join(", ")}, not \`${session}\`` };
  }
  const steps = protocol ?? PROTOCOLS[session];
  const missing = [];
  for (const [name, value] of Object.entries({ ticket, title, ref, worktree, main, branch, approval })) {
    if (typeof value !== "string" || value.trim() === "") missing.push(name);
  }
  for (const field of ["role", "model", "effort"]) {
    if (typeof selection?.[field] !== "string" || !TOKEN.test(selection[field])) missing.push(field);
  }
  if (missing.length > 0) return { ok: false, message: `a brief needs ${missing.join(", ")}` };

  return {
    ok: true,
    brief: {
      ticket,
      title,
      ref,
      session,
      worktree,
      main,
      branch,
      role: selection.role,
      model: selection.model,
      effort: selection.effort,
      approval,
      protocol: [...steps],
    },
  };
}

/** The brief as the text a session is started with. */
export function formatBrief(brief) {
  return [
    `Pathfinder worker brief — ${brief.ticket} ${brief.title} (${brief.ref})`,
    "",
    `Session:   ${brief.session}`,
    `Role:      ${brief.role}`,
    `Model:     ${brief.model}`,
    `Effort:    ${brief.effort}`,
    `Worktree:  ${brief.worktree}`,
    `Main:      ${brief.main}`,
    `Branch:    ${brief.branch}`,
    `Approval:  ${brief.approval}`,
    "",
    ...brief.protocol.map(
      (step, index) =>
        `${index + 1}. ${step
          .replaceAll("<ticket>", brief.ticket)
          .replaceAll("<closes>", brief.ref.startsWith("#") ? `Closes ${brief.ref}` : `the ticket ${brief.ref}`)}`,
    ),
    "",
  ].join("\n");
}

// Accepted overrides of Codex's collaboration.spawn_agent tool: the
// list-visible models of the Codex CLI 0.154.0 model catalog, each with the
// reasoning levels that catalog says it supports. These are adapter input
// limits, not routing choices: the policy still selects values. Codex validates
// model and effort again at call time and names what it refuses, so a catalog
// change fails loudly rather than dispatching a different session. An inherited
// model accepts only the intersection, since the parent's model is not known
// to this pure translation boundary.
const CODEX_EFFORTS = Object.freeze({
  "gpt-6-astra": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
  "gpt-5.6-sol": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
  "gpt-5.6-terra": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
  "gpt-5.6-luna": Object.freeze(["low", "medium", "high", "xhigh", "max"]),
  "gpt-5.5": Object.freeze(["low", "medium", "high", "xhigh"]),
  "gpt-5.2": Object.freeze(["low", "medium", "high", "xhigh"]),
});

/**
 * Canonical native task identity. Codex CLI 0.154.0 validates a spawned
 * agent's name as non-empty, lowercase letters, digits, and underscores only,
 * containing no `/`, and not the reserved `root`; it states no length limit.
 * The `pathfinder_` prefix settles the reserved-name and separator rules for
 * every name built here. Ticket components stay byte-for-byte intact; session
 * names come from the finite protocol domain, not arbitrary slugs. Refuse a
 * future protocol collision instead of silently sharing an identity, and
 * never truncate a key.
 */
function codexTaskName(ticket, session) {
  if (!isKey(ticket)) {
    return { ok: false, message: "Codex task name needs a Pathfinder ticket key (digits.digits)." };
  }
  if (typeof session !== "string" || !Object.hasOwn(PROTOCOLS, session)) {
    return { ok: false, message: `Codex task name needs a supported session: ${Object.keys(PROTOCOLS).join(", ")}.` };
  }
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const normalized = normalize(session);
  if (!/[a-z0-9]/.test(normalized)
      || Object.keys(PROTOCOLS).filter((value) => normalize(value) === normalized).length !== 1) {
    return { ok: false, message: `Codex task name cannot uniquely represent session \`${session}\`; refusing an ambiguous identity.` };
  }
  return { ok: true, name: `pathfinder_${ticket.replace(".", "_")}_${normalized}` };
}

function codexInvocation(brief) {
  const task = codexTaskName(brief.ticket, brief.session);
  if (!task.ok) return task;
  if (!isAbsolute(brief.worktree)) {
    return { ok: false, message: "Codex subagent needs an absolute worktree path; its spawn tool has no working-directory argument." };
  }
  if (brief.model !== "inherited" && brief.effort === "inherited") {
    return {
      ok: false,
      message: `Codex subagent cannot honour model \`${brief.model}\` with effort \`inherited\`: an omitted reasoning_effort inherits the parent's effort, which \`${brief.model}\` may not support, so the session could not be guaranteed to run at the effort the policy meant. Name an explicit supported effort or inherit both.`,
    };
  }
  if (brief.effort !== "inherited") {
    const allowed = brief.model === "inherited"
      ? Object.values(CODEX_EFFORTS)[0].filter((effort) => Object.values(CODEX_EFFORTS).every((values) => values.includes(effort)))
      : CODEX_EFFORTS[brief.model];
    if (!allowed.includes(brief.effort)) {
      return {
        ok: false,
        message: `Codex subagent cannot honour effort \`${brief.effort}\` with model \`${brief.model}\`: supported efforts are ${allowed.join(", ")}. Refusing rather than dispatching at a different effort.`,
      };
    }
  }

  const inherited = brief.model === "inherited" && brief.effort === "inherited";
  const args = {
    task_name: task.name,
    fork_turns: inherited ? "all" : "none",
    message: [
      `Your assigned worktree is ${JSON.stringify(brief.worktree)}. The spawn tool does not change directory. Set workdir to this absolute path on EVERY shell call; use absolute paths inside it for file edits. Never assume your inherited working directory is this worktree.`,
      `Assume the ${brief.role} role: read roles/${brief.role}.md in that worktree before acting. The brief's approval and ticket scope govern this session, including when prior conversation is inherited.`,
      "",
      formatBrief(brief),
    ].join("\n"),
  };
  if (brief.model !== "inherited") args.model = brief.model;
  if (brief.effort !== "inherited") args.reasoning_effort = brief.effort;
  return { ok: true, harness: "codex", invocation: { tool: "collaboration.spawn_agent", arguments: args } };
}

/**
 * How each harness honours a brief. One row per harness; a new harness is a
 * new row. `models` is the set of values the harness's session primitive
 * accepts for a model override, and `effort` whether it takes an effort at all.
 */
export const HARNESS_TRANSLATIONS = Object.freeze({
  "claude-code": Object.freeze({
    label: "Claude Code background subagent",
    models: Object.freeze(["opus", "sonnet", "haiku", "fable"]),
    modelHint: "a family alias (opus, sonnet, haiku, fable), not a pinned model ID",
    effort: false,
    effortHint: "the subagent call takes no reasoning-effort setting",
  }),
  codex: Object.freeze({
    label: "Codex subagent",
    models: Object.freeze(Object.keys(CODEX_EFFORTS)),
    modelHint: `one of ${Object.keys(CODEX_EFFORTS).join(", ")}`,
    effort: true,
    translate: codexInvocation,
  }),
  manual: Object.freeze({
    label: "a session the human starts from the printed brief",
    models: null,
    modelHint: null,
    effort: true,
  }),
});

/**
 * Translate a brief for one harness.
 *
 * @returns {{ok: true, harness: string, invocation: object}
 *         | {ok: false, message: string}}
 */
export function translateBrief(brief, harness) {
  const row = HARNESS_TRANSLATIONS[harness];
  if (!row) {
    return { ok: false, message: `no translation for harness \`${harness}\`. Known: ${Object.keys(HARNESS_TRANSLATIONS).join(", ")}` };
  }

  const invocation = { role: brief.role, prompt: formatBrief(brief) };

  if (brief.model !== "inherited") {
    if (row.models !== null && !row.models.includes(brief.model)) {
      return {
        ok: false,
        message: `${row.label} cannot honour model \`${brief.model}\`: it takes ${row.modelHint}. Refusing rather than dispatching a different model.`,
      };
    }
    invocation.model = brief.model;
  }

  if (brief.effort !== "inherited") {
    if (!row.effort) {
      return {
        ok: false,
        message: `${row.label} cannot honour effort \`${brief.effort}\`: ${row.effortHint}. Refusing rather than dispatching at a different effort.`,
      };
    }
    invocation.effort = brief.effort;
  }

  return row.translate ? row.translate(brief) : { ok: true, harness, invocation };
}
