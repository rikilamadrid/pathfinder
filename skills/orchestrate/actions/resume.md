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
     conversation; with that guidance, continue at step 3. Cancelling instead
     is a separate human decision: preserve the worktree, branch, claim, and
     profile until the human explicitly authorises their release.
3. Confirm the run's approval. A resume inside a running `/orchestrate start`
   uses that run's approval. A resume on its own asks the human once, stating
   the same scope for this one ticket.
4. Read `Next` before choosing the session. If it records a pending integration
   refresh, use its `merge-and-reverify` or `rebase-and-reverify` session with
   the recorded target SHA, policy evidence and approval, and inspect Git
   progress before repeating work. Pending update, verification or push always
   resumes the Developer refresh, even if Next also mentions future review.
   Dispatch Tester only when recorded `State: review` and Next explicitly says
   verification and push are complete at the exact head SHA, with Tester pending.
   Confirm that head still matches the PR; stale evidence needs revalidation.
   Use `review` for that handoff, never a Developer update.
   Missing or ambiguous integration guidance requires a gate before mutation.
   Otherwise build the ordinary resume brief:

   ```sh
   orchestrate brief <key> --harness <harness> --session resume --approval "<approved scope>" --json
   ```

   Add the human's gate decision or guidance, when there is one, beneath the
   brief text: `translation.invocation.prompt` for Claude Code and manual
   sessions, `translation.invocation.arguments.message` for Codex.
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
