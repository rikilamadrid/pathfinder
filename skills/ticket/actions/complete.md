# Ticket: Complete

Invoking this action is the human's acceptance of the ticket. Do not ask for
acceptance again.

Acceptance of the ticket is not approval of the delivery steps below. Each one
that the project's documented workflow gates is still asked for.

1. Run the project's required final checks.
2. Follow the documented Git, merge, version, release, and deployment workflow.
   Ask for approval where it requires it. If that workflow is undocumented or
   `TBD`, stop and ask rather than choosing one.
3. Mark the ticket `Complete` in its `## Status`.
4. Derive the parent Feature's status: when every ticket of that Feature is
   `Complete`, `Cancelled`, or `Superseded`, and at least one is `Complete`, the
   Feature becomes `Complete`. Otherwise leave it exactly as it is. Read the
   sibling tickets' `## Status` for this and nothing else. Write nothing else to
   the Feature spec.
5. Add a compact entry to `context/history.md` when the Feature completed at
   step 4. A ticket that leaves its Feature unfinished is an increment, not a
   completed outcome, and the durable record is per Feature.
   Create the file from `templates/history.template.md` if it does not exist.
6. Clear or update `context/current-ticket.md`. Do nothing if it does not exist.
7. If work tracking is configured, sync the completed ticket.
8. Report the tickets that are now ready — see Next below — and let the human
   choose. Do not load one.

## Next

A ticket became ready when this completion satisfied its last blocker.

Read the sibling tickets' `## Status` and `## Blocked by`, and report every
ticket whose own status is `Proposed` or `Ready` and whose blockers are now all
`Complete`.

Report each by key and title. When none is ready, say so, and say whether that
is because the Feature is finished or because the remaining tickets are blocked
by something else.

Do not implement the next ticket, and do not decide which one it is.

Do not re-review accepted work unless final verification exposes a new problem.

Do not claim completion if required checks or delivery steps failed.
