---
name: review-feature
description: Review an implemented feature against its spec, repository standards, regressions, and project quality priorities.
---

# Review Feature

Review the actual diff and behavior, not only a summary.

## Check

- acceptance criteria and missed requirements
- regressions, logic errors, edge/failure states
- security/privacy and data boundaries
- accessibility, performance, compatibility, and operations when applicable
- tests and verification quality
- scope creep and unrelated churn
- consistency with approved architecture and prototype direction
- documentation accuracy

## Output

List findings by severity with file/location, impact, and practical fix. Then list verification performed, residual risk, and whether it is ready to complete.

Do not modify code unless the user asks for fixes. Do not manufacture findings to fill a template.
