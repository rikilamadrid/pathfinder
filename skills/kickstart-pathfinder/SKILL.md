---
name: kickstart-pathfinder
description: Discover and initialize a new or existing project without writing product code.
---

# Kickstart Pathfinder

Use this skill to turn an idea or existing repository into durable, human-approved project context.

## Assumed role

Unless the human explicitly activated a role, assume `planner` for this
invocation: read `roles/planner.md` and follow it. An explicit role overrides
this default. A role narrows responsibility and never grants human authority.

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
10. Prototype direction and learning goals
11. AI tools and actions requiring human approval

When the user is unsure, provide a small recommendation with reasoning and alternatives.

## Process

1. If the project is missing kit files, and this session loaded this skill from
   the Pathfinder plugin, offer to install the kit before going further. See
   `Kit Bootstrap` below. Otherwise start at the next step.
2. Read the kit context and inspect relevant repository facts.
3. Ask the minimum unresolved questions in small groups.
4. Summarize requirements, preferences, constraints, open decisions, and contradictions.
5. Route uncertain product/technical choices to `debate-me` when useful.
6. Present the proposed context and request human corrections or approval.
7. Update `context/project-overview.md`, `context/coding-standards.md`, `context/ai-interaction.md`, `CLAUDE.md`, and `AGENTS.md` only after the choices are sufficiently clear.
   `context/project-overview.md` does not ship; create it from `templates/project-overview.template.md` at this step.
   Project facts go there; approval rules and tool actions requiring a human go
   in `context/ai-interaction.md`. Fill the sections the project has and mark
   the rest `TBD` or `None`. Do not add sections the template does not carry,
   and do not leave a field blank.
8. Recommend `debate-me`, `prototype`, or `to-specs` as the next action.

## Kit Bootstrap

The Pathfinder plugin distributes commands. It does not distribute project
state. A repository reached through `/plugin install` therefore has every
Pathfinder command and none of the files those commands read.

This step applies only when both are true: the project is missing kit files,
and this skill was loaded from the plugin, which is what makes
`${CLAUDE_PLUGIN_ROOT}` — the plugin's install directory — a real path. When
the kit installed this skill into the repository instead, there is no plugin
root, the condition is false, and this whole section is skipped without being
raised or quoted.

When it does apply:

- Copy from the plugin root into the project root, and copy only the kit. That
  list is not restated here: `packages/create-pathfinder/copy-list.json`, inside
  the plugin root, is the one statement of it. Read that file and copy the
  entries it names.
- Exclude exactly what the installer excludes, and read that from the installer
  too: `NEVER_SHIPS` in `packages/create-pathfinder/src/kit.mjs`, also inside
  the plugin root, is the one statement of it. Skip every kit-relative path it
  holds. Those files are one repository's own working state and would be wrong
  in any other project. Restating them here would be a second list to keep in
  step, and the first time it drifted this step would hand a project what
  `npx create-pathfinder` refuses to.
- Name every file before writing it, and wait for approval.
- Overwrite nothing without asking about that file by name. Delete nothing.
- Report exactly what was written, what was skipped, and what was left alone.
- Generate no harness adapters. Plugin commands stay namespaced
  `/<plugin-name>:<skill>`, and that is the intended plugin form.
  `npx create-pathfinder --agents claude-code` is what generates adapters and
  the bare command names, for a human who wants both.

When the project already has the kit, change nothing and say so.

## Stop Condition

Stop before feature specs, dependency installation, scaffolding, or implementation.
