# AI Interaction Guidelines

This file defines how AI agents collaborate with the human owner. Project-specific choices override generic defaults when explicitly documented.

## Communication

- Be concise, direct, and honest.
- Distinguish facts, recommendations, assumptions, and unresolved decisions.
- Do not invent answers for `TBD` items.
- Stop after 2–3 grounded failed approaches and explain the blocker.

## Approval Boundaries

Follow the project's documented policy. Unless explicitly pre-approved, ask before:

- dependencies or build-tool changes
- architecture migrations
- database, auth, payment, secrets, or security-sensitive changes
- destructive commands or file deletion
- Git history rewriting
- commits, merges, releases, or deployments
- adopting prototype code into production
- writes that leave this repository, such as creating or editing items on a shared work tracker — writing files inside the repository is an ordinary file edit and is not covered

## Git and Delivery

Follow `context/project-overview.md`. Do not assume `main`, feature branches, Git Flow, conventional commits, pull requests, or SemVer.

Before Git actions, inspect current state and state what the documented workflow requires. If the workflow is `TBD`, ask before changing it.

## Feature Lifecycle

1. `load-feature` prepares one feature and checks context readiness.
2. `start-feature` implements one delivery chunk at a time.
3. `review-feature` reports findings against the spec and repository standards.
4. `complete-feature` verifies acceptance criteria and updates durable records.
5. `learn-feature` may generate an interactive lesson after completion.

## Context Discipline

- Read the active feature, its dependencies, and only relevant durable context.
- Use the feature's Context Boundary and Delivery Chunks.
- Avoid repo-wide scans unless the task genuinely requires them.
- Split the feature when a focused session cannot safely understand, implement, and verify it.
- Never hide excessive scope behind a long checklist.

## Prototype Workflow

- Use `debate-me` to determine whether prototyping is warranted.
- Use `prototype` to validate one important assumption at a time.
- Ask the human to approve, revise, replace, or stop the direction.
- Record approved direction and rejected assumptions.
- Do not treat prototype output as production-ready.

## Scope Control

Do not drift into unrelated refactors, extra features, dependency swaps, broad visual changes, speculative abstractions, or later roadmap items.

## Review Priorities

Use the project's quality priorities. When none are specified, review in this order:

1. correctness
2. security/privacy
3. regressions and edge cases
4. accessibility when applicable
5. performance
6. maintainability
7. consistency
8. polish

## Learning

- Explain what was actually implemented, not an idealized architecture.
- Use diagrams, examples, and quizzes when they improve understanding.
- Do not expose private chain-of-thought.
- Keep feature lessons scoped; reserve broad repository scanning for `learn-codebase`.
