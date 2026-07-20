# Pathfinder

AI Development Workflow
by: Lamadrid Labs.

A small, reusable repository for starting and delivering software projects with an AI-assisted, human-in-the-loop workflow.

It is intentionally stack-agnostic. It does not choose React, Python, mobile, a database, Git Flow, or any other implementation detail for you. The kit provides a process for discovering, challenging, prototyping, specifying, building, reviewing, completing, and learning from a project.

> The kit owns the workflow. The project owns the stack.

## What this repo gives you

```text
.
├── AGENTS.md
├── CLAUDE.md
├── CHANGELOG.md                  # history of this kit only
├── NOT_A_FRAMEWORK.md
├── context/
│   ├── project-overview.md
│   ├── coding-standards.md
│   ├── ai-interaction.md
│   ├── current-feature.md
│   ├── history.md
│   └── features/
├── prompts/                      # manual launchers for the skills
├── skills/
│   ├── kickstart-pathfinder/
│   ├── debate-me/
│   ├── prototype/
│   ├── to-specs/
│   ├── load-feature/
│   ├── start-feature/
│   ├── review-feature/
│   ├── complete-feature/
│   ├── learn-feature/
│   ├── learn-codebase/
│   ├── teach-feature/
│   ├── quiz-me/
│   ├── challenge-me/
│   ├── teach-architecture/
│   ├── learning-review/
│   ├── handoff/
│   └── skillsmith/
└── templates/
```

## The complete workflow

### Discovery and validation

```text
idea
→ kickstart discovery
→ debate and recommendations
→ human chooses or changes stack/workflow
→ prototype the riskiest or most important assumption
→ review and iterate
→ approve direction
→ finalize project context
```

A prototype is optional. `debate-me` recommends whether the project needs an experience prototype, technical proof of concept, architecture diagram, or no prototype at all. An unapproved prototype must not quietly become production code.

### Delivery loop

```text
project context
→ to-specs
→ load feature
→ start feature
→ review feature
→ complete feature
→ history
```

Features are intentionally sized for reliable delivery inside a focused LLM context window. They should be small, independently verifiable, and explicit about what the agent should and should not load.

### Learning & Mentoring loop

```text
completed feature
→ learn-feature
→ teach-feature
→ quiz-me
→ challenge-me (optional)

project milestone
→ teach-architecture
→ learn-codebase
→ learning-review
```

Learning is part of the workflow, not an afterthought. The goal is for the human owner to understand the architecture, implementation, tests, tradeoffs, and extension points of what the AI helped build.

The mentoring skills complement the delivery workflow without replacing it.

- **teach-feature** explains the verified implementation, tradeoffs, testing, accessibility, performance, and interview takeaways.
- **quiz-me** measures understanding with varied question types.
- **challenge-me** creates transfer exercises so concepts are applied in new contexts.
- **teach-architecture** connects completed features to the larger system architecture.
- **learning-review** periodically reviews demonstrated knowledge, interview readiness, and reinforcement priorities.

The recommended flow becomes:

```text
feature review
→ teach-feature
→ quiz-me
→ challenge-me (when valuable)
→ teach-architecture (at milestones)
→ learning-review (periodically)
→ complete feature
```


## Skills and prompts

`skills/` contains durable reusable behavior. `prompts/` contains short manual launchers for tools that do not discover local skills automatically.

You use one or the other. A prompt does not need to run after the matching skill.

Example:

```text
Use skills/kickstart-pathfinder/SKILL.md to initialize this project.
```

Or:

```text
Read prompts/01-kickstart-project.md and follow it.
```

## Start a new project

Clone or copy this kit, then copy the reusable files into the destination repo. Do not copy this kit's root `CHANGELOG.md`; use `templates/CHANGELOG.template.md` only when the destination project chooses a changelog.

```bash
git clone <kit-repository-url> pathfinder
mkdir my-project
cd my-project
git init
cp -R ../pathfinder/{AGENTS.md,CLAUDE.md,context,prompts,skills,templates} .
```

Then run:

```text
Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project. Do not install packages or write product code yet.
```

## Adapt an existing repo

Copy the context, skills, prompts, templates, and agent entry files into the existing repository. The kickoff skill should inspect the repository lightly, preserve established conventions, and distinguish repository facts from decisions still requiring human input.

## Human control

The user chooses or approves:

- product and MVP scope
- technology stack and architecture
- database, auth, APIs, and infrastructure
- prototype direction
- Git and delivery workflow
- dependency changes
- destructive operations
- commits, merges, and releases

The AI may recommend choices based on the product, constraints, learning goals, team, budget, and existing repo. Recommendations are proposals, not silent decisions.

## Decision states

Use these consistently:

- `TBD` — a human decision is still required
- `None` — intentionally excluded
- `N/A` — not applicable
- `Deferred` — intentionally postponed

Agents must not silently resolve `TBD` items while implementing a feature.

## Context-efficient feature design

A good feature:

- fits one focused implementation session
- has a clear context boundary
- touches a coherent set of systems
- can be verified independently
- creates a visible or meaningful result
- states dependencies and assumptions
- can be split into stable delivery chunks

Avoid features such as "build the backend," "add all components," or "polish everything." Split work by user-visible or system-verifiable outcomes.

## Prototype rule

Prototype only what needs validation. Choose the cheapest useful format:

- wireframe or flow diagram
- static visual mockup
- interactive HTML/CSS/JS prototype
- existing-stack prototype
- technical proof of concept
- architecture or data-flow diagram

Prototype code is disposable unless a later feature explicitly adopts and hardens it.

## Learning outputs

`learn-feature` should default to a lightweight self-contained HTML/CSS/JS lesson unless the destination repository already supports MDX or another appropriate documentation format.

`learn-codebase` may inspect broadly, but should generate modular lessons rather than one giant page. It is best used at milestones, for onboarding, or for interview preparation—not after every small change.

## Add more only after real pain

Do not turn this into a giant framework. Add a new skill when a repeated task keeps going wrong and the skill can produce a concrete, verifiable result.
