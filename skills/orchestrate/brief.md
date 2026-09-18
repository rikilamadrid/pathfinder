# The worker brief

What the orchestrator hands a worker, and how each harness honours it.

```sh
node skills/orchestrate/engine/bin/orchestrate.mjs brief <key> --harness claude-code|codex|manual [--session implementation|resume|review|rebase-and-reverify|resolve-conflict] [--approval <text>] [--json]
```

## Output

The text form prints the brief as the worker reads it. With `--json` the output
is `{ brief, translation }`: `brief` carries the fields below, and `translation`
is `{ ok, harness, invocation }` exactly as the harness translation returns it.
An orchestrator that needs the invocation reads it there, and every command it
inspects programmatically asks for `--json`:

| Harness | `translation.invocation` |
| --- | --- |
| `claude-code`, `manual` | `prompt`: the brief text. `model` and `effort`: present only when the brief names an override |
| `codex` | `tool` and `arguments`: the native call to make, described under Codex invocation contract |

A refusal exits non-zero with its reason on stderr and prints no brief.

## Fields

Every brief carries all of these. None is optional, and none is defaulted when
missing: a brief that lacks one is refused.

| Field | Meaning |
| --- | --- |
| `ticket`, `title`, `ref` | the ticket's key, title, and where it lives in the store |
| `session` | `implementation`, `resume`, `review`, `rebase-and-reverify`, or `resolve-conflict`: the keys of `PROTOCOLS` in `engine/brief.mjs` |
| `worktree`, `branch` | the claim the worker runs inside; the worktree path is absolute |
| `main` | the main checkout: where untracked project context lives, such as `context/tracker.md` and Feature specs, when the worktree has no copy |
| `role` | the role contract the session assumes, from the routing policy |
| `model` | the model the session runs on, from the routing policy |
| `effort` | the reasoning effort the session runs at, from the routing policy |
| `approval` | the scope of the human approval the orchestration run was granted |
| `protocol` | the ordered steps for the session. Implementation loads, starts, and reports a gate, done, or failure. Resume reads the worktree's state file first and continues rather than restarting. Review runs `/ticket review`, changes nothing, and reports PASS or findings. Rebase-and-reverify and resolve-conflict are the integration repair sessions `integration-brief.md` states |

`role`, `model`, and `effort` are first-class fields whatever their values.
`inherited` is a value, not an absence. A later routing policy changes what
goes in those three fields, and nothing about how a brief is built, read, or
translated moves.

The implementation selection is the one the claim recorded. A review brief
asks the same policy again from the same recorded estimate, so a brief never
depends on anything the claim did not write down.

## Translation

A harness either honours a brief exactly or refuses it by name. It never
drops a value to `inherited`, and never rewrites one into something nearby.
Both would start a different session from the one the policy chose, and
nothing would say so.

| Harness | Starts the session as | model | effort |
| --- | --- | --- | --- |
| `claude-code` | a background subagent | `inherited`: no override. A family alias (`opus`, `sonnet`, `haiku`, `fable`): passed as the override. A pinned model ID such as `claude-opus-5`: **refused** | `inherited`: nothing. Anything else: **refused**, because the subagent call takes no effort setting. A subagent definition file can set one, and that would be a new translation row |
| `codex` | `collaboration.spawn_agent` with the translated `arguments` | `inherited`: no override. Supported model IDs below: passed exactly as `model` | `inherited` with inherited model: no override. Supported explicit effort: passed exactly as `reasoning_effort`. Explicit model with inherited effort: **refused** |
| `manual` | a session the human starts from the printed brief | passed as written | passed as written |

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
