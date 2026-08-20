---
name: load-feature
description: Load one approved Feature and the minimum context needed to work on it.
---

# Load Feature

1. Select the requested approved Feature.
2. Read the Feature spec.
3. Read only the files or context needed for the current work.
4. Inspect the current Git state.
5. Stop if a required human decision or explicit dependency blocks the work.
6. Create or update `context/current-feature.md` — it does not ship, so the
   first load writes it — with:
   - Feature and spec
   - active delivery chunk
   - Git state
   - blocker, if any
   - next action
7. Present a short readiness summary.

Do not implement the Feature.

Do not scan unrelated repository areas, load history or roadmap by default,
rewrite the Feature, or silently resolve `TBD` decisions.
