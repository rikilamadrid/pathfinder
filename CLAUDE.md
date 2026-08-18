# Project Agent Guide

This repository uses an AI-assisted, human-in-the-loop workflow. Project truth lives in `context/`, and reusable behaviors live in `skills/`.

## Read only what is needed

For feature work, usually read:

1. `context/current-feature.md`
2. its referenced feature spec
3. relevant sections of `context/project-overview.md`
4. relevant rules from `context/coding-standards.md`
5. `context/ai-interaction.md`
6. only the source files needed for the current delivery chunk

Do not load the whole repo by default.

## Project-selected policies

Follow the stack, architecture, commands, Git workflow, review policy, and release process documented in `context/project-overview.md`.

If a policy is `TBD`, do not invent it. Ask the human or clearly mark it unresolved.

## Before implementation

Restate:

1. Goal
2. Active delivery chunk
3. Expected files or areas
4. Required context
5. Risks
6. Assumptions
7. Verification plan
8. Out-of-scope work
9. Current Git state
10. Intended Git action under the documented workflow

## Human approval

Ask before actions identified in `context/ai-interaction.md`, especially dependency additions, destructive commands, sensitive migrations, commits, merges, and releases.

## Scope and quality

- Implement only the active feature and current delivery chunk.
- Keep the project stable after each chunk.
- Do not convert prototype code into production code without an explicit feature decision.
- Prefer concrete verification over confident narration.
- Report conflicts between specs, repository reality, and durable context.

## Canonical skills and harness adapters

Canonical Pathfinder skills are tool-neutral and live under `skills/`. Harness-specific representations — `.claude/skills/`, `.agents/skills/` — are generated integration artifacts and must not become independent behavior contracts. Edit the canonical file; regenerate the adapter.

An adapter carries the canonical skill's frontmatter and a pointer to it, and nothing else. If an adapter and its canonical skill disagree, the canonical skill is correct.

## Available skills

- `kickstart-pathfinder` — discover and initialize project context
- `debate-me` — pressure-test and recommend product, stack, workflow, and prototype direction
- `reverse-engineer` — analyze an external reference and produce an evidence-based reconstruction blueprint
- `prototype` — create and iterate the cheapest useful validation artifact
- `to-specs` — generate context-sized feature specs
- `load-feature` — prepare one feature for implementation
- `start-feature` — implement scoped delivery chunks
- `debug-issue` — diagnose an observed failure to its root cause, apply the smallest justified fix, and verify it
- `review-feature` — review against requirements, regressions, and standards
- `complete-feature` — verify and close a feature cleanly
- `learn-feature` — create an interactive lesson for a completed feature
- `learn-codebase` — create a modular learning portal for the repository
- `teach-feature` — teach the verified current feature from its spec, diff, tests, and implementation
- `teach-architecture` — explain how completed features fit into the wider application and system architecture
- `quiz-me` — assess understanding of a recently taught feature with evidence-based questions
- `challenge-me` — create a small transfer exercise applying a learned concept in a changed context
- `learning-review` — review accumulated lessons, identify gaps, and create a reinforcement plan
- `reflect` — review completed work, and the reflection itself, and propose reusable workflow improvements for human approval
- `handoff` — preserve useful state between sessions or tools
- `skillsmith` — teach and create small local skills
- `setup-tracker` — configure an optional external work tracker
- `sync-tracker` — publish approved feature specs to the configured tracker, one-way and idempotently
