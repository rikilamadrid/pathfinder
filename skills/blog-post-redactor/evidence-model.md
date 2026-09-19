# The evidence model

The typed record every stage after collection reads. It exists so that "the
article is supported by the repository" is a question with an answer rather
than an impression.

## Source references

One grammar, `type:locator`, written in backticks wherever a claim is made.
Verification parses these and checks each one against the collected bundle.

| Type | Example | Means |
| --- | --- | --- |
| `commit` | `commit:5314c14` | a commit in the collected range |
| `diff` | `diff:skills/ticket/SKILL.md` | a file changed by the work |
| `file` | `file:README.md#L1-L20` | a file in the repository, optionally a line range |
| `pr` | `pr:126` | a pull request read through the host |
| `issue` | `issue:55` | an issue read through the host |
| `changelog` | `changelog:[Unreleased]` | a changelog section |
| `doc` | `doc:context/history.md` | a document read during collection |
| `test` | `test:packages/orchestrate` | a test suite touched by the work |
| `cmd` | `cmd:git log v4.3.0..HEAD` | a command whose output is the evidence |

A short commit sha resolves against the full one. A `file:` reference resolves
against collected docs and changed files alike. Anything else that does not
appear in the bundle is an unsupported claim, and verification says so by name.

## The model

`evidence.md` records these fields, in this order. Every entry carries at least
one source reference, and an entry that cannot is dropped rather than softened.

1. **Problem** — what was wrong or missing before the work. Usually from issues,
   PR bodies, changelog wording, or a commit that states the motivation.
2. **Previous state** — how the system behaved before. Usually the parent side
   of the diff, or a doc paragraph the work replaced.
3. **Changes made** — what now exists that did not. Grouped by area, not by
   commit, because a reader does not care about the order of commits.
4. **Technical decisions** — a choice with an alternative that was rejected.
   A change with no alternative is a change, not a decision; do not inflate it.
5. **Failures and dead ends** — reverts, fixups, abandoned approaches, review
   findings that forced a change. This section is the one most often empty and
   the one most worth having. Look for `revert`, `fixup`, force-pushes, a file
   added and removed inside the range, and review comments that changed code.
6. **Measurable outcomes** — numbers with a source: test counts, benchmark
   output, file counts, timings, page counts. A number nobody measured is not
   an outcome.
7. **Lessons** — what the work revealed that was not obvious when it started.
   Must point at the evidence that revealed it.
8. **Next steps** — stated follow-ups. Only ones written down somewhere:
   a changelog entry, an issue, a "follow-up" line in a doc, a TODO in the diff.
9. **Assets** — screenshots, diagrams, recordings present in the diff, by path.

## Gaps

Collection records what it could not find in `missing`. Those entries are not
noise to be cleared; they are the input to two later decisions.

- They cap `evidenceConfidence`. A bundle with gaps is not `high`.
- They are the most common reason a claim gets `[NEEDS HUMAN CONFIRMATION]`.

Do not resolve a gap by reasoning about what probably happened. Resolve it by
reading more of the repository, or leave it recorded.

## Confidence

| Level | Means |
| --- | --- |
| `high` | no gaps recorded, no open confirmations, commits and at least one of tests, PRs, or changelog |
| `medium` | the work is clear but some supporting evidence is absent |
| `low` | the scope is unresolved, or the bundle is thin enough that the article is mostly inference |

Verification enforces the floor, not the ceiling: it fails `high` when gaps or
confirmations exist, and fails anything above `low` when no commits were
collected. Choosing `medium` over `high` for a bundle that technically qualifies
is a judgment the writer is allowed to make and should explain.
