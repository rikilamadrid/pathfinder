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

import { TOKEN } from "./profile.mjs";

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

  return { ok: true, harness, invocation };
}
