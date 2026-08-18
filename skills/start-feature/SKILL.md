---
name: start-feature
description: Implement the active feature one stable delivery chunk at a time under the project's approved workflow.
---

# Start Feature

## Before Coding

Restate goal, chunk, files/areas, context, risks, assumptions, verification, exclusions, Git state, and intended Git action.

## Process

1. Follow the project's documented Git and approval policy.
2. Read only the active chunk's context.
3. Implement the smallest complete change.
4. Verify the chunk with relevant checks.
5. Keep the project stable.
6. Update current-feature state and move to the next chunk only when appropriate.

## Rules

- Stop on conflicts between spec, durable context, and repository reality.
- Do not add dependencies, expand scope, adopt prototype code, commit, merge, or deploy without the documented approval.
- Do not hide multiple features inside one delivery chunk.
- Do not publish to a work tracker, even when `context/tracker.md` exists — the repository is canonical and a chunk boundary is not a tracker event.
