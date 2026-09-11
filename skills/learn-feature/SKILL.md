---
name: learn-feature
description: Generate a rich, interactive, feature-scoped lesson and quiz from completed implementation.
---

# Learn Feature

Use after a feature is completed and accepted.

You write what is true about the feature. `render-artifact` turns it into the
page. Those are different jobs, and this skill only does the first one.

## Read

- completed feature spec and history entry
- relevant diff/commits when available
- only the implemented files and direct dependencies needed to explain the feature
- tests and durable decisions

Gather all of it **before** writing any specification. The specification is a
record of what you found, so finding has to finish first — a lesson assembled
while still reading is a lesson whose claims were chosen to fit the paragraphs
already written.

## Output

Two files, one per feature:

```text
learning/features/[feature-slug]/lesson.json    the semantic specification — yours
learning/features/[feature-slug]/lesson.html    the rendered artifact — the renderer's
```

The JSON is the reviewable source. A human can read it, disagree with a claim,
and see exactly what was asserted and what backs it. It is also what makes the
artifact reproducible: the same specification through the same renderer version
produces the same bytes, so the page can be delivered again after a renderer
release without re-deriving anything.

Do not author the HTML. Do not author CSS, presentation JavaScript, or MDX.
There is one visual-artifact path in Pathfinder and it runs through
`render-artifact`.

## Process

1. **Gather the evidence** — the reading above.
2. **Pick the commit.** `source.commit` is the commit the lesson is *about*:
   the one that landed the feature. Look it up; do not use whatever `HEAD`
   happens to be, which is only the same thing by accident and stops being the
   same thing the moment anything else merges. Evidence resolves against this
   commit and never against the working tree.
3. **Write the specification** to `lesson.json`. Read
   `skills/render-artifact/engine/references/specification.md` for the fields
   and `engine/examples/lesson.json` for the shape. One module: this skill
   teaches one feature.
4. **Validate.**

   ```sh
   node skills/render-artifact/engine/bin/render.mjs validate \
     learning/features/[feature-slug]/lesson.json
   ```

5. **Deliver.**

   ```sh
   node skills/render-artifact/engine/bin/render.mjs deliver \
     learning/features/[feature-slug]/lesson.json \
     learning/features/[feature-slug]/lesson.html --json
   ```

6. **Report the receipt**, and report it honestly. See "What to say afterwards".

## Lesson content

- what changed and why
- architecture and data/control flow
- important files and responsibilities
- key implementation decisions and tradeoffs
- tests and verification
- common mistakes and safe extension points

Express a sequence or a set of relationships as a `flow` section — its steps
carry the order and the dependencies, which is the part that teaches. The
renderer decides how a flow looks.

## Evidence

Every claim about the source carries a citation, in the one shape the renderer
uses everywhere:

```json
{ "path": "packages/create-pathfinder/src/kit.mjs", "lines": [97, 105] }
```

Every `concept` section must cite at least one. That is not a style preference:
a concept is an assertion about the code, and an uncited assertion is this skill
putting words in the renderer's mouth. Validation rejects it.

`lines` is optional and, when present, must lie inside that file at that commit.
Cite the range a reader should actually look at.

`source.generated_at` is yours to supply if you want a date on the page. The
renderer never reads a clock, so if no date appears in the specification, none
appears in the artifact.

## Quiz

Questions are multiple choice: a prompt, two to eight distinct options, and the
index of the correct one. An explanation and evidence are worth adding.

That one shape covers more than it looks:

| To ask | Write |
| --- | --- |
| true/false | a question with two options |
| predict the output or the state | a `code` section, then a question about it |
| a debugging scenario | the symptom as the prompt, candidate causes as options |
| recall or discrimination | an ordinary multiple-choice question |

For something a reader should *do* rather than answer, use an `exercise`
section, with `hints` when a nudge helps more than a solution.

## What you cannot ask for

The specification carries no presentation. There is no field for a colour, a
class, a width, a layout, an icon, a theme, or a template, and the schema
rejects the attempt rather than ignoring it. Interface language — navigation
labels, theme controls, accessibility text, the evidence and citation UI — is
the renderer's, in its words.

Text is text. No field is Markdown and no field is HTML: every string you write
is escaped on the way out, so `<b>bold</b>` in a title renders as those nine
characters. Content that smuggles markup is this skill reaching for
presentation by another route.

There is also no field for whether the specification was validated or whether
its evidence checked out. Those are claims about work the engine performs, and
the engine is the only thing entitled to make them.

## What to say afterwards

The receipt names the renderer version and the SHA-256 and byte count of both
the specification and the artifact. Report it. It supports one real claim: this
specification, compiled by this renderer, produced these bytes, and its evidence
resolved at the commit it names.

It says nothing about whether the lesson reads well, teaches well, or looks
right. Nobody has looked at it. So report the validation result and say
separately that perceptual review has not happened. If a human then opens it,
that is their finding, in their words — and it is not evidence for the
validation result any more than the validation result is evidence for it.

## When the renderer cannot run

Check with:

```sh
node skills/render-artifact/engine/bin/render.mjs doctor
```

If the engine is unavailable, or delivery fails, you may still explain the
feature in conversation or in Markdown where that is useful. That answer is not
a Pathfinder visual artifact. Do not call it one, do not hand-author HTML or MDX
to stand in for one, and do not reach for a second way to produce a page. A
non-zero exit is never reported as success, and a failed delivery leaves any
previously delivered artifact exactly as it was.

Keep the lesson scoped, and avoid reading the whole repository — use
`learn-codebase` for that.
