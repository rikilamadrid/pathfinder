---
name: feature
description: Run one action of the Feature delivery loop — load, start, review, or complete.
argument-hint: load|start|review|complete
---

# Feature

The Feature delivery loop, as one skill. The human names the action:

`/feature load`
`/feature start`
`/feature review`
`/feature complete`

## Process

1. Take the action from the invocation.
   If none was given, list the four actions below and stop.
   If it is not one of the four, say so, list them, and stop.
2. Read only `skills/feature/actions/<action>.md` and follow it exactly.

## Actions

- `load` — prepare one Feature for execution. Reads its spec and the minimum
  context around it, checks for blockers, records the approval in the spec, and
  writes the session's workspace state.
- `start` — implement the active delivery chunk in small, stable increments,
  restating the pre-implementation summary before editing anything.
- `review` — verify implemented work against its Feature and report findings.
  It changes no implementation and accepts nothing.
- `complete` — complete work the human has accepted, through the project's
  delivery workflow and its durable records.

## Lifecycle

The Feature spec's `## Status` holds the durable lifecycle state named in
`context/ai-interaction.md`:

`Proposed` → `Ready` → `In Progress` → `Complete`

`Cancelled` and `Superseded` are terminal alternatives.

- `load` writes `Proposed` → `Ready`.
- `start` writes `Ready` → `In Progress`.
- `complete` writes `Complete`.
- `review` writes no status. Review is workflow activity, not lifecycle state.

`context/current-feature.md` is transient workspace state and records no status.

## Rules

- Run the one action the human named. Do not continue into the next one.
- Read only that action's file. The other three are not context for this work.
- Human authority is unchanged: approval, acceptance, merge, and release are
  the human's, whichever action is running.
