---
name: sync-tracker
description: Project Feature specs onto the configured work tracker.
---

# Sync Tracker

Sync project Features to the tracker configured in `context/tracker.md`.

The repository is canonical.
Tracker state never changes Pathfinder state.

## Process

1. If `context/tracker.md` does not exist, report that tracking is not
   configured and stop. Do not propose configuring one.
2. Read the tracker configuration. It names the tracker, how to reach it, the
   spec source, and how a published item records its Pathfinder key. Stop if it
   does not say how the key is recorded — without it a re-run cannot recognise
   what it published last time, and would duplicate every item.
3. Read the approved Feature specs from the spec source. A config that names
   none means `context/features/`. If the named source does not exist, report
   it and stop rather than falling back.
4. Build one item per Feature: key, title, and body, composed only from the
   spec.
5. Show the proposed writes.
6. Ask before the first write that leaves this repository. One approval covers
   the run. A projection onto files inside the repository is an ordinary file
   write and is not gated.
7. Create or update only the items that changed.
8. Report created, updated, and unchanged as counts of writes, not as final
   tracker state.

## Identity

Each Feature has one stable key derived from the number in its spec filename.
`to-specs` names every spec `NN-feature-name.md`, so
`27-export-saved-searches.md` is `pathfinder:feature/27` in whichever directory
it sits — moving specs orphans nothing.

Read the number from the basename only. Never from the directory above it, the
title inside it, or the order the specs happen to be read in.

Match published items on that key alone. Titles are edited by humans.

Skip a spec whose filename carries no number and report it by name. Do not
assign one — numbering is `to-specs`' job, and inventing one here would publish
an item that the next run cannot recognise.

## Idempotency

A second run over unchanged Features must issue **zero writes** — not writes
that happen to be no-ops.

- Compose the body as a pure function of the spec: fixed section order, no
  timestamps, no counters, nothing derived from the run.
- Compare normalized, never raw bytes. Strip trailing whitespace per line and
  collapse trailing blank lines, on both sides. A tracker is not obliged to
  return a body byte-for-byte, and a naive comparison then rewrites every item
  forever while looking like working sync.
- Where the config defines tags, compare them as sets, not ordered lists.
- Edit in place. Never close, reopen, delete, or recreate an item.
- Leave any item whose key is absent from this run completely alone.

`3 items, 0 changes` is the expected second run and the most important line of
output.

## Rules

- Do not decompose Features into tickets.
- Do not derive dependency edges, ordering, or a graph from a spec. A Feature
  may mention a dependency under `## Notes / Decisions` for a human to read;
  it is prose, not structure, and this skill does not parse or orchestrate it.
- Do not infer labels, tags, status, or other metadata.
- Do not modify Feature specs from tracker state.
- Do not read tracker state back into anything.
- Do not delete tracker items automatically.
- Do not rewrite unchanged items.
- Local Markdown tracking is an ordinary repository/file write.
- External trackers require human approval before writing.
- Stop and report when the config, the specs, and the tracker disagree.
