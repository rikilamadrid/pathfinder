# Agent Entry Point

Read `CLAUDE.md` first.

Project truth lives in `context/`. Follow the technology and delivery choices documented in `context/project-overview.md`; do not assume a framework, package manager, branch model, or release process. That file, like `context/features/`, `context/history.md`, `context/current-ticket.md`, and `context/handoff.md`, is created by the workflow that first needs it — its absence is normal, not an error. `context/tickets/` exists only when local Markdown is the project's ticket store; a project whose tickets are in GitHub Issues or another tracker has none, and that is not a gap. Track the durable ones in Git; `context/current-ticket.md` and `context/handoff.md` are transient session state and belong in `.gitignore`. Never ignore `context/` as a whole.

For Pathfinder’s own repository, the Git and release workflow is in `CONTRIBUTING.md` (§Git workflow and §Releasing), not an absent `context/project-overview.md`. A destination project continues to use its own project overview.

Read `context/execution-mode.md` by the rule in `skills/ticket/SKILL.md`: human-in-the-loop or orchestrator, with a missing file defaulting to human-in-the-loop. In orchestrator mode each worker owns one active ticket, isolated worktree, and current-ticket file.

Use the smallest relevant context for the active task. Keep each ticket stable, reviewable, and verifiable.

The roles are `planner`, `orchestrator`, `developer`, `tester`, and `integrator`. Lifecycle skills assume the responsible role for each invocation and read its contract themselves. When the human explicitly names a role, read `roles/<name>.md` before anything else and use it instead for that session. A role is a declarative contract stating what a worker is responsible for and what it must not do, where a skill states how to perform a task. Assumed or explicit, a role narrows responsibility and never grants human authority.

Canonical skills live under `skills/` and are the only behavior contract; anything under `.claude/skills/` or `.agents/skills/` is a generated pointer to one, so edit the canonical file and regenerate the adapter.

If this tool has no native skill discovery, invoke a skill by reading its canonical file directly: `Use skills/<name>/SKILL.md and follow it exactly.` That is the whole fallback — one line, and no second copy of a skill anywhere to find.
