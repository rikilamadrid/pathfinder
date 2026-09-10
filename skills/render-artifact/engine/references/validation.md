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

These stay apart because they mean three different things to the person reading
them: a stale fixture, a moved file, and a shifted range are three different
fixes.

None of them downgrades to a skip. An engine that shrugged at an unresolvable
commit would deliver an artifact whose provenance block claims its evidence was
verified when nothing was.

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
commit. It carries that sentence only when this engine validated it and the
validation passed.

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
