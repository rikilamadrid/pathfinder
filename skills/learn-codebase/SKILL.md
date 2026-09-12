---
name: learn-codebase
description: Generate a modular, interactive learning portal that explains an entire codebase at a milestone.
---

# Learn Codebase

Use for onboarding, milestone review, handoff, or interview preparation — not
after every feature.

You write what is true about the repository. `render-artifact` turns it into the
page. Those are different jobs, and this skill only does the first one.

## Read

- the repository's own map: entry points, packages, workspaces, build and CI
  configuration
- architecture, major subsystems, and the boundaries between them
- domain concepts and the vocabulary the code already uses
- the flows that cross subsystems — a request, an install, a release, a build
- tests, and what they are actually protecting
- history and durable decisions, where they explain why the code is shaped this
  way

Exclude generated, vendored, and build output deliberately, and say so if the
exclusion is load-bearing.

Gather all of it **before** writing any specification. The specification is a
record of what you found, so finding has to finish first — a portal assembled
while still reading is a portal whose claims were chosen to fit the modules
already written.

## Output

Two files, one repository:

```text
learning/codebase/lesson.json    the semantic specification — yours
learning/codebase/lesson.html    the rendered artifact — the renderer's
```

The JSON is the reviewable source. A human can read it, disagree with a claim,
and see exactly what was asserted and what backs it. It is also what makes the
artifact reproducible: the same specification through the same renderer version
produces the same bytes.

One artifact, not a directory. There is no `index.html`, no `modules/` folder,
and no `assets/` — how a multi-module lesson is split, linked, and navigated is
a presentation decision, and presentation is the renderer's. You supply module
order and content; the renderer builds the navigation.

Do not author the HTML. Do not author CSS, presentation JavaScript, or MDX. Do
not stand up a docs system, a site generator, or a framework for this. There is
one visual-artifact path in Pathfinder and it runs through `render-artifact`.

## Process

1. **Gather the evidence** — the reading above.
2. **Pick the commit.** `source.commit` is the milestone the portal is *about*.
   Look it up and pin it; do not use whatever `HEAD` happens to be, which is
   only the same thing by accident and stops being the same thing the moment
   anything else merges. Evidence resolves against this commit and never against
   the working tree, so a later refactor cannot silently change what the portal
   claims.
3. **Write the specification** to `lesson.json`. Read
   `skills/render-artifact/engine/references/specification.md` for the fields
   and `engine/examples/lesson.json` for the shape. Many modules: this skill
   teaches a whole repository.
4. **Validate.**

   ```sh
   node skills/render-artifact/engine/bin/render.mjs validate \
     learning/codebase/lesson.json
   ```

5. **Deliver.**

   ```sh
   node skills/render-artifact/engine/bin/render.mjs deliver \
     learning/codebase/lesson.json \
     learning/codebase/lesson.html --json
   ```

6. **Report the receipt**, and report it honestly. See "What to say afterwards".

## Modules

One module per subsystem or concern, ordered so a reader can start at the top
and keep going. Modules may include: orientation, architecture, domain and data
flow, interfaces, services and integrations, testing, deployment and operations,
security boundaries, extension exercises, and a cumulative quiz.

Use `requires` when a module genuinely builds on another. That is the learning
graph, and it is semantic: it says what a reader needs first, not where a box
sits on a page. Leave it out when the modules are independent — a flat list is a
legitimate shape, not a missing field.

Keep each module a unit someone can finish. A module that has become a second
portal is two modules.

## Flows, not diagrams

Express a sequence, a relationship, or an architecture walkthrough as a `flow`
section. Its steps carry the order and the dependencies, which is the part that
teaches, and the renderer decides how that looks.

There is no diagram section, and this skill no longer promises navigable
diagrams. Do not hand-author SVG, do not describe coordinates or layout, and do
not reach for a drawing tool to fill the gap. A picture whose meaning is carried
by a `flow` loses nothing that teaches; a picture this skill draws itself is
presentation it does not own. Semantic diagram artifacts do exist — `map-system`
produces them, as a separate artifact of its own — and that is still not this
skill's output: a lesson gains no diagram section and references no diagram.

## Evidence

Every claim about the source carries a citation, in the one shape the renderer
uses everywhere:

```json
{ "path": "packages/create-pathfinder/src/kit.mjs", "lines": [97, 105] }
```

Every `concept` section must cite at least one. That is not a style preference:
a concept is an assertion about the code, and an uncited assertion is this skill
putting words in the renderer's mouth. Validation rejects it.

A repository-wide portal makes this easier to get wrong than a feature lesson
does, because the claims are broader. "The installer never ships tests" is a
claim about a specific list in a specific file — cite that list, not the package
it lives in. Breadth is not permission to cite loosely.

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
section, with `hints` when a nudge helps more than a solution. A cumulative
quiz at the end works well; so does one per module.

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

It says nothing about whether the portal reads well, teaches well, or looks
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
codebase in conversation or in Markdown where that is useful. That answer is not
a Pathfinder visual artifact. Do not call it one, do not hand-author HTML or MDX
to stand in for one, and do not reach for a second way to produce a page. A
non-zero exit is never reported as success, and a failed delivery leaves any
previously delivered artifact exactly as it was.

This skill reads widely by design. For one completed feature, use
`learn-feature` instead.
