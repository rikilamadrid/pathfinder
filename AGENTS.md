# Agent Entry Point

Read `CLAUDE.md` first.

Project truth lives in `context/`. Follow the technology and delivery choices documented in `context/project-overview.md`; do not assume a framework, package manager, branch model, or release process.

Use the smallest relevant context for the active task. Keep each delivery chunk stable, reviewable, and verifiable.

Canonical skills live under `skills/` and are the only behavior contract; anything under `.claude/skills/` or `.agents/skills/` is a generated pointer to one, so edit the canonical file and regenerate the adapter.

If this tool has no native skill discovery, invoke a skill by reading its canonical file directly: `Use skills/<name>/SKILL.md and follow it exactly.` That is the whole fallback — one line, and no second copy of a skill anywhere to find.
