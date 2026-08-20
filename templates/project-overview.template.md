# Project Overview

Durable, project-wide context.

Keep this concise. Feature scope, active work, history, and temporary
planning belong elsewhere.

Two words keep an unmade decision visible:

- `TBD` — a human decision is still required
- `None` — considered and intentionally excluded

Leave nothing blank. A blank field is indistinguishable from an abandoned one.

## Project

- Name: `[Project Name]`
- Stage: `[idea / prototype / MVP / production / maintenance]`
- Repo type: `[application / library / service / monorepo / other]`
- Primary goal: `[what success means]`

## Product

- Problem: `[problem being solved]`
- Primary user: `[who it is for]`
- First useful outcome: `[smallest meaningful result]`
- Distinctive quality: `[what should make it good or different]`
- Avoid becoming: `[important anti-goal]`

## Scope

### In

- `[core outcome]`

### Out

- `[explicit non-goal]`

## Requirements and Open Decisions

Record only what constrains the work. An open decision stays `TBD` until a
human resolves it.

| Type | Item | Notes |
| --- | --- | --- |
| Requirement | `[must be true]` | |
| Preference | `[desired but negotiable]` | |
| Constraint | `[limit or external obligation]` | |
| Open decision | `TBD` | |

## System

Record only important project-wide architecture and constraints.

- Architecture: `[short description or TBD]`
- Main components: `[components or TBD]`
- Constraints: `[important constraint or None]`

Optional flow:

```text
[input] -> [component] -> [result]
```

## Technology

The stack an agent must follow rather than choose. Keep the rows this project
actually has.

| Layer | Choice | Reason |
| --- | --- | --- |
| Platform/runtime | `TBD` | |
| Language(s) | `TBD` | |
| UI/presentation | `TBD / None` | |
| Backend/application | `TBD / None` | |
| Data storage and access | `TBD / None` | |
| Auth | `TBD / None` | |
| Testing | `TBD` | |
| Build and package tooling | `TBD` | |

## Commands

The commands an agent runs to verify its own work.

```text
install: TBD
run/dev: TBD
test: TBD
lint/static analysis: TBD
build/package: TBD
```

## Delivery Workflow

| Area | Choice |
| --- | --- |
| Git workflow | `TBD` |
| Default branch | `TBD` |
| Branch naming | `TBD / None` |
| Commit convention | `TBD / None` |
| Review policy | `TBD` |
| Merge strategy | `TBD` |
| CI/CD | `TBD / None` |
| Versioning and changelog | `TBD / None` |
| Release process | `TBD / None` |

## Environments and Integrations

| Area | Choice | Notes |
| --- | --- | --- |
| Local development | `TBD` | |
| Preview/staging | `TBD / None` | |
| Production | `TBD / None` | |
| Configuration and secrets | `TBD` | |
| External services/APIs | `TBD / None` | |

## Quality Priorities

Rank only what matters for this project, highest first.

1. `[priority]`
2. `[priority]`
3. `[priority]`

| Concern | Target or decision |
| --- | --- |
| Correctness/reliability | `TBD` |
| Security/privacy | `TBD / None` |
| Accessibility | `TBD / None` |
| Performance | `TBD / None` |
| Supported platforms | `TBD / None` |

## Durable Decisions

Decisions that outlive a Feature, including approved prototype direction and
anything a prototype proved must not reach production.

| Date | Decision | Reason |
| --- | --- | --- |
| `[YYYY-MM-DD]` | `[decision]` | `[reason]` |

## Learning

- What the human wants to understand: `[topics or None]`
- Preferred lesson format: `[HTML / MDX / Markdown / existing docs system / TBD]`
