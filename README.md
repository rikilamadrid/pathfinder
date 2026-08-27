<div align="center">

<img src="assets/logo-wordmark.png" alt="Pathfinder" width="357">

**A reusable workflow kit for directing AI agents through software delivery,
while keeping judgment and consequential decisions human.**

[![npm](https://img.shields.io/npm/v/create-pathfinder?color=E0611F&label=create-pathfinder)](https://www.npmjs.com/package/create-pathfinder)
[![validate](https://github.com/rikilamadrid/pathfinder/actions/workflows/validate.yml/badge.svg)](https://github.com/rikilamadrid/pathfinder/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-E0611F)](LICENSE)

[Website](https://pathfinder-kit.vercel.app/) ·
[Changelog](./CHANGELOG.md) ·
[Releases](https://github.com/rikilamadrid/pathfinder/releases) ·
[Contributing](./CONTRIBUTING.md)

<sub>by Lamadrid Labs</sub>

</div>

Pathfinder is a small, portable set of skills, roles, context files, and
templates you copy into a software project.

It gives AI agents a repeatable way to discover, plan, build, test, complete,
debug, learn from, and reflect on software work — without turning the agent
into the authority.

You remain responsible for direction, approval, acceptance, merge, release,
and other consequential decisions.

Pathfinder is intentionally stack-agnostic. It does not choose React, Python,
mobile, a database, hosting platform, Git model, or any other implementation
detail for you.

> The kit owns the workflow. The project owns the stack.

## What Pathfinder is

Pathfinder is a workflow kit for working with coding agents.

It provides:

- **skills** — reusable procedures for common software-development work
- **roles** — small responsibility boundaries for an AI session
- **context** — durable project truth and temporary workspace state
- **templates** — minimal shapes for project records created when needed

It is designed for human-in-the-loop development: agents can recommend and
execute work, but they do not silently make decisions that belong to you.

It is also not an autopilot. Recommendations are proposals, not silent
decisions — see
[Human approval](https://pathfinder-kit.vercel.app/concepts/human-approval/).

Pathfinder is **not** a framework or orchestration runtime.

There is no required:

- application framework
- package manager
- database
- hosting provider
- programming language
- Git branching model
- agent swarm
- background runtime

See [`NOT_A_FRAMEWORK.md`](NOT_A_FRAMEWORK.md).

## Quick start

Create or enter a Git repository:

```bash
mkdir my-project
cd my-project
git init
```

Then run:

```bash
npx create-pathfinder
```

Pathfinder copies the kit into the repository. It does not install a runtime
dependency into your application.

If you configure Claude Code or Codex during setup, Pathfinder also generates
native skill adapters for that tool.

Then start with:

```text
/kickstart-pathfinder
```

That begins a short discovery process to understand the project, record the
important decisions, and prepare the project for delivery.

If your tool does not support native skill discovery, use:

```text
Use skills/kickstart-pathfinder/SKILL.md to initialize this project.
```

Claude Code users have a second option: install Pathfinder as a plugin, which
brings every command without copying anything into the repository first. See
[Install as a Claude Code plugin](#install-as-a-claude-code-plugin).

## Install as a Claude Code plugin

Pathfinder supports two installation paths. They install different things, and
most people eventually want both.

| | `npx create-pathfinder` | Claude Code plugin |
| --- | --- | --- |
| Installs | the project kit — `context/`, `roles/`, `templates/`, `skills/`, `CLAUDE.md`, `AGENTS.md` | the commands, nothing else |
| Lives in | your repository, reviewed and tracked in Git | your Claude Code installation |
| Command form | `/kickstart-pathfinder`, with a generated adapter | `/pathfinder:kickstart-pathfinder`, always |
| Works with | any agent that can read files | Claude Code |
| Updating | re-run the installer | `claude plugin update pathfinder` |

Add the marketplace, then install:

```text
/plugin marketplace add rikilamadrid/pathfinder
/plugin install pathfinder@lamadrid-labs
```

The same two steps from a terminal:

```bash
claude plugin marketplace add rikilamadrid/pathfinder
claude plugin install pathfinder@lamadrid-labs
```

`rikilamadrid/pathfinder` is the repository; `lamadrid-labs` is the marketplace
it declares. The marketplace name appears when you install and never again — it
is not part of any command.

### Commands are namespaced

Claude Code namespaces every plugin skill, with no way to opt out. Through the
plugin, each Pathfinder skill is `/pathfinder:<skill>`:

```text
/pathfinder:ticket load
/pathfinder:role planner
/pathfinder:whereami
```

The bare `/ticket` form comes from a generated adapter in your repository, which
is the installer's job (`npx create-pathfinder --agents claude-code`). A
repository with both installed has both forms. They run the same canonical skill
body, so neither overrides the other and it does not matter which you type.

### What the plugin does not install

The plugin distributes commands. It does not distribute project state.
`context/` is written per project and belongs to that project, so a repository
reached only through `/plugin install` has every Pathfinder command and none of
the files those commands read.

`/pathfinder:kickstart-pathfinder` closes that gap: in a project missing the
kit, it offers to install it from the plugin's own copy, names every file before
writing, overwrites nothing without asking, and deletes nothing. `npx
create-pathfinder` remains fully supported and is the only path that also
generates adapters.

### A local or custom marketplace

Any clone can serve as its own marketplace — the repository *is* the plugin:

```text
/plugin marketplace add ./
/plugin install pathfinder@lamadrid-labs
```

To try a working copy without installing anything, start Claude Code with
`claude --plugin-dir /path/to/pathfinder`.

### Updating, versions, and uninstalling

The plugin's version is the kit's version: one number in `CHANGELOG.md`,
`packages/create-pathfinder/package.json`, and `.claude-plugin/plugin.json`,
which CI keeps in agreement. `claude plugin update pathfinder` hands you a new
version when a release changes that number, and never between releases.

`claude plugin uninstall pathfinder` removes the commands. Kit files in your
repository are yours and survive it — deleting them is a Git operation you
perform deliberately, not something an uninstall does behind you.

## The workflow

The core Pathfinder flow is deliberately small:

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

A prototype is optional. Use one when an important assumption is cheaper to
prove than to debate.

Features are small, focused, and independently verifiable.

When something is observably broken, the loop pauses and `debug-issue` runs
instead of the agent guessing its way forward. It reproduces before repairing
and tests hypotheses rather than editing at random. See
[When something breaks](https://pathfinder-kit.vercel.app/guides/workflow/#when-something-breaks).

Supporting skills handle learning, reference analysis, handoff, reflection, and
optional work tracking when those are useful.

See the
[workflow guide](https://pathfinder-kit.vercel.app/guides/workflow/)
for the complete model.

## Optional roles

Roles narrow what an AI session is responsible for.

Pathfinder ships three:

| Role | Responsibility |
| --- | --- |
| `planner` | Turns approved direction into clear Feature specs |
| `developer` | Implements approved work without accepting its own work |
| `tester` | Independently verifies delivered work and reports findings |

Activate one in a supported tool:

```text
/role developer
```

Roles are optional.

They do not grant authority. The human always owns approval, acceptance,
merge, release, and other decisions requiring judgment.

## Know where you are

During a working session:

```text
/whereami
```

gives you a compact orientation view such as the active role, current Feature,
Git state, and next action.

When you need to stop and continue later:

```text
/handoff
```

records only the minimum factual state another session needs to resume safely.

## Start a new project

<!-- copy-list:start -->

<!-- CI checks that this section names every entry in
     packages/create-pathfinder/copy-list.json, the canonical list. Keep the
     markers when rewriting the install instructions; without them the check
     passes vacuously. -->

Running:

```bash
npx create-pathfinder
```

copies these kit entries:

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | Agent entry point for tools that use it |
| `CLAUDE.md` | Claude Code project guidance |
| `context/` | Project standards and interaction rules |
| `roles/` | Planner, developer, and tester responsibility contracts |
| `skills/` | Reusable workflow procedures |
| `templates/` | Minimal starting shapes created when needed |

The installer never silently overwrites. Files you already have are left
alone and listed by name in the summary.

Use:

```bash
npx create-pathfinder --dry-run
```

to preview changes, or:

```bash
npx create-pathfinder --force
```

when you want files that already exist overwritten — any file in the list
above, whoever created or edited it — and a file you wrote at a path an
adapter would occupy replaced.

Pathfinder installs only into a Git repository. If the current directory is
not one, the installer explains why Git is required and can offer to initialize
it for you. Declining leaves the project untouched.

Pathfinder's own `CHANGELOG.md` is not copied into destination projects.
Projects that want a changelog can use:

```text
templates/CHANGELOG.template.md
```

<!-- copy-list:end -->

## Add Pathfinder to an existing repo

Run:

```bash
npx create-pathfinder
```

inside the existing Git repository.

Pathfinder preserves existing files and project conventions. Nothing is
overwritten unless you explicitly use `--force`.

Then run:

```text
/kickstart-pathfinder
```

Kickstart inspects only what it needs to understand the existing project and
separates repository facts from decisions that still require human input.

For deeper onboarding or architectural understanding, use:

```text
/learn-codebase
```

Do not use `reverse-engineer` to analyze the repository Pathfinder is currently
operating inside. That responsibility belongs to `kickstart-pathfinder`,
`learn-codebase`, or the relevant feature skill.

## Native to your tools

Claude Code and Codex can receive native Pathfinder skill adapters during
installation.

The canonical behavior remains in:

```text
skills/<name>/SKILL.md
```

Generated adapters simply make those skills available through the tool's own
skill interface.

In a terminal you are asked which tools to configure, with the detected ones as
the default. Without one, name them explicitly:

```bash
npx create-pathfinder --agents claude-code,codex
```

Nothing is configured unless you choose it, and choosing one tool never touches
the other's directory.

Adapters are generated artifacts, not copy-list entries. The six paths in the
table above are the kit; adapters are derived from `skills/` at install time and
never added to `copy-list.json`.

The Claude Code plugin is a third way to reach the same canonical skills, and it
generates nothing: it exposes `skills/` directly, under the `/pathfinder:` prefix.
Installing it adds no file to your repository, adapters included. See
[Install as a Claude Code plugin](#install-as-a-claude-code-plugin).

Re-running the installer refreshes Pathfinder-owned adapters while preserving
your own configuration and unrelated skills.

The ownership rule is one sentence: the installer owns a file at an adapter path
only if the name is a Pathfinder skill *and* the file carries the
`pathfinder:adapter` marker it wrote. Your `settings.json`, agents, commands,
hooks, and any skill of your own are never read and never written, a file you
wrote at an adapter path is left alone and named in the summary, and nothing is
ever deleted.

Without native skill support, invoke any Pathfinder skill directly:

```text
Use skills/<name>/SKILL.md and follow it exactly.
```

For example:

```text
Use skills/reverse-engineer/SKILL.md to analyze this reference.
```

## Useful skills

Some common entry points:

| Skill | Use it when |
| --- | --- |
| `kickstart-pathfinder` | Starting or adopting a project |
| `debate-me` | Pressure-testing a direction before committing to it |
| `prototype` | Proving an important assumption cheaply |
| `to-specs` | Turning approved direction into Features |
| `to-tickets` | Slicing one approved Feature into executable tickets |
| `ticket` | The delivery loop: `load`, `start`, `review`, `complete` |
| `debug-issue` | Something is observably broken |
| `handoff` | Leaving factual state for another session |
| `whereami` | Getting quick session orientation |
| `learn-feature` | Learning from completed work |
| `reflect` | Improving the workflow from actual experience |
| `setup-tracker` | Opting into work tracking |
| `sync-tracker` | Projecting Features to the configured tracker |

The complete list lives in `skills/` and on the
[Pathfinder website](https://pathfinder-kit.vercel.app/).

## Optional work tracking

Pathfinder does not require a ticket system.

Feature specs in the repository remain canonical.

If you want work projected somewhere else, run:

```text
/setup-tracker
```

A project can use GitHub Issues, local Markdown files, or another configured
tracker.

Then:

```text
/sync-tracker
```

projects the selected Features outward.

Tracker state never silently becomes Pathfinder state.

## Context stays small

A fresh Pathfinder install ships only the context needed immediately:

```text
context/
├── ai-interaction.md
└── coding-standards.md
```

Other project context is created only when a workflow actually needs it.

For example:

```text
context/project-overview.md
context/features/
context/tickets/
context/history.md
context/tracker.md
context/current-ticket.md
context/handoff.md
```

This avoids filling a new project with blank scaffolding.

### What belongs in Git

The rule is simple:

**Durable project truth is tracked.**

Examples:

```text
context/project-overview.md
context/features/
context/tickets/
context/history.md
context/tracker.md
```

**Temporary session state is normally ignored.**

Two paths belong to one session on one machine, and are two lines in
`.gitignore`:

```gitignore
context/current-ticket.md
context/handoff.md
```

Do not ignore `context/` wholesale. That would also hide the durable project
truth future sessions need.

Teams that intentionally want to share workspace state can choose to track the
transient files instead.

A project installed before v1.5.0 also has a `prompts/` directory, which the
installer leaves untouched and which keeps working, since those launchers point
at `skills/`.

## What's in the kit

<details>

<summary>Full layout</summary>

```text
.
├── AGENTS.md
├── CLAUDE.md
├── CHANGELOG.md                  # Pathfinder's own history
├── NOT_A_FRAMEWORK.md
├── context/
│   ├── ai-interaction.md
│   └── coding-standards.md
├── roles/
│   ├── developer.md
│   ├── planner.md
│   └── tester.md
├── skills/
│   ├── challenge-me/
│   ├── debate-me/
│   ├── debug-issue/
│   ├── handoff/
│   ├── kickstart-pathfinder/
│   ├── learn-codebase/
│   ├── learn-feature/
│   ├── learning-review/
│   ├── prototype/
│   ├── quiz-me/
│   ├── reflect/
│   ├── reverse-engineer/
│   ├── role/
│   ├── setup-tracker/
│   ├── skillsmith/
│   ├── sync-tracker/
│   ├── teach-architecture/
│   ├── teach-feature/
│   ├── ticket/
│   ├── to-specs/
│   ├── to-tickets/
│   └── whereami/
└── templates/
    ├── CHANGELOG.template.md
    ├── feature-spec.template.md
    ├── history.template.md
    ├── lesson.template.md
    ├── project-overview.template.md
    └── ticket.template.md
```

</details>

Generated Claude Code or Codex adapters may also appear under:

```text
.claude/skills/
.agents/skills/
```

They are derived from the canonical files under `skills/`.

## Learn more

The website contains the deeper guides that do not need to live in this
README:

- [Workflow](https://pathfinder-kit.vercel.app/guides/workflow/)
- [Human approval](https://pathfinder-kit.vercel.app/concepts/human-approval/)
- [Context boundaries](https://pathfinder-kit.vercel.app/concepts/context-boundaries/)
- [Work tracking](https://pathfinder-kit.vercel.app/guides/work-tracking/)

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development, pull request,
versioning, release, and skill-contribution guidance.

Conduct expectations are in
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

Report security concerns privately according to
[`SECURITY.md`](SECURITY.md).

## License

MIT — see [`LICENSE`](LICENSE).

Copy Pathfinder into your own projects freely. The kit is licensed; what you
build with it is yours.
