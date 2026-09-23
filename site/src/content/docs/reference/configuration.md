---
title: Configuration
description: Every setting Pathfinder reads, its valid values, its default, and the file or flag it lives in.
---

Pathfinder has no settings screen. Its configuration is a handful of Markdown
markers in `context/`, the flags of one installer, and two environment
variables. This page lists all of them in one place; each row links to the page
that explains the choice.

## Files in `context/`

A marker is an HTML comment on its own line. Pathfinder reads the marker; the
rest of the file is for people.

| Setting | Lives in | Values | Default |
| --- | --- | --- | --- |
| Execution mode | `execution-mode.md` | `human-in-the-loop`, `orchestrator` | `human-in-the-loop` |
| Routing policy | `execution-mode.md` | `static` — the only policy the kit ships | `static` |
| Ticket store | `tracker.md` | `github-issues owner/repo`; other stores through `/setup-tracker` | Absent — local Markdown under `context/tickets/` |
| Current ticket | `current-ticket.md` | A ticket id, for example `47.1` | Absent between tickets |
| Handoff | `handoff.md` | Free text written by `/handoff` | Absent |

The first three are project truth and tracked in Git. `current-ticket.md` and
`handoff.md` are session state and ignored — see [Ignore rules](#ignore-rules).

Each marker, as written:

```html
<!-- pathfinder:execution-mode orchestrator -->
<!-- pathfinder:routing-policy static -->
<!-- pathfinder:ticket-store github-issues owner/repo -->
<!-- pathfinder:ticket 47.1 -->
```

An `execution-mode.md` with any other value, or none, is invalid: the ticket
lifecycle says so once and proceeds human-in-the-loop, and orchestration
refuses to run. The routing-policy marker is read only in orchestrator mode.

See [Execution modes](/guides/execution-modes/) for what the two modes change,
and [Ticket stores](/guides/ticket-stores/) for what choosing a store commits
you to.

### Ignore rules

Two context files and one directory are session state, not project truth.
`context/coding-standards.md` carries the rule; the installer writes it.

```text
context/current-ticket.md
context/handoff.md
/.pathfinder/
```

Do not ignore `context/` wholesale. That would hide the project truth future
sessions need.

## Installer flags

`npx create-pathfinder` copies the kit into the current Git repository. These
are its options, as `--help` prints them.

| Flag | Effect | Default |
| --- | --- | --- |
| `--mode <mode>` | Record the execution mode in `context/execution-mode.md`. Re-run with it to change the mode. | Interactive runs ask once; scripted runs record nothing, which means `human-in-the-loop` |
| `--agents <ids>` | Generate skill adapters for these tools, comma-separated. Valid ids: `claude-code`, `codex`. Alias `--agent`. | Nothing is configured unless you are asked and say so |
| `--dry-run` | Report what would be written, and any `git init` that would run; change nothing and ask nothing. | Off |
| `--force` | Overwrite files that already exist, and replace a file you wrote at a path an adapter would occupy. | Off — a file Pathfinder did not generate is never replaced |
| `--git-init` | Run `git init` here if this is not a repository yet. | Off — without a terminal, a non-repository is refused |
| `--no-git-init` | Never run `git init`; refuse instead. | — |
| `--no-clipboard` | Never offer to copy the Kickstart prompt. The prompt is printed either way. | Offered in a terminal |
| `--no-open` | Never offer to open the project in an editor. | Offered in a terminal |
| `--yes` | Take the defaults and ask nothing. Alias `--no-input`. Does **not** authorize `git init` or configure any tool. | Off |
| `-h`, `--help` | Show the help. | — |
| `-v`, `--version` | Print the version and exit, whatever else you passed. | — |

Adapters are generated files Pathfinder owns and regenerates without `--force`.
Without a terminal on both stdin and stdout, nothing is ever asked, and neither
your clipboard nor an editor is touched.

## Environment variables

| Variable | Effect |
| --- | --- |
| `PATHFINDER_PROMPT=classic` | Ask every question as a numbered list and y/n instead of an arrow-key selector. Use it for screen readers, for scripts, or if you prefer typing. A terminal narrower than 49 columns or `TERM=dumb` selects it on its own. |
| `NO_COLOR` | Print no colour. It does not disable the selector. |

## What is not configurable

Pathfinder does not have settings for the things it deliberately leaves to the
project: stack, package manager, database, hosting, Git model, branch naming, or
release process. Those are recorded as decisions in
`context/project-overview.md` by the workflow that first needs them, and a `TBD`
there means a human decision is still required. See
[Decision states](/concepts/decision-states/).
