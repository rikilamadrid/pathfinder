---
name: sync-tracker
description: Project Feature specs onto the configured work tracker.
---

# Sync Tracker

Sync project Features to the tracker configured in `context/tracker.md`.

The repository is canonical.
Tracker state never changes Pathfinder state.

## Process

1. If `context/tracker.md` does not exist, stop.
2. Read the tracker configuration.
3. Read the Feature specs being synced.
4. Determine what tracker items should exist or change.
5. Show the proposed writes.
6. Ask before writes outside the repository.
7. Create or update only the items that changed.
8. Report:
   - created
   - updated
   - unchanged

## Rules

- Do not decompose Features into tickets.
- Do not infer labels, tags, status, or other metadata.
- Do not modify Feature specs from tracker state.
- Do not delete tracker items automatically.
- Do not rewrite unchanged items.
- Local Markdown tracking is an ordinary repository/file write.
- External trackers require human approval before writing.

A second sync with no Feature changes should produce zero writes.
