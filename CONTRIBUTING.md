# Contributing to Pathfinder

Thanks for your interest. Pathfinder is a small, deliberately bounded workflow kit. The most useful contributions sharpen what is already here; the least useful expand its scope.

Read [`NOT_A_FRAMEWORK.md`](NOT_A_FRAMEWORK.md) before proposing anything structural. This repository has no runtime, package manager, or build step, and it is meant to stay that way.

## What this repository is

Markdown only. `skills/` holds reusable behavior contracts, `context/` holds the templates a destination project fills in, `prompts/` holds manual launchers, and `templates/` holds scaffolding. There is nothing to install and nothing to run.

## Git workflow

The convention, visible in `git log`:

1. Branch off `main`. Descriptive branch name, no prefix convention enforced.
2. Open a pull request against `main`.
3. **Squash merge.** History on `main` is linear — there are no merge commits, and each commit carries its PR number, for example `fix: repair reverse-engineer skill frontmatter (#4)`.
4. Delete the branch after merge.

Commit messages: recent commits use Conventional Commit prefixes (`fix:`, `docs:`, `chore:`), earlier ones use plain sentences. Prefixes are preferred for new work but not enforced by tooling. Write a body when the reason for the change is not obvious from the subject.

## Versioning

Semantic Versioning, scoped to the kit itself and not to destination projects. The policy lives in the [`CHANGELOG.md`](CHANGELOG.md) header and is repeated here for convenience:

- **MAJOR** — a skill is removed or renamed, or `context/`, `prompts/`, or the agent entry files change in a way that breaks an existing destination project.
- **MINOR** — a new skill or workflow capability that existing projects can adopt without changes.
- **PATCH** — clarifications, corrections, and documentation fixes.

Add your change under `[Unreleased]` in `CHANGELOG.md`. Do not bump the version yourself; releases are cut separately.

## Adding a skill

The bar is high on purpose. Pathfinder currently has 19 skills and does not want 40.

Add a new skill only when:

- a repeated task keeps going wrong
- an existing skill does not already own the responsibility
- the new skill has a narrow and clearly defined trigger
- it produces a concrete, verifiable result
- its inputs and outputs are explicit
- its boundaries with neighboring skills are documented
- it improves the workflow without silently expanding Pathfinder's scope

Review the existing skills for overlap first. "This is useful" is not sufficient — the test is repeated, demonstrated pain that no current skill covers.

**New skills go through [`skillsmith`](skills/skillsmith/SKILL.md).** It exists to force the questions above into an explicit contract: trigger, bounded context, ordered process, human checkpoints, concrete output, stop condition, and guardrails. A skill proposed without going through it will be sent back through it.

Every skill needs valid YAML frontmatter with `name` and `description`. Malformed frontmatter makes the skill undiscoverable — this has already happened once, in `2e3d0c6`.

## Changing existing skills

Changes to `skills/`, `context/`, `prompts/`, `templates/`, `AGENTS.md`, or `CLAUDE.md` land in every project that adopts the kit next. Say in the PR description what a destination project has to do differently, if anything.

## Reporting problems

Open an issue for bugs, unclear instructions, or a skill that misfires. Include the skill involved and what you expected it to do. For anything security-related, see [`SECURITY.md`](SECURITY.md) instead.

## A note on maintenance

This is a small project maintained by one person alongside other work. Issues and pull requests are read, but there is no service-level commitment on response time, and a well-argued proposal may still be declined to keep the kit small.
