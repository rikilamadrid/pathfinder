/**
 * The three steps, assembled: estimate a ticket against the tickets other
 * workers hold, select through the project's routing policy, and return one
 * validated `pathfinder.execution-profile/1`.
 *
 * This module knows the order of the steps and nothing about any policy. The
 * policy is looked up by the name `context/execution-mode.md` gives, through
 * the registry, which is the whole of the seam.
 */

import { readClaims } from "./claims.mjs";
import { estimateTicket } from "./estimate.mjs";
import { readRoutingPolicy } from "./mode.mjs";
import { PROFILE_SCHEMA, validateProfile } from "./profile.mjs";
import { loadPolicy, runPolicy } from "./policies/registry.mjs";

/**
 * @param {object} args
 * @param {string} args.root
 * @param {import("./store.mjs").Ticket} args.ticket
 * @param {import("./store.mjs").Ticket[]} args.tickets every ticket in the store
 * @param {"implementation"|"review"} [args.session]
 * @param {{risk?: string|null, reason?: string|null}} [args.assessment]
 * @returns {Promise<{ok: true, profile: object} | {ok: false, message: string}>}
 */
export async function profileFor({ root, ticket, tickets, session = "implementation", assessment = {} }) {
  const inFlight = inFlightTickets(root, tickets, ticket.key);

  const estimated = estimateTicket(ticket, inFlight, assessment);
  if (!estimated.ok) return estimated;

  const { name } = readRoutingPolicy(root);
  const policy = await loadPolicy(name);
  if (!policy.ok) return policy;

  const selected = runPolicy(policy, estimated.estimate, { session, root });
  if (!selected.ok) return selected;

  const profile = {
    schema: PROFILE_SCHEMA,
    ticket: ticket.key,
    estimate: estimated.estimate,
    selection: selected.selection,
  };

  const checked = validateProfile(profile);
  if (!checked.ok) return { ok: false, message: `the profile is invalid: ${checked.errors.join("; ")}` };
  return { ok: true, profile };
}

/**
 * The tickets other workers hold: every registered claim other than this
 * ticket's, whose ticket is not already Complete. Orphans hold no work in
 * flight and are not counted.
 */
export function inFlightTickets(root, tickets, key) {
  const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));
  return readClaims(root)
    .filter((claim) => !claim.orphan && claim.key !== key)
    .map((claim) => byKey.get(claim.key))
    .filter((ticket) => ticket && ticket.status !== "Complete");
}
