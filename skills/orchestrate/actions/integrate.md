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
   - `behind`: send the existing worker the `rebase-and-reverify` brief.
   - `conflict`: serialize this ticket behind the merge that made it conflict
     and send its worker the `resolve-conflict` brief with the paths and heads.
   - `candidate`: continue to step 5. Overlap while both branches are in flight
     is advisory; show it and choose merge order deliberately. After one lands,
     check the other again; never reuse the old candidate result.
4. Revalidation runs in the same claim, with no other writer present:

   ```sh
   orchestrate brief <key> --harness <harness> --session rebase-and-reverify --approval "<scope>" --json
   # or --session resolve-conflict
   ```

   Dispatch using `start` step 3's harness translation, under the unchanged
   recorded implementation profile. Obtain explicit permission for any rebase
   or force-push the project gates; a merge approval does not imply permission
   to rewrite history. Append integration evidence and the human's guidance.
   Mark the worker working when it starts. Require all ticket verification and
   independent review again; then mark done and restart this action's checks.
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
Use its recorded State, Updated, and Next instead of starting over. A compatible
replacement harness is permitted only after the old writer has stopped.
