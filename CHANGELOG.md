# Changelog

This changelog describes the reusable kit itself, not destination projects. A destination project still chooses its own versioning and release policy.

The kit follows Semantic Versioning:

- MAJOR — a skill is removed or renamed, or `context/` or the agent entry files change in a way that breaks an existing destination project
- MINOR — a new skill or workflow capability that existing projects can adopt without changes
- PATCH — clarifications, corrections, and documentation fixes

## What the version covers

The repository holds more than one shippable thing. The version number belongs to the kit — the part a destination project actually consumes:

- **Bumps the version** — `skills/`, `context/`, `roles/`, `templates/`, and the agent entry files (`AGENTS.md`, `CLAUDE.md`). Also the installer, whenever someone running it would see the difference: what it installs, what it asks, or how a run presents itself. A new installer capability is a MINOR; an installer fix or correction is a PATCH; installer refactoring that changes nothing observable is not a release at all.
- **Does not bump the version** — CI workflows, validation scripts, brand assets, the website, the README, and this repository's own planning files. They change how Pathfinder is built and presented, not what a destination project receives. A site-only change ships continuously and publishes nothing to npm.

*The installer rule above previously read "only when it changes the documented installation path". That test was written when the installer only ever copied files, and v1.6.0 is what found its edge: an installer release that rewrites how every run looks, while the command, the questions, and the installed files all stay exactly as documented. Read literally, the old wording said that was not a release at all. The test is now what a user would notice, which is the thing SemVer was always about.*

## The installer version mirrors the kit exactly

`create-pathfinder` publishes under the kit's version, so `npx create-pathfinder@1.2.1` installs the v1.2.1 kit and means what a reader expects. It has no independent product version.

The trade-off is accepted deliberately: a fix that touches only the installer still ships under a kit version number, which slightly overstates what changed. The alternative — two version lines for one product — costs every future reader more than it saves, and makes `npx create-pathfinder@<something>` ambiguous at the exact moment someone needs it to be clear.

The heading of the most recent released section below is the single source of truth for the release version. The Git tag and the installer's `package.json` are both derived from it; CI fails if they disagree. See the release checklist in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## [Unreleased]

### Added

- **`to-tickets`, and tickets as the executable unit of work.** A Feature is the planning outcome; a ticket is what one fresh session implements, verifies, and hands back with the project still working. `/to-tickets` reads one approved Feature spec and creates its tickets in the configured store; in the default local-Markdown store those are `context/tickets/NN.TT-slug.md` files. Each ticket names its parent Feature, what to read, what to change, how to verify it, and — by key, never by file order — what blocks it. Blocker edges are checked to be acyclic before anything is written.
- **`templates/ticket.template.md`**, the stencil `to-tickets` writes from.
- **The ticket delivery loop.** `/ticket load|start|review|complete` executes one ticket per session. `load` resolves where tickets live, reads the ticket and its parent Feature, and refuses to proceed while any blocker is unfinished — naming it, and writing no status on the way out. `complete` finishes the ticket and then names the tickets that its completion just unblocked, leaving the choice of the next one to you. A Feature's status is now derived from its tickets rather than maintained by hand: the first ticket to reach `In Progress` moves the Feature there, and a Feature whose tickets are all terminal becomes `Complete`.

### Changed

- **The configured ticket store is canonical.** Tickets live in exactly one place, and local Markdown under `context/tickets/` is a store on the same footing as GitHub Issues, Jira, Linear, or Azure DevOps — not a mirror kept in step with one. `skills/ticket/store.md` is the single statement of how the store resolves (no `context/tracker.md` selects local Markdown, as the default rather than a fallback), how a ticket's `NN.TT` key is carried where tickets are not files, and that a Feature spec is never in the store. `to-tickets` creates tickets there; `load`, `start`, `review`, and `complete` read and write that same ticket; `complete` closes it where the store has a closed state. `setup-tracker` now chooses the store and says what the choice costs — changing it later is a deliberate human migration, and nothing moves tickets between stores automatically. `context/tickets/` therefore exists only in a local-Markdown project, which the agent entry files, README, and site now say.
- **`context/current-feature.md` is now `context/current-ticket.md`.** Same file, same transience, named for what the loop actually loads. Both paths stay on the installer's never-ships list, so an upgrade cannot drop a maintainer's copy over the one an older project already has.

### Removed

- **`sync-tracker`.** There is nothing left to synchronize. Tickets live in one place — the configured store — so no second copy exists to reconcile, and no `/ticket sync` replaces it. The `work-tracking` guide is now `ticket-stores`, and it describes choosing where tickets live rather than projecting them somewhere.
- **The `feature` delivery loop.** `/feature load|start|review|complete` and `skills/feature/actions/` are gone, replaced by `/ticket`. There is one delivery loop, and it runs on the unit that `to-tickets` produces.

- **Delivery Chunks are gone.** `## Delivery Chunks` is removed from `templates/feature-spec.template.md`, and every kit statement that a Feature is executed chunk by chunk now names the ticket instead — `CLAUDE.md`, `AGENTS.md`, `context/ai-interaction.md`, `to-specs`, `whereami`, and the delivery loop's own actions. There is one execution layer, not two. `to-specs` no longer offers chunks as an alternative to splitting a Feature: a coherent but large Feature stays one Feature, and `to-tickets` slices it.

## [3.1.0] - 2026-08-25

### Added

- **Pathfinder installs as a Claude Code plugin.** `/plugin marketplace add rikilamadrid/pathfinder` then `/plugin install pathfinder@lamadrid-labs` brings every Pathfinder command without copying a skill file anywhere. The repository *is* the plugin: `.claude-plugin/plugin.json` exposes the canonical `skills/` tree verbatim, so there is no generated copy of any skill body and no second behavior contract to keep honest — the same rule the harness adapters already live under, applied to a third discovery surface. Claude Code namespaces every plugin skill with no opt-out, so plugin commands are `/pathfinder:feature load`, `/pathfinder:role planner`, and so on. The bare `/feature` form still comes from an installed kit's adapter; a repository with both has both, running the same canonical body.
- **`kickstart-pathfinder` can lay the kit down for a plugin-only user.** The plugin distributes commands, not project state, so a repository reached through `/plugin install` has every command and none of the files those commands read. When the kit is missing and the skill was loaded from the plugin, it now offers to install the kit from the plugin's own copy — naming every file first, overwriting nothing without asking, deleting nothing, and generating no adapters. It reads what to copy from `copy-list.json` and what to exclude from the installer's `NEVER_SHIPS`, rather than restating either, so the bootstrap and `npx create-pathfinder` cannot drift apart. When the kit is already present it changes nothing and says so.

### Changed

- **The release number is written into a third file.** `set-release-version.py` now derives `.claude-plugin/plugin.json`'s version from the changelog alongside the installer's `package.json`, rewriting only the `version` line in each. `claude plugin update` hands users a new version only when that number changes, so a plugin left behind at the previous release is a release nobody receives.

## [3.0.0] - 2026-08-22

### Removed

- **`load-feature`, `start-feature`, `review-feature`, and `complete-feature` are gone as standalone skills.** This is a breaking change to the public surface: those four commands no longer exist, and there is no alias, deprecation stub, or second path to the same behavior. The behavior itself is unchanged — it moved, it was not redesigned.

### Added

- **One `feature` skill with four actions.** `/feature load`, `/feature start`, `/feature review`, and `/feature complete` replace the four commands. Four skills was four discovery surfaces for one loop that is always run in one order; the names already carried the shared noun, but nothing in a skill list could show that they belonged together, so a reader meeting them had to infer the sequence. `skills/feature/SKILL.md` dispatches and nothing more — it names the four actions, states the lifecycle they move a Feature through, and sends the session to one file under `skills/feature/actions/`. Invoked with no action it lists the four and stops, the way `role` does with no role name. `argument-hint: load|start|review|complete` puts the actions in front of the human at the moment they type the command.
- **`create-pathfinder --version`** prints the package version on one line and exits, with no identity block, no detection findings, and no colour. It is recognized before any other argument is interpreted, so it answers from outside a Git repository and from behind a misspelled flag or an invalid `--agents` value — a wrapper that appends `--version` to arguments it was handed still gets a version number. `-v` is the same flag.

### Changed

- **`start` records `Ready` → `In Progress`** in the Feature spec's `## Status`, before the first file edit of the first chunk. A Feature already `In Progress` is left alone, because continuing across sessions and chunks is normal; any other status stops the session rather than being promoted. This completes what `load` began in 2.1.0 — the spec now states what is actually happening to it at every stage.
- **`complete` treats its own invocation as acceptance.** The old step 1, "Confirm the Feature is accepted", is removed: the human running the action *is* the answer, and asking again was a question with only one possible reply. Acceptance of the Feature is still not approval of the delivery steps — every gate the project's documented workflow names is asked for exactly as before, and an undocumented or `TBD` Git policy still stops the session rather than being invented.
- **`review` writes no status,** now stated in the action rather than left to inference. Review is workflow activity, not lifecycle state, and a reviewed Feature stays `In Progress` until it is completed.
- **`context/ai-interaction.md` is the one place the lifecycle is defined.** `skills/feature/SKILL.md` restates `Proposed → Ready → In Progress → Complete` as a summary so a human reading the command can see which action writes which transition, and points back to the source. No summary adds a state or a transition of its own.
- **`/role` states its roles inline** through `argument-hint: planner|developer|tester`. The body is unchanged and no role file, name, or count changes.

### Notes

- **A destination project upgrading from 2.1.0 or earlier must relearn four commands.** Nothing in an existing project breaks on its own — Feature specs, `context/`, and history are untouched — but any habit, script, or note naming the old commands has to be updated, and running `npx create-pathfinder` does not delete the four old skill directories it previously installed. Remove `skills/{load,start,review,complete}-feature/` and their generated adapters by hand.
- The website publishes one page per top-level skill, so `/skills/feature/` documents the four actions and the four old URLs are gone. Each action's full procedure ships in the kit, under `skills/feature/actions/`, and is not published as its own page.

## [2.1.0] - 2026-08-22

### Changed

- **`load-feature` promotes the spec it loads.** Invoking the skill on a Feature *is* the approval to prepare it for execution, and until now that approval was recorded nowhere: the spec kept claiming `Proposed` while the work was already underway. `load-feature` now writes the spec's own `## Status` — `Proposed` becomes `Ready`, and that is the only value it ever writes. A spec already `Ready` or `In Progress` is left exactly as it is, because reloading mid-work is normal. A `Complete`, `Cancelled`, or `Superseded` spec blocks the load and stops; reopening terminal work stays the human's decision. The write happens after the readiness checks and before `context/current-feature.md`, so a blocked load never leaves a promoted spec behind.
- **`context/current-feature.md` records no status line.** It is transient workspace state belonging to one session on one machine, and the spec carries the durable lifecycle status — which `context/coding-standards.md` already required. The rule against rewriting a loaded spec is narrowed to what it always meant: Goal, Context, Requirements, Out of Scope, Delivery Chunks, and Acceptance Criteria are not touched, and `## Status` is the one field this skill maintains.

### Notes

- **A Feature loaded before upgrading needs nothing done to it.** A spec left at `Proposed` is promoted the next time it is loaded, and one already past `Proposed` is never rewritten, so no existing spec has to be corrected by hand.
- Skill frontmatter is unchanged, so no harness adapter needs regenerating.

## [2.0.0] - 2026-08-20

A simplification release. Pathfinder had been accumulating structure faster than it was earning it — role files that restated procedure, templates carrying sections nobody filled in, and a `context/` shipped full of blank stencils a reader had to recognise as empty before ignoring. This release removes that surface. The kit is smaller, and what remains is what a project actually uses.

**The shape of the change:** a fresh install is now 36 files instead of 43. `context/` ships two files instead of six. Templates go from six to five, roles from four to three, and the feature spec from sixteen sections to eight.

### Removed

- **`roles/qa.md` and `roles/human.md`.** `qa` is now `tester`, which does the same job under the name most projects already use. `human` is gone on purpose: human authority is not one contract among several that an agent might also read, and shipping a file describing it invited the exact misreading it was meant to prevent — that a session could name it and act with a human's authority. Approval and acceptance live in `context/ai-interaction.md` and nowhere else.
- **`templates/tracker.template.md`** — 370 lines of backend-neutral work-item model, item kinds, blocked-by edges, tag-mapping tables, chunk projections, and a marker specification. It asked every project to adopt a project-management taxonomy in order to use a feature most projects never turn on, and the great majority of it described trackers nobody had configured. `setup-tracker` now composes a config that fits the tracker you actually named.
- **`templates/progress-entry.template.md`**, and the blank `context/` stencils: `project-overview.md`, `history.md`, `current-feature.md`, `features/example-feature-spec.md`, and the three `context/learning/` placeholders.

### Changed

- **Files are created when a workflow first needs them, not scaffolded at install.** `context/` ships `ai-interaction.md` and `coding-standards.md`. Everything else — `project-overview.md`, `features/`, `history.md`, `current-feature.md`, `handoff.md`, `tracker.md` — is written by the skill that first needs it. Skills that read these files now treat absence as normal rather than as an error, and the skills that write them create what is missing.
- **Roles carry responsibility; skills carry procedure.** The three shipped roles state what a worker is responsible for, what it may read, and what ends its turn — and stop there. A role that starts explaining *first do X, then do Y* has become a skill, and CI now holds a 40-line ceiling to catch it.
- **The feature spec template is eight sections**: Status, Goal, Context, Requirements, Out of Scope, Delivery Chunks, Acceptance Criteria, Notes / Decisions. `Context Boundary` is now a three-line `## Context`. Dropped: Overview, Problem, Dependencies, Tags, Experience Notes, Technical Notes, Verification, Learning Targets, and Suggested Delivery Metadata.
- **Feature status is durable lifecycle state only**: `Proposed` → `Ready` → `In Progress` → `Complete`, with `Cancelled` and `Superseded` terminal. Review and testing are optional workflow activity, not a status — a Feature stays `In Progress` until it is complete.
- **`context/project-overview.md` records `TBD` and `None`.** The parallel `proposed` / `accepted` / `superseded` record-status vocabulary is gone: two vocabularies meant every row invited two questions, and the second was almost always answerable from the first.
- **A Feature spec is named `NN-feature-name.md`, and that number is the Feature's identity.** `to-specs` numbers each new spec with the next unused number in the spec source, and `27-export-saved-searches.md` is Feature 27 wherever the file sits. Numbers are never reused and never renumbered. The number lives in the filename and nowhere else — the eight-section template carries no number field, so there is no second place to keep in agreement. This is also what a published tracker item is matched on: with the 370-line tracker template gone, the key `sync-tracker` publishes under is read from the basename alone, never from the directory above it, the title inside it, or the order specs happen to be read. Moving or reorganising specs therefore orphans nothing, and a spec whose filename carries no number is skipped and reported by name rather than being assigned one.
- **Work tracking stays optional and got smaller with it.** `sync-tracker` no longer decomposes a Feature into assignable tickets, and infers no labels, tags, or status. The repository stays canonical, sync stays one-way, and a second run with no changes still writes nothing.

### Added

- **Roles: three declarative contracts that scope a session to one responsibility.** `roles/` ships `planner`, `developer`, and `tester`, each stating what a worker is responsible for, what it reads, what ends its turn, and what it must not do. They hold the constraints a skill cannot, because a skill cannot see what preceded it: `tester` forbids continuing into `start-feature` in the same session to repair what it just found. **Naming a role is the only thing that activates one**, so a project that never names one behaves exactly as it did in 1.8.0. They are plain Markdown carrying no `model`, `tools`, or `isolation`, which is why they need no adapter and work unchanged in any tool that can read a file. The copy list moves from five entries to six, its first addition since it was created.
- **`role`** — activate one named role for the current session, in one line.
- **`whereami`** — a read-only snapshot of the current session: role, Feature, chunk, Git state, and next action. It reads one file, reports `none` rather than inferring, and never offers to fix what it finds.
- **`templates/history.template.md`** — the compact completed-work record `complete-feature` appends to.
- **A version-control policy for `context/`.** Durable project truth is tracked (`project-overview.md`, `features/`, `history.md`, `tracker.md`); transient session state is ignored (`current-feature.md`, `handoff.md`). Two lines in `.gitignore` are the whole mechanism, and the documentation is explicit that ignoring `context/` wholesale is the mistake to avoid — it quietly untracks the file documenting your stack.
- **Work tracking can find your specs wherever you keep them.** `context/tracker.md` names the project's spec source, and `setup-tracker` asks for it only when it is not `context/features/`. A config that names none behaves exactly as it did in 1.8.0.

### Fixed

- **`context/tracker.md` can no longer be shipped by accident.** 1.8.0 said the file does not ship, and that was true only because none had ever existed in the kit repository — `context` is a *directory* entry in the copy list, so a config placed beneath it would have been copied into every new project, handing them a tracker they do not own with work tracking's off switch already defeated on first install. **No released version ever shipped one**; this closes the gap before it could open.
- **`context/current-feature.md` and `context/handoff.md` are covered by the same guard.** Having stopped shipping blank stencils, the risk inverts: a maintainer's *filled-in* copy reaching a new project, so somebody's first session opens on a note about whichever feature was loaded on release day. A `.gitignore` entry does not prevent this — the publish-staging script copies from the working tree and never consults Git — so the installer and the staging script both refuse to carry these files, and tests cover both paths.

### Upgrading

Nothing is deleted from a project that already has Pathfinder; re-running the installer adds what is missing and leaves your edits alone. Adopt at your own pace:

- If you named the `qa` role, name `tester` instead. If you relied on `roles/human.md`, the policy it pointed at is in `context/ai-interaction.md`.
- Feature specs written against the old template still read fine. New specs get the eight-section shape.
- If a spec sits in `In Review` or `Accepted`, move it to `In Progress` or `Complete`.
- Add the two transient `context/` files to `.gitignore`.
- If you configured work tracking, your `context/tracker.md` keeps working. The template it was written from no longer ships.
- Rename existing specs to `NN-feature-name.md` before your next `sync-tracker` run. **Preserve the numbers already published** — give each spec the number its tracker item carries today, rather than renumbering from one. A spec that reaches sync without a number in its filename is skipped and reported; a spec that reaches it under a *different* number publishes a second item beside the first. If you have never configured a tracker, rename at your leisure: nothing outside the repository depends on the numbers yet.

## [1.8.0] - 2026-08-18

### Added

- **Optional work tracking, configured in prose rather than code.** A new `setup-tracker` skill interviews you for which tracker you use, where it lives, how an agent reaches it, and which tags your project actually uses — then writes `context/tracker.md` from `templates/tracker.template.md` once you approve it. Two projections ship, both proven against real backends: GitHub Issues via the `gh` CLI, and local Markdown files under `.work/`. Any other tracker is supported by describing it in prose, which is the mechanism rather than a gap — it is why this adds no runtime, no dependency, and no credential handling to the kit.
- **`templates/tracker.template.md`** — one file carrying the backend-neutral work-item model once and both projections beneath it. The model is byte-identical whichever backend you pick, and the template marks its own boundaries so that claim is checkable in one place rather than asserted twice.
- **`sync-tracker` publishes your approved feature specs, and a second run writes nothing.** It reads `context/tracker.md`, publishes in dependency order with blockers first, and reports what it created, edited, and left alone. Re-running when nothing has changed issues **zero writes** — not writes that happen to be no-ops. Comparison is normalized rather than byte-for-byte, tag sets are compared as sets, and item bodies are composed as a pure function of the spec, because each of those is a way for sync to look like it works while rewriting every item forever.
- **Work tracking happens during normal work, not as a stage to remember.** `to-specs` offers to publish once specs are written, `load-feature` names the tracked item, and `complete-feature` reconciles it after the merge. `start-feature` deliberately publishes nothing: a delivery chunk is internal, and finishing one is not an event the outside world needs. Each is one conditional line that does nothing at all without a config.
- **An approval boundary for writes that leave your repository**, in `context/ai-interaction.md` alongside commits and releases. Publishing to a shared tracker asks first; writing local files under `.work/` does not, because it reaches nothing outside your repository.
- **An optional `## Tags` section in `templates/feature-spec.template.md`**, which is the only place a published item's tags come from. Tags are never inferred from a title or a path, a spec without the section publishes untagged, and that is the expected case — the section is meaningful only once a tracker is configured, and nothing else in Pathfinder reads it.

### Notes

- **Work tracking is off unless you ask for it, and the off switch is the absence of a file.** No `context/tracker.md` ships, nothing prompts you for one, and no existing skill behaves differently without it. A project that never runs `/setup-tracker` sees no change of any kind from this release.
- **Configuring a tracker publishes nothing.** `setup-tracker` writes a config and stops; it never contacts a tracker. Publishing is `sync-tracker`, and it asks before the first write that leaves your repository.
- **Sync is one-way, and the repository stays canonical.** Nothing reads tracker state back into a spec, `context/current-feature.md`, or `context/history.md`. A ticked checkbox on a published item means nothing to Pathfinder, and items are matched by key rather than title, so renaming one on the tracker breaks nothing.
- **Nothing here is something an existing project has to adopt.** Upgrading does not require configuring a tracker, and it does not require adding `## Tags` to any feature spec — existing specs stay valid exactly as written, and specs written after the upgrade only get a tags section if a tracker config defines namespaces to fill it. The whole of work tracking is opt-in, and staying opted out is a supported way to use Pathfinder rather than a deferral.

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
