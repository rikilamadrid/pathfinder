# verify

Stage 4. Check that the article is supportable, and fix it where it is not.

This stage does not ask whether the piece is good. It asks whether every claim
can be traced, whether the gaps are declared, and whether the run stayed inside
its own output directory.

## Run the checks

```bash
node skills/blog-post-redactor/engine/bin/blog-post.mjs verify --dir blog-posts
```

It exits non-zero on any error. The rules:

| Rule | Fails when |
| --- | --- |
| `metadata-shape`, `metadata-keys` | a required key is missing or empty |
| `metadata-slug` | the slug is not lowercase words joined by single hyphens |
| `metadata-confidence` | confidence is not `high`, `medium`, or `low` |
| `metadata-confirmations` | `needsHumanConfirmation` is not an array |
| `source-resolves` | a cited reference is not in the collected bundle |
| `confirmation-listed` | the article has more markers than metadata lists |
| `confidence-matches-evidence` | stated confidence is higher than the bundle supports |
| `write-scope` | anything outside the output directory changed during the run |
| `voice-banned-phrase` | the article uses language `voice.md` bans (warning) |

## Read the article again, against the evidence

The engine checks references. It cannot check whether a sentence says more than
its reference supports, which is the defect that actually gets through. Walk the
article paragraph by paragraph and ask of each factual sentence: which entry in
`evidence.md` is this, and does that entry reach as far as this sentence does?

Three failures to look for specifically:

- **Reach.** The evidence says a suite passed; the article says the system is
  reliable. Narrow the sentence to what was measured.
- **Causation.** Two things are in the same range. The article says one caused
  the other. Unless something states it, they are adjacent, not causal.
- **Borrowed certainty.** A number quoted without its conditions. A measurement
  without its machine, corpus, or method is a decoration.

Fix each by narrowing the claim, adding the missing condition, marking it
`[NEEDS HUMAN CONFIRMATION]`, or cutting it. In that order of preference.

## Warnings are decisions, not noise

A banned-phrase warning is `voice.md` telling you the sentence has gone generic.
Rewrite it. If the phrase is genuinely the right words for this piece, leave it
and say in your report that you did, and why.

## Report

State, in the final message:

- scope, and the range it resolved to
- the chosen angle and why
- evidence confidence, and the gaps behind it
- every `[NEEDS HUMAN CONFIRMATION]` item, as a question the human can answer
- the verification result
- the output paths

Do not commit, push, or publish anything, and do not offer to. The human
decides what happens to the files.
