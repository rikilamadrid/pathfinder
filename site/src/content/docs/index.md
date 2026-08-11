---
title: Pathfinder
description: An AI-assisted, human-in-the-loop workflow for building software — without giving up the decisions.
template: splash
# The landing page is not a step in a reading sequence, and the sidebar order
# that drives Starlight's pagination would put "Next: kickstart-pathfinder"
# under a page that already ends with its own call to action.
prev: false
next: false
hero:
  tagline: An AI-assisted, human-in-the-loop workflow for building software — without giving up the decisions.
  image:
    alt: The Pathfinder cairn
    file: ../../../../assets/logo.svg
  actions:
    - text: Start a project
      link: /guides/getting-started/
      icon: right-arrow
    - text: View on GitHub
      link: https://github.com/rikilamadrid/pathfinder
      icon: external
      variant: minimal
---

Pathfinder is a small, portable kit of context files and skills you copy into a
project. It gives an AI agent a process for discovering, challenging, analyzing
references, prototyping, specifying, building, debugging, reviewing, completing,
learning from, and reflecting on the work — and it keeps every consequential
decision with you.

It is intentionally stack-agnostic. It does not choose React, Python, mobile, a
database, Git Flow, or any other implementation detail for you.

> The kit owns the workflow. The project owns the stack.

## What this is, and what it is not

**It is** a workflow and context kit: twenty skills with defined boundaries, a
`context/` folder that holds project truth, and prompts for tools that do not
discover local skills on their own.

**It is not** a framework. There is no required runtime, package manager,
framework, database, hosting platform, or Git model, and there is no dependency
to install. The destination project chooses its own technology, architecture,
delivery process, and learning output format.

**It is not an autopilot.** Recommendations are proposals, not silent decisions.

The whole kit is markdown. You can read all of it, and you can delete any part
of it that does not suit your project.

## Start a project

```bash
mkdir my-project
cd my-project
git init
npx create-pathfinder
```

That copies the kit into the repository and exits. Nothing is installed, nothing
is built, and no dependency is added — the installer is a file copier. It never
overwrites: files you already have are left alone and listed by name.

It writes exactly six things.

| Path | What it is |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Entry files that tell an agent how to work in the project |
| `context/` | Project truth — overview, standards, interaction rules, current feature |
| `skills/` | Twenty skills covering discovery, specs, delivery, debugging, review, and learning |
| `prompts/` | Manual launchers for tools that do not discover local skills |
| `templates/` | Starting points the project copies when it needs them |

Then open your agent and say:

```text
Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project. Do not install packages or write product code yet.
```

That starts the discovery conversation.

To adapt an existing repository, run the same two steps inside it. Nothing you
already have is overwritten, so it is safe in a repository that already has its
own `CLAUDE.md` or `context/`.

[Getting started](/guides/getting-started/) walks the whole first session — what
discovery should feel like, what to check before you accept it, and how the first
feature gets built.

## The workflow at a glance

One pass through the kit, front to back. Each arrow is a skill with a defined
boundary, and most of them stop to ask you something.

```text
idea, or an existing repository
→ kickstart-pathfinder     establish project truth in context/
→ debate-me                pressure-test the direction; you choose
→ prototype                validate the riskiest assumption, cheaply
→ to-specs                 split the approved direction into small features
→ load-feature             prepare exactly one feature for implementation
→ start-feature            build it in stable delivery chunks
→ review-feature           check it against requirements and standards
→ complete-feature         verify, close, and record it in history
→ teach-feature, quiz-me   understand what was built, not just receive it
→ reflect                  improve the workflow itself
```

Two skills sit outside that line.

`reverse-engineer` runs before the workflow when the project is inspired by an
existing product, interface, or repository. It produces an evidence-based
reconstruction blueprint — separating what it observed from what it inferred and
what it cannot know — and then hands off. A blueprint is not a feature spec.

`debug-issue` interrupts the delivery loop when something is observably broken.
It reproduces before repairing and tests hypotheses rather than editing at
random. A symptom disappearing does not count as a root cause.

```text
reverse-engineer = understand an external reference
learn-codebase   = understand the current codebase
debug-issue      = an observed failure needs an explanation
start-feature    = planned construction is difficult
```

[The workflow](/guides/workflow/) draws all five loops, with every point where the
agent stops and a human decides marked on the diagram.

## Where you decide

This is the part that makes the rest work. The agent may recommend any of these,
with reasoning. It does not choose them.

- Product and MVP scope
- Technology stack and architecture
- Database, authentication, APIs, and infrastructure
- Prototype direction, and whether prototype code is ever adopted
- Reconstruction choices derived from external references
- Git and delivery workflow
- Dependency changes
- Destructive operations
- Commits, merges, and releases

Unresolved decisions are marked, not guessed. `TBD` means a human decision is
still required, and an agent must not quietly resolve one while implementing a
feature.

## Who this is not for

Worth saying plainly, because the fit is narrow.

- If you want the agent to decide the product and the architecture for you, this
  will feel like it is asking too many questions. It is.
- If you need a process the tooling enforces, this is not it. Nothing here is
  enforced. It is markdown an agent reads, and a human who ignores it will
  succeed at ignoring it.
- If you are looking for a runtime, a CLI that stays installed, or a framework
  to build against, there is nothing here to install.

## Read the kit

Every skill in the sidebar is rendered from the kit's own `skills/` directory,
and every project-context file from `context/`. Nothing on this site is a copy —
what you read here is the file your agent reads.

Start with [`kickstart-pathfinder`](/skills/kickstart-pathfinder/), the entry
point for a new project, or
[`project-overview`](/context/project-overview/), the file that holds project
truth once you have it.
