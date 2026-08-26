# Project History

Compact record of completed work.

## Completed

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
