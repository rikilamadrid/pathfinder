---
name: render-artifact
description: Compile a typed semantic specification into a self-contained, deterministic HTML artifact carrying the Pathfinder visual identity. Use when a skill must deliver a visual artifact instead of hand-authoring HTML.
argument-hint: [validate|deliver|doctor] [specification path]
---

# Render Artifact

A producer skill writes a small typed specification. This engine compiles it
into one self-contained HTML file.

> The producer owns what is true. The renderer owns what it looks like.

That line is the whole design. A producer decides which modules, concepts,
flows, exercises and questions exist, what they assert, and the evidence behind
them. It never decides colour, layout, class names, or a single word of
interface language, and the schema rejects the attempt rather than ignoring it.

## When this applies

Use it when a Pathfinder skill must deliver a visual artifact.

Do not hand-author HTML for such an artifact. Not as a fallback, not as a
placeholder, and not "just this once" — a hand-authored page carries the
identity without carrying any of the checks that make the identity mean
something.

## The refusal

`lesson` is the only artifact kind that exists.

If the artifact you need is not a `lesson`, stop and say so. Do not invent a
kind, do not extend the schema to fit, and do not write the HTML yourself
instead. A missing kind is a refusal and a conversation with the human about
whether that kind should exist — never permission to improvise.

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
deliberately does not validate the shipped example — see `examples/lesson.json`
below.

## Producing an artifact

1. **Write the specification.** Start from `engine/examples/lesson.json` and
   read `engine/references/specification.md` for the fields. Every claim about
   the source carries evidence; every concept carries at least one citation.
2. **Pick the commit.** `source.commit` is what evidence resolves against. Use
   the commit the artifact describes, not "now" — the working tree is never
   consulted, so a citation either resolves at that commit or fails.
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
| Evidence | every citation resolves at the declared commit |
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

A delivered artifact also carries a sentence saying its evidence was checked.
Only delivery can put it there — rendering on its own emits no such claim, and
nothing in a specification can ask for one.

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

## The example

`engine/examples/lesson.json` cites the Pathfinder source repository at a fixed
commit. It is a reference fixture for that repository, not a specimen that
validates anywhere.

In an installed project that commit does not exist, and validating it there
fails with `source_commit_unavailable`. That is correct behaviour, not a broken
installation: evidence is never fetched, never cloned, and never looked up over
a network, so a commit that is not present locally is a commit whose evidence
was not verified — and the engine says so rather than claiming otherwise.

Read it as an example of the shape. Do not run it as a health check; run
`doctor` for that.

## Layout

Paths below are relative to this skill's own directory.

```
SKILL.md                 this file
engine/version.mjs       the renderer version — the deterministic input
engine/bin/render.mjs    validate | deliver | doctor
engine/schemas/          common.schema.json, lesson.schema.json
engine/validate/         structural, composition, evidence layers
engine/render/           shared shell and theme, plus the lesson renderer
engine/deliver.mjs       the delivery layer
engine/doctor.mjs        capability check
engine/examples/         the reference fixture
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
