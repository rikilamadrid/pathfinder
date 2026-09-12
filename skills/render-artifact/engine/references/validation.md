# Validation and delivery

Four layers. Each supports a different claim, each is reported separately, and
none of them is a warning.

```
structural   the specification satisfies its schema
composition  identifiers, references, graphs and answers are coherent
evidence     every citation resolves at the declared commit
delivery     the artifact was rendered, digested, and committed atomically
```

Structural runs first and alone: composition and evidence assume a specification
that already has the right shape, so if structural fails they do not run and the
report says so rather than showing them as passing. Composition and evidence are
independent of each other and run together, so one round trip surfaces both.

A layer can also be **not run because it does not apply**, which is reported
distinctly from both a pass and a skip. A `diagram` declaring no source has no
evidence layer: there is no commit to resolve against, and the structural layer
has already refused any citation in it, so there is provably nothing to check.
The report says `~ evidence: not run` and gives the reason.

That distinction is the whole point of keeping it. Reporting such a layer as
`ok evidence` would put the strongest word in the report against the weakest
claim in it, and a reader skimming four green lines would conclude the citations
had been verified when there were none.

## Commands

```sh
node engine/bin/render.mjs validate <spec.json> [--repo <dir>] [--json]
node engine/bin/render.mjs deliver  <spec.json> <out.html> [--repo <dir>] [--json]
node engine/bin/render.mjs doctor   [--json]
```

`--repo` names the repository whose history evidence resolves in. It defaults to
the specification's own directory, which is right when the specification lives
in the repository it cites, and is exactly what needs overriding when it does
not.

Exit codes are the contract:

| Code | Meaning |
| --- | --- |
| 0 | every layer that ran passed, and the artifact was committed |
| 1 | a layer failed; nothing was committed |
| 2 | the command line was wrong |

A non-zero exit is never reported as success.

## Structural

Schema validation, plus two refusals that come before it:

| Code | Meaning |
| --- | --- |
| `schema_version_unsupported` | the specification is written against a contract this engine does not implement |
| `kind_unsupported` | no such artifact kind. Refused — not a reason to improvise HTML |
| `presentation_control` | a field like `color`, `css`, `class`, `layout` or `theme`. Rejected, never ignored |
| `unknown_field` | a field this contract does not have |
| `missing_field` | a required field is absent |
| `schema_*` | one keyword rejected one value; the message names both |
| `topology_unsupported` | a `diagram` asked for a layout this renderer does not have |
| `label_too_long` | a label is wider than its column cap. Refused, never shortened |
| `source_required_for_derived` | a `derived` diagram does not say which repository or which commit it was derived from |
| `citation_without_source` | a specification with no source carries a citation. There is nothing to resolve it against |
| `artifact_summary_forbidden` | a `derived` diagram carries `artifact.summary`, which is the one claim-bearing prose with nowhere to put a citation |

The last three are the provenance contract's structural half — see
**Provenance** below.

`presentation_control` and `unknown_field` have the same *outcome* —
`additionalProperties: false` rejects either. They differ in the diagnostic,
because a producer who wrote `"color"` believed presentation was theirs to set,
and the error should say so instead of talking about arrays and properties.

## Composition

| Code | Meaning |
| --- | --- |
| `duplicate_identifier` | two modules or sections share an id; identifiers become link targets |
| `duplicate_step_identifier` | two steps of one flow share an id |
| `duplicate_question_identifier` | two questions of one quiz share an id |
| `unresolved_reference` | a `requires` or `next` names something that does not exist |
| `graph_cycle` | a module or flow graph leads back to itself |
| `orphan_step` | a flow step is unreachable from the flow's first step |
| `orphan_module` | a module is unreachable from every module without prerequisites |
| `answer_out_of_range` | a quiz answer does not index its own options |
| `module_empty` | a module carries no sections |

Note what "orphan" means for modules. With no `requires` anywhere, every module
is a root and nothing is orphaned — a flat list is a legal graph, and that is
the single-module case, which must stay legal. Orphans only become possible once
edges exist.

## Evidence

Resolved against the commit, using local Git. Nothing is fetched, cloned, or
looked up over a network: a commit that is not present locally is a commit whose
evidence was not verified, and the engine says so rather than going to find one.

| Code | Meaning |
| --- | --- |
| `source_commit_unavailable` | the declared commit cannot be resolved here — wrong repository, unfetched commit, or no repository at all |
| `evidence_path_absent` | the commit resolves; the file is not in it |
| `evidence_range_invalid` | the file is there; the cited lines are not |
| `concept_without_evidence` | a concept cites nothing |
| `node_without_evidence` | a `derived` diagram says a component exists and cites nothing for it |
| `edge_without_evidence` | a `derived` diagram asserts a relationship and cites nothing for it |
| `claim_without_evidence` | a `derived` group, path or view carries `summary` or `note` prose with no citation |

The first three stay apart because they mean three different things to the
person reading them: a stale fixture, a moved file, and a shifted range are
three different fixes.

None of them downgrades to a skip. An engine that shrugged at an unresolvable
commit would deliver an artifact whose provenance block claims its evidence was
verified when nothing was.

### What this layer establishes, and what it does not

That the cited file exists at the declared commit, that the cited line range
exists in it, and that the material is there to be read.

Not that the claim resting on it is true.

Repository documentation — a README, an ADR, a runbook — is first-class citation
material and is checked exactly the same way. That is not a statement that
documentation carries the same authority as the code it describes; it is a
statement that the engine can tell you where to look and cannot tell you whether
what you find is right.

**Pathfinder verifies provenance, not truth.** No diagnostic and no word in any
artifact may imply otherwise.

## Provenance

A `diagram` declares `provenance`, and it decides how strictly the diagram is
checked. There is no default: a diagram that did not say would have a trust level
assigned to it by the engine, and the engine has no business guessing which claim
its producer meant to make.

| | `derived` | `proposed`, with source | `proposed`, no source |
| --- | --- | --- | --- |
| `source` | required | permitted | absent |
| citations | required on every node and edge | optional | **refused** |
| claim-bearing group, path or view | must cite | optional | **refused** |
| label-only group, path or view | needs nothing | needs nothing | needs nothing |
| `artifact.summary` | refused | permitted | permitted |
| evidence layer | runs | runs | not run, with the reason |

A `derived` diagram maps what the repository asserts about itself at the declared
commit, so there is no uncited derived fact. A node says a component exists and
an edge says two things relate; each is a claim a reader must be able to go and
check. Evidence is *where a reader goes to check an assertion*, which is not
always the code implementing it — an actor is cited by the entry point that
accepts it, an external system by its client or its configuration, a subsystem by
its manifest or entry module.

A component that appears nowhere in source, configuration, infrastructure or
repository documentation is not eligible for a `derived` diagram at all. A
diagram that needs it is `proposed`.

A group, path or view is the one narrower case. Its label is a name, and a name
asserts nothing its already-cited members do not. Its `summary` or `note` is
prose making a further claim, and that is what needs backing.

`lesson` has no `provenance` field and is unaffected by any of it. `source`
remains unconditionally required there: the conditional lives in the diagram
schema, not in the shared contract, precisely so that making one kind's source
optional did not make every kind's provenance optional.

## Delivery

Delivery takes the specification as **bytes** and nothing else. It copies them,
parses that copy, validates the parsed value, renders that same value, and
reports the digest of those same bytes. There is no parameter through which a
caller could supply a specification object alongside unrelated bytes, because a
receipt that described a specification nobody rendered would be undetectable
downstream.

Rendering then runs against a deep-frozen copy, so a renderer that mutated its
own input would throw rather than quietly produce output nobody can reproduce
from the file on disk.

### Verification is earned, not asserted

An artifact carries a sentence saying its evidence was checked against the named
commit. It carries that sentence only when **both** of these are true:

1. this engine validated the specification and the validation passed, and
2. at least one citation actually resolved.

The second condition is the guard against a vacuous claim. A specification
carrying no citations passes the evidence layer by having nothing to fail, and an
artifact saying "every citation above was verified against the commit named here"
on the strength of that would be a stronger statement than anybody made — with
no citation above, and sometimes a commit that does not exist. Nothing to check
is not the same as everything checking out.

So a `proposed` diagram with a source and no citations gets no sentence, and
neither does a lesson that cites nothing. Both are still valid, and both still
deliver; what they do not get is credit for a check that had no subject.

#### The three wordings

Renderer-owned, and different in each state because each supports a different
claim. **No field in any specification selects, softens, or requests one.** They
live in the shared shell rather than in a kind renderer because they describe
what the *engine* did, which is the same whatever kind rendered into it.

| State | What the artifact says |
| --- | --- |
| `derived` | the schema, references and graphs checked out, and every component, relationship and claim carried a citation verified at the declared commit. Explicitly **not** a finding that the architecture drawn is correct or complete |
| `proposed`, source, ≥1 resolved citation | the citations supplied were verified at the declared commit, and explicitly **do not** establish that the system drawn exists |
| `proposed`, source, no citations | nothing |
| `proposed`, no source | no verification sentence. Instead: that the diagram describes an intended system, names no repository or commit, and makes no claim about what currently exists |
| `lesson` | unchanged from what it has always said |

A source-less artifact also carries **no repository row, no commit row and no
timestamp**. None of them is invented from the working directory, the
environment, or a clock: there is no honest value, and a plausible one would be
worse than none, because it would read as provenance.

`render()` is a public export and does not validate. Called directly it emits
the provenance rows and **no verification language at all** — not "unverified",
not a placeholder, nothing. An artifact that cannot vouch for itself says
nothing on the subject, and the absence of the sentence is the signal; saying
"unverified" would still be the renderer making a claim about a process it did
not observe.

The claim is gated on an attestation, which only `verification.attest()` mints,
and only from a validation result this engine branded on the way past. The brand
is a module-private symbol — not `Symbol.for`, not a string key — so a
hand-built `{ ok: true }` is refused. `deliver()` validates and mints one
itself.

There is no producer-facing counterpart, and there must never be one. No
`verified`, no `validation_status`, no field of any name in the specification
can influence this. A producer asserting that its own work was checked is
exactly the claim this design exists to make impossible.

The artifact is written to a temporary file beside the destination, flushed with
`fsync`, and renamed over it. A rename within a directory is atomic, so a reader
never sees a half-written page. The `fsync` matters as much as the rename:
without it the rename can be durable while the content behind it is not, which
is how a crash leaves a correctly named, empty artifact.

A failure at any point leaves a previously delivered artifact exactly as it was.

| Code | Meaning |
| --- | --- |
| `render_failed` | rendering threw; nothing was written |
| `carriage_return_in_output` | output contains `\r`; artifacts use `\n` only |
| `byte_order_mark_in_output` | output begins with a BOM; artifacts are UTF-8 without one |
| `commit_failed` | the artifact could not be written or renamed |

The receipt names the renderer version and the SHA-256 and byte count of both
the specification and the artifact.

## What a green result is not

It is not a judgement that the artifact looks right. Nobody has looked at it.

Report the two separately, always. A human opening the artifact in a browser is
a different kind of evidence about a different question, and neither result
supports the other.
