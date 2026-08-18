# Tracker

> Starting point for `context/tracker.md`. `setup-tracker` fills the placeholders
> and keeps **one** projection block, then deletes this blockquote.
>
> **The file's absence is the off switch.** Work Tracking is optional. A project
> with no `context/tracker.md` behaves exactly as it always has, and nothing in
> Pathfinder prompts for one. Do not ship this template's output unconfigured.
>
> **The backend-neutral model is everything between the two markers below** —
> from `pathfinder:model-start` down to `pathfinder:projection-boundary` — and it
> **must be byte-identical whichever projection is chosen.** Choosing a backend
> cuts below the projection boundary and nowhere else. Nothing inside the model
> may be *defined* in a backend's terms — an "issue number", a "label", a file
> path. Naming one in order to rule it out is not the same thing and is correct:
> "edges name keys, never tracker issue numbers" is the neutrality rule being
> stated, not a leak. The test is whether changing backend would change the
> sentence.
>
> The two paragraphs above the model marker are this project's own — the tracker
> it uses, and the rule that the repository wins. They are *not* claimed to be
> byte-identical across backends: the first one names the tracker and how an
> agent reaches it, so it necessarily differs.

This project tracks work in `[tracker name]`, at `[where it lives]`, reached by
`[how to reach it]`.

The repository is canonical. This tracker is a **one-way projection** of work
that already exists in `context/features/`. Never read status back out of the
tracker and into a spec. If the two disagree, the repository is right and the
tracker is stale.

<!-- pathfinder:model-start
Everything from here to the projection boundary is the backend-neutral model. It
is byte-identical in every configured project, whichever backend is chosen.
Nothing between the two markers may be defined in a backend's terms; naming one
to exclude it is correct and is not a leak.
-->

## What gets tracked

Only **approved feature specs**, from `to-specs` onward. Never track debate
notes, kickstart output, or prototypes. The one exception is a prototype that
gates a decision, which may be tracked as a single item phrased as the decision
it resolves, never as a deliverable.

## The work item

Every tracked thing is a **work item**. A work item has:

- a **key** — stable, assigned by Pathfinder, never by the tracker
- a **kind** — what sort of thing it is
- a **title** and a **body**
- zero or more **blocked-by** edges, naming other work items by key
- zero or more **tags**
- an ordered list of **chunks** (features only)
- a **parent** key (tickets only)

### Keys

A key looks like `pathfinder:<kind>/<id>`. For a feature spec, the id is the
spec's number: `context/features/06-docs-site-scaffold.md` is
`pathfinder:feature/06`.

Keys are how a work item is recognised on a later run. Record the key inside the
published item so it can be found again without keeping a local index. Put it in
a marker block that the tracker will not render to a human:

```text
<!-- pathfinder:work-item
key: pathfinder:feature/06
kind: feature
blocked-by: pathfinder:feature/03
tags: area:site, type:infra, agent:suitable
chunks-projection: checklist
-->
```

Match on the key alone. Never match on the title — titles are edited by humans
and a title match will create duplicates or overwrite the wrong item.

**The title is written once, when the item is created, and is never reconciled
afterwards.** It is human-owned from that point on. This is a decision, not an
oversight, and it follows from the rule above: humans edit titles, so a
projection that rewrote them would overwrite that edit on every run. Renaming
the spec changes the pointer to it in the body, not the title.

**Prose alone is not sufficient for identity.** This marker is the one
machine-stable token in an otherwise prose contract. Everything else here can be
reworded; this cannot be removed on the grounds that the config is "just prose".
Without it there is no way to recognise an item on a second run, and publishing
stops being idempotent.

### Kinds

Two kinds are defined.

- `feature` — one approved feature spec. One branch, one review, one merge.
- `ticket` — an independently assignable unit of execution inside a feature,
  carrying its own blocked-by edges so that more than one agent can work a
  feature at once. A ticket names its feature with `parent`.

**A ticket is not a delivery chunk.** Chunks are a planning device inside a spec;
tickets are units of execution. They may coincide, and they routinely will not: a
ticket may span several chunks, and a ticket may exist that belongs to no chunk
at all — a prefactor, or a decision that gates the rest. Nothing in this model
derives one from the other, and a projection that assumed `ticket == chunk` would
be wrong rather than simplified.

**Do not treat a chunk as permanently equal to a checkbox either.** Chunk
rendering is a *projection choice* named by `chunks-projection`, not a fact about
the model.

Feature and ticket are the **same work item**. They carry the same fields, the
same marker, the same edge semantics, the same tag model, and the same
idempotency rule. `chunks` is simply absent on a ticket, and `parent` is absent on
a feature — optional fields, not different shapes. **No rule anywhere may branch
on `kind`.**

### Parent

A ticket names the feature it belongs to with `parent`, a key. Parentage is
**not** a blocking edge and must never be rendered as one: a ticket is not
blocked by its feature. Rendering parentage as a blocker produces a graph that
never unblocks.

### Blocked-by edges

Edges name **keys**, never tracker issue numbers. Resolving a key to an issue
number is the projection's job, and the same edge must survive being pointed at a
different tracker.

An edge may name a work item that is **not in the set being published**. That is
normal — a feature can depend on one that was tracked earlier or not at all. Do
not drop such an edge and do not invent an item for it. Record it in the body as
unresolved, naming the key, and say plainly that it has no item in this tracker.

Publish in dependency order, blockers first, so an edge can reference a real
identifier by the time it is written.

### Tags

A tag is `namespace:value`. The namespace says what kind of statement the tag is
making; the value is free text.

Namespaces in use here:

- `area` — the part of the system touched, e.g. `area:site`, `area:cli`
- `type` — the nature of the work, e.g. `type:infra`, `type:content`
- `priority` — only when the project actually uses one, e.g. `priority:now`
- `agent` — suitability for autonomous work, e.g. `agent:suitable`,
  `agent:needs-human`

**Tags are backend-neutral.** The list above is the whole model. How a tag
becomes a label, a field, or a line of text is a projection concern.

**Respect what the tracker already has.** Before introducing any tag value,
list the values the tracker already carries. If one already means the same
thing, use it and record the mapping below rather than creating a
near-duplicate. Never invent a taxonomy the team did not ask for, and never
apply a tag that is not in the mapping table.

### Body composition

The body is a **pure function of the spec**. The same spec must produce the same
body on every run. This is not tidiness: re-publishing decides what to do by
comparing the body it would write now against the one already there, so a body
that varies between runs rewrites every item forever while appearing to work.

Compose it in this order, and **omit any section whose source is absent** rather
than emitting it empty:

1. a pointer to the spec this item projects
2. the blocked-by edges
3. the parent, on a ticket
4. the delivery chunks
5. the statement that the repository is canonical and that nothing here is read
   back
6. the marker block, last

**Never include anything derived from the run rather than the spec** — no date,
no timestamp, no run counter, no tally of what changed, no note of who published
it. Each of those differs on the next run and each would make every item look
modified. Never re-wrap or re-summarise text taken from the spec: copy it the
same way every time, or the same spec produces two different bodies.

How each of these elements *renders* is a projection concern. The order, the
omission rule, and the absence of run-derived content are not.

<!-- pathfinder:projection-boundary
This marker closes the neutral model opened by `pathfinder:model-start`.
Everything below is one projection. Keep exactly one of the two blocks that
follow, and delete this marker, the model-start marker, and the block you did
not keep.
-->

## Projection to GitHub

*Keep this block for a GitHub Issues tracker; delete the local-files block below.*

- One work item → one issue.
- Title → the spec's title, prefixed with its number: `06 — Docs Site Scaffold`.
- The marker block goes at the **end** of the issue body.
- `blocked-by` → a `**Blocked by**` line naming each blocker as
  `#<number> (<key>)`, or `<key> — not tracked here` when it resolves to nothing.
- `parent` → a `**Parent**` line naming the feature as `#<number> (<key>)`.
  Never render parentage as a blocking edge.
- `chunks` under `chunks-projection: checklist` → a `## Delivery chunks` section
  of `- [ ]` items in spec order. **A checked box means nothing to Pathfinder.**
  The repository is canonical; a human ticking a box does not advance any state
  and must never be read back.
- Tags → labels, via this mapping. Create a label only if nothing equivalent
  exists. Replace the rows below with this project's own tags and the labels the
  repository already carries.

  | Tag | GitHub label | Colour |
  |---|---|---|
  | `area:site` | `area:site` | `1d76db` |
  | `area:cli` | `area:cli` | `1d76db` |
  | `type:infra` | `type:infra` | `5319e7` |
  | `type:content` | `documentation` *(pre-existing — reused, not duplicated)* | `0075ca` |
  | `agent:suitable` | `agent:suitable` | `0e8a16` |
  | `agent:needs-human` | `agent:needs-human` | `d93f0b` |

### Publishing, and re-publishing

**Ask the human before the first write to this tracker in a session.** Creating
issues on a shared repository is outward-facing and is not covered by ordinary
file-edit approval.

Publishing is **idempotent**. Re-running must be safe and must be provably inert
when nothing changed:

1. Read every existing issue in the repository, open and closed, and index them
   by the key in their marker block.
2. For each work item, if no issue carries its key, create one.
3. If an issue carries its key, compare the rendered body and the label set to
   what would be published now. **If they are identical, do nothing at all** —
   no edit, no comment, no label call. An unchanged item must produce zero
   writes, not a write that happens to be a no-op.

   **Compare normalized, never raw bytes.** GitHub does not return a body
   byte-for-byte as it was sent: it appends a trailing newline. A naive byte
   comparison therefore reports every issue as changed on every run and rewrites
   all of them forever, which looks like working sync and is not. Before
   comparing, strip trailing whitespace from each line and collapse trailing
   blank lines at end of body, on **both** sides. Compare label sets as sets, not
   as ordered lists — the tracker does not preserve the order they were applied.
4. If they differ, edit that issue in place. Never close and recreate.
5. Never close an issue, never reopen one, and never touch an issue whose key is
   absent from the current set — it belongs to work outside this run.

Report what was created, what was edited, and what was left alone.

## Projection to local files

*Keep this block for a local Markdown tracker; delete the GitHub block above.*

- One work item → one file, `.work/<NN>-<slug>.md`, numbered from `01` in
  dependency order so blockers sort first.

  `<NN>` is assigned **once**, when the file is first created, from the
  dependency order at that moment. It is an identifier, **not a live claim about
  ordering**. A later dependency change does not renumber the files that already
  exist: renaming a file is deleting one and creating another, and re-publishing
  must never do that — it would rewrite unrelated files every time a blocker was
  inserted. Read the current order from the `**Blocked by**` lines, which are
  reconciled. The number prefixes are not.
- Title → an `# ` heading, prefixed with its number: `06 — Docs Site Scaffold`.
- The marker block goes at the **end** of the file.
- `blocked-by` → a `**Blocked by**` line naming each blocker as
  `<file> (<key>)`, or `<key> — not tracked here` when it resolves to nothing.
- `parent` → a `**Parent**` line naming the feature as `<file> (<key>)`.
  Never render parentage as a blocking edge.
- `chunks` under `chunks-projection: checklist` → a `## Delivery chunks` section
  of `- [ ]` items in spec order. **A checked box means nothing to Pathfinder.**
  The repository is canonical; a human ticking a box does not advance any state
  and must never be read back.
- Tags → a `**Tags**` line listing them verbatim, comma-separated, in the order
  given. There is no label object to create, so the mapping is the identity
  mapping and no colour applies. Replace the rows below with this project's own
  tags.

  | Tag | Local rendering |
  |---|---|
  | `area:site` | `area:site` |
  | `area:cli` | `area:cli` |
  | `type:infra` | `type:infra` |
  | `type:content` | `type:content` |
  | `agent:suitable` | `agent:suitable` |
  | `agent:needs-human` | `agent:needs-human` |

### Publishing, and re-publishing

No approval is required to write under `.work/` — it is an ordinary file edit in
this repository and reaches nothing outside it.

Publishing is **idempotent**. Re-running must be safe and must be provably inert
when nothing changed:

1. Read every existing file under `.work/` and index them by the key in their
   marker block.
2. For each work item, if no file carries its key, create one.
3. If a file carries its key, compare its full contents to what would be written
   now. **If they are identical, do nothing at all** — do not rewrite the file
   with the same bytes. An unchanged item must leave its mtime untouched.
4. If they differ, rewrite that file in place. Never delete and recreate.
5. Never delete a file, and never touch a file whose key is absent from the
   current set — it belongs to work outside this run.

Report what was created, what was edited, and what was left alone.
