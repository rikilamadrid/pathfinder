---
name: map-system
description: Turn a plain request about a system or codebase into a semantic diagram artifact, with evidence pinned to a commit when the diagram is derived.
argument-hint: what to map, in your own words
---

# Map System

Someone asks what a system looks like. You answer with a diagram they can
interrogate.

> Describe the system, not the canvas.

That line is the whole boundary. You decide what exists, what each thing is,
what relates to what, which things belong together, which walks matter, and
what backs every claim. You decide nothing about how any of it is drawn.

## When this applies

A request about the shape of a system: "Map this repository's runtime
architecture." "Visualize this checkout flow." "Map the ticket lifecycle."
"Design an API with auth, cache, queue, workers and storage."

This is the only skill that writes a `diagram` specification.
`render-artifact` is infrastructure you call, not a thing a human invokes for a
diagram. If the request is really "teach me this feature", that is
`learn-feature`; "explain the whole codebase" is `learn-codebase`.

## Read

1. `skills/render-artifact/engine/references/specification.md` — the fields,
   and `provenance` in particular.
2. `skills/render-artifact/engine/references/validation.md` — the four layers,
   the provenance table, and what the evidence layer does and does not
   establish.
3. `skills/render-artifact/engine/examples/diagram.json` — a complete derived
   specification, as a shape to follow.
4. Then the part of the system you were asked about, and nothing else. A map of
   one subsystem does not need the whole repository read.

## Output

```text
diagrams/[system-slug]/diagram.json    the semantic specification — yours
diagrams/[system-slug]/diagram.html    the rendered artifact — the renderer's
```

The JSON is the reviewable source. A human can read it, disagree with a claim,
and see exactly what was asserted and what backs it. It is also what makes the
artifact reproducible: the same specification through the same renderer version
produces the same bytes.

Do not author the HTML. Do not author SVG, CSS, or presentation JavaScript.
There is one visual-artifact path in Pathfinder and it runs through
`render-artifact`.

## Process

1. **Decide the provenance.** Before anything else, because it decides what
   the rest of the work has to prove. See "Provenance" below.
2. **Decide the scope.** See "Scope and size". Say what you excluded later.
3. **Pin the commit,** when the diagram is `derived`. Use the commit the map
   is *about* — normally the one you read. Never the working tree: evidence
   resolves against the commit and nothing else.
4. **Gather the evidence, then write the nodes.** In that order. A component
   you cannot ground is not a component of a derived map.
5. **Write the specification** to `diagram.json`.
6. **Validate.**

   ```sh
   node skills/render-artifact/engine/bin/render.mjs validate \
     diagrams/[system-slug]/diagram.json
   ```

7. **Deliver.**

   ```sh
   node skills/render-artifact/engine/bin/render.mjs deliver \
     diagrams/[system-slug]/diagram.json \
     diagrams/[system-slug]/diagram.html --json
   ```

8. **Report.** See "What to say afterwards".

## The artifact is the proposal

Do not ask the human to approve a list of nodes and edges before you render.
Routine textual model approval is not required here and must not be
introduced — a wrong guess is far more obvious in a picture than in a list, and
a list costs the human a review they would have to do twice.

Render, then report what you chose. Corrections revise the specification and
deliver again.

## Provenance

`provenance` is required and there is no default. Pick the one that is true.

**`derived`** — the system exists, and this map is what the repository asserts
about itself at the declared commit.

- `source` is required, with the repository and the pinned commit.
- Every node carries at least one citation.
- Every edge carries at least one citation.
- A group, path or view carrying a `summary` or `note` carries a citation. A
  label-only one does not: its truth follows from its already-cited members.
- `artifact.summary` is not permitted. Put the claim on the thing it is about
  and cite it there, or use `artifact.subtitle`, which names the diagram
  rather than asserting anything.

**`proposed`, with a source** — a design that does not exist yet, argued
against a repository that does. Citations are optional; every one you supply is
still checked at the commit. `artifact.summary` is permitted, and is the right
place to say plainly that the diagram is a proposal.

**`proposed`, with no source** — a system with no repository behind it at all.
Omit `source` entirely. Citations are then forbidden, the evidence layer is
reported as not run, and the artifact carries no verification sentence.

Do not invent provenance to make a map look more authoritative. A source you
attached so the page would carry a commit row is the one lie this contract
cannot detect for you.

## Evidence

Gather it before you treat anything as established fact. The shape is the one
the renderer uses everywhere:

```json
{ "path": "skills/ticket/SKILL.md", "lines": [43, 49] }
```

Evidence is **where a reader goes to check a claim**, which is not always the
code implementing it. An actor is cited by the entry point that accepts it. An
external system by its client, its configuration, or its infrastructure
declaration. A subsystem by its manifest or its entry module.

A node says a component exists. An edge says two things relate. Each is a claim
somebody may want to check, which is why a derived map cites both.

**Repository documentation is first-class evidence.** A README, an ADR, a
runbook — all valid, all checked the same way. But keep the distinction, and
report it: a relationship you found in code, configuration or
infrastructure-as-code is grounded differently from one you found only in prose
somebody wrote about the system. Prose goes stale silently. Say which claims
rest on it.

What the engine establishes is that the cited file exists at that commit, that
the cited lines exist, and that the material is there to read. **Not that the
claim is true.** Provenance is not truth, and nothing you write may suggest
otherwise.

Two things not to do, both of which produce a map that passes validation and
misleads a reader:

- Do not infer a component nobody wrote down and then cite something nearby to
  satisfy the schema. A citation that proves a file exists is not a citation
  that supports the relationship you drew.
- Do not keep a component you cannot ground. Omit it, narrow the scope, or make
  the whole map `proposed` — which is the honest answer when the interesting
  part of the system is the part not in the repository.

## Scope and size

The caps are 40 nodes, 80 edges, 8 groups, 6 paths and 6 views, and they are a
ceiling rather than a target. **A good primary diagram is roughly 8 to 20
nodes.** Below that it usually is not worth a picture; far above it, a reader
stops being able to hold the whole thing.

Split a large system rather than cramming it. Two coherent maps of two
subsystems beat one exhaustive map of both, and a request that would need 60
nodes is a request to narrow, split, or re-scope — say so rather than deleting
arbitrary components to fit.

## Material ambiguity

Ask a question first **only** when the ambiguity would produce materially
disjoint systems — a different set of components, not a different level of
detail. "Map the pipeline" in a repository with an unrelated data pipeline and
release pipeline is material: the two maps share nothing.

Everything else you decide. Depth, emphasis, which peripheral thing to leave
out, how to group, which walks are worth an authored path — none of that is
material. Choose, render, and say what you chose. A skill that asks before
every judgement call makes the human do the work they asked you to do.

## The vocabulary is closed

Roles: `actor`, `interface`, `service`, `store`, `queue`, `job`, `external`,
`step`, `decision`, `terminal`.

Relations: `calls`, `reads`, `writes`, `publishes`, `consumes`, `depends_on`,
`transitions_to`, `triggers`.

That is all of both, and an unknown value is refused rather than drawn with a
default. Architecture roles and process roles share one vocabulary on purpose:
a codebase map uses `service` and `store`, a lifecycle map uses `step` and
`decision`, and nothing in the renderer branches on which.

If the system genuinely cannot be expressed in these — not "does not fit
neatly", but cannot be said — stop and report the mismatch. Do not extend the
schema, and do not force a value that misdescribes what the thing is.

## Groups and paths

A group is **semantic containment**: these things belong together in the
system. A node belongs to at most one group, and nesting is one level — a
parent must itself be a root. Do not reach for a group to improve the picture;
containment you invented to tidy the layout is a claim about the system that
is not true.

A path is an ordered walk worth calling a reader's attention to — a request
flow, a clean run, a failure route. It names the **edge ids** it consists of,
in order, and each edge must begin where the last one ended:

```json
{
  "id": "clean-run",
  "label": "A clean run",
  "note": "Four transitions, each performed by a different action.",
  "edges": ["e-load", "e-start", "e-submit", "e-accept"]
}
```

Edges rather than nodes, because two edges may join the same pair and a node
sequence could not say which relationship the path claims. Do not author a path
to make something look important: emphasis is derived from paths, so a path you
invented for emphasis is a claim you did not mean to make.

## What you cannot ask for

The specification carries no presentation, and the schema refuses the attempt
rather than ignoring it. There is no field for a coordinate, a position, a
size, a width, a height, a rank, a lane, a column, a route, a bend, a side, an
orientation, a colour, an icon, a shape, a preset, an opacity, a transition, an
animation, a zoom level, a viewport, a theme, or a class.

There is no `emphasis` field either. An edge is drawn heavier exactly when an
authored path walks it — say why a walk matters, and the renderer decides how
loud it gets.

There is no field for focus, traversal, adjacency, or a reachable set. Upstream
and downstream are derived from the directed edges you wrote. How focus and
traversal *look*, and how the evidence panel behaves, are the renderer's
entirely.

Text is text. No field is Markdown and no field is HTML: every string is
escaped on the way out, so `<b>bold</b>` renders as those nine characters.

There is also no field for whether the specification was validated or whether
its evidence checked out, and no field that selects the artifact's verification
wording. Those are claims about work the engine performs, and the engine is the
only thing entitled to make them.

## What to say afterwards

Report enough that the human can judge the map before accepting it:

- **the scope you interpreted**, in your words, and the request you read it from
- **the provenance mode**, and the pinned commit when there is one
- **what you deliberately excluded**, and why
- **the character of the evidence** — code, configuration,
  infrastructure-as-code, documentation — as relevant
- **the weakest claims**, and any node or edge resting on documentation rather
  than implementation
- **the artifact's location**
- **the validation and delivery result**, from the receipt

The receipt names the renderer version and the SHA-256 and byte count of both
the specification and the artifact. It supports one real claim: this
specification, compiled by this renderer, produced these bytes, and its
evidence resolved at the commit it names.

It says nothing about whether the diagram reads well or is a good map. Nobody
has looked at it. Report the validation result and say separately that
perceptual review has not happened. If a human then opens it, that is their
finding, in their words — and it is not evidence for the validation result any
more than the validation result is evidence for it.

## When the renderer cannot run

Check with:

```sh
node skills/render-artifact/engine/bin/render.mjs doctor
```

If the engine is unavailable, or delivery fails, you may still describe the
system in conversation or in Markdown where that helps. That answer is not a
Pathfinder visual artifact. Do not call it one, do not hand-author HTML or SVG
to stand in for one, and do not reach for a second way to produce a picture. A
non-zero exit is never reported as success, and a failed delivery leaves any
previously delivered artifact exactly as it was.
