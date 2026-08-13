---
name: complete-feature
description: Close an accepted feature through final verification, records, delivery metadata, and an optional learning handoff.
---

# Complete Feature

1. Confirm review findings are resolved or explicitly accepted.
2. Run final project-appropriate verification.
3. Confirm each acceptance criterion with evidence.
4. Follow the approved commit, PR, merge, changelog, versioning, release, and deployment policy—requesting approval where required. After the merge, verify the merged mainline and clean up the merged branch as that policy requires.
5. Append the durable outcome to `context/history.md` while completing the feature, not afterwards. If the feature was merged without this skill running, still write the entry and record that it was written after the fact.
6. Mark/reset `context/current-feature.md` and identify the next action.
7. Offer or invoke `learn-feature` when learning is enabled.
8. Produce a compact completion summary.

Do not claim completion when checks failed, evidence is missing, or the feature remains unaccepted.
