# AI Interaction Guidelines

This file defines the default rules for AI-assisted work.
Project-specific instructions override these defaults when explicit.

## Communication

- Be concise, direct, and honest.
- Separate facts, assumptions, recommendations, and unresolved decisions.
- Do not invent answers for `TBD` items.
- After 2–3 grounded failed approaches, stop and explain the blocker.

## Human Approval

Ask before:

- architecture or dependency changes
- database, auth, payment, secrets, or security-sensitive changes
- destructive commands or file deletion
- Git history rewriting
- commits, merges, releases, or deployments
- adopting prototype code into production
- writes outside the repository, such as shared tracker changes

The human owns judgment, acceptance, merge, and release decisions.

## Git and Delivery

Follow `context/project-overview.md`.

Do not assume branch strategy, commit style, pull requests, versioning,
or deployment workflow.

Inspect current Git state before acting. If the workflow is unclear or
`TBD`, ask.

## Feature Workflow

Use the workflow skills instead of recreating their procedures in chat:

1. `load-feature` — load the active work and relevant context.
2. `start-feature` — implement the current delivery chunk.
3. `review-feature` — verify the work and report findings.
4. `complete-feature` — complete accepted work and durable records.
5. `learn-feature` — optionally teach what was implemented.

Roles are optional. The workflow must work without activating one.

### Status

Feature status records durable lifecycle state only:

`Proposed` → `Ready` → `In Progress` → `Complete`

`Cancelled` and `Superseded` are terminal alternatives.

- `Ready` means the human approved execution.
- Review and testing are optional workflow activity, not a status.
  A Feature stays `In Progress` until it is complete.
- `Blocked` is not a status; record the blocker in current workspace state.
- The human decides approval, acceptance, cancellation, and supersession.

## Context Discipline

- Read only what the current work requires.
- Prefer exact files or sections over broad repository scans.
- Do not load history, roadmap, tracker data, or unrelated context by
  default.
- Work one delivery chunk at a time.
- If the work can no longer be understood safely in a focused session,
  stop and split or hand off.
- Extra scaffolding must earn its cost by reducing downstream context.

## Scope Control

Stay inside the approved work.

Do not add unrelated refactors, features, dependency changes, visual
redesigns, speculative abstractions, or later roadmap work.

When necessary work falls outside scope, stop and ask.

## Prototypes

Use `debate-me` to decide whether a prototype is useful.

Use `prototype` to test one important assumption at a time.

Prototype output is evidence, not production code, until the human
explicitly approves adoption.

## Review

Review against the Feature and the actual diff.

Prioritize:

1. correctness
2. security and privacy
3. regressions and edge cases
4. accessibility when relevant
5. performance
6. maintainability

Verification effort should be proportional to risk.

Report findings; do not manufacture them.

## Learning

Explain what was actually implemented.

Use examples, diagrams, or quizzes only when they improve understanding.

Keep Feature learning scoped. Use `learn-codebase` for broad repository
study.
