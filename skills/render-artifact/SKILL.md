---
name: render-artifact
description: Compile a typed semantic specification into a self-contained, deterministic HTML artifact carrying the Pathfinder visual identity. Use when a skill must deliver a visual artifact instead of hand-authoring HTML.
argument-hint: validate|deliver|doctor <spec path>
---

# Render Artifact

A producer skill writes a small typed specification. This engine compiles it
into one self-contained HTML file.

> The producer owns what is true. The renderer owns what it looks like.

That line is the whole design. A producer decides what exists — modules,
concepts and flows in a lesson; components, relationships, boundaries and
authored paths in a diagram — what each asserts, and the evidence behind it. It
never decides colour, layout, geometry, class names, or a single word of
interface language, and the schema rejects the attempt rather than ignoring it.

## When this applies

Use it when a Pathfinder skill must deliver a visual artifact.

This engine is infrastructure a producer calls, not the human entry point. A
lesson comes from `learn-feature` or `learn-codebase`; a diagram comes from
`map-system`, which is the only skill that writes a `diagram` specification.

Do not hand-author HTML for such an artifact. Not as a fallback, not as a
placeholder, and not "just this once" — a hand-authored page carries the
identity without carrying any of the checks that make the identity mean
something.

## The refusal

`lesson` and `diagram` are the only artifact kinds that exist. A `diagram`
supports one topology, `graph`, and an unsupported topology is refused with its
own diagnostic on exactly the same grounds: there is no generic layout to fall
back on.

If the artifact you need is neither kind, stop and say so. Do not invent a kind,
do not extend the schema to fit, and do not write the HTML yourself instead. A
missing kind is a refusal and a conversation with the human about whether that
kind should exist — never permission to improvise.

If the engine cannot run at all, you may still give the human your normal
conversational or Markdown answer where that already makes sense. You may not
call it the Pathfinder artifact, because it is not one.

## Requirements

Node, at the version Pathfinder already supports. Nothing else: the engine has
zero runtime dependencies and imports only `node:` builtins.

Check with:

```sh
node skills/render-artifact/engine/bin/render.mjs doctor
```

`doctor` answers "can this machine render", not "is my specification good". It
deliberately does not validate the shipped examples — see "The examples" below.

## Producing an artifact

1. **Write the specification.** Start from the example for the kind —
   `engine/examples/lesson.json` or `engine/examples/diagram.json` — and read
   `engine/references/specification.md` for the fields. Every claim about the
   source carries evidence: every concept in a lesson cites, and a `derived`
   diagram cites every component and every relationship.
2. **Pick the commit.** `source.commit` is what evidence resolves against. Use
   the commit the artifact describes, not "now" — the working tree is never
   consulted, so a citation either resolves at that commit or fails. A diagram
   describing a system that does not exist yet declares no source at all;
   `engine/references/validation.md` has the three provenance states and what
   each is allowed to claim.
3. **Validate.**

   ```sh
   node skills/render-artifact/engine/bin/render.mjs validate <spec.json>
   ```

4. **Deliver.**

   ```sh
   node skills/render-artifact/engine/bin/render.mjs deliver <spec.json> <out.html>
   ```

   Add `--repo <dir>` when the specification does not live in the repository it
   cites. Add `--json` for a machine-readable receipt.

5. **Report honestly.** See "What delivery proves" below.

## The four layers

Each supports a different claim, and they are reported apart because collapsing
them would throw away the only thing that makes the result honest.

| Layer | The claim it supports |
| --- | --- |
| Structural | the specification satisfies its schema |
| Composition | identifiers, references, graphs and answers are coherent |
| Evidence | every citation resolves at the declared commit, where there is one |
| Delivery | the artifact was rendered, digested, and committed atomically |

A failure in any layer delivers nothing and leaves a previously delivered
artifact exactly as it was. A non-zero exit is never reported as success.

`engine/references/validation.md` has the diagnostics and what each one means.

## What delivery proves

The receipt names the renderer version and the SHA-256 and byte count of both
the specification and the artifact. That is a real claim: this specification,
compiled by this renderer, produced these bytes. `deliver` reads the
specification as bytes, parses and validates that one copy, and renders it, so
the digest in the receipt is the digest of what was actually rendered.

A delivered artifact whose evidence was actually checked also carries a sentence
saying so. Only delivery can put it there — rendering on its own emits no such
claim, and nothing in a specification can ask for one. An artifact with no
citation to resolve carries no such sentence either: a layer that had nothing to
check is not a layer that checked something, and the wording follows what was
verified rather than what was asked for.

None of it is a claim that the artifact looks right. Nobody has looked at it.

So when you report a delivery, say what was checked and say separately that
perceptual review has not happened. If a human has opened it in a browser, that
is their finding to record, in their words, and it is not evidence for the
validation result any more than the validation result is evidence for it.

## Determinism

The invariant: **the same specification bytes and the same renderer version
produce byte-identical HTML in every supported environment.**

A renderer release may intentionally change output. That is a version change,
which is why the receipt reports the renderer version alongside the digests. If
you change anything that can alter rendered HTML, bump `engine/version.mjs` in
the same commit.

`engine/references/determinism.md` has the rules this puts on the code.

## The examples

One per kind: `engine/examples/lesson.json` and `engine/examples/diagram.json`.
Both cite the Pathfinder source repository at a fixed commit, so both are
reference fixtures for that repository rather than specimens that validate
anywhere.

In an installed project that commit does not exist, and validating either there
fails with `source_commit_unavailable`. That is correct behaviour, not a broken
installation: evidence is never fetched, never cloned, and never looked up over
a network, so a commit that is not present locally is a commit whose evidence
was not verified — and the engine says so rather than claiming otherwise.

Read them as examples of the shape. Do not run them as a health check; run
`doctor` for that.

## Layout

Paths below are relative to this skill's own directory.

```
SKILL.md                 this file
engine/version.mjs       the renderer version — the deterministic input
engine/bin/render.mjs    validate | deliver | doctor
engine/schemas/          common.schema.json, and one schema per kind
engine/validate/         structural, composition, evidence layers
engine/render/           shared shell and theme, plus one renderer per kind
engine/render/graph/     everything specific to drawing a graph
engine/deliver.mjs       the delivery layer
engine/doctor.mjs        capability check
engine/examples/         the reference fixtures, one per kind
engine/references/       the detail this file deliberately does not carry
```

The engine lives under `skills/` because that is what the kit copies, so an
installed project, the generated adapters, and the plugin surface all carry it
with no change to `copy-list.json`.

## Attribution

The architecture — typed specification, deterministic compile, layered
validation, verification claims kept apart — is adapted at the level of ideas
from Archify (`tt-a1i/archify`, MIT). No Archify source is copied. If any is
later adapted, retain its notice and declare it in this frontmatter.
