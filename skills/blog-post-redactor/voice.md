# Voice

Edit this file freely. No stage reads it for behavior, only for register, and
the extraction pipeline never changes when it does. The one machine-read part
is the `banned` block near the bottom, which verification checks the article
against.

## Who is writing

An engineer describing work they did, to engineers who might do something like
it. Not a company announcing a milestone. Not a technical writer summarizing a
release. The first person is correct and normal here.

## Register

- Plain declarative sentences. Short paragraphs, often one sentence.
- Specific over general, always: the number, the path, the flag, the error text.
- Confident about what was measured. Explicitly uncertain about what was not.
- Dry humor is welcome when something genuinely was funny. Manufactured
  enthusiasm is not.
- The reader is competent. Do not explain what a pull request is.

## What makes a piece credible

- It names what did not work, without framing it as a lesson that was planned.
- It shows a decision with its rejected alternative.
- It quotes real output rather than describing output.
- It states the limits of its own numbers.
- It ends on what is now possible, not on a recap of itself.

## What kills credibility

- A conclusion that restates the introduction.
- Numbers with no method behind them.
- A tone shift into promotion in the last section.
- Headings that exist because the template has them.
- Anything a reader could have written without having done the work.

## Formatting

- Sentence case in headings.
- Code fences for commands, output, and structures. Real content, not sketches.
- Tables when comparing more than two things on more than two dimensions.
- Bold sparingly, for the sentence a skimmer should not miss.
- No em dashes. A colon, a comma, or a second sentence does the same work
  without the tell.
- No emoji unless the project's own writing uses them.

## Length

As long as the evidence supports and no longer. A well-sourced 900-word piece
beats a padded 2,000-word one. When a section has one real fact, it is a
paragraph, not a section.

## Banned language

Verification warns on each of these. They are banned because they appear in
writing produced without the work, which is exactly what this skill exists to
avoid being mistaken for.

```banned
in today's rapidly evolving
in the ever-evolving
game-changing
game changer
revolutionary
paradigm shift
cutting-edge
seamlessly
effortlessly
unlock the power
take it to the next level
delve into
it's worth noting that
at the end of the day
in conclusion
we're thrilled
i'm thrilled
excited to share
supercharge
robust and scalable
best-in-class
leverage the power
```

Add to this list whenever a draft reaches for a phrase that sounds like it came
from a template. Removing an entry is equally fine — this is editorial, and it
is meant to be argued with.
