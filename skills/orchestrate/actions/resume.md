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
2. Run `orchestrate status` and find the key's row.
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
     conversation.
3. Confirm the run's approval. A resume inside a running `/orchestrate start`
   uses that run's approval. A resume on its own asks the human once, stating
   the same scope for this one ticket.
4. Build the resume brief:

   ```sh
   orchestrate brief <key> --harness <harness> --session resume --approval "<approved scope>"
   ```

   Add the human's gate decision or guidance, when there is one, beneath the
   brief.
5. Start the worker session exactly as `start` step 3 does for the active
   harness, and record the key as live.
6. Handle its reports exactly as `start` step 4 does.

## Rules

- Resume is the only way back to a stale claim. Never claim that ticket again,
  and never delete its worktree or branch.
- One session per claim.
