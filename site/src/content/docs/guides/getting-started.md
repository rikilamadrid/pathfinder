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

- **Git.** Pathfinder installs into version control; if this directory is not a
  repository yet, the installer offers to run `git init` for you. The `git` binary
  is only needed to *create* one — inside a repository that already exists, the
  installer never runs Git at all.
- **Node 18 or newer**, to run `npx` once. Nothing stays installed afterwards.
- **An AI coding agent that can read files in your project** — Claude Code, or any
  agent you can point at a path.

You do not need a package manager, a framework, or a project that already builds.
Pathfinder is markdown.

## Install

Make a directory, or `cd` into a repository you already have.

```bash
mkdir my-project
cd my-project
npx create-pathfinder
```

The installer copies files and exits. It adds no dependency, writes no
`package.json`, and leaves nothing behind in `node_modules`.

In an empty directory it opens by reporting what it found, then asks two
questions before writing anything — whether to create the repository, and which
coding tools to configure:

```text
     ━━━
    ━━━━━      P A T H F I N D E R  v3.1.0
   ━━━━━━━     trail markers for AI-assisted work
  ━━━━━━━━━

  🔍  ENVIRONMENT
  │  · No Git repository here
  │  ✓ Tools detected: Claude Code, Codex, VS Code, Cursor (noted, not configured)

Pathfinder installs into version control so you can review what it wrote
and undo it. It will not touch an existing history.

? Initialize a Git repository here?

❯ Yes
  No

  ↑↓ move   enter confirm
  ✓ git init — initialized an empty repository in /path/to/my-project

? Configure Pathfinder for which tools?

  ◉ Claude Code      -> .claude/skills/   (detected)
❯ ○ Codex            -> .agents/skills/   (detected)
  ○ Something else…  -> nothing is generated

  ↑↓ move   space toggle   enter confirm

  📦  INSTALLING
  │  ✓ Kit files — N copied
  │  ✓ Claude Code — N adapters

  📋  SUMMARY
  │  Installed the Pathfinder kit into /path/to/my-project
  │  ✓ N files written
  │  ✓ N Claude Code skill adapters generated

     ━━━
    ━━━━━      🎉  YOU'RE ALL SET
   ━━━━━━━     N files, N adapters, Claude Code
  ━━━━━━━━━

  Hand your agent this prompt to begin:

    /kickstart-pathfinder

? Copy that prompt to your clipboard? This replaces what is on it now.

  Yes
❯ No

  ↑↓ move   enter confirm
? Open this project in VS Code?

  Yes
❯ No

  ↑↓ move   enter confirm

  Trail's marked. The rest is yours.
```

That transcript is a real run, captured with colour switched off, because a
Markdown code block can show the glyphs and the layout but not the colour. The
file and adapter counts are shown as `N` rather than as the numbers that run
printed: a real run prints real totals, and pinning last release's totals into
this page only guarantees they are wrong by the next one. In a
colour terminal the same run adds Pathfinder's orange to the mark, green to the
successful counts, and yellow to anything that wants your attention — and it
draws a progress bar through the install phase, which appears only where a
terminal is being watched live. Piped or redirected, the output is plainer still
and is unchanged from earlier versions, so anything already parsing it keeps
working.

Every question is answered with the keyboard: `↑` and `↓` move, `Space` toggles
a checkbox, `Enter` confirms, `Escape` cancels. What the code block can only
show frozen is a list that redraws in place as you move — the block above is the
last frame of each question, which is what you are left looking at once you have
answered it. Notice that each row names the directory it would write to, so
nothing has to be checked to find out what checking it does.

If you would rather type, or you are using a screen reader, set
`PATHFINDER_PROMPT=classic` and every question becomes a numbered list and a
`y`/`n` instead. That is a supported way to run the installer rather than a
reduced one, and it is what a terminal narrower than 49 columns and a `TERM` of
`dumb` choose on their own. `NO_COLOR` is about colour only — it does not turn
the keyboard selection off, which is why the transcript above still shows it.

Detection sets the defaults and nothing else — the tools line says
`(noted, not configured)` because that is the whole of it. Nothing is configured
unless you choose it, and declining the first question writes nothing at all.

The last two questions are conveniences: whether to copy that prompt to your
clipboard, and whether to open the project in an editor already on your `PATH`.
Say no to either and the install is unaffected.

The exact file count moves as the kit grows. What does not move is the shape of
what landed.

Questions are asked only when stdin and stdout are both terminals. Piped,
redirected, or in CI, nothing is asked: pass `--git-init` and
`--agents claude-code,codex` to get the same result without prompts.

## Confirm what landed

```bash
ls
```

In the empty repository you just created, six things:

| Path | What it is |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Entry files that tell an agent how to work in the project |
| `context/` | Project truth — the interaction rules and coding standards; the rest is written when first needed |
| `roles/` | Three declarative contracts — planner, developer, tester — inert until you name one |
| `skills/` | Skills covering discovery, specs, delivery, debugging, review, and learning |
| `templates/` | Starting points the project copies when it needs them |

Plus a `.claude/` or `.agents/` directory if you asked for adapters. Those hold one
generated pointer per skill, rendered from `skills/` at install time rather than
copied — which is why they are not part of the six, and why editing a skill
changes behavior while editing an adapter does not.

Nothing is hidden from you. The installer stages nothing and commits nothing, so
`git status` reports everything it added as untracked — `git status -uall` lists it
file by file — and `git clean -fd` removes all of it in one command. That is why it
insists on a repository, and why it offers to create one rather than proceeding
without.

Pathfinder's own `README.md`, `CHANGELOG.md`, CI configuration, and brand assets are
never copied. Your repository gets the workflow, not the project that maintains it.

### Two lines for your `.gitignore`

`context/` starts with two files and grows as you work. What gets written into it
divides cleanly, and the division is worth setting up before your first commit.

**Durable project truth is tracked.** `context/project-overview.md`,
`context/features/`, `context/history.md`, and `context/tracker.md` answer *what is
true about this project*. They outlive any session and a reviewer should see them
change.

**Transient session state is ignored.** `context/current-feature.md` and
`context/handoff.md` answer *what was I doing*. They belong to one session on one
machine, and committing them puts your in-flight work in everybody else's diff:

```text
context/current-feature.md
context/handoff.md
```

That is the whole mechanism — no hook, no filter, no wrapper. **Do not ignore
`context/` as a directory.** It looks tidier and quietly untracks the file
documenting your stack and workflow, which every later session reads as true.

A team that would rather share workspace state can track both files instead.
Nothing in the kit reads Git to decide how to behave.

## Installing into a repository you already have

The same command. Run it at the root of the existing repository:

```bash
npx create-pathfinder
```

It never overwrites. Files you already have are left exactly as they are and listed
by name, so a repository with its own `CLAUDE.md` or `context/` keeps them and
receives only what is missing.

Re-running in a project that already has Pathfinder is safe, requires no flags, and
is idempotent: edited files are skipped and listed, files new in this version are
written, and adapters are regenerated byte-identically if nothing changed. That is
how a project installed before v1.5.0 gains adapters — one ordinary run, no
migration step.

Your tool's own configuration is not Pathfinder's to touch. It owns a file under
`.claude/skills/` or `.agents/skills/` only if the name is a Pathfinder skill *and*
the file carries the marker it wrote. Your `settings.json`, agents, commands, hooks,
and any skill of your own are never read and never written, and nothing is ever
deleted.

Options worth knowing before you run it anywhere real:

| Option | Effect |
| --- | --- |
| `--dry-run` | Report the same plan the real install would carry out, and write nothing |
| `--force` | Overwrite files that already exist, and replace a file you wrote at a path an adapter would occupy. Off by default |
| `--agents <ids>` | Generate adapters for `claude-code`, `codex`, or both, without being asked |
| `--git-init` | Run `git init` here if this is not a repository yet |
| `--yes` | Take the defaults and ask nothing. It does not authorize `git init` or configure any tool |
| `--no-clipboard`, `--no-open` | Skip the clipboard offer and the editor offer |

`--dry-run` runs the real planner, so what it reports is what would happen — not a
separate description of it.

## Or install the Claude Code plugin

Everything above installs the **kit** — the files your repository keeps. Claude Code
users have a second path that installs the **commands** instead:

```text
/plugin marketplace add rikilamadrid/pathfinder
/plugin install pathfinder@lamadrid-labs
```

`rikilamadrid/pathfinder` is the repository, and `lamadrid-labs` is the marketplace
it declares. The marketplace name is used once, at install; it is not part of any
command afterwards. The same two steps work from a terminal as
`claude plugin marketplace add` and `claude plugin install`.

**Plugin commands are namespaced, always.** Claude Code prefixes every plugin skill
with its plugin name and offers no way to opt out, so through the plugin each skill
is `/pathfinder:<skill>`:

```text
/pathfinder:feature load
/pathfinder:role planner
/pathfinder:whereami
```

The bare `/feature` form is not a plugin feature — it comes from an adapter the
installer generated in your repository. A project with both installed has both
forms, running the same canonical skill body, and neither shadows the other.

**The plugin installs no files into your repository.** It carries commands, not
project state, so a repository reached only through `/plugin install` has every
Pathfinder command and none of the `context/`, `roles/`, or `templates/` files
those commands read. `/pathfinder:kickstart-pathfinder` offers to install the kit
from the plugin's own copy — naming every file first, overwriting nothing without
asking, deleting nothing. It generates no adapters; `npx create-pathfinder` is
still what does that.

Any clone can act as its own marketplace, because the repository *is* the plugin:
`/plugin marketplace add ./` from inside one, or `claude --plugin-dir /path/to/pathfinder`
to try a working copy without installing anything.

**Updates follow releases.** The plugin's version is the kit's version, and
`claude plugin update pathfinder` hands you a new one when a release changes that
number — never between releases. `claude plugin uninstall pathfinder` removes the
commands only: kit files in your repository are yours and survive it.

## Point your agent at the kit

Open your agent in the project and give it the prompt the installer printed:

```text
Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project. Do not install packages or write product code yet.
```

If you configured Claude Code or Codex, the installer generated the adapters that
make Pathfinder's skills appear in that tool's own list, and the prompt it printed
is the native one — `/kickstart-pathfinder` or `$kickstart-pathfinder`. Anywhere
else, one line tells the agent where to look:
`Use skills/kickstart-pathfinder/SKILL.md and follow it exactly.` That is the whole
fallback, and it is what the adapters delegate to anyway.

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

Once the direction is clear enough, it records the emerging context — creating
`context/project-overview.md` from its template, then filling in
`context/coding-standards.md`, [`context/ai-interaction.md`](/context/ai-interaction/),
`CLAUDE.md`, and `AGENTS.md` — and then recommends what to run next.

It does not wait for your approval to write. What it has not settled with you stays
visible in the file — a choice nobody has made reads [`TBD`](/concepts/decision-states/),
and everything else is a line it recorded for you to check. A choice appearing in
`context/` records where the conversation reached, not something you agreed to.

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
→ /feature load      prepare exactly one feature; fills context/current-feature.md
→ /feature start     implement it in stable delivery chunks
→ /feature review    check it against requirements, regressions, and standards
→ /feature complete  verify, close, and record it in context/history.md
```

Run them one at a time and read what comes back —
`/feature start` restates the goal, the active chunk, the files it expects to
touch, the risks, its verification plan, and what it considers out of scope
*before* it writes anything. That restatement is your cheapest chance to catch a
misunderstanding.

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
anything. In a terminal it would have offered to run `git init`, so seeing this
means either you declined, or nothing was there to ask: piped, redirected, and CI
runs never prompt. Pass `--git-init` to authorize it, run `git init` yourself, or
`cd` into an existing repository.

**Files were listed as left untouched** — that is the non-destructive default doing
its job, not an error. Those files already existed. If you genuinely want the kit's
versions, re-run with `--force`.

**Your agent cannot find the skill** — it does not discover local skills. Tell it
where to look instead: `Use skills/kickstart-pathfinder/SKILL.md and follow it
exactly.` The same line works for any skill — swap the name.

**Your agent starts writing product code during discovery** — stop it and point it
back at the skill's stop condition. `kickstart-pathfinder` is done when project
context is approved, and not before.

## Next

[The workflow](/guides/workflow/) draws all five loops and marks every point where
the agent is supposed to stop and ask you something. Read it once you have a feature
or two behind you and the shape will already be familiar.

Every skill in the sidebar is rendered from the kit's own `skills/` directory, so
what you read here is exactly what your agent reads. The two worth reading before
your second feature are [`feature`](/skills/feature/), the dispatcher for the four
delivery actions and where most of your time goes, and
[`reflect`](/skills/reflect/), which is how the workflow gets better at your
project rather than staying generic.
