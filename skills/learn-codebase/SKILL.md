---
name: learn-codebase
description: Generate a modular, interactive learning portal that explains an entire codebase at a milestone.
---

# Learn Codebase

Use for onboarding, milestone review, handoff, or interview preparation—not after every feature.

## Process

1. Establish learning goals and audience.
2. Map the repository deliberately, excluding generated/vendor/build output.
3. Identify architecture, modules, domain concepts, major flows, tests, deployment, and durable decisions.
4. Generate modular lessons rather than one giant document.
5. Include navigable diagrams, demonstrations, exercises, and quizzes.
6. Cite source paths and distinguish current behavior from recommendations.

## Default Output

```text
learning/codebase/
├── index.html
├── modules/
├── assets/
└── README.md
```

Use self-contained HTML/CSS/JS by default; use an existing docs/MDX system when approved. Do not install a framework solely for the portal without approval.

## Modules May Include

orientation, architecture, domain/data flow, UI or interfaces, services/integrations, testing, deployment/operations, security boundaries, extension exercises, and cumulative quiz.
