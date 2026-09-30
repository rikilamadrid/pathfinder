# Integration repair briefs

`orchestrate brief <key> --harness <harness> --session rebase-and-reverify`
resumes a done worker whose branch fell behind the default branch when the
repository permits rewriting and the required approval exists.

`orchestrate brief <key> --harness <harness> --session merge-and-reverify`
merges the synchronized default-branch head into the existing ticket branch and
pushes normally, preserving published ancestry. Use it when rewriting published
history or force-pushing is prohibited and ticket-branch merges are allowed.
Missing, ambiguous or contradictory policy opens a gate before mutation.

`orchestrate brief <key> --harness <harness> --session resolve-conflict`
returns the conflicting paths and current heads to the same worker for repair.

All use the claim's existing role, model, effort, branch, worktree, and ticket.
The integrator appends the check evidence and approval scope. The worker reads
its state first, preserves completed work, reruns the ticket's full Verification,
and updates the existing PR. Rewriting and force-pushing need the project's
explicit approval. Unresolvable intent goes to a human gate. Checkpoint the selected session, exact target SHA and remaining work in the
existing Next field before updating; recovery inspects Git progress and resumes
that same strategy without repeating a completed update. After either refresh,
pending update, verification or push resumes Developer; future review mentioned
in Next does not authorise Tester dispatch. Only State: review with verification
and push explicitly complete at the exact current PR head permits Tester.
Full ticket verification, fresh independent Tester PASS and current-head CI are
required before a fresh integration check. The final PR merge remains a separate
human gate. Merging the base into a ticket branch does not authorise merging the
ticket into the default branch.
