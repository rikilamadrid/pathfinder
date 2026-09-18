# Feature 53 integrated acceptance — 2026-09-18

Feature 53 is still **In Progress** while ticket [53.5 / #110](https://github.com/rikilamadrid/pathfinder/issues/110) is reviewed and integrated. This record separates the live Pathfinder run from deliberate scratch exercises. It is acceptance evidence, not a claim that a human gate or a file conflict happened to the two live documentation/integration workers.

## Live run on this repository

The original machine-local snapshots are in the orchestrator checkout's `.pathfinder/live-proof/` (ignored by Git). GitHub comments and merged PRs below are the durable corroboration. The actual engine generated the plan, claims, status, integration checks and Codex briefs; the orchestrator dispatched native Codex sessions from those briefs. The static policy selected `developer / inherited / inherited` for both workers.

| Observation | Pathfinder evidence | Durable tracker / Git evidence |
| --- | --- | --- |
| 53.4 and 53.6 were the two eligible dispatches; 53.5 waited on both | `initial-plan.json`: `dispatch=[53.4,53.6]`, `blocked=[53.5: 53.4,53.6]`; each selection says `static / developer / inherited / inherited` with parallel safety `isolated` | [#110 blocked comment, 2026-09-17 18:50:16 UTC](https://github.com/rikilamadrid/pathfinder/issues/110); [53.4 ownership, 18:49:05](https://github.com/rikilamadrid/pathfinder/issues/109); [53.6 ownership, 18:49:10](https://github.com/rikilamadrid/pathfinder/issues/111) |
| Two different claims, branches, worktrees, and worker-local `context/current-ticket.md` files existed concurrently | `dispatched-status.json`, then `both-in-progress.json`: 53.4 and 53.6 working; 53.5 blocked | [#110 live status comment, 2026-09-17 18:51:39 UTC](https://github.com/rikilamadrid/pathfinder/issues/110) names both branch/worktree assignments and isolated state files |
| The parent/initial Codex sessions stopped at usage limits, but work survived | `interrupted-status.json`: both preserved claims shown `stale`, 53.5 still blocked; `resumed-status.json`: same claims `working` after intentional resume | [#110 recovery comment, 2026-09-18 08:31:36 UTC](https://github.com/rikilamadrid/pathfinder/issues/110) records preserved uncommitted work and unchanged claim, branch, worktree and profile. Replacement **Codex** sessions resumed; a live Claude-to-Codex substitution was not performed. |
| Independent tester PASS did not bypass the integrator | `both-review.json`, `review-resumed-status.json` and later check snapshots | [#109](https://github.com/rikilamadrid/pathfinder/issues/109) and [#111](https://github.com/rikilamadrid/pathfinder/issues/111) distinguish tester PASS from merge safety. |
| 53.4 integrated first; 53.6 became behind and 53.5 remained blocked | `post-53.4-integration-status.json`, `53.6-behind.json`: result `behind`, no conflict | [PR #120](https://github.com/rikilamadrid/pathfinder/pull/120) merged as `e7938ff7005ca04ae226561f39f3924df7c5912e`; [#110 blocked by 53.6 comment, 2026-09-18 08:49:30 UTC](https://github.com/rikilamadrid/pathfinder/issues/110). |
| A Codex adapter defect interrupted recovery before invalid dispatch; 53.9 repaired the task name | `53.6-rebase-and-reverify.json` and `53.6-rebase-after-53.9.json` | [#111 defect comment, 2026-09-18 08:49:27 UTC](https://github.com/rikilamadrid/pathfinder/issues/111); [53.9 / #122](https://github.com/rikilamadrid/pathfinder/issues/122) and [PR #123](https://github.com/rikilamadrid/pathfinder/pull/123), merged as `befa9660da2ce7ad78a4a7579261c9007537306d`. |
| The repaired recovery brief dispatched natively into the **same** 53.6 claim | `53.6-rebase-after-53.9.json`: `tool=collaboration.spawn_agent`, `task_name=pathfinder_53_6_rebase_and_reverify`, `fork_turns=all`, inherited model/effort omitted from overrides; brief retains original branch/worktree/profile | [#111 revalidation comment, 2026-09-18 10:07:34 UTC](https://github.com/rikilamadrid/pathfinder/issues/111): rebased head `f33231706666fde1d6d49faeeeaac7d6d4b40754`, fresh independent PASS and current-head green CI. |
| 53.6 integrated safely; only then 53.5 became eligible | Fresh integration check reported `candidate`, no behind/conflict/overlap; subsequent canonical board/plan removed both blockers | [PR #121](https://github.com/rikilamadrid/pathfinder/pull/121) merged as `cbb6cd65eec6a759443281b16a9ec174fefc49ea`; [#110 unblocked comment, 2026-09-18 10:10:09 UTC](https://github.com/rikilamadrid/pathfinder/issues/110). The real planner later selected 53.5 and its [claim comment](https://github.com/rikilamadrid/pathfinder/issues/110) is stamped 10:43:08 UTC. |

A human gate on **live** 53.4 or 53.6 did **not** occur. The tracker must not imply otherwise. The gate behavior was deliberately exercised in the scratch proofs below, including an actual scratch GitHub issue. Thus the Feature's gate mechanics and independent-progress contract are demonstrated, while the strict wording “one of the two live workers reaches a gate” was not literally observed.

## Deliberate scratch proofs

On 2026-09-18, ticket 53.5 ran the real orchestration engine in disposable, local-Markdown Git repositories made by `packages/orchestrate/lib/harness.mjs`. Both repositories were created under this worker checkout's ignored `.pathfinder/scratch-53.5/` and removed by the harness. These are **scratch** events, not the live 53.4/53.6 run. The command asserted each printed state rather than just printing a predetermined story. Its verbatim output was:

```text
plan: 1.1 + 1.2 dispatch; 1.3 blocked by 1.1, 1.2
claims: 1.1 ticket/1.1-alpha .pathfinder/worktrees/1.1; 1.2 ticket/1.2-beta .pathfinder/worktrees/1.2
duplicate claim: refused; original 1.1 claim preserved
gate: 1.1 human-gate; unrelated 1.2 working
independent progress: 1.2 done while 1.1 human-gate
gate resolved: 1.1 working; 1.2 remains done
recovery: 1.1 stale; resume brief retains ticket/1.1-alpha, .pathfinder/worktrees/1.1, developer/inherited/inherited; new claim refused
dependency: 1.3 waits after only 1.1 completes; eligible after both complete
integration before first merge: 1.2 candidate with advisory overlap README.md
integration after 1.1 merge: 1.2 conflict README.md; not a candidate
serialization: 1.2 conflict resolved in its own worktree, revalidated, candidate
mode human-in-the-loop: orchestrate plan and claim refused; no worker dispatched
mode missing file: orchestrate plan and claim refused; no worker dispatched
```

The scratch human gate's *real GitHub store* counterpart is [issue #116](https://github.com/rikilamadrid/pathfinder/issues/116), intentionally created during 53.3 verification and then cancelled. Its `gate-opened` comment at 2026-09-17 12:43:33 UTC and `gate-resolved` comment at 12:43:40 UTC record the question and decision. The `gate: human` label was added and removed while exactly one lifecycle `status:` label remained; reopening the same gate did not duplicate a note. The issue is closed `status: cancelled`, appropriately excluded from Feature 53 ticket completion.

The existing automated scratch-repository contracts in `packages/orchestrate/test/claim.test.mjs`, `dispatch.test.mjs`, `integration.test.mjs`, and `mode-parity.test.mjs` also cover atomic concurrent claim races, stale inspection/resume, tracker gate retry after failed writes, conflict/behind refusal, release safeguards, invalid mode, and missing-mode parity. `profile.test.mjs` exercises a dummy alternate routing policy through the registry without scheduler or claim changes and checks non-inherited Claude model forwarding and explicit refusal of unsupported values. `codex.test.mjs` covers native model/effort translation and deterministic safe task names for implementation, review and recovery sessions.

## Tracker and delivery audit

Read on 2026-09-18 from `feature: 53` GitHub Issues, merged PR metadata, the actual linear Git history, Feature spec, and `context/history.md`. A closed Issue with no `status:` label is Complete under `context/tracker.md`; the Feature spec remains In Progress and no Feature 53 history entry exists while #110 remains open. All nine Feature 53 issues carry the feature label. There is no status/PR/repository disagreement requiring a repair.

| Ticket | Issue / lifecycle | Merged PR / commit |
| --- | --- | --- |
| 53.1 | [#106](https://github.com/rikilamadrid/pathfinder/issues/106) Complete | [#113](https://github.com/rikilamadrid/pathfinder/pull/113) `2c366645a908dee4d1df3519c3db168a2c60bd03` |
| 53.2 | [#107](https://github.com/rikilamadrid/pathfinder/issues/107) Complete | [#114](https://github.com/rikilamadrid/pathfinder/pull/114) `10833502ab559e0c3d9e91dac55e645ad2ecc968` |
| 53.7 | [#112](https://github.com/rikilamadrid/pathfinder/issues/112) Complete | [#115](https://github.com/rikilamadrid/pathfinder/pull/115) `1c1b28b1e610a117e867ab8ef09839e913ea2f96` |
| 53.3 | [#108](https://github.com/rikilamadrid/pathfinder/issues/108) Complete | [#117](https://github.com/rikilamadrid/pathfinder/pull/117) `bfcf9168d1843dd4a233a8f88b67f43f8c6bc1cd` |
| 53.8 | [#118](https://github.com/rikilamadrid/pathfinder/issues/118) Complete | [#119](https://github.com/rikilamadrid/pathfinder/pull/119) `f86a53c84381bf6269fb9d511a90962fc1b7f067` |
| 53.4 | [#109](https://github.com/rikilamadrid/pathfinder/issues/109) Complete | [#120](https://github.com/rikilamadrid/pathfinder/pull/120) `e7938ff7005ca04ae226561f39f3924df7c5912e` |
| 53.9 | [#122](https://github.com/rikilamadrid/pathfinder/issues/122) Complete | [#123](https://github.com/rikilamadrid/pathfinder/pull/123) `befa9660da2ce7ad78a4a7579261c9007537306d` |
| 53.6 | [#111](https://github.com/rikilamadrid/pathfinder/issues/111) Complete | [#121](https://github.com/rikilamadrid/pathfinder/pull/121) `cbb6cd65eec6a759443281b16a9ec174fefc49ea` |
| 53.5 | [#110](https://github.com/rikilamadrid/pathfinder/issues/110) In Progress | This acceptance record; PR and completion pending |

## Product and repository checks

The 53.6 surfaces in [PR #121](https://github.com/rikilamadrid/pathfinder/pull/121) consistently describe the two modes: root and package READMEs, package/plugin metadata, agent entry points, roles, context policy, contributor guide, site landing page, workflow/roles/getting-started/ticket-store/session-orientation guides, concepts, the new execution-modes guide, site navigation/config, and the Unreleased changelog. A scan of live Markdown found no unqualified “not an orchestration runtime” claim; remaining “one ticket at a time” phrases explicitly describe human-in-the-loop mode. The new execution-modes guide is linked and the site build includes it. The installer transcript check compares the shipped v4.3.0 installer output to the getting-started guide and reports an exact match.

Full validation on the current 53.5 branch:

- Orchestration: 166 tests, 34 suites, all pass.
- Installer: 693 tests, 143 suites, all pass.
- Renderer: 850 tests in 108 suites; 825 pass, 25 documented skips, none fail.
- `validate-kit.py`: 25 skills, all rules pass.
- Generated adapters: 25 up to date under `--check`.
- Installer transcript: v4.3.0 capture matches the guide under `--check`.
- `site`: clean `npm ci` and `npm run build` pass; 43 pages, manifest valid.

No new routing policy, release/version change, publication, tag, daemon, database, queue or broker is included in this ticket.
