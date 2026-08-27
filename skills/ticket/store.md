# Where tickets live

The one statement of the ticket store. `to-tickets` reads it before creating
tickets; the `ticket` actions read it before touching one. Neither restates it.

## The store is canonical

Tickets live in exactly one place: the store the project configured. There is
one ticket artifact and no copy of it anywhere else.

Local Markdown is a store, not a mirror of one. A project using GitHub Issues
has its tickets in GitHub and nothing under `context/tickets/`; a project using
local Markdown has them in `context/tickets/` and nowhere else.

Nothing publishes, projects, or synchronizes a ticket, because there is never a
second copy to reconcile.

## Resolving it

- No `context/tracker.md` — the store is local Markdown at `context/tickets/`.
  That is the default store, not a fallback, and it needs no configuration, no
  credentials, and no dependency.
- `context/tracker.md` exists — it names the store, how to reach it, and how a
  ticket carries its key. Use what it names. If that store cannot be reached,
  report it and stop; do not write tickets somewhere else.

## Identity

A ticket's key is `NN.TT` — its parent Feature's number, and the ticket number
within that Feature. Keys are never reused and never renumbered: blocker edges
are matched on them.

Where tickets are files, the key is the filename, `NN.TT-slug.md`, read from the
basename and nowhere else — never from the directory above it, the title inside
it, or the order the tickets happen to be read in.

Where they are not files, the key is carried the way `context/tracker.md` says,
and that is what a later run matches on. Titles are edited by humans and are
never the identity.

## Writing to it

- `to-tickets` creates the tickets.
- `/ticket load` and `/ticket start` record the status transitions the lifecycle
  defines.
- `/ticket complete` marks the ticket complete, closing it where the store has a
  closed state.

`templates/ticket.template.md` is the ticket's content in any store. Where the
store has a native field for something the template carries — a status, a
closed state, a blocked-by link — that field is where it lives, and the body
does not also carry it. Two copies of one ticket's status in one ticket drift
exactly as fast as two copies in two systems.

Match the store's own conventions when it has them — an issue's state, a label
the config names — rather than writing Pathfinder's vocabulary into a field that
does not mean it.

Ask for approval before the first write of a run that leaves this repository.
One approval covers the run. Writing a Markdown ticket inside the repository is
an ordinary file write and is not gated.

## What is not in the store

Feature specs. They stay in the repository, are read from there, and are the
planning source the tickets were sliced from.

## Changing stores

Moving a project from one store to another is a human migration, done
deliberately and once. Nothing here moves tickets between stores, and no skill
reads two stores at the same time.
