# Changelog

This changelog describes the reusable kit itself, not destination projects. A destination project still chooses its own versioning and release policy.

The kit follows Semantic Versioning:

- MAJOR — a skill is removed or renamed, or `context/`, `prompts/`, or the agent entry files change in a way that breaks an existing destination project
- MINOR — a new skill or workflow capability that existing projects can adopt without changes
- PATCH — clarifications, corrections, and documentation fixes

## [Unreleased]

## [1.1.0] - 2026-08-10

### Added

- `reflect` skill and matching manual launcher prompt for reviewing completed work, separating project-specific knowledge from reusable workflow lessons, and proposing evidence-based Pathfinder improvements that a human approves before they are adopted.

### Changed

- README documents a workflow reflection loop covering when reflection is worth its cost, the boundary between project knowledge and reusable Pathfinder lessons, and the rule that reflection proposes while humans promote. `CLAUDE.md` skill list updated to include `reflect`.
- This changelog adopts Semantic Versioning, and the previously unreleased kit is recorded as `1.0.0`.

## [1.0.0] - 2026-07-28

### Added

- `reverse-engineer` skill and matching manual launcher prompt for analyzing external references (products, interfaces, repositories, workflows) into an evidence-based reconstruction blueprint, separate from project discovery and implementation.
- Prototype validation workflow and skill.
- Feature lifecycle skills for load, start, review, and completion.
- Feature-scoped and codebase-wide interactive learning skills.
- Mentoring skills: `teach-feature`, `quiz-me`, `challenge-me`, `teach-architecture`, and `learning-review`, with matching manual launcher prompts.
- `context/learning/` learner profile, lesson history, and progress log.
- Lesson and progress-entry templates.
- Context boundaries, stable delivery chunks, and learning targets in feature specs.
- Project-selected technology, architecture, Git, CI/CD, versioning, release, environment, and learning decisions.
- Blank destination-project changelog template.

### Changed

- README documents the external reference analysis loop, its handoffs to other skills, and the boundary between `reverse-engineer`, `learn-codebase`, `kickstart-pathfinder`, `prototype`, and `to-specs`. `CLAUDE.md` skill list updated to include `reverse-engineer`.
- README learning loop expanded into a Learning & Mentoring loop describing how the new skills complement `learn-feature` and `learn-codebase`.
- Debate workflow now recommends a stack, architecture, delivery process, and prototype approach for human selection.
- Core guidance no longer assumes a UI framework, language, package manager, `main` branch, feature branches, conventional commits, or SemVer for destination projects.
- README now documents discovery, prototype, delivery, and learning loops.
