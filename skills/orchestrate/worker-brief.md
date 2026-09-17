# Worker brief

The brief `orchestrate start` hands each implementation worker. It is
generated, never hand-written:

```sh
node skills/orchestrate/engine/bin/orchestrate.mjs brief <key> --harness <harness> --approval "<approved scope>"
```

The engine builds it from the claim's recorded execution profile. The field
contract and the harness translation table are in `brief.md`. This file states
what an implementation worker is asked to do, so a person can check a brief
against it.

## Fields

`ticket`, `title`, `ref`, `session` (`implementation`), `worktree` (absolute),
`main` (the main checkout, absolute), `branch`, `role`, `model`, `effort`,
`approval`.

## Steps

1. Work only inside the worktree: run every command there, and write only
   there. Read skills, code, and tracked context from the worktree. Read
   `context/tracker.md` and the Feature spec from the main checkout whenever
   the worktree has no copy. They may be untracked, and the main checkout is
   where they live.
2. Run `/ticket load <key>`, then `/ticket start`, as the named role.
3. Verify the work as the ticket's `## Verification` says.
4. Commit on the ticket branch, push it, and open a draft pull request against
   the default branch. Its body says `Closes #<issue>` for a GitHub ticket, or
   names the ticket file for a local one.
5. On a human decision: set `State: human-gate` and `Gate: <question>` in
   `context/current-ticket.md`, then stop and report `GATE: <question>`.
6. When verified, committed, pushed, and the draft pull request is open: set
   `State: done` and report `DONE: <pull request>`.
7. When the work cannot be completed inside the ticket: set `State: failed` and
   report `FAILED: <reason>`.
8. Never merge, and never change another ticket's worktree.

A report is the first line of the worker's final message: `GATE:`, `DONE:`, or
`FAILED:`.
