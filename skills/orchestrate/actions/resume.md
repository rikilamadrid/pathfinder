# Orchestrate: Resume

Continue one existing claim deliberately, rather than redoing its work.

## Assumed role

Unless the human explicitly activated a role, assume `orchestrator` for this
invocation: read `roles/orchestrator.md` and follow it. An explicit role overrides
this default. A role narrows responsibility and never grants human authority.

The engine is `node skills/orchestrate/engine/bin/orchestrate.mjs`, written
`orchestrate` below.

1. Take the key from the invocation. If none was given, run `orchestrate status`,
   list the `stale` rows, and stop.
2. Run `orchestrate status --live <keys this conversation already started>`
   and find the key's row. Keep the live set accurate: a fresh CLI process is
   not evidence that another session ended. Confirm the old session has stopped
   before starting its replacement.
   - `human-gate`: the worker stopped for a human and is not stale, even with
     no session running. The gate must be resolved first. If the human has
     answered in this conversation, run
     `orchestrate gate <key> resolve --answer "<answer>"` and continue.
     Otherwise, restate the question and stop.
   - `stale` with a worktree: continue.
   - `stale` with no worktree (branch only, or a claim ref only): nothing is
     here to resume. Report it, and leave releasing it to the human.
   - `done`, `failed`, `working` in a live session, or no claim at all: report
     the row and stop. Resume never starts a second session on live work, and a
     failed worker resumes only when the human has given guidance in this
     conversation; with that guidance and a recorded `Failed stage`, continue
     at step 3. A missing/unreadable failure origin requires a human decision,
     never a phase guessed from `Last`. Cancelling instead
     is a separate human decision: preserve the worktree, branch, claim, and
     profile until the human explicitly authorises their release.
3. Confirm the run's approval. A resume inside a running `/orchestrate start`
   uses that run's approval. A resume on its own asks the human once, stating
   the same scope for this one ticket.
4. Select from the existing checkpoint, never unconditionally resume Developer:

   ```sh
   orchestrate stage <key> --live <this run's live keys> --advance --json
   orchestrate brief <key> --harness <harness> --session <returned session> --approval "<approved scope>" --json
   ```

   For a stopped failed worker, replace the ordinary stage command with the
   human's explicit guidance:

   ```sh
   orchestrate stage <key> --live <live keys> --advance --guidance "<human answer>" --json
   ```

   This restores only its recorded `Failed stage`, validates the ordinary
   head/report rules before writing, and preserves Next's integration strategy
   and target. It never interprets Last as phase, guidance or findings. Without
   guidance or a readable origin it refuses, preserving the failed claim.

   Establish any one-time adoption classification as `start` defines before
   stage selection. An absent marker is not a legacy exemption. The stage
   selector checks the current PR and exact report head. `adversary` with no
   complete matching report resumes Adversary; a complete matching report
   permits Tester even if the prior session stopped before the state transition.
   A complete matching Tester findings checkpoint resumes confirmed repair
   without rerunning Tester; absent/incomplete findings leave review pending.
   Stale findings before repair never become instructions. An already-started
   repair retains its original reviewed findings through partial pushes.
   Advancement alone records pending repair; the owning Developer must run
   `stage --begin-repair` before edits to validate current reviewed/local head
   freshness and record started repair. For integration-origin repair, this
   validated start consumes the full verification/push prerequisite for that
   origin; later factual `Next` progress updates do not erase it.
   `done` requires current-head Tester PASS and returns to integration.

   Preserve pending integration refresh session/target/policy/approval from
   `Next`; resume that Developer session until update, full verification and
   push finish. Its separate `Review: integration:<head SHA>` path permits fresh
   Tester at that exact head without Adversary only when behavior is unchanged.
   Behavior changes enter Adversary. Missing/ambiguous guidance or unexpected
   head drift requires coordination before mutation. Add human guidance beneath
   the translated prompt only as supplemental context, never as the sole findings
   checkpoint. Ordinary Tester evidence never overrides a missing or stale
   required experiment checkpoint; preserve the report and report the refusal.

5. Start the worker session exactly as `start` step 3 does for the active
   harness, and record the key as live.
6. Handle its reports exactly as `start` step 4 does.

## Rules

- Resume is the only way back to a stale claim. Never claim that ticket again,
  and never delete its worktree or branch.
- One session per claim.
- A replacement session may use a different supported harness. First establish
  that the old session has ended or has been stopped; never overlap writers.
  Translate the same persisted claim and profile for the replacement harness.
  If that harness refuses the recorded model or effort, report it without
  changing the profile. No new claim, worktree, branch, or automatic failover
  is implied by harness substitution.

### Explicit human-directed same-head follow-up

A human request for more investigation is not an assessment recommendation and
must not be recorded only in `Next`. Before resuming the stopped ordinary
review/done claim, use `orchestrate followup <key> --request <file> --live <keys>`
with the current live-worker inventory (an empty string when none). The file is
an explicit human direction, not provider output:

```json
{
  "schema": "pathfinder.human-followup/1",
  "ticket": "57.5",
  "pr": "https://github.com/owner/repo/pull/123",
  "head_sha": "<exact current 40-character SHA>",
  "target": "tester",
  "concern": { "id": "boundary-input", "summary": "Investigate repeated boundary input" },
  "checkpoint": "<SHA-256 of exact current-ticket.md bytes reviewed by the human direction>",
  "authorization": {
    "by": "human",
    "kind": "review-follow-up",
    "direction": "<the human's explicit follow-up direction>"
  }
}
```

`target` is only `tester` or `adversary`. Bind the direction to the checkpoint
read for that concern with `checkpointDigest` from `engine/followup-record.mjs`.
Changed bytes require refreshed direction; never automatically rewrite the
request digest. The operation validates ownership, current PR/local head,
complete reports, stopped ordinary review/done state and no conflicting live
worker. An open human gate must be handled through its existing human process;
this operation cannot resolve it. Confirmed Tester findings still use repair.

One atomic checkpoint replacement records the concern/direction, retains the
retired reports under historical headings, and sets the required pending role.
No worker is spawned. Repeating the identical request is a no-op; interruption
before replacement leaves the old checkpoint, and interruption after replacement
retains the complete new obligation. A busy/interrupted checkpoint lock refuses;
use the existing explicit checkpoint-lock recovery policy, never steal a live
lock or infer that a partially observed request succeeded.

Then use ordinary `stage --advance` and the selected worker brief. The brief
carries the fresh cycle binding: `followup.id`, `concern` digest, bounded
`response` describing actual concern verification, and `experiments_digest`.
Tester binds the exact current experiment report and independently verifies it;
Adversary binds the retired experiment baseline. Reports must contain fresh
actual evidence, not renamed old evidence. Reader-side checks reject old,
stale or relabeled reports even if copied back into active headings. These
bindings enforce traceability, not semantic proof that a worker was honest.
Adversary follow-up always returns through fresh independent Tester. The usual
repair origins, two-round escalation, acceptance and merge gates still apply.

## Optional unresolved-concern assessment

Only when explicitly requested at a complete ordinary review boundary, use
[`routing-assessment.md`](../routing-assessment.md). It is off by default and
requires separate routing consent for the concern/provider/invocation. Never
automatically invoke it from this action. Present its recommendation to the
human; any human-directed follow-up is a second, separately authorized operation,
never a provider instruction or automatic dispatch.
