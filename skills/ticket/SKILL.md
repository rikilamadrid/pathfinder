---
name: ticket
description: Run one action of the ticket delivery loop — load, start, review, or complete.
argument-hint: load|start|review|complete [key]
---

# Ticket

The delivery loop, as one skill. The human names the action:

`/ticket load <ticket>`
`/ticket start`
`/ticket review`
`/ticket complete [<ticket>]`

## Process

1. Take the action from the invocation.
   If none was given, list the four actions below and stop.
   If it is not one of the four, say so, list them, and stop.
2. Read only `skills/ticket/actions/<action>.md` and follow it exactly.

## Actions

- `load` — prepare one ticket for execution. Resolves the ticket store, reads
  the ticket and its parent Feature spec, verifies every blocker, loads the
  minimum context the ticket names, and writes the session's workspace state.
- `start` — implement the loaded ticket, restating the pre-implementation
  summary before editing anything.
- `review` — verify implemented work against the ticket and its parent Feature,
  and report findings. It changes no implementation and accepts nothing.
- `complete` — complete work the human has accepted, through the project's
  delivery workflow and its durable records, then name the tickets that are now
  ready.

## Lifecycle

A ticket's status holds the durable lifecycle state named in
`context/ai-interaction.md`. It lives in the ticket store — see
`skills/ticket/store.md`, which is where the store and ticket identity are
defined:

`Proposed` → `Ready` → `In Progress` → `Complete`

`Cancelled` and `Superseded` are terminal alternatives.

- `load` writes `Proposed` → `Ready`.
- `start` writes `Ready` → `In Progress`.
- `complete` writes `Complete`.
- `review` writes no status. Review is workflow activity, not lifecycle state.

The parent Feature's status is derived from its tickets, never maintained by
hand. `start` and `complete` are the only actions that write it, and each writes
it only as a consequence of the ticket transition it just made.

`context/current-ticket.md` is transient workspace state and records no status.

## Execution mode

A project records how Pathfinder runs it in `context/execution-mode.md`, on one
marker line:

`<!-- pathfinder:execution-mode <value> -->`

The values are `human-in-the-loop` and `orchestrator`. No file means
`human-in-the-loop`; every project installed before the file existed is one,
and nothing needs migrating. A file whose marker is missing or names anything
else is invalid: report it once, naming the file and the two values, and
proceed as `human-in-the-loop`. Never infer a mode from prose, the environment,
or the harness.

Every reader of the mode — the actions below, `whereami`, and the session
orientation handler — reads it this way, and nothing else restates it. In
`human-in-the-loop` mode nothing in this skill behaves differently from before
the file existed.

## Rules

- Run the one action the human named. Do not continue into the next one.
- Read only that action's file. The other three are not context for this work.
- One ticket at a time. A session that finishes a ticket stops there.
- Human authority is unchanged: approval, acceptance, merge, and release are
  the human's, whichever action is running.
