# Project Agent Guide

This repository uses an AI-assisted, human-in-the-loop workflow. Project truth lives in `context/`, reusable behaviors live in `skills/`, and manual launchers live in `prompts/`.

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

## Available skills

- `kickstart-pathfinder` — discover and initialize project context
- `debate-me` — pressure-test and recommend product, stack, workflow, and prototype direction
- `reverse-engineer` — analyze an external reference and produce an evidence-based reconstruction blueprint
- `prototype` — create and iterate the cheapest useful validation artifact
- `to-specs` — generate context-sized feature specs
- `load-feature` — prepare one feature for implementation
- `start-feature` — implement scoped delivery chunks
- `review-feature` — review against requirements, regressions, and standards
- `complete-feature` — verify and close a feature cleanly
- `learn-feature` — create an interactive lesson for a completed feature
- `learn-codebase` — create a modular learning portal for the repository
- `reflect` — review completed work and propose reusable workflow improvements for human approval
- `handoff` — preserve useful state between sessions or tools
- `skillsmith` — teach and create small local skills
