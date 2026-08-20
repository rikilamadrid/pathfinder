---
title: Decision states
description: TBD and None — the two words that keep an unmade decision visible instead of letting it be guessed.
---

Project context is full of choices. Some are made, and some are not. The difference
has to survive being written down, or an agent reading the file later cannot tell a
decision from a blank.

Two words carry it:

```text
TBD     a human decision is still required
None    considered and intentionally excluded
```

## Why the distinction matters

Because "empty" means at least two different things, and the difference matters to
whoever reads it next.

`None` is closed. Something was considered and ruled out — an agent should not raise
it again, and a reviewer should not treat it as an omission.

`TBD` is the one with teeth. It means a human has to decide and has not yet, and it
is the only state that can stop work.

An empty field says neither. It is indistinguishable from someone getting bored
halfway down the template — which is exactly the ambiguity an agent will resolve in
whichever direction is most convenient.

## The rule attached to TBD

**An agent must not silently resolve a `TBD` while implementing something else.**

This is the rule the vocabulary exists to support. Half-answered context is the
normal state of a real project, and without it every unmade decision quietly becomes
made by whoever was typing at the time.

[`CLAUDE.md`](https://github.com/rikilamadrid/pathfinder/blob/main/CLAUDE.md) says
it directly: if a policy is `TBD`, do not invent it — ask, or clearly mark it
unresolved. [`kickstart-pathfinder`](/skills/kickstart-pathfinder/) writes `TBD`
rather than choosing when it hears uncertainty. [`to-specs`](/skills/to-specs/)
reports blockers instead of specifying around them.
[`load-feature`](/skills/load-feature/) checks for missing decisions before
implementation and does not resolve them either.

## Where they appear

`context/project-overview.md` declares `TBD` at the top and uses both words
throughout — stage, architecture, integrations, constraints. Feature specs use them
in `## Notes / Decisions` for a dependency or constraint that is not yet settled.

They are worth the small discipline of using the exact words. A file that says `TBD`
in one place, `?` in another, and leaves a third blank has lost the property that
made the convention useful.

## Why there is no status vocabulary

An earlier version of the overview template carried a second vocabulary —
`proposed`, `accepted`, `superseded` — in a `Status` column beside each recorded
choice, to say how far a written-down row had travelled toward being yours.

It no longer ships, and the reason is worth stating. Two vocabularies in one file
meant every row invited two questions, and the second one was almost always
answerable from the first: a `TBD` is not approved, and a filled-in line in a file
you reviewed is. The bookkeeping cost was real and the information was not.

Feature lifecycle status is a different thing and still exists — it lives in a
Feature spec's `## Status`, and [the workflow](/guides/workflow/) covers it.

## Related

`TBD` marks a decision that is yours to make. [Human approval](/concepts/human-approval/)
covers the actions an agent stops for even when nothing is marked.
