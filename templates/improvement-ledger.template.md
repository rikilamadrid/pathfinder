# Improvement Ledger

Observations about how delivery went, and what came of them.

An entry records something that actually happened, with the evidence that shows
it happened. It is not a task, and it carries no authority: nothing here changes
a skill, a role, a template or a contract. A person decides what becomes work,
and the ordinary Feature and ticket path does the work.

## How to read this file

Each entry is one `## <id> — <title>` section. It opens with an identity marker,
`<!-- pathfinder:improvement <id> -->`, which never changes and is the only
thing a later run matches on. Then come `- Field: value` lines, and then one
short paragraph saying what happened.

- **`Status`** is a field line, not the marker, because status changes and
  identity does not. A person moves it; nothing infers it from a closed issue,
  a merged pull request, or the passage of time.
- **`Evidence`** is one or more references in Pathfinder's `type:locator`
  grammar, the same one every other evidence surface uses. An entry with no
  reference that resolves is not recordable.
- **`Occurrences`** is a count and one dated sub-item per occurrence. The
  second time something happens it is an occurrence of the entry that already
  describes it, never a second entry. Recurrence is what turns one annoyance
  into a case for changing something.
- **Entries and occurrences are only ever appended.** A resolution rewrites
  that entry's status lines and touches nothing else in the file.

The engine at `skills/reflect/engine/bin/ledger.mjs` records, resolves,
harvests and validates. It reads no clock, so every date in this file was given
to it by a person. `validate` will name anything malformed by id and line.

A project with no friction worth recording has an empty ledger, and that is a
perfectly good state for this file to be in.
