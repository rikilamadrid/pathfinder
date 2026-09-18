---
title: Execution modes
description: Choose direct human control or dependency-safe orchestration over the same Pathfinder ticket lifecycle.
---

Pathfinder gives you one disciplined workflow with two ways to operate it:
work one ticket at a time with direct human control, or let Pathfinder
coordinate several dependency-safe workers while surfacing only the human
gates that need you.

| Mode | Coordinator | Unit of work |
| --- | --- | --- |
| `human-in-the-loop` | You choose each next invocation | One active ticket session |
| `orchestrator` | The orchestrator coordinates the approved dependency graph | One active ticket per isolated worker |

Both run the same [`ticket`](/skills/ticket/) lifecycle. Both keep approval,
acceptance, merge, and release with the human. Orchestration adds isolation,
dependency-aware scheduling, and fewer unnecessary interruptions. It does not
add a daemon, broker, queue, database, or server. It does not merge automatically,
bypass review, or launch unlimited agents.

## Choose at installation, change deliberately

`npx create-pathfinder` asks **How should Pathfinder run this project?** after
the harness question, when stdin and stdout are terminals, `--yes` is absent,
and the project has no mode file. Human-in-the-loop is the default selection.
Either answer writes `context/execution-mode.md`.

For a scripted install or a later switch:

```bash
npx create-pathfinder --mode orchestrator
# To return to direct control:
npx create-pathfinder --mode human-in-the-loop
```

The value lives in one marker line in the tracked file:

```text
<!-- pathfinder:execution-mode orchestrator -->
```

The rest is prose for people. You can edit the marker deliberately or re-run the
installer with `--mode`. The flag replaces a Pathfinder-owned mode file; an
unowned file is reported as a conflict unless you explicitly use `--force`.
A plain re-run preserves an existing mode.

A missing file means **human-in-the-loop**. Projects installed before modes
existed need no migration. An existing file without a valid marker is invalid:
`ticket` reports it and proceeds as human-in-the-loop; `orchestrate` refuses to
run. Neither guesses from prose or from the harness.

Changing the marker does not finish or abandon workers. Resolve or deliberately
preserve existing claims before switching away from orchestrator mode.

## Human-in-the-loop

You coordinate and integrate. Load one ticket, start it, optionally request a
review, accept the result, and complete it under your project's delivery policy.
The [workflow guide](/guides/workflow/) walks through that loop. It needs no
runtime and works with any agent that reads the kit.

## Orchestrator

Orchestrator mode needs Node 18 or newer and Git; a GitHub Issues store also
needs an authenticated `gh` CLI. Its engine reads the configured store, ticket
blockers, Git branches, and worker state each time. There is no service to start.
The engine currently reads local Markdown and GitHub Issues; a prose-only
configuration for another tracker does not give the engine an adapter.

Before the first claim, add this line to the project's `.gitignore`:

```text
/.pathfinder/
```

The engine checks it and refuses to claim if the directory is not ignored. It
never changes your ignore rules for you. Keep `context/execution-mode.md`
tracked, and ignore `context/current-ticket.md` and `context/handoff.md`.

The skill's commands are:

```text
/orchestrate status
/orchestrate start feature 53 --workers 2
/orchestrate start all --workers 3
/orchestrate resume 53.4
/orchestrate integrate
```

These are skill invocations, not shell subcommands. In Codex, invoke the native
`$orchestrate` skill with the same action and scope, or ask the agent to read
`skills/orchestrate/SKILL.md`. Through the Claude Code plugin the prefix is
`/pathfinder:orchestrate`.

`start` plans before claiming. A ticket is eligible only when its store status
is `Proposed` or `Ready` and every `Blocked by` ticket is `Complete`. A cancelled
or superseded blocker requires a planning decision. Already-claimed tickets,
including stale ones, cannot be dispatched again. If work has not been planned,
the skill hands back to the planning workflow instead of inventing tickets.

The plan shows each selected ticket, estimate, role, model, effort, and proposed
worker/worktree assignment before asking for one scoped approval. That approval
covers execution, claims, ticket-branch commits and pushes, draft PRs, and
tracker writes as tickets in scope become eligible. It does not grant merge
approval unless you explicitly include standing merge authorization. The worker
limit defaults to three and can be lowered or raised explicitly.

A claim creates a linked worktree at `.pathfinder/worktrees/<key>` and a separate
`ticket/<key>-<slug>` branch. Git's claim ref and worktree checks prevent duplicate
ownership. Each worktree has its own `context/current-ticket.md`, so one worker's
state never overwrites another's. The orchestrator coordinates; developers
implement, testers review, and the integrator checks landing safety.

### The profile you approve

The dispatch plan and ownership comment expose the same execution profile:

```text
estimate(ticket, in-flight claims) → execution profile
select(profile, policy)            → role, model, effort
dispatch(brief)                    → worker session
```

The versioned profile (`pathfinder.execution-profile/1`) includes complexity,
context size, parallel safety, and risk, with reasons and whether each is derived
or assessed. Parallel safety reports `isolated`, `shared-surface`, or `serialize`.
Those estimates are coarse evidence from declared ticket paths, not a guarantee
that branches cannot conflict. Actual changed-file overlap is checked again at
integration.

This release ships **static** routing: implementation role `developer`, review
role `tester`, model `inherited`, effort `inherited`. Inherited means the model
and reasoning effort already used by the dispatching session. Dynamic model
routing is not part of this release.

The optional policy marker belongs beside the mode marker:

```text
<!-- pathfinder:routing-policy static -->
```

Without it, the policy is `static`. Unknown policies are refused. The profile is
persisted under `## Execution` in the worker's state file, not added to the ticket
body. Harness translation supports `claude-code`, `codex`, and `manual`; a
requested value the harness cannot honor is refused explicitly, never silently
changed. Codex dispatch uses the native `collaboration.spawn_agent` capability;
if it is unavailable, dispatch stops. Manual translation prints a brief for a
human-started session rather than pretending one was launched.

## Read status without reconstructing chat history

`/orchestrate status` reads Git, the ticket store, and each worker's state file.
It reports worker, ticket, execution state, worktree, branch, gate or blocker,
and last recorded result. Its vocabulary is distinct from ticket lifecycle:

| Execution state | Meaning |
| --- | --- |
| `ready` | Eligible and unclaimed |
| `blocked` | Waiting on dependencies or another stated constraint |
| `working` | An owned worker is implementing |
| `review` | Independent verification is underway |
| `human-gate` | This ticket needs the named human decision |
| `done` | Work is ready for integration assessment after verification and review |
| `stale` | A preserved claim has no worker owned by this run |
| `failed` | Work stopped with a recorded failure |
| `integrated` | The ticket is `Complete` in the store |

Ticket lifecycle remains `Proposed → Ready → In Progress → Complete`, with
`Cancelled` and `Superseded` as terminal alternatives. `blocked` and
`human-gate` are not lifecycle statuses. A developer's completion report starts
independent tester review; it does not accept or merge the work.

## Gates and the tracker

A worker needing a human decision records `State: human-gate` and the exact
`Gate` question. Its dependents wait; unrelated workers continue. On GitHub
Issues, the orchestrator adds `gate: human` and an idempotent comment. The issue
keeps its ordinary lifecycle label. Resolution records the answer and removes
the gate; failed tracker writes leave it retryable.

Ownership, gate, and eligibility comments carry `pathfinder:orchestrate` markers
so retries do not duplicate them. Lifecycle labels change only through normal
`ticket` actions. These comments record durable truth rather than every tool
call. See [Ticket stores](/guides/ticket-stores/#orchestration-in-the-store) for
the store marker and conventions.

## Integration is a separate decision

Work complete is not the same as safe to merge. The integrator checks reviewed,
pushed work with a draft PR against the current default branch: changed-file
overlap, divergence, `git merge-tree` conflict evidence, review, and CI.

| Integration result | Next step |
| --- | --- |
| `candidate` | Present the merge under the human's approval policy |
| `behind` | Resume the existing developer to update onto the default branch and rerun verification |
| `conflict` | Serialize the conflicting work and return it to its developer for resolution |

Overlap while branches are in flight is advisory; worktrees isolate changes but
do not resolve conflicts. A merge changes the evidence, so every remaining done
branch is checked again. A behind or conflicted branch is never presented as a
clean candidate, and no merge goes through an unresolved human gate.

After an approved merge, the normal `/ticket complete <key>` action closes the
ticket, derives the parent Feature's state, and reports newly eligible work.
The integrator releases the claim and its worktree under the run's authorization.
The orchestrator refreshes the dependency graph before dispatching anything else
within the approved scope.

## Recover the same work

A quota limit, crash, or terminated harness does not erase a ticket. The branch,
worktree, claim, state file, and execution profile survive. A new orchestration
run treats inherited claims as stale until they are deliberately resumed:

```text
/orchestrate resume 53.4
```

The resume brief reads the existing state first and continues from it. End or
confirm termination of the old mutating session before starting a replacement;
never let two sessions mutate one worktree.

A compatible harness can replace the worker without replacing the ticket. For
example, a Claude Code session using the static inherited profile can be resumed
by Codex in the same worktree and branch. A harness-specific override may be
incompatible and must be refused rather than changing the persisted profile.
There is no automatic cross-harness failover.

Failed work is preserved too. If repair needs a scope decision or repeated
review cannot resolve a finding, the exact decision returns to the human while
unrelated workers continue.
