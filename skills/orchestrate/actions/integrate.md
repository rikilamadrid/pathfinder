# Orchestrate: Integrate

Decide whether completed work can land now. Worktrees isolate; they do not
resolve conflicts. Work complete, safe to integrate, and integrated are three
different facts.

## Assumed role

Unless the human explicitly activated a role, assume `integrator` for this
invocation: read `roles/integrator.md` and follow it. An explicit role overrides
this default. A role narrows responsibility and never grants human authority.

The engine is `node skills/orchestrate/engine/bin/orchestrate.mjs`, written
`orchestrate` below. Run coordination commands in the main checkout.

1. Run `orchestrate status --live <this run's live keys> --json`. Refuse outside
   orchestrator mode. Select only `done` claims, restricted to the named key
   when present. Order by the store's dependency graph, then their `Updated`
   completion time (key breaks ties). A dependency that is not Complete cannot
   be bypassed. A human gate, failed worker, stale claim, or live writer is not
   an integration candidate. Report it without stopping unrelated workers.
2. Read the documented Git workflow. Fetch the default branch and synchronize
   its local tip safely before checking; if the checkout is dirty, diverged,
   or cannot be synchronized, stop that integration and report the condition.
   Find the existing PR by the claim's branch. Require independent tester PASS,
   final ticket verification, and green required CI at the PR's current head.
   Missing or outdated evidence goes back to the tester/worker, not a guess.
3. Run `orchestrate check <key> --json`. It reports immutable base and worker
   commit IDs, `mergeBase`, `conflicts`, and advisory `overlaps` against other
   in-flight ticket branches. On refusal, preserve the claim and report it.
   - `behind`: choose the update strategy from the documented repository Git
     policy before dispatch. Read the destination project's project overview;
     for Pathfinder itself read CONTRIBUTING.md §Git workflow and §Releasing.
     If published-history rewriting or force-pushing is explicitly prohibited
     and ticket-branch merges are allowed, use `merge-and-reverify`. A rule
     requiring linear history on the default branch after squash merge does
     not itself prohibit merges into ticket branches. Where policy permits
     rebase, retain `rebase-and-reverify` with the required explicit rewrite
     approval. Never infer rewrite permission from silence or run approval.
     Missing, contradictory or uncertain policy, or a policy permitting neither
     strategy, opens a human gate before mutation. Record the policy source,
     chosen session, exact base/worker SHAs and branch-update approval in the
     handoff. This is agent interpretation of documented policy, not a new
     prose parser, routing policy or durable configuration schema.
   - `conflict`: serialize this ticket behind the merge that made it conflict
     and send its worker the `resolve-conflict` brief with the paths and heads.
   - `candidate`: continue to step 5. Overlap while both branches are in flight
     is advisory; show it and choose merge order deliberately. After one lands,
     check the other again; never reuse the old candidate result.
4. Revalidation runs in the same claim, with no other writer present:

   ```sh
   orchestrate brief <key> --harness <harness> --session rebase-and-reverify --approval "<scope>" --json
   # or --session merge-and-reverify / resolve-conflict
   ```

   Dispatch using `start` step 3's harness translation, under the unchanged
   recorded implementation profile. Obtain explicit permission for any rebase
   or force-push the project gates; a merge approval does not imply permission
   to rewrite history. Append integration evidence and the human's guidance.
   Before dispatch, checkpoint `State: working` and `Next` with the chosen
   session, target base SHA and pending update/verification in the existing
   current-ticket file. Updating a ticket branch is separately authorised from
   merging its PR into the default branch. Both strategies preserve the claim,
   worktree, branch, execution profile and PR. After the branch update, the
   worker checkpoints remaining verification. Compare behavior before/after the
   update, recording evidence and reasoning. When unchanged, checkpoint
   `Review: integration:<exact head SHA>`, `State: review`, and `Next` confirming
   full verification and push complete; fresh independent Tester is pending.
   If behavior changed (including confirmed repairs or behavior-changing conflict
   resolution), checkpoint `Adversary: required`, `Review: ordinary` and
   `State: adversary` before ending; rerun Adversary then Tester. Keep old reports
   as historical SHA-bound evidence until complete replacement. Never set done
   before fresh Tester review. Use `stage --advance` and its validated brief
   session, not an unconditional Tester dispatch. Previous-head PASS or CI is stale.
   Require full ticket verification, fresh independent PASS and current-head CI;
   only then mark done and restart this action's checks. No fresh integration
   result or review alone authorises the final PR merge.
   Never resolve a conflict as integrator. If the worker cannot resolve within
   scope, open its exact human gate and let other workers continue.
5. Present this ticket's PR link, tester/CI evidence, overlap, and current
   `candidate` check. Ask for the human's approval of this ticket's acceptance
   and merge unless that exact approval already exists and its stated
   conditions are satisfied. Approval of a run alone never approves merging.
   Without approval, stop this ticket here without merging or releasing.
6. Immediately before merging, refresh the default branch, PR head, CI and
   check. If either commit ID differs from the presented evidence, restart the
   checks. Merge only the approved current head, through the project's merge
   workflow (Pathfinder uses squash merge). Do not let the forge delete a local
   branch/worktree: cleanup belongs to `release`. A rejected/failed merge
   preserves everything and is reported, never treated as completion.
7. Synchronize the default branch after successful merge. Run
   `/ticket complete <key>` explicitly through its canonical action: final
   verification, store completion, derived Feature status/history and readiness.
   A forge auto-close is not the entire completion transition: remove any
   obsolete status label, and record the PR/merge and verification evidence
   compactly in the ticket. If completion fails, keep the claim for retry.
8. With no session still using the worktree, `orchestrate release <key>` removes
   the worktree, merged branch, and claim ref. It accepts ancestry or Git tree
   evidence of squash inclusion. It never guesses from a closed issue alone.
   A refusal preserves unmerged or dirty work. Only explicit human permission
   to discard it permits `release <key> --force --approval "<permission>"`;
   force is not the normal squash-merge path.
9. Re-check every remaining done claim after each merge before presenting
   another. Report newly eligible tickets and return them to the orchestrator
   for its next plan under the run's existing scope. Do not claim or dispatch
   as integrator, and never exceed a human restriction on follow-on tickets.

## Recovery

A failed or unavailable worker retains its ticket, branch, worktree, claim and
profile. `resume` is the only return to work, with guidance for a failed worker.
Use its recorded State, Updated, and Next instead of starting over. For an
interrupted refresh, preserve the selected strategy and target SHA in Next;
resume the same integration session under the same policy and approval. Inspect
ancestry and any in-progress merge/rebase before acting: do not repeat an update
already incorporated, change strategy silently, or discard unresolved work.
If policy or target identity cannot be established, gate before mutation. Pending update, verification or push resumes Developer with the same strategy,
even if Next also mentions future review. Resume Tester only from recorded
`State: review` with Next explicitly confirming verification and push complete
at the exact current PR head SHA and Tester pending. A new base head requires fresh assessment; a new worker head requires
fresh review and CI. Never infer current verification from Last alone.
A full bounded Tester findings checkpoint precedes Developer repair; partial
repair retains its reviewed origin, then returns through Adversary on the new head.
A compatible
replacement harness is permitted only after the old writer has stopped.
