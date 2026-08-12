# Changelog

This changelog describes the reusable kit itself, not destination projects. A destination project still chooses its own versioning and release policy.

The kit follows Semantic Versioning:

- MAJOR — a skill is removed or renamed, or `context/` or the agent entry files change in a way that breaks an existing destination project
- MINOR — a new skill or workflow capability that existing projects can adopt without changes
- PATCH — clarifications, corrections, and documentation fixes

## What the version covers

The repository holds more than one shippable thing. The version number belongs to the kit — the part a destination project actually consumes:

- **Bumps the version** — `skills/`, `context/`, `templates/`, and the agent entry files (`AGENTS.md`, `CLAUDE.md`). Also the installer, but only when it changes the documented installation path; an installer bug fix that leaves the path unchanged is a PATCH, and installer refactoring that changes nothing observable is not a release at all.
- **Does not bump the version** — CI workflows, validation scripts, brand assets, the website, the README, and this repository's own planning files. They change how Pathfinder is built and presented, not what a destination project receives. A site-only change ships continuously and publishes nothing to npm.

## The installer version mirrors the kit exactly

`create-pathfinder` publishes under the kit's version, so `npx create-pathfinder@1.2.1` installs the v1.2.1 kit and means what a reader expects. It has no independent product version.

The trade-off is accepted deliberately: a fix that touches only the installer still ships under a kit version number, which slightly overstates what changed. The alternative — two version lines for one product — costs every future reader more than it saves, and makes `npx create-pathfinder@<something>` ambiguous at the exact moment someone needs it to be clear.

The heading of the most recent released section below is the single source of truth for the release version. The Git tag and the installer's `package.json` are both derived from it; CI fails if they disagree. See the release checklist in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## [Unreleased]

### Added

- **Native skill discovery for Claude Code and Codex, generated on request.** `create-pathfinder --agents claude-code,codex` writes a small adapter for every Pathfinder skill at `.claude/skills/<name>/SKILL.md`, at `.agents/skills/<name>/SKILL.md`, or at both, so they appear as native skills instead of a path you paste. In a terminal you are asked instead, with detected tools offered as the default; nothing is configured unless you choose it, and a non-interactive run configures nothing without `--agents`.
- **One harness, both, or neither — and each is isolated from the other.** The two adapter sets are byte-identical apart from their directory, and choosing one never generates, removes, or claims ownership of anything under the other's. Pathfinder writes only inside your project: a personal skills directory such as `$HOME/.agents/skills` is never touched.
- **An honest answer for a tool Pathfinder cannot configure.** The question in a terminal is a numbered multi-select — each harness shown with the directory it writes to, `Enter` for the detected default, `0` for none — and its last entry is `Something else…`, which shows `nothing is generated` in the same column. Name your tool and the summary says plainly that there is no native integration for it, then names the two things that do work: `AGENTS.md` at the repository root, which Codex, Cursor, and several other tools read, and the line the adapters delegate to anyway — `Use skills/<name>/SKILL.md and follow it exactly.` Naming a tool that *is* supported points you at the real option instead of recording a duplicate. No `.mdc` files, no directory invented for a tool that would not read it.
- **Adapters are generated files Pathfinder owns, and ownership is decidable.** A file at an adapter path belongs to Pathfinder only if its name is a Pathfinder skill *and* it carries the `pathfinder:adapter` marker the installer wrote. Those are regenerated with no flag, which is how an existing project gains adapters by re-running the installer. A file you wrote at one of those paths is left alone and named in the summary; `--force` is the only thing that replaces it. Settings files, agents, commands, hooks, and skills of your own are never read and never written, and nothing is ever deleted — an adapter for a skill this version no longer ships is reported and left in place.
- **Adapters carry metadata, never behavior.** Each is rendered from the canonical skill's frontmatter alone, so editing a skill body produces byte-identical adapters and two consecutive runs leave an identical tree. `--dry-run` reports every adapter it would write and writes none.
- **The canonical/adapter invariant is written down.** `CLAUDE.md` and `AGENTS.md` now state it, so it travels with the kit: skills under `skills/` are the only behavior contract, and anything under `.claude/skills/` or `.agents/skills/` is a generated pointer to one. Edit the canonical file; regenerate the adapter.
- **`create-pathfinder` offers to initialize Git instead of refusing.** In a directory that is not a repository, the installer now explains why version control is required and asks; on approval it runs `git init` — and only `git init`, in the current directory, never in a parent — then installs. Declining writes nothing and exits 1, the same contract as before.
- **`create-pathfinder` reports what it detected before it does anything.** Git repository presence, `git` on `PATH`, whether Pathfinder is already installed, and which supported tools are available. Findings set defaults and nothing else; the tools line says `(noted, not configured)` because that is the whole of it. The report is printed only to a terminal, so piped and redirected output is unchanged.
- **New installer flags: `--git-init`, `--no-git-init`, and `--yes` (alias `--no-input`).** `--yes` silences questions and takes defaults but does not authorize `git init`, which needs saying out loud. Contradicting `--git-init` with `--no-git-init` exits 2.
- **`node --test` covers the installer**, with a `test` script and a CI step. Standard library only; the package still has no dependencies, and `test/` is not published.

### Changed

- **Questions are asked only when stdin and stdout are both terminals.** Piped, redirected, or in CI, the installer asks nothing and prints no prompt, and a directory that is not a repository needs `--git-init` or the install is refused — the 1.4.1 refusal text, plus one line naming the flag.

Non-interactive output is otherwise unchanged from `1.4.1`: installing into a repository, `--dry-run` and `--force` in a repository, the note printed in a subdirectory of a repository, and installing with no `git` binary on `PATH` are all byte-identical. There are four deliberate differences, and these are all of them — the refusal line above, and the three below.

- **`--dry-run` in a directory that is not a repository now reports the `git init` it would run instead of refusing**, and asks nothing. The mode performs nothing either way, so the question would only have authorized an action that was never coming, and the refusal withheld the plan the flag exists to print. It still refuses when `git` is missing or `--no-git-init` was passed, because both are walls the real run would hit. **This is the one difference a script can observe as an exit code: that command exited `1` in `1.4.1` and exits `0` now.** Every other difference is wording on a stream, at an unchanged exit code.
- **A directory that is not a repository *and* has no `git` on `PATH` now gets different advice.** `1.4.1` printed the standard refusal and told the reader to run `git init` themselves — which could not work, because the binary was missing. That case now says so and links the download instead. This replaces the refusal text rather than extending it, so it is not "the 1.4.1 message plus a line"; the exit code is still `1`.
- **`--help` gained the new flags and a paragraph on the no-terminal behavior.** The same usage text is printed to stderr beneath an unknown or contradictory flag, so those exit-2 errors changed wording too. The leading `create-pathfinder: unknown option ...` line and the exit code are unchanged.

### Fixed

- **`context/project-overview.md` and `templates/project-overview.template.md` separate decision state from record status.** The four decision states (`TBD`, `None`, `N/A`, `Deferred`) say whether a decision has been made; a new `Record Status` block declares what the tables' `Status` column already used in the decision log — `proposed`, `accepted`, `superseded` — and states that a recorded proposal is not an approved decision. The technology table's `Choice` column was headed `Approved choice` above a line saying approved choices belong there, which left no legal way to record a choice an agent had written down but the human had not yet approved. Both files now say a row may be recorded as `proposed` and stays that way until it is `accepted`. No fifth decision state, and no change to any skill.

### Removed

- **`prompts/` and its twenty manual launchers.** A fresh install now copies five entries instead of six. Every launcher was a wrapper that delegated by path to `skills/<name>/SKILL.md`, and their stated purpose — a fallback for tools that cannot discover local skills — was never what they did: a tool too weak to find a local skill is not helped by a second local file telling it to open the first one. With native discovery now shipping for Claude Code and Codex, a skill is invoked natively where that works, and everywhere else by one documented line — `Use skills/<name>/SKILL.md and follow it exactly.` — which is what the generated adapters delegate to anyway.
- **An existing project keeps its `prompts/` directory.** This is a MINOR change, not MAJOR: the installer only ever writes, so re-running it over a 1.4.x project leaves those files byte-for-byte intact, including under `--force`, and they keep working because they point at `skills/`, which still ships. The contract narrows for new installs; nothing breaks for existing ones. There is no migration command, no cleanup step, and no deprecation shim — Pathfinder does not delete your files.
- **The `check_prompts()` validation rule**, replaced rather than dropped. It enforced that every skill has some way to be invoked; that invariant now lives in `adapter-no-orphans`, which requires every canonical skill to have its expected generated adapter, and the validator records the inheritance where the rule is defined.

## [1.4.1] - 2026-08-12

### Fixed

- **`skills/reverse-engineer/SKILL.md` fences its report template.** The `# Reverse-Engineering Report` block and its sections were live markdown, so the file read as though it contained a report rather than describing the one to produce. Wording unchanged; only the fence is new.
- **`skills/reflect/SKILL.md` uses one H1.** The `Part 1`, `Part 2`, `Promotion rules`, `Output`, and `Principles` dividers were H1s with H2s beneath them, which every other skill avoids. Each heading from the `Part 1` divider onward drops one level. No prose changed.
- **`context/project-overview.md` and `templates/project-overview.template.md` are titled `Project Overview`**, with the project's name captured as a `Project:` field in the Status block instead of standing in for the document's own title. The old `# [Project Name] — Project Overview` left a placeholder as the heading of a file that is read far more often than it is filled in.
- **`context/features/example-feature-spec.md` says what it is.** It is titled `Example Feature Spec` and names `templates/feature-spec.template.md` as the stencil to copy, rather than opening on a bare `# [Feature Name]` placeholder identical to the template. `skills/to-specs/SKILL.md` now points at that template by path instead of at "the example template".

## [1.4.0] - 2026-08-11

### Added

- **`debug-issue` skill** and its manual launcher, `prompts/15-debug-issue.md`, for diagnosing an observed failure — a failing test, runtime error, regression, incorrect output, or environment-specific behavior — rather than editing until the symptom disappears. It establishes expected versus actual behavior and reproduction status first, tests a small ranked set of hypotheses against discriminating evidence, applies the smallest justified fix, and verifies against the original failure. It has explicit stop conditions: when the evidence runs out, the reproduction is too unstable, or the fix would need an unapproved architectural, dependency, security, or destructive change, it reports what has been ruled out instead of thrashing. A new skill, so this is a MINOR release when cut.
- README documents where debugging sits relative to the delivery loop, and the boundary between `debug-issue`, `start-feature`, `review-feature`, and `learn-codebase`. `CLAUDE.md`'s skills list and the site sidebar grouping in `site/src/nav.mjs` both include it; the skill count in the README, the installer README, and `CONTRIBUTING.md` moves from nineteen to twenty.

## [1.3.0] - 2026-08-11

### Added

- **`npx create-pathfinder`.** The kit installs with one command instead of cloning to a sibling directory and running a `cp -R` with brace expansion. The installer has no dependencies, never overwrites — files that already exist are left alone and listed by name, with `--force` to replace them and `--dry-run` to see the plan first — and refuses to run outside a Git repository so that everything it writes is reviewable. It reads the real kit directories rather than embedding a second copy of them.
- `LICENSE` (MIT). The kit exists to be copied into other repositories, but default copyright granted no permission to do so.
- `CONTRIBUTING.md`, `SECURITY.md`, and `CODE_OF_CONDUCT.md`, documenting the branch/PR/squash convention, the SemVer policy above, the bar for adding a skill, and how to report a security concern privately.
- A documented release process in `CONTRIBUTING.md`, covering the kit and the installer together, with the irreversible steps marked as such.
- `.github/workflows/validate.yml` and `.github/scripts/validate-kit.py`, a dependency-free structural check of skill frontmatter, skill/launcher coverage, the `CLAUDE.md` skills list, changelog-to-tag agreement, copy-list agreement, and version agreement. Runs on every pull request and can be run locally with `python3 .github/scripts/validate-kit.py`.
- `.github/scripts/set-release-version.py`, which derives the installer's version from this changelog so the number is never typed twice.
- README `Contributing` and `License` sections.

### Changed

- **The documented installation path is now `npx create-pathfinder`**, replacing the clone-and-copy instructions. This is what makes the release a MINOR rather than a PATCH.
- The versioning policy in this file's header now states what the version covers, and that `create-pathfinder` mirrors the kit version exactly rather than carrying an independent one.
- What a destination project receives is now stated once, in `packages/create-pathfinder/copy-list.json`, and validated against the README and the published package. Previously the `cp -R` line in the README was the only source of truth, and adding a seventh top-level directory would have silently failed to ship it.
- README restructured so the first screen carries the logo, a positioning line, badges, a link row, and a `What this is, and what it is not` section, with the quickstart immediately after. The file tree moved below the workflow and into a collapsed block. Every governing rule is retained; the reverse-engineering rules that appeared in both `External reference analysis` and `Reverse-engineering rule` are now stated once, in the latter. No documentation was moved out of the README — there is no site to move it to yet.

### Fixed

- `CLAUDE.md` listed only 14 of 19 skills. The five mentoring skills added in `606afeb` — `teach-feature`, `teach-architecture`, `quiz-me`, `challenge-me`, and `learning-review` — were never added to the `Available skills` list, so agents in destination projects were not told they existed. Caught by the new validation script on its first run.

Aside from the `CLAUDE.md` correction above, no change to `skills/`, `context/`, `prompts/`, or `templates/`. The kit content a destination project receives is unchanged; how it gets there is what moved.

## [1.2.1] - 2026-08-10

### Fixed

- Malformed YAML frontmatter in `skills/reverse-engineer/SKILL.md`, which prevented the skill from being discovered. The block opened with a blank line and closed with a dashed rule instead of `---`. Skill content is unchanged.

## [1.2.0] - 2026-08-10

### Added

- Bounded self-evaluation in `reflect`. After reflecting on the work, the skill makes one pass over the reflection itself and may propose changes to `skills/reflect/SKILL.md` under the same evidence standard it applies to Pathfinder. The recursion stops after that pass, `No Reflect improvement proposed.` is the expected result, and self-improvements still require human approval.
- Evidence levels for reflection findings: incident, pattern, and validation.
- A validation requirement on every proposed improvement, so a change can later be shown to have helped.

### Changed

- `reflect` output returns only sections that carry meaningful information rather than filling the template, and adds `Reflect self-evaluation` and `Reflect improvement candidates` sections.
- README workflow reflection loop documents the single bounded self-evaluation pass and its promotion rule. `CLAUDE.md` and the `reflect` launcher prompt updated to match.

### Fixed

- Malformed YAML frontmatter in `skills/reflect/SKILL.md`, which prevented the skill from being discovered.

## [1.1.0] - 2026-08-10

### Added

- `reflect` skill and matching manual launcher prompt for reviewing completed work, separating project-specific knowledge from reusable workflow lessons, and proposing evidence-based Pathfinder improvements that a human approves before they are adopted.

### Changed

- README documents a workflow reflection loop covering when reflection is worth its cost, the boundary between project knowledge and reusable Pathfinder lessons, and the rule that reflection proposes while humans promote. `CLAUDE.md` skill list updated to include `reflect`.
- This changelog adopts Semantic Versioning, and the previously unreleased kit is recorded as `1.0.0`.

## [1.0.0] - 2026-07-28

### Added

- `reverse-engineer` skill and matching manual launcher prompt for analyzing external references (products, interfaces, repositories, workflows) into an evidence-based reconstruction blueprint, separate from project discovery and implementation.
- Prototype validation workflow and skill.
- Feature lifecycle skills for load, start, review, and completion.
- Feature-scoped and codebase-wide interactive learning skills.
- Mentoring skills: `teach-feature`, `quiz-me`, `challenge-me`, `teach-architecture`, and `learning-review`, with matching manual launcher prompts.
- `context/learning/` learner profile, lesson history, and progress log.
- Lesson and progress-entry templates.
- Context boundaries, stable delivery chunks, and learning targets in feature specs.
- Project-selected technology, architecture, Git, CI/CD, versioning, release, environment, and learning decisions.
- Blank destination-project changelog template.

### Changed

- README documents the external reference analysis loop, its handoffs to other skills, and the boundary between `reverse-engineer`, `learn-codebase`, `kickstart-pathfinder`, `prototype`, and `to-specs`. `CLAUDE.md` skill list updated to include `reverse-engineer`.
- README learning loop expanded into a Learning & Mentoring loop describing how the new skills complement `learn-feature` and `learn-codebase`.
- Debate workflow now recommends a stack, architecture, delivery process, and prototype approach for human selection.
- Core guidance no longer assumes a UI framework, language, package manager, `main` branch, feature branches, conventional commits, or SemVer for destination projects.
- README now documents discovery, prototype, delivery, and learning loops.
