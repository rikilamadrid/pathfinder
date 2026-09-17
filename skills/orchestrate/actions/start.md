# Orchestrate: Start

Run approved tickets concurrently: plan, ask once, claim, dispatch, review,
surface gates, and keep going until nothing more can run.

## Assumed role

Unless the human explicitly activated a role, assume `orchestrator` for this
invocation: read `roles/orchestrator.md` and follow it. An explicit role overrides
this default. A role narrows responsibility and never grants human authority.

The engine is `node skills/orchestrate/engine/bin/orchestrate.mjs`, written
`orchestrate` below. Every step's command runs from the repository's main
checkout.

## 1. Plan

Take the scope from the invocation: `feature NN`, or `all` for the whole board
(the default). Take the worker limit from `--workers N` (default 3).

```sh
orchestrate plan [--feature NN] --workers N [--live <keys this conversation already started>]
```

A non-zero exit is a refusal, for example not orchestrator mode or an unreadable
store. Report it verbatim and stop.

Act on the plan's outcome:

- **`plan-tickets`**: the Feature has no tickets. Say so, offer `to-tickets` on
  that Feature under the `planner` role, and **stop**. Slicing is a planning
  act with its own human approval. Never plan and dispatch in one invocation.
- **`plan-features`**: the store is empty. Name `to-tickets`, `to-specs`, or
  `kickstart-pathfinder` as the plan says, and **stop**.
- **`nothing-eligible`**: report the blocked, deferred, and stale lists, and
  **stop**. For a ticket blocked by a planning question (a Cancelled or
  Superseded blocker) the question is the human's.
- **`dispatch`**: continue.

Stale claims are never dispatched again. List them and say each can be resumed
deliberately with `/orchestrate resume <key>`.

## 2. Ask once

Print the plan exactly as the engine produced it, including every profile and
the approval scope. Then ask the human one question: approve this run as scoped?

- An approval covers every ticket in scope as it becomes eligible during this
  run, up to the worker limit, and nothing the scope statement excludes.
- The approval does not cover merging. Each merge is presented separately, under
  the project's merge policy.
- If the human declines or narrows the scope, stop or re-plan with the narrower
  scope. Never claim before this answer.

## 3. Claim and dispatch

For each ticket the plan says to claim now, in order:

1. Claim and announce:

   ```sh
   orchestrate claim <key> --announce
   ```

   A refusal, which exits non-zero, means the board moved since the plan.
   Re-plan rather than retry. A claim that succeeded but whose announcement
   failed exits 0 and says so. The claim stands. Dispatch it, and retry the
   note with `orchestrate announce <key>`.

2. Build the brief:

   ```sh
   orchestrate brief <key> --harness <harness> --approval "<the scope the human approved>"
   ```

   A refusal names a model or effort this harness cannot honour. Do not dispatch
   that ticket. Report the refusal to the human and continue with the others.

3. Start the worker session. **This is the one harness-specific step.** Every
   step before and after it is the same in every harness.

   - **Claude Code.** Start a background subagent whose prompt is the brief's
     `invocation.prompt`. Pass `invocation.model` as the subagent's model when it
     is present, and pass no model when it is absent. Record the key as live for
     this conversation. A worker that stops at a gate ends its session: remove
     it from the live set. A gated worker is shown as `human-gate`, never stale,
     and holds no worker slot.
   - **A harness with no background sessions.** Print each brief, tell the
     human to start one session per brief in its worktree, and treat those keys
     as live once the human confirms. Claims, gates, review, and status work
     exactly the same.

After the first round, run `orchestrate status --live <live keys>` and print it.

## 4. Run the round

Handle each worker report as it arrives. Unrelated workers keep running
throughout.

- **`GATE: <question>`**
  1. `orchestrate gate <key> open --question "<question>"`
  2. Tell the human the ticket, the exact question, and that other workers
     continue.
  3. When the human answers, run
     `orchestrate gate <key> resolve --answer "<answer>"`, then resume **only
     that worker** with `orchestrate brief <key> --harness <harness> --session resume`.
     A gate is never answered for the human.

- **`DONE: <pull request>`**: review it.
  1. `orchestrate state <key> --set review --last "developer reported DONE: <pull request>"`
  2. Build `orchestrate brief <key> --harness <harness> --session review` and start
     a tester session with it.
  3. On **PASS**: `orchestrate state <key> --set done --last "review PASS"`. The
     ticket is now an integration candidate, landed under the project's merge
     policy.
  4. On **findings**: resume the developer with the resume brief and the
     findings appended. After **two** rounds of findings, open a gate with the
     question "Review found issues after two repair rounds: <summary>. How
     should this ticket proceed?"

- **`FAILED: <reason>`**
  1. `orchestrate state <key> --set failed --last "<reason>"`
  2. Report it to the human. A failed worker keeps its worktree and branch. The
     human decides whether to resume it with guidance or cancel the ticket.

- **A session that ends with no report.** Read its state file through
  `orchestrate status`. If it did not reach `done`, `failed`, or `human-gate`,
  it is stale. Report it and do not redispatch it.

## 5. Refresh eligibility

Re-plan whenever the running set changes. A worker reaches `done`, `failed`,
or `human-gate` and frees its slot, or a ticket in scope becomes Complete
because it was integrated or completed by the human:

1. For a Complete ticket, run
   `orchestrate board --comment-unblocked <key> --by <completed key>` for each
   ticket it was the last blocker of.
2. Re-run `orchestrate plan` with the current live keys, and claim and dispatch
   what it offers **under the approval already given**, within its scope and
   worker limit.

Stop when every worker has finished and the plan is `nothing-eligible`. Report
the final `orchestrate status`.

## Rules

- One approval per run, asked after the plan is shown and before any claim.
- Never implement, review, accept, merge, or answer a gate.
- Never dispatch a ticket the plan did not offer, one that already has a claim,
  or a stale claim.
- Never change a ticket's substance. Status moves only through the worker's
  own `/ticket load` and `/ticket start`.
- A worker at a human gate never stops unrelated workers.
