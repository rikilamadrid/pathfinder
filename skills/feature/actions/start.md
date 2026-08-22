# Feature: Start

Implement the active delivery chunk.

1. Read only the context needed for the current work.
2. Restate the pre-implementation summary the project's agent guide requires,
   and wait for it to be answered where it names a human decision. Do not edit
   any file before this step is done.
3. Record the Feature spec's `## Status` as `In Progress`, before the first file
   edit of the first chunk:
   - `Ready` becomes `In Progress`. That is the only value this action writes.
   - `In Progress` is left exactly as it is. Continuing a Feature across
     sessions and chunks is normal and must not rewrite its state.
   - Any other status stops the session. Report it. A Feature that was never
     loaded is not approved for execution, and terminal work is the human's to
     reopen.
4. Follow the Feature and existing project conventions.
5. Make the smallest complete change.
6. Verify the behavior you changed.
7. Keep the repository stable.
8. Create or update `context/current-feature.md` with the current state and next
   action. Do not record the lifecycle status there; the spec carries it.

## Rules

- Stay inside the approved scope.
- Stop if implementation requires a human decision or material scope change.
- Do not silently add dependencies or adopt prototype code.
- Follow the project's approval and Git rules.
- Do not decide that your own work is accepted.

When the chunk is done, report what changed, what was verified, and anything
unresolved.
