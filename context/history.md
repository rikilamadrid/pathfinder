# Project History

Compact record of completed work.

## Completed

### 2026-09-12 — Feature 51: Semantic Diagram Artifacts

- Outcome: Pathfinder turns semantic topology into an interrogable technical diagram without the producer ever placing a box. A second artifact kind, `diagram`, joins `lesson` in the Feature 50 renderer through the same engine, shell and theme; one topology, `graph`, with closed vocabularies for node role and edge relation, and an unknown value refused rather than drawn with a default. The producer owns what exists, what relates to what, which things belong together, which ordered walks matter, and the evidence behind each claim. Geometry, ranking, axis, sizes, spacing, routing, label placement, typography, shape, colour and emphasis are the renderer's, and the specification has no field for any of them — validation rejects the attempt rather than ignoring it. `map-system` is the human entry point and the only skill that writes a diagram specification. Twenty-fourth skill in the kit.
- Delivered as six accepted tickets: 51.1 landed the tracer bullet and froze the box and text strategy; 51.2 froze the geometry contract against real human language; 51.3 landed the provenance and evidence contract; 51.4 made the diagram interrogable rather than merely viewable; 51.5 built the `map-system` producer and passed a live independent-discovery acceptance run; 51.6 produced the public specimen and reconciled the public surfaces.
- The architectural claim, and the evidence for it: a second kind consumes the Feature 50 contract with no second renderer stack and no second visual identity. Both kinds render into the same shell, a diagram's stylesheet defines not one colour of its own, and nothing below the registry knows which kind it is looking at. `RENDERER_VERSION` moved `0.1.0` → `0.5.0` across the Feature, always in the same commit as the rendering change that earned it. `lesson.schema.json` was never modified, and lesson output changed only where the renderer version reaches it.
- A diagram says where it came from, and the engine behaves differently for each answer. `derived` requires a source and cites every node, every edge, and every claim-bearing prose field, with `artifact.summary` forbidden so prose cannot escape the rules by moving to the top of the document. `proposed` with a source checks the citations supplied. `proposed` with no source refuses citations outright, reports the evidence layer as not run with its reason rather than as passed, and carries no verification sentence — the wording is renderer-owned and gated on an attestation minted from a passing validation, which no specification field can influence and no caller can forge.
- Determinism now covers layout: every emitted coordinate is an integer, ordering comes from the specification, crossing reduction runs a fixed pass count rather than testing a tolerance, and no clock, randomness, transcendental math, locale, viewport or text measurement participates. Interactions read the graph rather than the picture, so upstream and downstream follow the producer's directed edges instead of which boxes happen to sit nearby, and every fact is in the document before any script runs.
- Verification: `validate-kit.py` OK with 24 skills; render-artifact 786 tests in 102 suites; 634/634 installer tests; adapters current with no drift; the site builds 39 pages from the repository's tracked files. Eleven goldens are frozen, and the producer-contract harness is keyed by contract rather than by kind, so a third producer is an entry in its table rather than a new suite.
- The Feature's specimen maps Pathfinder's own visual-artifact pipeline: `derived` at `e0260ea`, 22 nodes, 31 edges, 5 groups, 4 paths, 4 views, 88 citations across 21 files, one digest across varied timezone, locale and working directory. A tester review of 51.6 found one medium and six low findings, every one of them prose reaching wider than the range cited beneath it — the defect the engine cannot catch, because it checks that a citation resolves and not that it supports. All seven were repaired. Two human gates passed separately and neither was offered as evidence for the other or for the deterministic results: perceptual review at desktop and narrow width in both themes, and an unfamiliar reader recovering the pipeline within roughly sixty seconds with no report and no prepared walkthrough.
- Delivery: PRs #84, #85, #86, #87, #88 and #89, each squash-merged. Feature 51 ends at `d20af41`. No version bump, npm publication, tag, or GitHub Release was performed; the capability sits under `[Unreleased]` at package version `4.2.0`.
- Follow-up: whether the accumulated `[Unreleased]` work warrants a `4.3.0` release is the next decision and is deliberately separate from Feature completion. The repository policy for generated output is still undecided — the specimen remains untracked, as Feature 50's two acceptance artifacts do. Three claims in the specimen rest on reference prose rather than on the schema files they describe, and could be re-pointed. `CONTRIBUTING.md` still says "22 skills" in a release-checklist comment, now 24 — pre-existing drift Feature 50 also left. The two smaller Feature 50 items stay open: citation-free specifications still reach the Git evidence probe outside a repository, and `validate-kit.py` cannot catch frontmatter YAML the site build rejects. One more, found while closing this Feature: the site loader turns every Markdown file in `context/` into a page, the gitignored ones included, so a page count taken from a maintainer's working copy overstates what the repository builds — Feature 50's entry records 42 for that reason.

### 2026-09-12 — Feature 50: The Shared Visual Artifact Renderer

- Outcome: Pathfinder skills that deliver a visual artifact no longer hand-author a page. A producer skill writes a small typed semantic specification — modules, concepts, flows, exercises, questions, and the evidence behind each claim — and `render-artifact` compiles it into one self-contained HTML file that opens from the filesystem with no build step, server, or network. The producer owns content and domain semantics; the renderer owns presentation, navigation, theming, and every other piece of interface language. `lesson` is the only artifact kind; an unsupported kind is refused rather than improvised. Twenty-third skill in the kit.
- Delivered as five accepted tickets: 50.1 landed the renderer, the four validation layers, and the first delivered artifact; 50.2 made the determinism guarantee executable in CI; 50.3 converted `learn-feature` to the shared contract; 50.4 converted `learn-codebase` and proved the contract generalizes; 50.5 reconciled the public surfaces.
- The architectural claim, and the evidence for it: two independent producers consume one contract with no consumer-specific field, branch, or escape hatch. `learn-feature` supplies one module and `learn-codebase` supplies seven, and nothing in the renderer asks which — there is no mode flag, no consumer identifier in rendering logic, and no count-dependent layout. Neither integration changed `skills/render-artifact/**`, and `RENDERER_VERSION` stayed `0.1.0` across both.
- Evidence is part of the contract rather than a convention: every claim cites a path and optional line range resolving against a commit the specification declares, never the working tree. Verified directly by clobbering a cited file in the working tree and watching validation still pass. A concept without evidence fails validation.
- Determinism is versioned: the same specification bytes and the same renderer version produce byte-identical HTML across working directories, timezones, and locales. The renderer version is part of that input, so an intentional output change is a release rather than a determinism failure.
- Verification: `validate-kit.py` OK with 23 skills; render-artifact 168 tests in 26 suites; 634/634 installer tests; adapters current with no drift; the site builds 42 pages; `npm pack --dry-run` shows the engine present and its tests absent; no manifest at the repository root. Four goldens are frozen — `example`, `fixture`, and the two producers' real output — and the producer-contract regressions fail against the pre-integration skills, so the retired instructions cannot return quietly.
- Two delivered artifacts received explicit human perceptual review in a real browser, at desktop and narrow widths, in both themes, each recorded separately from the deterministic validation result. Neither result was presented as evidence for the other. A tester review of 50.4 surfaced a test-infrastructure defect the second consumer exposed: the maintainer harness carried a partial hand-rolled copy of the engine's HTML escaping, which passed only because no earlier specimen used an apostrophe. The duplicated logic was replaced by the engine's own.
- Delivery: PRs #67, #68, #71, #72, #73, #74 and #76, each squash-merged. Feature 50 ends at `0a17f24`. No version bump, npm publication, tag, or GitHub Release was performed; the capability sits under `[Unreleased]` at package version `4.2.0`.
- Follow-up: Whether the accumulated `[Unreleased]` work warrants a `4.3.0` release is a separate, undecided question. The long-term repository policy for generated `learning/` output is undecided — both acceptance artifacts remain untracked, and no public surface states a policy. Semantic diagram artifacts are explicitly not implemented and remain a separately scoped future Feature. Two smaller known items stay open: citation-free specifications still reach the Git evidence probe outside a repository, and `validate-kit.py` cannot catch frontmatter YAML the site build rejects.

### 2026-09-01 — Feature 48: Pathfinder Session Orientation Hook

- Outcome: Claude Code destinations receive one inert, Pathfinder-owned `SessionStart` handler at `.claude/hooks/pathfinder-session-orientation.mjs`. It transports a bounded, read-only snapshot of Pathfinder state without interpreting it; `whereami` remains the workflow interpreter. Pathfinder writes no settings and activates nothing. Installer output and the documentation provide the exact native activation fragment, private and shared configuration choices, the no-orientation fallback, and the two-step human removal path.
- Delivered as two accepted tickets: 48.1 generated and ownership-protected the harness-specific handler without changing settings; 48.2 documented opt-in activation and verified the shipped behavior against live Claude Code sessions and hostile state fixtures.
- Verification: `validate-kit.py` passed with 22 skills; 634/634 installer tests; documentation built 40 pages; the captured installer transcript, extracted release notes, plugin validation, and 64-file npm package preview passed. Live evidence covered startup, resume, clear, and compact; the human accepted payload-level execution for fork after real `--fork-session` attempts emitted `resume`. Five repeated runs left Git, `.git` internals, and `context/` byte-identical.
- Delivery: PR #60 squash-merged as `dc3f1e0`. The guarded release workflow published `create-pathfinder@4.2.0`, confirmed the registry `gitHead`, then created tag `v4.2.0` and the GitHub Release. Outside-in verification confirmed npm `latest`, the public release, an idempotent registry-backed install with 22 adapters and one inert handler, no settings files, and a plugin inventory of 22 skills with zero agents, hooks, MCP servers, or LSP servers.
- Follow-up: None required. Orientation remains optional and outside Pathfinder's correctness contract.

### 2026-08-28 — Feature 47: Hooksmith

- Outcome: Pathfinder ships `hooksmith`, which turns a described automation or deterministic guarantee into the smallest working, correctly scoped, verified hook for the harness the session is running in. It decides first whether the behavior is a hook at all — deterministic lifecycle behavior is, judgment is a skill, a one-off is a script — and treats "this is not a hook" as a successful outcome. The hook is described in portable terms (lifecycle moment, trigger, action, blocking or not, ownership and scope, failure behavior, verification) before any harness is named; only then does the skill identify the active harness and read what it can actually do. Claude Code is the first concrete supported harness and the reference translation, not the definition of a hook, and where a harness has no equivalent primitive — or none that can block where blocking is the point — the skill says so and stops instead of simulating enforcement. Two independent approval gates apply: location, and blast radius. Twenty-second skill in the kit; no hook, dependency, abstraction layer, or new artifact type was added.
- Delivered as one accepted ticket, 47.1, because `validate-kit.py` fails the moment a skill exists without its listing and adapter, so splitting authoring from registration would have left the repository broken between tickets.
- Steered mid-implementation by the human from a Claude Code-specific skill to a harness-agnostic one, with Claude Code demoted from definition to reference translation. Feature 47's Goal, Requirements, and Acceptance Criteria were rewritten to match and no completed work was discarded.
- Verification: `validate-kit.py` OK (22 skills); 587/587 installer tests; adapters up to date under `--check`; docs site builds, 39 pages. A grep of the skill's first 89 lines confirmed no harness dialect appears before the step that identifies the harness. All four cells of the Claude Code translation table were checked against the live hooks documentation rather than from memory: `PreToolUse` firing pre-call and blocking, the `if` condition field and its permission-rule syntax, `permissionDecision: "deny"` and exit code 2, and the `.claude/settings.json` and plugin `hooks/hooks.json` locations. Both cited documentation URLs return 200.
- Two tester reviews. The first raised six findings, all repaired in place; the sixth became an explicit human decision — the blast-radius approval gate — recorded in the Feature rather than left as an implementation choice. The second returned PASS with two low-severity documentation findings: an incomplete changed-file record on the ticket and in the workspace state, which omitted the two prose statements of the kit's skill count that no validator checks, repaired before the commit; and pre-existing drift in the site workflow guide, deliberately left out of this ticket.
- Delivery: PR #56 from branch `hooksmith`, one commit of nine files. Merge, version bump, npm publication, tag, GitHub Release, and any plugin or marketplace action remain human-owned and were not performed. Issue #55 closes on merge via the PR.
- Follow-up: `site/src/content/docs/guides/workflow.md` still says "Two utilities, outside every loop" and names only `handoff` and `skillsmith`, while the sidebar group now holds five. Pre-existing drift — `role` and `whereami` were already missing — and its own small piece of work. `hooksmith` itself has never been executed, which is correct for this Feature but means its first real invocation is its first behavioral test.

### 2026-08-27 — Feature 46: Prepare the major lifecycle release

- Outcome: Pathfinder is prepared as a coherent `4.0.0` release candidate for the ticket-first redesign. The changelog is the version source, npm and plugin manifests agree, current website/GitHub/npm/plugin surfaces describe the canonical ticket store and automatic lifecycle roles consistently, retired commands remain only in historical or migration context, and the captured installer transcript comes from a real `v4.0.0` run.
- Delivered as one accepted ticket, 46.1, so the release notes, public and internal documentation, version metadata, generated-adapter contract, package contents, plugin inventory, and fresh-install evidence form one reviewable snapshot.
- Verification: `validate-kit.py` OK (21 skills); 585/585 installer tests; adapters current; docs site builds 37 pages; transcript, version-agreement, and `4.0.0` release-note extraction checks pass; `claude plugin validate .` passes; npm pack preview contains 60 intended files. Fresh npm-tarball and clean local-plugin installs each completed `kickstart-pathfinder -> to-specs -> configure ticket store -> to-tickets -> ticket load -> ticket start -> ticket review -> ticket complete`, including role contracts, `Proposed -> Ready -> In Progress -> Complete`, durable history, and no shadow `context/tickets/` for the configured non-default store. The plugin exposed 21 skills and zero agents, hooks, MCP servers, or LSP servers; isolated marketplace state was removed.
- Delivery: Committed on the dedicated redesign branch. Merge, npm publication, tag creation, GitHub Release creation, release-workflow dispatch, and any plugin/marketplace release action remain explicit human-owned steps.
- Follow-up: After squash merge and validation on `main`, dispatch the guarded `4.0.0` release workflow, then verify npm, the GitHub Release/tag, the plugin install, and a registry-backed fresh install as documented in `CONTRIBUTING.md`.

### 2026-08-27 — Feature 45: Roles are assumed automatically by the lifecycle

- Outcome: Normal lifecycle invocations now read and assume their responsibility contract automatically: `kickstart-pathfinder`, `to-specs`, and `to-tickets` use `planner`; ticket `load`, `start`, and `complete` use `developer`; ticket `review` uses `tester`. `/role` remains an explicit human override and debugging tool, and assumed or explicit roles never grant approval, acceptance, merge, release, or other human authority.
- Delivered as one ticket, 45.1, keeping lifecycle contracts, role files, structural validation, adapters, agent entry points, README/package guidance, changelog, and website documentation atomic.
- Verification: `validate-kit.py` OK (21 skills), including exact file-to-role mapping and explicit-override checks; 585/585 installer tests; adapters up to date under `--check`; docs site builds, 37 pages; stale manual-role prerequisite language is absent from live public and internal surfaces.
- Delivery: Committed on the dedicated redesign branch. Merge and release remain human-owned and are not part of this completion step.
- Follow-up: Feature 46 performs the major version bump and full public-surface/release consistency pass, then verifies the lifecycle end to end from fresh releasable npm-package and plugin installs before any publication.

### 2026-08-27 — Feature 44: The configured ticket store is canonical

- Outcome: Tickets now live in exactly one configured store. Local Markdown under `context/tickets/` is the default store, not a mirror or fallback; a project configured for GitHub Issues or another tracker has no parallel local ticket copy. `to-tickets` creates tickets in that store, and `/ticket load|start|review|complete` reads and writes the same artifact. `sync-tracker` and its adapter are removed because there is nothing left to synchronize, and the public and internal guidance now treats `context/tickets/` as conditional on the local-Markdown choice.
- Delivered as three accepted tickets plus one superseded design: 44.1 configured the ticket store, 44.4 made it canonical across the lifecycle, 44.3 retired `sync-tracker`, and the earlier projection-based 44.2 was superseded.
- Verification: `validate-kit.py` OK (21 skills); 585/585 installer tests; adapters up to date under `--check`; docs site builds, 37 pages; live kit, README, package, and site searches contain no retired `sync-tracker` or work-tracking surface outside historical records.
- Delivery: Committed on the dedicated Feature 44 branch. Merge and release remain human-owned and are not part of this completion step.
- Follow-up: After Features 42–45, make the redesign's major version bump and run a full release/docs consistency pass across the website, GitHub README/docs, npm package, plugin metadata, changelog and release notes, adapters and examples. Verify the new lifecycle from a fresh install before release.

### 2026-08-27 — Feature 43: The ticket delivery loop replaces the feature delivery loop

- Outcome: `/ticket load|start|review|complete` is the delivery loop, and `skills/feature/` is gone. `load` reads the ticket and its parent Feature, verifies every blocker, and stops without writing anything when one is unfinished — a blocker that is `Cancelled` or `Superseded` stops it too, because an edge into abandoned work is a planning question. `complete` names the tickets its completion just unblocked and leaves the choice of the next one to the human. A Feature's status is now derived from its tickets rather than maintained by hand: the first ticket to reach `In Progress` moves the Feature there, and a Feature whose tickets are all terminal becomes `Complete`. `context/current-feature.md` became `context/current-ticket.md`; both names stay on the installer's never-ships list so an upgrade cannot drop a maintainer's copy onto a project installed before the rename.
- Delivered as three tickets — 43.1 the skill and its four actions, 43.2 the transient-state move, 43.3 retiring the `feature` loop and repointing every surface. The blocker chain was exercised as written: 43.2 blocked on 43.1, 43.3 on both.
- Verification: `validate-kit.py` OK (22 skills); 585/585 installer tests; adapters up to date under `--check`; docs site builds, 38 pages; a clean `--agents claude-code` install into a scratch repository ships `ticket`, no `feature`, and no transient session state. A tester review found three skills — `whereami`, `teach-feature`, `quiz-me` — still reading `context/current-feature.md`, a file nothing writes any more; `whereami`'s read-at-most-one-file rule made that a guaranteed `none` on every snapshot. All three were fixed, along with `ticket load` requiring a ticket source that `setup-tracker` does not yet produce.
- Delivery: Committed on the dedicated Feature 43 branch. Merge and release remain human-owned and are not part of this completion step.
- Follow-up: `setup-tracker` and `sync-tracker` still speak in Features. Feature 44 makes the tracker a ticket projection and retires `sync-tracker`.

### 2026-08-27 — Feature 42: Tickets are the executable unit of work

- Outcome: Pathfinder plans in Features and executes in tickets. `to-tickets` slices one approved Feature spec into `context/tickets/NN.TT-slug.md`, each naming its parent Feature, what to read, what to change, how to verify it, and — by key, never by file order — what blocks it; the blocker edges are checked acyclic before anything is written. `## Delivery Chunks` is gone from the Feature template, and every kit statement that described execution chunk by chunk now names the ticket. One execution layer, not two. Ticket records are canonical in the repository; a tracker is a projection of them.
- Verification: `validate-kit.py` OK (22 skills); 585/585 installer tests; adapters up to date under `--check`; docs site builds, 38 pages. `to-tickets` was dry-run against Feature 43's own spec — three tickets, unique keys, acyclic graph, ready set `43.1`. A tester review raised four findings; three were fixed (a publish `to-tickets` offered that no skill could perform, `to-tickets` missing from the `planner` role's `## Use`, `context/tickets/` missing from AGENTS.md's durable-context list).
- Delivery: Committed on the dedicated Feature 42 branch. Merge and release remain human-owned and are not part of this completion step.
- Follow-up: The `feature` loop still carries its old name while implementing the active ticket. Feature 43 replaces it with `/ticket load|start|review|complete`.

### 2026-08-26 — Feature 41: Submit Pathfinder to Anthropic's Claude Code community marketplace

- Outcome: The human manually submitted Pathfinder through Anthropic's Console form for the `claude-community` marketplace. The Plugin submissions dashboard showed `Submitted and pending review`.
- Submission record: Submitted 2026-08-26 in the Europe/Madrid timezone. Target: `claude-community`. Repository: `https://github.com/rikilamadrid/pathfinder`. Evidence: human-supplied Anthropic Console Plugin submissions dashboard screenshot in the Feature 41 completion conversation; no separate receipt identifier was displayed.
- Completion-record wording:

  The submission was made for the public Pathfinder repository at the repository
  state available when submitted. Anthropic controls the catalog commit pin and
  may update it automatically as repository commits land; no submitted SHA or tag
  was selectable in the form.

  The submitted plugin surface was verified to be byte-identical to the audited
  `v3.1.0` snapshot:
  - `.claude-plugin/`
  - `skills/`
  - plugin-relevant package metadata

  The audited and installed release snapshot was `v3.1.0`, dereferenced at commit
  `35eb15656b996b14066d06c8240110e3ef28d14a`. This SHA is evidence for the audited
  snapshot, not a claim that Anthropic pinned that SHA.
- Verification: Public `v3.1.0` readiness evidence and clean-install restoration were retained in the Feature 41 session scratchpad; final checks passed with 585/585 installer tests, 21 skills validated, and `claude plugin validate .` passing. `git diff --stat v3.1.0..HEAD -- .claude-plugin/ skills/ packages/create-pathfinder/package.json` produced no output.
- Commit/PR: Pending the Feature 41 completion-record PR.
- Follow-up: Anthropic review and catalog publication are external follow-up and are not Feature completion conditions.

### 2026-08-26 — Feature 40: `context/history.md` is tracked but never shipped

- Outcome: Pathfinder now tracks its own durable `context/history.md` while excluding that kit-relative path from local installs, staged npm packages, and plugin bootstrap derivation. Destination projects keep their own history byte-for-byte through ordinary installs and `--force`; `templates/history.template.md` continues to ship for first completion.
- Verification: 585/585 installer tests; 16/16 focused never-ships tests; `validate-kit.py` passes with the history tracked and correctly distinguishes publication leaks from force-tracked ignored state; before/after installs differ only by the removed `context/history.md`; the 58-file npm dry-run excludes it and includes the template.
- Delivery: Submitted on the dedicated Feature 40 branch for review; merge and release remain human-owned and are not part of this completion step.

### 2026-08-25 — Feature 39: Install Pathfinder as a Claude Code plugin

- Outcome: The repository is now its own Claude Code plugin and its own marketplace. `.claude-plugin/plugin.json` and `marketplace.json` expose the canonical `skills/` tree verbatim — no generated copy, no second behavior contract — namespaced `/pathfinder:<skill>`. `set-release-version.py` writes the release number into a third file and `check_version_agreement` covers it; a new `plugin-manifest` rule owns manifest structure and a new `bootstrap-exclusions` rule holds `kickstart-pathfinder`'s plugin bootstrap to naming `copy-list.json` and `NEVER_SHIPS` rather than restating them. `npx create-pathfinder` is untouched: same copy list, same adapters, same output.
- Verification: `validate-kit.py` OK (21 skills), with every failure path of both new rules exercised on scratch copies; 580/580 installer tests; `claude plugin validate .` passes; a real marketplace install reported 21 skills equal to the directories under `skills/` and 0 agents/hooks/MCP/LSP, then was removed again. Bootstrap output diffed byte-for-byte against an installer run (38 files, identical). A fourth `NEVER_SHIPS` entry added only to `kit.mjs` was picked up by the bootstrap at runtime with no skill or validator edit.
- Commit/PR: `e330dff` — PR #50, squash-merged into `main`, branch deleted.
- Follow-up: Released in v3.1.0 (`35eb156`, tag `v3.1.0`, npm `create-pathfinder@3.1.0`). Submission to a public marketplace is deliberately out of scope and remains the human's own act. The `context/history.md` self-hosting leak and the `"./"` working-tree copy behavior were held out of scope and are unchanged.

### 2026-08-22 — Feature 38: One `feature` skill with four actions

- Outcome: The four delivery-loop commands collapsed into one canonical `feature` skill invoked as `/feature load|start|review|complete`, with the behavior moved to `skills/feature/actions/`. `/feature` and `/role` state their actions inline via `argument-hint`, and `create-pathfinder --version` prints the package version and nothing else. Removing four skills is a MAJOR under the changelog's own rule; the entry sits under `[Unreleased]` and the version bump is a separate human-owned release.
- Verification: `validate-kit.py` OK (21 skills); 580/580 installer tests pass, including new `version.test.mjs` regression tests for the `--version` defect the tester review found (an earlier bad argument beat `--version`). All PR checks green.
- Commit/PR: `574b4b0` — PR #48, squash-merged into `main`, branch deleted.
- Follow-up: Cut the MAJOR release from `[Unreleased]` per `CONTRIBUTING.md` § Releasing.

### 2026-08-21 — Feature 37: load-feature promotes the spec to Ready

- Outcome: `skills/load-feature/SKILL.md` writes the Feature spec's own
  `## Status` — `Proposed` becomes `Ready`, terminal statuses block the load,
  an already-`Ready` spec is left alone. The write sits after the step 5
  blocker check and before `context/current-feature.md`, so a blocked load
  leaves no promoted spec. Approving a Feature for execution now lands in the
  durable record instead of nowhere.
- Verification: `validate-kit.py` OK; 572 installer tests pass with no test
  file edited; `generate-adapters.mjs` reports 0 written, so the unchanged
  frontmatter needed no adapter commit. All rerun on `main` after merge.
- Commit/PR: PR #46, squash-merged to `main` as `ea85f93`
- Follow-up: nothing writes `In Progress`. That gap is real and out of scope
  here by the spec's own decision; it needs its own Feature.

### 2026-08-21 — Feature 36: One install outcome module

- Outcome: `packages/create-pathfinder/src/outcome.mjs` derives the install
  summary once. Both renderings read it instead of recomputing four derivations
  ten times; `report` and its helpers no longer take `plan`, `result`, or
  `adapters`. Every printed byte is unchanged.
- Verification: 572 tests pass with no test file edited but the new
  `test/outcome.test.mjs`; `validate-kit.py` OK; `capture-transcript.py --check`
  and `generate-adapters.mjs --check` report no change. Old and new `cli.mjs`
  compared byte-for-byte over ten scenarios in both tiers, 20 runs, identical.
- Commit/PR: PR #45, squash-merged to `main` as `a61106f`
- Follow-up: none. `countWritten`, the streaming milestone counts, and
  reconciling `written` with the `--force` "copied" count stay out of scope by
  the spec's own decision.
