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

The lifecycle also reads its responsibility boundary automatically. Discovery
and planning use `planner`; ticket load, start, and complete use `developer`;
ticket review uses `tester`. `/role` is an explicit human override, not a setup
step before any arrow on this page. Roles narrow responsibility and never grant
the human authority that the decision points reserve.

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

## Two ways to run the loop

Human-in-the-loop mode means you drive one ticket session, one transition at a
time. Orchestrator mode coordinates several dependency-safe workers, each in an
isolated worktree, through the same delivery loop:

```text
approved ticket graph
→ /orchestrate start → dispatch plan → ◆ scoped human approval
    ├─ developer A → tester A → integration assessment
    └─ developer B → human gate (A continues)
→ /orchestrate integrate → ◆ merge authority → /ticket complete <key>
→ refresh eligibility from the canonical graph
```

Orchestration assumes the `orchestrator` role, integration the `integrator`
role. Neither mode lets an agent accept its own work. Review is optional in a
human-driven session unless project policy requires it; orchestrated work gets
an independent tester before integration. [Execution modes](/guides/execution-modes/)
covers configuration, routing, status, gates, and recovery.

## Delivery loop

The loop you spend most of your time in. Each worker owns one active ticket;
the project’s execution mode determines who coordinates the workers.

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
  → record                 keep the ones worth keeping, with their evidence
                           ◆ you confirm each entry

  ↓ the improvement ledger accumulates

  → harvest                periodically: what repeated, what it suggests
                           propose the smallest durable improvement — often none
     ◆ you decide whether a proposal becomes part of Pathfinder

  → resolve                record your decision, and later what came of it

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

### The improvement ledger

Reflection without memory restarts every time. A reflection can see the execution in
front of it, and the thing that actually justifies changing a workflow — that this is
the third time — is exactly what it cannot see. So the judgment stayed good and the
evidence kept evaporating.

`context/improvement-ledger.md` is where it stops evaporating. One durable Markdown
file in `context/`, tracked in Git, holding observations about how delivery went and
what came of them. It is not a backlog and not a task list. It carries no authority:
nothing in it changes a skill, a role, a template or a contract, and an entry that
has been sitting there for a year has changed nothing by sitting there.

A project with no friction worth recording has no ledger at all, and that is a
perfectly good state to be in. Pathfinder creates it from
`templates/improvement-ledger.template.md` the first time you record something.

#### Observation, recurrence, proposal

Three different things, deliberately kept apart.

An **observation** is one thing that happened, with the evidence that shows it
happened. It is recorded because you said to.

A **recurrence** is the same thing happening again. It is an *occurrence* of the entry
that already describes it — a dated line under that entry — never a second entry. This
is the whole reason the file exists: one annoyance is an anecdote, and the count is
what turns it into a case.

A **proposal** is a reading of the ledger: this repeated, here is the smallest durable
change that would address it. Proposals come out of a harvest, and most harvests
produce none.

#### The lifecycle

```text
record → harvest → your decision → resolve
```

**`/reflect record`** writes one observation, or one occurrence of an entry that
already describes it. Reflect gathers the evidence from the repository and the tracker
rather than from recollection, classifies it, shows you the entry it would write, and
writes it once you confirm. An observation with no reference that resolves is refused,
and the refusal tells you what evidence would make it recordable.

**`/reflect harvest`** reads the ledger and reports what it says: open entries most
repeated first, repeated signals, entries you deferred that have happened again since,
entries awaiting a decision, and where approved work is tracked. Reflect then applies
its ordinary judgment to that report and writes any proposal in its usual evidence
format, citing entries by id.

**Your decision** is the only thing that moves an entry forward. Reflect recommends.

**`/reflect resolve`** records what you decided, with what the decision rests on.

#### Statuses

| Status | Means |
| --- | --- |
| `Open` | Recorded. Nothing decided. |
| `Proposed` | A live proposal, waiting on you. |
| `Approved` | You approved it, **and** a Feature, ticket or issue now tracks the work. |
| `Applied` | The work landed, and the evidence of it landing was checked. |
| `Rejected` | You decided against it, with your reason. |
| `Deferred` | Not now, with your reason. Comes back to `Open` if it recurs. |

`Open → Proposed → Approved → Applied` is the spine. `Rejected` and `Deferred` are
reachable from the two points where you are actually deciding something. `Applied` and
`Rejected` are terminal — reopening one is a new observation with its own evidence.

`Approved` and `Applied` both require a reference, because both are claims about the
world. `Rejected` and `Deferred` both require your reason and the date, because a
decision nobody can review later is not much of a record.

#### Evidence references

Every entry carries at least one reference in Pathfinder's `type:locator` grammar —
the same grammar the rest of the kit uses, stated once in `lib/evidence-references.mjs`:

```text
pr:126            issue:94           commit:5314c14
file:README.md#L1-L20                diff:skills/reflect/SKILL.md
doc:context/history.md               test:packages/reflect
changelog:[Unreleased]               cmd:npm test
```

The engine checks that a reference is well formed. Whether it is *true* — that the
pull request is the one that shows this, that the command still prints that — is
checked in the session, with you present, before anything is written.

#### Why harvest only reads

`harvest` changes nothing: no file, no status, no entry. It is deterministic in the
strong sense — the same ledger produces the same bytes on any machine, in any
directory, in any timezone. It reads no clock, which is why every date in the file is
one a person supplied.

That matters because a report you can re-run and diff is a report you can trust. If
reading the ledger could quietly reorganise it, you would never be sure whether a
pattern was found or manufactured.

#### Why reflect recommends and never approves

Reflect may notice a signal worth recording, recommend that it matches an entry it
already has, read the harvest as evidence, and recommend a proposal be considered or
promoted.

Reflect may not record because it noticed something without you saying so, decide
`Approved`, `Rejected`, `Deferred` or `Applied`, infer a status from GitHub, Git, a
pull request or a ticket, create work from an entry, or change how anything behaves
because the ledger says something.

> The engine records. Reflect supplies judgment. You supply authority.

A closed issue does not become `Applied` on its own, and a merged pull request does
not approve anything. Someone says those words or they are not true. Every status
change is a reviewed line in a tracked file, so the audit trail is just Git.

#### How approved learning becomes work

Nothing special. An approved proposal goes the ordinary way: `to-specs` for a new
Feature, or `to-tickets` on an existing one, then the normal ticket loop — implement,
review, complete. Reflect names the next action and does not run it; planning belongs
to the planner.

The ledger entry is then resolved to `Applied` with the merged pull request named, so
the entry ends up carrying its own provenance: what was observed, how often, what was
decided, and what shipped because of it. A year later that chain is still readable
from the file, without reconstructing anything from memory.

#### An entry, end to end

Synthetic, but shaped exactly like a real one.

You have just finished a ticket where the test suite passed locally and failed in CI
over a fixture path. It is the second time this month.

```bash
/reflect record
```

Reflect gathers the evidence, classifies it, and shows you what it would write. You
confirm — and because an entry already describes this, it records an occurrence rather
than a new entry:

```markdown
## 004 — CI fails on fixture paths that pass locally

<!-- pathfinder:improvement 004 -->

- Observed: 2026-01-08
- Source: review
- Scope: workflow
- Category: missing-contract
- Human intervention: correction
- Impact: medium
- Candidate improvement: Verification should run the suite the way CI runs it
- Status: Open
- Evidence: `pr:41`, `cmd:npm test`
- Occurrences: 2
  - 2026-01-08 — `pr:41`, `cmd:npm test`
  - 2026-01-22 — `pr:53`

The suite passed locally and failed in CI on a fixture path. The fix was
mechanical; finding it was not.
```

Weeks later, you harvest:

```text
## Repeated

- 004 — CI fails on fixture paths that pass locally (2 occurrences)
```

Reflect proposes the smallest durable change — a line in the ticket template's
verification section — citing `004` and its two occurrences. You approve it, and a
ticket exists:

```bash
/reflect resolve 004 Approved --in issue:212
```

The ticket goes through the normal loop. When its pull request merges:

```bash
/reflect resolve 004 Applied --in pr:219
```

The entry now records the whole chain, and the next harvest stops reporting it.

#### What it does not do

No dashboards, no charts, no scheduled harvests, no scoring, no staleness. No project
reports anything anywhere — a ledger is local to its repository and there is no
telemetry of any kind. And no entry, however many occurrences it has, changes anything
on its own.

## Communication, after the work is done

Every loop above points inward, at the project or at the workflow. This one points
outward. Blog Post Redactor turns work Pathfinder can prove happened into a
technical story worth publishing.

```text
a completed feature, ticket, or release

→ collect                   reconstruct what actually happened, read-only:
                            commits, diffs, pull requests, changelog, docs, tests

→ angles                    find three to five real stories in that evidence,
                            and recommend one with its reasoning
     ◆ you pick the story — the agent recommends, you choose

→ write                     write the chosen post, from the evidence alone

→ verify                    check the finished package against its own evidence
     ◆ you decide whether it gets published — the skill never posts

→ stop
```

The stages hand each other files rather than one long prompt, and that is the
design rather than an implementation detail. Collection runs before any story
exists, so it cannot be steered toward one; writing sees the collected evidence
and not the repository, so a paragraph that wants one more fact cannot go and
invent it.

What is mechanical and what is judgment is worth being precise about:

- **Evidence collection is deterministic where possible.** It runs an allowlist of
  read-only Git commands and changes nothing in your repository.
- **Story selection and writing require model judgment.** No script picks the
  angle or writes the prose, which is why the candidates are shown to you.
- **Verification can prove source references exist.** It fails the run when a
  citation does not resolve, when stated confidence outruns the evidence, or when
  anything outside the output directory changed.
- **Semantic overreach still requires the verification reading pass.** No check
  can tell that a sentence claims more than the source beneath it supports, so
  that stage directs a paragraph-by-paragraph read for overreach, false
  causation, and borrowed certainty. It is a reading pass, not a passing test.

A claim the repository cannot settle is cut, or marked
`[NEEDS HUMAN CONFIRMATION]` and listed in `metadata.json`. It is never quietly
asserted.

Output lands in `blog-posts/` — the evidence, the candidate angles, the article,
and social versions. [`blog-post-redactor`](/skills/blog-post-redactor/) has the
full pipeline.

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
prototype direction, which story a write-up tells, and the reconstruction choices
taken from an external reference. The agent recommends, with reasoning; you
choose. Editing
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
