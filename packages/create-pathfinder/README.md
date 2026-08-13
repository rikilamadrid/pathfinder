![Pathfinder](https://raw.githubusercontent.com/rikilamadrid/pathfinder/main/assets/logo-wordmark.png)

**An AI-assisted, human-in-the-loop workflow for building software — without giving up the decisions.**

This package installs [Pathfinder](https://github.com/rikilamadrid/pathfinder) into a Git repository — one you already have, or one it offers to create for you.

```bash
npx create-pathfinder
```

Then give your agent this prompt:

```text
Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project.
Do not install packages or write product code yet.
```

## What it installs

Pathfinder is a kit of context files and skills — not a framework. There is no runtime, no dependency, and nothing to build. The installer copies five things into your repository and nothing else:

| Path | What it is |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Entry files that tell an agent how to work in the project |
| `context/` | Project truth — overview, standards, interaction rules, current feature |
| `skills/` | Twenty skills covering discovery, specs, delivery, debugging, review, and learning |
| `templates/` | Starting points the project copies when it needs them |

It never copies Pathfinder's own `README.md`, `CHANGELOG.md`, CI configuration, or brand assets. Your repository gets the workflow, not the project that maintains it.

## What it will not do to your repository

This runs once, in real code, so it is deliberately timid:

- **It never overwrites.** Files that already exist are left exactly as they are and listed by name in the summary. Pass `--force` if you actually want them replaced.
- **It will not install outside a Git repository**, so whatever it writes is reviewable and undoable. In an empty directory it offers to run `git init` for you — and that is the only Git command it will ever run. No `add`, no `commit`, no config, no branch. If you say no, nothing is written.
- **It never touches an existing history.** A directory that is already a repository, or inside one, is never asked about and never initialized.
- **`--dry-run` reports the same plan the real install would carry out**, including any `git init`, without writing anything.

Re-running it is safe, and fills in only what is missing.

## Native skills for your coding tool

Pathfinder's skills are tool-neutral files at `skills/<name>/SKILL.md`. Some coding tools discover skills natively from their own directory, and the installer can generate small adapters there so you get `/reflect` instead of pasting a path.

```bash
npx create-pathfinder --agents claude-code,codex
```

| Id | Writes to | Invoked as |
| --- | --- | --- |
| `claude-code` | `.claude/skills/<name>/SKILL.md` | `/reflect` |
| `codex` | `.agents/skills/<name>/SKILL.md` | `/skills`, or `$reflect` |

Each adapter is a few lines long: it carries the skill's name and description, and tells the tool to read the canonical file. Both harnesses get the same bytes at a different path — the behavior lives in one place, and the adapter never restates it.

Pick one, both, or neither. Choosing one never generates, removes, or claims anything under the other's directory, and Pathfinder never writes to a personal skills directory such as `$HOME/.agents/skills`.

In a terminal you are asked instead of passing the flag — a numbered list, comma-separated, `Enter` for the tools found on your machine, `0` for none. Each option shows the directory it writes to before you choose it.

The list has a third entry, **Something else…**, and it generates nothing. Name your tool and the summary says so plainly, because a `.mdc` file Cursor half-reads or a `SKILL.md` in a directory nothing scans would be a file your tool ignores under a summary claiming success. Two things do work for any tool: the kit installs `AGENTS.md` at the repository root, which Codex, Cursor, and several others read, and any agent can be given the line the adapters delegate to anyway — `Use skills/<name>/SKILL.md and follow it exactly.`

Nothing is configured unless you choose it. Detection only sets the default, a piped or scripted run configures nothing at all unless `--agents` says so, and `--agents` accepts only the ids in the table above — an unknown one exits 2 rather than quietly installing nothing.

**What the installer owns, and what it will not touch:**

- **It owns a file at `<tool>/skills/<name>/SKILL.md` only if that name is a Pathfinder skill *and* the file carries the `pathfinder:adapter` marker it wrote.** Those it regenerates freely, with no flag — that is how an older install gains adapters by re-running.
- **A file you wrote at one of those paths is left alone** and listed by name in the summary. `--force` replaces it; nothing else does.
- **Everything else under that directory is never read and never written** — your `settings.json`, `settings.local.json`, agents, commands, hooks, and any skill of your own.
- **Nothing is ever deleted.** An adapter for a skill a newer version no longer ships is reported and left in place.

Re-running is idempotent: the second run writes the same bytes and reports the adapters as already up to date.

## The Kickstart prompt, and your clipboard

Every install ends by printing the one prompt that starts a session, and the prompt follows the tool you chose:

| Configured | Prompt |
| --- | --- |
| `claude-code` | `/kickstart-pathfinder` |
| `codex` | `$kickstart-pathfinder` |
| both, or neither | `Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project. Do not install packages or write product code yet.` |

Two harnesses fall back to the neutral form because one clipboard cannot hold two syntaxes, and picking a favorite would quietly decide which of your tools is the real one.

In a terminal you are then asked whether to copy it. The question says what it replaces, because your clipboard is yours:

```text
? Copy that prompt to your clipboard? This replaces what is on it now. [Y/n]
```

- **Nothing is copied without an explicit yes.** Declining, an unanswered question, `--no-clipboard`, `--yes`, `--dry-run`, and any run without a terminal on both ends all leave your clipboard exactly as it was.
- **The prompt is printed either way.** Copying is a convenience, never the only way to get it, which is what lets every failure be a non-event.
- **No dependency, and no clipboard is ever read.** The copy uses whatever your system already has — `pbcopy`, `clip.exe` including under WSL, or `wl-copy`, `xclip`, or `xsel` — chosen by what is actually installed rather than by your platform's name. If none of them is there, or one of them fails, the installer says so in one line and still exits 0.

## Options

| Option | Effect |
| --- | --- |
| `--agents <ids>` | Generate skill adapters for these tools, comma-separated. Valid ids: `claude-code`, `codex`. Alias: `--agent` |
| `--dry-run` | Report what would be written, and any `git init` that would run first; change nothing |
| `--force` | Overwrite files that already exist, and replace a file you wrote at a path an adapter would occupy |
| `--git-init` | Run `git init` here if this is not a repository yet |
| `--no-git-init` | Never run `git init`; refuse instead |
| `--no-clipboard` | Never offer to copy the Kickstart prompt. The prompt is printed either way |
| `--yes`, `--no-input` | Take the defaults and ask nothing. It does not authorize `git init`, configure any tool, or touch your clipboard — pass `--git-init` and `--agents` for the first two |
| `-h`, `--help` | Show usage |

Questions are asked only when stdin and stdout are both terminals. Piped, redirected, or in CI, nothing is asked and nothing is prompted for — so a directory that is not a repository needs `--git-init`, or the install is refused, no tool is configured without `--agents`, and the clipboard is never touched at all.

## Requirements

Node 18 or newer, and a Git repository — though the installer will offer to create one for you.

The `git` binary is only needed to *create* that repository. Inside one that already exists, the installer finds it by walking the filesystem for `.git` and never runs Git at all, so it works on a machine where `git` is not on your `PATH`.

No dependencies — this package installs nothing into your project's `node_modules`, and has none of its own.

## Links

- [Repository and full documentation](https://github.com/rikilamadrid/pathfinder)
- [Why this is not a framework](https://github.com/rikilamadrid/pathfinder/blob/main/NOT_A_FRAMEWORK.md)
- [Changelog](https://github.com/rikilamadrid/pathfinder/blob/main/CHANGELOG.md)

MIT © Lamadrid Labs
