---
name: reflect
description: Review meaningful completed work to extract project-specific lessons, identify reusable Pathfinder workflow improvements, record them in the improvement ledger under human decision, and evaluate the quality of the reflection process itself.
argument-hint: "[record|harvest|resolve]"
---

# Reflect

Review completed work and identify evidence that the development workflow itself should improve.

## Process

With an action, read only `skills/reflect/actions/<action>.md` and follow it:

- `record` — write one observation, or one occurrence of an existing entry.
- `harvest` — read what the ledger says and turn repetition into proposals.
- `resolve` — record a decision a human already made.

With no action, run the reflection this file describes.

The actions give reflect a memory. They do not give it authority: reflect
supplies judgment, the engine records, and the human decides. Nothing here
writes any file but `context/improvement-ledger.md`, and nothing writes it
without the human saying so in this invocation.

## Purpose

Projects produce lessons.

Most lessons belong to the project.

Some reveal reusable weaknesses in the workflow.

Reflect identifies the difference and proposes improvements without changing Pathfinder automatically.

Reflect also evaluates its own effectiveness. When the reflection process itself proves inadequate, it may propose improvements to this skill.

> Projects produce lessons. Pathfinder keeps the reusable ones.

## When to use

Use Reflect after meaningful work such as:

* completing a significant feature
* resolving a difficult bug
* finishing a migration or refactor
* completing a project phase
* receiving significant human correction
* discovering repeated workflow friction
* encountering a surprising failure or assumption
* discovering that Pathfinder guidance was incomplete or ineffective

Do not invoke Reflect after every trivial change.

Reflection should produce signal, not ceremony.

## Goal

Answer two questions:

> What did this execution teach us that could make a future execution better?

And:

> Did the reflection process itself work well enough to discover that?

---

## Part 1 — Reflect on the work

### 0. Read the ledger, when there is one

If `context/improvement-ledger.md` exists, run the harvest before step 1 and
read its report as evidence alongside the repository:

```bash
node skills/reflect/engine/bin/ledger.mjs harvest
```

The report is what earlier executions already established, so it is evidence in
step 2 and in step 10. Reading it changes nothing: `harvest` writes no file and
moves no status. Without Node, read the ledger as the plain Markdown it is.

If the file does not exist, skip this step. A project with no ledger reflects
exactly as it always has: nothing below reads a new input, and every output
section is unchanged.

### 1. Reconstruct what happened

Review the relevant work and available evidence.

Inspect where relevant:

* plans
* implementation
* tests
* verification results
* debugging history
* user corrections
* rejected or abandoned approaches
* resulting documentation
* relevant commits or diffs
* existing Pathfinder guidance

Do not rely on vague recollection when repository evidence is available.

Distinguish what actually happened from what was intended to happen.

### 2. Identify learning signals

Look specifically for:

* incorrect assumptions
* repeated mistakes
* unnecessary work
* missing verification
* weak verification
* steps performed too early or too late
* information that should have been discovered sooner
* human corrections
* repeated manual intervention
* useful techniques discovered during the work
* limitations in an existing Pathfinder skill
* gaps between Pathfinder's intended workflow and what actually happened
* cases where an existing rule prevented a problem
* cases where following existing guidance still produced a poor result
* a signal the harvest already records, which makes this an occurrence of that
  entry rather than a new finding

Success alone is not evidence that the workflow was good.

Failure alone is not evidence that the workflow must change.

Where the harvest reported something, say which entry a signal matches, by id.
The second time something happens is the evidence; the first time is a note.

### 3. Separate local knowledge from reusable learning

Classify each finding as one of:

#### PROJECT

Specific to this repository, stack, business domain, architecture, environment, or team.

Keep it with the project.

Examples:

* a particular API requires a custom header
* this repository uses Vitest rather than Jest
* this service must start before another service
* a framework-specific workaround is required

#### WORKFLOW CANDIDATE

Potentially useful across unrelated projects.

Examples:

* implementation began before existing behavior was established
* verification covered the happy path but ignored known edge cases
* debugging continued before the failure was reliably reproduced
* an undocumented dependency should have been discovered during system analysis
* the agent repeatedly needed human correction for something the workflow could have surfaced earlier

#### NOISE

Interesting but not useful enough to preserve.

Discard it.

Not every observation deserves memory.

Close this step by offering, in one line, which findings are worth a ledger
entry — usually none, and never a routine success. Record one only if the human
says so, or already said so when they invoked this reflection: `/reflect record`
is the action that writes it.

### 4. Test generality

For every WORKFLOW CANDIDATE ask:

* Would this still make sense with another programming language?
* Would it still make sense with another framework?
* Would it still make sense in another business domain?
* Is it solving a recurring class of problem rather than this exact incident?
* Is Pathfinder responsible for this part of the process?
* Would following this guidance generally improve future work?
* Could the proposed rule unnecessarily constrain unrelated projects?

If the lesson fails these tests, keep it project-specific.

Generalize behavior, not technology.

### 5. Check for existing coverage

Before proposing anything new, inspect the existing Pathfinder workflow and skills.

Determine whether the lesson is already covered.

Prefer improving an existing mechanism over adding another one.

Use this order:

1. already covered — no change
2. clarify existing documentation
3. improve an existing skill
4. add or strengthen a workflow invariant
5. create a new skill only when it represents a distinct reusable operation

Avoid duplicate skills.

Do not respond to every failure by adding another instruction.

### 6. Require evidence

Every proposed Pathfinder improvement must include:

#### Observation

What happened?

#### Evidence

What concrete part of the execution demonstrates it?

#### Generalization

Why could this recur outside this project?

#### Current gap

Why does Pathfinder not already handle it?

#### Proposed change

What is the smallest change that would address it?

#### Risk

How could this rule become harmful, redundant, overly restrictive, or too specific?

#### Validation

How could future work demonstrate that the improvement actually helped?

Do not promote intuition into workflow policy without evidence.

### 7. Prefer the smallest durable improvement

Possible outcomes include:

* no change
* project documentation update
* AGENTS.md clarification
* existing skill improvement
* workflow invariant
* new skill candidate

The best reflection may conclude that Pathfinder should not change.

Every improvement adds maintenance and context cost.

An improvement should remove more uncertainty than complexity it introduces.

---

## Part 2 — Reflect on Reflect

Reflect is subject to the same evidence standard it applies to Pathfinder.

After completing the primary reflection, evaluate the quality of the reflection process itself.

This is bounded recursive self-improvement.

Its purpose is not to endlessly rewrite Reflect.

Its purpose is to discover whether Reflect systematically failed to do its own job.

### 8. Evaluate reflection quality

Ask:

* Did Reflect miss an important signal that was visible in the evidence?
* Did Reflect overgeneralize a project-specific issue?
* Did Reflect classify reusable knowledge as project-specific?
* Did Reflect propose something Pathfinder already covers?
* Did Reflect recommend unnecessary new rules or skills?
* Was the evidence requirement too weak?
* Were recommendations actionable?
* Was the reflection disproportionately verbose for the value produced?
* Did Reflect confuse an outcome with evidence?
* Did Reflect identify symptoms rather than the underlying workflow problem?
* Did a human reject or substantially correct the reflection?
* Has the same weakness appeared in previous uses of Reflect?

Do not search for a self-improvement merely because this section exists.

"No improvement needed" is a valid and desirable result.

### 9. Identify Reflect improvement candidates

If the reflection process itself demonstrated a meaningful weakness, classify it as:

#### REFLECT IMPROVEMENT CANDIDATE

This classification is reserved for improvements to `reflect/SKILL.md` itself.

Do not use it for general Pathfinder improvements.

For each candidate provide:

#### Observed weakness

What was inadequate about Reflect's behavior or reasoning?

#### Evidence

What concrete output, omission, human correction, or repeated failure demonstrates the weakness?

#### Root cause

What part of the current Reflect process allowed the weakness?

#### Proposed change

What is the smallest change to `reflect/SKILL.md` that could improve future reflections?

#### Regression risk

Could the change make Reflect:

* more verbose
* more rigid
* more repetitive
* biased toward finding problems
* prone to overgeneralization
* excessively conservative
* more expensive in context or execution time

#### Validation

What future behavior would demonstrate that the modification actually improved Reflect?

Do not recursively optimize stylistic preferences, wording preferences, or isolated cosmetic issues.

Self-improvements must materially improve reflection quality.

Close this step as step 3 closes: offer in one line which candidates are worth a
ledger entry, and record only on the human's word.

### 10. Evidence levels for self-improvement

Treat evidence for changes to Reflect according to three levels:

#### Level 1 — Incident

One reflection exposed a plausible weakness.

This may justify an improvement candidate.

It does not establish a general pattern.

#### Level 2 — Pattern

The same weakness has appeared across multiple reflections or required repeated human correction.

Where a ledger exists, this is what the harvest can show and recollection
cannot: an entry with occurrences of 2 or more, or two entries sharing a
category and a candidate. Cite the ids. Nothing else counts as history, and a
Level 1 claim cites none.

This provides stronger justification for changing Reflect.

#### Level 3 — Validation

A proposed change addresses the weakness and subsequent reflections demonstrate better behavior without obvious regression.

This is the strongest evidence that the improvement should remain.

When history is available, prefer patterns over isolated incidents.

Do not fabricate historical evidence. Without a ledger there is no history to
cite, and an incident stays an incident.

### 11. Bound the recursion

Reflect may perform only one self-evaluation pass per invocation.

The recursion is:

Work
→ Reflect on work
→ Reflect on Reflect
→ Stop

Do not perform:

Reflect
→ Reflect on Reflect
→ Reflect on the reflection of Reflect
→ continue recursively

Further improvement must happen through a future invocation with new evidence.

Recursive improvement should accumulate evidence across executions, not consume the current execution with unlimited meta-analysis.

---

## Promotion rules

### Pathfinder improvements

Reflect proposes.

Humans promote.

Do not silently modify Pathfinder's workflow, AGENTS.md, skills, templates, principles, or other durable guidance unless explicitly asked to implement an accepted recommendation.

### Reflect self-improvements

The same rule applies to Reflect itself.

Reflect may propose changes to `reflect/SKILL.md`.

It must not automatically rewrite its own skill definition unless the human explicitly approves implementation.

Self-reference does not lower the evidence threshold.

It raises it.

### The ledger changes none of this

Reflect proposes. Humans promote. An entry is evidence, not permission, and a
pattern in the ledger authorises nothing by existing.

Reflect may recommend recording an observation, recommend that a signal is an
occurrence of an entry it already has, read the harvest as evidence, and
recommend a proposal be `Proposed` or promoted into work.

Reflect may not record without the human's word in this invocation; may not
decide `Approved`, `Rejected`, `Deferred` or `Applied`; may not infer a status
from GitHub, Git, a pull request or a ticket; may not create product work from
an entry; and may not change how it or any other skill behaves because the
ledger says something.

An approved proposal goes the ordinary way — `to-specs`, or `to-tickets` on an
existing Feature, then the normal ticket loop. Reflect names the next action and
does not run it: planning belongs to the planner, and roles never call one
another.

---

## Output

Return only sections that contain meaningful information.

Do not inflate the output to satisfy the template.

### What happened

A concise reconstruction of the relevant execution.

### What we learned

The important findings and supporting evidence.

### Classification

For each meaningful finding:

* PROJECT
* WORKFLOW CANDIDATE
* NOISE

Omit trivial noise when it adds no value.

### Pathfinder gaps

Only genuine gaps not already covered.

If none exist, say so.

### Recommended changes

Rank recommendations from highest to lowest value.

For each recommendation provide:

* target
* proposed change
* evidence
* expected benefit
* risk of overgeneralization
* validation approach
* confidence

### No-change findings

Mention important observations that should not modify Pathfinder and explain why.

### Reflect self-evaluation

Briefly assess whether this reflection process itself performed adequately.

If no material weakness was discovered, state:

`No Reflect improvement proposed.`

Do not invent one.

### Reflect improvement candidates

Include this section only when evidence supports changing `reflect/SKILL.md`.

For each candidate provide:

* observed weakness
* evidence
* evidence level
* root cause
* proposed change
* regression risk
* validation
* confidence

---

## Files

- `skills/reflect/actions/record.md`, `harvest.md`, `resolve.md` — the three
  actions, read one at a time.
- `skills/reflect/engine/bin/ledger.mjs` — the engine. `record`, `resolve`,
  `harvest`, `validate`. It reads no clock, so every date is one a person gave
  it, and it writes no file but the ledger.
- `context/improvement-ledger.md` — the ledger itself, durable and tracked.
  Created from `templates/improvement-ledger.template.md` by the first
  observation recorded. A project without one is normal.
- `lib/evidence-references.mjs` — the `type:locator` evidence grammar the
  engine parses with, shared with `blog-post-redactor` and stated in one place.

Node is needed only for the three actions. A bare reflection reads the harvest
where Node is available and the ledger as plain text where it is not.

---

## Principles

> Execution is evidence.

> Projects produce lessons. Pathfinder keeps the reusable ones.

> Prefer improving an existing rule over adding a new one.

> Generalize behavior, not technology.

> Reflect proposes. Humans promote.

> Reflect is subject to the same evidence standard it applies to Pathfinder.

> Self-reference does not lower the evidence threshold.

> An improvement is not successful because it sounds better. It is successful because it performs better.

> Every improvement should remove more uncertainty than complexity it introduces.

> A workflow that cannot learn will repeat its mistakes.

> A workflow that learns everything will become unusable.

> Recursion should accumulate evidence, not meta-analysis.
