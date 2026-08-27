# Feature: Load

Prepare one Feature for execution.

1. Select the Feature the human named. Being invoked on it is the approval to
   prepare it for execution, so its spec does not already have to say `Ready`.
   Its spec is `NN-feature-name.md` in the spec source, and `NN` is its Feature
   number.
2. Read the Feature spec.
3. Read only the files or context needed for the current work.
4. Inspect the current Git state.
5. Stop if a required human decision or explicit dependency blocks the work.
6. Record the approval in the Feature spec's `## Status`, which holds the
   durable lifecycle state:
   - `Proposed` becomes `Ready`. That is the only value this action writes.
   - `Ready` or `In Progress` is left exactly as it is. Reloading a Feature
     mid-work is normal and must not rewrite its state.
   - `Complete`, `Cancelled`, or `Superseded` blocks the load. Report it and
     stop. Reopening terminal work is the human's decision.

   Do this only once steps 1-5 found no blocker, and before the next step, so a
   blocked load never leaves a promoted spec behind.
7. Create or update `context/current-feature.md` — it does not ship, so the
   first load writes it — with:
   - Feature number, name, and spec path
   - active ticket
   - Git state
   - blocker, if any
   - next action

   Do not record the lifecycle status here. This file is transient workspace
   state belonging to one session on one machine; the spec carries the durable
   status.
8. If `context/tracker.md` exists, name the tracked item for this Feature —
   its key is that Feature number. Do nothing here if it does not.
9. Present a short readiness summary.

Do not implement the Feature. That is `/feature start`.

Do not scan unrelated repository areas, load history or roadmap by default, or
silently resolve `TBD` decisions.

Do not rewrite the Feature's substance — its Goal, Context, Requirements, Out of
Scope, or Acceptance Criteria. `## Status` is the one field this
action maintains.
