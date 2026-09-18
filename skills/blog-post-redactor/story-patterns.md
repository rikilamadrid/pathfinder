# Story patterns

The shapes a piece of shipped work can take. Used by `angles`, and deliberately
separate from the extraction pipeline so that the catalogue can grow without
touching how evidence is read.

A pattern is not a template. It is a claim about which fact is the load-bearing
one.

## The catalogue

**The constraint that shaped everything.** One limit — no server, no budget, an
offline requirement, a deadline — forced a design nobody would choose freely,
and the design turned out to be better. Strongest when the constraint is stated
somewhere and the rejected alternative is visible in the history.
Needs: a decision with an alternative, and the constraint in writing.

**It broke in a way that taught something.** A failure during the work revealed
a wrong assumption. The article is the assumption, not the fix.
Needs: reverts, fixups, a rewritten module, or review findings that changed code.

**The number that changed the decision.** Something was measured, the result was
not what was expected, and the design changed because of it.
Needs: real measurements with their method, and evidence the design moved.

**The boundary that finally made sense.** Code was extracted, split, or moved,
and the interesting part is where the line landed and why there.
Needs: a diff that moves code across a boundary, plus a statement of the rule.

**Two things that looked the same and were not.** A distinction the work was
forced to make — two states, two vocabularies, two lifecycles — that a reader
will recognize from their own system.
Needs: the distinction named in code or docs, not just inferred.

**The boring version shipped first.** A deliberately unambitious implementation
chosen over the interesting one, with the reasoning for deferring.
Needs: the deferral stated somewhere, an issue, a changelog line, a doc.

**It had to survive something.** The work was proven by an interruption:
a crash, a quota limit, a conflict, a migration. Recovery is the story.
Needs: evidence the interruption actually happened, not that it was handled in
principle.

**The thing that is still wrong.** A known limitation with no small correct fix,
explained honestly. Unusually credible, and unusually rare.
Needs: the limitation recorded, and the rejected fixes with their reasons.

## Judging an angle

Ask four questions. An angle that fails the first two is not an article.

1. **Would an engineer who does not use this project learn something they could
   apply?** If the answer is "they would learn that this project exists", it is
   an announcement.
2. **Could this article have been written about a different project?** If yes,
   it is too general. The specifics are the value.
3. **Is the central claim the best-sourced claim?** An angle whose thesis needs
   `[NEEDS HUMAN CONFIRMATION]` is built on the one thing nobody verified.
4. **Does it survive the obvious objection?** Name the objection in the angles
   file. An angle with no stated weak point has not been examined.

## Anti-patterns

- **The release note in prose.** A list of what changed, in paragraphs. No claim.
- **The architecture tour.** Describes the system as it now is, with no decision,
  no alternative, and nothing that was learned.
- **The victory lap.** Every choice was correct, nothing was hard, the tests
  passed. Readers do not believe it, correctly.
- **The borrowed lesson.** A generic engineering maxim with this work used as an
  illustration. The work should generate the lesson, not decorate it.
