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

import { computeBoard } from "./board.mjs";
import { readClaims } from "./claims.mjs";
import { profileFor } from "./route.mjs";

// States whose worker is running. A gated worker's session has ended while it
// waits for a human, so it holds no slot and is not stale.
const ACTIVE = new Set(["working", "review"]);

/**
 * @param {{root: string, tickets: object[], feature?: string|null, workers?: number, live?: string[]}} args
 * @returns {Promise<{ok: true, plan: object} | {ok: false, message: string}>}
 */
export async function computePlan({ root, tickets, feature = null, workers = 3, live = [] }) {
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
      dispatch.push(entry);
    }
  }

  const outcome = dispatch.length > 0 ? "dispatch" : "nothing-eligible";
  const message =
    outcome === "dispatch"
      ? `${dispatch.length} ticket${dispatch.length === 1 ? "" : "s"} can be claimed now.`
      : "No ticket can be dispatched now. The blocked, deferred, and stale lists say why.";

  return { ok: true, plan: { outcome, scope, workers, message, dispatch, deferred, blocked, stale } };
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
    for (const entry of plan.dispatch) lines.push(`  ${entry.key}  ${entry.title} (${entry.ref})`, `        ${profileLine(entry)}`);
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
    lines.push("", "Stale claims — never re-dispatched; resume deliberately:");
    for (const entry of plan.stale) {
      lines.push(`  ${entry.key}  ${entry.orphan ? `${entry.branch ?? "claim ref"} (no worktree)` : `${entry.branch} @ ${entry.worktree}`}`);
    }
  }
  return lines.join("\n") + "\n";
}
