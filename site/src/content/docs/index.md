---
title: Pathfinder
description: A human-in-the-loop workflow kit for building software with AI agents.
template: splash

# The landing page is not a step in a reading sequence.
prev: false
next: false

# Avoid "Pathfinder | Pathfinder" on the home page.
head:
  - tag: title
    content: Pathfinder

hero:
  tagline: Direct AI agents through software delivery without giving up the decisions.
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

Pathfinder is a small, portable workflow kit you copy into a software project.

It gives AI agents reusable skills for discovering, planning, building,
testing, completing, debugging, learning from, and reflecting on software
work — while keeping judgment and consequential decisions with you.

It is intentionally stack-agnostic. Pathfinder does not choose React, Python,
mobile, a database, hosting platform, Git model, or other implementation
details for you.

> The kit owns the workflow. The project owns the stack.

## What Pathfinder gives you

Pathfinder has four small building blocks:

- **Skills** — reusable procedures for software-development work
- **Roles** — responsibility boundaries for an AI session
- **Context** — project truth and temporary workspace state
- **Templates** — minimal records created only when needed

It is **not a framework** and **not an orchestration runtime**.

There is no required application framework, package manager, database,
programming language, hosting platform, Git model, agent swarm, or background
service.

It is also **not autopilot**. Agents may recommend and execute work, but the
human owns approval, acceptance, merge, release, and other consequential
decisions.

Everything is readable Markdown.

## Start a project

```bash
mkdir my-project
cd my-project
git init
npx create-pathfinder
```

The installer copies Pathfinder into the repository and exits. It does not add
a runtime dependency to your application.

If you configure Claude Code or Codex during installation, Pathfinder also
generates native skill adapters so its skills appear directly in that tool.

Then start with:

```text
/kickstart-pathfinder
```

Kickstart learns enough about the project to establish its durable context
without writing product code or silently choosing unresolved decisions.

Without native skill support, use:

```text
Use skills/kickstart-pathfinder/SKILL.md to initialize this project.
```

Claude Code users can install Pathfinder as a plugin instead, which brings the
commands without copying anything into the repository:

```text
/plugin marketplace add rikilamadrid/pathfinder
/plugin install pathfinder@lamadrid-labs
```

Plugin commands are namespaced — `/pathfinder:kickstart-pathfinder`,
`/pathfinder:feature load` — and the plugin installs no project files. See
[Getting started](/guides/getting-started/#or-install-the-claude-code-plugin)
for what each path installs and when to use both.

[Getting started](/guides/getting-started/) walks through the first session.

## The workflow

The core delivery flow is deliberately small:

```text
idea
  ↓
kickstart / debate / prototype
  ↓
to-specs
  ↓
to-tickets
  ↓
/ticket load
  ↓
/ticket start
  ↓
optional /ticket review
  ↓
human acceptance
  ↓
/ticket complete
  ↓
the next ready ticket
```

A prototype is optional.

Features are small, focused, and independently verifiable.

Debugging, learning, external-reference analysis, handoff, reflection, and
ticket-store selection are supporting workflows you invoke when useful rather
than mandatory stages every Feature must pass through.

When it is not obvious which one applies:

```text
reverse-engineer = understand an external reference
learn-codebase   = understand the current codebase
debug-issue      = an observed failure needs an explanation
/ticket start    = planned construction is difficult
```

[See the full workflow](/guides/workflow/).

## Optional roles

Pathfinder ships three roles:

| Role | Responsibility |
| --- | --- |
| `planner` | Turns approved direction into clear Feature specs |
| `developer` | Implements approved work without accepting its own work |
| `tester` | Independently verifies delivered work and reports findings |

Activate one when the responsibility boundary is useful:

```text
/role developer
```

Roles do not grant authority. They only narrow what the current AI session is
responsible for.

The human remains the conductor.

[Learn about roles](/guides/roles/).

## Know where you are

During a session:

```text
/whereami
```

gives you a compact view of the current role, Feature, Git state, and next
action without loading broad project history.

When you need to stop and continue later:

```text
/handoff
```

records the minimum factual state another session needs to continue safely.

## Context grows only when needed

A fresh Pathfinder project starts with only:

```text
context/
├── ai-interaction.md
└── coding-standards.md
```

Other context appears only when a workflow actually needs it.

Durable project truth is tracked in Git:

```text
context/project-overview.md
context/features/
context/tickets/          # when local Markdown is the ticket store
context/history.md
context/tracker.md        # when it is not
```

Temporary workspace state is normally ignored:

```text
context/current-ticket.md
context/handoff.md
```

Do not ignore `context/` wholesale. That would also hide the project truth
future sessions need.

## Human judgment stays human

Pathfinder deliberately stops rather than silently deciding things such as:

- product scope
- architecture and technology choices
- dependencies
- destructive operations
- prototype adoption
- Git and delivery decisions
- acceptance
- merge and release

An unresolved decision stays unresolved. [`TBD`](/concepts/decision-states/)
means a human decision is still required, and an agent must not quietly resolve
one while implementing a Feature.

[Human approval](/concepts/human-approval/) explains the boundary in detail.

## Add it to an existing repository

Run the same installer inside an existing Git repository:

```bash
npx create-pathfinder
```

Existing files are preserved unless you explicitly choose to replace them.

Then run:

```text
/kickstart-pathfinder
```

Kickstart separates facts already established by the repository from decisions
that still need human input.

For deeper understanding of an existing codebase:

```text
/learn-codebase
```

## Where tickets live

Every project has a ticket store. With no configuration it is local Markdown
files under `context/tickets/`.

If your tickets belong in GitHub Issues, Jira, Linear, Azure DevOps, or
something internal:

```text
/setup-tracker
```

The store you choose is canonical — one ticket artifact, no copy in the
repository, nothing to sync. Feature specs are not tickets and stay in the
repository whatever you choose.

[Ticket stores](/guides/ticket-stores/) explains the model.

## Who Pathfinder is for

Pathfinder is a good fit when you want AI agents to do substantial software
work while you retain control of the important decisions.

It is probably not a fit if you want:

- an autonomous agent to choose the product and architecture for you
- a runtime that orchestrates a swarm of agents
- a software framework your application builds against
- a process enforced by infrastructure rather than readable instructions

Pathfinder is intentionally simpler than that.

## Read the kit

The documentation renders the same skills and project guidance the agent
reads.

Start with:

[`kickstart-pathfinder`](/skills/kickstart-pathfinder/)

or browse:

[All skills](/skills/)

For the deeper model, continue with:

- [Getting started](/guides/getting-started/)
- [Workflow](/guides/workflow/)
- [Roles](/guides/roles/)
- [Human approval](/concepts/human-approval/)
- [Ticket stores](/guides/ticket-stores/)
