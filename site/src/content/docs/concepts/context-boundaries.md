---
title: Context boundaries
description: Why every feature declares what to read and what to ignore, and what happens to an agent that reads everything.
---

A context boundary is a feature's explicit statement of what an agent should read
before working on it — and, just as important, what it should not.

Every feature spec carries one:

```text
## Context Boundary

Read:

- `[specific context and code]`

Avoid loading:

- `[unrelated systems, old specs, generated output]`
```

## Why the second list exists

An agent that reads your whole repository does not become better informed. It
becomes averaged. The signal it needs for one small change is diluted by every file
that has nothing to do with it, and the answers get vaguer as the input gets larger.

The failure is quiet, which is what makes it worth naming. Nothing errors. The
agent simply starts describing your architecture in general terms, misses the rule
that lives in the one file it skimmed, and produces work that looks right.

So the boundary is written down before implementation, in the spec, by the person
or skill that understands the feature — not discovered by an agent halfway through.

## What it looks like in a project

[`CLAUDE.md`](https://github.com/rikilamadrid/pathfinder/blob/main/CLAUDE.md) states
the default reading order for feature work: the current feature, its spec, the
relevant parts of the project overview and coding standards, the interaction rules,
and *only the source files the current delivery chunk needs*.

[`context/ai-interaction.md`](/context/ai-interaction/) states the discipline as a
rule: read the active feature and its dependencies, use the feature's own boundary,
avoid repo-wide scans unless the task genuinely requires one.

Neither is enforced by tooling. Both are markdown an agent reads.

## The signal that a boundary is wrong

If a feature's required context cannot be described briefly, the feature is too big.
That is not a documentation problem to write around — it is the spec telling you to
split it.

[`load-feature`](/skills/load-feature/) checks this before implementation starts and
will recommend splitting rather than proceeding. [`to-specs`](/skills/to-specs/)
tries to avoid producing such a feature in the first place, by sizing each one to a
coherent, bounded set of context.

A boundary that keeps getting exceeded during
[`start-feature`](/skills/start-feature/) is the same signal arriving late. Stop and
re-scope rather than widening it.

## Related

[Delivery chunks](/concepts/delivery-chunks/) are the other half of this: the
boundary limits what one feature loads, and chunks limit what one session inside
that feature has to hold at once.
