# Resume brief

The brief for continuing an existing claim: a stale worker, a worker whose human
gate was just resolved, or a developer sent back with review findings.

```sh
node skills/orchestrate/engine/bin/orchestrate.mjs brief <key> --harness <harness> --session resume --approval "<approved scope>"
```

It carries the same fields as `worker-brief.md`, with `session: resume` and the
role, model, and effort the claim recorded for implementation.

## Steps

1. Work only inside the worktree: run every command there, and write only
   there. Read `context/tracker.md` and the Feature spec from the main checkout
   whenever the worktree has no copy.
2. Read `context/current-ticket.md` first. Continue from its `Next` line and
   from the commits already on the branch. Do not restart work that is already
   done.
3. If a human gate was just resolved, the decision is in the ticket's latest
   gate note. Act on it.
4. Run `/ticket load <key>`, then `/ticket start`, as the named role. Both
   leave an In Progress ticket as it is.
5. Verify, commit, push, and keep or open the draft pull request, as in
   `worker-brief.md`.
6. Report `GATE:`, `DONE:`, or `FAILED:` exactly as in `worker-brief.md`.
7. Never merge, and never change another ticket's worktree.

Review findings the orchestrator sends back are appended beneath the brief. A
resumed developer repairs those and nothing else.
