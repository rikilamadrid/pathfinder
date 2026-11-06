# Execution Environment

Where an orchestrated worker executes. Pathfinder works fully without Docker
or `sbx`: a project that never chooses an environment runs `local`, exactly as
it always has.

## Three separate choices

They are recorded apart, read apart, and never inferred from one another.

| Choice | Values | Where it lives |
| --- | --- | --- |
| Execution mode | `human-in-the-loop`, `orchestrator` | `<!-- pathfinder:execution-mode ... -->` in `context/execution-mode.md` |
| Execution environment | `local`, `sandbox` | `<!-- pathfinder:execution-environment ... -->` in the same file |
| Coding tool (harness) | `claude-code`, `codex`, `manual` | chosen per dispatch (`--harness`) |

- `local` — the default, and what no line means. A worker runs on this host
  under the coding tool's own permissions.
- `sandbox` — a local Docker Sandboxes microVM driven by the standalone `sbx`
  CLI. Docker Desktop is not needed, and a working `docker` command proves
  nothing about it.

Any other value is invalid: readiness reports it as `unsupported`, and
dispatch refuses it. A marker quoted inside a longer line is not one, and the
first marker line decides.

In `human-in-the-loop` mode Pathfinder launches no session, so the line
applies only to orchestrated dispatch. It never makes a human-started session
sandboxed.

## Selecting

```sh
npx create-pathfinder --environment sandbox   # or local
```

The installer writes the line, and keeps an existing one, whatever its value,
across re-runs and mode changes until `--environment` changes it. It asks
nothing without the flag. Editing the line by hand works the same way.

A sandbox also needs its permission mode chosen by hand, and may carry a
subscription declaration (both below):

```text
<!-- pathfinder:execution-environment sandbox -->
<!-- pathfinder:sandbox-permission-mode acceptEdits -->
<!-- pathfinder:sandbox-agent-auth subscription -->
```

The installer never writes those two lines, and keeps them when it re-renders
the file.

Moving from `sandbox` to `local` is always the human's edit. Pathfinder never
makes it, and never falls back to local on its own.

## Readiness

```sh
node skills/orchestrate/engine/bin/orchestrate.mjs environment [--harness <h>] [--json]
```

Read-only. It reports the selected environment, the harness (default
`claude-code`), the platform, the detected runtime and its version, each
check's status and its remediation. It exits `0` when ready and `1`
otherwise. It never creates a workspace, sandbox, secret or policy, never
starts the `sbx` daemon, and never launches an agent.

`local` probes nothing: no Docker, no `sbx`, no PATH lookup. It is `ready`.

`sandbox` runs these checks in order and stops the chain at the first that is
not ready. The permission mode, a recorded choice, is checked whatever the
host. The overall status is the first blocking check that is not ready.

| Check | Not ready when | Status | Remediation |
| --- | --- | --- | --- |
| harness | not `claude-code` | `unsupported` | use `--harness claude-code`, or select `local` |
| platform | not macOS 14+ on Apple silicon | `unsupported` | run on a supported host, or select `local` |
| sbx | not at `PATHFINDER_SBX` (an absolute path) or on `PATH` | `missing` | `brew trust docker/tap && brew install docker/tap/sbx` |
| version | `sbx --no-input version --json` fails, or reads below 0.48.0 | `not-ready` | upgrade `sbx` |
| daemon | `sbx --no-input daemon status --json` fails or does not report running | `not-ready` | `sbx daemon start` |
| docker-login | `sbx --no-input ls --json` says not authenticated | `authentication-required` | `sbx login` |
| agent-auth | no agent credential is visible or declared — see below | `authentication-required` | the subscription route, then the API-key route |
| permission-mode | no `sandbox-permission-mode` line, or an unknown value | `not-ready` | choose one explicitly |

Two statuses never block: `declared` (a human declaration no read-only check
can confirm) and `info` (host access, reported only). Both are listed under
**Warnings**, and the report still exits `0` when nothing else blocks.

The probes after `daemon status` run only once it reports the daemon running,
so readiness cannot start it. Every `sbx` call carries `--no-input`, so a
prompt fails rather than waits. No `sbx` output is ever echoed: the version is
the one value read from it.

### Agent authentication

Checked after Docker sign-in, from one `sbx --no-input secret ls --json`.
`sbx` prints secrets partially masked (Docker's example:
`gho_GCaw4o****...****43qy`), and a masked value is still part of a secret, so
only each entry's `service`, `scope` and hosts are read. No value, and none of
any `secret` command's raw output, is printed, logged, stored, or put in an
error or in `--json`.

In order:

1. A stored `anthropic` service secret — ready, method `api-key`. It is billed
   per token to the Anthropic API account, separately from any Claude
   subscription, and readiness says so.
2. A custom secret whose hosts include `api.anthropic.com` — ready, method
   `custom-secret`. Custom secrets (`sbx secret set-custom`) are experimental
   in `sbx`, and this route is unverified with Claude Code.
3. `<!-- pathfinder:sandbox-agent-auth subscription -->` in
   `context/execution-mode.md` — `declared`, shown as a warning. A Claude
   subscription is OAuth: `/login` inside Claude Code in a sandbox, with the
   token held host-side by `sbx` and never entering the sandbox. No read-only
   check can see it, so the human declares it. A launch that fails
   authentication stops with the claim preserved.
4. Otherwise `authentication-required`. The remediation lists the
   subscription route first — sign in once with `/login` in an interactive
   `sbx run claude <empty directory>` session, then declare it with the line
   above — and then the API-key route, `sbx secret set anthropic`, with its
   separate billing.

Not documented by Docker, and so unverified: whether a `/login` made in one
sandbox serves a new sandbox, and any query for OAuth sign-in state.

The check is one replaceable function (`checkAgentAuthentication` in
`engine/environment.mjs`, passed to `checkReadiness` as `agentAuth`), because
how an agent signs in is the part of this contract most likely to change.

### Permission mode

`<!-- pathfinder:sandbox-permission-mode bypassPermissions|acceptEdits -->`
records the Claude Code `--permission-mode` the sandboxed agent runs under.
It is an explicit execution property: under `sandbox` there is no default,
and a missing line is `not-ready` ("choose the in-sandbox permission mode
explicitly"). Any other value is invalid. Readiness reports the requested
mode; verifying the mode a launched agent actually ran under belongs to the
launch.

### Host access every sandbox inherits

Reported as informational warnings, queried only once the daemon runs, and
never changed by Pathfinder — they are machine-wide settings, and changing
them is the human's choice:

- SSH agent forwarding, `sbx --no-input settings get ssh.agentForwardingEnabled --json`
  (default on): sandboxed processes can ask the host SSH agent to sign,
  including for Git authentication. To turn it off:
  `sbx settings set ssh.agentForwardingEnabled false && sbx daemon restart`.
- The host browser, `browser.enabled` (default on): a sandbox can open URLs in
  the host browser.
- Global secrets every sandbox inherits, by service name only (for example
  `github`), from the same secret listing.

A setting that cannot be read is reported as `unknown`, stated rather than
hidden. The network policy preset (`allow-all`, `balanced`, `deny-all`) is
global to the machine too; readiness lists it and never changes it.

### Support matrix

| Harness × host | Status |
| --- | --- |
| `claude-code` on macOS 14+, Apple silicon | supported |
| `codex`, `manual` inside a sandbox | `unsupported` until verified |
| Windows 11 x64 (Windows Hypervisor Platform), Ubuntu 24.04+ (KVM) | documented by Docker, not verified by Pathfinder: `unsupported` |
| Intel Macs, macOS 13 and older, anything else | `unsupported` |

## No silent fallback

While the line says `sandbox`, or names an invalid value:

- `brief` refuses every harness translation that would start a session on this
  host — a Claude Code subagent, a Codex subagent, a session the human starts
  from the printed brief. The refusal names the environment, the readiness
  command, and that switching to local means editing the line.
- `plan` adds the environment and its readiness status, and says local
  dispatch is refused.

With `local`, or no line, `brief` and `plan` print exactly what they did
before the environment existed.

Launching a worker inside a sandbox is not part of this module; until a
sandbox launch path exists, a project that selects `sandbox` dispatches no
workers at all, which is the intended, visible outcome.
