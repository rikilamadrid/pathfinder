![Pathfinder](https://raw.githubusercontent.com/rikilamadrid/pathfinder/main/assets/logo-wordmark.png)

**An AI-assisted, human-in-the-loop workflow for building software — without giving up the decisions.**

This package installs [Pathfinder](https://pathfinder-kit.vercel.app) into a Git repository — one you already have, or one it offers to create for you.

```bash
npx create-pathfinder
```

That is the whole invocation. This is a scaffolding CLI you run once, not a dependency: `npm i create-pathfinder` would add it to your project's `package.json` and `node_modules` without installing anything into your repository. If you would rather not use `npx`, `npm exec create-pathfinder` is equivalent, and a global install (`npm i -g create-pathfinder`) gives you a `create-pathfinder` command that behaves identically.

Then give your agent this prompt:

```text
Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project.
Do not install packages or write product code yet.
```

Everything below is what the command does. **What Pathfinder is, how the workflow runs, and what each skill does are documented at [pathfinder-kit.vercel.app](https://pathfinder-kit.vercel.app).**

## What it installs

The installer copies five things into your repository and nothing else:

| Path | What it is |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Entry files that tell an agent how to work in the project |
| `context/` | Project truth — overview, standards, interaction rules, current feature |
| `skills/` | Twenty skills covering discovery, specs, delivery, debugging, review, and learning |
| `templates/` | Starting points the project copies when it needs them |

On request it also writes one thing it does not copy:

| Path | What it is |
| --- | --- |
| `.claude/skills/`, `.agents/skills/` | **Generated** — a small adapter per skill, derived from `skills/` at install time, so your coding tool discovers them natively. Not part of the five above; see [Native skills for your coding tool](#native-skills-for-your-coding-tool) |

It never copies Pathfinder's own `README.md`, `CHANGELOG.md`, CI configuration, or brand assets. Your repository gets the workflow, not the project that maintains it.

## What it will not do to your repository

This runs once, in real code, so it is deliberately timid:

- **It never overwrites.** Files that already exist are left exactly as they are and listed by name in the summary. Pass `--force` if you actually want them replaced.
- **It will not install outside a Git repository**, so whatever it writes is reviewable and undoable. In an empty directory it offers to run `git init` for you — and that is the only Git command it will ever run. No `add`, no `commit`, no config, no branch. If you say no, nothing is written.
- **It never touches an existing history.** A directory that is already a repository, or inside one, is never asked about and never initialized.
- **`--dry-run` reports the same plan the real install would carry out**, including any `git init`, without writing anything.
- **It owns a generated adapter, and nothing else in your tool's directory.** A file at `.claude/skills/<name>/SKILL.md` or `.agents/skills/<name>/SKILL.md` belongs to the installer only if that name is a Pathfinder skill *and* the file carries the `pathfinder:adapter` marker it wrote. Your `settings.json`, `settings.local.json`, agents, commands, hooks, and any skill of your own are never read and never written, a file you wrote at an adapter path is left alone and named in the summary, and nothing is ever deleted.

**Re-running `npx create-pathfinder` in a project that already has Pathfinder is safe, requires no flags, and is idempotent.** Canonical files you have edited are skipped and listed; files new in this version are written; adapters are regenerated, byte-identical if nothing changed; anything you own is untouched. That is how a project installed before v1.5.0 gains adapters — one ordinary run, no migration command.

## Native skills for your coding tool

Pathfinder's skills are tool-neutral files at `skills/<name>/SKILL.md`. Some coding tools discover skills natively from their own directory, and the installer can generate small adapters there so you get `/reflect` instead of pasting a path.

```bash
npx create-pathfinder --agents claude-code,codex
```

| Id | Writes to | Invoked as |
| --- | --- | --- |
| `claude-code` | `.claude/skills/<name>/SKILL.md` | `/reflect` |
| `codex` | `.agents/skills/<name>/SKILL.md` | `/skills`, or `$reflect` |

Each adapter carries the skill's name and description and tells the tool to read the canonical file — the behavior lives in one place, and the adapter never restates it.

Pick one, both, or neither. Choosing one never generates, removes, or claims anything under the other's directory, and Pathfinder never writes to a personal skills directory such as `$HOME/.agents/skills`.

In a terminal you are asked instead of passing the flag — a numbered list, comma-separated, `Enter` for the tools found on your machine, `0` for none. Each option shows the directory it writes to before you choose it. A third entry, **Something else…**, generates nothing and says so: the kit still installs `AGENTS.md` at the repository root, which Codex, Cursor, and several others read, and any agent can be given the line the adapters delegate to — `Use skills/<name>/SKILL.md and follow it exactly.`

Nothing is configured unless you choose it. Detection only sets the default, a piped or scripted run configures nothing at all unless `--agents` says so, and `--agents` accepts only the ids in the table above — an unknown one exits 2 rather than quietly installing nothing.

## The Kickstart prompt, and your clipboard

Every install ends by printing the one prompt that starts a session, and the prompt follows the tool you chose:

| Configured | Prompt |
| --- | --- |
| `claude-code` | `/kickstart-pathfinder` |
| `codex` | `$kickstart-pathfinder` |
| both, or neither | `Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project. Do not install packages or write product code yet.` |

In a terminal you are then asked whether to copy it, in a question that says what it replaces:

```text
? Copy that prompt to your clipboard? This replaces what is on it now. [Y/n]
```

- **Nothing is copied without an explicit yes.** Declining, an unanswered question, `--no-clipboard`, `--yes`, `--dry-run`, and any run without a terminal on both ends all leave your clipboard exactly as it was.
- **The prompt is printed either way.** Copying is a convenience, never the only way to get it.
- **No dependency, and no clipboard is ever read.** The copy uses whatever your system already has — `pbcopy`, `clip.exe` including under WSL, or `wl-copy`, `xclip`, or `xsel` — chosen by what is actually installed rather than by your platform's name. If none of them is there, or one of them fails, the installer says so in one line and still exits 0.

## Opening the project

The last question is whether to open the project, and it is only ever about an editor you already have. The installer looks for `code` (VS Code) and `cursor` (Cursor) on your `PATH`:

- **One found** — a yes/no naming it: `? Open this project in VS Code? [Y/n]`
- **Several found** — a numbered list, alphabetical, ending in `Don't open`
- **None found** — no question at all

Neither editor is a Pathfinder requirement, and the alphabetical order is not a recommendation. There is no way to name an editor or pass a path. The launch is detached: the installer hands over the project directory and exits immediately.

- **Nothing is launched without an explicit yes.** Declining, an unanswered question, `Don't open`, `--no-open`, `--yes`, `--dry-run`, and any run without a terminal on both ends all leave your screen alone.
- **A failed launch is not a failed install.** If the binary is there but cannot be run, the installer says so in one line, tells you the directory to open yourself, and still exits 0.

## Options

| Option | Effect |
| --- | --- |
| `--agents <ids>` | Generate skill adapters for these tools, comma-separated. Valid ids: `claude-code`, `codex`. Alias: `--agent` |
| `--dry-run` | Report what would be written, and any `git init` that would run first; change nothing |
| `--force` | Overwrite files that already exist, and replace a file you wrote at a path an adapter would occupy |
| `--git-init` | Run `git init` here if this is not a repository yet |
| `--no-git-init` | Never run `git init`; refuse instead |
| `--no-clipboard` | Never offer to copy the Kickstart prompt. The prompt is printed either way |
| `--no-open` | Never offer to open the project in an editor |
| `--yes`, `--no-input` | Take the defaults and ask nothing. It does not authorize `git init`, configure any tool, touch your clipboard, or open an editor — pass `--git-init` and `--agents` for the first two |
| `-h`, `--help` | Show usage |

### Environment

| Variable | Effect |
| --- | --- |
| `PATHFINDER_PROMPT=classic` | Ask every question as a numbered list and `y`/`n` rather than an arrow-key selector |
| `NO_COLOR` | Print no colour. It does not disable the selector |

**Both prompt styles are supported.** By default a terminal answers questions with `↑`/`↓`, `Space`, and `Enter`. `PATHFINDER_PROMPT=classic` asks for typed numbers and `y`/`n` instead — the right choice for a screen reader, for a script driving the installer's stdin, and for anyone who simply prefers it. A terminal narrower than 49 columns and `TERM=dumb` select it on their own, and `y`/`n` keep working at a Yes/No question either way.

Questions are asked only when stdin and stdout are both terminals. Piped, redirected, or in CI, nothing is asked and nothing is prompted for — so a directory that is not a repository needs `--git-init`, or the install is refused, no tool is configured without `--agents`, the clipboard is never touched at all, and no editor is ever launched.

## Requirements

Node 18 or newer, and a Git repository — though the installer will offer to create one for you.

The `git` binary is only needed to *create* that repository. Inside one that already exists, the installer finds it by walking the filesystem for `.git` and never runs Git at all, so it works on a machine where `git` is not on your `PATH`.

No dependencies — this package installs nothing into your project's `node_modules`, and has none of its own.

## Links

- [Documentation](https://pathfinder-kit.vercel.app)
- [Repository](https://github.com/rikilamadrid/pathfinder)
- [Why this is not a framework](https://github.com/rikilamadrid/pathfinder/blob/main/NOT_A_FRAMEWORK.md)
- [Changelog](https://github.com/rikilamadrid/pathfinder/blob/main/CHANGELOG.md)

MIT © Lamadrid Labs
