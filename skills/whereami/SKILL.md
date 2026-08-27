---
name: whereami
description: Report a compact read-only snapshot of the current Pathfinder work session.
---

# Where Am I

Answer one question: what is this session working on right now?

Use it when a session resumes, after a long gap, or before deciding the next
action. It reports state. It never changes it.

## Process

1. Role: report the role activated in this session via `/role`.
   Roles are session state and are never written to disk, so if no role was
   activated in this conversation, report `none`. Do not search `roles/`.
2. Read `context/current-feature.md` if it exists.
   Take Feature, Active ticket, and Next from it verbatim. The Feature number is
   the `NN` recorded there, from its spec filename.
   If the file is missing or still holds template placeholders, report `none`.
3. Run `git status --short --branch` once.
   Report the branch/ref, and `clean` or the count of changed paths.
4. Compare the Git section of `context/current-feature.md` with step 3.
   Report a drift line only if the recorded branch differs from the real one.
5. Context telemetry: report it only if this harness exposes it.
   Otherwise `unavailable`. Do not estimate.

## Output

Exactly this shape, one line each:

```
Role:    <role | none>
Feature: <## — name | none>
Ticket:  <key and name | none>
Git:     <branch/ref> — <clean | N changed>
Context: <telemetry | unavailable>
Next:    <single next action | none>
```

Add at most one line after it, and only when step 4 found drift:

```
Drift:   current-feature.md records <branch>, working tree is on <branch>
```

Then stop.

## Rules

- Read only. No writes, no commits, no `git` command that mutates anything.
- Read at most one file: `context/current-feature.md`.
- Do not open the feature spec, history, roadmap, `.features/`, or source.
- Report `none` or `unavailable` instead of inferring a missing value.
- Do not offer to fix drift, update state, or start the next action.
  The human decides what happens after the snapshot.

## Example

`/whereami` after resuming mid-feature:

```
Role:    developer
Feature: 12 — export saved searches
Ticket:  12.2 — CSV writer
Git:     feature/12-export-saved-searches — 3 changed
Context: unavailable
Next:    Verify the CSV writer against the acceptance criteria
```

## Anti-example

Do not do this:

```
Role:    developer (inferred from recent commits)
Feature: 12 — export saved searches
Ticket:  12.3 — probably the download endpoint
Git:     feature/12-export-saved-searches — 3 changed
Context: ~60% used
Next:    I can update current-feature.md and start ticket 12.3 — want me to?
```

It guesses the role from history, invents a ticket that was never written,
estimates telemetry it cannot see, and turns a status report into a proposal
to write state.
