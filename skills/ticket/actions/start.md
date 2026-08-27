# Ticket: Start

Implement the loaded ticket.

1. Read `context/current-ticket.md` and, from the store, the ticket it names.
   If neither exists, stop: an unloaded ticket is not approved for execution.
   Run `/ticket load`.
2. Read only the context the ticket names.
3. Restate the pre-implementation summary the project's agent guide requires,
   and wait for it to be answered where it names a human decision. Do not edit
   any file before this step is done.
4. Record the ticket's status as `In Progress` in the store, before the first
   file edit:
   - `Ready` becomes `In Progress`. That is the only value this action writes to
     the ticket.
   - `In Progress` is left exactly as it is. Continuing a ticket across sessions
     is normal and must not rewrite its state.
   - Any other status stops the session. Report it. A ticket that was never
     loaded is not approved for execution, and terminal work is the human's to
     reopen.
5. Derive the parent Feature's status from that transition: a Feature whose
   status is `Proposed` or `Ready` becomes `In Progress` when its first ticket
   does. A Feature already `In Progress` is left alone. Write nothing else to
   the Feature spec.
6. Implement the ticket's `## Changes`, and only those.
7. Make the smallest complete change.
8. Verify it as the ticket's `## Verification` says.
9. Keep the repository stable. The ticket is a slice that leaves the project
   working, so a green build at the end is part of the work, not a later ticket.
10. Update `context/current-ticket.md` with the current state and next action.
    Do not record the lifecycle status there; the ticket carries it.

## Rules

- Stay inside this ticket. Work that belongs to another ticket waits for it.
- Follow existing project conventions.
- Stop if implementation requires a human decision or material scope change.
- Do not silently add dependencies or adopt prototype code.
- Do not edit the parent Feature spec beyond the derived status above.
- Follow the project's approval and Git rules.
- Do not decide that your own work is accepted.

When the ticket is done, report what changed, what was verified, and anything
unresolved. Then stop. Picking up the next ticket is a new session.
