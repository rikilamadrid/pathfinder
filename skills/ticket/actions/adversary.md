# Ticket: Adversary

Challenge one implemented ticket with bounded reproducible experiments, then stop.

## Assumed role

Unless the human explicitly activated a role, assume `adversary` for this
invocation: read `roles/adversary.md` and follow it. An explicit role overrides
this default. A role narrows responsibility and never grants human authority.
Even under an override, this action grants no repair, verdict or acceptance.

## Process

1. Read `context/current-ticket.md`; resolve the ticket store through
   `skills/ticket/store.md` and read the execution mode as
   `skills/ticket/SKILL.md` §Execution mode says. Read the active ticket and its
   parent Feature from their canonical sources. In a claimed worktree, use the
   main checkout for an absent tracker or Feature source, as `load` defines.
   Do not load or start a ticket as a side effect. If no implemented ticket
   and exact revision are identifiable, report what is missing and stop.
2. In orchestrator mode, run the ownership check from `load` step 7. Continue
   only inside this ticket's existing claimed worktree; never create a claim.
   Identify its PR and query its full current head SHA. Confirm that the
   checked-out implementation and diff correspond to that head. If they do
   not, stop for coordination; do not checkout, pull or modify the branch.
   In human-in-the-loop mode, identify the exact local revision/diff; a PR is
   optional. Disclose dirty changes so reproducibility is not overstated.
3. Read the relevant diff and acceptance criteria. Choose a small set of
   experiments against assumptions, boundaries, integrations, unexpected
   states or old/new behavior when relevant. State the attacked contract and
   hypothesis before running each. Use controlled, reversible experiments
   within existing project authorization. Do not change production code or
   tests; use isolated scratch inputs and existing tools. Do not run a
   destructive or externally consequential experiment without authorization.
4. Run the experiments and collect observations and evidence. Keep raw command
   output distinguishable from interpretation. Report inability to reproduce
   or missing access honestly. An attempted experiment yielding no reproducible
   defect is valid; do not manufacture suspicion to fill the report.
5. Produce the report below. In human-in-the-loop mode, return it directly;
   the PR may be absent and the revision can describe the local diff. No
   checkpoint or Node runtime is required. Human coordination is optional:
   the ticket can proceed directly to review without this action.
6. In orchestrator mode, write the complete report to this claim's transient
   `context/current-ticket.md` as `## Adversary experiments`, with a directly
   attached JSON fence in the shape below. The report-only helper validates
   completeness and evidence grammar and replaces only this section:

   `node skills/orchestrate/engine/experiments.mjs --checkpoint < <scratch-report.json>`

   Keep the scratch report inside the claimed worktree's ignored scratch area.
   Preserve all other claim fields, execution profile and notes. Re-query the
   PR head after experiments; if it changed, disclose that the report is stale
   and stop for coordination. Never present it as current-head evidence.
   Do not change `State`, ticket status or Feature status. A complete report
   must exist before the coordinator can advance to review; scheduling and
   freshness gating belong to orchestration, not this stateless action.
7. Give the human/coordinator the report and its limits, then stop. Suspected
   defects must reach independent Tester through `/ticket review` before any
   Developer repair instruction. Do not dispatch another role yourself.

## Report contract

The orchestrator report has exactly `ticket`, `pr` (full PR URL), `head_sha`
(full 40-character SHA) and `experiments` (1–12 attempted experiments).
Each experiment has exactly these keys:

- `experiment_id` — unique within this report, 1–64 letters/digits/`.`/`_`/`-`,
  starting with a letter or digit; never a finding identifier.
- `contract` — ticket/Feature acceptance criterion or other contract attacked.
- `hypothesis` — how the implementation might violate it.
- `setup` — preconditions and environment needed to reproduce.
- `steps` — ordered reproduction steps.
- `expected_result` — the contract's expected behavior.
- `observed_result` — what actually happened, or why observation was blocked.
- `evidence` — references using `lib/evidence-references.mjs`'s existing
  `type:locator` grammar; file/doc references may include `#Lx-Ly`.
- `reproducibility` — repeated observations, uncertainty and relevant limits.
- `potential_impact` — conditional consequences, without a verdict.
- `verifier_instruction` — what Tester should independently check against the
  contract, including the reproduction and uncertainty.

When `context/execution-mode.md` names an Evidence Judge, each experiment also
has `judge`, the only part of it a judge provider may receive: exactly
`contract_attacked`, `action_summary`, `expected_result` and
`observation_summary`, each written as judge prose — one plain line of at most
280 characters, using only letters, digits, spaces and `. , ; ( ) ' % -` —
never a command, output, path, URL or value. The raw fields above keep their
full evidence locally, `experiment_id` included: the judge names the N-th
experiment `adversary:N`. The helper refuses invalid or missing judge prose,
naming the field to rewrite, and writes nothing;
`skills/orchestrate/evidence-judge.md` has the full rules. Without a judge,
`judge` is optional and nothing changes.

`steps` and `evidence` are arrays of 1–20 non-empty strings; other experiment
fields are non-empty strings. Each string is at most 2048 characters and the
JSON report is at most 32 KiB. Missing fields, malformed evidence, duplicate
identifiers, unknown verdict/finding fields, or verdict declarations make a
report incomplete. The helper checks structure and explicit verdict language;
it does not resolve references, prove experiments or replace Tester judgment.

Use these same fields for the direct human report, adapting only the PR/revision
identity as described above. No PASS/FAIL, confirmed finding, acceptance or
rejection language. Preserve a prior checkpoint until a complete replacement is
ready. Reports remain transient; confirmed regression evidence becomes durable
only through downstream Developer/Tester work.
