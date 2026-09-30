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

Choose the session through `orchestrate stage <key> --advance --json` before
building the brief. Ordinary `resume` continues implementation; `repair`
receives only complete checkpointed Tester findings. `stage --advance` records
`Repair: pending:<SHA>`; only the owning Developer runs `stage --begin-repair`
before edits to validate freshness and record `Repair: started:<SHA>`, retaining the original
reviewed SHA through partial repair. Completion marks `Repair: completed:<SHA>`
before Adversary so historical findings cannot be mistaken for new repairs.
A live appended prompt never replaces the transient report.

A failed session preserves `Failed stage` before failure. After confirming it
stopped and obtaining human guidance, the coordinator runs
`stage --advance --guidance "<human answer>"` to restore that recorded phase
through the same head/report checks. Missing origins require a human gate.
