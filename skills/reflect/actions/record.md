# Reflect: Record

Write one observation to the ledger, or one occurrence of an entry that already
describes it.

The human names the observation. This action turns it into an entry with
evidence, shows it, and writes it once they confirm.

## Process

1. Take the observation from the human. If they named none, ask what they saw.
   Do not go looking for something to record.
2. Gather the evidence from the repository and the tracker — a pull request, an
   issue or its comment, a CI run, a commit, a file and line range, a test, a
   command you ran and its output. Never from recollection. Each reference is
   written in the `type:locator` grammar: `commit:`, `diff:`, `file:`, `pr:`,
   `issue:`, `changelog:`, `doc:`, `test:`, `cmd:`.
3. Classify the entry against the closed vocabularies. An unknown value is
   refused by the engine, by field name:
   - `Source` — where it was seen: `planning`, `implementation`, `review`,
     `completion`, `orchestration`, `integration`, `release`, `debugging`,
     `session`.
   - `Scope` — `project` or `workflow`, the same distinction step 3 of the
     reflection draws.
   - `Category` — `unexpected-intervention`, `wrong-assumption`,
     `missing-contract`, `workflow-friction`, `manual-recovery`,
     `insufficient-guidance`, `workaround`.
   - `Human intervention` — `none`, `decision`, `correction`, `recovery`.
   - `Impact` — `low`, `medium`, `high`.
4. Run `harvest` and look for an entry this repeats. If one describes the same
   thing, this is an occurrence of it, not a second entry: say so by id and
   record it as an occurrence. The second time something happens is the whole
   point of the count.

   An occurrence carries only the date and its own evidence — the entry already
   holds the classification, and the engine refuses the two forms mixed:

   ```bash
   node skills/reflect/engine/bin/ledger.mjs record \
     --observed 2026-01-22 --evidence pr:53 --repeats 001
   ```
5. Show the entry you would write — every field, every reference, the note, and
   the `--repeats` id if there is one.
6. Write it only after the human confirms, or immediately if their request
   already said to record without confirming. Recording is never silent: the
   entry appears in this session's output and in the diff of a tracked file.

```bash
node skills/reflect/engine/bin/ledger.mjs record \
  --observed 2026-01-15 \
  --source review --scope workflow --category workflow-friction \
  --intervention correction --impact medium \
  --title "A short line naming what happened" \
  --evidence pr:41 --evidence 'cmd:npm test' \
  --candidate "The smallest change that would have prevented it" \
  --note "One short paragraph: what happened, and what it cost."
```

That is the full form, for a new observation. The engine creates
`context/improvement-ledger.md` from
`templates/improvement-ledger.template.md` on the first record, assigns the id,
and appends. Ids are sequential and are never reused.

## Refuse an unverifiable record

An entry with no reference that resolves is not recordable. Refuse it, and say
what would make it recordable: which pull request, which issue, which commit,
which command a reviewer could rerun. A ledger of unevidenced claims is the
failure the ledger exists to prevent.

The engine validates the grammar of a reference. Whether the reference is true —
that the PR is the one that shows this, that the command still prints that — is
checked here, in the session, before writing.

## Rules

- Record on the human's word, not because you noticed something.
- Record meaningful workflow or product learning. Routine successful work
  produces no entry, and neither does every deferred finding or passing remark.
- One entry per observation. Repetition is `Occurrences`, never a second entry.
- `Status` starts at `Open`. This action moves no status; `resolve` does.
- Write nothing but the ledger. No skill, role, template, context file or
  contract changes because an entry was recorded.
