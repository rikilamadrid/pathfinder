# angles

Stage 2. Decide what the story is, before writing a word of it.

Read `blog-posts/evidence.md`. Read `../story-patterns.md`. Do not re-read the
repository — if the evidence is too thin to find a story in, that is a finding
about the evidence, and the answer is another collection pass, not improvisation.

## Generate three to five

Fewer than three means you took the first idea. More than five means you are
listing facts rather than proposing stories.

Each one is a different *claim about what mattered*, not the same article with
different titles. If two angles would cite the same evidence in the same order,
they are one angle.

For each, using `../templates/angles.template.md`:

- **Title** — the actual headline, not a topic label
- **Central idea** — one sentence a reader could repeat afterwards
- **Why it is interesting** — to an engineer who does not use this project
- **Strongest evidence** — the specific source references that carry it
- **Weakest point** — where it would fall apart under questioning
- **Confidence** — high, medium, or low, on the evidence behind *this* angle,
  which is not the same as confidence in the bundle as a whole

## Judge them honestly

An angle is strong when a reader who does not care about the project still
learns something transferable, and when the evidence is specific enough that
the article could not have been written about a different project.

An angle is weak when it needs `[NEEDS HUMAN CONFIRMATION]` on its own central
claim, when its most interesting sentence is the one with no source, or when it
is really an announcement wearing an article's clothes.

Say so. An angles file where all five are strong is a file nobody thought about.

## Recommend one

Name it, in one paragraph, saying why it beats the runner-up. Where the
strongest angle is not the most flattering one, recommend it anyway and say
that is what you are doing.

## Show the stories

Write `blog-posts/angles.md` first, so the choice is on the record. Then put the
candidates in the conversation. Choosing the story is the interesting part of
this skill, and a stage that picks one silently has hidden the only decision
the human was going to care about.

```text
Stories found

1. The orchestrator proved itself when its workers died
2. Why we separated orchestration state from execution
3. What 1,700+ tests actually protected during the release

Recommended: #1

Reason:
Strongest combination of real failure, engineering decision, and evidence.
```

Titles are the real headlines from the file, in its order. The reason is one or
two lines — the paragraph already lives in `angles.md`, and repeating it here
buries the list.

Then continue as Pathfinder does elsewhere: the agent recommends with its
reasoning, and the human chooses.

- Invoked as `angles`, stop here.
- Invoked as `write`, say which angle you are continuing with and go on to the
  write stage. Do not wait for an answer that the invocation did not ask for,
  and do not bury the fact that a choice was made.

Either way the human can name a different number, or edit `angles.md` and re-run
`write`, without collecting evidence again.
