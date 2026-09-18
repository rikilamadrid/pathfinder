# Integration repair briefs

`orchestrate brief <key> --harness <harness> --session rebase-and-reverify`
resumes a done worker whose branch fell behind the default branch.

`orchestrate brief <key> --harness <harness> --session resolve-conflict`
returns the conflicting paths and current heads to the same worker for repair.

Both use the claim's existing role, model, effort, branch, worktree, and ticket.
The integrator appends the check evidence and approval scope. The worker reads
its state first, preserves completed work, reruns the ticket's full Verification,
and updates the existing PR. Rewriting and force-pushing need the project's
explicit approval. Unresolvable intent goes to a human gate. A repaired branch
needs independent review and a fresh integration check before any merge.
