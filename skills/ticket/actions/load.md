# Ticket: Load

Prepare one ticket for execution.

## Assumed role

Unless the human explicitly activated a role, assume `developer` for this
invocation: read `roles/developer.md` and follow it. An explicit role overrides
this default. A role narrows responsibility and never grants human authority.

1. Resolve the ticket store. Read `skills/ticket/store.md` and follow it.
2. Select the ticket the human named, by key. If none was named, list the ready
   tickets — see Readiness below — and stop.
3. Read the ticket.
4. Read its parent Feature spec, named under the ticket's `## Parent Feature`.
   Read the Feature for its Goal, Requirements, Out of Scope, and Acceptance
   Criteria. Do not read the other tickets of that Feature; the blocker check
   below reads their status and nothing else.
5. Verify every blocker under `## Blocked by`, reading each blocker's status
   from the store:
   - A blocker that is `Complete` is satisfied.
   - A blocker that is `Cancelled` or `Superseded` is not satisfied. Report it
     and stop: an edge pointing at abandoned work is a planning question.
   - Any other status blocks the load. Name the blocking ticket and stop.
   - A named blocker that does not exist blocks the load. Report it by key.
   Stop before writing anything. A blocked load must leave no trace.
6. Read only the files or context the ticket's `## Context` names.
7. Inspect the current Git state.
8. Stop if a required human decision blocks the work.
9. Record the approval in the ticket's `## Status`:
   - `Proposed` becomes `Ready`. That is the only value this action writes.
   - `Ready` or `In Progress` is left exactly as it is. Reloading a ticket
     mid-work is normal and must not rewrite its state.
   - `Complete`, `Cancelled`, or `Superseded` blocks the load. Report it and
     stop. Reopening terminal work is the human's decision.

   Do this only once steps 1-8 found no blocker, and before the next step, so a
   blocked load never leaves a promoted ticket behind.
10. Create or update `context/current-ticket.md` — it does not ship, so the
    first load writes it — with:
    - ticket key, title, and where it is in the store
    - parent Feature number, name, and spec path
    - Git state
    - blocker, if any
    - next action

    Do not record the lifecycle status here. This file is transient workspace
    state belonging to one session on one machine; the ticket carries the
    durable status.
11. Present a short readiness summary.

## Readiness

A ticket is ready when its own status is `Proposed` or `Ready`, and every ticket
under its `## Blocked by` is `Complete`.

Nothing else makes a ticket ready. File order, ticket number, and the order the
tickets were written are not dependencies.

Do not implement the ticket. That is `/ticket start`.

Do not load the parent Feature's other tickets, unrelated repository areas,
history, or roadmap by default.

Do not rewrite the ticket's substance — its Goal, Context, Changes,
Verification, Out of Scope, or Blocked by. `## Status` is the one field this
action maintains.

Do not copy the ticket into the repository. The store holds it, and
`context/current-ticket.md` records only which ticket this session is on.

Do not edit the parent Feature spec. `load` derives nothing.
