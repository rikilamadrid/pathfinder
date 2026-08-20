---
name: review-feature
description: Verify implemented work against its Feature and report findings.
---

# Review Feature

Review the actual diff and behavior, not only the developer's summary.

## Check

- acceptance criteria
- regressions and important edge cases
- security/privacy when relevant
- accessibility, performance, compatibility, and operations when relevant
- tests and verification
- scope creep
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
