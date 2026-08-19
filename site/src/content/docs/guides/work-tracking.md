---
title: Work tracking
description: An optional, prose-configured projection of Pathfinder's feature specs onto GitHub Issues or local Markdown — off by default, and off until you configure it.
---

Pathfinder already has the units of work. A feature spec is a work item, and a
delivery chunk is a planning step inside one. What they lack is an *external
identity*: a stable ID, a visible dependency graph, and a status somebody outside
your repository can see.

Work tracking adds that, and only if you ask for it.

## It is off, and staying off is a valid choice

**There is no `context/tracker.md` in a fresh install, and its absence is the off
switch.** Nothing prompts you for one. No skill behaves differently because you
have not configured it. If you never run
[`setup-tracker`](/skills/setup-tracker/), every loop on
[the workflow page](/guides/workflow/) works exactly as documented and this page
describes a feature you do not have.

That is the intended state for most projects. A tracker earns its place when more
than one person — or more than one agent — needs to see what is queued and what
is blocked. A solo project with a roadmap in `context/features/` already has
that, in a better place.

## The repository is canonical

The single most important rule, and the one that decides how everything else
behaves:

**Sync is one-way.** The tracker is a *projection* of work that already exists in
`context/features/`. Nothing reads tracker state back into a spec. If the two
disagree, the repository is right and the tracker is stale.

So a ticked checkbox on a published item means nothing to Pathfinder. Someone can
tick it, and they may find that useful, but no state advances and nothing reads it
back. Editing a title on the tracker changes nothing either — items are matched by
key, never by title, precisely because humans edit titles.

This is what keeps a tracker from becoming a second source of truth that
disagrees with your repository at 4pm on a Friday.

## Configuring it

[`setup-tracker`](/skills/setup-tracker/) interviews you for which tracker you
use, where it lives, how an agent reaches it, and which tags your project
actually uses — then writes `context/tracker.md` from a shipped template, once
you approve it.

It asks one question that matters more than it looks: **what does your tracker
already carry?** If a label already means what a tag would mean, the config
reuses it and records the mapping instead of creating a near-duplicate beside it.
Pathfinder does not ship a project-management taxonomy for you to fight.

The result is prose. Not a schema, not a config format, and not a plugin — a
markdown file written for an agent to read and follow, which is why adding a
tracker adds no runtime, no dependency, and no credentials to the kit.

Configuring a tracker publishes nothing. `setup-tracker` describes where work
would go and stops there; the config is a file in your repository until something
reads it. Nothing contacts your tracker as a side effect of setting one up.

The skill that reads it is [`sync-tracker`](/skills/sync-tracker/), below.

### Where your specs live

The config names your **spec source** — the directory holding your approved
feature specs. Most projects leave them where [`to-specs`](/skills/to-specs/)
writes them, `context/features/`, and that is what a config gets when it says
nothing. You are only asked about it when your specs are somewhere else.

They are somewhere else more often than you would think. A repository that keeps
planning material out of version control, or splits specs by product area, or
inherited a layout from before Pathfinder, all have a source to declare.

**Moving your specs never changes a key.** A spec numbered `27` publishes as
`pathfinder:feature/27` wherever the file sits, so reorganising a directory does
not orphan a single published item. Keys come from the number, never the path —
which is also why the source is declared in the config's opening paragraphs and
never inside the backend-neutral model.

## Publishing it

[`sync-tracker`](/skills/sync-tracker/) reads the config and publishes your
approved feature specs onto whatever it describes. It publishes in dependency
order, blockers first, so an edge can name a real identifier by the time it is
written.

**With no `context/tracker.md`, it does nothing at all.** It reports that
tracking is not configured and stops — it will not offer to configure one, and it
does not treat the absence as a gap.

It publishes approved feature specs and nothing else. Not debate notes, not
kickstart output, not prototypes — with one exception: a prototype that gates a
decision may be published as a single item phrased as the decision it resolves.

It also does not decompose a feature into smaller assignable units. Choosing how
work is split between people or agents is a judgement, and the skill does not
make it for you.

Every field of a published item comes from the spec: the key from its number,
edges from its `## Dependencies`, chunks from its `## Delivery Chunks`, and tags
from an optional `## Tags` section — **and from nowhere else.** Tags are never
inferred from a title or from the paths a spec happens to mention. A spec with no
`## Tags` section publishes with no tags, which is correct and is what most
projects will do. Guessing would produce a taxonomy you did not choose, applied
to work you did not classify, looking authoritative on a shared board.

### A second run should be boring

This is the part worth understanding, because it is the part most likely to be
wrong somewhere else:

**Running `sync-tracker` again when nothing has changed creates nothing, edits
nothing, and issues zero writes.** Not writes that happen to be no-ops — no
writes. `3 items, 0 changes` is the expected output and the most important one.

Getting that right needs more care than it looks. A tracker is not obliged to
hand a body back exactly as it was sent, and APIs differ in whether they adjust
trailing whitespace. Where one does, a naive byte comparison reports every item
as changed on every run and rewrites all of them, forever. That failure *looks*
like working sync. It has a healthy report, a plausible diff, and a tracker full
of items whose "last updated" time is always now.

So comparison is normalized on both sides, tag sets are compared as sets rather
than ordered lists, and the body is composed as a pure function of the spec —
fixed section order, nothing derived from the run itself, no timestamps and no
counters. A body that varies between runs would rewrite everything even with
perfect comparison logic.

Two more rules follow from the same place. Items are **edited in place**, never
closed and recreated. And an item whose key is not in the current run is **left
completely alone** — it belongs to work outside this run, and nothing gives
`sync-tracker` licence to touch it.

### Your approval before it leaves the repository

**Publishing to a remote tracker asks first.** Creating items on a shared board
is outward-facing — other people get notified, and it is not the kind of thing an
agent should do as a side effect of tidying up. One approval covers the run, not
each item.

**Writing local files under `.work/` does not ask.** It is an ordinary file edit
that reaches nothing outside your repository. The boundary is about *leaving the
repository*, not about writing — which is why the same skill gates one projection
and not the other.

This is declared as an approval boundary in
[`context/ai-interaction.md`](/context/ai-interaction/), alongside commits and
releases, so you can widen or narrow it like any other.

## It happens during normal work

There is no "now update the tracker" stage to remember. Four skills you already
run each carry one conditional line, and each does nothing at all when no config
exists:

- [`to-specs`](/skills/to-specs/) offers to publish specs once it has written
  them.
- [`load-feature`](/skills/load-feature/) notes the tracked item for the feature
  being loaded.
- [`complete-feature`](/skills/complete-feature/) reconciles that item after the
  merge.
- [`start-feature`](/skills/start-feature/) **publishes nothing** — deliberately.
  A delivery chunk is a planning device inside a feature, and finishing one is
  not an event the outside world needs to hear about.

That last one is a line of prose whose whole job is to prevent something. It is
there so a tracker cannot quietly become the thing you work *for*, updated at
every internal boundary.

You can still run [`sync-tracker`](/skills/sync-tracker/) directly whenever you
want. The wiring means you rarely have to.

## Two projections, one model

The config has two halves. The **model** describes work items neutrally: a key, a
kind, blocked-by edges, tags, chunks, and a parent. The **projection** describes
how that model renders onto one particular tracker.

Two projections ship, both proven against real backends:

**GitHub Issues**, via the `gh` CLI. One work item becomes one issue. Blocked-by
edges become a `Blocked by` line naming each blocker by issue number and key.
Tags become labels, through a mapping table you can see and edit.

**Local Markdown files**, one file per work item under `.work/`. The same edges
become a `Blocked by` line naming files instead of issue numbers. Tags are
written out verbatim, because there is no label object to create.

The split is strict, and it is the point: **the model section is byte-identical
whichever projection you choose.** Only identifiers and tag rendering differ. An
edge names a key, never an issue number, so the same dependency survives being
pointed at a different tracker.

A tracker neither projection covers — Jira, Linear, something internal — is
supported by describing it in prose, using a shipped projection as the shape to
follow. That is the mechanism rather than a gap, and it is the reason the kit
does not need an adapter per vendor.

## What identifies an item

Every published item carries a marker block the tracker does not render:

```text
<!-- pathfinder:work-item
key: pathfinder:feature/06
kind: feature
blocked-by: pathfinder:feature/03
tags: area:site, type:infra, agent:suitable
chunks-projection: checklist
-->
```

Keys look like `pathfinder:<kind>/<id>` and are assigned by Pathfinder, never by
the tracker. The marker is how an item is recognised on a later run without
keeping a local index.

It is worth knowing why this one machine-readable token exists in an otherwise
prose system: **prose alone is not sufficient for identity.** Everything else in
the config can be reworded freely. Remove the marker and there is no way to
recognise an item a second time, which is what turns a re-run into a pile of
duplicates.

## Tickets are not delivery chunks

The model defines two kinds. A `feature` is one approved spec — one branch, one
review, one merge. A `ticket` is an independently assignable unit of execution
inside a feature, so more than one agent can work on it at once.

**A ticket is not a chunk.** Chunks are a planning device inside a spec and get
re-planned as work proceeds; tickets are units of execution. A ticket may span
several chunks, or belong to no chunk at all. Nothing derives one from the other.

A ticket names its feature with `parent`, and **parentage is never a blocking
edge** — a ticket is not blocked by its own feature. Rendering it as one produces
a dependency graph that can never unblock.

Both kinds are the same work item, with the same fields, the same marker, and the
same rules. Nothing in the model branches on which one it is.

## Related

[`setup-tracker`](/skills/setup-tracker/) is the skill that writes the config and
[`sync-tracker`](/skills/sync-tracker/) is the one that reads it.
[Human approval](/concepts/human-approval/) covers the decisions that stay yours,
and [the workflow](/guides/workflow/) shows the loops this sits beside rather
than inside.
