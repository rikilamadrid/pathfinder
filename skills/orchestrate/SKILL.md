---
name: orchestrate
description: Coordinate several dependency-safe ticket workers at once in a project that runs in orchestrator mode.
argument-hint: status
---

# Orchestrate

The coordinator for orchestrator mode. The human names the action:

`/orchestrate status`

It decides what approved work can execute now and how. It never implements a
ticket, reviews one, accepts work, or merges: every lifecycle transition is the
ordinary `ticket` action, run by the worker that owns the ticket.

## When this applies

Only in a project whose `context/execution-mode.md` says
`<!-- pathfinder:execution-mode orchestrator -->`, read as
`skills/ticket/SKILL.md` §Execution mode defines it. In any other project —
human-in-the-loop, no mode file, or an invalid one — every action refuses,
names the file and the two values, and changes nothing.

## Process

1. Take the action from the invocation.
   If none was given, list the actions below and stop.
   If it is not one of them, say so, list them, and stop.
2. Read only `skills/orchestrate/actions/<action>.md` and follow it exactly.

## Actions

- `status` — the operator's view: every ticket in scope with its worker,
  execution state, branch and worktree, gate or blocker, and last recorded
  result. Reads only.

## The model

- **A worker is a worktree.** Each claimed ticket has exactly one linked Git
  worktree at `.pathfinder/worktrees/<key>` on one branch
  `ticket/<key>-<slug>`. The worktree path is the worker's identity and the
  claim. The worktree's own `context/current-ticket.md` is that worker's
  transient state, so two workers never share one.
- **Git is the lock.** A claim first creates `refs/pathfinder/claims/<key>`,
  which Git creates only if it does not exist, under its own ref lock, so of
  any number of concurrent claims exactly one proceeds. A claim that then fails
  removes the branch and ref it created. The engine also refuses a ticket that
  already has a worktree, a `ticket/<key>-*` branch, a claim ref, or an
  unregistered directory at its worktree path. There is no lock file, database,
  daemon, or server, and the claim ref is not sent by a normal push.
- **Claims outlive sessions.** A session that dies leaves its worktree, branch,
  and state file behind. Any claim the current run did not start is `stale`
  until it is resumed deliberately, and a stale claim is never dispatched a
  second time.
- **`.pathfinder/` is machine-local and ignored.** The project's `.gitignore`
  must carry `/.pathfinder/`; the engine refuses to claim until it does and
  never edits the file itself.
- **The store is the board.** Eligibility is `skills/ticket/actions/load.md`
  §Readiness, computed from the configured store and nothing else. A status the
  engine cannot read — an unknown word, a GitHub issue closed while still
  labelled in progress, two status labels — is never eligible and never
  unblocks a dependent.

## Engine

Paths below are relative to this skill's own directory. The engine needs Node
and, for a GitHub Issues store, the `gh` CLI. It holds no state of its own:
every call re-derives its answer from Git, the worktrees, and the store.

```
engine/bin/orchestrate.mjs   board | claim | owner | status | estimate | brief
engine/store.mjs             reads the configured ticket store
engine/board.mjs             eligibility
engine/claims.mjs            claims, from git worktrees and state files
engine/claim.mjs             the one write: a claim ref, then a worktree on a new branch
engine/status.mjs            the operator's view and its state vocabulary
engine/mode.mjs              the execution-mode and routing-policy markers
engine/estimate.mjs          estimate: complexity, context, parallel safety, risk
engine/profile.mjs           the pathfinder.execution-profile/1 schema
engine/policies/             routing policies; select: role, model, effort
engine/route.mjs             estimate, then select, into one profile
engine/brief.mjs             the worker brief and each harness's translation
```

`profile.md` documents the profile, its thresholds, and routing policies.
`brief.md` documents the brief and the harness translation table.

A store other than local Markdown needs one machine-readable line in
`context/tracker.md`, described in `skills/ticket/store.md`.

## Rules

- Run the one action the human named.
- Never implement, review, accept, or merge. Those belong to `developer`,
  `tester`, and the human.
- Never delete a worktree or a branch unless the human asks.
- Never edit `.gitignore`, `context/execution-mode.md`, or a ticket's substance.
- Human authority is unchanged: approval, acceptance, merge, and release are
  the human's in this mode exactly as in human-in-the-loop.
