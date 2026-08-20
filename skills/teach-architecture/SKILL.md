---
name: teach-architecture
description: Explain how one or more completed features fit into the wider application and system architecture.
argument-hint: optional scope such as frontend, data, realtime, testing, or full
---

# Teach Architecture

Use this skill when the learner understands an individual feature and needs to zoom out.

The goal is to connect implementation details to system boundaries, ownership, scaling, and team architecture.

## Read First

1. `context/project-overview.md`
2. `context/learning/learner-profile.md`
3. Relevant completed feature specs and lessons
4. Architecture-relevant source files only
5. Data contracts, API boundaries, stores, routing, and deployment configuration relevant to the requested scope
6. Existing ADRs, if present

Skip any of these that does not exist. Pathfinder creates these files only when a workflow first needs them, so their absence is normal and is not an error. Do not create them just to satisfy this list.

Do not infer services or infrastructure that do not exist. Clearly distinguish current architecture from likely future architecture.

## Teach These Layers

Select only the relevant layers:

- Product surfaces and user journeys
- Component and design-system boundaries
- Feature/module boundaries
- Client state versus server state
- Data fetching and cache lifecycle
- API and backend contracts
- Persistence
- Authentication and authorization
- Event and real-time flows
- Observability and failure handling
- Testing pyramid and contract boundaries
- Build, deployment, and runtime boundaries
- Team ownership and package boundaries
- Performance and scale limits

## Required Output

Create or update a scoped lesson under:

```text
context/learning/lessons/YYYY-MM-DD-architecture-[scope].md
```

Include:

1. Current architecture
2. A Mermaid container or flow diagram
3. Dependency direction
4. State and data ownership
5. Important invariants
6. Failure paths
7. Scaling pressure points
8. Credible alternative architecture
9. Why the current level of complexity is or is not appropriate
10. Senior interview questions and answer outlines

## Architecture Honesty

Use labels such as:

- `implemented`
- `mocked`
- `planned`
- `recommended later`

Do not present a future target diagram as current reality.

## Scope

- Do not refactor code.
- Do not introduce microservices, microfrontends, queues, or real-time infrastructure merely to make the diagram impressive.
- Prefer the simplest architecture that satisfies current requirements.
