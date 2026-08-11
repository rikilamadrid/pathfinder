---
title: The workflow
description: Pathfinder's five loops as diagrams, with the points where the agent stops and a human decides marked on each one.
---

Pathfinder is five loops. One establishes what you are building, one analyses an
external reference, one delivers features, one makes sure you understand what was
built, and one improves the workflow itself.

The skill pages describe each operation. This page is about the seams: the order the
loops run in, where one hands off to the next, and — marked on every diagram — the
points where the agent is supposed to stop and ask you something.

That last part is the whole design. An agent that never stops is faster and produces
a project you did not choose.

## Reading the diagrams

```text
→          a step, usually one skill
   ◆       the agent stops here; a human decides
```

Nothing enforces the stops. They are written into the skills and into
[`context/ai-interaction.md`](/context/ai-interaction/), which is a markdown file in
your repository that you can widen, narrow, or pre-approve parts of.

## Discovery and validation

From an idea, or an existing repository, to project context you approved.

```text
idea, or an existing repository

→ kickstart-pathfinder     ask progressively; classify what it hears
     ◆ you correct or approve the proposed context before it is written

→ debate-me                pressure-test product scope, stack, and workflow
                           every choice labelled `recommended`, never `approved`
     ◆ accept, modify, compare alternatives, leave items TBD, or
       prototype first — no approved context is written until you answer

→ prototype                validate one assumption, in the cheapest useful form
                           output lives under prototypes/, deliberately apart
     ◆ you approve, revise, replace, or stop the direction
     ◆ prototype code becomes production code only if you say so

→ project context          context/ now holds decisions, not guesses
```

A prototype is optional. [`debate-me`](/skills/debate-me/) recommends whether the
project needs an experience prototype, a technical proof of concept, an architecture
diagram, or nothing at all, and the cheapest useful format is the right one.

The output of this loop is [`context/project-overview.md`](/context/project-overview/)
and its neighbours. Everything downstream treats those files as true, which is why
the loop ends on your approval rather than on the agent's satisfaction.

Choices that are not yet made are marked rather than guessed:

```text
TBD        a human decision is still required
None       intentionally excluded
N/A        not applicable
Deferred   intentionally postponed
```

An agent must not quietly resolve a `TBD` while implementing something else.
[Decision states](/concepts/decision-states/) covers what each one commits you to.

## External reference analysis

When the project is inspired by an existing product, interface, repository,
animation, or implementation, that reference gets analysed before product and
architecture decisions are made — not during them.

```text
external reference

→ reverse-engineer         separate observed behaviour, inference, and unknowns
                           extract the transferable pattern
     ◆ you decide which reconstruction choices to adopt

→ prototype                validate the behaviour that matters, if any is uncertain
     ◆ you approve the direction

→ to-specs                 convert the approved direction into planned work
```

[`reverse-engineer`](/skills/reverse-engineer/) produces a blueprint and hands off.
**A reconstruction blueprint is not a feature spec**, and it is not production code.
It states unknowns as unknowns, reproduces patterns rather than copying proprietary
code, assets, or branding, and does not claim to know a private or server-side
implementation from surface evidence.

It may recommend a handoff. It must not quietly perform one:

```text
reverse-engineer = understand an external reference
learn-codebase   = understand the current codebase
kickstart        = initialize project context
prototype        = validate a proposed direction
to-specs         = convert an approved direction into planned work
```

## Delivery loop

The loop you spend most of your time in. One feature at a time, and inside a
feature, one delivery chunk at a time.

```text
project context

→ to-specs                 split the approved direction into small features
                           blockers are reported, not invented around

→ load-feature             prepare exactly one feature
                           fills context/current-feature.md

→ start-feature            implement one delivery chunk
     ◆ dependencies, migrations, destructive commands, and commits
       all stop here for approval

→ review-feature           check against requirements, regressions, standards

→ complete-feature         confirm each acceptance criterion with evidence
     ◆ commit, merge, changelog, versioning, and release follow the policy
       you documented, requesting approval where that policy requires it

→ context/history.md       the durable record
```

Features are sized for a focused context window, not for ambition. A good one
creates a single visible or system-verifiable outcome, states what to load and what
to ignore, and can be verified on its own. "Build the backend" is not a feature. Two
ideas do the work here: [context boundaries](/concepts/context-boundaries/) and
[delivery chunks](/concepts/delivery-chunks/).

[`start-feature`](/skills/start-feature/) restates the goal, the active chunk, the
files it expects to touch, the risks, its verification plan, and what it considers
out of scope **before** it writes anything. Read that restatement. It is the cheapest
place to catch a misunderstanding — cheaper than the review, and far cheaper than the
merge.

### When something breaks

The loop pauses. [`debug-issue`](/skills/debug-issue/) runs instead of the agent
guessing its way forward.

```text
observed failure

→ reproduce                establish expected vs actual, and reproduction status
→ hypotheses               a small ranked set, tested against discriminating evidence
→ root cause               a symptom disappearing does not count
→ smallest justified fix
     ◆ a fix needing an architectural, dependency, security, or destructive
       change stops here instead

→ verify against the original failure
→ back to the delivery loop
```

It is for a concrete unexpected behaviour — a failing test, a runtime error, a
regression, incorrect output, an intermittent or environment-specific failure. It is
not for work that is merely hard:

```text
debug-issue     = an observed failure needs an explanation
start-feature   = planned construction is difficult
review-feature  = completed implementation needs inspection for defects
learn-codebase  = the real question is understanding the repository
```

When the evidence runs out or the reproduction is too unstable to support a safe
fix, it reports what it has ruled out rather than thrashing.

## Learning and mentoring loop

Learning is part of the workflow, not an afterthought. The point is that you
understand the architecture, the tradeoffs, and the extension points of what the
agent helped build — otherwise you own a codebase you cannot change.

```text
a completed, verified feature

→ teach-feature            explain what was actually implemented, not an ideal
→ quiz-me                  measure understanding, varied question types
→ challenge-me             apply the concept in a changed context, when valuable
→ teach-architecture       connect features to the wider system, at milestones
→ learning-review          review accumulated lessons periodically; find the gaps
```

[`learn-feature`](/skills/learn-feature/) is the separate one: it turns a completed
feature into a self-contained interactive lesson you keep, rather than a
conversation you lose. [`learn-codebase`](/skills/learn-codebase/) works at
repository scale and is best used for onboarding, milestones, or interview
preparation — not after every change.

There is no `◆` in this loop. Nothing here changes your project.

## Workflow reflection loop

The other loops improve the project. This one improves the workflow.

```text
finished work

→ reflect                  reconstruct what actually happened
                           separate project knowledge from reusable lessons
                           propose the smallest durable improvement — often none
     ◆ you decide whether a proposal becomes part of Pathfinder

→ reflect on reflect       one bounded pass over its own performance
     ◆ same promotion rule; self-reference does not lower the bar

→ stop
```

> Projects produce lessons. Pathfinder keeps the reusable ones.
>
> Reflect proposes. Humans promote.

[`reflect`](/skills/reflect/) does not change Pathfinder, `AGENTS.md`, or any skill
on its own. It reviews work that is already finished, and it earns its cost after a
meaningful completion, difficult debugging, repeated human corrections, a surprising
discovery, or real workflow friction. Skip it for routine work.

A finding only becomes a workflow candidate if it would still hold in another
language, another framework, and another business domain. Everything else stays with
the project.

The self-check stops after one pass. It does not recurse, it does not go looking for
a problem because the section exists, and "no improvement needed" is the expected
result.

## Two utilities, outside every loop

[`handoff`](/skills/handoff/) preserves state between sessions or tools, for when a
context window ends before the work does. [`skillsmith`](/skills/skillsmith/) defines
and reviews a new local skill — used only after repeated real pain, when no existing
skill owns the responsibility.

Neither belongs to a loop, so neither is filed inside one.

## Where you decide, in one list

Every `◆` above, collected. Unless you have written otherwise into
[`context/ai-interaction.md`](/context/ai-interaction/), an agent following this kit
stops and asks before:

- product and MVP scope,
- technology stack and architecture,
- database, authentication, APIs, and infrastructure,
- prototype direction, and whether prototype code is ever adopted,
- reconstruction choices derived from external references,
- Git and delivery workflow,
- dependency or build-tool changes,
- destructive commands and file deletion,
- rewriting Git history,
- commits, merges, releases, and deployments.

The agent may recommend any of these, with reasoning. It does not choose them.
[Human approval](/concepts/human-approval/) explains where the list lives and how to
change it.

## Next

If you have not installed anything yet, [Getting started](/guides/getting-started/)
runs the first loop end to end in a real repository. If you have, the skill you will
read most is [`start-feature`](/skills/start-feature/), and [all skills](/skills/)
lists every one of them with its own summary.
