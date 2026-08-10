# Pathfinder

AI Development Workflow
by Lamadrid Labs.

A small, reusable repository for starting and delivering software projects with an AI-assisted, human-in-the-loop workflow.

It is intentionally stack-agnostic. It does not choose React, Python, mobile, a database, Git Flow, or any other implementation detail for you. The kit provides a process for discovering, challenging, analyzing references, prototyping, specifying, building, reviewing, completing, learning from, and reflecting on a project.

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
│   ├── reverse-engineer/
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
│   ├── reflect/
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

### External reference analysis

When a project is inspired by an existing product, interface, repository, workflow, animation, or technical implementation, Pathfinder can analyze the reference before making product or architectural decisions.

```text
external reference
→ reverse-engineer
→ identify observed behavior, inferences, and unknowns
→ extract transferable patterns
→ debate reconstruction choices
→ prototype the important behavior
→ approve direction
→ to-specs
```

`reverse-engineer` is intentionally separate from project discovery and implementation.

It analyzes an external reference and produces an evidence-based reconstruction blueprint. It must clearly distinguish:

* directly observed behavior
* strong inferences
* possible implementation approaches
* unknown or unverifiable details

It should reproduce useful patterns and outcomes rather than copy proprietary code, assets, branding, content, or private implementation details.

The skill may recommend a Pathfinder handoff, but it must not silently perform the responsibilities of another skill.

Typical handoffs include:

* `kickstart-pathfinder` when the analysis is becoming a new project
* `debate-me` when important product or technical choices remain
* `prototype` when a behavior or assumption needs validation
* `to-specs` when the direction is approved and ready for feature planning
* `load-feature` when the analysis applies to an existing planned feature
* `learn-codebase` when the real goal is understanding the user's own repository

The boundary is:

```text
reverse-engineer = understand an external reference
learn-codebase   = understand the current codebase
kickstart        = initialize project context
prototype        = validate a proposed direction
to-specs         = convert an approved direction into planned work
```

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

### Learning and mentoring loop

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

* **teach-feature** explains the verified implementation, tradeoffs, testing, accessibility, performance, and interview takeaways.
* **quiz-me** measures understanding with varied question types.
* **challenge-me** creates transfer exercises so concepts are applied in new contexts.
* **teach-architecture** connects completed features to the larger system architecture.
* **learning-review** periodically reviews demonstrated knowledge, interview readiness, and reinforcement priorities.

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

### Workflow reflection loop

The other loops improve the project. This one improves the workflow.

```text
discover
→ challenge
→ prototype / specify
→ build
→ review / verify
→ complete
→ reflect
   └── proposed workflow improvement (human decides)
```

`reflect` reviews work that is already finished. It reconstructs what actually happened, separates knowledge that belongs to the project from lessons that could help unrelated projects, and proposes the smallest durable improvement—often none.

It does not change Pathfinder, `AGENTS.md`, or any skill on its own.

> Projects produce lessons. Pathfinder keeps the reusable ones.
>
> Reflect proposes. Humans promote.

Reflection is not a mandatory step after every change. It earns its cost after:

* a meaningful completion, such as a feature, migration, refactor, or project phase
* difficult debugging
* repeated human corrections
* a surprising discovery about the system or the workflow
* substantial workflow friction or repeated manual intervention

Skip it for trivial or routine work.

A finding is only a Pathfinder candidate if it still holds in another language, framework, and business domain. Everything else stays with the project.

Reflection also checks itself. After reviewing the work, `reflect` makes a single bounded pass over its own performance—did it miss a visible signal, overgeneralize, or propose something already covered?—and may recommend a change to its own skill definition.

```text
work
→ reflect on the work
→ reflect on reflect
→ stop
```

That pass stops there. It does not recurse further, it does not go looking for a problem because the section exists, and "no improvement needed" is the expected result. A self-improvement follows the same promotion rule as any other proposal.

> Self-reference does not lower the evidence threshold. It raises it.

## Skills and prompts

`skills/` contains durable, reusable behavior. `prompts/` contains short manual launchers for tools that do not discover local skills automatically.

Use one or the other. A prompt does not need to run after the matching skill.

Example:

```text
Use skills/kickstart-pathfinder/SKILL.md to initialize this project.
```

Or:

```text
Read prompts/01-kickstart-project.md and follow it.
```

To analyze an external reference:

```text
Use skills/reverse-engineer/SKILL.md to analyze this reference. Clearly separate observations, inferences, possible implementation choices, and unknowns.
```

To reflect on completed work:

```text
Use skills/reflect/SKILL.md to review this completed work. Propose improvements; do not change Pathfinder.
```

## Start a new project

Clone or copy this kit, then copy the reusable files into the destination repository. Do not copy this kit's root `CHANGELOG.md`; use `templates/CHANGELOG.template.md` only when the destination project chooses a changelog.

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

Copy the context, skills, prompts, templates, and agent entry files into the existing repository.

The kickoff skill should inspect the repository lightly, preserve established conventions, and distinguish repository facts from decisions still requiring human input.

Use `learn-codebase` when deeper understanding, onboarding, teaching, or architectural explanation of the existing repository is needed.

Do not use `reverse-engineer` to analyze the repository Pathfinder is currently operating inside. That responsibility belongs to `kickstart-pathfinder`, `learn-codebase`, or the relevant feature skill.

## Human control

The user chooses or approves:

* product and MVP scope
* technology stack and architecture
* database, authentication, APIs, and infrastructure
* prototype direction
* reconstruction choices derived from external references
* Git and delivery workflow
* dependency changes
* destructive operations
* commits, merges, and releases

The AI may recommend choices based on the product, constraints, learning goals, team, budget, existing repository, and available evidence.

Recommendations are proposals, not silent decisions.

## Decision states

Use these consistently:

* `TBD` — a human decision is still required
* `None` — intentionally excluded
* `N/A` — not applicable
* `Deferred` — intentionally postponed

Agents must not silently resolve `TBD` items while implementing a feature.

## Context-efficient feature design

A good feature:

* fits one focused implementation session
* has a clear context boundary
* touches a coherent set of systems
* can be verified independently
* creates a visible or meaningful result
* states dependencies and assumptions
* can be split into stable delivery chunks

Avoid features such as:

* “build the backend”
* “add all components”
* “polish everything”
* “recreate the entire reference product”

Split work by user-visible or system-verifiable outcomes.

External reference analysis should inform feature design, but a reverse-engineering report is not itself a feature specification.

Use `to-specs` to convert an approved reconstruction direction into small, verifiable features.

## Prototype rule

Prototype only what needs validation. Choose the cheapest useful format:

* wireframe or flow diagram
* static visual mockup
* interactive HTML/CSS/JS prototype
* existing-stack prototype
* technical proof of concept
* architecture or data-flow diagram

Prototype code is disposable unless a later feature explicitly adopts and hardens it.

A reconstruction blueprint produced by `reverse-engineer` is not production code. When uncertain behavior, fidelity, feasibility, or technical risk remains, validate it through `prototype` before converting it into feature specifications.

## Reverse-engineering rule

Reverse-engineer only what is necessary to understand or reproduce the requested outcome.

The skill must:

* define the target and analysis boundary
* inspect only relevant evidence
* distinguish observation from inference
* state unknowns honestly
* extract transferable product, design, interaction, or engineering patterns
* recommend an implementation appropriate for the user's project
* avoid claiming knowledge of private or server-side implementation details
* avoid copying proprietary code, protected assets, branding, or content
* avoid bypassing authentication, authorization, paywalls, technical controls, or private systems
* recommend the correct Pathfinder handoff when further work is needed

The preferred goal is:

```text
understand the pattern
→ reconstruct the behavior
→ adapt it to the project
```

Not:

```text
copy the original product exactly
```

## Learning outputs

`learn-feature` should default to a lightweight, self-contained HTML/CSS/JS lesson unless the destination repository already supports MDX or another appropriate documentation format.

`learn-codebase` may inspect broadly, but should generate modular lessons rather than one giant page. It is best used at milestones, for onboarding, or for interview preparation—not after every small change.

A reverse-engineering report may explain transferable concepts, but it should not replace the structured teaching and assessment responsibilities of:

* `teach-feature`
* `teach-architecture`
* `quiz-me`
* `challenge-me`
* `learning-review`

## Add more only after real pain

Do not turn this into a giant framework.

Add a new skill only when:

* a repeated task keeps going wrong
* an existing skill does not already own the responsibility
* the new skill has a narrow and clearly defined trigger
* it produces a concrete, verifiable result
* its inputs and outputs are explicit
* its boundaries with neighboring skills are documented
* it improves the workflow without silently expanding Pathfinder's scope

Before adding a skill, review the existing workflow for overlap.

`reflect` is the usual source of that evidence, but a reflection recommendation is a proposal. A human decides whether it becomes part of Pathfinder.

When a new skill is justified, use `skillsmith` to define and review its behavior contract.
