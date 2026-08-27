# Coding Standards

These are stack-agnostic defaults.
Project-specific conventions override them when explicit.

## Core Principles

- Prefer readable, explicit code over clever code.
- Keep modules cohesive and boundaries clear.
- Validate data at system boundaries.
- Make failures visible and diagnosable without exposing sensitive data.
- Follow existing repository conventions unless an approved decision changes them.
- Optimize for code that future humans and AI agents can understand quickly.

## Scope

- Work on one coherent change at a time.
- Read only the files and dependencies needed for that work.
- Avoid unrelated refactors, formatting churn, or speculative cleanup.
- Keep the repository stable and verifiable after each meaningful change.
- Split work when too many concerns must be understood at once.

## Contracts

- Use the strongest practical contract mechanism available in the stack.
- Avoid unchecked escape hatches unless justified.
- Validate external data, configuration, user input, and integration boundaries.
- Keep public contracts explicit and compatibility-conscious.

## User Interfaces — When Applicable

- Support the project's required screen sizes and input methods.
- Prefer semantic platform elements.
- Handle accessibility requirements such as keyboard use, focus, labels,
  contrast, reduced motion, and assistive technology.
- Handle relevant loading, empty, error, success, disabled, and permission states.
- Reuse shared primitives when they improve consistency.

## APIs, Services, CLIs, Libraries, and Infrastructure — When Applicable

- Keep public interfaces clear and documented.
- Provide safe defaults and actionable errors.
- Preserve idempotency when operations may be repeated.
- Avoid leaking internal implementation details through public contracts.

## Testing

Choose tests based on behavior and risk.

Use:

- unit tests for isolated logic
- integration tests for important boundaries
- end-to-end or system tests for critical user flows
- contract tests when independent systems share a contract

Avoid tests that only reproduce implementation details.

## Verification

Verify the behavior that matters, not just that a command exited successfully.

- Prefer evidence from the real artifact or behavior being claimed.
- When something can silently do nothing, verify that the intended effect occurred.
- Beware a check whose every input it supplied itself. Name which inputs came
  from the real system.
- Distinguish what was observed from what was only reasoned about.
- Record unverified behavior as unverified, not passed.
- Increase verification effort when the cost of being wrong is higher.

## Dependencies

Before adding a dependency, consider whether it is necessary and whether a
simpler existing option is sufficient.

Follow the approval rules in `context/ai-interaction.md`.

## Prototype Code

Prototype code is disposable by default.

Do not treat it as production-ready merely because it works.

Adopt prototype work only through an approved production change with the
necessary validation, tests, security, accessibility, and maintainability.

## Documentation

Keep durable truth in its appropriate project artifact.

- project-wide product and architecture context:
  `context/project-overview.md`
- Feature contracts:
  `context/features/`
- executable tickets, when local Markdown is the configured store:
  `context/tickets/`
- completed outcomes:
  `context/history.md`
- active workspace state:
  `context/current-ticket.md`
- state handed to the next session:
  `context/handoff.md`

None of these ships with the kit. Each is written by the workflow that first
needs it, so a missing one is normal and is not an error.

Learning material explains the implementation but does not replace source-of-truth documentation.

## Version control for `context/`

`context/` holds two kinds of file, and they belong on opposite sides of
`.gitignore`.

**Track durable project truth.** It is the answer to "what is true about this
project", it outlives any session, and a reviewer should see it change:

```text
context/project-overview.md
context/features/
context/tickets/ # only when local Markdown is the ticket store
context/history.md
context/tracker.md
```

**Ignore transient workspace state.** It is the answer to "what was I doing",
it belongs to one session on one machine, and committing it puts one person's
in-flight work in everybody's diff:

```text
context/current-ticket.md
context/handoff.md
```

Two lines in `.gitignore` are the whole mechanism:

```text
context/current-feature.md
context/handoff.md
```

**Do not ignore `context/` as a directory.** It is the one mistake worth naming,
because it looks tidier and quietly untracks the project truth every later
session depends on — including the file that documents your stack and workflow.
Ignore the two transient files by name.

A team that would rather share workspace state — a single-machine project, or a
handoff meant to be read by a colleague — can track them instead. Nothing in the
kit reads Git state to decide how to behave.

`context/tracker.md` is durable and tracked when the project selects a store
other than local Markdown. With local Markdown, `context/tickets/` is durable
and tracked instead. Pathfinder's own repository ignores its tracker config,
because `context` is a directory in the installer's copy list and a committed
copy would ship Pathfinder's store selection to every new install.
