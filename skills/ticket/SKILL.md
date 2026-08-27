---
name: ticket
description: Run one action of the ticket delivery loop — load, start, review, or complete.
argument-hint: load|start|review|complete
---

# Ticket

The delivery loop, as one skill. The human names the action:

`/ticket load <ticket>`
`/ticket start`
`/ticket review`
`/ticket complete`

## Process

1. Take the action from the invocation.
   If none was given, list the four actions below and stop.
   If it is not one of the four, say so, list them, and stop.
2. Read only `skills/ticket/actions/<action>.md` and follow it exactly.

## Actions

- `load` — prepare one ticket for execution. Resolves where tickets live, reads
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

A ticket's `## Status` holds the durable lifecycle state named in
`context/ai-interaction.md`:

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

## Rules

- Run the one action the human named. Do not continue into the next one.
- Read only that action's file. The other three are not context for this work.
- One ticket at a time. A session that finishes a ticket stops there.
- Human authority is unchanged: approval, acceptance, merge, and release are
  the human's, whichever action is running.
