---
name: kickstart-pathfinder
description: Discover and initialize a new or existing project without writing product code.
---

# Kickstart Pathfinder

Use this skill to turn an idea or existing repository into durable, human-approved project context.

## Rules

- Do not install packages or write product code.
- Inspect existing repositories lightly and preserve established facts.
- Ask progressively; do not dump a giant questionnaire.
- Classify answers as requirements, preferences, constraints, or open decisions.
- Distinguish recommendations from approved choices.
- Never silently resolve `TBD` decisions.

## Discovery Areas

Ask only what materially affects the project:

1. Product, audience, first useful outcome, success signal
2. MVP boundary and explicit exclusions
3. Platform and experience type
4. Existing technical constraints or preferred technologies
5. Data, backend, database, auth, APIs, AI, payments, files, offline needs
6. Architecture and repository shape
7. Quality priorities: security, accessibility, performance, reliability, privacy, localization
8. Deployment, environments, cost limits, and external services
9. Git, review, CI/CD, versioning, changelog, and release preferences
10. Prototype and learning goals
11. AI tools and actions requiring human approval

When the user is unsure, provide a small recommendation with reasoning and alternatives.

## Process

1. Read the kit context and inspect relevant repository facts.
2. Ask the minimum unresolved questions in small groups.
3. Summarize requirements, preferences, constraints, open decisions, and contradictions.
4. Route uncertain product/technical choices to `debate-me` when useful.
5. Present the proposed context and request human corrections or approval.
6. Update `context/project-overview.md`, `context/coding-standards.md`, `context/ai-interaction.md`, `CLAUDE.md`, and `AGENTS.md` only after the choices are sufficiently clear.
   `context/project-overview.md` does not ship; create it from `templates/project-overview.template.md` at this step.
7. Recommend `debate-me`, `prototype`, or `to-specs` as the next action.

## Stop Condition

Stop before feature specs, dependency installation, scaffolding, or implementation.
