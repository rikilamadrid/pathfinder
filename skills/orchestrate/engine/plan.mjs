/**
 * The dispatch plan: what one orchestration run would claim now, and why the
 * rest waits.
 *
 * Computed, never acted on. `start` prints it and asks for one approval, and
 * only then claims. The plan is re-derived from the store, the claims, and the
 * routing policy on every call, so re-planning after a completion is the same
 * call, and a plan cannot go stale in memory.
 *
 * Parallelism is never manufactured. Candidates are taken in key order, each
 * estimated against the tickets already in flight *and those already selected
 * in this plan*; one whose parallel safety is `serialize` against either waits
 * for a later round rather than sharing a file with a running worker.
 *
 * Outcomes:
 *
 *   dispatch          at least one ticket would be claimed
 *   nothing-eligible  tickets exist, none can run now; the reasons say why
 *   plan-tickets      the Feature in scope has no tickets: offer to-tickets
 *   plan-features     the store has no tickets at all: to-specs or kickstart
 *
 * The last two never claim, and never plan: they name the planning workflow
 * and stop at its approval gate.
 */

import { join } from "node:path";

import { computeBoard } from "./board.mjs";
import { buildBrief, translateBrief } from "./brief.mjs";
import { readClaims } from "./claims.mjs";
import { readModelTiers } from "./mode.mjs";
import { loadPolicy, runPolicy } from "./policies/registry.mjs";
import { profileFor } from "./route.mjs";

/** The sessions a plan shows a selection for, in the order a ticket meets them. */
export const PLAN_SESSIONS = Object.freeze(["implementation", "adversary", "review", "repair"]);

// States whose worker is running. A gated worker's session has ended while it
// waits for a human, so it holds no slot and is not stale.
const ACTIVE = new Set(["working", "adversary", "review", "repair"]);

/**
 * @param {{root: string, tickets: object[], feature?: string|null, workers?: number, live?: string[]}} args
 * @returns {Promise<{ok: true, plan: object} | {ok: false, message: string}>}
 */
export async function computePlan({ root, tickets, feature = null, workers = 3, live = [], harness = null }) {
  const scope = feature === null ? "the whole board" : `Feature ${feature}`;
  const rows = computeBoard(tickets, { feature });

  if (rows.length === 0) {
    return {
      ok: true,
      plan: feature === null
        ? {
            outcome: "plan-features",
            scope,
            workers,
            message:
              "The ticket store holds no tickets. Nothing can be dispatched. " +
              "If an approved Feature spec exists, offer to-tickets on it; otherwise offer to-specs, " +
              "or kickstart-pathfinder for a project with no context yet. Stop at that workflow's approval gate.",
            dispatch: [],
            deferred: [],
            blocked: [],
            stale: [],
          }
        : {
            outcome: "plan-tickets",
            scope,
            workers,
            message:
              `Feature ${feature} has no tickets in the store. Nothing can be dispatched. ` +
              `Offer to-tickets on Feature ${feature} under the planner role, and stop at its approval gate.`,
            dispatch: [],
            deferred: [],
            blocked: [],
            stale: [],
          },
    };
  }

  const liveSet = new Set(live);
  const inScope = new Set(rows.map((row) => row.key));
  const claims = readClaims(root).filter((claim) => inScope.has(claim.key));
  const claimed = new Map(claims.map((claim) => [claim.key, claim]));
  const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));

  const stale = claims
    .filter((claim) => claim.orphan || (ACTIVE.has(claim.state ?? "working") && !liveSet.has(claim.key)))
    .map((claim) => ({ key: claim.key, branch: claim.branch, worktree: claim.worktree, orphan: claim.orphan, state: claim.state }));

  const occupied = claims.filter((claim) => !claim.orphan && liveSet.has(claim.key) && ACTIVE.has(claim.state ?? "working")).length;
  const slots = Math.max(0, workers - occupied);

  const blocked = rows
    .filter((row) => !row.eligible && !claimed.has(row.key) && row.status !== "Complete" && row.status !== "Cancelled" && row.status !== "Superseded")
    .map((row) => ({ key: row.key, title: row.title, reason: row.reason, waiting: row.waiting }));

  const dispatch = [];
  const deferred = [];

  for (const row of rows.filter((candidate) => candidate.eligible && !claimed.has(candidate.key))) {
    const selectedTickets = dispatch.map((entry) => byKey.get(entry.key));
    const routed = await profileFor({ root, ticket: row, tickets, alsoInFlight: selectedTickets });
    if (!routed.ok) return routed;

    const entry = { key: row.key, title: row.title, ref: row.ref, number: row.number, profile: routed.profile };
    if (routed.profile.estimate["parallel-safety"].value === "serialize") {
      deferred.push({ ...entry, reason: `serialize: ${routed.profile.estimate["parallel-safety"].reason}` });
    } else if (dispatch.length >= slots) {
      deferred.push({ ...entry, reason: `worker limit ${workers} reached` });
    } else {
      const sessions = await sessionSelections({ root, entry, harness });
      if (!sessions.ok) return sessions;
      dispatch.push({ ...entry, sessions: sessions.sessions });
    }
  }

  const outcome = dispatch.length > 0 ? "dispatch" : "nothing-eligible";
  const message =
    outcome === "dispatch"
      ? `${dispatch.length} ticket${dispatch.length === 1 ? "" : "s"} can be claimed now.`
      : "No ticket can be dispatched now. The blocked, deferred, and stale lists say why.";

  return { ok: true, plan: { outcome, scope, workers, message, dispatch, deferred, blocked, stale } };
}

/**
 * What each session of a ticket the plan would claim runs on: the recorded
 * policy asked from the same estimate, as `brief` asks it, and — when a
 * harness is named — that harness's translation of it, or its refusal. The
 * translation is the one `brief` makes, over a brief that differs only in
 * text a translation does not read for model and effort.
 */
async function sessionSelections({ root, entry, harness }) {
  const { profile } = entry;
  const policy = await loadPolicy(profile.selection.policy);
  if (!policy.ok) return policy;
  const tiers = harness === null ? null : readModelTiers(root);
  const sessions = {};
  for (const session of PLAN_SESSIONS) {
    let selection = profile.selection;
    if (session !== "implementation") {
      const selected = runPolicy(policy, profile.estimate, { session, root });
      if (!selected.ok) return selected;
      selection = selected.selection;
    }
    const row = { role: selection.role, model: selection.model, effort: selection.effort };
    if (harness !== null) row.translation = previewTranslation({ root, entry, session, selection, harness, tiers });
    sessions[session] = row;
  }
  return { ok: true, sessions };
}

function previewTranslation({ root, entry, session, selection, harness, tiers }) {
  const built = buildBrief({
    ticket: entry.key,
    title: entry.title ?? entry.key,
    ref: entry.ref ?? entry.key,
    session,
    worktree: join(root, ".pathfinder", "worktrees", entry.key),
    main: root,
    branch: `ticket/${entry.key}`,
    selection,
    approval: "dispatch plan preview",
  });
  if (!built.ok) return { ok: false, harness, message: built.message };
  const translated = translateBrief(built.brief, harness, { tiers });
  if (!translated.ok) return { ok: false, harness, message: translated.message };
  const values = translated.invocation.arguments
    ? { model: translated.invocation.arguments.model, effort: translated.invocation.arguments.reasoning_effort }
    : { model: translated.invocation.model, effort: translated.invocation.effort };
  return { ok: true, harness, model: values.model ?? "inherited", effort: values.effort ?? "inherited" };
}

/** The plan as a person reads it before approving. */
export function formatPlan(plan) {
  const lines = [`Dispatch plan — ${plan.scope} — up to ${plan.workers} worker${plan.workers === 1 ? "" : "s"}`, "", plan.message];

  const profileLine = (entry) => {
    const e = entry.profile.estimate;
    const s = entry.profile.selection;
    return (
      `complexity ${e.complexity.value}, context ${e.context.value}, parallel ${e["parallel-safety"].value}, ` +
      `risk ${e.risk.value} (${e.risk.source}) · role ${s.role}, model ${s.model}, effort ${s.effort}`
    );
  };

  if (plan.dispatch.length > 0) {
    lines.push("", "Claim now:");
    for (const entry of plan.dispatch) {
      lines.push(`  ${entry.key}  ${entry.title} (${entry.ref})`, `        ${profileLine(entry)}`);
      for (const session of PLAN_SESSIONS) {
        const row = entry.sessions?.[session];
        if (!row) continue;
        const translated = !row.translation
          ? ""
          : row.translation.ok
            ? ` → ${row.translation.harness} ${row.translation.model}/${row.translation.effort}`
            : ` → ${row.translation.harness} refused: ${row.translation.message}`;
        lines.push(`        ${session.padEnd(14)} ${row.role} ${row.model}/${row.effort}${translated}`);
      }
    }
  }
  if (plan.deferred.length > 0) {
    lines.push("", "Eligible, but waits this round:");
    for (const entry of plan.deferred) lines.push(`  ${entry.key}  ${entry.reason}`, `        ${profileLine(entry)}`);
  }
  if (plan.blocked.length > 0) {
    lines.push("", "Not eligible:");
    for (const entry of plan.blocked) lines.push(`  ${entry.key}  ${entry.reason}`);
  }
  if (plan.stale.length > 0) {
    // Wording follows `start` §Continuing a run. A pending claim has a
    // worktree and a recorded ACTIVE state; everything else — an orphan, or a
    // worktree with no state file — is left to `resume`.
    lines.push(
      "",
      "Stale claims — no live session; never re-dispatched:",
      "  A pending claim (worktree present, recorded state working, adversary, review or repair)",
      "  is continued by start only after the human confirms its old session has stopped.",
      "  Any other stale claim is resumed with: resume <key>",
    );
    for (const entry of plan.stale) {
      const pending = !entry.orphan && ACTIVE.has(entry.state);
      const recorded = entry.state ? `recorded state ${entry.state}` : "no state";
      lines.push(
        `  ${entry.key}  ${pending ? "pending" : `resume ${entry.key}`} — ${recorded}`,
        `        ${entry.orphan ? `${entry.branch ?? "claim ref"} (no worktree)` : `${entry.branch} @ ${entry.worktree}`}`,
      );
    }
  }
  return lines.join("\n") + "\n";
}
