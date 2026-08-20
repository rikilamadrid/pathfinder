---
title: Work tracking
description: An optional, prose-configured projection of Pathfinder's feature specs onto GitHub Issues or local Markdown — off by default, and off until you configure it.
---

Pathfinder already has the units of work. A feature spec is a work item, and a
delivery chunk is a planning step inside one. What they lack is an *external
identity*: a stable ID and a status somebody outside your repository can see.

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

**Sync is one-way.** The tracker is a *projection* of work that already exists
in your repository, in the spec source your config names — `context/features/`
unless you say otherwise. Nothing reads tracker state back into a spec. If the
two disagree, the repository is right and the tracker is stale.

So a ticked checkbox on a published item means nothing to Pathfinder. Someone can
tick it, and they may find that useful, but no state advances and nothing reads it
back. Editing a title on the tracker changes nothing either — items are matched by
identity, never by title, precisely because humans edit titles.

This is what keeps a tracker from becoming a second source of truth that
disagrees with your repository at 4pm on a Friday.

## Configuring it

[`setup-tracker`](/skills/setup-tracker/) asks where work should be tracked —
GitHub Issues, local Markdown files, or another tracker you describe — and then
only for the information needed to reach it. It composes a proposed
`context/tracker.md`, shows it to you, and writes it once you approve.

No tracker template ships with the kit. The config is written to fit the tracker
you named rather than trimmed down from a long stencil of fields for trackers you
do not use, and creating a near-duplicate beside it.
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

**Moving your specs never changes a key.** Every spec is named
`NN-feature-name.md`, and that `NN` is the feature number — so
`27-export-saved-searches.md` publishes as `pathfinder:feature/27` in whichever
directory it sits, and reorganising one orphans nothing. The number lives in the
filename because the spec itself has nowhere to put it: the eight-section
template carries no number field, and adding one would mean two places to keep
in agreement.

## Publishing it

[`sync-tracker`](/skills/sync-tracker/) reads the config and publishes your
approved feature specs onto whatever it describes.

**With no `context/tracker.md`, it does nothing at all.** It reports that
tracking is not configured and stops — it will not offer to configure one, and it
does not treat the absence as a gap.

It publishes approved feature specs and nothing else. Not debate notes, not
kickstart output, not prototypes.

It also does not decompose a feature into smaller assignable units. Choosing how
work is split between people or agents is a judgement, and the skill does not
make it for you.

Nor does it build a dependency graph. A spec may say under `## Notes /
Decisions` that it waits on another feature, and that sentence is for a person
to read — the slim feature contract has no structured dependency field, so there
is nothing to parse and sync publishes no edges and orders nothing. Ordering
work is a judgement too.

Every field of a published item comes from the spec — the key from the number in
its filename, the title and body from its content — **and from nowhere else.** Labels, tags,
and status are never inferred from a title or from the paths a spec happens to
mention. The feature template carries no tag section at all, so a published item
arrives unlabelled unless your tracker config says otherwise. Guessing would
produce a taxonomy you did not choose, applied to work you did not classify,
looking authoritative on a shared board.

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

So comparison is normalized on both sides, tags — where your config defines any
— are compared as sets rather than ordered lists, and the body is composed as a
pure function of the spec: fixed section order, nothing derived from the run
itself, no timestamps and no counters. A body that varies between runs would
rewrite everything even with perfect comparison logic.

Two more rules follow from the same place. Items are **edited in place**, never
closed and recreated. And an item whose key is not in the current run is **left
completely alone** — it belongs to work outside this run, and nothing gives
`sync-tracker` licence to touch it.

### Your approval before it leaves the repository

**Publishing to a remote tracker asks first.** Creating items on a shared board
is outward-facing — other people get notified, and it is not the kind of thing an
agent should do as a side effect of tidying up. One approval covers the run, not
each item.

**Writing local Markdown files does not ask.** A local projection writes one
file per Feature into the directory your config names, which is an ordinary file
edit that reaches nothing outside your repository. The boundary is about *leaving the
repository*, not about writing — which is why the same skill gates one projection
and not the other.

This is declared as an approval boundary in
[`context/ai-interaction.md`](/context/ai-interaction/), alongside commits and
releases, so you can widen or narrow it like any other.

## It happens during normal work

There is no "now update the tracker" stage to remember. Three skills you already
run each carry one conditional line, and each does nothing at all when no config
exists:

- [`to-specs`](/skills/to-specs/) offers to publish specs once it has written
  them.
- [`load-feature`](/skills/load-feature/) names the tracked item for the feature
  being loaded.
- [`complete-feature`](/skills/complete-feature/) reconciles that item after the
  merge.

[`start-feature`](/skills/start-feature/) carries no such line, deliberately. A
delivery chunk is a planning device inside a feature, and finishing one is not an
event the outside world needs to hear about — so a tracker cannot quietly become
the thing you work *for*, updated at every internal boundary.

You can still run [`sync-tracker`](/skills/sync-tracker/) directly whenever you
want. The wiring means you rarely have to.

## What the config carries

The config is prose, and it carries only what your tracker actually needs: where
work is tracked, how an agent reaches it, and how a Feature spec should appear
once it gets there.

Two backends are well-trodden and worth naming, because both have been driven
against the real thing:

**GitHub Issues**, via the `gh` CLI. One Feature becomes one issue.

**Local Markdown files**, one file per Feature under a directory you name. This
reaches nothing outside your repository, which is why it needs no credentials and
no approval to write.

A tracker neither covers — Jira, Linear, something internal — is supported by
describing it in prose. That is the mechanism rather than a gap, and it is the
reason the kit does not need an adapter per vendor.

Earlier versions shipped a `templates/tracker.template.md` carrying a full
backend-neutral work-item model: item kinds, blocked-by edges, tag mapping tables,
chunk projections, and a machine-readable marker block. None of it ships now. It
was a project-management taxonomy the kit was asking you to adopt in order to use
a feature most projects do not turn on, and the great majority of a 370-line
stencil was fields for trackers nobody had configured.

## What identifies an item

**Items are matched by identity, never by title** — which is what makes a second
run boring rather than duplicating everything the moment somebody rewords a
heading on the board.

The key itself comes from the number in the spec's filename, never from the
directory above it or the title inside it: `27-export-saved-searches.md` is
`pathfinder:feature/27` wherever it sits.

How that key is recorded on the tracker is your config's business, because it
depends on the tracker. A marker comment in the item body and a recorded issue
number both work, and [`setup-tracker`](/skills/setup-tracker/) asks which. What
the kit requires is only the property: a re-run has to recognise the item it
published last time. Without that, sync is a duplicate generator.

Pathfinder does not decompose a Feature into smaller assignable tickets, and
[`sync-tracker`](/skills/sync-tracker/) says so in as many words. Splitting work
between people or agents is a judgement, and the skill does not make it for you.
Delivery chunks stay a planning device inside a spec, which is why finishing one
publishes nothing.

## Related

[`setup-tracker`](/skills/setup-tracker/) is the skill that writes the config and
[`sync-tracker`](/skills/sync-tracker/) is the one that reads it.
[Human approval](/concepts/human-approval/) covers the decisions that stay yours,
and [the workflow](/guides/workflow/) shows the loops this sits beside rather
than inside.
