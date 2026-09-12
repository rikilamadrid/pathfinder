# The specification

One shared contract, and one kind-specific schema selected by `kind`.

Everything here is producer-supplied *content*. Nothing here is presentation.
If you find yourself wanting a field for a colour, a class, a width, a
coordinate, an icon, a template, or a theme, the answer is that the renderer
owns it — and the schema will reject the field rather than ignore it, so the
attempt fails loudly instead of silently doing nothing.

## The shared contract

`schemas/common.schema.json`.

| Field | Required | What it is |
| --- | --- | --- |
| `schema_version` | yes | `"1.0"`. The contract this specification is written against. |
| `kind` | yes | Selects the kind schema and the renderer. `lesson` and `diagram`. |
| `artifact` | yes | Metadata about the artifact: `title`, and optionally `subtitle`, `summary`, `locale`. |
| `source` | see below | Where the claims come from: `repo`, `commit`, and optionally `generated_at`. |

`source` is required by the `lesson` kind unconditionally. For `diagram` it is
conditional on `provenance`, and the condition is written into
`diagram.schema.json` rather than into the shared contract — see
[`provenance`](#provenance) below. The shared `source` definition itself is
unchanged and is not loosened: a kind that declares a source declares a complete
one.

### `provenance`

`diagram` only. `"derived"` or `"proposed"`, and required — there is no default,
because a diagram that did not say would have a trust level assigned to it by the
engine.

- **`derived`** maps what the repository asserts about itself at the declared
  commit. `source` is required, every node and edge carries at least one
  citation, a group, path or view carrying `summary` or `note` prose carries one
  too, and `artifact.summary` is not permitted.
- **`proposed`** describes an intended system. Citations are optional, and every
  one supplied is still resolved. With no `source` at all, citations are refused
  rather than ignored, and the evidence layer is reported as not run.

`validation.md` has the full table and the diagnostics. The short version: what
you may assert is decided by what you are willing to cite, and the renderer's
wording follows from that rather than from anything you can ask for.

### `source`

- `repo` identifies the repository the evidence belongs to, so a diagnostic can
  say whose commit is missing.
- `commit` is a full or abbreviated Git object name. **Evidence resolves
  against this and nothing else** — never the working tree.
- `generated_at` is optional, supplied by the producer, and part of the
  deterministic input. The renderer never reads a clock, so if a timestamp
  appears in an artifact, it came from here.

There is no `theme`, no `theme_default`, and no presentation default of any
kind. Those belong to the renderer, and the reader's own preference beats both.

### Evidence

One citation shape, used identically wherever evidence appears, in this kind and
every kind that follows:

```json
{ "path": "packages/create-pathfinder/src/kit.mjs", "lines": [97, 105] }
```

- `path` — repository-relative, forward-slashed. Never absolute.
- `lines` — optional inclusive `[start, end]`, 1-based, and must lie within that
  file at the resolved commit.
- `commit` — optional, overrides `source.commit` for this citation alone. Use it
  when one claim is about a different point in history, not to work around a
  citation that will not resolve.

## The `lesson` kind

`schemas/lesson.schema.json`.

```
lesson
  objectives?  string[]
  modules      module[]        one or many — nothing branches on the count
```

`learn-feature` supplies one module. `learn-codebase` supplies many. There is no
consumer-specific field, no mode flag, and no escape hatch: the same fields
serve both, and a change made to suit one has to be justified for the other.

### Module

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Lowercase, digits and hyphens. Becomes a link target, so it is unique across the artifact. |
| `title` | yes | |
| `summary` | no | |
| `requires` | no | Module ids this builds on. Edges must resolve and must not cycle. A flat list with no edges is legal, and is the single-module case. |
| `sections` | yes | At least one. |

### Sections

Discriminated by `type`.

**`prose`** — `body` paragraphs. For explanation that carries no claim needing
a citation.

**`concept`** — `title`, `body`, and `evidence`. A claim about the source.
`evidence` is required and must be non-empty; a concept citing nothing fails the
evidence layer, because an uncited claim is the renderer asserting domain
content, which it must never do.

**`code`** — `language`, `lines`, optional `title`, `caption`, `first_line`, and
`evidence`. Lines are emitted verbatim and escaped. `language` labels the
excerpt for the reader; it selects no highlighter, because highlighting is
either a dependency or a hand-rolled tokeniser and both are the renderer
starting to interpret content it was handed literally.

**`flow`** — `title` and `steps`. Each step has `id`, `title`, and optionally
`detail`, `next`, `evidence`. The first step is the entry. `next` is optional
and defaults to the following step, which is what a linear flow means without
saying so. Every step must be reachable from the first, and the graph must be
acyclic.

**`quiz`** — `questions`, each with `id`, `prompt`, `options` (2–8, distinct),
`answer` (an index into that question's own options), and optionally
`explanation` and `evidence`.

**`exercise`** — `title`, `body`, and optionally `hints` and `evidence`.

## What a producer cannot assert

There is no field for whether the specification was validated, whether its
evidence checked out, or whether the artifact is trustworthy. Those are claims
about work the engine performs, and the engine is the only thing entitled to
make them — see the verification section of `validation.md`.

Nor is there a field for the *wording* of those claims. The three provenance
sentences are the renderer's, and a producer cannot select one, soften one, or
request one it has not earned. `provenance` is not an exception: it declares what
kind of claim the diagram is making and thereby what will be *required* of it. A
producer choosing `derived` is choosing the stricter rules, not choosing the
stronger sentence.

## Text is text

No field is Markdown and no field is HTML. Every producer string is escaped on
the way out, so `<b>bold</b>` in a title renders as those nine characters,
visibly. That is the boundary working: content that smuggles markup is a
producer reaching for presentation by another route.
