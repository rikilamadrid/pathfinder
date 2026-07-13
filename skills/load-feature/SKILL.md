---
name: load-feature
description: Prepare one feature for implementation by checking readiness, context size, dependencies, and delivery chunks.
---

# Load Feature

1. Select the requested or next approved feature spec.
2. Read its dependencies and the smallest relevant durable context.
3. Check repository reality without scanning unrelated areas.
4. Identify contradictions, missing decisions, stale paths, and prototype dependencies.
5. Assess whether the feature fits a focused LLM context window.
6. Split or revise it before implementation if the context is too broad.
7. Populate `context/current-feature.md` with the feature, first delivery chunk, context boundary, assumptions, Git state, definition of done, and out-of-scope work.
8. Present a short readiness summary.

Do not implement, create Git history, or resolve `TBD` decisions silently.
