---
title: Getting started
description: Install Pathfinder into a repository and run your first session, from an empty directory to a completed feature.
---

This guide takes you from an empty directory to your first completed feature. Every
command here was run against the published package, in a fresh repository, in this
order.

Installing takes seconds. Discovery is a conversation, so it takes as long as your
project needs — and so does the first feature.

## What you need

- **Git**, and a repository to install into. The installer refuses to run outside
  one.
- **Node 18 or newer**, to run `npx` once. Nothing stays installed afterwards.
- **An AI coding agent that can read files in your project** — Claude Code, or any
  agent you can point at a path.

You do not need a package manager, a framework, or a project that already builds.
Pathfinder is markdown.

## Install

Start a repository, or `cd` into one you already have.

```bash
mkdir my-project
cd my-project
git init
npx create-pathfinder
```

The installer copies files and exits. It adds no dependency, writes no
`package.json`, and leaves nothing behind in `node_modules`.

On a fresh repository it reports where it installed, what it wrote, and the prompt
to run next:

```text
Installed the Pathfinder kit into /path/to/my-project

  56 files written

Next step — give your agent this prompt:

  Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this
  project. Do not install packages or write product code yet.
```

The exact file count moves as the kit grows. What does not move is the shape of
what landed.

## Confirm what landed

```bash
ls
```

In the empty repository you just created, six things — and nothing else:

| Path | What it is |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Entry files that tell an agent how to work in the project |
| `context/` | Project truth — overview, standards, interaction rules, current feature |
| `skills/` | Skills covering discovery, specs, delivery, debugging, review, and learning |
| `prompts/` | Manual launchers for tools that do not discover local skills |
| `templates/` | Starting points the project copies when it needs them |

Nothing is hidden from you. The installer stages nothing and commits nothing, so
`git status` reports everything it added as untracked — `git status -uall` lists it
file by file — and `git clean -fd` removes all of it in one command. That is why it
insists on a repository.

Pathfinder's own `README.md`, `CHANGELOG.md`, CI configuration, and brand assets are
never copied. Your repository gets the workflow, not the project that maintains it.

## Installing into a repository you already have

The same command. Run it at the root of the existing repository:

```bash
npx create-pathfinder
```

It never overwrites. Files you already have are left exactly as they are and listed
by name, so a repository with its own `CLAUDE.md` or `context/` keeps them and
receives only what is missing. Re-running is safe and fills in the gaps.

Two options are worth knowing before you run it anywhere real:

| Option | Effect |
| --- | --- |
| `--dry-run` | Report the same plan the real install would carry out, and write nothing |
| `--force` | Overwrite files that already exist. Off by default |

`--dry-run` runs the real planner, so what it reports is what would happen — not a
separate description of it.

## Point your agent at the kit

Open your agent in the project and give it the prompt the installer printed:

```text
Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project. Do not install packages or write product code yet.
```

If your tool discovers local skills on its own, `kickstart-pathfinder` is enough.
If it does not, every skill has a ready-made launcher in `prompts/` — this one is
`prompts/01-kickstart-project.md`. Paste the file's contents.

The second sentence of that prompt is not politeness. `kickstart-pathfinder` stops
before specs, scaffolding, dependencies, and product code, and saying so up front
keeps an eager agent inside that boundary.

## What the first session should feel like

[`kickstart-pathfinder`](/skills/kickstart-pathfinder/) runs a discovery
conversation. Expect it to:

- **ask in small groups, not one giant questionnaire** — product and audience first,
  then the MVP boundary, then stack, data, quality priorities, and delivery
  preferences;
- **inspect an existing repository lightly** and treat what it finds there as
  established fact rather than a decision to remake;
- **separate what you decided from what it is recommending**, and say which is
  which;
- **leave open decisions marked [`TBD`](/concepts/decision-states/)** instead of
  quietly choosing for you.

Once the direction is clear enough, it records the emerging context — filling in
[`context/project-overview.md`](/context/project-overview/),
`context/coding-standards.md`, [`context/ai-interaction.md`](/context/ai-interaction/),
`CLAUDE.md`, and `AGENTS.md` — and then recommends what to run next.

It does not wait for your approval to write. What it has not settled with you stays
marked `proposed` or [`TBD`](/concepts/decision-states/) in the file, so a choice
appearing in `context/` records where the conversation reached, not something you
agreed to.

Which makes the next step yours. Read `context/project-overview.md` and correct or
approve it before any implementation begins. It is now the file every later session
treats as true, and it is short enough to read in one sitting — an error here
propagates into every feature spec that follows.

Two things it will not do: install packages, and write product code. If it starts
doing either, stop it and say so. That boundary is the skill's, not your tool's.

## Your first feature

Discovery hands off to one of three skills, and it will tell you which it
recommends.

- [`debate-me`](/skills/debate-me/) when the direction is still arguable. It
  pressure-tests product scope, stack, and workflow, and you choose.
- [`prototype`](/skills/prototype/) when one assumption is risky enough to test
  cheaply before committing.
- [`to-specs`](/skills/to-specs/) when the direction is settled.

`to-specs` is what turns approved context into work. It writes small, sequential
feature specs into `context/features/` — one visible outcome each, sized to fit a
single focused session. It will not plan your whole product, and if the MVP boundary
or a critical decision is still unresolved it reports the blockers instead of
inventing decisions. That refusal is the feature.

From there, one feature at a time:

```text
→ load-feature       prepare exactly one feature; fills context/current-feature.md
→ start-feature      implement it in stable delivery chunks
→ review-feature     check it against requirements, regressions, and standards
→ complete-feature   verify, close, and record it in context/history.md
```

Each has a launcher in `prompts/`, numbered in that order. Run them one at a time
and read what comes back — [`start-feature`](/skills/start-feature/) restates the
goal, the active chunk, the files it expects to touch, the risks, its verification
plan, and what it considers out of scope *before* it writes anything. That restatement
is your cheapest chance to catch a misunderstanding.

If something breaks along the way, [`debug-issue`](/skills/debug-issue/) interrupts
the loop. It reproduces the failure before repairing it, which is the part that
makes the fix mean something.

## Where you will be asked to decide

Two kinds of stop, and it is worth knowing which is which before your first
feature.

Some **operations** need approval before the agent carries them out — installing a
dependency, a destructive command, a commit, a release. That list is
[`context/ai-interaction.md`](/context/ai-interaction/), now a file in the project
you just installed into. You can widen it, narrow it, or pre-approve parts of it.

Some **decisions** are never the agent's to make at all — product scope, the stack,
the architecture. Those are not on that list because they are not operations. An
agent recommends; you choose.

[Human approval](/concepts/human-approval/) sets out both, and where each one lives.

## When something does not work

**`is not inside a Git repository`** — the installer stopped before writing
anything. Run `git init` here, or `cd` into an existing repository, and run it
again.

**Files were listed as left untouched** — that is the non-destructive default doing
its job, not an error. Those files already existed. If you genuinely want the kit's
versions, re-run with `--force`.

**Your agent cannot find the skill** — it does not discover local skills. Open
`prompts/01-kickstart-project.md` and paste its contents instead. Every skill has
one.

**Your agent starts writing product code during discovery** — stop it and point it
back at the skill's stop condition. `kickstart-pathfinder` is done when project
context is approved, and not before.

## Next

[The workflow](/guides/workflow/) draws all five loops and marks every point where
the agent is supposed to stop and ask you something. Read it once you have a feature
or two behind you and the shape will already be familiar.

Every skill in the sidebar is rendered from the kit's own `skills/` directory, so
what you read here is exactly what your agent reads. The two worth reading before
your second feature are [`start-feature`](/skills/start-feature/), which is where
most of your time goes, and [`reflect`](/skills/reflect/), which is how the workflow
gets better at your project rather than staying generic.
