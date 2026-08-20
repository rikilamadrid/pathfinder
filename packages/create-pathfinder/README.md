![Pathfinder](https://raw.githubusercontent.com/rikilamadrid/pathfinder/main/assets/logo-wordmark.png)

**A reusable workflow kit for directing AI agents through software delivery,
while keeping judgment and consequential decisions human.**

This package copies [Pathfinder](https://pathfinder-kit.vercel.app) into a Git
repository.

```bash
npx create-pathfinder
```

Pathfinder is a scaffolding CLI you run when setting up or updating a project.
It is not a runtime dependency and adds nothing to your application's
`node_modules`.

Then start Pathfinder.

Claude Code:

```text
/kickstart-pathfinder
```

Codex:

```text
$kickstart-pathfinder
```

Any other coding agent:

```text
Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project.
Do not install packages or write product code yet.
```

For the workflow itself, roles, skills, and guides, see
[pathfinder-kit.vercel.app](https://pathfinder-kit.vercel.app).

Everything below documents the installer.

## Run it

```bash
npx create-pathfinder
```

That is the intended invocation.

You can also use:

```bash
npm exec create-pathfinder
```

or install the CLI globally:

```bash
npm i -g create-pathfinder
create-pathfinder
```

Do not use:

```bash
npm i create-pathfinder
```

for normal Pathfinder setup.

That installs the CLI as a dependency in your project's `package.json` and
`node_modules`; it does not run the scaffolding process.

## What it installs

The installer copies six kit entries into your repository:

| Path | What it is |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Entry files that tell supported agents how to work in the project |
| `context/` | Project standards and interaction rules; other context is created only when needed |
| `roles/` | Three optional responsibility contracts: planner, developer, tester |
| `skills/` | Reusable procedures for discovery, specs, delivery, debugging, review, learning, and optional work tracking |
| `templates/` | Minimal starting shapes; records are created from them later, when a workflow needs one |

A fresh Pathfinder 2.0 project begins with only:

```text
context/
├── ai-interaction.md
└── coding-standards.md
```

Other context files are created lazily by the workflow that needs them.

Pathfinder does not copy its own repository `README.md`, `CHANGELOG.md`, CI
configuration, or brand assets. Your project gets the workflow kit, not the
repository that maintains it.

### Generated tool adapters

If you choose native tool integration, the installer also generates adapters:

| Path | What it is |
| --- | --- |
| `.claude/skills/` | Generated Claude Code skill adapters |
| `.agents/skills/` | Generated Codex skill adapters |

These are derived from the canonical files under `skills/`; they are not a
second copy of the behavior.

## What it will not do to your repository

The installer is deliberately conservative.

### It never silently overwrites

Files that already exist are left exactly as they are and listed in the
summary.

Use:

```bash
npx create-pathfinder --force
```

only when you want files that already exist overwritten — any copied file,
whoever created or edited it — and a file you wrote at a path an adapter
would occupy replaced.

### It requires a Git repository

Pathfinder installs into version control so its changes are reviewable and
undoable.

If the current directory is not a Git repository, an interactive run can offer
to initialize one.

If you decline, nothing is installed.

The installer does not run:

```text
git add
git commit
git push
git config
```

and it does not create or switch branches.

### It does not alter existing history

If the current directory is already a repository, or is inside one, Pathfinder
uses it as-is.

It does not reinitialize it.

### Dry runs are actually dry

```bash
npx create-pathfinder --dry-run
```

shows the same installation plan without writing files, initializing Git,
changing the clipboard, or opening an editor.

### It only owns Pathfinder-generated adapters

An adapter at:

```text
.claude/skills/<name>/SKILL.md
.agents/skills/<name>/SKILL.md
```

belongs to Pathfinder only when:

1. `<name>` is a Pathfinder skill, and
2. the file contains the `pathfinder:adapter` marker Pathfinder generated.

Your own:

```text
settings.json
settings.local.json
agents
commands
hooks
skills
```

are not Pathfinder-owned.

A file you created at a would-be adapter path is left alone and reported.

Pathfinder does not delete unrelated tool configuration.

## Re-running Pathfinder

Re-running:

```bash
npx create-pathfinder
```

in a project that already uses Pathfinder is supported.

Without `--force`:

- canonical files you already have are preserved
- new Pathfinder files can be added
- Pathfinder-owned adapters are regenerated
- unchanged adapters remain byte-identical
- unrelated files remain untouched

This is also how older Pathfinder projects gain newer generated adapters:
re-run the installer rather than using a separate migration command.

## Native skills for your coding tool

Pathfinder's canonical skills live at:

```text
skills/<name>/SKILL.md
```

Claude Code and Codex can discover skills from their own directories, so the
installer can generate small adapters for them.

Non-interactively:

```bash
npx create-pathfinder --agents claude-code,codex
```

Supported ids:

| Id | Generated path | Example invocation |
| --- | --- | --- |
| `claude-code` | `.claude/skills/<name>/SKILL.md` | `/reflect` |
| `codex` | `.agents/skills/<name>/SKILL.md` | `$reflect` |

Each adapter carries the skill's name and description and delegates to:

```text
skills/<name>/SKILL.md
```

The behavior remains canonical in one place.

You may configure one tool, both, or neither.

Choosing one never configures the other.

Pathfinder also never writes to personal/global skill directories such as:

```text
~/.claude/skills/
~/.agents/skills/
```

### Interactive selection

In an interactive terminal, the installer asks which supported tools to
configure.

Detected tools influence the default selection only. Detection does not
authorize writes by itself.

`Enter` accepts the tools found on your machine, and selecting none is always
available. Each option shows the directory it writes to before you choose it.
Under `PATHFINDER_PROMPT=classic` the same question is a numbered list answered
comma-separated, with `0` for none.

A third entry, **Something else…**, generates nothing and says so: the kit still
installs `AGENTS.md` at the repository root, which Codex, Cursor, and several
others read, and any agent can be given the line the adapters delegate to —
`Use skills/<name>/SKILL.md and follow it exactly.`

Without an interactive terminal, no tool adapters are generated unless
`--agents` is provided explicitly.

An unknown agent id exits 2 rather than quietly installing nothing.

## The Kickstart prompt

Every successful install prints the prompt that starts Pathfinder.

| Configured tool | Prompt |
| --- | --- |
| Claude Code | `/kickstart-pathfinder` |
| Codex | `$kickstart-pathfinder` |
| both or neither | `Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project. Do not install packages or write product code yet.` |

The prompt is always printed.

Copying it to the clipboard is optional.

## Clipboard behavior

In an interactive terminal, Pathfinder can ask:

```text
? Copy that prompt to your clipboard? This replaces what is on it now.

❯ Yes
  No

  ↑↓ move   enter confirm
```

Nothing is copied without an explicit yes.

The clipboard is left untouched when:

- you choose No
- the question is unanswered
- `--no-clipboard` is used
- `--yes` is used
- `--dry-run` is used
- the run is non-interactive

Pathfinder never reads the clipboard.

When copying is requested, it uses an existing system utility such as:

```text
pbcopy
clip.exe
wl-copy
xclip
xsel
```

If no supported clipboard command is available, or copying fails, installation
still succeeds and the prompt remains visible in the terminal.

## Opening the project

The final interactive question can offer to open the installed project in an
editor already available on the machine.

Supported editor commands are:

```text
code
cursor
```

If one is detected, Pathfinder can ask:

```text
? Open this project in VS Code?
```

If several are available, it offers a choice.

If none are available, no editor question is shown.

Nothing is launched without an explicit selection.

The project is not opened when:

- you decline
- the question is unanswered
- you choose `Don't open`
- `--no-open` is used
- `--yes` is used
- `--dry-run` is used
- the run is non-interactive

A failed editor launch does not turn a successful installation into a failed
one. Pathfinder reports the project directory so you can open it yourself.

## Options

| Option | Effect |
| --- | --- |
| `--agents <ids>` | Generate adapters for comma-separated supported tools. Valid ids: `claude-code`, `codex`. Alias: `--agent` |
| `--dry-run` | Show what would happen without changing anything |
| `--force` | Overwrite files that already exist, and replace a file you wrote at a path an adapter would occupy. Off by default |
| `--git-init` | Initialize Git if the current directory is not already in a repository |
| `--no-git-init` | Never initialize Git; refuse installation instead |
| `--no-clipboard` | Never offer to copy the Kickstart prompt |
| `--no-open` | Never offer to launch an editor |
| `--yes`, `--no-input` | Ask nothing and use non-destructive defaults |
| `-h`, `--help` | Show usage |

`--yes` does **not** authorize Git initialization, tool configuration,
clipboard writes, or editor launches.

For scripted setup, specify the actions you actually want, for example:

```bash
npx create-pathfinder \
  --yes \
  --git-init \
  --agents claude-code
```

## Prompt styles

By default, interactive terminals use an arrow-key selector.

Set:

```bash
PATHFINDER_PROMPT=classic npx create-pathfinder
```

to use numbered choices and `y` / `n` prompts instead.

| Variable | Effect |
| --- | --- |
| `PATHFINDER_PROMPT=classic` | Use classic typed prompts instead of the interactive selector |
| `NO_COLOR` | Disable terminal color; does not change prompt style |

Classic mode is useful for:

- screen readers
- scripts driving terminal input
- users who prefer typed choices

A terminal narrower than 49 columns and `TERM=dumb` select the classic
presentation on their own. Either way, `y` and `n` answer a Yes/No question in
one keystroke; under `PATHFINDER_PROMPT=classic` it is asked as `[Y/n]` on one
line.

Questions are asked only when both stdin and stdout are terminals.

In CI, redirected, or piped execution:

- no interactive questions are shown
- Git initialization requires `--git-init`
- adapters require `--agents`
- the clipboard is untouched
- no editor is launched

## Requirements

- Node.js 18 or newer
- a Git repository, or permission to initialize one

The `git` executable is required only when Pathfinder needs to run `git init`.

Inside an existing repository, Pathfinder identifies the repository from the
filesystem and does not need to run Git commands.

The package has no runtime dependencies and installs nothing into the
destination project's `node_modules`.

## After installation

Pathfinder itself is documented separately from the installer.

Start here:

- [Documentation](https://pathfinder-kit.vercel.app)
- [Getting started](https://pathfinder-kit.vercel.app/guides/getting-started/)
- [Workflow](https://pathfinder-kit.vercel.app/guides/workflow/)
- [Skills](https://pathfinder-kit.vercel.app/skills/)

Repository resources:

- [GitHub](https://github.com/rikilamadrid/pathfinder)
- [Changelog](https://github.com/rikilamadrid/pathfinder/blob/main/CHANGELOG.md)
- [Why Pathfinder is not a framework](https://github.com/rikilamadrid/pathfinder/blob/main/NOT_A_FRAMEWORK.md)

## License

MIT © Lamadrid Labs
