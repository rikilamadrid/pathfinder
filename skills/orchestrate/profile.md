# Execution profiles

Between eligibility and dispatch the orchestrator runs three steps. The
boundaries between them are where a later routing Feature plugs in.

```text
estimate(ticket, in-flight claims)  →  execution profile
select(profile, routing policy)     →  role, model, effort
dispatch(brief)                     →  worker session
```

```sh
node skills/orchestrate/engine/bin/orchestrate.mjs estimate <key> [--risk low|medium|high --reason <text>]
```

## The schema: `pathfinder.execution-profile/1`

```yaml
schema: pathfinder.execution-profile/1
ticket: "53.4"
estimate:
  complexity:
    value: medium
    source: derived
    reason: "5 bullets under ## Changes"
  context:
    value: small
    source: derived
    reason: "3 paths named under ## Context"
  parallel-safety:
    value: isolated
    source: derived
    reason: "no other ticket is in flight"
  risk:
    value: unassessed
    source: derived
    reason: "no risk rule applies"
selection:
  policy: static
  role: developer
  model: inherited
  effort: inherited
```

The schema is closed. An unknown field, an unknown value, a missing field, or
another schema version is refused. A different shape is `/2`, never an edit to
`/1`.

The profile is orchestration state, not ticket content. `claim` writes it
under `## Execution` in the worker's `context/current-ticket.md`. The ticket
body and the ticket template never carry it.

## How each field is derived

Every derived field is a count over the ticket's own body. The same ticket and
the same board give the same bytes.

| Field | Counts | Thresholds |
| --- | --- | --- |
| `complexity` | top-level list items under `## Changes` (`-`, `*`, `+`, `1.`, `1)`); indented sub-points belong to their item | ≤3 `low`, ≤7 `medium`, else `high` |
| `context` | distinct backticked paths under `## Context` | ≤3 `small`, ≤8 `medium`, else `large` |
| `parallel-safety` | overlap between this ticket's `Relevant area` paths and those of tickets other workers hold | see below |
| `risk` | the two rules below, or an assessment | see below |

**What counts as a path.** A backticked token with a `/` whose first segment
carries no dot unless it is a dot-directory such as `.github`, or a token ending
in a file extension. URLs, versions and keys (`53.2`, `v1.2.3`), and identifiers
such as `pathfinder.execution-profile/1` are not paths. A leading `./` and a
trailing `/` are dropped. Braces expand, so `src/{a,b}.mjs` is two paths. A glob
is cut back to its literal directory, so `packages/*/test/` is `packages`, and
`**/*.md` names nothing. A path with no extension is read as a directory.

**Relevant area** is the backticked paths on the `- Relevant area:` line and on
bullets nested beneath it. Unbackticked text is not read.

**Parallel safety**, against every registered claim other than this ticket's
whose ticket is not Complete:

- `serialize` — it names a file another in-flight ticket also names
- `shared-surface` — it names a directory containing, contained by, or equal to
  a path another in-flight ticket names
- `isolated` — no overlap, nothing in flight, or no `Relevant area` declared,
  and the reason says which

**Risk** is derived by exactly two rules. `low` applies to complexity `low` with
context `small` and `isolated`. `high` applies to complexity `high` with context
`large`. Anything else is `unassessed`, and the engine does not guess a middle.

The orchestrator may instead assess risk as `low`, `medium`, or `high` with
`--risk` and a non-empty `--reason`. The profile marks that value `assessed`
and keeps the reason. No other field can be assessed.

The thresholds are coarse on purpose. They give a routing policy a stable,
inspectable input. `static` ignores them; `adaptive` reads them through the
level rule below.

## Routing policies

A policy is one module in `engine/policies/` exporting a synchronous
`select(estimate, { session })`, where `session` is `implementation`,
`adversary`, `review`, or `repair`. The registry finds policies by file name. A helper a policy imports
is named with a leading underscore, and neither it nor a `*.test.mjs` file is
listed as a policy. A policy receives a deep-frozen copy of the estimate, so a
write to it is refused and cannot alter what the profile records. No scheduler, claim,
status, or brief code names a policy, and a test proves it by adding one.

A project names its policy on an optional second marker line in
`context/execution-mode.md`:

`<!-- pathfinder:routing-policy <name> -->`

No marker means `static`. A name this engine does not ship refuses the claim
and lists the shipped names.

The claim records the implementation selection. `brief` asks the recorded
policy again, from the recorded estimate, for an adversary, review, or repair
session, and `plan` shows all four before anything is claimed.

### `static`

The default:

| Session | role | model | effort |
| --- | --- | --- | --- |
| implementation | `developer` | `inherited` | `inherited` |
| adversary | `adversary` | `inherited` | `inherited` |
| review | `tester` | `inherited` | `inherited` |
| repair | `developer` | `inherited` | `inherited` |

`inherited` means whatever the session that dispatches the worker already
runs on.

### `adaptive`

A level comes from the estimate: **2** if risk is `high` or complexity is
`high`; **0** if complexity is `low`, context is `small`, and risk is `low`;
otherwise **1**. So `unassessed` risk is never level 0, and complexity `high`
is level 2 whatever risk was assessed. Each cell is model tier / effort:

| level | implementation | adversary | review | repair |
| --- | --- | --- | --- | --- |
| 0 | light/low | standard/low | standard/medium | standard/medium |
| 1 | standard/medium | standard/high | standard/high | strong/high |
| 2 | strong/high | strong/high | strong/high | strong/xhigh |

Roles are the `static` ones. Repair is one step above implementation, because
confirmed findings are evidence the first allocation was insufficient, and no
adversary, review, or repair cell sits below its implementation cell. The
table is the whole policy: `engine/policies/adaptive.mjs`.

Under any policy other than `static` the orchestrator claims with `--risk` and
a `--reason` (`actions/start.md` §3), because an unassessed risk only ever
raises the level to 1.

### Model tiers

A policy may select model `light`, `standard`, or `strong` instead of a
vendor name. The profile records the tier, so one claim stays harness-neutral
and can be resumed on another harness. The harness translation maps the tier
to a concrete model (`brief.md` §Translation): `claude-code` ships
`light=haiku standard=sonnet strong=opus`; `codex` and `manual` ship none.

A project may set or replace one harness's map with one optional marker line
per harness in `context/execution-mode.md`:

`<!-- pathfinder:model-tiers <harness> light=<m> standard=<m> strong=<m> -->`

All three tiers, each once, and nothing else. Each mapped model must still
pass that harness's model check, and the harness must be one the engine
translates for. A malformed marker, a second marker for the same harness, or
a map that fails either check refuses every brief until it is fixed. A tier
with no map is refused by name. Nothing is substituted. Pathfinder does not
rank Codex models.

### What the registry guards

The registry refuses any selection naming a role with no `roles/<role>.md`, or
a model or effort that is not a lower-case name. Model and effort come from
the policy alone. The orchestrator may assess risk, but it never picks a model.
