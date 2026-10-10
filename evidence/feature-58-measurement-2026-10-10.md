# Post-Feature measurement: Feature 58 under the round-bounded coordinator

Read-only measurement pass, 10 October 2026, after Feature 58 (tickets 58.1–58.4, PRs #182–#185) was fully integrated. Same script and normalization as `evidence/baseline-measurement-2026-10-09.md`, with the window moved to 9–10 October 2026 inclusive. No Pathfinder code, configuration, tickets, roles, prompts, tests or telemetry were changed or added for it.

Companion: the baseline document and its JSON aggregates. The per-session table for this window stays in the measuring session's scratchpad because it quotes session text from other projects.

## 1. Window and attribution

| Source | Files scanned | Sessions parsed |
|---|---|---|
| Claude Code transcripts | 106 | 100 |
| Codex rollouts | 503 | 9 |

Core pathfinder sessions in the window: 31. Of those, 20 belong to the Feature 58 run (attribution by worktree cwd, worker brief, or `orchestrate.mjs` commands naming a 58.x key). The other 11 are the 9 October over-engineering audit that produced the baseline (1 top-level, 5 read-only subagents), a bounded three-reviewer verification of the PR #177 docs change (3 subagents), one FESD reconciliation subagent, and one unrelated Codex thread (SH-001, a different project started from this directory). They are excluded below.

Every Feature 58 session ran on Claude Code, model `claude-fable-5-1`, effort not recorded by the transcript. The baseline's only complete per-round run, Feature 57, ran on Codex (`gpt-6-astra`, medium). The comparison therefore crosses harness and model as well as procedure.

## 2. Feature 58 run, observed

Coordinator sessions, in order:

| Session | What it did | Calls | Cache read | Input per call | Output | Wall minutes |
|---|---|---|---|---|---|---|
| 9 Oct 16:28 | PR #177 wrap-up and Feature 58 planning (64 calls before any orchestrate command), then `start` round 1: 58.1–58.3 dispatched, Adversary and Tester for each | 100 | 18.1M | 184k | 125k | 157 |
| 9 Oct 19:14 | fresh session, integration round for 58.1–58.3, including two CHANGELOG `resolve-conflict` cycles and their fresh Tester reviews | 74 | 8.2M | 113k | 49k | 953 (spanned overnight) |
| 10 Oct 11:11 | fresh session, `start` round 2: 58.4 dispatched, Adversary and Tester | 22 | 1.5M | 72k | 19k | 26 |
| 10 Oct 13:24 | fresh session, `integrate 58.4`, completion, this measurement (in progress when measured) | 32 | 2.5M | 83k | 17k | 6 |
| **Coordinator total** | | **228** | **30.3M** | **136k** | **210k** | 1,142 |

Worker sessions (all subagents of the coordinator sessions):

| Role | Sessions | Calls | Cache read | Input per call | Output per call |
|---|---|---|---|---|---|
| developer | 4 (3 implementation + 1 for 58.4) | 92 | 6.2M | 73k | 53 |
| developer, `resolve-conflict` (58.2, 58.3) | 2 | 38 | 2.1M | 65k | — |
| adversary | 4 | 72 | 4.9M | 75k | 31 |
| tester | 6 (4 ordinary + 2 fresh after conflict resolution) | 86 | 5.8M | 70k | — |
| **Workers total** | **16** | **288** | **19.1M** | **72k** | **46** |

Run total: 20 sessions, 516 calls, 49.4M cache-read tokens, 2.2M cache-creation tokens, 14k fresh input, 224k output. Coordinator share of run input: 60 percent.

Verification outcomes: 4 Adversary reports, none observing a defect against its contract (7 experiments on 58.4; the round-1 reports left with their released worktrees and their counts were not retained); 6 Tester reports, all PASS with 0 findings; 0 repair rounds; 0 human gates; 0 stale claims. Same-head full-suite repeats inside one session: 4 across the run (baseline: 293 across the window).

## 3. Comparison with the baseline

The baseline's prediction (§The first simplification change): coordinator input per call "would fall toward the 71k to 114k per call that fresh worker sessions show", roughly 35 to 55 percent off the run's largest cost line.

| Measure | Feature 57 (baseline, Codex, 8 tickets) | Feature 58 (Claude Code, 4 tickets) | Change |
|---|---|---|---|
| Coordinator sessions | 1, 46 h wall | 4 | |
| Coordinator calls | 883 | 228 | |
| Coordinator cache-read input | 117.9M | 30.3M | |
| Coordinator input per call, whole run | 134k | 136k | +1 percent, **no change** |
| Coordinator input per call, sessions started fresh from engine state | — | 72k, 83k, 113k (mean 95k) | −29 percent vs 134k; inside the predicted 71k–114k band |
| Coordinator input per call, session that carried prior context | — | 184k | +37 percent |
| Coordinator input per ticket | 14.7M | 7.6M | −48 percent, *confounded* |
| Coordinator calls per ticket | 110 | 57 | −48 percent, *confounded* |
| Coordinator share of run input | 68 percent | 60 percent | −8 points |
| Worker input per call | 72k | 72k | unchanged |
| Worker input per ticket | 6.8M | 4.8M | −30 percent, *confounded* |
| Adversary experiments that observed a defect | 9 of 48 | 0 (4 reports, 7 experiments on 58.4 alone) | |
| Tester findings | 8 (all tracing to Adversary experiments) | 0 | |
| Repair rounds | 6 | 0 | |

What is observed and what is estimated:

- **Observed:** the three coordinator sessions that started fresh from engine state and the handoff ran at 72k–113k input per call, the band the baseline predicted. The one session that did not start fresh (it carried the PR #177 wrap-up and the Feature's planning before its first `orchestrate` command) ran at 184k, above the Feature 57 average. The round boundary did what it was meant to do exactly where it was applied, and the whole-run average hides that because the carried-context session holds 44 percent of the coordinator calls.
- **Observed:** the per-ticket drop in coordinator input (−48 percent) lands inside the predicted 35–55 percent band, but it is not attributable to the round boundary alone. Feature 58's tickets were small (squash diffs of 8, 58, 68 and 141 lines: wording in `plan.mjs` and `comments.mjs`, one flag check with its documentation, and one guard in `brief`), there were no repair rounds, and the harness and model changed. Feature 57 had 6 repair rounds across 8 larger tickets.
- **Observed:** the round boundary's own overhead is small. The four coordinator sessions wrote 0.68M cache-creation tokens in total (1.3 percent of run input); each fresh session's re-orientation (handoff read, `status`, `board`, `check`) is its first dozen or so calls (*estimate* from this session's own transcript).
- **Observed:** the CHANGELOG conflicts cost 4 extra worker sessions (2 `resolve-conflict`, 2 fresh Tester), 69 calls and 4.5M input, which is 9 percent of the run's input and 24 percent of worker calls, plus two extra human approvals and most of the integration session's 953-minute wall time. This overhead is procedural: three tickets appended at the same spot in `[Unreleased]`.
- **Estimate, list price only:** at Claude Fable 5.1 first-party API rates (input $10, cache read $0.25, cache write $12.50 at 5-minute TTL or $20 at 1-hour TTL, output $50 per million tokens) the coordinator sessions cost $27–32, the workers $25–37, the run $52–68; the four conflict-driven sessions $5–7. These are not observed spend: the sessions ran under a Claude Code subscription whose billing is not visible in transcripts, and Codex pricing for Feature 57 is not in any available record, so no currency comparison between the two runs exists.
- **Not measurable here:** reasoning effort per session (Claude Code does not record it); whether Feature 58's zero findings reflect the tickets' simplicity or the verification roles' value. With 16 experiments and 6 reviews that all passed on wording-level changes, this run says nothing new about the baseline's §D and §E conclusions.

Confidence: **low to moderate**. One run, four small tickets, a different harness and model from the comparison run, and no repair rounds. The per-call band for fresh sessions is the one result with a clean mechanism behind it; the per-ticket totals are consistent with the prediction but cannot isolate its cause.

## 4. Conclusions

1. **Round-bounded orchestration should remain.** Where a coordinator session genuinely started fresh, its context per call was 29 to 46 percent below the Feature 57 average, at a re-orientation cost of about 1 percent of run input and no observed loss of freshness, isolation or review. The procedure's one failure in this run was not cost but state: the round-2 `start` session did not rewrite `context/handoff.md`, so the next session found a handoff that said round 2 had not begun while the engine showed it done. The engine was right, as designed, but the rule "a new round starts in a new session" relies on each session leaving a current handoff. That is a one-sentence fix in the `start` round-boundary step, not a new mechanism.
2. **The next highest-value simplification candidate, from this run's data, is the CHANGELOG `[Unreleased]` conflict cycle.** It was pure procedure cost with no quality content: 4 of the run's 20 sessions, 9 percent of input, two extra human approvals and an integration round that spanned a night, all because concurrent tickets append at one line. The baseline's second candidate, same-head suite repeats, showed only 4 repeats here against 293 in the baseline window, so its measured value has dropped. The bigger but quality-sensitive line remains Tester sessions after an Adversary pass (6 sessions, 86 calls, 0 findings here; 0 independent findings in the baseline), which the baseline already declined to touch because the cross-role runs are the independence guarantee.
