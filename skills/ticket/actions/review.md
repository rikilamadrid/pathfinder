# Ticket: Review

Review the actual diff and behavior, not only the developer's summary.

## Assumed role

Unless the human explicitly activated a role, assume `tester` for this
invocation: read `roles/tester.md` and follow it. An explicit role overrides
this default. A role narrows responsibility and never grants human authority.

Read the ticket from the store, and its parent Feature spec from the
repository. The ticket says what this slice had
to do; the Feature says what the work as a whole is for.

## Check

- the ticket's `## Verification`, run rather than assumed
- the ticket's `## Changes`, and whether anything outside them was changed
- the parent Feature's acceptance criteria this ticket was supposed to advance
- regressions and important edge cases
- security/privacy when relevant
- accessibility, performance, compatibility, and operations when relevant
- tests and verification
- scope creep, including work that belongs to another ticket
- documentation accuracy

Use the project's quality priorities and existing standards where relevant.

## Output

Report:

- `PASS`, or findings by severity
- file/location and impact for each finding
- what was actually verified
- anything important that remains unverified

A finding this review or the human defers rather than repairs is reported as
`deferred`, with its actual text and its evidence, so it is not lost; whether it
becomes a ledger observation later is a separate, explicit act, and review still
writes no durable state.

Do not modify the implementation unless the human explicitly asks.

Do not invent findings or treat passing tests as automatic acceptance.

Do not write the ticket's `## Status`, and do not touch the parent Feature's.
Review is workflow activity, not lifecycle state, and a reviewed ticket stays
`In Progress` until it is completed.

## Orchestrated checkpoint

Human-in-the-loop review writes no checkpoint and remains optional. In a claimed
orchestrator worktree, identify the current PR URL and exact full head SHA,
confirm the reviewed checkout matches it, and read the matching `## Adversary
experiments` report before independently checking its contracts and uncertainty.
Only a recorded legacy-review exception for that head or
`Review: integration:<head SHA>` for unchanged-behavior revalidation bypasses
experiments. Suspected experiments are not confirmed findings.

Before returning PASS/findings, write `## Tester findings` with a directly
attached JSON fence using
`node skills/orchestrate/engine/findings.mjs --checkpoint < <scratch-review.json>`.
Use an ignored scratch file in this claim. Preserve all other sections and
fields, including the profile and previous head identifiers. The report has
exactly `ticket`, `pr`, `head_sha`, `result` (`PASS` or `findings`), `findings`,
`verification` (1–20 non-empty actual check descriptions), and `limits`.
`PASS` has an empty findings array; `findings` has 1–12 complete findings,
each with exactly `severity`, `location`, `impact`, `evidence` (1–20 existing
`type:locator` references), and `repair_instruction`. Strings are non-empty,
at most 2048 characters; the entire JSON is at most 32 KiB. This checkpoint is
transient, not a durable regression record or acceptance decision.

Re-query the PR head before ending; head drift makes this evidence stale.
Write the complete report before the coordinator advances to Developer repair.
Missing/incomplete findings remain Tester work; `Last` and live prompts cannot
substitute for them. Tester changes no State, implementation, tests, ticket or
Feature lifecycle status. The coordinator alone records the subsequent phase.
