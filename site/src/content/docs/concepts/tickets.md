---
title: Tickets
description: Why planned work is sliced into tickets before anyone implements it, and what a ticket has to be for the idea to work.
---

A feature is a planning outcome. A ticket is the executable unit: one slice of a
feature that a single session can implement, verify, and hand back with the
project still working.

[`to-tickets`](/skills/to-tickets/) reads one approved feature spec and creates
the tickets that execute it, in your [ticket store](/guides/ticket-stores/).
With no store configured that is local Markdown, and the tickets are files:

```text
context/tickets/27.1-read-saved-searches.md
context/tickets/27.2-csv-writer.md
context/tickets/27.3-download-endpoint.md
```

In a project whose store is GitHub Issues they are issues instead, and nothing
about the rest of this page changes. Each ticket carries the feature it belongs
to, what blocks it, what to read, what to change, and how to verify it.

## Stable is the load-bearing word

A ticket is not a task, a checklist item, or a percentage. It is a point at which
you could stop and still have a working project.

That definition is what makes the rest of the workflow possible. If ticket 2
leaves the build broken and ticket 3 repairs it, ticket 2 was never a boundary —
it was a save point in the middle of one long change, and everything that depends
on boundaries stops working:

- you cannot review a ticket that does not run,
- you cannot verify a claim about a ticket that does not run,
- you cannot hand off between sessions in the middle of one,
- and you cannot cheaply abandon a direction that turned out wrong.

## Blockers are explicit

A ticket names the tickets it cannot start without, by key, under
`## Blocked by`. Nothing is implied by file order or by the order the tickets
were written.

That is what makes "what can I work on now?" answerable: a ticket is ready when
its status allows it and every blocker is complete. Preferred order is not a
blocker, and two tickets that merely touch the same file are not blocked — that
is a merge, and the human resolves it.

## Why not just build the feature

Because a session ends. Context windows are finite, attention is finite, and a
feature built in one pass is a feature reviewed in one pass, at the end, when the
cost of having misunderstood it is highest.

Tickets move that cost forward. Implementation restates the goal, the active
ticket, the expected files, the risks, the verification plan, and what is out of
scope **before** anything is written — per ticket, not once per feature. Each
restatement is a cheap chance to catch a misunderstanding while it is small.

## The rules that keep them honest

- **One ticket at a time.** Implement the active ticket, verify it, and move on
  only when it is genuinely done.
- **A ticket is a slice, not a layer.** "Add the schema", "wire the UI", and
  "write the tests" are three halves of one ticket.
- **A ticket is not a place to hide a second feature.** If it needs its own
  dependencies, its own migration, and its own review, it is a feature.
- **Verification is per ticket.** "It will be tested at the end" means the
  boundary is decorative.

## Related

[Context boundaries](/concepts/context-boundaries/) limit what a feature loads;
tickets limit how much of it has to be understood at once. A feature whose
tickets cannot be made stable is usually a feature whose boundary is too wide.
