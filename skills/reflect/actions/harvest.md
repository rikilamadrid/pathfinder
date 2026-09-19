# Reflect: Harvest

Read what the ledger says, and turn repetition into proposals a human can
decide.

## Process

1. Run the harvest. It reads; it changes nothing.

   ```bash
   node skills/reflect/engine/bin/ledger.mjs harvest
   ```

   The report arrives in sections: open entries most repeated first, repeated
   signals, entries deferred that happened again since, entries awaiting a
   decision, approved entries and where their work is tracked, and counts by
   category, source and status. An empty ledger reports that it is empty, which
   is a true and useful answer.

2. Apply steps 3 to 7 of the reflection to the report, in this order: repeated
   entries first, then high-impact single entries. Most entries warrant no
   proposal. Say so rather than manufacturing one.

3. Write each proposal in the step 6 format — Observation, Evidence,
   Generalization, Current gap, Proposed change, Risk, Validation. Cite the
   ledger ids and their occurrence counts under Evidence, and state which
   coverage step of step 5 the proposal lands on: already covered, clarify
   documentation, improve an existing skill, strengthen an invariant, or a new
   skill. Prefer the earliest step that would work.

4. Present the proposals for decision. **No proposal** is a valid and expected
   result, and a ledger whose entries are all single observations is telling you
   something true.

5. Record what the human decides, and only what they decide:
   - `Proposed` — they want the entry kept as a live proposal without deciding
     yet.
   - `Rejected` or `Deferred` — with their reason, in their words, and the date
     they gave it.
   - `Approved` — once a Feature, ticket or issue exists for the work, named in
     `--in`. Not before. `Approved` is a claim that the work is tracked
     somewhere, and an untracked approval is the claim being false.

   Each is written with `resolve`; see `skills/reflect/actions/resolve.md`.

6. Name the next action for an approved proposal — `to-specs`, or `to-tickets`
   on an existing Feature — and stop. Do not run it. Planning belongs to the
   planner, and roles never call one another.

## Rules

- Harvest reads. It resolves nothing, promotes nothing, merges nothing,
  deduplicates nothing and creates no work.
- Cite ids for every claim about repetition. "This keeps happening" without an
  id is recollection, which is what the ledger replaced.
- Do not infer a decision. A closed issue is not an approval and a merged pull
  request is not an application; a person says those words or they are not true.
- Do not propose a change to a skill, role, template or contract by making it.
  A proposal is text until a human-approved ticket does the work.
