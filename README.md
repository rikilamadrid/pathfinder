<div align="center">

<img src="assets/logo-wordmark.png" alt="Pathfinder" width="357">

**A reusable workflow kit for directing AI agents through software delivery, while keeping judgment and consequential decisions human.**

[![npm](https://img.shields.io/npm/v/create-pathfinder?color=E0611F&label=create-pathfinder)](https://www.npmjs.com/package/create-pathfinder) [![validate](https://github.com/rikilamadrid/pathfinder/actions/workflows/validate.yml/badge.svg)](https://github.com/rikilamadrid/pathfinder/actions/workflows/validate.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-E0611F)](LICENSE)

[Website](https://pathfinder-kit.vercel.app/) ·
[Changelog](./CHANGELOG.md) ·
[Releases](https://github.com/rikilamadrid/pathfinder/releases) ·
[Contributing](./CONTRIBUTING.md)

<sub>by Lamadrid Labs</sub>

</div>

Pathfinder is a small, portable kit of context files and skills you copy into a project. It gives an AI agent a process for discovering, challenging, analyzing references, prototyping, specifying, building, reviewing, completing, learning from, and reflecting on the work — and it keeps every consequential decision with you.

It is intentionally stack-agnostic. It does not choose React, Python, mobile, a database, Git Flow, or any other implementation detail for you.

> The kit owns the workflow. The project owns the stack.

## What this is, and what it is not

**It is** a workflow and context kit: a set of skills with defined boundaries, a `context/` folder that holds project truth, and native skill discovery in the tools that support it. It is for someone who wants an agent to move fast on delivery while product, architecture, and Git decisions stay explicitly theirs — and who wants to understand the result afterward, not just receive it.

**It is not** a framework. There is no required runtime, package manager, framework, database, hosting platform, or Git model, and there is no dependency to install. The destination project chooses its own technology, architecture, delivery process, and learning output format. See [`NOT_A_FRAMEWORK.md`](NOT_A_FRAMEWORK.md).

It is also not an autopilot. Recommendations are proposals, not silent decisions — see [Human approval](https://pathfinder-kit.vercel.app/concepts/human-approval/).

## Start a new project

<!-- copy-list:start -->
<!-- CI checks that this section names every entry in
     packages/create-pathfinder/copy-list.json, the canonical list. Keep the
     markers when rewriting the install instructions; without them the check
     passes vacuously. -->

```bash
mkdir my-project
cd my-project
npx create-pathfinder
```

That copies the kit into the repository. Nothing is installed into your project, nothing is built, and no dependency is added — the installer is a file copier that exits.

It writes exactly six things:

| Path | What it is |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Entry files that tell an agent how to work in the project |
| `context/` | Project truth — overview, standards, interaction rules, current feature |
| `roles/` | Declarative contracts a session follows when you name one — planner, developer, tester |
| `skills/` | Skills covering discovery, specs, delivery, debugging, review, learning, and optional work tracking |
| `templates/` | Starting points the project copies when it needs them |

It never overwrites. Files you already have are left alone and listed by name; pass `--force` if you actually want them replaced, or `--dry-run` to see the plan without writing. It installs only into a Git repository, so whatever it writes is reviewable and undoable — in a directory that is not one yet, it explains why and offers to run `git init` for you. Decline and nothing is written.

This kit's own `CHANGELOG.md` is deliberately not copied; it is the history of Pathfinder itself. Use `templates/CHANGELOG.template.md` if the destination project chooses a changelog.

<!-- copy-list:end -->

Then run:

```text
Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project. Do not install packages or write product code yet.
```

That starts the discovery conversation. From there the loop is: debate the direction, prototype the risky part, convert the approved direction into small features, then build them one at a time.

### Native to your tools

**One workflow. Native to your tools.** Before it writes anything, the installer reports what it found: whether this is a Git repository, whether `git` is on your `PATH`, whether Pathfinder is already installed, and which supported coding tools are available. Findings set the defaults for the questions and nothing else.

The question that follows is which tools to configure. Claude Code and Codex discover skills natively, so the installer can generate a small adapter per skill — `.claude/skills/<name>/SKILL.md`, `.agents/skills/<name>/SKILL.md`, or both — and Pathfinder's skills appear in that tool's own list. In a terminal you are asked, with the detected tools as the default; without one, `--agents claude-code,codex` says it explicitly. Nothing is configured unless you choose it, and choosing one tool never touches the other's directory.

**Adapters are generated artifacts, not copy-list entries.** The six paths in the table above are the kit; adapters are derived from `skills/` at install time, regenerated on every run without `--force`, and never added to `copy-list.json`. Each carries a skill's name and description and delegates to the canonical file — so the behavior contract stays in exactly one place, whichever tool you are in.

## Adapt an existing repo

Run `npx create-pathfinder` in the existing repository, then run `kickstart-pathfinder`. It should inspect the repository lightly, preserve established conventions, and distinguish repository facts from decisions still requiring human input.

Nothing you already have is overwritten, so this is safe to run in a repository with its own `CLAUDE.md` or `context/` — the installer reports what it skipped and leaves it untouched.

Existing `.claude/` and `.agents/` configuration is preserved the same way. The ownership rule is one sentence: the installer owns a file at an adapter path only if the name is a Pathfinder skill *and* the file carries the `pathfinder:adapter` marker it wrote. Everything else there — your `settings.json`, agents, commands, hooks, and any skill of your own — is never read and never written, a file you wrote at an adapter path is left alone and named in the summary, and nothing is ever deleted. Re-running an older install is how it gains adapters: no flag, no migration step.

Use `learn-codebase` when deeper understanding, onboarding, teaching, or architectural explanation of the existing repository is needed.

Do not use `reverse-engineer` to analyze the repository Pathfinder is currently operating inside. That responsibility belongs to `kickstart-pathfinder`, `learn-codebase`, or the relevant feature skill.

## The complete workflow

### Discovery and validation

```text
idea
→ kickstart discovery
→ debate and recommendations
→ human chooses or changes stack/workflow
→ prototype the riskiest or most important assumption
→ review and iterate
→ approve direction
→ finalize project context
```

A prototype is optional. `debate-me` recommends whether the project needs an experience prototype, technical proof of concept, architecture diagram, or no prototype at all. An unapproved prototype must not quietly become production code.

### Delivery loop

```text
project context
→ to-specs
→ load feature
→ start feature
→ review feature
→ complete feature
→ history
```

Features are intentionally sized for reliable delivery inside a focused LLM context window. They should be small, independently verifiable, and explicit about what the agent should and should not load. See [Context boundaries](https://pathfinder-kit.vercel.app/concepts/context-boundaries/).

When something is observably broken, the loop pauses and `debug-issue` runs instead of the agent guessing its way forward. It reproduces before repairing, tests hypotheses rather than editing at random, and reports rather than thrashing when the evidence runs out. See [When something breaks](https://pathfinder-kit.vercel.app/guides/workflow/#when-something-breaks).

### The other three loops

Three more loops sit alongside these two:

* [External reference analysis](https://pathfinder-kit.vercel.app/guides/workflow/#external-reference-analysis) — analyze an existing product, interface, or repository into an evidence-based reconstruction blueprint before deciding anything.
* [Learning and mentoring](https://pathfinder-kit.vercel.app/guides/workflow/#learning-and-mentoring-loop) — teach, quiz, and challenge the human owner on what the AI helped build.
* [Workflow reflection](https://pathfinder-kit.vercel.app/guides/workflow/#workflow-reflection-loop) — the other loops improve the project; this one improves the workflow. Reflect proposes, humans promote.

[The workflow guide](https://pathfinder-kit.vercel.app/guides/workflow/) draws all five loops in full, with every human decision point marked.

## Invoking a skill

`skills/` contains durable, reusable behavior, and each skill is a single canonical file: `skills/<name>/SKILL.md`. There is one behavior contract per skill and one way to reach it.

In a harness with native skill discovery — Claude Code and Codex today — the installer generates a small adapter per skill, so Pathfinder's skills appear in that tool's own skill list and you invoke them the way you invoke any other. Nothing to paste.

In any other tool, give the agent one line:

```text
Use skills/<name>/SKILL.md and follow it exactly.
```

That is the whole fallback. It is an invocation form, not a file to generate or a directory to install — and it is exactly what the generated adapters delegate to, so both paths end at the same canonical file. Filled in, it reads:

```text
Use skills/kickstart-pathfinder/SKILL.md to initialize this project.
```

The same shape works for any skill, and it is worth stating the boundary in the invocation:

```text
Use skills/reverse-engineer/SKILL.md to analyze this reference. Clearly separate observations, inferences, possible implementation choices, and unknowns.
```

```text
Use skills/reflect/SKILL.md to review this completed work. Propose improvements; do not change Pathfinder.
```

## What's in the kit

Six entries get copied into a destination project: `AGENTS.md` and `CLAUDE.md` (agent entry points), `context/` (project truth), `roles/` (what a worker is responsible for), `skills/` (durable behavior), and `templates/`.

The kit installs only the context files it needs on day one — `ai-interaction.md` and `coding-standards.md`. The rest of `context/` is written by the workflow that first needs it, so a fresh install carries no blank copies to delete.

Those generated files split two ways for version control. **Durable project truth is tracked**: `context/project-overview.md`, `context/features/`, `context/history.md`, and `context/tracker.md` answer *what is true about this project* and belong in every diff. **Transient session state is ignored**: `context/current-feature.md` and `context/handoff.md` answer *what was I doing*, belong to one session on one machine, and are two lines in `.gitignore`:

```gitignore
context/current-feature.md
context/handoff.md
```

Do not ignore `context/` wholesale — that quietly untracks the project truth every later session reads. `context/coding-standards.md` carries the rule in full.

A project installed before v1.5.0 also has a `prompts/` directory, which the installer leaves untouched and which keeps working, since those launchers point at `skills/`.

<details>
<summary>Full layout</summary>

```text
.
├── AGENTS.md
├── CLAUDE.md
├── CHANGELOG.md                  # history of this kit only
├── NOT_A_FRAMEWORK.md
├── context/
│   ├── ai-interaction.md
│   └── coding-standards.md
├── roles/
│   ├── developer.md
│   ├── planner.md
│   └── tester.md
├── skills/
│   ├── kickstart-pathfinder/
│   ├── debate-me/
│   ├── reverse-engineer/
│   ├── prototype/
│   ├── to-specs/
│   ├── load-feature/
│   ├── start-feature/
│   ├── debug-issue/
│   ├── review-feature/
│   ├── complete-feature/
│   ├── learn-feature/
│   ├── learn-codebase/
│   ├── teach-feature/
│   ├── quiz-me/
│   ├── challenge-me/
│   ├── teach-architecture/
│   ├── learning-review/
│   ├── reflect/
│   ├── handoff/
│   ├── role/
│   ├── whereami/
│   ├── skillsmith/
│   ├── setup-tracker/
│   └── sync-tracker/
└── templates/
    ├── CHANGELOG.template.md
    ├── feature-spec.template.md
    ├── history.template.md
    ├── lesson.template.md
    └── project-overview.template.md
```

</details>

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the branch, pull request, and versioning conventions, and for the bar a new skill has to clear. Conduct expectations are in [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md); report security concerns privately per [`SECURITY.md`](SECURITY.md).

## License

MIT — see [`LICENSE`](LICENSE).

Copy the kit into your own project freely. The kit is licensed; what you build with it is yours.
