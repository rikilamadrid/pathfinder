---
name: debug-issue
description: Diagnose an observed software failure systematically, identify the root cause with evidence, apply the smallest justified fix, and verify the failure is resolved without introducing regressions.
---

# Debug Issue

Debug an observed failure by reducing uncertainty before changing code.

The goal is not to try fixes until something works.

The goal is to explain the failure well enough that the smallest correct fix becomes justified.

> Reproduce before repairing.

## When to use

Use Debug Issue when there is a concrete unexpected behavior such as:

* a failing test
* runtime error
* broken feature
* regression
* incorrect output
* integration failure
* environment-specific failure
* intermittent behavior that needs isolation
* production or staging behavior that differs from expectation

Do not use it merely because implementation work is difficult.

If the task is planned feature construction, use `start-feature`.

If the goal is reviewing completed implementation for possible defects, use `review-feature`.

If the real question is broad understanding of the repository, use `learn-codebase`.

## Goal

Answer:

> What is failing, why is it failing, and what evidence proves the explanation?

Then apply the smallest justified correction and verify the original failure no longer occurs.

## 1. Establish the failure

Before proposing a fix, define:

* expected behavior
* actual behavior
* where the failure occurs
* how it was observed
* whether it is reproducible
* relevant environment or conditions
* known recent changes when relevant

Prefer the smallest reliable reproduction.

If the failure cannot be reproduced, preserve the available evidence and state that limitation explicitly.

Do not manufacture certainty.

## 2. Inspect before changing

Read only the code, logs, tests, configuration, dependencies, and context relevant to the failure.

Identify the execution path involved.

Do not begin with broad refactoring.

Do not change unrelated code while still determining the cause.

## 3. Form hypotheses

Produce a small ranked set of plausible explanations.

For each hypothesis state:

* why it fits the evidence
* what evidence would support it
* what evidence would disprove it
* the cheapest useful test

Prefer hypotheses that explain all known symptoms rather than only one.

Do not create a long speculative list.

## 4. Test discriminating evidence

Test the cheapest hypothesis that meaningfully reduces uncertainty.

Change one explanatory variable at a time when practical.

Examples:

* inspect a value at the failure boundary
* run one targeted test
* compare working and failing environments
* trace one request
* check one dependency or configuration assumption
* temporarily instrument the relevant path
* isolate one integration

A debugging action should answer a question.

Avoid random edits intended only to "see if it works."

## 5. Identify the root cause

Do not call something the root cause merely because changing it makes the symptom disappear.

A root-cause claim should explain:

* why the failure occurred
* why it occurred under the observed conditions
* why the evidence supports this explanation
* why competing explanations are less likely

If the evidence only supports a workaround or probable cause, say so.

## 6. Choose the smallest justified fix

Once the cause is sufficiently established:

* fix the cause rather than only the visible symptom when practical
* preserve existing behavior outside the failure
* avoid unrelated cleanup
* avoid dependency, architecture, schema, security, or workflow changes without required approval
* prefer a focused regression test when appropriate

If the correct fix expands beyond the active feature or approval boundary, stop and explain the decision required.

## 7. Verify

Verification must include the original failure.

Where relevant also verify:

* the reproduction now passes
* nearby behavior still works
* regression tests pass
* edge/failure states remain correct
* temporary instrumentation is removed
* no unrelated behavior changed

Do not declare success only because the code compiles or one unrelated test passes.

## 8. Stop conditions

Stop and report rather than thrashing when:

* 2–3 grounded hypotheses have been tested without reducing uncertainty
* necessary evidence or environment access is unavailable
* reproduction is too unstable to support a safe fix
* the likely fix requires an unapproved architectural, dependency, security, data, or destructive change
* the observed behavior conflicts with documented requirements and a human decision is needed

When stopping, preserve what has been ruled out so the next attempt does not restart from zero.

## Output

Return:

### Failure

Expected vs actual behavior and reproduction status.

### Evidence

The relevant observations, logs, tests, or code paths.

### Hypotheses tested

What was tested and what each result ruled in or out.

### Root cause

The established cause, probable cause, or remaining uncertainty.

### Fix

The smallest change made or recommended.

### Verification

How the original failure and relevant regression surface were checked.

### Residual risk

Anything still uncertain or unverified.

### Handoff

If unresolved, state the exact next useful investigation step and what should not be repeated.

## Boundaries

`debug-issue` diagnoses an observed failure.

It does not:

* implement unrelated feature scope
* perform a general repository review
* replace `review-feature`
* replace `complete-feature`
* silently change architecture or dependencies
* turn debugging into opportunistic refactoring
* hide uncertainty behind a successful-looking workaround

## Principles

> Reproduce before repairing.

> A debugging action should answer a question.

> Change one explanatory variable at a time.

> Fixes follow evidence, not guesses.

> A symptom disappearing is not proof of root cause.

> Preserve what has already been ruled out.

> Stop when additional attempts are producing activity instead of information.
