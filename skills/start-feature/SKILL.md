---
name: start-feature
description: Implement the active Feature in small, stable increments.
---

# Start Feature

Implement the active delivery chunk.

1. Read only the context needed for the current work.
2. Restate the pre-implementation summary the project's agent guide requires,
   and wait for it to be answered where it names a human decision. Do not edit
   any file before this step is done.
3. Follow the Feature and existing project conventions.
4. Make the smallest complete change.
5. Verify the behavior you changed.
6. Keep the repository stable.
7. Create or update `context/current-feature.md` with the current state and next action.

## Rules

- Stay inside the approved scope.
- Stop if implementation requires a human decision or material scope change.
- Do not silently add dependencies or adopt prototype code.
- Follow the project's approval and Git rules.
- Do not decide that your own work is accepted.

When the chunk is done, report what changed, what was verified, and anything
unresolved.
