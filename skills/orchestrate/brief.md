# The worker brief

What the orchestrator hands a worker, and how each harness honours it.

```sh
node skills/orchestrate/engine/bin/orchestrate.mjs brief <key> --harness claude-code|manual [--session implementation|review]
```

## Fields

Every brief carries all of these. None is optional, and none is defaulted when
missing: a brief that lacks one is refused.

| Field | Meaning |
| --- | --- |
| `ticket`, `title`, `ref` | the ticket's key, title, and where it lives in the store |
| `session` | `implementation` or `review` |
| `worktree`, `branch` | the claim the worker runs inside |
| `role` | the role contract the session assumes, from the routing policy |
| `model` | the model the session runs on, from the routing policy |
| `effort` | the reasoning effort the session runs at, from the routing policy |
| `approval` | the scope of the human approval the orchestration run was granted |
| `protocol` | the ordered steps: load, start, and how to report a gate, done, or failure |

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
| `claude-code` | a background subagent | `inherited`: no override. A family alias (`opus`, `sonnet`, `haiku`, `fable`): passed as the override. A pinned model ID such as `claude-opus-5`: **refused** | `inherited`: nothing. Anything else: **refused**, because the subagent takes no effort setting |
| `manual` | a session the human starts from the printed brief | passed as written | passed as written |

A new harness is a new row in `HARNESS_TRANSLATIONS` in `engine/brief.mjs`.
