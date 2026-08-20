---
name: setup-tracker
description: Configure optional work tracking for the project.
---

# Setup Tracker

Configure a work tracker only when the human asks.

Pathfinder works normally without one.

## Process

1. Ask where work should be tracked:
   - GitHub Issues
   - local Markdown files
   - another tracker the human describes
2. Ask only for the information needed to use that tracker.
3. Create a proposed `context/tracker.md`.
4. Show it to the human.
5. Write it only after approval.

If `context/tracker.md` already exists, modify only the requested settings.

## Rules

- Do not publish or create work items.
- Do not create labels, tags, or tracker conventions unless requested.
- Do not add dependencies or tracker-specific code.
- Feature specs remain canonical.
- Tracking is always optional.

Publishing belongs to `sync-tracker`.

Stop after configuration.
