# Reflect: Resolve

Record a decision the human already made. This is bookkeeping, not judgment.

The decision comes from the human — in this conversation, or recorded in the
tracker where a reviewer can read it. There is no other source for one.

## Process

1. Identify the entry by id, and the status the human decided.
2. Check the transition is one the ledger allows:

   `Open → Proposed → Approved → Applied` is the spine. `Rejected` and
   `Deferred` are reachable from `Proposed` and `Approved`. `Deferred → Open`
   brings a shelved observation back when it recurs. `Applied` and `Rejected`
   are terminal: reopening one is a new observation with its own evidence.

3. Gather what the transition requires:
   - `Approved` — `--in`, naming the Feature, ticket or issue that now tracks
     the work. It is written to the entry as `Tracked in`.
   - `Applied` — `--in`, naming the evidence that it landed, usually the merged
     pull request. Written as `Applied in`.
   - `Rejected` or `Deferred` — `--why`, the human's reason in their words, and
     `--on`, the date they decided. A decision without a reason cannot be
     reviewed later.

4. **Before `Applied`, verify the evidence exists and is what it claims.** The
   pull request is merged, the ticket is Complete, the commit is on the branch
   it is supposed to be on. Do not mark `Applied` on a promise, on an open pull
   request, or on an intention to open one. The engine checks the grammar of the
   reference; the substance is checked here.

5. Run the resolution.

   ```bash
   node skills/reflect/engine/bin/ledger.mjs resolve 001 Applied --in pr:126
   node skills/reflect/engine/bin/ledger.mjs resolve 002 Deferred \
     --why "Worth doing, but not before the release" --on 2026-01-20
   ```

6. Show the diff. A resolution rewrites that entry's status lines and nothing
   else in the file.

## Rules

- Only a human moves a status. Never infer one from GitHub, Git, a pull request,
  a ticket, a label or the passage of time, and never from the fact that the
  work looks done.
- The reason recorded for a rejection or a deferral is the human's, not a
  reconstruction of what they probably meant.
- Resolve changes one entry. Entries and occurrences are only ever appended, and
  no other entry's lines move.
- Write nothing but the ledger.
