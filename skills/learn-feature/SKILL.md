---
name: learn-feature
description: Generate a rich, interactive, feature-scoped lesson and quiz from completed implementation.
---

# Learn Feature

Use after a feature is completed and accepted.

## Read

- completed feature spec and history entry
- relevant diff/commits when available
- only the implemented files and direct dependencies needed to explain the feature
- tests and durable decisions

## Output Format

Use the project's learning preference. Default to self-contained HTML/CSS/JS. Use MDX only when the repository already supports it or the human selects it.

Place output under:

```text
learning/features/[feature-slug]/
```

## Lesson Content

- what changed and why
- architecture and data/control flow
- important files and responsibilities
- key implementation decisions and tradeoffs
- tests and verification
- common mistakes and safe extension points
- visual diagrams or interactive demonstrations when useful

## Quiz Variety

Include a useful mix when appropriate:

- multiple choice
- true/false with explanation
- ordering or matching
- predict-the-output/state
- debugging scenario
- short reflection or implementation challenge

Provide immediate feedback and explanations. Keep the lesson scoped and avoid reading the whole repository.
