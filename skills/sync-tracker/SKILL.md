---
name: sync-tracker
description: Publish approved feature specs to the configured work tracker, one-way and idempotently, writing nothing when nothing has changed.
---

# Sync Tracker

Use this skill to project the project's approved feature specs onto the tracker
described in `context/tracker.md`.

The repository is canonical. This is a **one-way projection** of work that
already exists. Nothing here reads tracker state back into a spec,
`context/current-feature.md`, or `context/history.md`.

## The off switch comes first

**If `context/tracker.md` does not exist, do nothing at all.** Report that work
tracking is not configured for this project, and stop.

Do not create the config, do not propose configuring one, and do not describe
its absence as a gap. Work Tracking is optional, and a project without it is
behaving correctly.

## The config is the contract

Read `context/tracker.md` in full and follow its prose. It states the model, the
projection, and the publishing rules for this project.

There is **no adapter code, no vendor branch, and no required tool** beyond what
the config itself names. If the config describes a tracker this skill has never
heard of, that is the design working, not a blocker.

Where the config is silent on something a run needs, **ask the human**. Do not
fill the gap with a convention of your own — the next run would fill it
differently, and every item would look modified.

## What gets published

**Approved feature specs only**, from `to-specs` onward — one work item per spec.
Never debate notes, kickstart output, or prototypes. The one exception is a
prototype that gates a decision, published as a single item phrased as the
decision it resolves, never as a deliverable.

**Do not decompose a feature.** Choosing units of execution inside a feature is a
judgement about how work will be shared out, and it belongs to a human or to a
skill written for it. Publish the feature.

## Process

1. Check for `context/tracker.md`. If it is absent, report and stop.
2. Read the config. Read the approved specs. Read nothing else.
3. Build the work items: key, kind, title, body, blocked-by edges, tags, and
   chunks, derived and composed exactly as the config's model section says. Every
   field comes from the spec — **tags only from its optional `## Tags` section,
   never inferred.** A spec without one has no tags, which is correct and common.
4. Order them by dependency, blockers first. If the edges contain a cycle,
   report it and publish nothing — a guessed order is a wrong order that looks
   fine.
5. **Ask the human before the first write that leaves this repository.** See
   below.
6. Publish, following the config's *Publishing, and re-publishing* section
   exactly: index existing items by key, create what is missing, compare
   normalized, and leave an unchanged item completely alone.
7. Report what was created, what was edited, and what was left alone.

## The approval gate

**Ask before the first write to a tracker outside this repository in a session.**
Creating items on a shared board is outward-facing and is not covered by ordinary
file-edit approval. One approval covers the run; do not ask per item.

**A projection onto files inside this repository is not gated.** It is an
ordinary file edit and reaches nothing outside the repository. The gate is about
leaving the repository, not about writing.

## Idempotency is the whole feature

A second run over unchanged specs must **create nothing, change nothing, and
issue zero writes**. Not writes that happen to be no-ops — no writes.

- **Compare normalized, never raw bytes.** A tracker is not obliged to hand a
  body back exactly as it was sent, and APIs differ in whether they adjust
  trailing whitespace. Where that happens, a naive byte comparison reports every
  item as changed on every run and rewrites all of them forever, which looks like
  working sync and is not. Strip trailing whitespace from each line and collapse
  trailing blank lines at the end, **on both sides**, before comparing. It costs
  nothing when the round-trip is exact.
- **Compare tag sets as sets**, not as ordered lists. Application order is not
  preserved.
- Never close, reopen, delete, or recreate an item. Edit in place.
- Never touch an item whose key is absent from the current set. It belongs to
  work outside this run.
- Match on the key alone, never on the title.

**Report writes, not final state.** "The tracker looks right" is satisfied by a
run that rewrote every item, which is the specific failure this skill exists to
avoid. `3 items, 0 changes` is the expected result of a second run and the most
important line of output.

## Rules

- Do not add code, dependencies, or an adapter for any tracker.
- Do not branch on `kind`.
- Do not infer tags, and do not apply a value the config's mapping table does not
  carry. A spec naming an unmapped tag is a question for the human, not a
  judgement call.
- Do not drop an edge that resolves outside the published set, and do not invent
  an item for it. Resolve it against the tracker as a whole: render the item's
  identifier if the key already has one, and name the key as untracked only when
  it genuinely has none.
- Do not read anything back. A ticked checkbox means nothing to Pathfinder and
  never advances any state.
- Do not close, reopen, or delete anything, ever.
- Stop and report when the config, the specs, and the tracker disagree.

## Stop Condition

Stop once the run is reported. Configuring a tracker is `setup-tracker`, not this
skill. If a spec set is not ready to publish, say so rather than publishing part
of it.
