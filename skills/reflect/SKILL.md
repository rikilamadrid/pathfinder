---
name: reflect
description: Review completed work, separate project-specific knowledge from reusable workflow lessons, and propose evidence-based Pathfinder improvements for human approval.
---

# Reflect

Review completed work and identify evidence that the development workflow itself should improve.

## Purpose

Projects produce lessons.

Most lessons belong to the project.

Some reveal reusable weaknesses in the workflow.

Reflect identifies the difference and proposes improvements without changing Pathfinder automatically.

## When to use

Use Reflect after meaningful work such as:

* completing a feature
* resolving a difficult bug
* finishing a migration or refactor
* completing a project phase
* receiving significant human correction
* discovering repeated workflow friction

Do not invoke it after every trivial change.

## Goal

Answer one question:

> What did this execution teach us that could make a future execution better?

## Process

### 1. Reconstruct what happened

Review the relevant work, including where available:

* plans
* implementation
* tests and verification
* debugging history
* user corrections
* abandoned approaches
* resulting documentation

Do not rely on vague recollection when repository evidence is available.

### 2. Identify learning signals

Look specifically for:

* incorrect assumptions
* repeated mistakes
* unnecessary work
* missing verification
* steps performed too early or too late
* information that should have been discovered sooner
* human corrections
* repeated manual intervention
* useful techniques discovered during the work
* limitations in an existing Pathfinder skill
* gaps between Pathfinder's intended workflow and what actually happened

Success alone is not evidence that the workflow was good.

Failure alone is not evidence that the workflow must change.

### 3. Separate local knowledge from reusable learning

Classify each finding as one of:

#### PROJECT

Specific to this repository, stack, business domain, architecture, or team.

Keep it with the project.

Examples:

* a particular API requires a custom header
* this repository uses Vitest rather than Jest
* this service must start before another service

#### WORKFLOW CANDIDATE

Potentially useful across unrelated projects.

Examples:

* implementation began before existing behavior was established
* verification covered the happy path but ignored known edge cases
* debugging continued before the failure was reliably reproduced
* an undocumented dependency should have been discovered during system analysis

#### NOISE

Interesting but not useful enough to preserve.

Discard it.

### 4. Test generality

For every workflow candidate ask:

* Would this still make sense with another programming language?
* Would it still make sense with another framework?
* Would it still make sense in another business domain?
* Is it solving a recurring class of problem rather than this exact incident?
* Is Pathfinder already responsible for this?

If not, keep it project-specific.

### 5. Check for existing coverage

Before proposing anything new, inspect the existing Pathfinder workflow and skills.

Prefer improving an existing mechanism over adding another one.

Use this order:

1. already covered — no change
2. clarify existing documentation
3. improve an existing skill
4. add a workflow invariant
5. create a new skill only when it represents a distinct reusable operation

Avoid duplicate skills.

### 6. Require evidence

Every proposed Pathfinder improvement must include:

**Observation**

What happened?

**Evidence**

What concrete part of the execution demonstrates it?

**Generalization**

Why could this recur outside this project?

**Current gap**

Why does Pathfinder not already handle it?

**Proposed change**

What is the smallest change that would address it?

**Risk**

How could this rule become harmful or overly restrictive?

Do not promote intuition into workflow policy without evidence.

### 7. Prefer the smallest durable improvement

Do not respond to every problem by adding instructions.

Possible outcomes include:

* no change
* project documentation update
* AGENTS.md clarification
* existing skill improvement
* workflow invariant
* new skill candidate

The best reflection may conclude that Pathfinder should not change.

## Promotion rule

Reflect proposes.

Humans promote.

Do not silently modify Pathfinder's workflow, AGENTS.md, skills, or principles as part of reflection unless explicitly asked to implement the accepted recommendation.

One incident is evidence.

Repeated incidents are a pattern.

Patterns across different projects are strong candidates for Pathfinder.

## Output

Return:

### What happened

A concise summary of the relevant execution.

### What we learned

The important findings and their evidence.

### Classification

For each finding:

* PROJECT
* WORKFLOW CANDIDATE
* NOISE

### Pathfinder gaps

Only genuine gaps not already covered.

### Recommended changes

Ranked from highest to lowest value.

For each recommendation provide:

* target
* change
* evidence
* expected benefit
* risk of overgeneralization
* confidence

### No-change findings

Explicitly mention useful observations that should **not** modify Pathfinder and why.

## Principles

> Execution is evidence.

> Projects produce lessons. Pathfinder keeps the reusable ones.

> Prefer improving an existing rule over adding a new one.

> Generalize behavior, not technology.

> Reflect proposes. Humans promote.

> A workflow that cannot learn will repeat its mistakes.

> A workflow that learns everything will become unusable.
