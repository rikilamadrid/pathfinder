# Agent Entry Point

Read `CLAUDE.md` first.

Project truth lives in `context/`. Follow the technology and delivery choices documented in `context/project-overview.md`; do not assume a framework, package manager, branch model, or release process. That file, like `context/features/`, `context/tickets/`, `context/history.md`, `context/current-ticket.md`, and `context/handoff.md`, is created by the workflow that first needs it — its absence is normal, not an error. Track the durable ones in Git; `context/current-ticket.md` and `context/handoff.md` are transient session state and belong in `.gitignore`. Never ignore `context/` as a whole.

Use the smallest relevant context for the active task. Keep each ticket stable, reviewable, and verifiable.

The roles are `planner`, `developer`, and `tester`. When the human names one, read `roles/<name>.md` before anything else and follow it for that session. A role is a declarative contract stating what a worker is responsible for and what it must not do, where a skill states how to perform a task. Naming one is the only thing that activates it, so a session where none is named behaves exactly as if `roles/` were not there.

Canonical skills live under `skills/` and are the only behavior contract; anything under `.claude/skills/` or `.agents/skills/` is a generated pointer to one, so edit the canonical file and regenerate the adapter.

If this tool has no native skill discovery, invoke a skill by reading its canonical file directly: `Use skills/<name>/SKILL.md and follow it exactly.` That is the whole fallback — one line, and no second copy of a skill anywhere to find.
