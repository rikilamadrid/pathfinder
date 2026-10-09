# Orchestrate: Start

Run approved tickets concurrently: plan, ask once, claim, dispatch, review,
surface gates, and stop at the round boundary. A run spans as many rounds as
it needs; each round is one coordinating session, and a new session continues
the run from engine state, never from the previous conversation.

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
- **`nothing-eligible`**: report the blocked, deferred, and stale lists. If the
  stale list names pending claims as §Continuing a run defines them, continue
  there; otherwise **stop**. For a ticket blocked by a planning question (a
  Cancelled or Superseded blocker) the question is the human's.
- **`dispatch`**: continue. If the stale list also names pending claims, they
  join this round as §Continuing a run says, ahead of new claims.

A stale claim is never claimed again and never dispatched without a person
confirming its old session has stopped. Pending claims from a previous round
are continued under this round's one approval (§Continuing a run); any other
stale claim is listed, and each can be resumed deliberately with
`/orchestrate resume <key>`.

## 2. Ask once

Print the plan exactly as the engine produced it, including every profile and
the approval scope. Then ask the human one question: approve this run as scoped?

- An approval covers the pending claims this round continues and the tickets
  this round's plan offers to claim now, up to the worker limit, and nothing
  the scope statement excludes. Nothing is claimed after the dispatch wave: a
  ticket that becomes eligible during the round waits for the next round. A
  later round asks again: approval is not carried between sessions, because
  nothing from a previous conversation is.
- When the round continues pending claims from a previous round, the same
  question states them by key and adds one sentence: the human confirms that no
  session from the previous round is still running. Without that confirmation,
  continue nothing; `/orchestrate resume <key>` remains available per claim.
- For each pending claim whose selection is `repair`, the same question also
  asks for that claim's confirmed-findings repair count, as the previous
  round-boundary report stated it. The engine does not hold the count and a
  missing answer is not zero: an unknown count, or a count of two or more,
  opens the human gate instead of dispatching another repair (§Continuing a
  run step 4).
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
   orchestrate brief <key> --harness <harness> --approval "<the scope the human approved>" --json
   ```

   A refusal names a model or effort this harness cannot honour. Do not dispatch
   that ticket. Report the refusal to the human and continue with the others.

3. Start the worker session. **This is the one harness-specific step.** Every
   step before and after it is the same in every harness.

   - **Claude Code.** Start a background subagent whose prompt is
     `translation.invocation.prompt`. Pass `translation.invocation.model` as the
     subagent's model when it is present, and pass no model when it is absent.
     Record the key as live for this conversation. A worker that stops at a gate
     ends its session: remove it from the live set. A gated worker is shown as
     `human-gate`, never stale, and holds no worker slot.
   - **Codex.** Call the tool named by `translation.invocation.tool`
     (`collaboration.spawn_agent`) with `translation.invocation.arguments`
     exactly. The static selection uses `fork_turns: "all"` with no model or
     effort overrides, inheriting both from this session. The message carries
     the role and absolute worktree: the tool has no directory argument, so
     every worker shell call must set `workdir` to that path. Record the
     returned agent identifier for reports and the ticket key as live; remove
     the key when its session ends or reaches a gate. If the named tool is
     unavailable, stop dispatch and report the missing capability; do not
     substitute a manual session or another harness. Override limits and
     resume behavior are documented in `skills/orchestrate/brief.md`.
   - **A harness with no background sessions.** Print each brief's
     `translation.invocation.prompt`, with its `model` and `effort` when present,
     tell the human to start one session per brief in its worktree, and treat
     those keys as live once the human confirms. Claims, gates, review, and
     status work exactly the same.

After the first dispatch wave, run `orchestrate status --live <live keys>` and print it.

## 4. Run the round

Handle each worker report as it arrives. Unrelated workers keep running
throughout.

- **`GATE: <question>`**
  1. `orchestrate gate <key> open --question "<question>"`
  2. Tell the human the ticket, the exact question, and that other workers
     continue.
  3. When the human answers, run
     `orchestrate gate <key> resolve --answer "<answer>"`, then resume **only
     that worker** through `stage --advance`, preserving its gated phase: build
     `orchestrate brief <key> --harness <harness> --session <selected session> --approval "<the scope the human approved>" --json`
     and start it exactly as step 3 does. A gate is never answered for the human.

- **`DONE: <pull request>`**, **`EXPERIMENTS: <pull request>`**, or **Tester PASS/findings**:
  1. Remove the finished session from the live set. Never dispatch while another
     session still owns this claim. Read its checkpoint; Developer completion
     must already be `adversary`, never reviewed `done`.
  2. Run `orchestrate stage <key> --live <live keys> --advance --json`. It
     queries the current PR, validates identity, completeness and SHA, and
     checkpoints the selected phase before dispatch. Do not reconstruct reports
     from `Last` or append findings solely to a live prompt.
  3. Dispatch its returned `session` using
     `orchestrate brief <key> --harness <harness> --session <session> --approval "<approved scope>" --json`
     and step 3's exact harness translation. `adversary` invokes the stateless
     action; only its complete current-head experiment report permits `review`.
     The review brief carries that report for independent verification.
  4. Tester writes the full bounded findings/verification/limits checkpoint
     before reporting. Matching complete findings select `repair`; advancing
     records a pending repair origin before Developer dispatch. Only the owning
     Developer can run `stage --begin-repair` before edits to record started
     repair after matching reviewed/current PR and local head checks. A stop
     after advancement but before worker start still requires head freshness.
     The repair brief
     carries the confirmed findings. A restart with those findings does not
     require repeating Tester. Missing/incomplete findings stay in review;
     stale findings before first repair require coordination, never invented
     repair instructions. Partial repair resumes using its original findings.
  5. A repaired published head returns to Adversary, then fresh Tester. After
     two rounds of confirmed findings, open the existing human gate with the
     exact summary; do not repair forever or use Adversary suspicions as findings.
  6. A current-head Tester PASS with the required matching experiments (or its
     recorded legacy/integration exception) selects `done` with no worker session. Hand it
     to `/orchestrate integrate <key>`; it remains unaccepted until the human gate.
     A refusal preserves the claim and is reported without dispatch.

- **`FAILED: <reason>`**
  1. Preserve `Failed stage: <pending phase>` before setting `State: failed`.
     Workers must checkpoint it; `orchestrate state <key> --set failed --last
     "<reason>"` records it automatically when transitioning a pending phase.
     Never infer a missing failure phase from `Last`.
  2. Record the failure reason once in the ticket’s Notes / Decisions (an issue
     comment for GitHub), without changing its lifecycle status. Report it to
     the human. A failed worker keeps its worktree and branch. The
     human decides whether to resume it with guidance or cancel the ticket.

- **A session that ends with no report.** Read its state file through
  `orchestrate status`. If it did not reach `done`, `failed`, or `human-gate`,
  it is stale. Report it and do not redispatch it.

## Compatibility at adoption

At a stopped-session boundary before the first dispatch with this version,
classify pre-existing claims once with `orchestrate stage <key> --adopt`.
The coordinator must establish this is an actual pre-adoption claim, not a
new claim whose marker was lost. A claim already in legacy review receives
`Adversary: legacy-review:<exact PR head SHA>` for that one review; other
unfinished claims and newly seeded claims require `Adversary: required`.
Never classify a live session or rewrite its file concurrently. Do not classify
completed retained claims. Missing, duplicate or unreadable markers after adoption
are invalid and require coordination; never grant legacy status implicitly.
Legacy findings use the same Tester checkpoint and convert to required flow
before repair. Changed heads cannot inherit the legacy exception.

## 5. Round boundary

A round is one dispatch wave and the handling of every report it produces. The
claims this session dispatched continue through their phases as step 4 says,
each phase a new worker session, until none of them has a live session: every
claim this round touched is `done`, `human-gate`, `failed`, or checkpointed at
a pending phase with no worker running. That is the round boundary, and the
coordinating session ends there. It does not re-plan into new claims.

While the round runs, a ticket in scope may become Complete because it was
integrated or completed by the human. For each ticket it was the last blocker
of, run `orchestrate board --comment-unblocked <key> --by <completed key>`. The
newly eligible ticket is reported at the boundary and claimed by the next
round.

At the boundary:

1. Run `orchestrate status` with this round's `--feature` scope and no live
   keys, and print it. Pending claims show as `stale`; that is the engine's
   word for "no live session", and it is expected here. The recorded `State`
   behind a `stale` row is `recordedState` in `status --json`.
2. Run `orchestrate plan` with the same scope and no live keys and print it: it
   names what the next round would continue and what it would claim.
3. Report, one line per claim with a worktree: its recorded `State`, the
   session `stage <key> --json` would select next or its refusal, and its
   confirmed-findings repair count: the count the human stated at this round's
   approval, or zero for a claim this round first claimed, plus every repair
   this round dispatched for it. The engine does not hold that count; the next
   round asks the human for it (§2) to apply the two-round rule.
4. Stop. The human starts the next round with `/orchestrate start` in a new
   session, which continues as §Continuing a run says.

Never end the coordinating session while a worker session it started is still
live. A worker whose coordinator ended before the boundary is continued only
after the human confirms its session has stopped: as a pending claim under
§Continuing a run, or through `resume`. In Claude Code a worker is a subagent
of the coordinating session and ends with it. In Codex, and in a harness with
no background sessions, a worker session can outlive a coordinator that ended
abnormally; the engine holds no process handle, liveness is what the caller
declares with `--live`, and the human's confirmation is the only guard, as it
already is for `resume`. This change does not add one.

## Continuing a run

A new session holds no live set, so the engine shows every claim the previous
round left mid-flight as `stale`. Nothing is reconstructed from the previous
conversation. Scope, worker limit, harness, and approval come from this
invocation; everything else comes from the store, Git, and the claims' own
state files, which is where the engine has always read it.

A **pending claim** is a `stale` row with a worktree whose recorded `State` is
`working`, `adversary`, `review`, or `repair`. `human-gate`, `failed`, and
`done` rows keep their existing handling: `resume` with the human's answer or
guidance, and `integrate`.

1. Run `orchestrate status` with this invocation's `--feature` scope and no
   live keys. List the pending claims by key with their recorded `State`
   (`recordedState` in `status --json`). A stale claim outside this scope is
   not a pending claim of this round; it is listed and left to `resume`. For
   each pending claim, run `orchestrate stage <key> --json` without `--advance`
   and note the session it would select, or its refusal.
2. Run `orchestrate plan` with the same scope and no live keys. This round's
   scope is the pending claims first, then what the plan would claim, within
   the worker limit.
3. Ask once, as §2 says, with the confirmation sentence and, for each pending
   claim whose selection is `repair`, the confirmed-findings repair count.
4. For each pending claim, in key order:
   - If its selection is `repair` and the human stated a count of zero or one,
     continue. If the count is unknown, or two or more, run
     `orchestrate gate <key> open --question "<the exact findings summary and
     the count as stated>"`, report it, and continue with the next claim. Never
     dispatch another repair for it, and never infer zero from a missing count.
   - Run `orchestrate stage <key> --advance --json` with no live keys and
     dispatch its returned `session` exactly as §3 does: `brief <key> --harness
     <harness> --session <returned session> --approval "<approved scope>" --json`
     and the harness translation. The selector reads the checkpoint, the
     current PR head and the reports, and refuses anything incomplete or stale;
     a refusal preserves the claim and is reported, never worked around. Record
     the key as live.
5. Claim and dispatch new tickets from the plan into the slots the worker
   limit leaves after the pending claims, as §3 says.
6. Run the round as §4 and end it as §5.

## Rules

- One approval per round, asked after the plan is shown and before any claim
  or continuation.
- Never implement, review, accept, merge, or answer a gate.
- Never dispatch a ticket the plan did not offer, one that already has a claim,
  or a stale claim, except a pending claim continued under §Continuing a run
  after the human's confirmation.
- Never end the coordinating session while a worker session it started is live.
- Never dispatch a repair for a pending claim without the human's stated
  confirmed-findings repair count; unknown, or two or more, opens the gate.
- Never change a ticket's substance. Status moves only through the worker's
  own `/ticket load` and `/ticket start`.
- A worker at a human gate never stops unrelated workers.

## Optional unresolved-concern assessment

Only when explicitly requested at a complete ordinary review boundary, use
[`routing-assessment.md`](../routing-assessment.md). It is off by default and
requires separate routing consent for the concern/provider/invocation. Never
automatically invoke it from this action. Present its recommendation to the
human; any human-directed follow-up is a second, separately authorized operation,
never a provider instruction or automatic dispatch.
