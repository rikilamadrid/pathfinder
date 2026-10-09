# Baseline measurement: where Pathfinder orchestration cost and repetition occur

Read-only measurement pass, 9 October 2026. No Pathfinder code, configuration, tickets, roles, prompts or tests were changed. No log file was modified.

Companion files:

- `evidence/baseline-measurement-2026-10-09.json` — aggregates only (per role, per ticket, per run, archives).
- Scratchpad `baseline/measure.mjs` and `baseline/baseline.json` — the disposable script and the full per-session table, including brief excerpts. Kept out of the repository because it quotes other projects' session text.

## 1. Sources, window, normalization

| Source | Files scanned | Sessions parsed | Notes |
|---|---|---|---|
| Claude Code transcripts (`~/.claude/projects`, `~/.claude-work/projects`, incl. `<session>/subagents/*.jsonl`) | 731 | 689 | per-turn `message.usage`; duplicate stream lines de-duplicated by `message.id` |
| Codex rollouts (`~/.codex/sessions`, `~/.codex/archived_sessions`, `~/.codex-work/sessions`) | 501 | 424 | per-response `token_usage_record`; Codex `input_tokens` includes cached input, so fresh input = input − cached |

Window: sessions starting 15 September to 8 October 2026 inclusive. Sessions from 9 October were excluded because they belong to this audit.

Normalized session schema, identical for both harnesses: `fresh_input`, `cache_read`, `cache_create`, `output`, `calls` (assistant responses), wall-clock minutes, model, reasoning effort (Codex records it; Claude Code transcripts do not), working directory, kind (top-level or subagent).

**Core set** = sessions attributable to Pathfinder work in the three focus projects (pathfinder, MINE, lorebox): **240 sessions**, 145 Claude Code and 95 Codex, 59 top-level and 181 subagents.

Excluded from the core tables but reported:

- **103 Codex "guardian review" threads** (model `codex-auto-review`): 1,308 calls, 97.0M input tokens. These are the harness reviewing each worker's commands, not Pathfinder roles. They add 6.6 percent on top of the core input.
- **93 sessions in six other projects** that also use Pathfinder worktrees (forge, oto, fesd, portfolio-domain, global-educa, atelier): 1,142M input. Not requested for comparison; noted for scale.
- 677 sessions with no Pathfinder signal.

## 2. Attribution and confidence

Attribution order, as requested: (1) `.pathfinder/worktrees/<key>` working directory; (2) ticket identity in the initial brief, including the Codex task name `pathfinder_<a>_<b>_<session>`, "ticket N.N", a `ticket/N.N-` branch, or an issue/PR number; (3) role declaration in the initial prompt. Where no rule matched, the field is `unknown`.

| Field | Source | Sessions | Confidence |
|---|---|---|---|
| ticket | worktree cwd | 95 | high |
| ticket | Codex task name or brief ("ticket N.N", branch) | 91 | high |
| ticket | issue or PR number in brief | 7 | medium |
| ticket | worktree path in command text, known project root only | 2 | medium |
| ticket | unknown | 45 | these are mostly coordinator and human-driven sessions that span many tickets; 21.5 percent of core input |
| role | Codex task name or spawn role | 57 | high |
| role | role declaration in brief | 86 | medium-high |
| role | top-level session running `orchestrate` commands or spawning workers → coordinator | 22 | high |
| role | top-level session issuing `/ticket` actions or Pathfinder skills → human-session | 37 | high as a class, mixed roles inside |
| role | unknown | 38 | 7.9 percent of core input |

Two known limits:

- **Codex undercounts rounds.** Codex reuses one thread per task name across rounds, so a ticket with three adversary rounds shows one adversary session. Round counts below come from the Pathfinder archives, not from session counts.
- **MINE repair forks.** 12 MINE sessions (82.7M input) are Claude Code forks whose prompt is inherited from the parent transcript, so the brief is empty. By timing they sit between adversary and tester passes and look like developer repair sessions. They are left `unknown` rather than guessed.

Observed versus estimated: every number in sections 3 to 9 is observed from logs or archives unless marked *estimate*.

## 3. Totals and token composition (core)

| Metric | Value |
|---|---|
| Sessions | 240 |
| Assistant calls | 10,526 |
| Fresh input tokens | 13.6M (0.9 percent of input) |
| Cache-creation input tokens | 24.3M (1.6 percent) |
| Cache-read input tokens | 1,437.6M (97.4 percent) |
| Output tokens | 6.46M (0.44 percent of input) |

Output is 0.44 percent of input volume. Cache-read input is 97.4 percent. Cost therefore scales with calls × context size, not with what the models write.

## A. Per-role table (core, sessions as attributed)

| Role | Sessions | Calls | Input share | Calls share | Input per call | Output per call | Minutes per session |
|---|---|---|---|---|---|---|---|
| coordinator | 22 | 4,349 | 49.7 % | 41.3 % | 169k | 731 | 864 |
| human-session | 37 | 1,295 | 16.5 % | 12.3 % | 188k | 1,208 | 105 |
| developer | 46 | 1,891 | 14.6 % | 18.0 % | 114k | 417 | 65 |
| tester | 68 | 1,592 | 8.3 % | 15.1 % | 77k | 388 | 37 |
| adversary | 29 | 642 | 3.1 % | 6.1 % | 71k | 104 | 37 |
| planner | 0 | 0 | 0 | 0 | | | |
| unknown | 38 | 757 | 7.9 % | 7.2 % | 153k | 326 | 81 |

Developer + adversary + tester = **26.0 percent of input, 39.2 percent of calls**. Coordinator + human-driven sessions = **66.2 percent of input**.

Phase-distributed view: when human-driven and coordinator sessions are split at each `/ticket <action>` command and the following calls are attributed to that action's role, the shares become developer 20.9, tester 8.7, adversary 5.1 (total 34.7 percent); coordinator unlabelled 31.2, coordinator actions 3.4, human unlabelled 14.2, other skills (handoff, whereami, reflect) 8.6 (total 57.4 percent); unknown 7.9. Either way the three worker roles are a minority of input volume.

## B. Per-ticket table

Top 15 ticket executions by input tokens. "Same-head repeats" counts full-suite runs beyond the first within one commit segment of one session.

| Ticket | Sessions | Roles | Calls | Input | Output | Minutes | Full suite / focused / kit | Commits | Same-head repeats |
|---|---|---|---|---|---|---|---|---|---|
| lorebox:lorebox-ux-pass | 8 | human 4, coord 1, unknown 3 | 845 | 144.2M | 789k | 4,796 | 33 / 0 / 0 | 4 | 30 |
| pathfinder:maintenance-127 | 3 | coord 1, unknown 2 | 917 | 120.7M | 202k | 2,775 | 11 / 8 / 62 | 12 | 7 |
| mine:01.05 | 2 | coord 1, adversary 1 | 601 | 118.8M | 580k | 3,460 | 53 / 9 / 0 | 21 | 34 |
| lorebox:06.1 | 13 | coord 2, dev 5, tester 4, unknown 2 | 980 | 93.3M | 364k | 1,094 | 57 / 0 / 0 | 29 | 42 |
| pathfinder:55.1 | 5 | coord 1, dev 2, tester 1, unknown 1 | 594 | 69.4M | 163k | 2,052 | 13 / 11 / 65 | 8 | 9 |
| pathfinder:54.1 | 3 | coord 2, tester 1 | 283 | 67.8M | 450k | 1,276 | 22 / 15 / 40 | 6 | 17 |
| mine:01.01 | 16 | adversary 5, tester 4, dev 1, unknown 6 | 346 | 53.4M | 32k | 85 | 37 / 3 / 0 | 0 | 23 |
| pathfinder:52.4 | 2 | human 2 | 224 | 46.1M | 164k | 297 | 12 / 2 / 8 | 5 | 10 |
| mine:01.02 | 6 | adv 1, tester 1, dev 1, unknown 3 | 149 | 40.7M | 16k | 30 | 10 / 0 / 0 | 0 | 4 |
| lorebox:01.3 | 3 | coord 1, dev 1, tester 1 | 249 | 38.4M | 135k | 515 | 10 / 0 / 0 | 11 | 6 |
| pathfinder:53.4 | 5 | coord 1, dev 2, tester 1, unknown 1 | 310 | 34.8M | 94k | 1,337 | 17 / 3 / 34 | 4 | 11 |
| lorebox:09.1 | 7 | coord 1, dev 3, tester 1, unknown 2 | 338 | 29.5M | 106k | 5,198 | 1 / 0 / 0 | 0 | 0 |
| pathfinder:feature-56-secret-fixtures | 1 | coord 1 | 198 | 27.1M | 79k | 1,334 | 10 / 2 / 28 | 8 | 8 |
| pathfinder:54.3 | 2 | coord 1, tester 1 | 196 | 25.3M | 83k | 457 | 6 / 0 / 6 | 2 | 3 |
| mine:01.04 | 3 | dev 1, adv 1, tester 1 | 86 | 22.4M | 8k | 18 | 4 / 6 / 0 | 0 | 2 |

Feature 57 (Codex, 7 to 8 October), the only run with complete per-round archives:

| Ticket | Worker sessions | Calls | Input | Full / focused / kit | Commits | Same-head repeats | Archive rounds (adversary / tester) |
|---|---|---|---|---|---|---|---|
| 57.1 | 4 | 86 | 5.2M | 10 / 7 / 4 | 3 | 7 | 2 / 2 |
| 57.2 | 3 | 65 | 4.4M | 6 / 4 / 6 | 2 | 4 | 1 / 1 |
| 57.3 | 4 | 133 | 9.0M | 4 / 23 / 18 | 5 | 3 | 3 / 3 |
| 57.4 | 3 | 110 | 9.6M | 8 / 13 / 16 | 4 | 5 | 2 / 2 |
| 57.5 | 3 | 102 | 7.9M | 8 / 13 / 12 | 4 | 4 | 2 / 2 |
| 57.6 | 3 | 68 | 5.0M | 3 / 5 / 8 | 1 | 1 | 1 / 1 |
| 57.7 | 3 | 132 | 11.1M | 11 / 7 / 8 | 1 | 8 | 1 / 1 |
| 57.8 | 3 | 58 | 4.1M | 4 / 2 / 10 | 2 | 2 | 1 / 1 |
| **workers total** | 26 | 754 | 56.3M | | | | |
| **coordinator thread** | 1 | 883 | 119.5M | | | | 46 h wall, one Codex thread |

The Feature 57 coordinator made more calls than all eight tickets' workers combined and consumed 68 percent of the run's input.

## C. Top cost drivers

1. **Coordinator sessions: 49.7 percent of core input.** 22 sessions, 198 calls each on average, 169k input tokens per call. The long-lived orchestrating session re-reads its growing transcript on every call. Largest single sessions: MINE coordinators 162M across 2 sessions, Feature 57 coordinator 119.5M, maintenance-127 coordinator 119M, Feature 54 coordinators 110M across 4 sessions.
2. **Human-driven sessions: 16.5 percent.** 188k input per call, the highest of any class. These are human-in-the-loop sessions where the main conversation itself runs `/ticket` actions and other skills.
3. **Developer sessions: 14.6 percent**, 114k per call.
4. **Repeated full-suite runs.** Across attributed tickets: 450 full-suite invocations, 179 focused, 434 kit validations, 159 commits. 293 of the 450 full runs (65 percent) were repeats within the same commit segment of the same session. Unattributed sessions add 100 full runs with 67 repeats. Definition: a "full" run is `npm test`, `npm --prefix <pkg> test`, `pnpm test` or `node --test` with no file argument; package-scoped suites count as full.
5. **Harness overhead outside Pathfinder:** Codex guardian threads, 97M input.

Per-project input: pathfinder 747M (coordinator 464M = 62 percent), lorebox 384M (human 132M, coordinator 107M, developer 91M, tester 38M), MINE 344M (coordinator 162M = 47 percent, repair forks 83M, developer 49M, adversary 27.5M, tester 22.3M).

## D. Adversary value rate

**Pathfinder archives (Feature 57 and maintenance-127), manual classification of every experiment's observed result:**

| Measure | Value |
|---|---|
| Adversary reports | 15 distinct (16 files, one duplicate) |
| Experiment runs | 48 |
| Experiments that observed a defect | 9 (19 percent) |
| Confirmed tester findings | 8 (57.1: 1, 57.3: 2, 57.4: 2, 57.5: 1, m127: 2) |
| Confirmed findings that led to a code repair | 8 of 8 |
| Repair rounds | 6 (57.1, 57.3 twice, 57.4, 57.5, m127) |
| Rounds that produced nothing new | 8 of 15 (57.2, 57.3 round 3, 57.4 round 2, 57.5 round 2, 57.6, 57.7, 57.8, m127 round 2) |
| Post-repair rounds that found a further defect | 1 of 6 (57.3 round 2) |

Every defect found was in Pathfinder's own routing, checkpoint or release code.

**MINE (human-in-the-loop, verdicts read from the subagent hand-back messages):**

| Ticket | Adversary passes | Tester passes | Outcome |
|---|---|---|---|
| 01.01 | 5 | 4 | rounds 1 to 3 returned findings (round 2: four critical); round 4 adversary with no tester; final tester: 2 Low only |
| 01.02 | 1 | 1 | PASS with Low notes |
| 01.03 | 1 | 1 | PASS with 3 Low |
| 01.04 | 1 | 1 | PASS, 2 Low |
| 01.05 checkpoint work | 4 | 3 | two passes with Low notes; one tester verification returned FAIL: the bad claim came from ChatGPT, not from MINE, and Feature 01 was declared contract-blocked |
| 01.06 | 2 | 2 | round 1: one robustness defect plus four test gaps; round 2: three test gaps confirmed, no code defect |
| 02.01 + 02.02 | 1 | 1 | verdict not captured in the extracted excerpt |
| 02.04 | 0 | 1 | PASS |

On MINE, 5 of roughly 12 tester rounds found Medium-or-worse issues, all in the first rounds of a ticket or in a checkpoint verification. Post-repair rounds on 01.01 converged over three cycles.

## E. Tester value rate

- **With an adversary present (Pathfinder archives):** 8 of 8 confirmed tester findings trace to an adversary experiment. 6 cite adversary artifacts directly in their evidence; 2 reproduce the adversary's scenario with the tester's own probe. Independent tester findings: 0.
- **With an adversary present (MINE):** tester reports are organized around the adversary's experiment numbering and its rerun's suspected-finding counts. The one independent FAIL was the 01.05 checkpoint verification, which was a tester-only check of a document.
- **Without an adversary (lorebox, 24 September run):** 10 tester sessions, all final PASS, but round-1 findings on 01.2 (two), 01.3 (two wording defects, three rounds), 02.3 and 03.1 were found by the tester alone and fixed before re-review.

Reading: when an adversary runs first, the tester's marginal independent catch rate is near zero and its session is a verification of the adversary's work. When no adversary runs, the tester catches defects on roughly 4 of 10 first reviews. The duplication is structural, not a quality problem with either role.

## F. Repeated-suite count

- Within one session at one head: 293 repeated full-suite runs across attributed tickets, plus 67 in unattributed sessions. Heaviest: lorebox 06.1 (42 repeats of 57 runs, 29 commits), mine 01.05 (34 of 53), lorebox-ux-pass (30 of 33), mine 01.01 (23 of 37, with zero commits because the work was uncommitted).
- Across sessions at one head, by protocol in orchestrator mode: the developer verifies, the adversary runs the suite, the tester runs it again, CI runs it, and `complete` runs final checks after merge. Archive evidence for one head, 57.4 at `8e4717df`: developer, adversary and tester suite logs all present. Feature 57 had 13 distinct reviewed heads, so at least 39 full-suite runs by protocol before CI and post-merge runs.
- The orchestrate suite takes about 234 seconds per run on this repository, so Feature 57's protocol-minimum suite time was roughly 2.5 hours of CPU before CI. *Estimate.*

## G. Actual model and effort distribution

| Harness | Role | Model / effort observed |
|---|---|---|
| Codex | developer | gpt-6-astra/medium 18, gpt-5.6-sol/high 5, gpt-6.1-sol/medium 3, others 2 |
| Codex | adversary | gpt-6-astra/medium 9, gpt-6.1-sol/medium 1 |
| Codex | tester | gpt-6-astra/medium 12, gpt-5.6-sol/high 7, gpt-6.1-sol/medium 2, gpt-6-astra/high 1 |
| Codex | coordinator | gpt-6-astra/medium 3, gpt-6-sol/high 1, gpt-5.6-sol/high 1, mixed 3 |
| Claude Code | developer | opus-5-5 15, opus-5 3; effort not recorded |
| Claude Code | adversary | opus-5-5 19 |
| Claude Code | tester | opus-5-5 31, opus-5 8, fable-5-1 7 |
| Claude Code | coordinator | fable-5-1 6, opus-5-5 5, opus-5 1, mixed 2 |

Within every run, all roles used the same model and effort as the coordinating session: Feature 57 was gpt-6-astra/medium for coordinator, 10 developer, 8 adversary and 8 tester sessions; Feature 55 was gpt-6.1-sol/medium throughout; lorebox 06.1 was gpt-5.6-sol/high throughout; MINE was claude-opus-5-5 throughout. Differences exist only between runs, set by whoever started the session. No role has ever run on a different model or effort from its coordinator. Claude Code transcripts carry no effort field, so Claude effort cannot be verified from logs.

## 4. Rounds: how often tickets repeat

- More than one adversary round: Feature 57: 4 of 8 tickets (57.1, 57.3 with three, 57.4, 57.5); maintenance-127: 2 rounds; MINE: 01.01 (5), 01.06 (2), the 01.05 checkpoint work (4).
- More than one tester round: the same tickets, plus lorebox 01.2, 01.3 (three), 02.2, 02.3, 03.1 and 06.1 (four sessions); Pathfinder 53.1 (four tester sessions), 53.2 and 53.3 (two each).
- Full suite more than once at the same head: see F. It happened in essentially every multi-session ticket.

## 5. Decision rules, applied

**Rule 1: "If developer + adversary + tester exceed 85 percent of input, adaptive routing of minor roles cannot matter."** The condition is false. The three worker roles are 26.0 percent of input by session attribution and 34.7 percent after phase splitting. The majority, 57 to 66 percent, is the coordinating and human-driven sessions. Those sessions are, by construction, the human's own session or a long-lived orchestrator that inherits it, so per-role model routing cannot reach them at all. Routing workers to cheaper models touches at most a third of input volume, and the two roles with recorded catches, adversary and tester, are 11.4 percent of input combined.

**Rule 2: "If output is under 1 percent of input, cheaper output pricing is a weaker lever than reducing calls and context."** Output is 0.44 percent of input and cache-read is 97.4 percent. Token volume is calls × context. The coordinator averages 169k input per call over 198 calls per session; a worker session averages 71k to 114k per call over 22 to 41 calls. The lever is the number and length of coordinator calls and the size of per-call context, not the price of output tokens or the choice of worker model.

## 6. Classification of mechanisms by measured evidence

**Unused** (zero runtime presence in logs; no cost measured beyond prose read by sessions):

- Routing policy alternatives, routing assessment, Evidence Judge. No session invoked them. Their only measured runtime cost is the judge-prose paragraphs read by adversary and tester sessions, which is inside the 1.8M to 4.7M cache-creation totals for those roles and not separable. Nothing here recommends deletion on usage grounds alone.

**Used but low-value** (ran repeatedly, rarely changed an outcome):

- Post-repair adversary rounds: 1 of 6 found a further defect.
- Tester re-running adversary experiments: 0 independent findings in 8, on both Pathfinder and MINE.
- Full-suite re-runs at an unchanged head within one session: 293 repeats.

**High-cost** (where the tokens actually went):

- Coordinator sessions, 49.7 percent; one Feature 57 thread consumed more than all its workers.
- Human-driven sessions at 188k input per call, 16.5 percent.
- Developer sessions, 14.6 percent.
- Codex guardian auto-review, 97M, harness-side.

**Architecturally unnecessary** (cost that comes from how the pieces are arranged rather than from the work):

- The coordinator loop runs in one long model session that handles every worker report, prints every plan and status, and keeps all of it in context for 46 hours. The engine re-derives all state from Git and the store on every call and holds none of its own, so nothing requires the coordinating session to be long-lived.
- Three roles each run the full suite at the same head, then CI runs it, then `complete` runs it again after merge.

## H. Recommended simplification priority, from measured evidence only

1. **Bound the coordinator session.** Highest measured cost, zero engine change, harness-agnostic. See the first change below.
2. **Stop same-head suite repeats inside a session**, by having a role run the suite once per head unless files changed. Measured: 293 repeats. Quality risk: none, the head is unchanged. The cross-role runs (developer, adversary, tester, CI) stay, because they are the independence guarantee the user asked to preserve.
3. **Measure post-repair adversary rounds for one more Feature** before changing them. 1 of 6 found something; the sample is small and the defects were real.
4. **Do not pursue per-role model or effort routing now.** It cannot reach two thirds of the cost and would touch the roles with recorded catches. If it is ever done, it belongs behind the existing harness adapter boundary as a class intent (stronger, default, cheaper; low, medium, high effort) that each adapter translates, never as harness model names in Pathfinder core.
5. **Record effort and model per session in a harness-neutral way** only if routing is ever reconsidered. Today it is derivable from logs for Codex and partially for Claude Code, which was enough for this measurement.

## The first simplification change justified by the data

**End the coordinating session at each round boundary and start the next round in a fresh session that re-reads engine state.** The orchestrate engine is already stateless by design ("every call re-derives its answer from Git, the worktrees, and the store"), and `/orchestrate resume` plus `status` already exist. The change is one operating rule in `skills/orchestrate/actions/start.md` step 5, "a new round starts in a new session", with no engine code touched. It is harness-agnostic, reversible by deleting the sentence, and preserves worker isolation, head-SHA freshness, the adversary phase and independent review untouched.

Expected effect, *estimate*: the coordinator's 169k input per call would fall toward the 71k to 114k per call that fresh worker sessions show, which on Feature 57's 883 coordinator calls is roughly a 35 to 55 percent reduction of the run's largest cost line. Measure it on the next Feature with the same script: coordinator input per call and total coordinator input, before and after.

## Measurement coverage summary

- Window 16 September to 8 October 2026. Claude Code and Codex both covered, including subagent transcripts and the second Codex root at `~/.codex-work`.
- 240 core sessions attributed to pathfinder, MINE and lorebox; 103 harness auto-review threads and 93 sessions in six other Pathfinder-using projects set aside.
- Attribution: 81 percent of sessions carry a ticket from worktree, task name or brief; 19 percent are `unknown`, mostly multi-ticket coordinator and human sessions; role unknown for 38 sessions (7.9 percent of input), including 12 MINE forks with inherited prompts.
- Round counts come from archives because Codex reuses one thread per task across rounds.
- Not measurable from existing logs: Claude Code reasoning effort per session; cost in currency; whether a given full-suite run was CI or local beyond the command text.
