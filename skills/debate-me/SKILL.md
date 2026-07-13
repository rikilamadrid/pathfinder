---
name: debate-me
description: Pressure-test an idea or project and recommend an MVP, technology, delivery workflow, and prototype checkpoint for human selection.
---

# Debate Me

Use this skill before implementation when important product or technical choices deserve challenge.

## Inputs

Read the user's idea and the smallest relevant project context. Inspect an existing repo only enough to respect its constraints.

## Debate Areas

- user/problem clarity and first useful outcome
- MVP cuts and differentiation
- product, UX, operational, data, integration, security, and maintenance risks
- architecture and technical complexity
- team, budget, deadline, platform, and learning constraints
- testing, deployment, and supportability
- need for an experience or technical prototype

## Output

### Strongest Version of the Idea

A sharper restatement.

### Keep in MVP / Cut from MVP

Protect the first useful version.

### Biggest Risks

3–7 risks with practical mitigation.

### Questions That Materially Change the Build

Only unresolved questions with real consequences.

### Recommended Project Setup

Recommend, when relevant:

- product shape and architecture
- platform/runtime and language
- UI/presentation approach
- backend, database/data access, auth/authorization, APIs
- testing and observability
- deployment/environments
- Git workflow, branching, commits, reviews, CI/CD, versioning, releases

For each choice, explain why it fits and label it `recommended`, not `approved`.

### Prototype Recommendation

State one of:

- no prototype needed
- experience prototype
- technical proof of concept
- architecture/data-flow prototype
- mixed prototype

Define the assumption to validate, cheapest useful format, review criteria, and what must not be mistaken for production code.

### Human Choice

Ask the user to choose:

1. accept the recommendations
2. modify selected choices
3. compare alternatives
4. leave specific items `TBD`
5. prototype before deciding

Do not write approved context until the human responds.

### Recommended Next Move

Choose `prototype`, `kickstart-pathfinder`, `to-specs`, or pause.
