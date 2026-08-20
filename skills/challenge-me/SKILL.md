---
name: challenge-me
description: Create a small transfer exercise that applies a learned feature concept in a changed context.
argument-hint: design|debug|refactor|implement
---

# Challenge Me

Use this skill after a lesson or quiz when the user wants to apply the concept rather than merely recall it.

A good challenge changes the context while preserving the underlying concept.

## Read First

1. The relevant lesson
2. `context/learning/progress.md`
3. The feature spec and focused implementation when needed
4. Current git status if the challenge may involve code

Skip any of these that does not exist. Pathfinder creates these files only when a workflow first needs them, so their absence is normal and is not an error. Do not create them just to satisfy this list.

## Challenge Types

Choose one, or honor the requested argument:

- `design` — propose an architecture or API under new constraints
- `debug` — diagnose a realistic defect
- `refactor` — improve structure while preserving behavior
- `implement` — build a small extension in a sandboxed or explicit feature branch

## Challenge Requirements

The challenge must include:

- Scenario
- Learning objective
- Constraints
- Definition of done
- Evidence expected from the learner
- Hints, hidden initially
- Evaluation rubric

Keep it small enough for one focused session.

## Transfer Rule

Do not simply ask the learner to reproduce the same feature.

Change at least one meaningful dimension:

- data volume
- asynchronous behavior
- user role
- accessibility requirement
- failure mode
- state ownership
- real-time updates
- backend contract
- performance constraint
- mobile interaction
- team or package boundary

## Coding Safety

For `implement` or `refactor`:

- Explain the proposed scope first.
- Do not edit code until the user explicitly approves implementation.
- Use a feature branch.
- Do not merge or commit without permission.
- Keep challenge code separate from production work when appropriate.

## Evaluation

After the learner responds:

- Evaluate against the rubric.
- Identify the strongest decision.
- Identify the most important weakness.
- Explain a stronger solution.
- Update `context/learning/progress.md`, using the confidence scale defined in
  its `## Confidence Scale` section. If the file does not exist, `quiz-me`
  carries the header to create it with.
- Mark `transferable` only when the concept was applied correctly in the changed
  context, and never using the example that introduced it.
