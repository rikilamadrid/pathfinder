/**
 * The operator's view: one row per ticket, from the store, the worktrees, and
 * the workers' own state files.
 *
 * Deterministic by construction. Rows are ordered by key, widths are computed
 * from the content, nothing reads the clock, and the only timestamp shown is
 * the one a worker wrote into its state file. The same inputs give the same
 * bytes, which is what lets a person compare two views and trust the
 * difference.
 *
 * The execution-state vocabulary is closed:
 *
 *   ready        eligible and unclaimed
 *   blocked      waiting on a blocker, or a planning question about one
 *   working      a live worker is on it — or the store says In Progress with
 *                no claim, which is how a human-in-the-loop session shows
 *   review       a tester session is verifying it
 *   human-gate   the worker stopped for a human decision
 *   done         work complete: verified, reviewed, pushed, PR open
 *   stale        a working or review claim with no live session
 *   failed       the worker reported failure; a human decides
 *   integrated   Complete in the store
 *
 * Liveness is declared by the caller (`--live a,b`) — the orchestration run
 * knows which sessions it started — and never detected from processes. A
 * claim this run did not start is `stale` until it is resumed, which is what
 * makes recovery a resume rather than a restart.
 */

import { checkIntegration } from "./integration.mjs";
import { computeBoard } from "./board.mjs";
import { readClaims } from "./claims.mjs";
import { compareKeys } from "./keys.mjs";
import { effectiveExecutionMode, readExecutionModeFile } from "./mode.mjs";
import { describeStore, readTickets, resolveStore } from "./store.mjs";

export const STATES = Object.freeze([
  "ready",
  "blocked",
  "working",
  "review",
  "human-gate",
  "done",
  "stale",
  "failed",
  "integrated",
]);

// A worker at a human gate stopped on purpose and waits for a person, so it is
// shown as human-gate whether or not a session is live. Only work that was
// meant to be running and has no session is stale.
const STALE_WHEN_UNATTENDED = new Set(["working", "review"]);
const ABANDONED = new Set(["Cancelled", "Superseded"]);

/**
 * @param {{root: string, live?: string[], feature?: string|null, store?: string|null, gh?: string}} args
 * @returns {{ok: true, mode: string|null, store: string, rows: StatusRow[]} | {ok: false, message: string}}
 * @typedef {{worker: string, key: string, lifecycle: string, state: string,
 *            where: string, gate: string, last: string, title: string}} StatusRow
 */
export function computeStatus({ root, live = [], feature = null, store: storeOverride = null, gh = "gh" }) {
  const store = resolveStore(root, { override: storeOverride });
  const read = readTickets(root, store, { gh });
  if (!read.ok) return { ok: false, message: read.message };

  const mode = effectiveExecutionMode(readExecutionModeFile(root));
  const board = computeBoard(read.tickets, { feature });
  const claims = new Map(readClaims(root).map((claim) => [claim.key, claim]));
  const liveSet = new Set(live);

  // Cancelled and Superseded tickets are not work, so they have no row and no
  // state — unless a claim still exists for one, which is a trace a person
  // must see, and shows as stale.
  const rows = board
    .filter((ticket) => !ABANDONED.has(ticket.status) || claims.has(ticket.key))
    .map((ticket) => toRow(ticket, claims.get(ticket.key) ?? null, liveSet));

  // A claim whose ticket is not on the board — a key the store does not know,
  // or one outside the requested Feature — is still a fact about the
  // repository and is shown, so a worktree can never hide from the view.
  for (const claim of claims.values()) {
    if (rows.some((row) => row.key === claim.key)) continue;
    if (feature !== null && claim.key.split(".")[0] !== String(feature)) continue;
    rows.push(
      toRow(
        { key: claim.key, title: "(not in the store)", status: "—", eligible: false, reason: "not in the store", waiting: [] },
        claim,
        liveSet,
      ),
    );
  }

  for (const row of rows) {
    const claim = claims.get(row.key);
    row.recordedState = claim?.state ?? null;
    row.updated = claim?.updated ?? null;
    row.next = claim?.next ?? null;
    if (row.state === "done") {
      row.check = checkIntegration({ root, key: row.key });
      row.last = `${row.check.ok ? row.check.result : `check refused: ${row.check.message}`} · ${row.last}`;
    }
  }

  rows.sort((a, b) => compareKeys(a.key, b.key));
  return { ok: true, mode, store: describeStore(store), rows };
}

function toRow(ticket, claim, liveSet) {
  const row = {
    worker: "—",
    key: ticket.key,
    role: null,
    lifecycle: ticket.status,
    state: "—",
    where: "—",
    gate: "—",
    last: "—",
    title: ticket.title,
  };

  if (claim) {
    // The worker column names the worker and the role its profile chose, so the
    // view says who is doing a ticket in the same breath as how.
    const role = claim.profile?.selection.role;
    row.worker = claim.orphan ? "—" : `${claim.worker ?? claim.key}${role ? ` ${role}` : ""}`;
    row.role = role ?? null;
    row.where = claim.orphan ? "—" : `${claim.branch ?? "?"} @ ${claim.worktree}`;
    row.last = claim.updated ? `${claim.updated}${claim.next ? " · " + claim.next : ""}` : claim.next ?? "—";
    if (claim.gate) row.gate = claim.gate;
    else if (claim.profileError) row.gate = `execution profile unreadable: ${claim.profileError}`;
  }

  if (ticket.status === "Complete") {
    row.state = "integrated";
  } else if (claim) {
    if (ABANDONED.has(ticket.status)) {
      row.state = "stale";
      row.gate = `ticket is ${ticket.status} but still claimed; release it`;
    } else if (claim.orphan) {
      row.state = "stale";
      row.where = claim.elsewhere
        ? `${claim.branch} @ ${claim.elsewhere} (outside .pathfinder)`
        : claim.branch
          ? `${claim.branch} (branch only)`
          : `refs/pathfinder/claims/${claim.key} (claim ref only)`;
      row.gate = claim.elsewhere ? "checked out outside .pathfinder; a person decides" : "worktree missing; resume or release";
    } else if (!claim.stateFile || claim.state === null) {
      row.state = liveSet.has(claim.key) ? "working" : "stale";
      row.last = row.last === "—" ? "claimed, not yet loaded" : row.last;
    } else if (claim.state.startsWith("invalid:")) {
      row.state = "stale";
      row.gate = `state file says ${claim.state.slice("invalid:".length)}`;
    } else if (STALE_WHEN_UNATTENDED.has(claim.state) && !liveSet.has(claim.key)) {
      row.state = "stale";
    } else {
      row.state = claim.state;
    }
  } else if (ticket.status === "In Progress") {
    row.state = "working";
    row.where = "no claim";
  } else if (ticket.eligible) {
    row.state = "ready";
  } else {
    row.state = "blocked";
    row.gate = ticket.reason ?? "—";
  }

  return row;
}

/** The table, as bytes a person reads and a test compares. */
export function formatStatus(result) {
  const header = `Pathfinder orchestration — mode: ${result.mode ?? "invalid"} — store: ${result.store}`;
  if (result.rows.length === 0) return `${header}\n\nNo tickets.\n`;

  const columns = [
    ["WORKER", (row) => row.worker],
    ["TICKET", (row) => row.key],
    ["LIFECYCLE", (row) => row.lifecycle],
    ["STATE", (row) => row.state],
    ["BRANCH / WORKTREE", (row) => row.where],
    ["GATE / BLOCKER", (row) => row.gate],
    ["LAST", (row) => row.last],
  ];
  const widths = columns.map(([label, pick]) => Math.max(label.length, ...result.rows.map((row) => pick(row).length)));
  const line = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();

  return [
    header,
    "",
    line(columns.map(([label]) => label)),
    ...result.rows.map((row) => line(columns.map(([, pick]) => pick(row)))),
    "",
  ].join("\n");
}
