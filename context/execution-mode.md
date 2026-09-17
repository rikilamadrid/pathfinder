# Execution Mode

<!-- pathfinder:execution-mode orchestrator -->

Pathfinder runs this project in **orchestrator** mode: an orchestrator
coordinates several dependency-safe ticket workers at once, each in its own
Git worktree on its own branch, and surfaces only the human gates that need
a person. Approval, acceptance, merge, and release stay the human's.

The marker line above is the value Pathfinder reads; the rest of this file is
for people. The two valid values are `human-in-the-loop` and `orchestrator`.
A file with any other value, or none, is invalid: the ticket lifecycle says so
once and proceeds human-in-the-loop, and orchestration refuses to run.

To change mode, run `npx create-pathfinder --mode <value>` again, or edit the
marker line by hand. Nothing else needs to change.

In orchestrator mode an optional second line,
`<!-- pathfinder:routing-policy <name> -->`, names the routing policy that
chooses each worker's role, model, and effort. Without it the policy is
`static`.
