---
name: orchestrate
description: Coordinate several dependency-safe ticket workers at once in a project that runs in orchestrator mode.
argument-hint: status|start|resume|integrate
---

# Orchestrate

The coordinator for orchestrator mode. The human names the action:

`/orchestrate status`
`/orchestrate start [feature NN | all] [--workers N]`
`/orchestrate resume <key>`
`/orchestrate integrate [<key>]`

The orchestrator decides what approved work can execute now and how; the
integrator action decides whether completed work can land under human approval.
Neither implements, reviews for correctness, or accepts work. Every lifecycle
transition remains the ordinary `ticket` action.

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
- `start` — plan the scope, ask the human once, then claim, dispatch, review,
  and surface gates for one round, and stop at the round boundary. A new
  session continues the run from engine state.
- `resume` — continue one existing claim deliberately: a stale worker, or one
  whose human gate was resolved.

- `integrate` — assume the integrator role, check completed work, request any
  necessary revalidation, present each merge for approval, complete and release.

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
  and state file behind. Any claim this session did not start is `stale`
  until a person confirms its old session has stopped. It is then continued
  deliberately, through `resume` or as a pending claim under `start`
  §Continuing a run, and never dispatched while another session may still
  own it.
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
engine/bin/orchestrate.mjs   board | claim | owner | status | estimate | brief | check | judge | release | scratch | disk
engine/store.mjs             reads the configured ticket store
engine/board.mjs             eligibility
engine/claims.mjs            claims, from git worktrees and state files
engine/claim.mjs             the one write: a claim ref, then a worktree on a new branch
engine/integration.mjs       conflict/divergence/overlap evidence and safe release
engine/status.mjs            the operator's view and its state vocabulary
engine/mode.mjs              the execution-mode and routing-policy markers
engine/estimate.mjs          estimate: complexity, context, parallel safety, risk
engine/profile.mjs           the pathfinder.execution-profile/1 schema
engine/policies/             routing policies; select: role, model, effort
engine/route.mjs             estimate, then select, into one profile
engine/brief.mjs             the worker brief and each harness's translation
engine/plan.mjs              the dispatch plan: claim now, wait, blocked, stale
engine/comments.mjs          every note the orchestrator writes, one spelling each
engine/tracker.mjs           notes and the gate label, idempotent by marker
engine/statefile.mjs         updates to a worker's state file lines
engine/stage.mjs             current-head checkpoint validation and recovery session
engine/experiments.mjs       bounded transient Adversary experiments
engine/findings.mjs          bounded transient independent Tester review
engine/judgment.mjs          optional Evidence Judge: bundle, validation, policy, checkpoint
engine/judges/              Evidence Judge providers; jev is the first
engine/scratch.mjs           review scratch runs: owner, ticket, role, head; reclaim and prune
engine/deps.mjs              content-addressed dependency cache and copy-on-write trees
engine/disk.mjs              physical free space, warning and floor thresholds
engine/process.mjs           process identity and ancestry on macOS, Linux, WSL and Windows
```

`profile.md` documents the profile, its thresholds, and routing policies.
`brief.md` documents the brief and the harness translation table.
`worker-brief.md` and `resume-brief.md` state what each brief asks a worker to do.
`evidence-judge.md` documents the optional Evidence Judge and its trust boundary.

### Review scratch

Adversary and Tester rounds build their trees — base, head, mutants — in a
run under `.pathfinder/scratch/<key>/`, never in a harness's private temporary
area, and never with a fresh `npm ci` per tree:

```
node skills/orchestrate/engine/bin/orchestrate.mjs scratch new <key> --role tester --head <sha>
node skills/orchestrate/engine/bin/orchestrate.mjs scratch deps <run-dir> --tree head
PATHFINDER_SCRATCH_RUN=<run-dir> node skills/orchestrate/engine/findings.mjs --checkpoint < report.json
```

`scratch deps` installs each lockfile once into `.pathfinder/deps/<key>/`,
keyed by lockfile, package.json, Node, npm, platform and architecture, and
gives the tree its own copy-on-write clone: an APFS clone on macOS, a reflink
on Linux filesystems that support it (Btrfs, XFS), otherwise a full,
independent copy with a warning — always on Windows, and on ext4, overlay or a
WSL `/mnt/<drive>` path. A full copy is checked against the disk floor first.
A mutant's edits stay in its own tree; an install that links outside its own
tree (workspaces, `file:` packages, junctions) is refused rather than shared.
Windows, WSL and containers each key their own entries, and an owner recorded
on another platform or host is never judged dead. A checkpoint written with
`PATHFINDER_SCRATCH_RUN`, or `scratch done`, reclaims the run's `node_modules`
and `.next` and keeps every log, report, patch and source. A failed or
interrupted run is preserved; `scratch prune` is a dry run until `--execute`,
and reclaims a preserved run's dependencies only with `--include-preserved`.
Only a run's owner process — or anyone, once that process is provably dead —
may add trees to it, finish it or fail it, and prune never touches a run whose
owner is alive or cannot be checked. One harness process can host several
sessions, so pass `--session` to `scratch new` and repeat it on `deps`, `done`
and `fail`. Where ancestry cannot be read (no `ps`), `scratch new` needs
`--owner-pid`. Clean-ups that remove a cache entry take its lock and rename it
out of place first, so a copy in progress is never left without its source.
New runs are refused below the disk floor — `<!-- pathfinder:disk warn=25
floor=10 -->` in `context/execution-mode.md`, in GB, or
`PATHFINDER_DISK_WARN_GB` / `PATHFINDER_DISK_FLOOR_GB` — unless
`--allow-low-disk` names the human's explicit approval. `disk` reports
physical free space (per-file totals overstate clones); `status` stays
byte-stable and only names a threshold once it is crossed.

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
