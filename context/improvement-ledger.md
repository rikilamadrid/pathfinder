# Improvement Ledger

Observations about how delivery went, and what came of them.

An entry records something that actually happened, with the evidence that shows
it happened. It is not a task, and it carries no authority: nothing here changes
a skill, a role, a template or a contract. A person decides what becomes work,
and the ordinary Feature and ticket path does the work.

## How to read this file

Each entry is one `## <id> — <title>` section. It opens with an identity marker,
`<!-- pathfinder:improvement <id> -->`, which never changes and is the only
thing a later run matches on. Then come `- Field: value` lines, and then one
short paragraph saying what happened.

- **`Status`** is a field line, not the marker, because status changes and
  identity does not. A person moves it; nothing infers it from a closed issue,
  a merged pull request, or the passage of time.
- **`Evidence`** is one or more references in Pathfinder's `type:locator`
  grammar, the same one every other evidence surface uses. An entry with no
  reference that resolves is not recordable.
- **`Occurrences`** is a count and one dated sub-item per occurrence. The
  second time something happens it is an occurrence of the entry that already
  describes it, never a second entry. Recurrence is what turns one annoyance
  into a case for changing something.
- **Entries and occurrences are only ever appended.** A resolution rewrites
  that entry's status lines and touches nothing else in the file.

The engine at `skills/reflect/engine/bin/ledger.mjs` records, resolves,
harvests and validates. It reads no clock, so every date in this file was given
to it by a person. `validate` will name anything malformed by id and line.

A project with no friction worth recording has an empty ledger, and that is a
perfectly good state for this file to be in.

## 001 — Two deferred Tester advisories were recorded without their text

<!-- pathfinder:improvement 001 -->

- Observed: 2026-09-18
- Source: review
- Scope: workflow
- Category: missing-contract
- Human intervention: none
- Impact: medium
- Candidate improvement: Preserve each deferred finding's actual text and evidence in the review/completion record
- Status: Applied
- Tracked in: `issue:131`
- Applied in: `pr:135`
- Evidence: `issue:122` (completion comment, primary); `pr:123` (corroborating delivery context only)
- Occurrences: 1
  - 2026-09-18 — `issue:122`

The [completion comment on issue #122](https://github.com/rikilamadrid/pathfinder/issues/122#issuecomment-5728250834),
dated 2026-09-18, records an independent Tester PASS at a8e181a and two Low
advisories deliberately left as follow-up. Their text is absent from the inspected
issue and PR records. PR #123 corroborates delivery only. This is one review
incident, not two occurrences. Human intervention is recorded as none documented,
not a claim that none occurred. Medium impact describes the missing actionable
record, not the advisories' unknown technical impact. Their wording, affected
files or locations, recommendations, and whether either was later fixed remain
unknown and are not inferred or reconstructed.

## 002 — Codex recovery brief emitted a task name outside the native contract

<!-- pathfinder:improvement 002 -->

- Observed: 2026-09-18
- Source: integration
- Scope: workflow
- Category: missing-contract
- Human intervention: decision
- Impact: medium
- Candidate improvement: Validate and canonicalize Codex worker task names at the adapter boundary for every supported session
- Status: Applied
- Tracked in: `issue:122`
- Applied in: `pr:123`
- Evidence: `issue:111`, `issue:122`, `pr:123`
- Occurrences: 1
  - 2026-09-18 — `issue:111`, `issue:122`, `pr:123`

The primary evidence is the issue #111 recovery comment
(https://github.com/rikilamadrid/pathfinder/issues/111#issuecomment-5727581064),
dated 2026-09-18. The engine emitted pathfinder_53_6_rebase-and-reverify,
containing hyphens outside the native task-name contract. Recovery stopped
before dispatch; the invalid invocation was never submitted or manually
rewritten, and no actual tool rejection was observed. Ticket, branch,
worktree, claim and execution profile were preserved. Issue #122 corroborates
the human decision to request repair ticket 53.9; PR #123 corroborates its
subsequent delivery, not a second occurrence or an automatic ledger status
transition. Medium impact describes the stopped recovery; no quantified delay
or wider impact is established. The resolve-conflict session is a related
naming risk, not a second occurrence. No separate recurrence is inferred.

## 003 — Registry confirmation timed out after npm accepted the publish

<!-- pathfinder:improvement 003 -->

- Observed: 2026-09-18
- Source: release
- Scope: project
- Category: workflow-friction
- Human intervention: recovery
- Impact: medium
- Candidate improvement: Extend registry confirmation to accommodate asynchronous processing and require both package metadata and the tarball to be available
- Status: Approved
- Tracked in: `issue:127`
- Evidence: `issue:127`, `cmd:gh run view 35344236884 --repo rikilamadrid/pathfinder`, `cmd:gh run view 35345103649 --repo rikilamadrid/pathfinder`
- Occurrences: 1
  - 2026-09-18 — `issue:127`, `cmd:gh run view 35344236884 --repo rikilamadrid/pathfinder`, `cmd:gh run view 35345103649 --repo rikilamadrid/pathfinder`

During v4.4.0 on 2026-09-18, run 35344236884 successfully published before
registry confirmation failed after approximately two minutes; tagging and
release creation were skipped on that failed run. Issue #127 records external
observations of metadata becoming visible after approximately 4 minutes 16
seconds and the tarball after 8 minutes 45 seconds. These measurements come
from that issue's recorded observations, not a universal npm propagation
duration. The later manual dispatch, run 35345103649, resumed correctly: it
skipped publishing and completed confirmation, tagging and release creation
without republishing. The two workflow runs are stages of one incident, not
two occurrences. No separate recurrence, consumer install failure or package
corruption is claimed. Recording this observation does not authorize
implementing #127.

## 004 — Release checklist retained a stale hardcoded skill count

<!-- pathfinder:improvement 004 -->

- Observed: 2026-09-12
- Source: completion
- Scope: project
- Category: workflow-friction
- Human intervention: none
- Impact: low
- Candidate improvement: Replace the hardcoded release-checklist skill count with the count derived by the kit validator
- Status: Applied
- Tracked in: `issue:94`
- Applied in: `pr:126`
- Evidence: `doc:context/history.md#L65`, `issue:94`, `pr:126`
- Occurrences: 2
  - 2026-09-12 — `doc:context/history.md#L65`, `issue:94`, `pr:126`
  - 2026-09-16 — `doc:context/history.md#L53`

Feature 51's completion history dated 2026-09-12 explicitly records the stale
22-skills release-checklist comment when the actual count was 24. Feature 52's
completion history dated 2026-09-16 explicitly records that the stale comment
remains. Only these two distinct durable completion observations count as
occurrences. Issue #94 and PR #126 are corroborating evidence; issue #94's
wording about drifting twice adds no occurrence. Feature 50 contributes no
occurrence because its own durable follow-up does not explicitly state this
problem. Human intervention is recorded as none documented, not a claim that
none occurred. Issue #94 describes cosmetic contributor-documentation impact
and a passing v4.3.0 smoke test against the actual invariant. No release
failure, shipped-package defect or quantified maintainer delay is claimed. PR
#126 later removed the hardcoded count and referenced the validator-derived
count; that repair does not automatically change the ledger status.

## 005 — Kit validation did not catch frontmatter YAML rejected by the site build

<!-- pathfinder:improvement 005 -->

- Observed: 2026-09-12
- Source: completion
- Scope: project
- Category: missing-contract
- Human intervention: none
- Impact: medium
- Candidate improvement: Extend kit validation to catch frontmatter YAML that the site build rejects
- Status: Open
- Evidence: `doc:context/history.md#L77`
- Occurrences: 3
  - 2026-09-12 — `doc:context/history.md#L77`
  - 2026-09-12 — `doc:context/history.md#L65`
  - 2026-09-16 — `doc:context/history.md#L53`

Feature 50's completion history dated 2026-09-12 records that validate-kit.py
could not catch frontmatter YAML rejected by the site build. Feature 51's
completion history dated 2026-09-12 records the same unresolved gap, and
Feature 52's completion history dated 2026-09-16 records it still unresolved.
These are three durable observations of one continuing problem, not three
independently reproduced build failures; the two September 12 observations
belong to separate Feature records. Human intervention is recorded as none
documented, not a claim that none occurred. Medium impact describes the
validation gap. These records do not identify the malformed YAML, affected
files, parser output, quantified delay or a later repair; none is inferred or
reconstructed. This historical observation does not establish that the problem
currently reproduces on main. Recording it authorizes neither a fix nor a
status transition.

## 006 — Citation-free specifications reached the Git evidence probe outside a repository

<!-- pathfinder:improvement 006 -->

- Observed: 2026-09-12
- Source: completion
- Scope: project
- Category: missing-contract
- Human intervention: none
- Impact: low
- Candidate improvement: Skip the Git evidence probe when a specification requires no repository evidence
- Status: Open
- Evidence: `doc:context/history.md#L77`
- Occurrences: 3
  - 2026-09-12 — `doc:context/history.md#L77`
  - 2026-09-12 — `doc:context/history.md#L65`
  - 2026-09-16 — `doc:context/history.md#L53`

Feature 50's completion history dated 2026-09-12 records that citation-free
specifications reached the Git evidence probe outside a repository. Feature
51's completion history dated 2026-09-12 records the same unresolved gap, and
Feature 52's completion history dated 2026-09-16 records it still unresolved.
These are three durable observations of one continuing problem, not three
independently reproduced failures; the two September 12 observations belong to
separate Feature records. Human intervention is recorded as none documented,
not a claim that none occurred. Low impact is tied to the history treating
this as a smaller follow-up item. The records do not establish the exact
input, command, error output, implementation location, quantified delay or a
later repair; none is inferred or reconstructed. No current reproduction on
main is claimed. Recording this observation authorizes neither a fix nor a
status transition.

## 007 — Local site page counts included untracked context files

<!-- pathfinder:improvement 007 -->

- Observed: 2026-09-12
- Source: completion
- Scope: project
- Category: workflow-friction
- Human intervention: none
- Impact: low
- Candidate improvement: Derive page-count evidence from canonical repository inputs, or explicitly identify counts influenced by local files
- Status: Approved
- Tracked in: `issue:95`
- Evidence: `doc:context/history.md#L65`, `issue:95`
- Occurrences: 2
  - 2026-09-12 — `doc:context/history.md#L65`, `issue:95`
  - 2026-09-16 — `doc:context/history.md#L49`

Feature 51 records that the site loader included gitignored Markdown under
context/, causing local page counts to overstate repository output. Feature 52
records the same behavior during its verification. Issue #95 documents 43
pages with a ticket loaded, 42 with it cleared, and 39 from tracked files at
the same commit. These numbers describe configurations of one investigation,
not three occurrences. The two occurrences are the distinct Feature completion
observations dated 2026-09-12 and 2026-09-16. Human intervention is recorded
as none documented. Low impact concerns reporting accuracy. Issue #95 reports
no affected deployed content or released artifact. Feature 50's historical
count is corroborating context, not an additional occurrence. No current page
count, current reproduction, quantified delay or later repair is inferred.
Recording this entry does not authorize fixing #95 or rewriting history.

## 008 — Live acceptance work recurred across Feature delivery tickets

<!-- pathfinder:improvement 008 -->

- Observed: 2026-09-12
- Source: completion
- Scope: workflow
- Category: workaround
- Human intervention: none
- Impact: medium
- Candidate improvement: Add guidance for when Feature delivery needs explicit integrated acceptance beyond individual ticket checks
- Status: Deferred
- Decision: Defer changes to slicing guidance until applicability criteria distinguish Features needing integrated acceptance from those adequately covered by existing ticket checks. (2026-10-06)
- Evidence: `doc:context/history.md#L58`, `issue:82`, `file:skills/to-tickets/SKILL.md#L50-L69`
- Occurrences: 3
  - 2026-09-12 — `doc:context/history.md#L58`, `issue:82`, `file:skills/to-tickets/SKILL.md#L50-L69`
  - 2026-09-16 — `doc:context/history.md#L45-L46`, `issue:101`
  - 2026-09-18 — `doc:context/history.md#L36`, `issue:110`

Three Feature records document explicit live acceptance work: Feature 51 on
2026-09-12, Feature 52 on 2026-09-16 and Feature 53 on 2026-09-18. Ticket 51.5
combined producer implementation with acceptance; 52.4 and 53.5 were
integrated-acceptance tickets. Feature 52 explicitly demonstrates defects
missed by individual gates; Feature 53's acceptance reported no product-code
repair. These are three instances of an explicit integrated-acceptance
practice, not three failures. Human intervention in the slicing decision is
none documented. Medium impact concerns integration verification. There is no
evidence that all three exposed integration defects, that all were dedicated
acceptance tickets, or that this practice suits every Feature. This
observation does not establish a rule that every Feature needs a dedicated
acceptance ticket.

## 009 — Feature 53 live proof resumed in Codex after usage-limit interruptions

<!-- pathfinder:improvement 009 -->

- Observed: 2026-09-18
- Source: orchestration
- Scope: workflow
- Category: workflow-friction
- Human intervention: none
- Impact: medium
- Candidate improvement: Define an explicit, human-controlled coordinator handoff or resume procedure when a harness becomes unavailable
- Status: Deferred
- Decision: Defer additional coordinator handoff guidance until durable evidence demonstrates a gap beyond the existing controlled resume and harness-substitution procedure. (2026-10-06)
- Evidence: `issue:110`, `doc:evidence/feature-53-acceptance.md#L13`, `doc:context/history.md#L37`
- Occurrences: 1
  - 2026-09-18 — `issue:110`, `doc:evidence/feature-53-acceptance.md#L13`, `doc:context/history.md#L37`

The issue #110 recovery comment
(https://github.com/rikilamadrid/pathfinder/issues/110#issuecomment-5727390335),
dated 2026-09-18, records initial Codex workers stopping at usage limits.
Replacement Codex sessions resumed preserved claims, branches, worktrees and
profiles under existing approval. Human intervention for the interruption is
none documented; recovery used existing approval. Medium impact concerns
interrupted execution. This was recovery of one interrupted live-proof run,
not separate occurrences. The acceptance record says no live Claude-to-Codex
substitution occurred. Exact interruption duration, a durable human decision
to wait and a rejected cross-harness handoff are not established. No
hours-long wait or rejected handoff is claimed, and whether another harness
could have resumed successfully is unknown.
