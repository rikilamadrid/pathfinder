# Orchestrate: Status

Show what is being worked on, by whom, what is blocked, and what needs a human.

## Assumed role

Unless the human explicitly activated a role, assume `orchestrator` for this
invocation: read `roles/orchestrator.md` and follow it. An explicit role overrides
this default. A role narrows responsibility and never grants human authority.

1. Run, from the repository:

   ```sh
   node skills/orchestrate/engine/bin/orchestrate.mjs status [--feature NN] [--live <keys>]
   ```

   - `--feature NN` limits the view to one Feature. Omit it for the whole board.
   - `--live` names the claims whose sessions this conversation started and is
     still running, comma-separated. Name none you did not start. A session
     started by an earlier conversation is not live: its claim is `stale` until
     it is resumed.

2. If the command exits non-zero, report its message verbatim and stop. A
   refusal names what to fix — the mode file, the store marker — and fixing it
   is the human's decision.
3. Print the table exactly as the engine produced it.
4. Below it, report only what needs attention, one line each, in this order:
   - every `human-gate` row, with its question
   - every `failed` row
   - every `stale` row, and that it can be resumed rather than redone
   - every `blocked` row whose blocker is a planning question rather than a wait
   - the `ready` rows, as the work that could be claimed next

   When nothing needs attention, say so in one line.

## States

`ready`, `blocked`, `working`, `review`, `human-gate`, `done`, `stale`,
`failed`, `integrated`. The table's LIFECYCLE column is the store's status and
is never rewritten here. `integrated` is the view's word for `Complete`.

## Rules

- Read only. Claim nothing, dispatch nothing, and write nothing to a worktree,
  the store, or the repository.
- Do not infer liveness. A claim is live only when this conversation started
  its session.
- Do not interpret a gate's question or answer it. Surface it to the human.
