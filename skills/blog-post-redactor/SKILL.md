---
name: blog-post-redactor
description: Turn shipped engineering work into a credible technical article, built only from evidence in the repository.
argument-hint: write|collect|angles|verify [--pr N | --since REF | --range A..B | "scope"]
---

# Blog Post Redactor

Turn work that actually shipped into an article a working engineer would finish
reading. The source material is the repository: commits, diffs, pull requests,
the changelog, docs, tests. Not recollection, and not the model's sense of what
a project like this probably did.

This is not a blog generator. It refuses to write the parts it cannot support.

## Where this fits

Pathfinder's other loops build the work and record what happened. This one turns
that record outward: it reads work Pathfinder can prove happened and produces a
technical story worth publishing.

```text
/ticket complete — a feature, ticket, or release lands
        ↓
/blog-post-redactor write
        ↓
collect   reconstruct what actually happened, from the repository
        ↓
angles    find the stories in it, and recommend one
        ↓
write     write the chosen post
        ↓
verify    check it against its own evidence
```

It reads whatever repository the session is working in, which is how every other
Pathfinder skill behaves. There is no separate mode for that.

## Invocation

```text
/blog-post-redactor write
/blog-post-redactor write --pr 126
/blog-post-redactor write --since v4.3.0
/blog-post-redactor write --range v4.3.0..HEAD
/blog-post-redactor write "Pathfinder 4.4.0"
```

`write` runs the whole pipeline. The four stage names run one stage each, which
is how you resume after a correction instead of starting over:

```text
/blog-post-redactor collect --since v4.3.0
/blog-post-redactor angles
/blog-post-redactor write
/blog-post-redactor verify
```

A free-text scope names work in human terms. It cannot be resolved to commits
on its own, so collection records that gap and every later stage treats the
boundary as unconfirmed until a human supplies a ref.

## Process

1. Take the action from the invocation. With none, run `write`.
2. Read only `skills/blog-post-redactor/actions/<action>.md` and follow it exactly.
3. `write` runs `collect`, `angles`, `write`, `verify` in that order, reading
   each stage file when it reaches that stage — never all four at once.

## The pipeline

Four stages, separated on purpose. Each one reads the artifact the previous
stage wrote, not the previous stage's reasoning.

```text
collect  → blog-posts/evidence.json, blog-posts/evidence.md
angles   → blog-posts/angles.md, and the candidates shown in the conversation
write    → blog-posts/article.md, metadata.json, linkedin.md, x-thread.md
verify   → a report, and edits to the outputs above
```

Keeping them apart is the point. Extraction that already knows the story it
wants will find that story; a writing stage that can still reach the repository
will reach for whatever the paragraph needs. The artifact between two stages is
the contract, and it is a file so that a human can read it, correct it, and
re-run one stage.

## Outputs

Everything lands in `blog-posts/` at the repository root, or in the directory
the human names. Nothing is written anywhere else.

```text
blog-posts/
  evidence.json     the collected bundle, machine-readable
  evidence.md       the structured evidence model, human-readable
  angles.md         3–5 candidate stories, with a recommendation
  article.md        the article
  metadata.json     title, slug, summary, angle, scope, confidence, open questions
  linkedin.md       a LinkedIn post
  x-thread.md       an X thread
```

## Rules

These hold in every stage.

- **Evidence or nothing.** Every factual claim traces to a source reference in
  the collected bundle. The grammar is in `evidence-model.md`.
- **Mark what you cannot support.** A claim worth making that no evidence backs
  is written with `[NEEDS HUMAN CONFIRMATION]` beside it and listed in
  `metadata.json`. Prefer cutting the claim. Never quietly assert it.
- **Read-only against the repository.** Collection runs an allowlist of git
  subcommands and refuses everything else. No stage commits, stages, branches,
  rewrites history, or edits a source file. `verify` fails the run if anything
  outside the output directory changed.
- **The human owns publication.** This skill writes files. It does not commit,
  push, post, or publish, and it does not offer to.
- **Voice is configuration.** How the article sounds is `voice.md`. What counts
  as a story is `story-patterns.md`. Neither is part of the extraction logic,
  and editing either must never require editing a stage.

## Files

- `evidence-model.md` — the typed evidence model and the source-reference grammar
- `voice.md` — voice, banned language, register. Edit freely.
- `story-patterns.md` — the angle catalogue and how to judge one
- `templates/` — the shape of each output
- `engine/` — the deterministic ends: read-only collection, and verification

## Any repository Pathfinder is working in

Nothing here names a project, a stack, or a publication, so the skill works on
whatever repository the session is in — the same as the rest of the kit. A
repository with no pull requests, no changelog, and no tests still produces a
blog post; it produces a smaller one, with lower stated confidence, and says
which evidence was absent. That degradation is a feature of the design, not an
edge case.
