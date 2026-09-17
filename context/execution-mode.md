# Execution Mode

<!-- pathfinder:execution-mode human-in-the-loop -->

Pathfinder runs this project **human-in-the-loop**: one active ticket at a
time, one session, and the human drives every transition and answers every
gate. This is the default, and what a project with no file at all runs.

The marker line above is the value Pathfinder reads; the rest of this file is
for people. The two valid values are `human-in-the-loop` and `orchestrator`.
A file with any other value, or none, is invalid: the ticket lifecycle says so
once and proceeds human-in-the-loop, and orchestration refuses to run.

To change mode, run `npx create-pathfinder --mode <value>` again, or edit the
marker line by hand. Nothing else needs to change.
