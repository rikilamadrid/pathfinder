# Ticket: Review

Review the actual diff and behavior, not only the developer's summary.

Read the ticket and its parent Feature spec. The ticket says what this slice had
to do; the Feature says what the work as a whole is for.

## Check

- the ticket's `## Verification`, run rather than assumed
- the ticket's `## Changes`, and whether anything outside them was changed
- the parent Feature's acceptance criteria this ticket was supposed to advance
- regressions and important edge cases
- security/privacy when relevant
- accessibility, performance, compatibility, and operations when relevant
- tests and verification
- scope creep, including work that belongs to another ticket
- documentation accuracy

Use the project's quality priorities and existing standards where relevant.

## Output

Report:

- `PASS`, or findings by severity
- file/location and impact for each finding
- what was actually verified
- anything important that remains unverified

Do not modify the implementation unless the human explicitly asks.

Do not invent findings or treat passing tests as automatic acceptance.

Do not write the ticket's `## Status`, and do not touch the parent Feature's.
Review is workflow activity, not lifecycle state, and a reviewed ticket stays
`In Progress` until it is completed.
