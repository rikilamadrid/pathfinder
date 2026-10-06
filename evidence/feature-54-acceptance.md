# Feature 54 seed and live proof — 2026-10-06

Ticket [54.4 / #132](https://github.com/rikilamadrid/pathfinder/issues/132) remains In Progress pending independent review and final human acceptance/merge. This record separates observed evidence, engine output, human decisions and verification. It records no new product work or permission to implement harvested proposals.

## Seed and human confirmation

Ricardo explicitly approved each bounded observation in the task conversation before recording. Entries 001–007 were confirmed individually; 008–009 were approved together after Ricardo changed the remaining record gates to one batch. Existing recovered Entry 001 was adopted, not duplicated. All entries initially had status Open; approval to record was never treated as status Approved.

| ID | Observation | Observed; occurrences | Primary evidence / corroboration | Final classification and human decision |
| --- | --- | --- | --- | --- |
| 001 | Two deferred Tester advisories were recorded without their text | 2026-09-18; 1 | issue:122 completion comment; pr:123 delivery context only | Prevention improvement Applied; tracked issue:131, applied pr:135 |
| 002 | Codex recovery brief emitted a task name outside the native contract | 2026-09-18; 1 | issue:111 recovery comment; issue:122, pr:123 corroborate repair | Already fixed; Applied, tracked issue:122, applied pr:123 |
| 003 | Registry confirmation timed out after npm accepted the publish | 2026-09-18; 1 | issue:127; release runs 35344236884 and 35345103649 | Tracked-open; Approved, tracked issue:127 |
| 004 | Release checklist retained a stale hardcoded skill count | 2026-09-12 and 2026-09-16; 2 | Feature 51 and 52 history; issue:94 and pr:126 corroborate | Already fixed; Applied, tracked issue:94, applied pr:126 |
| 005 | Kit validation did not catch frontmatter YAML rejected by the site build | 2026-09-12 (Features 50 and 51), 2026-09-16 (52); 3 | Three distinct completion records | Keep Open; repeated historical observation, but no concrete current reproduction yet |
| 006 | Citation-free specifications reached the Git evidence probe outside a repository | 2026-09-12 (Features 50 and 51), 2026-09-16 (52); 3 | Three distinct completion records | Keep Open; repeated historical observation, but no concrete current reproduction yet |
| 007 | Local site page counts included untracked context files | 2026-09-12 and 2026-09-16; 2 | Feature 51 and 52 history; issue:95 corroborates | Tracked-open; Approved, tracked issue:95 |
| 008 | Live acceptance work recurred across Feature delivery tickets | 2026-09-12, 2026-09-16, 2026-09-18; 3 | Feature 51, 52, 53 history; issues 82, 101, 110 | Deferred by human, 2026-10-06 |
| 009 | Feature 53 live proof resumed in Codex after usage-limit interruptions | 2026-09-18; 1 | issue:110 recovery comment; Feature 53 acceptance and history | Deferred by human, 2026-10-06 |

Full typed references, classifications, candidates, dated occurrences and bounded notes are in `context/improvement-ledger.md`. The initial seed record and verbatim pre-decision harvest are [recorded on #132](https://github.com/rikilamadrid/pathfinder/issues/132#issuecomment-6012317798). Earlier entry approvals are recorded in that issue's preceding comments.

### Evidence limits and approved corrections to the discovery assumptions

- 001: the two missing advisories are one review incident. Their text, locations, recommendations, technical impact and later disposition are unknown. Neither this ledger nor its Applied status recovers them or says either advisory was fixed.
- 002: recovery stopped before dispatch. The invalid invocation was never submitted; no actual tool rejection was observed. The resolve-conflict naming risk is not another occurrence.
- 003: publish succeeded before confirmation failed; tag/release steps were skipped. The later dispatch resumed without republishing. Both runs belong to one incident. No universal npm delay, consumer install failure or corruption is claimed.
- 004: only Features 51 and 52 explicitly record the stale count in their own completion observations. Feature 50 and issue #94's wording add no occurrence. The spec's preliminary count of three is narrowed to the human-approved two.
- 005/006: three durable observations of continuing gaps are not three independently reproduced failures. No missing input, location, parser/error output, delay, current reproduction or later repair is invented.
- 007: the 43/42/39 page counts are configurations of one investigation, not separate occurrences; Feature 50 is corroborating context only. No published-content defect is claimed. History is not rewritten.
- 008: 51.5 combines implementation with acceptance; 52.4 and 53.5 are integrated-acceptance tickets. Only Feature 52 explicitly demonstrates integration defects missed by individual gates. The three instances establish no universal dedicated-ticket rule.
- 009: durable evidence supports one interrupted Codex run and recovery of preserved claims. It does not establish an hours-long wait, rejected cross-harness handoff, live Claude-to-Codex substitution or whether another harness could have resumed. This deliberately narrows the spec's preliminary coordinator narrative.

## Human decision batch — 2026-10-06

Ricardo's explicit instruction in this conversation was: “Apply the entire resolution/harvest batch exactly as proposed, dated 2026-10-06.” The engine executed these transitions individually through `resolve`; it inferred none from tracker state:

| Entry | Authorized and executed transition | Tracking / application |
| --- | --- | --- |
| 001 | Open → Proposed → Approved → Applied | Tracked in issue:131; Applied in pr:135 |
| 002 | Open → Proposed → Approved → Applied | Tracked in issue:122; Applied in pr:123 |
| 003 | Open → Proposed → Approved | Tracked in issue:127 |
| 004 | Open → Proposed → Approved → Applied | Tracked in issue:94; Applied in pr:126 |
| 005 | Keep Open; no transition or new tracking issue | Repeated historical observation, but no concrete current reproduction yet |
| 006 | Keep Open; no transition or new tracking issue | Repeated historical observation, but no concrete current reproduction yet |
| 007 | Open → Proposed → Approved | Tracked in issue:95 |
| 008 | Open → Proposed → Deferred | Decision date 2026-10-06; exact reason below |
| 009 | Open → Proposed → Deferred | Decision date 2026-10-06; exact reason below |

008 reason, verbatim:
> Defer changes to slicing guidance until applicability criteria distinguish Features needing integrated acceptance from those adequately covered by existing ticket checks.

009 reason, verbatim:
> Defer additional coordinator handoff guidance until durable evidence demonstrates a gap beyond the existing controlled resume and harness-substitution procedure.

Harvest decisions: 005 Keep Open pending reproduction; 006 Keep Open pending reproduction; 008 Defer. No additional proposal for 001, 002, 003, 004, 007 or 009. No new Feature, ticket, issue or implementation work was created. Existing #127 and #95 were not implemented. The decision date belongs to this approval batch, not to historical observations or repair merges. The engine stores explicit dates for Deferred; this acceptance record dates the other decisions without adding unsupported ledger fields.

## Retrospective bootstrap chain

Entry 001 was observed on 2026-09-18 (issue #122's completion comment). Normal ticket 54.3 / #131 added the deferred-finding text-and-evidence requirement in `skills/ticket/actions/review.md`; PR #135 merged on 2026-09-19 as `3550e00f09fd65fdad411fad374a8c7d9aa6946b`. The merged diff and its ancestry on this branch were verified before resolving Applied.

This chain is explicitly retrospective: the ledger could not precede its own engine, and the prevention change landed before this seed and its human-approved resolution batch. The Open → Proposed → Approved → Applied steps were recorded on the human's 2026-10-06 instruction, not presented as approvals made before implementation. Each step rests on durable evidence and normal ticket tracking. Applied means the prevention requirement landed, not that missing advisory text was recovered or that either advisory itself was fixed. Entries 002 and 004 likewise were seeded Open and resolved only under the present human approval, despite their pre-existing repairs.

## Harvest proposals and decisions

The pre-decision harvest identified repeated entries 005, 006 and 008 (three observations each) and 004/007 (two each). Those counts are evidence, not authority.

| Proposal | Observation/evidence | Generalization and gap | Proposed change / coverage level | Risk | Validation | Human decision |
| --- | --- | --- | --- | --- | --- | --- |
| 005 | Three completion observations of a frontmatter gap | Early validation should agree with its consumer; no concrete current reproduction yet | After reproduction, strengthen the existing validation invariant | Expanding beyond the site's actual contract | A malformed fixture fails both checks; valid frontmatter passes | Keep Open, pending reproduction |
| 006 | Three completion observations of a Git-probe gap | Optional evidence should not impose an unrelated repository dependency; current behavior not newly demonstrated | After reproduction, strengthen the existing evidence-probe invariant | Skipping checks when repository evidence is required | Citation-free input works outside Git; cited input retains checks | Keep Open, pending reproduction |
| 008 | Three instances of explicit live acceptance work | Individual gates can miss integration defects (Feature 52); applicability criteria absent from slicing guidance | Clarify existing slicing guidance | Mandatory ceremony for every Feature | Future slicing explains inclusion/omission against concrete integration risks | Deferred, exact reason above |

No additional change proposal for 001/002/004 (verified repairs), 003/007 (existing tracking), or 009 (existing controlled resume and supported-harness substitution guidance; broader coordinator gap unproven). No Reflect self-improvement proposed. Nothing harvested was implemented.

## Verbatim harvest — seeded ledger before decisions

This is the historical output presented for the decision, not the final ledger's output.

```text
# Harvest

9 entries.

## Open, most repeated first

- 005 — Kit validation did not catch frontmatter YAML rejected by the site build (3 occurrence(s), medium impact, missing-contract)
- 008 — Live acceptance work recurred across Feature delivery tickets (3 occurrence(s), medium impact, workaround)
- 006 — Citation-free specifications reached the Git evidence probe outside a repository (3 occurrence(s), low impact, missing-contract)
- 004 — Release checklist retained a stale hardcoded skill count (2 occurrence(s), low impact, workflow-friction)
- 007 — Local site page counts included untracked context files (2 occurrence(s), low impact, workflow-friction)
- 001 — Two deferred Tester advisories were recorded without their text (1 occurrence(s), medium impact, missing-contract)
- 002 — Codex recovery brief emitted a task name outside the native contract (1 occurrence(s), medium impact, missing-contract)
- 003 — Registry confirmation timed out after npm accepted the publish (1 occurrence(s), medium impact, workflow-friction)
- 009 — Feature 53 live proof resumed in Codex after usage-limit interruptions (1 occurrence(s), medium impact, workflow-friction)

## Repeated

- 005 — Kit validation did not catch frontmatter YAML rejected by the site build (3 occurrences)
- 008 — Live acceptance work recurred across Feature delivery tickets (3 occurrences)
- 006 — Citation-free specifications reached the Git evidence probe outside a repository (3 occurrences)
- 004 — Release checklist retained a stale hardcoded skill count (2 occurrences)
- 007 — Local site page counts included untracked context files (2 occurrences)

## Deferred, and happened again since

None.

## Proposed, awaiting a decision

None.

## Approved, and where the work is tracked

None.

## Counts

By category: missing-contract 4, workflow-friction 4, workaround 1
By source: completion 5, integration 1, orchestration 1, release 1, review 1
By status: Open 9
```

## Verbatim harvest — final resolved ledger

Re-running `node skills/reflect/engine/bin/ledger.mjs harvest` must reproduce the following block byte for byte.

```text
# Harvest

9 entries.

## Open, most repeated first

- 005 — Kit validation did not catch frontmatter YAML rejected by the site build (3 occurrence(s), medium impact, missing-contract)
- 006 — Citation-free specifications reached the Git evidence probe outside a repository (3 occurrence(s), low impact, missing-contract)

## Repeated

- 005 — Kit validation did not catch frontmatter YAML rejected by the site build (3 occurrences)
- 008 — Live acceptance work recurred across Feature delivery tickets (3 occurrences)
- 006 — Citation-free specifications reached the Git evidence probe outside a repository (3 occurrences)
- 004 — Release checklist retained a stale hardcoded skill count (2 occurrences)
- 007 — Local site page counts included untracked context files (2 occurrences)

## Deferred, and happened again since

None.

## Proposed, awaiting a decision

None.

## Approved, and where the work is tracked

- 003 — Registry confirmation timed out after npm accepted the publish -> `issue:127`
- 007 — Local site page counts included untracked context files -> `issue:95`

## Counts

By category: missing-contract 4, workflow-friction 4, workaround 1
By source: completion 5, integration 1, orchestration 1, release 1, review 1
By status: Applied 3, Approved 2, Deferred 2, Open 2
```

## Reference verification

All 24 unique typed references in the ledger resolved on 2026-10-06. Each file/doc exists and every cited line range is valid. Both cmd references were rerun. Each referenced GitHub issue/PR resolved. Application PRs were verified merged, their commit objects exist, and each is an ancestor of this branch:

| PR | Merged (UTC) | Commit |
| --- | --- | --- |
| 135 | 2026-09-19T18:07:28Z | 3550e00f09fd65fdad411fad374a8c7d9aa6946b |
| 123 | 2026-09-18T09:43:48Z | befa9660da2ce7ad78a4a7579261c9007537306d |
| 126 | 2026-09-18T12:14:14Z | 65c8fa5abec6de4497541f19889a1ece3e282eff |

Resolved typed references:

- `cmd:gh run view 35344236884 --repo rikilamadrid/pathfinder`
- `cmd:gh run view 35345103649 --repo rikilamadrid/pathfinder`
- `doc:context/history.md#L36`
- `doc:context/history.md#L37`
- `doc:context/history.md#L45-L46`
- `doc:context/history.md#L49`
- `doc:context/history.md#L53`
- `doc:context/history.md#L58`
- `doc:context/history.md#L65`
- `doc:context/history.md#L77`
- `doc:evidence/feature-53-acceptance.md#L13`
- `file:skills/to-tickets/SKILL.md#L50-L69`
- `issue:101`
- `issue:110`
- `issue:111`
- `issue:122`
- `issue:127`
- `issue:131`
- `issue:82`
- `issue:94`
- `issue:95`
- `pr:123`
- `pr:126`
- `pr:135`

## Verification and boundary

Implementation checks below passed on the seeded and resolved ledger. Review and human acceptance are separate from these implementation checks; Feature 54 completion/history must follow the normal completion flow after acceptance and merge.


| Check | Observed result |
| --- | --- |
| Ledger validation | 9 entries, every one well formed; status/count assertions match all nine approved decisions |
| Harvest reproducibility | Final fenced output above equals a fresh harvest byte for byte |
| Reference resolution | All 24 unique references resolve; both commands reran; all three Applied commits exist and are ancestors of HEAD |
| Kit validator with ledger staged/tracked | OK — 26 skills validated, all rules passed |
| Generated adapters | 26 adapters up to date |
| Reflect suite | 137 passed, 0 failed |
| Shared evidence-reference suite | 88 passed, 0 failed |
| Blog-post-redactor suite | 132 passed, 0 failed |
| Installer suite | 719 passed, 0 failed |
| Renderer suite | 825 passed, 0 failed, 25 documented skips (850 total) |
| Orchestrate suite | 437 passed, 0 failed |
| Scratch install | Local CLI with `--agents claude-code --yes --no-clipboard --no-open` into an initialized temporary Git repository; live ledger absent, ledger template/shared primitive/Claude reflect adapter present |
| Site build and manifest | 45 local pages built; manifest/icons and all-page iOS metadata checks passed |
| Live ledger site boundary | 6 context Markdown files, loader reports 5 context pages; no `dist/context/improvement-ledger/`, no sidebar href to that route, none of the nine entry titles anywhere in dist; history page present |
| Shared exclusion | Loader and navigation both import `isUnpublished` from `site/src/unpublished.mjs` |
| Diff scope | Only `context/improvement-ledger.md` and this acceptance record; no skills, roles, templates, history, package versions or harvested implementations changed |

The site page count is explicitly a local-build observation, not repository-only release evidence; #95 remains out of scope. Existing documentation may name the ledger file while teaching its mechanism; the exclusion check tests the live route/sidebar link and actual seeded titles, not a blanket ban on mentioning the filename. The recovered worktree needed locked test dependencies installed. The first orchestrate run was sandbox-denied permission to listen on loopback; the suite passed with permission for its local fixture servers. No dependency manifests were changed.

The human decision batch and final harvest were [recorded on #132](https://github.com/rikilamadrid/pathfinder/issues/132#issuecomment-6012499960). Independent Adversary and Tester checkpoints belong to the exact PR head and are separate from this developer verification. Final human acceptance, merge and the normal Feature-completion history entry remain pending.
