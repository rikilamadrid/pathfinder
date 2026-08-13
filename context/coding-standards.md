# Coding Standards

These standards are stack-agnostic. Extend them after the project selects a real stack; remove sections that do not apply.

## Core Principles

- Prefer readable, explicit code over clever code.
- Keep modules cohesive and boundaries clear.
- Validate data and assumptions at system boundaries.
- Make failure visible and diagnosable without exposing sensitive data.
- Optimize for future humans and AI agents reading the code.
- Follow existing repository conventions unless an approved decision changes them.

## Context-Efficient Changes

- Work on one coherent delivery chunk at a time.
- Inspect only the files and dependencies needed for that chunk.
- Avoid mixing unrelated refactors, formatting churn, and features.
- Keep the project stable and verifiable after each chunk.
- Split work when too many systems or concerns must be held in context simultaneously.

## Types and Contracts

- Use the strongest practical contract mechanism available in the chosen stack.
- Avoid untyped or unchecked escape hatches unless justified.
- Define and validate contracts for external data, configuration, user input, and integration boundaries.

## User Interface Standards — When Applicable

- Start from the smallest supported viewport when the product supports small screens.
- Use semantic platform elements before accessibility workarounds.
- Support keyboard, focus, labels, contrast, reduced motion, and assistive technology according to project targets.
- Handle relevant loading, empty, error, success, disabled, and permission states.
- Use shared tokens and primitives when they improve consistency.

## Service, API, CLI, Library, and Infrastructure Standards — When Applicable

- Document public contracts and compatibility expectations.
- Make operational failures actionable.
- Provide safe defaults and clear configuration errors.
- Preserve idempotency where repeated execution is possible.
- Avoid leaking implementation details through public interfaces.

## Testing

Choose tests by behavior and risk:

- unit tests for isolated logic
- component/module tests for reusable units
- integration tests for boundaries and important flows
- end-to-end or system tests for critical journeys
- contract tests when independent systems depend on shared behavior

Avoid tests that only reproduce implementation detail.

## Verification Evidence

These apply to any claim that something works — a test, a manual check, or a
verification step in a feature's acceptance criteria.

- **Exercise the artifact a user receives, the way a user exercises it.** A
  hand-written sample of generated output, a local imitation of an external
  system, or the working tree in place of the built and published thing is
  evidence about the stand-in, not about the artifact. Prefer one check against
  the real artifact over several against convenient substitutes.
- **When a mechanism can fail by doing nothing, observe that the right thing
  happened.** A clean exit says the command ran. It does not say the effect
  occurred, and a step that silently does nothing usually reports success.
- **Beware a check whose every input it supplied itself.** If the test chose the
  fixtures, the environment, and the trigger, it has confirmed its own
  assumptions. Name which inputs came from the real system.
- State what was verified and what was only reasoned about. An unobserved
  criterion is recorded as unobserved, not as passed.

## Dependencies

Before adding one, assess necessity, maintenance, security, runtime cost, licensing, portability, and simpler alternatives. Follow the approval policy in `context/ai-interaction.md`.

## Prototype Code

- Treat prototype code as disposable by default.
- Do not copy it into production merely because it appears to work.
- Adopt it only through an explicit feature that adds production architecture, validation, tests, accessibility, security, and maintainability as applicable.

## Documentation

- Durable product and architecture truth belongs in `context/project-overview.md`.
- Active scope belongs in `context/current-feature.md`.
- Completed outcomes belong in `context/history.md`.
- Feature-specific contracts belong in `context/features/`.
- Learning artifacts explain the code but do not replace source-of-truth documentation.
