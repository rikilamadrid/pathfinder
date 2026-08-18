# Changelog

This changelog describes the reusable kit itself, not destination projects. A destination project still chooses its own versioning and release policy.

The kit follows Semantic Versioning:

- MAJOR — a skill is removed or renamed, or `context/` or the agent entry files change in a way that breaks an existing destination project
- MINOR — a new skill or workflow capability that existing projects can adopt without changes
- PATCH — clarifications, corrections, and documentation fixes

## What the version covers

The repository holds more than one shippable thing. The version number belongs to the kit — the part a destination project actually consumes:

- **Bumps the version** — `skills/`, `context/`, `templates/`, and the agent entry files (`AGENTS.md`, `CLAUDE.md`). Also the installer, whenever someone running it would see the difference: what it installs, what it asks, or how a run presents itself. A new installer capability is a MINOR; an installer fix or correction is a PATCH; installer refactoring that changes nothing observable is not a release at all.
- **Does not bump the version** — CI workflows, validation scripts, brand assets, the website, the README, and this repository's own planning files. They change how Pathfinder is built and presented, not what a destination project receives. A site-only change ships continuously and publishes nothing to npm.

*The installer rule above previously read "only when it changes the documented installation path". That test was written when the installer only ever copied files, and v1.6.0 is what found its edge: an installer release that rewrites how every run looks, while the command, the questions, and the installed files all stay exactly as documented. Read literally, the old wording said that was not a release at all. The test is now what a user would notice, which is the thing SemVer was always about.*

## The installer version mirrors the kit exactly

`create-pathfinder` publishes under the kit's version, so `npx create-pathfinder@1.2.1` installs the v1.2.1 kit and means what a reader expects. It has no independent product version.

The trade-off is accepted deliberately: a fix that touches only the installer still ships under a kit version number, which slightly overstates what changed. The alternative — two version lines for one product — costs every future reader more than it saves, and makes `npx create-pathfinder@<something>` ambiguous at the exact moment someone needs it to be clear.

The heading of the most recent released section below is the single source of truth for the release version. The Git tag and the installer's `package.json` are both derived from it; CI fails if they disagree. See the release checklist in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## [Unreleased]

### Added

- **Optional work tracking, configured in prose rather than code.** A new `setup-tracker` skill interviews you for which tracker you use, where it lives, how an agent reaches it, and which tags your project actually uses — then writes `context/tracker.md` from `templates/tracker.template.md` once you approve it. Two projections ship, both proven against real backends: GitHub Issues via the `gh` CLI, and local Markdown files under `.work/`. Any other tracker is supported by describing it in prose, which is the mechanism rather than a gap — it is why this adds no runtime, no dependency, and no credential handling to the kit.
- **`templates/tracker.template.md`** — one file carrying the backend-neutral work-item model once and both projections beneath it. The model is byte-identical whichever backend you pick, and the template marks its own boundaries so that claim is checkable in one place rather than asserted twice.
- **`sync-tracker` publishes your approved feature specs, and a second run writes nothing.** It reads `context/tracker.md`, publishes in dependency order with blockers first, and reports what it created, edited, and left alone. Re-running when nothing has changed issues **zero writes** — not writes that happen to be no-ops. Comparison is normalized rather than byte-for-byte, tag sets are compared as sets, and item bodies are composed as a pure function of the spec, because each of those is a way for sync to look like it works while rewriting every item forever.
- **Work tracking happens during normal work, not as a stage to remember.** `to-specs` offers to publish once specs are written, `load-feature` names the tracked item, and `complete-feature` reconciles it after the merge. `start-feature` deliberately publishes nothing: a delivery chunk is internal, and finishing one is not an event the outside world needs. Each is one conditional line that does nothing at all without a config.
- **An approval boundary for writes that leave your repository**, in `context/ai-interaction.md` alongside commits and releases. Publishing to a shared tracker asks first; writing local files under `.work/` does not, because it reaches nothing outside your repository.

### Notes

- **Work tracking is off unless you ask for it, and the off switch is the absence of a file.** No `context/tracker.md` ships, nothing prompts you for one, and no existing skill behaves differently without it. A project that never runs `/setup-tracker` sees no change of any kind from this release.
- **Configuring a tracker publishes nothing.** `setup-tracker` writes a config and stops; it never contacts a tracker. Publishing is `sync-tracker`, and it asks before the first write that leaves your repository.
- **Sync is one-way, and the repository stays canonical.** Nothing reads tracker state back into a spec, `context/current-feature.md`, or `context/history.md`. A ticked checkbox on a published item means nothing to Pathfinder, and items are matched by key rather than title, so renaming one on the tracker breaks nothing.

## [1.7.0] - 2026-08-16

### Added

- **Every question the installer asks is answerable with the arrow keys.** `↑`/`↓` (or `k`/`j`) move, `Space` toggles a checkbox, `Enter` confirms, and `Escape` cancels. The harness question becomes a checkbox list that names the directory each tool writes to, and a Yes/No question becomes two rows rather than a letter to type — `y` and `n` still work and are deliberately not advertised.
- **`PATHFINDER_PROMPT=classic` asks the old way, on purpose.** The numbered/`y n` prompts are a supported path rather than a fallback, and are byte-identical to 1.6.0. They are the first-class answer for a screen reader, for which a repainting block re-announces itself on every keypress and a highlight carried by position conveys nothing. Documented in `--help`, not only here.
- **`theme.line.up(n)`** — one new escape primitive, cursor-up, joining the two the theme already exposed. There is still no cursor hiding anywhere in the package, which is why an interrupted run cannot leave a terminal with an invisible cursor.

### Changed

- **Keyboard selection is offered only where it can be drawn correctly.** It needs a terminal on both ends, `TERM` that is not `dumb`, an input that can be put into raw mode, and at least **49 columns** — the measured width below which the interaction hint or the path context would be cut mid-word. Anything narrower asks the classic way. The capability is deliberately independent of colour and Unicode: `NO_COLOR` is a statement about decoration, not about repainting.
- **`(detected)` is shown only when the whole row fits**, and omitted rather than truncated when it does not. The ENVIRONMENT block has already reported detection, so the suffix duplicates information rather than carrying it — which is why it does not get to raise the width floor. Deciding that needs a real width: the installer now measures what a terminal will *draw* rather than what `.length` counts, so a decorated string is no longer measured as longer than it looks and a wide glyph no longer as narrower. A repainting list depends on it — a line believed to be one row that wraps to two puts every cursor-up afterwards off by one.
- **The harness question's alignment moved out of `cli.mjs`.** The call site now supplies a label, the path it writes to, and whether it was detected, and the renderer decides where each goes. It previously measured its labels with `.length` and padded them by hand, which is wrong about a terminal by the length of any escape sequence and produced a layout only one of the two prompt styles could use.

### Fixed

- **`prompt.mjs` no longer claims "No setRawMode".** `node:readline` enables raw mode itself the moment its input is a terminal. What is true, and is what the interrupt guarantee actually rests on, is that readline owns raw mode and Pathfinder never touches it — the selector borrows readline's `keypress` and `resize` listeners and gives both back.

## [1.6.0] - 2026-08-14

### Added

- **`create-pathfinder` looks and sounds like Pathfinder.** In a terminal, a run now opens with the Pathfinder mark drawn from `assets/logo.svg` — four strokes tapering upward, in blaze orange `#E0611F` — beside a letterspaced wordmark, the version, and a tagline. The run is then divided into named phases with a gutter down the left of each: `ENVIRONMENT`, `INSTALLING`, and `SUMMARY`. It ends on a completion state that repeats the mark as a bookend and signs off, replacing an ending that used to be a subordinate clause about whichever editor had just launched.
- **A determinate progress bar during the install.** The denominator is the number of units in the file-copy and adapter plans, both of which are computed in full before a single byte is written; the numerator is units that actually completed. Nothing is estimated, no percentage is synthesised, and there is no timer anywhere in the package — the bar advances on completion events alone, so an install that finishes in one tick shows a full bar in one tick and moves on. A failed write leaves the bar visibly short rather than rounding up to a clean 100%.
- **The brand colour renders at whatever depth the terminal advertises.** A terminal claiming truecolor (`COLORTERM`, or a `-direct` `TERM`) gets `#E0611F` exactly; one claiming 256 colours gets index 166, the nearest cell of the colour cube; anything else gets the one warm accent the eight ANSI values offer. With colour off, the mark's shape carries the identity on its own. Colour depth affects that one colour and nothing else — every severity stays on the eight ANSI values, and no depth can change what a run prints.
- **Warnings are told apart from successes at a glance.** Skipped files, adapter conflicts, and orphan adapters each render at the `warn` level with their own glyph and a leading category word — `Skipped`, `Conflict`, `Orphan` — so the hierarchy survives with colour disabled, in ASCII, and for a colour-blind reader. Adapters already up to date and `--force` overwrites are reported without being raised to warnings.

### Changed

- **Diagnostic paths are printed plain and stay pasteable.** The file lists under a skipped, conflict, or orphan warning carry no glyph, no colour, no gutter, no truncation, and no wrapping, so selecting them and pasting them into an issue yields paths a maintainer can act on unedited.
- **The installer's terminal output is now a presentation, and its non-interactive output is not.** Piped, redirected, and `NO_COLOR` runs are byte-identical to what `1.5.1` produced for every pre-existing scenario, verified by running this build beside the published `create-pathfinder@1.5.1` and comparing captured bytes. The decorated rendering and the byte-compatible one live side by side in the source for that reason. A terminal that reports no Unicode still gets the full structure in ASCII.
- **`--help` is unchanged.** It stays plain reference output with no identity block, because it is read mid-task and piped to a pager.
- **`AGENTS.md` no longer names a "launcher".** The fallback invocation line is unchanged; it just stops referring to a file a fresh install has never had. `prompts/` was retired in v1.5.0.
- **`create-pathfinder`'s `homepage` is the documentation site** rather than the GitHub README anchor, and its README is scoped to CLI and package usage. Both reach npmjs.com on the next publish.

### Fixed

- **`create-pathfinder` now writes ASCII punctuation on terminals that asked for ASCII.** Seven strings printed an em dash or an ellipsis regardless of what the terminal could render, bypassing the fallback that already governed the tick and cross marks. A UTF-8 terminal sees exactly what it saw in 1.5.1; a terminal with a non-UTF-8 locale — `LANG=C`, and a Windows console that is neither Windows Terminal nor VS Code — now reads `Next step - give your agent this prompt:`, `Something else...`, `Not copied - …`, `Not opened - …`, `X is supported - …`, and `Re-run with --force to replace it/them - …` instead of mojibake. The tool-selection list's arrows shift two columns in ASCII mode to follow the widened `Something else...` row.

## [1.5.1] - 2026-08-13

### Changed

- **`context/coding-standards.md` says where verification evidence has to come from.** A new `Verification Evidence` section: exercise the artifact a user receives the way a user exercises it, because a hand-written sample of generated output or the working tree in place of the published build is evidence about the stand-in; observe that the right thing happened when a mechanism can fail by doing nothing, since a clean exit says only that the command ran; be suspicious of a check whose every input it supplied itself; and record an unobserved criterion as unobserved rather than as passed. Drawn from two real failures in this repository's own history, not from principle.
- **`complete-feature` records the outcome while completing the feature, not afterwards** — and when a feature was merged without the skill running, it still writes the entry and says that the entry came later. A history written from memory weeks on is a different artifact from one written at the boundary, and the difference should be visible to whoever reads it.
- **`complete-feature`'s delivery step now covers what happens after the merge:** verify the merged mainline and clean up the merged branch, as the project's own workflow requires. Both were already habit in practice and absent from the skill.

## [1.5.0] - 2026-08-13

### Added

- **The Kickstart prompt now matches the tool you configured, and the installer offers to copy it.** Configure Claude Code and the printed next step is `/kickstart-pathfinder`; configure Codex and it is `$kickstart-pathfinder`. Configure both, or neither, and it stays the harness-neutral `Use skills/kickstart-pathfinder/SKILL.md …` line, because one clipboard cannot serve two syntaxes and choosing between your tools is not the installer's call.
- **Nothing reaches your clipboard without an explicit yes.** In a terminal the installer asks — with the question saying that it replaces what is on the clipboard now — and declining, not answering, `--no-clipboard`, `--yes`, `--dry-run`, and any run without a terminal on both ends all leave it untouched. The prompt is printed either way, so copying is a convenience and never the only channel. The copy uses whatever the system already has (`pbcopy`, `clip.exe` including under WSL, or `wl-copy`/`xclip`/`xsel`), selected by what is installed rather than by the platform's name, and adds no dependency. No clipboard is ever read. If no tool is available, or one fails or hangs, the installer says so in one line and still exits 0 — a convenience may not fail an install.
- **New installer flag: `--no-clipboard`**, which suppresses the offer without suppressing the prompt.
- **The installer offers to open your project, and only in an editor you already have.** After the clipboard question, a terminal run asks about the editors it found on your `PATH` — `code` for VS Code, `cursor` for Cursor. One found is a `[Y/n]` naming it; several are a numbered list ending in `Don't open`; none is no question at all. Neither editor is privileged, and the list is alphabetical so its order claims nothing. The launch is detached, so the installer exits immediately and the editor's output is never printed as Pathfinder's.
- **Opening an editor cannot cost you an install.** Declining, not answering, `Don't open`, `--no-open`, `--yes`, `--dry-run`, and any run without a terminal on both ends all launch nothing, and a launch that fails reports one line and still exits 0.
- **New installer flag: `--no-open`**, which suppresses the editor offer. It is independent of `--no-clipboard`.
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

Non-interactive output is otherwise unchanged from `1.4.1`: installing into a repository, `--dry-run` and `--force` in a repository, the note printed in a subdirectory of a repository, and installing with no `git` binary on `PATH` are all byte-identical. There are five deliberate differences, and these are all of them — the refusal line above, and the four below.

- **`--dry-run` in a directory that is not a repository now reports the `git init` it would run instead of refusing**, and asks nothing. The mode performs nothing either way, so the question would only have authorized an action that was never coming, and the refusal withheld the plan the flag exists to print. It still refuses when `git` is missing or `--no-git-init` was passed, because both are walls the real run would hit. **This is the one difference a script can observe as an exit code: that command exited `1` in `1.4.1` and exits `0` now.** Every other difference is wording on a stream, at an unchanged exit code.
- **A directory that is not a repository *and* has no `git` on `PATH` now gets different advice.** `1.4.1` printed the standard refusal and told the reader to run `git init` themselves — which could not work, because the binary was missing. That case now says so and links the download instead. This replaces the refusal text rather than extending it, so it is not "the 1.4.1 message plus a line"; the exit code is still `1`.
- **A re-run that writes nothing now ends with the Kickstart prompt too.** It used to stop at `The kit is already installed here.` with no next step. Both lines are printed now, because a second run is how someone configures a harness they skipped the first time, or comes back for the invocation they have forgotten. The exit code is unchanged, and this is the only scenario whose non-interactive output gained lines rather than changing them.
- **`--help` gained the new flags and a paragraph on the no-terminal behavior.** The same usage text is printed to stderr beneath an unknown or contradictory flag, so those exit-2 errors changed wording too. The leading `create-pathfinder: unknown option ...` line and the exit code are unchanged.
- **The documented install path matches the tool again.** The README quickstart no longer runs `git init` before `npx create-pathfinder`, and the claim that the installer "refuses to run outside a Git repository" is replaced by what it now does — explain, offer, and write nothing if you decline. A new subsection covers what the installer detects and how harnesses are chosen, and states that adapters are generated artifacts and never copy-list entries. The installer's npm page gains a generated-adapters row, the ownership rule, and the upgrade contract in full: re-running in a project that already has Pathfinder is safe, requires no flags, and is idempotent.
- **`CONTRIBUTING.md` and `NOT_A_FRAMEWORK.md` distinguish the kit from the repository that maintains it.** The kit is still Markdown only and a destination project still installs nothing and runs nothing; the repository holds the installer, its tests, the validation script, the adapter generator, and the site. The release checklist's final verification now covers adapter generation and an idempotent re-run.

### Fixed

- **`context/project-overview.md` and `templates/project-overview.template.md` separate decision state from record status.** The four decision states (`TBD`, `None`, `N/A`, `Deferred`) say whether a decision has been made; a new `Record Status` block declares what the tables' `Status` column already used in the decision log — `proposed`, `accepted`, `superseded` — and states that a recorded proposal is not an approved decision. The technology table's `Choice` column was headed `Approved choice` above a line saying approved choices belong there, which left no legal way to record a choice an agent had written down but the human had not yet approved. Both files now say a row may be recorded as `proposed` and stays that way until it is `accepted`. No fifth decision state, and no change to any skill.

### Removed

- **`prompts/` and its twenty manual launchers.** A fresh install now copies five entries instead of six. Every launcher was a wrapper that delegated by path to `skills/<name>/SKILL.md`, and their stated purpose — a fallback for tools that cannot discover local skills — was never what they did: a tool too weak to find a local skill is not helped by a second local file telling it to open the first one. With native discovery now shipping for Claude Code and Codex, a skill is invoked natively where that works, and everywhere else by one documented line — `Use skills/<name>/SKILL.md and follow it exactly.` — which is what the generated adapters delegate to anyway.
- **An existing project keeps its `prompts/` directory.** This is a MINOR change, not MAJOR: the installer only ever writes, so re-running it over a 1.4.x project leaves those files byte-for-byte intact, including under `--force`, and they keep working because they point at `skills/`, which still ships. The contract narrows for new installs; nothing breaks for existing ones. There is no migration command, no cleanup step, and no deprecation shim — Pathfinder does not delete your files.
- **The `check_prompts()` validation rule**, replaced rather than dropped. It enforced that every skill has some way to be invoked; that invariant now lives in `adapter-no-orphans`, which requires every canonical skill to have its expected generated adapter, and the validator records the inheritance where the rule is defined.

### Validation

- **A new `help-text` rule keeps `--help` honest.** Every flag the argument parser accepts, and every harness id in the registry, must appear in the help output — which the rule captures by running `--help` rather than by reading the source constant. Four consecutive features added flags; each documented its own correctly, and the rule exists for the fifth.
- **`copy-list-readme` no longer passes vacuously.** It matched a copy-list entry as the first segment of any deeper path, so deleting the `templates/` row from the README's install table still satisfied it — `templates/CHANGELOG.template.md` further down the section was enough. It now matches an entry as itself.

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
