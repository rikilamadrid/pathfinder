---
name: to-specs
description: Convert approved project context into small sequential feature specs optimized for focused LLM context and reliable delivery.
---

# To Specs

## Readiness Check

Confirm:

- MVP and first useful flow are defined
- critical stack and workflow choices are approved or deliberately deferred
- required prototype direction is approved
- known verification methods exist or are explicitly deferred
- no material context contradictions remain

If not ready, report the blockers instead of inventing decisions.

## Sizing Principles

Each feature should:

- create one visible or system-verifiable outcome
- fit one focused branch/change set under the project's workflow
- be independently reviewable and verifiable
- require a coherent, bounded set of context
- state dependencies, assumptions, and exclusions
- contain stable delivery chunks

Split a feature when it mixes several systems, requires a repo-wide mental model, combines infrastructure with unrelated UX/polish, or cannot be verified independently.

## Output

Create only the coherent MVP roadmap in `context/features/`, using `templates/feature-spec.template.md` and project-selected naming/delivery policies.

Each spec must include Context Boundary, Delivery Chunks, and Learning Targets.

After creation, summarize file, outcome, dependency, visible/verifiable win, context risk, and recommended first feature.

If `context/tracker.md` exists, offer to publish the new specs with `sync-tracker`. If it does not, say nothing about tracking.

## Rules

- Do not implement or install packages.
- Do not assume UI, mobile, a framework, a branch type, or conventional commits.
- Do not plan the entire dream product.
