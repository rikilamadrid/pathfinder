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
  "branch",
  "role",
  "model",
  "effort",
  "approval",
  "protocol",
]);

export const DEFAULT_PROTOCOL = Object.freeze([
  "Work only inside the worktree named above.",
  "Run /ticket load <ticket>, then /ticket start, as the role named above.",
  "On a human decision: set State: human-gate and Gate: <question> in context/current-ticket.md, then stop and report GATE.",
  "When verified, committed, and pushed with a draft pull request open: set State: done and report DONE.",
  "When the work cannot be completed inside the ticket: set State: failed and report FAILED with the reason.",
]);

/**
 * Build a brief. Pure: same inputs, same object, same bytes.
 *
 * @returns {{ok: true, brief: object} | {ok: false, message: string}}
 */
export function buildBrief({ ticket, title, ref, session = "implementation", worktree, branch, selection, approval, protocol = DEFAULT_PROTOCOL }) {
  const missing = [];
  for (const [name, value] of Object.entries({ ticket, title, ref, worktree, branch, approval })) {
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
      branch,
      role: selection.role,
      model: selection.model,
      effort: selection.effort,
      approval,
      protocol: [...protocol],
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
    `Branch:    ${brief.branch}`,
    `Approval:  ${brief.approval}`,
    "",
    ...brief.protocol.map((step, index) => `${index + 1}. ${step.replace("<ticket>", brief.ticket)}`),
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
        message: `${row.label} cannot honour effort \`${brief.effort}\`: it takes no reasoning-effort setting. Refusing rather than dispatching at a different effort.`,
      };
    }
    invocation.effort = brief.effort;
  }

  return { ok: true, harness, invocation };
}
