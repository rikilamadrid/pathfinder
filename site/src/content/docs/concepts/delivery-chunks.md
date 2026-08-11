---
title: Delivery chunks
description: Why a feature is built in stable increments rather than in one pass, and what "stable" has to mean for the idea to work.
---

A delivery chunk is one stable increment of a feature. A feature is built as a
sequence of them, and the project works after every one.

Every feature spec declares its chunks up front:

```text
## Delivery Chunks

1. `[stable, verifiable increment]`
2. `[stable, verifiable increment]`
3. `[optional stable increment]`

Each chunk should leave the project stable.
```

## Stable is the load-bearing word

A chunk is not a task, a checklist item, or a percentage. It is a point at which
you could stop and still have a working project.

That definition is what makes the rest of the workflow possible. If chunk 2 leaves
the build broken and chunk 3 fixes it, then chunk 2 was never a boundary — it was a
save point in the middle of one long change, and everything that depends on
boundaries stops working:

- you cannot review a chunk that does not run,
- you cannot verify a claim about a chunk that does not run,
- you cannot hand off between sessions in the middle of one,
- and you cannot cheaply abandon a direction that turned out wrong.

## Why not just build the feature

Because a session ends. Context windows are finite, attention is finite, and a
feature built in one pass is a feature you review in one pass, at the end, when the
cost of having misunderstood it is highest.

Chunks move that cost forward. [`start-feature`](/skills/start-feature/) restates
the goal, the active chunk, the expected files, the risks, the verification plan,
and what it considers out of scope **before** writing anything — and it does that
per chunk, not once per feature. Each restatement is a cheap chance to catch a
misunderstanding while it is still small.

## The rules that keep them honest

- **One chunk at a time.** Implement the active chunk, verify it, and move on only
  when it is genuinely done.
- **A chunk is not a place to hide a second feature.** If it needs its own
  dependencies, its own migration, and its own review, it is a feature.
- **Verification is per chunk.** "It will be tested at the end" means the boundary
  is decorative.

[`context/current-feature.md`](/context/current-feature/) tracks which chunk is
active, so a session that starts cold knows where the last one stopped.

## Related

[Context boundaries](/concepts/context-boundaries/) limit what a feature loads;
chunks limit how much of it has to be understood at once. A feature whose chunks
cannot be made stable is usually a feature whose boundary is too wide —
[`load-feature`](/skills/load-feature/) will say so before implementation starts.
