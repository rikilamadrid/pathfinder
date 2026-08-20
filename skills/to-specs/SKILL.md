---
name: to-specs
description: Turn approved direction into small, clear Feature specs.
---

# To Specs

Turn approved direction into the minimum Feature specs needed to implement it.

## Process

1. Read the approved project context and relevant existing Features.
2. Stop if a required human decision is still `TBD`.
3. Decide whether the work is one Feature or needs a small number of Features.
4. Create `context/features/` if it does not exist.
5. Create each Feature from `templates/feature-spec.template.md`, named
   `NN-feature-name.md` — see Naming below.
6. Fill only information that materially helps implementation and review.
7. Present the created Features and recommend which one to start first.
8. If `context/tracker.md` exists, offer to publish them with `sync-tracker`.
   Do nothing here if it does not.

## Naming

A Feature spec is named `NN-feature-name.md` in the spec source, for example
`context/features/27-export-saved-searches.md`.

`NN` is the Feature number: the next unused number in the spec source, counting
every spec already there whatever its status. Numbers are never reused and never
renumbered, because a published tracker item is matched on that number and
renumbering would orphan it.

The number lives in the filename and nowhere else. The Feature template carries
no number field, and nothing else in the spec records one.

## Sizing

Prefer one Feature when the work is coherent.

Split only when separate outcomes:

- can be implemented or reviewed independently
- depend on meaningfully different context
- have a real dependency between them
- would make one Feature unnecessarily difficult to understand

Prefer fewer Features and fewer artifacts.

Use delivery chunks inside a Feature before creating additional Features.

## Rules

- Do not implement.
- Do not invent unresolved decisions.
- Do not plan beyond the approved direction.
- Do not add workflow metadata that the Feature template does not require.
- Do not create tickets, tracker items, or extra planning files by default.
- Do not scan unrelated repository areas.

When implementation details are unclear, inspect only enough source code to
write an accurate Feature.
