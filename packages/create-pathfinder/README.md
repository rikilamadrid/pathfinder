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

Pathfinder is a kit of context files and skills — not a framework. There is no runtime, no dependency, and nothing to build. The installer copies six things into your repository and nothing else:

| Path | What it is |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Entry files that tell an agent how to work in the project |
| `context/` | Project truth — overview, standards, interaction rules, current feature |
| `skills/` | Twenty skills covering discovery, specs, delivery, debugging, review, and learning |
| `prompts/` | Manual launchers for tools that do not discover local skills |
| `templates/` | Starting points the project copies when it needs them |

It never copies Pathfinder's own `README.md`, `CHANGELOG.md`, CI configuration, or brand assets. Your repository gets the workflow, not the project that maintains it.

## What it will not do to your repository

This runs once, in real code, so it is deliberately timid:

- **It never overwrites.** Files that already exist are left exactly as they are and listed by name in the summary. Pass `--force` if you actually want them replaced.
- **It will not install outside a Git repository**, so whatever it writes is reviewable and undoable. In an empty directory it offers to run `git init` for you — and that is the only Git command it will ever run. No `add`, no `commit`, no config, no branch. If you say no, nothing is written.
- **It never touches an existing history.** A directory that is already a repository, or inside one, is never asked about and never initialized.
- **`--dry-run` reports the same plan the real install would carry out**, including any `git init`, without writing anything.

Re-running it is safe, and fills in only what is missing.

## Options

| Option | Effect |
| --- | --- |
| `--dry-run` | Report what would be written, and any `git init` that would run first; change nothing |
| `--force` | Overwrite files that already exist |
| `--git-init` | Run `git init` here if this is not a repository yet |
| `--no-git-init` | Never run `git init`; refuse instead |
| `--yes`, `--no-input` | Take the defaults and ask nothing. It does not authorize `git init` — pass `--git-init` for that |
| `-h`, `--help` | Show usage |

Questions are asked only when stdin and stdout are both terminals. Piped, redirected, or in CI, nothing is asked and nothing is prompted for — so a directory that is not a repository needs `--git-init`, or the install is refused.

## Requirements

Node 18 or newer, and Git. A repository too, though the installer will offer to create one. No dependencies — this package installs nothing into your project's `node_modules`, and has none of its own.

## Links

- [Repository and full documentation](https://github.com/rikilamadrid/pathfinder)
- [Why this is not a framework](https://github.com/rikilamadrid/pathfinder/blob/main/NOT_A_FRAMEWORK.md)
- [Changelog](https://github.com/rikilamadrid/pathfinder/blob/main/CHANGELOG.md)

MIT © Lamadrid Labs
