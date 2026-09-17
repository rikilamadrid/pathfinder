/**
 * Eligibility, computed from the store and nothing else.
 *
 * A ticket is eligible exactly when `skills/ticket/actions/load.md` says it is
 * ready: its own status is `Proposed` or `Ready`, and every ticket under its
 * `## Blocked by` is `Complete`. A blocker that is `Cancelled` or `Superseded`
 * is a planning question rather than a wait, and a blocker that does not exist
 * blocks too. File order, ticket number, and the order tickets were written
 * are not dependencies.
 */

import { compareKeys, featureOf } from "./keys.mjs";
import { TERMINAL } from "./store.mjs";

/**
 * @param {import("./store.mjs").Ticket[]} tickets
 * @param {{feature?: string|null}} [options]
 * @returns {BoardRow[]}
 * @typedef {{key: string, title: string, status: string, blockers: string[],
 *            ref: string, number: number|null, eligible: boolean,
 *            waiting: string[], reason: string|null}} BoardRow
 */
export function computeBoard(tickets, { feature = null } = {}) {
  const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));
  const rows = [];

  for (const ticket of tickets) {
    if (feature !== null && featureOf(ticket.key) !== String(feature)) continue;

    const row = { ...ticket, eligible: false, waiting: [], reason: null };

    if (TERMINAL.includes(ticket.status)) {
      row.reason = ticket.status.toLowerCase();
    } else if (ticket.status === "In Progress") {
      row.reason = "in progress";
    } else {
      const problems = [];
      for (const key of ticket.blockers) {
        const blocker = byKey.get(key);
        if (!blocker) {
          problems.push(`blocker ${key} does not exist`);
        } else if (blocker.status === "Complete") {
          continue;
        } else if (blocker.status === "Cancelled" || blocker.status === "Superseded") {
          problems.push(`blocker ${key} is ${blocker.status} — a planning question`);
        } else {
          row.waiting.push(key);
        }
      }
      if (problems.length > 0) {
        row.reason = problems.join("; ");
      } else if (row.waiting.length > 0) {
        row.reason = `blocked by ${row.waiting.join(", ")}`;
      } else {
        row.eligible = true;
      }
    }

    rows.push(row);
  }

  return rows.sort((a, b) => compareKeys(a.key, b.key));
}

/** The eligible rows, in key order. */
export function eligible(rows) {
  return rows.filter((row) => row.eligible);
}

/** Render the board as text, one line per ticket. */
export function formatBoard(rows) {
  if (rows.length === 0) return "No tickets.\n";
  const keyWidth = Math.max(...rows.map((row) => row.key.length));
  const statusWidth = Math.max(...rows.map((row) => row.status.length));
  return (
    rows
      .map((row) => {
        const state = row.eligible ? "eligible" : row.reason;
        return `${row.key.padEnd(keyWidth)}  ${row.status.padEnd(statusWidth)}  ${state}  ${row.title}`;
      })
      .join("\n") + "\n"
  );
}
