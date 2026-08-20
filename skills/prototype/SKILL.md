---
name: prototype
description: Create and iterate the cheapest useful artifact for validating a product, interaction, architecture, or technical assumption.
---

# Prototype

Use this skill after debate recommends validation or when the human asks to see or test a direction before production planning.

## Process

1. Read the debate conclusion and relevant project context.
2. Name the single primary assumption being validated.
3. Recommend the cheapest useful prototype format.
4. Define success/rejection criteria and an output location under `prototypes/`.
5. Create only the prototype; avoid production architecture unless the task is explicitly a technical proof.
6. Present focused review questions.
7. On feedback, revise the same direction, replace it, approve it, or stop.
8. Record approved direction, rejected assumptions, and explicit production exclusions in `context/project-overview.md`,
   creating it from `templates/project-overview.template.md` if it does not exist yet.

## Supported Forms

- wireframe or user-flow diagram
- static visual concept
- interactive HTML/CSS/JS
- prototype using an already-installed project stack
- API/integration/AI/animation/offline proof of concept
- architecture or data-flow diagram

Do not install a framework solely for a prototype without approval.

## Human Review

Ask:

- Is the purpose or tested assumption clear?
- Is the main flow/behavior correct?
- What should be removed, revised, or replaced?
- Is the direction approved for specification?

## Rules

- Prototype only what needs validation.
- Label shortcuts and mocked behavior.
- Do not silently promote prototype code into production.
- Iterate rather than generating unrelated alternatives unless replacement is requested.
