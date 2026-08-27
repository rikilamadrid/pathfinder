---
title: The workflow
description: Pathfinder's five loops as diagrams, with the points where the agent stops and a human decides marked on each one.
---

Pathfinder is five loops. One establishes what you are building, one analyzes an
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

→ kickstart-pathfinder     ask progressively; record context once it is clear
     ◆ undecided choices stay TBD, recorded ones stay proposed — correct
       or approve the recorded context before implementation begins

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

The output of this loop is `context/project-overview.md`
and its neighbors. Everything downstream treats those files as true, which is why
the loop ends on your approval rather than on the agent's satisfaction.

Choices that are not yet made are marked rather than guessed:

```text
TBD     a human decision is still required
None    considered and intentionally excluded
```

An agent must not quietly resolve a `TBD` while implementing something else.
[Decision states](/concepts/decision-states/) covers what each one commits you to.

## External reference analysis

When the project is inspired by an existing product, interface, repository,
animation, or implementation, that reference gets analyzed before product and
architecture decisions are made — not during them.

```text
external reference

→ reverse-engineer         separate observed behavior, inference, and unknowns
                           extract the transferable pattern
     ◆ you decide which reconstruction choices to adopt

→ prototype                validate the behavior that matters, if any is uncertain
     ◆ you approve the direction

→ to-specs                 convert the approved direction into planned work
```

[`reverse-engineer`](/skills/reverse-engineer/) produces a blueprint and hands off.
**A reconstruction blueprint is not a feature spec**, and it is not production code.
It states unknowns as unknowns, reproduces patterns rather than copying proprietary
code, assets, or branding, and does not claim to know a private or server-side
implementation from surface evidence.

The whole loop is aimed at one shape:

```text
understand the pattern
→ reconstruct the behavior
→ adapt it to the project
```

Not:

```text
copy the original product exactly
```

The difference is not only a legal one. A reconstruction you understand can be
changed later; a copy you do not understand is a dependency on a product you do
not control.

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
feature, one ticket at a time.

```text
project context

→ to-specs                 split the approved direction into small features
                           blockers are reported, not invented around

→ to-tickets               slice one approved feature into executable tickets
                           each names what blocks it, by key

→ /ticket load             prepare exactly one ticket, and its feature
                           fills context/current-ticket.md

→ /ticket start            implement that ticket
     ◆ dependencies, migrations, destructive commands, and commits
       all stop here for approval

→ /ticket review           check against requirements, regressions, standards

→ /ticket complete         confirm each acceptance criterion with evidence
                           and name the tickets that are now ready
     ◆ commit, merge, changelog, versioning, and release follow the policy
       you documented, requesting approval where that policy requires it

→ context/history.md       the durable record
```

Features are sized for a focused context window, not for ambition. A good one
creates a single visible or system-verifiable outcome, states what to load and what
to ignore, and can be verified on its own. "Build the backend" is not a feature. Two
ideas do the work here: [context boundaries](/concepts/context-boundaries/) and
[tickets](/concepts/tickets/).

`/ticket start` restates the goal, the active ticket, the files it expects to
touch, the risks, its verification plan, and what it considers out of scope
**before** it writes anything. Read that restatement. It is the cheapest place to
catch a misunderstanding — cheaper than the review, and far cheaper than the merge.

The [`ticket`](/skills/ticket/) page is the dispatcher: it names the four actions,
says what each one is for, and states the lifecycle they move a ticket through. Each
action's full procedure ships in the kit, under `skills/ticket/actions/`.

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

It is for a concrete unexpected behavior — a failing test, a runtime error, a
regression, incorrect output, an intermittent or environment-specific failure. It is
not for work that is merely hard:

```text
debug-issue    = an observed failure needs an explanation
/ticket start  = planned construction is difficult
/ticket review = completed implementation needs inspection for defects
learn-codebase = the real question is understanding the repository
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

A [reverse-engineering](/skills/reverse-engineer/) report does not enter this loop
either. It may explain a transferable concept well, and it is still analysis of
someone else's product — it does not stand in for `teach-feature`,
`teach-architecture`, `quiz-me`, `challenge-me`, or `learning-review`, which teach
and assess what *your* project actually implemented.

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

## Choosing a ticket store sits beside the loops, not inside one

Every project already has a ticket store: with no configuration it is local
Markdown files under `context/tickets/`, and the delivery loop above runs
against it exactly as drawn.

[`setup-tracker`](/skills/setup-tracker/) is for a project whose tickets belong
in GitHub Issues, Jira, Linear, Azure DevOps, or something internal. It is not a
step in any loop above, and running it changes no diagram on this page — the
same four actions read and write the same one ticket, wherever that ticket
lives.

It is filed separately for that reason. Placing it in the delivery loop would
imply every project has a step there, and most never run it.

[Ticket stores](/guides/ticket-stores/) covers what a store is, why there is
only ever one copy of a ticket, and what changing store later costs.

## Where you decide, in one list

Every `◆` above is one of two different things, and they live in two different
files. Worth keeping straight, because editing the wrong one changes nothing.

**Operations that need approval** — the agent would otherwise carry them out, so it
stops and asks first. Dependencies and build tooling, architecture migrations,
security-sensitive changes, destructive commands, Git history rewriting, commits and
releases, adopting prototype code, and writes that leave your repository. Declared in
[`context/ai-interaction.md`](/context/ai-interaction/), and that file is where you
widen, narrow, or pre-approve them.

**Decisions that stay yours** — not operations the agent pauses on, but choices it
never makes. Product and MVP scope, the stack and architecture, infrastructure,
prototype direction, and the reconstruction choices taken from an external
reference. The agent recommends, with reasoning; you choose. Editing
`ai-interaction.md` does not hand any of these over.

Git and delivery workflow is neither: an agent follows what
`context/project-overview.md` documents, and asks when
that is still `TBD`.

[Human approval](/concepts/human-approval/) covers all three in full.

## Next

If you have not installed anything yet, [Getting started](/guides/getting-started/)
runs the first loop end to end in a real repository. If you have, the skill you will
read most is [`ticket`](/skills/ticket/), which dispatches the four actions,
and [all skills](/skills/) lists every one of them with its own summary.
