---
title: Decision states
description: TBD, None, N/A, and Deferred — four words that keep an unmade decision visible instead of letting it be guessed.
---

Project context is full of choices. Some are made, and some are not. The difference
has to survive being written down, or an agent reading the file later cannot tell a
decision from a blank.

Four states, used consistently:

```text
TBD        a human decision is still required
None       intentionally excluded
N/A        not applicable
Deferred   intentionally postponed
```

## Why four and not one

Because "empty" means at least four different things, and the difference matters to
whoever reads it next.

`None` and `N/A` are closed. Something was considered and ruled out, or never
applied — an agent should not raise it again, and a reviewer should not treat it as
an omission.

`Deferred` is open but not blocking. The decision is coming, later, on purpose.

`TBD` is the one with teeth. It means a human has to decide and has not yet, and it
is the only state that can stop work.

An empty field says none of that. It is indistinguishable from someone getting
bored halfway down the template — which is exactly the ambiguity an agent will
resolve in whichever direction is most convenient.

## The rule attached to TBD

**An agent must not silently resolve a `TBD` while implementing something else.**

This is the rule the states exist to support. Half-answered context is the normal
state of a real project, and without it every unmade decision quietly becomes made
by whoever was typing at the time.

[`CLAUDE.md`](https://github.com/rikilamadrid/pathfinder/blob/main/CLAUDE.md) says
it directly: if a policy is `TBD`, do not invent it — ask, or clearly mark it
unresolved. [`kickstart-pathfinder`](/skills/kickstart-pathfinder/) writes `TBD`
rather than choosing when it hears uncertainty. [`to-specs`](/skills/to-specs/)
reports blockers instead of specifying around them.
[`load-feature`](/skills/load-feature/) checks for missing decisions before
implementation and does not resolve them either.

## Where they appear

[`context/project-overview.md`](/context/project-overview/) declares the four states
near the top and uses them throughout — stage, prototype status, stack choices,
workflow policy. Feature specs use them for dependencies and open questions.

They are worth the small discipline of using the exact four words. A file that says
`TBD` in one place, `?` in another, and leaves a third blank has lost the property
that made the convention useful.

## Related

`TBD` marks a decision that is yours to make. [Human approval](/concepts/human-approval/)
covers the actions an agent stops for even when nothing is marked.
