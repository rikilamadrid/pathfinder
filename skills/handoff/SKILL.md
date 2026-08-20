---
name: handoff
description: Leave the minimum factual state another session needs to continue safely.
---

# Handoff

Create or overwrite `context/handoff.md`.

Read only what is needed to describe the current state:
the active Feature, relevant Git state, and verification already performed.

Do not load history, roadmap, unrelated Features, or broad repository context
by default.

Write:

# Handoff

- Feature: `[feature or work]`
- Done: `[what was completed]`
- Verified: `[what was actually checked]`
- Open: `[blocker, finding, or none]`
- Next: `[single next action]`
- Read next: `[specific file(s), only when useful]`

Keep it factual and short.

Do not repeat requirements, acceptance criteria, project history, or decisions
already recorded in their canonical location.

Do not include private chain-of-thought or conversation transcripts.
