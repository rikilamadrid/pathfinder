# The worker brief

What the orchestrator hands a worker, and how each harness honours it.

```sh
node skills/orchestrate/engine/bin/orchestrate.mjs brief <key> --harness claude-code|codex|manual --approval <text> [--session implementation|resume|adversary|review|repair|rebase-and-reverify|merge-and-reverify|resolve-conflict] [--model <m> --effort <e> --override "<the human's words>"] [--json]
```

## Output

The text form prints the brief as the worker reads it. With `--json` the output
is `{ brief, translation, routing }`: `brief` carries the fields below,
`translation` is `{ ok, harness, invocation }` exactly as the harness
translation returns it, and `routing` is
`{ selected: { model, effort }, override }` — what the policy selected, and the
human override (`{ model, effort, by }`) or `null`. An orchestrator that needs
the invocation reads it there, and every command it inspects programmatically
asks for `--json`:

| Harness | `translation.invocation` |
| --- | --- |
| `claude-code`, `manual` | `prompt`: the brief text. `model` and `effort`: present only when the brief names an override; `model` is the concrete model a tier maps to |
| `codex` | `tool` and `arguments`: the native call to make, described under Codex invocation contract |

A refusal exits non-zero with its reason on stderr and prints no brief.

`--approval` is required, with non-empty text: it is the scope the human
granted the orchestration run, and the documented procedures pass it on every
invocation. A missing, empty, or whitespace-only value is a usage error (exit
2) that names the flag, prints nothing on stdout, and builds no brief. No
default is ever substituted. The text reaches `brief.approval`, and every
harness invocation, exactly as written.

## Human override

```sh
orchestrate brief <key> --harness <harness> --approval "<scope>" --model <m> --effort <e> --override "<the human's words>" --json
```

A human may replace the policy's model and effort for one brief. `--model` and
`--effort` are accepted only together, and only with `--override` carrying the
human's own words; either one without `--override`, or `--override` without
both, is a usage error (exit 2) that builds nothing. The override replaces the
selection for that brief only — the claim's recorded profile is unchanged — and
is translated like any selection: a tier is mapped, and a value the harness
cannot honour is refused by name. `routing.override` records it as
`{ model, effort, by }`, beside `routing.selected`, the policy's own choice.
The orchestrator never overrides on its own judgment.

## Fields

Every brief carries all of these. None is optional, and none is defaulted when
missing: a brief that lacks one is refused.

| Field | Meaning |
| --- | --- |
| `ticket`, `title`, `ref` | the ticket's key, title, and where it lives in the store |
| `session` | `implementation`, `resume`, `adversary`, `review`, `repair`, `rebase-and-reverify`, `merge-and-reverify`, or `resolve-conflict`: the keys of `PROTOCOLS` in `engine/brief.mjs` |
| `worktree`, `branch` | the claim the worker runs inside; the worktree path is absolute |
| `main` | the main checkout: where untracked project context lives, such as `context/tracker.md` and Feature specs, when the worktree has no copy |
| `role` | the role contract the session assumes, from the routing policy |
| `model` | the model the session runs on, from the routing policy |
| `effort` | the reasoning effort the session runs at, from the routing policy |
| `approval` | the scope of the human approval the orchestration run was granted, exactly as `--approval` gave it. Required; never defaulted |
| `protocol` | the ordered steps for the session. Implementation loads, starts, and reports a gate, done, or failure. Resume reads the worktree's state file first and continues rather than restarting. Review runs `/ticket review`, changes nothing, and reports PASS or findings. Rebase-and-reverify, merge-and-reverify and resolve-conflict are the integration repair sessions `integration-brief.md` states |

`role`, `model`, and `effort` are first-class fields whatever their values.
`inherited` is a value, not an absence. A later routing policy changes what
goes in those three fields, and nothing about how a brief is built, read, or
translated moves.

The implementation selection is the one the claim recorded. Adversary, review,
and repair briefs ask the same policy again from the same recorded estimate, so
a brief never depends on anything the claim did not write down. `brief.model`
keeps a tier (`light`, `standard`, `strong`) as the policy chose it; the
translation, and the prompt it carries, name the concrete model.

## Translation

A harness either honours a brief exactly or refuses it by name. It never
drops a value to `inherited`, and never rewrites one into something nearby.
Both would start a different session from the one the policy chose, and
nothing would say so.

| Harness | Starts the session as | model | effort |
| --- | --- | --- | --- |
| `claude-code` | a background subagent | `inherited`: no override. A family alias (`opus`, `sonnet`, `haiku`, `fable`): passed as the override. A tier: mapped `light=haiku standard=sonnet strong=opus`, or by the project's marker, then passed. A pinned model ID such as `claude-opus-5`: **refused** | `inherited`: nothing. `low`, `medium`, `high`, `xhigh`, `max`: passed exactly as `effort`. Anything else: **refused** |
| `codex` | `collaboration.spawn_agent` with the translated `arguments` | `inherited`: no override. Supported model IDs below: passed exactly as `model`. A tier: **refused** unless the project's marker maps one for `codex` | `inherited` with inherited model: no override. Supported explicit effort: passed exactly as `reasoning_effort`. Explicit model with inherited effort: **refused** |
| `manual` | a session the human starts from the printed brief | passed as written. A tier: **refused** unless the project's marker maps one for `manual` | passed as written |

A tier is resolved before any other check, so a mapped model still meets the
harness's model and effort checks. The map comes from the optional
`<!-- pathfinder:model-tiers <harness> light=<m> standard=<m> strong=<m> -->`
line in `context/execution-mode.md`, which replaces the shipped map for that
harness (`profile.md` §Model tiers). A malformed marker, or one whose models
fail their harness's check, refuses every brief. Nothing is substituted.

A new harness is a new row in `HARNESS_TRANSLATIONS` in `engine/brief.mjs`.

### Codex invocation contract

`brief --harness codex --json` returns `translation.invocation.tool` and
`translation.invocation.arguments`, ready for the orchestrator to invoke through
the native tool. The tool is `collaboration.spawn_agent`; this adapter does not
run a shell command or install a session manager. If the active Codex environment
does not expose that tool, report the unavailable capability before dispatch.

The adapter admits these override values. They are the list-visible models of
the Codex CLI 0.154.0 model catalog, each with the reasoning levels that catalog
says it supports; hidden or retired catalog entries are not admitted:

| Model | Explicit effort |
| --- | --- |
| `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-5.6-luna` | `low`, `medium`, `high`, `xhigh`, `max` |
| `gpt-5.5`, `gpt-5.2` | `low`, `medium`, `high`, `xhigh` |
| `inherited` | `low`, `medium`, `high`, `xhigh` (the set every admitted model supports) |

These are finite adapter input limits, not a routing policy or a model ranking.
Unknown models, efforts, and unsupported combinations are refused. Codex
validates model and effort again at call time and names what it refuses, so a
catalog that has moved on fails loudly rather than dispatching a different
session; a new catalog is a new version of this table and its tests.

An explicit model with `effort: inherited` is refused because an omitted
`reasoning_effort` inherits the parent's effort, and the parent's effort may not
be one the requested model supports. Pathfinder cannot then guarantee the session
runs at the effort the policy meant, so it refuses instead of guessing.

When both values are `inherited`, the invocation sets `fork_turns: "all"` and
omits both overrides. Otherwise it sets `fork_turns: "none"`, since a full-history
fork cannot override model or effort. The initial message always carries the
whole worker brief, including ticket, branch, role, approval, and protocol.
Explicit overrides therefore need no inherited conversation to find their work.

The tool has no working-directory parameter, and its `agent_type` is Codex's own
agent kind, not a Pathfinder role, so it is left unset. The message directs the
worker to read `roles/<role>.md`, set `workdir` to the absolute worktree on **every
shell call**, and use absolute paths inside it for edits. `task_name` is derived
from ticket and session; the tool's returned agent identifier is ephemeral. The
claim's worktree remains the worker identity.

Codex task names use lowercase ASCII letters, digits, and underscores. The
adapter preserves both numeric ticket components exactly (including leading
zeros), separates them with an underscore, and canonicalizes the supported
session name to lowercase with other characters replaced by underscores:
`pathfinder_53_6_rebase_and_reverify`. It accepts only canonical Pathfinder
keys and sessions in `PROTOCOLS`, and refuses any session whose canonical name
would collide with another supported session. Unknown sessions and malformed
keys fail explicitly rather than becoming lossy slugs. Codex CLI 0.154.0
validates the name as non-empty, lowercase letters, digits, and underscores
only, containing no `/`, and not the reserved `root`, and states no length
limit; the `pathfinder_` prefix settles the reserved-name and separator rules,
and the adapter imposes no limit of its own and never truncates. This changes
only the ephemeral task name, never the ticket or claim identity.

A resume can translate a claim first dispatched through Claude Code into a Codex
invocation without rewriting its ticket, branch, worktree, or execution profile.
The old mutating session must have ended before the replacement starts. A
non-inherited model specific to one harness may be refused by another; that is
an explicit incompatibility, never permission to change the persisted profile.
Automatic failover is not part of this adapter.

## Dispatch check

```sh
orchestrate dispatch-check <key> --session <s> --harness <harness> --brief <brief.json> --transcript <subagent.jsonl> [--json]
orchestrate dispatch-check <key> --session <s> --harness <harness> --brief <brief.json> --observed-model <m> --observed-effort <e> --source "<where it was observed>" [--json]
```

What a finished session actually ran on, checked against the brief it was
started from. `--brief` is that session's saved `brief --json` output; its
ticket, session, and harness must be the ones named.

- **Planned** is `brief.model`/`brief.effort`, as the policy (or override) chose.
- **Invoked** is the translation's `model`/`effort` (`arguments.model` and
  `arguments.reasoning_effort` for Codex); an absent value is `inherited`.
- **Observed**, for `claude-code`, comes from the subagent transcript
  (`~/.claude*/projects/*/<session>/subagents/agent-*.jsonl`, verified on
  Claude Code 2.1.304). Primary evidence is every `type: "api-request"`
  entry's `params.model` and `params.output_config.effort` — what was sent to
  the API. A request with no effort is `unrecorded`. Assistant entries'
  `message.model` and `effort` are cross-checked against the request they
  name; any disagreement is a mismatch. Input and cache (read + creation)
  tokens are summed once per assistant message. Output tokens are final only
  for a message with an entry whose `stop_reason` is set: Claude Code writes
  every content-block entry with the streaming-start usage, a small
  placeholder `output_tokens` and `stop_reason: null`. A message without a
  final entry adds its placeholder, and the output is then recorded as a
  lower bound, `out >=<n>` (`tokens.outputLowerBound` in `--json`); it is
  never presented as the session's total. A model response with no
  `message.usage`, or a usage field that is absent or not a non-negative
  integer, leaves that total `unrecorded` (`null` in `--json`): it is never
  counted as zero, and the model/effort comparison is unaffected. The time is
  the span between the first and last timestamps. Other harnesses
  have no parser: declare the observation with `--observed-*` and
  `--source`, which is recorded as `declared <source>`.

The result is `inherited` when both invoked values are `inherited`: what was
observed is recorded and never mismatches. Otherwise each invoked value must
be met by exactly one observed value: a family alias (`haiku`, `sonnet`,
`opus`, `fable`) matches a model ID `claude-<alias>-*`, anything else matches
exactly, and an `unrecorded` or second distinct value is a mismatch. The
check appends one line under `## Dispatches` in the claim's
`context/current-ticket.md`, through the same checkpoint write as every other
section, touching nothing else:

```text
- <session> | <harness> | planned <model>/<effort> | invoked <model>/<effort> | observed <model>/<effort> | match|mismatch|inherited | in <n> out <n>|>=<n> cache <n> | <seconds>s | <source>
```

A mismatch prints the line, names the reasons on stderr, and exits 1. A
transcript that is not evidence — unreadable, a line that is not JSON, no
`api-request` entries, requests with no model response (only harness-written
`<synthetic>` entries, as after an API error), a requested model or effort
containing `|` or a line break, no timestamps — is refused with exit 1 and
records nothing. Every value interpolated into the line (session, harness,
planned, invoked and observed model/effort, source) must be one line without
`|`; a brief value that is not is refused the same way. A transcript whose file name contains `|`,
CR, LF, U+2028 or U+2029 is refused with exit 2 and records nothing: the name
is the line's source, and the record must stay one line. `--json` prints the
record with its `line`.

## Stage and handoff validation

Before postimplementation dispatch use `stage <key> --advance --json` from the
main checkout with an accurate `--live` set. It reads the current PR through
`gh pr view` and the claim's checkpoint; `brief` independently rechecks
Adversary/review/repair dispatch against that current head. Complete matching
experiment or Tester reports cross sessions in the translated protocol, using
the existing transient file as the recovery source. No new durable schema or
execution-profile version is involved. Unknown/absent compatibility markers
are refused; explicit one-time safe-boundary `stage --adopt` is only for actual
pre-adoption claims as `actions/start.md` defines.

Repair advancement records only `pending:<reviewed SHA>`. The Developer must
run `stage --begin-repair` from its owning worktree before edits; the PR and
local checkout must still match the reviewed head. Only `started:<SHA>` permits
partial-repair recovery at later heads. Bare old origins are pending, never an
implicit started exemption. Ordinary reports require matching experiments even
when a complete Tester checkpoint survives; only recorded legacy/integration
review exceptions bypass that prerequisite. Failed sessions preserve their
pending `Failed stage`; stopped-session human guidance uses
`stage --advance --guidance` to restore it through the same checks.
