---
name: teach-feature
description: Teach the verified current feature from its spec, diff, tests, and implementation without changing product code.
---

# Teach Feature

Use this skill after a feature has been implemented and reviewed, or when the user explicitly asks to understand an existing feature.

The goal is not to produce generic documentation. The goal is to help the learner build a durable mental model from the actual repository.

## Read First

Read only the smallest useful context:

1. `context/current-feature.md`
2. The source feature spec under `context/features/`
3. `context/project-overview.md`
4. The current branch, working tree status, and focused diff
5. Tests and implementation files touched by the feature
6. Relevant ADR, coding standard, or design-system guidance only when it materially affects the feature

Skip any of these that does not exist. Pathfinder creates these files only when a workflow first needs them, so their absence is normal and is not an error. Do not create them just to satisfy this list.

Do not read the entire repository by default.

If the feature or diff cannot be identified, ask for the branch, spec, commit range, or explicit file set.

## Reconcile Before Teaching

Briefly determine:

- What the spec intended
- What the implementation actually does
- What tests verify
- Any drift, incomplete work, or uncertainty

Do not teach planned behavior as if it exists.

## Teaching Goals

Explain:

- The user or system problem
- The feature boundary
- The mental model
- Event and data flow
- Responsibilities of important files
- State ownership and synchronization
- Error, loading, empty, and success behavior
- Testing strategy
- Accessibility implications
- Performance implications
- Maintainability and extension points
- Meaningful decisions and tradeoffs
- Production-scale gaps
- Senior-level interview framing

## Adaptation

Pitch the lesson at what the learner has already demonstrated, using
`context/learning/progress.md` when it exists and what the human tells you when
it does not. Ask rather than assume.

For an experienced engineer:

- Do not spend most of the lesson paraphrasing syntax.
- Explain architectural consequences.
- Compare credible alternatives.
- Identify hidden coupling and invariants.
- Connect component-level decisions to team and system scale.
- Point out gaps directly and constructively.

## Lesson Artifact

Create:

```text
context/learning/lessons/YYYY-MM-DD-[feature-slug].md
```

Use `templates/lesson.template.md`.

Keep the lesson focused. Prefer five strong transferable concepts over twenty shallow observations.

Mermaid diagrams are encouraged for:

- event flow
- state ownership
- request lifecycle
- component boundaries
- dependency direction

## Interaction Rule

After producing the lesson, stop and offer exactly one recommended next action:

- `quiz-me`
- `challenge-me`
- `teach-architecture`
- a later spaced review
- no follow-up needed

Do not automatically run the next skill.

## Safety and Scope

- Do not modify product code.
- Do not install packages.
- Do not commit or merge.
- Do not invent intent that is unsupported by code or specs.
- Do not reveal private chain-of-thought.
- Explain evidence, reasoning summaries, and tradeoffs.
