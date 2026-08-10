---
name: reverse-engineer
description: Analyze an external product, interface, repository, workflow, or reference implementation and produce an evidence-based reconstruction blueprint without copying protected assets or inventing unsupported details.
---

# Reverse Engineer

Use this skill when the user wants to understand how an existing external product, interface, repository, interaction, animation, or workflow was likely built so they can learn from it, recreate its underlying behavior, or adapt its patterns to their own project.

This skill analyzes references.

It does not initialize a Pathfinder project, implement a feature, or replace `kickstart-pathfinder`, `prototype`, `to-specs`, `learn-codebase`, or the feature delivery loop.

## Appropriate Inputs

The user may provide one or more of:

* a public website or product URL
* a public repository URL
* screenshots or screen recordings
* a live interface
* product documentation
* source files the user is authorized to inspect
* a description of a product or interaction
* a specific flow, component, animation, or system to analyze

## First Determine the Target

Identify what the user actually wants reverse-engineered:

* visual design
* user experience
* interaction behavior
* animation or motion
* frontend architecture
* backend or data flow
* component structure
* state management
* API behavior
* information architecture
* business workflow
* full product system

Do not automatically analyze every layer.

Prefer the narrowest scope that answers the request.

If the target is broad, state which layers can be observed directly and which can only be inferred.

## Evidence Levels

Classify meaningful findings as one of:

* **Observed** — directly visible in the provided reference, source code, network behavior, documentation, or repository.
* **Strong inference** — not directly visible, but strongly supported by multiple observations.
* **Possible implementation** — one reasonable way to reproduce the behavior, but not evidence of how the original was built.
* **Unknown** — cannot be determined from the available evidence.

Never present an inference as a confirmed implementation detail.

## Process

### 1. Define the objective

Restate:

* what is being analyzed
* what the user wants to learn or reproduce
* the analysis boundary
* what evidence is available
* what cannot be verified

Ask a question only when a missing answer would materially change the analysis.

Otherwise, proceed using clearly stated assumptions.

### 2. Gather evidence

Inspect only the evidence relevant to the requested scope.

Depending on the input, this may include:

* visible page structure
* responsive behavior
* navigation and user flows
* interaction states
* timing and motion characteristics
* accessibility semantics
* repository structure
* package and configuration files
* source code boundaries
* API calls visible through authorized inspection
* public technical documentation
* repeated visual or behavioral patterns

Do not perform destructive actions.

Do not attempt to bypass authentication, authorization, paywalls, rate limits, anti-bot controls, or private systems.

### 3. Decompose the system

Break the target into understandable parts such as:

* experience and user flow
* page or screen hierarchy
* component hierarchy
* data and state flow
* services and integrations
* animation system
* responsive behavior
* accessibility behavior
* likely architectural boundaries

Use only the sections relevant to the request.

Do not force a full-stack analysis onto a visual interaction request.

### 4. Separate facts from reconstruction choices

For each major area, distinguish:

1. what was observed
2. what was inferred
3. what remains unknown
4. what implementation Pathfinder could use to reproduce the outcome

The reconstruction recommendation does not need to use the original product’s exact stack.

Prefer a solution appropriate for the user’s project, constraints, and existing conventions.

### 5. Identify the transferable pattern

Explain the underlying idea rather than merely listing surface details.

Examples:

* progressive disclosure
* optimistic interaction
* scroll-linked storytelling
* command palette architecture
* reusable card composition
* local-first state
* staged data loading
* motion used as spatial continuity
* server-driven configuration

State why the pattern works and where it may fail.

### 6. Produce a reconstruction blueprint

When implementation guidance is requested, include:

* smallest reproducible version
* logical components or modules
* state and data responsibilities
* interaction states
* responsive requirements
* accessibility requirements
* dependencies only when justified
* risks and unknowns
* verification approach
* optional higher-fidelity improvements

Keep the blueprint stack-agnostic unless the user’s project context establishes a stack.

### 7. Recommend the Pathfinder handoff

End by recommending the correct next Pathfinder step.

Use one of these:

* `kickstart-pathfinder` — when this analysis is becoming a new project
* `debate-me` — when major product or technical decisions remain
* `prototype` — when the experience or technical assumption needs validation
* `to-specs` — when the direction is approved and ready to become feature files
* `load-feature` — when the analysis applies to one already-planned feature
* `learn-codebase` — when the user wants to understand their own repository instead
* no handoff — when the user only requested analysis

Do not silently run or imitate the responsibilities of those skills.

## Default Output

Use only the sections that add value:

# Reverse-Engineering Report

## Objective

What was analyzed and what the user wants to reproduce or understand.

## Evidence Available

The sources inspected and important limitations.

## Observed Behavior

Directly verifiable findings.

## Likely Structure

Strongly supported architectural, component, data, or interaction inferences.

## Unknowns

Details that cannot be determined honestly.

## Transferable Patterns

The underlying techniques worth learning or adapting.

## Reconstruction Blueprint

A practical implementation approach for the user’s project.

## Risks and Tradeoffs

Complexity, accessibility, performance, maintenance, legal, or fidelity concerns.

## Recommended Pathfinder Handoff

The appropriate next skill, if any, and why.

## Rules

* Distinguish observation from inference.
* Do not claim to know a private or server-side implementation from surface evidence.
* Do not copy proprietary source code, trademarks, text, illustrations, icons, audio, video, or other protected assets.
* Reproduce underlying behavior and patterns, not brand identity.
* Do not bypass technical or access controls.
* Do not inspect unrelated parts of a repository or product.
* Do not modify the user’s project unless explicitly requested through the appropriate Pathfinder delivery skill.
* Do not install dependencies.
* Do not create feature files unless the user invokes `to-specs`.
* Do not create prototype code unless the user invokes `prototype`.
* Do not turn uncertain technology guesses into requirements.
* Prefer simple reconstruction approaches over stack imitation.
* Respect `CLAUDE.md`, `AGENTS.md`, and `context/ai-interaction.md` when operating inside a Pathfinder-enabled repository.
* Keep the output proportional to the target. A single component should not receive a full product architecture report.

## Quality Check

Before finishing, verify:

* Is the requested target clearly defined?
* Are observations and inferences visibly separated?
* Is every major claim supported by available evidence?
* Are unknowns stated honestly?
* Does the blueprint reproduce the outcome rather than imitate the brand?
* Is the recommended implementation appropriate for the user’s project?
* Does the skill avoid overlapping with another Pathfinder skill?
* Is the next Pathfinder handoff explicit and correct?
