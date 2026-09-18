# write

Stage 3. Write the article for the selected angle.

Read, in this order: `blog-posts/angles.md` for the chosen angle,
`blog-posts/evidence.md` for the facts, `../voice.md` for how it sounds.

Do not re-read the repository. Everything you are allowed to assert is already
in `evidence.md`. Reaching back into the diff at this stage is how a paragraph
that needed one more fact invents one.

## Structure

The default, from `../templates/article.template.md`:

```text
# Title
## The problem
## What I tried
## What actually worked
## How it works
## An interesting technical detail
## What I learned
## What this unlocks next
```

Use it as a spine, not a form. Drop a heading with nothing real under it —
an empty "What I tried" is worse than no section, because it advertises that
the work had no difficulty. Merge two when the story runs through both. Rename
one when the specific work has a better name for it. A piece that ends up with
five headings because the other two were padding is the better piece.

`An interesting technical detail` is the section most worth protecting. It is
where a reader decides the author actually built this.

## Writing

- Lead with the problem, in concrete terms. Not context, not a preamble.
- Prefer the specific: the number, the path, the flag, the error, the sha.
- Show the decision, including the option you rejected and why.
- Keep the failure. A piece with no dead end reads like marketing.
- Explain mechanism, not just outcome. "How it works" should let a reader
  rebuild the idea in their own stack.
- End on what the work makes possible, not a summary of what was said.

## Evidence discipline

- Every factual claim traces to `evidence.md`.
- A claim with no support gets `[NEEDS HUMAN CONFIRMATION]` immediately after
  it, in place, and an entry in `metadata.json`'s `needsHumanConfirmation`.
- Prefer deleting the claim. The marker is for a claim the article genuinely
  needs and the repository cannot settle, not a license to speculate.
- Do not put source references in the article body — it is prose, not a
  citation list. Traceability is verified through `evidence.md`, which is why
  that file exists.
- No invented quotes, no invented user reactions, no invented timelines, no
  numbers that were not measured.

## Also write

- `metadata.json` from `../templates/metadata.template.json`. `scope` is the
  collector's own description of the scope. `evidenceConfidence` follows the
  rules in `../evidence-model.md`, and verification will fail an optimistic one.
- `linkedin.md` from its template: the article's claim in a form that stands
  alone, no hashtag wall, no "thrilled to share".
- `x-thread.md` from its template: numbered, one idea per post, the first post
  carrying the actual claim rather than a tease.

Both social outputs obey the same evidence rules. A thread is not a place where
unsupported claims become acceptable because they are short.

## Then

Run `verify`. Do not report the work as done before it passes.
