---
name: to-tickets
description: Decompose one approved Feature spec into small, blocker-linked tickets.
---

# To Tickets

Turn one approved Feature into the tickets that execute it.

A Feature is the planning outcome. A ticket is the executable unit of work: one
vertical slice a fresh session can implement, verify, and hand back with the
project still working.

## Process

1. Read the Feature spec named by the human. If none was named, list the specs
   in the spec source and stop.
2. Stop if the Feature still carries an unresolved human decision or a `TBD`.
3. Read only the source the Feature's `## Context` names, and only enough of it
   to size the work honestly.
4. Decide the slices. See Slicing below.
5. Create `context/tickets/` if it does not exist.
6. Write each ticket from `templates/ticket.template.md`, named `NN.TT-slug.md`
   — see Identity below.
7. Record blockers as ticket keys under each ticket's `## Blocked by`. Verify
   the edges form a directed acyclic graph before writing. A cycle is a slicing
   mistake, not a ticket to write.
8. Present the tickets, the blocker graph, and which tickets are ready now.
9. If `context/tracker.md` exists, say that these tickets are not published:
   `sync-tracker` projects Feature specs, not tickets. Do not publish them
   yourself, and do nothing here when no config exists.

## Identity

A ticket is `context/tickets/NN.TT-slug.md`, for example
`context/tickets/27.3-csv-download-endpoint.md`.

`NN` is the parent Feature's number, taken from its spec filename. `TT` is the
next unused ticket number within that Feature, counting every ticket already
there whatever its status.

The key is `NN.TT`, read from the basename and nowhere else. Keys are never
reused and never renumbered: a blocker edge and a published tracker item are
both matched on that key, and renumbering orphans them.

## Slicing

A ticket is a tracer bullet, not a layer.

Each one must:

- deliver an observable change, end to end, however thin
- leave the project working when it lands
- be implementable by one session that reads the ticket, its parent Feature, and
  nothing else
- be verifiable by a command to run or a behavior to observe

Do not slice by layer, by file, or by phase. "Add the schema", "wire the UI",
and "write the tests" are three halves of one ticket.

Prefer fewer, larger tickets over many small dependent ones. Every blocker edge
is a session that has to wait.

Split when the work has genuinely separate outcomes, needs meaningfully
different context, or has a real dependency between its parts.

## Blockers

An edge means the later ticket cannot start until the earlier one is `Complete`.

- Name only real dependencies. Preferred order is not a blocker.
- Never write an edge to a ticket of another Feature that does not exist yet.
- Two tickets that only touch the same file are not blocked; they are a merge
  the human resolves.

## Status

A ticket's `## Status` is its durable lifecycle state:

`Proposed` → `Ready` → `In Progress` → `Complete`

`Cancelled` and `Superseded` are terminal alternatives.

This skill writes `Proposed` and nothing else. Promotion belongs to the
execution loop.

## Rules

- Do not implement.
- Do not invent unresolved decisions or resolve a `TBD`.
- Do not plan beyond the Feature you were given.
- Do not rewrite the Feature spec. Report a Feature too vague to slice, and stop.
- Do not add metadata the ticket template does not carry.
- Do not scan unrelated repository areas.
