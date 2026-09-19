# collect

Stage 1. Extract facts. Write no prose about them yet.

Read `../evidence-model.md` first. It defines the source-reference grammar and
the nine fields this stage fills.

## Do not skip ahead

You do not know the story yet. If a candidate headline occurs to you while
reading the diff, ignore it. An extraction pass that already has a thesis finds
its thesis, and that is exactly the failure this pipeline is built to avoid.

## 1. Run the collector

```bash
node skills/blog-post-redactor/engine/bin/blog-post.mjs collect \
  --since v4.3.0 --out blog-posts
```

Pass the scope the human gave: `--pr <n>`, `--since <ref>`, `--range <a>..<b>`,
a quoted free-text scope, or nothing for the current branch against its default
branch. The collector is read-only and refuses any git subcommand that could
write. It produces `blog-posts/evidence.json` and prints the gaps it found.

If the human named a free-text scope, the bundle records that the boundary is
unresolved. Ask once which ref or range they mean. If they do not answer,
continue with the working-branch range and keep the gap recorded.

## 2. Read what the bundle points at

The bundle is an index, not the evidence. Read the material itself:

- the diff for the files that changed most, and for anything under a path the
  commits' subjects emphasize
- pull request and issue bodies, which is where the problem is usually stated
  in the author's own words
- the changelog section covering the range, which is the user-facing effect
- test files in the range, and any recorded output such as counts or timings
- docs whose headings the bundle listed, especially a history or decision record
- screenshots or diagrams present in the diff, by path

Read for the seven things a reader remembers: what was broken, what was tried,
what worked, why this way rather than the obvious way, what went wrong on the
way, what it measurably did, and what it opened up.

## 3. Hunt for the dead ends deliberately

They are the highest-value and most-often-missing evidence, and they never
announce themselves. Look for:

- commits whose subject starts with `revert`, `fixup`, or `amend`
- a file added and then removed inside the range
- a function or module rewritten twice in the same range
- review findings that changed code, in PR comments
- a decision record that names a rejected option

An honest "this did not work, here is why" is worth more to a reader than three
paragraphs of architecture.

## 4. Write `blog-posts/evidence.md`

Use `../templates/evidence.template.md`. Rules:

- Every entry carries at least one source reference in backticks.
- An entry you cannot source is dropped. Not softened, not hedged — dropped.
- Quote the repository's own words when they are better than a paraphrase.
- Keep `Gaps` exactly as the collector reported it, plus anything you looked for
  and could not find. Do not resolve a gap by reasoning.

## 5. Stop

Do not propose angles. Do not draft sentences. The next stage reads this file,
and it should be reading facts, not a pitch.

Report to the human: the scope, the counts, the gaps, and the path to the two
artifacts.
