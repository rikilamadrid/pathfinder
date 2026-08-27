---
title: Ticket stores
description: Where your tickets live — local Markdown by default, GitHub Issues or another tracker when you configure one. Whichever you choose is the only place they exist.
---

A feature spec is planned work and lives in your repository. A ticket is the
executable slice of one, and it lives in your **ticket store**.

Every project has a store. With no configuration it is local Markdown files
under `context/tickets/`, which needs no credentials, no dependency, and no
decision from you.

## One ticket, one place

The rule that decides everything else:

**The configured store is canonical.** There is one ticket artifact and no copy
of it anywhere else. A project using GitHub Issues has its tickets in GitHub and
nothing under `context/tickets/`. A project using local Markdown has them in
`context/tickets/` and nowhere else.

Nothing publishes, projects, or synchronizes a ticket, because there is never a
second copy to reconcile. There is no sync command, and a stale mirror is not a
state Pathfinder can be in.

Local Markdown is a store on the same footing as the others, not a shadow copy
kept in step with a real tracker somewhere.

## Feature specs are not tickets

Specs stay in your repository, in `context/features/`, whatever store you
choose. They are the planning source the tickets were sliced from, and
[`to-tickets`](/skills/to-tickets/) reads them from there.

That split is the point. Planning is repository work you can read in a diff;
execution is ticket work that other people — and other agents — need to see.

## Choosing a store

With no `context/tracker.md`, you are already using local Markdown and nothing
prompts you about it. That is the intended state for most projects, and for a
solo project it is usually the right one for good.

[`setup-tracker`](/skills/setup-tracker/) is for a project whose tickets belong
somewhere else: GitHub Issues, Jira, Linear, Azure DevOps, or something
internal. It asks where tickets should live, then only for what is needed to
reach that store, composes a proposed `context/tracker.md`, shows it to you, and
writes it once you approve.

The result is prose. Not a schema, not a config format, and not a plugin — a
markdown file written for an agent to read and follow, which is why adding a
store adds no runtime, no dependency, and no credentials to the kit. A store the
kit has never heard of is supported by describing it, which is the mechanism
rather than a gap.

Configuring a store creates no tickets. `setup-tracker` describes where tickets
will live and stops there.

**Changing store later is a deliberate migration.** Nothing moves tickets
between stores automatically, and no skill reads two stores at once. Choose with
that in mind; it is a decision you make once.

## What identifies a ticket

A ticket's key is `NN.TT` — its parent feature's number, and the ticket number
within that feature. Blocker edges name keys and nothing else, so keys are never
reused and never renumbered.

Where tickets are files, the key **is** the filename: `context/tickets/`
holds `27.3-csv-download-endpoint.md`, and the key is read from the basename,
never from the directory above it or the title inside it. Titles are edited by
humans and are never the identity.

Where tickets are not files, your config says what carries the key — a marker in
the item body, a recorded issue number, a field the tracker offers. Which one is
your store's business. What the kit requires is only the property: a later
session must be able to find a ticket by its key.
[`setup-tracker`](/skills/setup-tracker/) asks, and a config that cannot answer
is not finished.

## Working against the store

The lifecycle does not change with the store. [`to-tickets`](/skills/to-tickets/)
creates tickets in it; the four actions of [`ticket`](/skills/ticket/) read and
write that same ticket:

```text
to-tickets         create the tickets in the store
/ticket load       read one ticket, and its blockers' state, from the store
/ticket start      record In Progress, then implement
/ticket review     verify against the ticket and its feature spec
/ticket complete   mark it complete, closing it where the store has a closed
                   state, then name the tickets now unblocked
```

Where your store has a native field for something — a status, a closed state, a
blocked-by link — that field is where it lives, and the ticket body does not
repeat it. Two copies of one ticket's status inside one ticket drift exactly as
fast as two copies in two systems.

Blocker state is read from the store. That is what makes "what can I work on
now?" answerable by anyone looking at the store, including people who never open
your repository.

## Your approval before it leaves the repository

**Writing to a remote store asks first.** Creating or updating items on a shared
board is outward-facing — other people get notified, and it is not something an
agent should do as a side effect of tidying up. One approval covers the run, not
each item.

**Writing local Markdown tickets does not ask.** That is an ordinary file edit
reaching nothing outside your repository. The boundary is about *leaving the
repository*, not about writing.

This is declared as an approval boundary in
[`context/ai-interaction.md`](/context/ai-interaction/), alongside commits and
releases, so you can widen or narrow it like any other.

## Related

[`setup-tracker`](/skills/setup-tracker/) chooses the store,
[`to-tickets`](/skills/to-tickets/) fills it, and [`ticket`](/skills/ticket/)
works against it. [Tickets](/concepts/tickets/) explains what belongs in one.
[Human approval](/concepts/human-approval/) covers the decisions that stay
yours.
