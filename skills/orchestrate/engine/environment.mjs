/**
 * Execution environment readiness — read-only.
 *
 * A project selects where orchestrated workers execute on one optional line
 * of `context/execution-mode.md` (`readExecutionEnvironment` in `mode.mjs`):
 * `local`, the default, or `sandbox`, a local Docker Sandboxes microVM driven
 * by the standalone `sbx` CLI. This module answers one question — is the
 * selected environment ready for this harness on this host, and if not, what
 * exactly does the human do about it — and changes nothing to answer it. It
 * never creates a workspace, sandbox, secret or policy, never starts the
 * `sbx` daemon, and never launches an agent.
 *
 * `local` probes nothing at all: no runner call, no PATH lookup.
 *
 * `sandbox` runs its probes in order and stops the chain at the first that
 * is not ready; the first blocking check that is not ready is the overall
 * status. The probes that would need a running daemon run only after
 * `daemon status` reports it running, so readiness can never start it
 * implicitly. Every `sbx` call is prefixed `--no-input`, so a prompt fails
 * instead of waiting. No runner output is ever echoed: the version is the one
 * value read out of it, and secret listings are reduced to service, scope and
 * hosts before anything else sees them — `sbx` prints partially masked secret
 * values, and a masked value is still part of a secret.
 *
 * Host access every sandbox inherits (SSH agent forwarding, the host browser,
 * global secrets) and the global network policy are reported as
 * informational warnings. They are machine-wide; Pathfinder never changes
 * them.
 *
 * The runner is injected — `run(argv, options?) → {status, signal, stdout,
 * stderr, error}`, `argv[0]` the executable — per Feature 64's shared
 * contract; the default spawns with no shell and a timeout.
 */

import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

import {
  DEFAULT_EXECUTION_ENVIRONMENT,
  EXECUTION_ENVIRONMENTS,
  EXECUTION_MODE_PATH,
  SANDBOX_PERMISSION_MODES,
  readExecutionEnvironment,
  readSandboxSettings,
} from "./mode.mjs";

/** The statuses a readiness check, and the whole report, can carry. */
export const READINESS_STATUSES = Object.freeze(["ready", "missing", "unsupported", "not-ready", "authentication-required"]);

/**
 * `declared` is the one non-blocking status a check can carry beside them: a
 * human declaration no read-only check can confirm, shown as a warning.
 * Informational checks carry `info` and never affect the overall status.
 */
export const DECLARED = "declared";

/** The oldest `sbx` with the structured (`--json`) interfaces readiness reads. */
export const SBX_MIN_VERSION = "0.48.0";

/** The one harness verified inside a sandbox. */
export const SANDBOX_HARNESSES = Object.freeze(["claude-code"]);

/** The oldest macOS Docker Sandboxes supports locally, and its Darwin kernel. */
const MIN_MACOS = 14;
const MIN_DARWIN = 23;

export const SBX_INSTALL = "brew trust docker/tap && brew install docker/tap/sbx";

/** Docker documents these hosts too; Pathfinder has not verified them. */
const OTHER_HOSTS =
  "Docker also documents Windows 11 x64 with Windows Hypervisor Platform and Ubuntu 24.04+ (x64/arm64) with KVM; Pathfinder has not verified them, so they are unsupported here";

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_OUTPUT = 1024 * 1024;

/** The default runner: no shell, a timeout, bounded output. */
export function defaultRun(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    shell: false,
    encoding: "utf8",
    timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

function isExecutableFile(path) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where `sbx` is: `PATHFINDER_SBX` when set (it must be an absolute path),
 * else the first executable `sbx` on `PATH`.
 *
 * @returns {{ok: true, path: string, source: string} | {ok: false, detail: string}}
 */
export function resolveSbx(env = {}) {
  const override = env.PATHFINDER_SBX;
  if (typeof override === "string" && override !== "") {
    if (!isAbsolute(override)) return { ok: false, detail: "PATHFINDER_SBX is set but is not an absolute path" };
    return isExecutableFile(override)
      ? { ok: true, path: override, source: "PATHFINDER_SBX" }
      : { ok: false, detail: "PATHFINDER_SBX names no executable file" };
  }
  for (const dir of String(env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, "sbx");
    if (isExecutableFile(candidate)) return { ok: true, path: candidate, source: "PATH" };
  }
  return { ok: false, detail: "sbx is not on PATH, and PATHFINDER_SBX is not set" };
}

/** The macOS major version a Darwin kernel release belongs to, or null. */
export function macosMajor(osRelease) {
  const darwin = Number.parseInt(String(osRelease ?? ""), 10);
  if (!Number.isInteger(darwin)) return null;
  if (darwin >= 25) return darwin + 1; // Darwin 25 is macOS 26
  if (darwin >= 20) return darwin - 9; // Darwin 20 is macOS 11
  return null;
}

function platformCheck({ platform, arch, osRelease, productVersion }) {
  const name = "platform";
  const unsupported = (detail) => ({
    name,
    status: "unsupported",
    detail,
    remediation: `Run sandboxed workers on macOS ${MIN_MACOS}+ on Apple silicon, or select local. ${OTHER_HOSTS}.`,
  });
  if (platform !== "darwin") return unsupported(`${platform} ${arch} is not a supported sandbox host`);
  if (arch !== "arm64") return unsupported(`macOS on ${arch} is not a supported sandbox host; Docker Sandboxes needs Apple silicon`);
  let major = null;
  if (productVersion) major = Number.parseInt(String(productVersion), 10);
  else major = macosMajor(osRelease);
  const known = Number.isInteger(major);
  const darwin = Number.parseInt(String(osRelease ?? ""), 10);
  const recent = known ? major >= MIN_MACOS : Number.isInteger(darwin) && darwin >= MIN_DARWIN;
  if (!recent) {
    return unsupported(`macOS ${known ? major : `of unknown version (Darwin ${osRelease ?? "?"})`} is older than macOS ${MIN_MACOS}`);
  }
  return { name, status: "ready", detail: `macOS ${major} on Apple silicon` };
}

/** `[major, minor, patch, prerelease]` from a version string, or null. */
function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.exec(String(text ?? "").trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Boolean(match[4])] : null;
}

/** Is `version` at least `minimum`? A pre-release sorts below its release. */
export function versionAtLeast(version, minimum) {
  const a = parseVersion(version);
  const b = parseVersion(minimum);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return !a[3] || b[3];
}

/**
 * The first value under a `version` key, searched depth first. The shape of
 * `sbx version --json` is not documented, so readiness relies on nothing but
 * a key named version holding a semantic version.
 */
function findVersion(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  const entries = Array.isArray(value) ? value.map((item) => [null, item]) : Object.entries(value);
  for (const [key, item] of entries) {
    if (key !== null && /^version$/i.test(key) && typeof item === "string" && parseVersion(item)) return item.trim().replace(/^v/, "");
  }
  for (const [, item] of entries) {
    const found = findVersion(item, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Whether `sbx daemon status --json` says the daemon runs: a `running: true`,
 * or a `status`/`state` of `running`. Anything else, including a shape this
 * reading does not know, is not proof it runs.
 */
function daemonRunning(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== "object") return false;
  const entries = Array.isArray(value) ? value.map((item) => [null, item]) : Object.entries(value);
  for (const [key, item] of entries) {
    if (key === null) continue;
    if (/^running$/i.test(key) && item === true) return true;
    if (/^(status|state)$/i.test(key) && typeof item === "string" && item.trim().toLowerCase() === "running") return true;
  }
  return entries.some(([, item]) => daemonRunning(item, depth + 1));
}

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(String(text ?? "")) };
  } catch {
    return { ok: false };
  }
}


const NOT_AUTHENTICATED = /not authenticated/i;

function exited(result) {
  if (result.error) return `could not be run (${result.error.code ?? "error"})`;
  if (result.signal) return `was stopped by ${result.signal}`;
  return `exited ${result.status}`;
}

export const ANTHROPIC_API_HOST = "api.anthropic.com";

/** The subscription route: sign in once, then declare it. Listed first. */
export const SUBSCRIPTION_ROUTE =
  "Claude subscription: sign in once with /login in an interactive `sbx run claude <empty directory>` session, " +
  "then declare it with `<!-- pathfinder:sandbox-agent-auth subscription -->` in context/execution-mode.md " +
  "(whether that sign-in serves a new sandbox is not documented, so it is unverified)";

/** The API-key route, with what it costs. */
export const API_KEY_ROUTE =
  "Anthropic API key: sbx secret set anthropic (billed per token to the Anthropic API account, separately from any Claude subscription)";

const hostsOf = (entry) => {
  const raw = entry.hosts ?? entry.host ?? [];
  return (Array.isArray(raw) ? raw : [raw]).filter((host) => typeof host === "string");
};

/**
 * `sbx secret ls --json`, reduced to the fields readiness may look at:
 * `service`, `scope` and hosts. `sbx` prints secrets partially masked — a
 * masked value is still part of the secret — so nothing else of an entry, and
 * none of the command's raw output, ever leaves this function: not in a
 * detail, not in an error, not in `--json`.
 *
 * @returns {{ok: true, entries: {service: string|null, scope: string|null, hosts: string[]}[]}
 *         | {ok: false, authentication: boolean, detail: string}}
 */
export function listSecrets(sbx) {
  const result = sbx("secret", "ls", "--json");
  if (result.status !== 0) {
    return {
      ok: false,
      authentication: NOT_AUTHENTICATED.test(`${result.stdout}\n${result.stderr}`),
      detail: `\`sbx secret ls --json\` ${exited(result)}`,
    };
  }
  const parsed = parseJson(result.stdout);
  if (!parsed.ok || !Array.isArray(parsed.value)) {
    return { ok: false, authentication: false, detail: "`sbx secret ls --json` reported nothing Pathfinder can read" };
  }
  return {
    ok: true,
    entries: parsed.value
      .filter((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => ({
        service: typeof entry.service === "string" ? entry.service : null,
        scope: typeof entry.scope === "string" ? entry.scope : null,
        hosts: hostsOf(entry),
      })),
  };
}

/**
 * Whether the agent inside the sandbox can authenticate — one replaceable
 * check, because how an agent signs in is the part of this contract most
 * likely to change. `checkReadiness` takes it as `agentAuth`; a replacement
 * receives `{secrets, declared, harness}` — `secrets` the sanitized listing
 * from `listSecrets`, `declared` the `sandbox-agent-auth` marker reading —
 * and returns one check `{name, status, detail, method?, remediation?}`.
 *
 * In order:
 *  1. an `anthropic` service secret → ready, method `api-key`;
 *  2. a custom secret whose hosts include api.anthropic.com → ready, method
 *     `custom-secret`, experimental and unverified with Claude Code;
 *  3. a declared subscription → `declared`: non-blocking, shown as a warning,
 *     because subscription OAuth held by sbx is visible to no read-only check;
 *  4. otherwise `authentication-required`, subscription route first.
 */
export function checkAgentAuthentication({ secrets, declared }) {
  const name = "agent-auth";
  if (!secrets.ok) {
    return secrets.authentication
      ? { name, status: "authentication-required", detail: "sbx is not signed in to Docker", remediation: "sbx login" }
      : { name, status: "not-ready", detail: secrets.detail, remediation: "Run `sbx secret ls` to see the error" };
  }
  if (secrets.entries.some((entry) => entry.service === "anthropic")) {
    return {
      name,
      status: "ready",
      method: "api-key",
      detail: "an anthropic API key is stored in sbx; billed per token to the Anthropic API account, separately from any Claude subscription",
    };
  }
  if (secrets.entries.some((entry) => entry.hosts.some((host) => host.toLowerCase() === ANTHROPIC_API_HOST))) {
    return {
      name,
      status: "ready",
      method: "custom-secret",
      detail: `a custom secret is injected for ${ANTHROPIC_API_HOST}; custom secrets are experimental in sbx and unverified with Claude Code`,
    };
  }
  if (declared?.valid && declared.value === "subscription") {
    return {
      name,
      status: "declared",
      method: "subscription",
      detail:
        "declared: subscription OAuth held by sbx is not visible to read-only checks; a launch that fails authentication stops with the claim preserved",
    };
  }
  return {
    name,
    status: "authentication-required",
    detail: `no agent credential is visible: no anthropic secret, no custom secret for ${ANTHROPIC_API_HOST}, and no declared subscription`,
    remediation: `${SUBSCRIPTION_ROUTE}. Or: ${API_KEY_ROUTE}`,
  };
}

function permissionCheck(reading) {
  const name = "permission-mode";
  const supported = SANDBOX_PERMISSION_MODES.join(" or ");
  const line = (mode) => `<!-- pathfinder:sandbox-permission-mode ${mode} -->`;
  if (!reading?.explicit) {
    return {
      name,
      status: "not-ready",
      detail: "choose the in-sandbox permission mode explicitly; there is no default",
      remediation: `Add ${line(`<${SANDBOX_PERMISSION_MODES.join("|")}>`)} to ${EXECUTION_MODE_PATH}`,
    };
  }
  if (!reading.valid) {
    return {
      name,
      status: "not-ready",
      detail: reading.mode === null ? `${EXECUTION_MODE_PATH} could not be read` : `\`${reading.mode}\` is not a supported permission mode`,
      remediation: `Set the line to ${supported}: ${line("<mode>")}`,
    };
  }
  return { name, status: "ready", detail: `requested ${reading.mode} (Claude Code --permission-mode); the observed mode is verified at launch` };
}

/**
 * A boolean `sbx settings get <key> --json` answer, or null when it cannot be
 * read. The shape is not documented: a bare boolean, a "true"/"false" string,
 * or a `value` (or the key itself) inside an object or a one-element array.
 */
function readBooleanSetting(stdout, key) {
  const parsed = parseJson(stdout);
  if (!parsed.ok) return null;
  const read = (value, depth = 0) => {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "false") return value === "true";
    if (depth > 3 || value === null || typeof value !== "object") return null;
    if (Array.isArray(value)) return value.length === 1 ? read(value[0], depth + 1) : null;
    for (const name of ["value", key]) if (Object.hasOwn(value, name)) return read(value[name], depth + 1);
    return null;
  };
  return read(parsed.value);
}

/**
 * Host access every sandbox inherits from machine-wide `sbx` settings.
 * Informational: Pathfinder reports them and never changes them.
 */
function hostAccessChecks(sbx, secrets) {
  const checks = [];
  const setting = (key, label, on, off, change) => {
    const result = sbx("settings", "get", key, "--json");
    const value = result.status === 0 ? readBooleanSetting(result.stdout, key) : null;
    checks.push({
      name: label,
      status: "info",
      informational: true,
      value: value === null ? "unknown" : value ? "on" : "off",
      detail:
        value === null
          ? `unknown: \`sbx settings get ${key}\` could not be read (default on: ${on})`
          : value
            ? `on: ${on}. Machine-wide; Pathfinder never changes it. To turn it off: ${change}`
            : `off: ${off}`,
    });
  };
  setting(
    "ssh.agentForwardingEnabled",
    "ssh-agent-forwarding",
    "sandboxed processes can ask the host SSH agent to sign, including for Git authentication",
    "sandboxed processes cannot use the host SSH agent",
    "sbx settings set ssh.agentForwardingEnabled false && sbx daemon restart",
  );
  setting(
    "browser.enabled",
    "host-browser",
    "a sandbox can open URLs in the host browser",
    "a sandbox cannot open the host browser",
    "sbx settings set browser.enabled false && sbx daemon restart",
  );
  if (secrets === null || !secrets.ok) {
    checks.push({ name: "global-secrets", status: "info", informational: true, value: "unknown", detail: "unknown: the secret listing could not be read" });
  } else {
    const names = [...new Set(secrets.entries.filter((entry) => entry.scope === null || entry.scope === "global").map((entry) => entry.service ?? "custom"))].sort();
    checks.push({
      name: "global-secrets",
      status: "info",
      informational: true,
      value: names,
      detail: names.length === 0 ? "none: no secret is inherited by every sandbox" : `every sandbox inherits: ${names.join(", ")} (service names only)`,
    });
  }
  return checks;
}

/** Statuses that never stop a dispatch: a declaration is shown, as a warning. */
const NON_BLOCKING = new Set(["ready", "declared"]);

/**
 * Check one environment's readiness for one harness on this host.
 *
 * `sandbox` runs its probes in order and stops the chain at the first that is
 * not ready. The permission mode, a recorded choice, is always checked. The
 * overall status is the first blocking check that is not ready; `declared`
 * and informational checks never block, and are returned as `warnings`.
 *
 * @param {{environment?: string|null, harness?: string, platform?: string, arch?: string,
 *          osRelease?: string, productVersion?: string, env?: object, run?: Function,
 *          permissionMode?: {mode: string|null, explicit: boolean, valid: boolean},
 *          declaredAgentAuth?: {value: string|null, explicit: boolean, valid: boolean},
 *          agentAuth?: Function}} input
 */
export function checkReadiness({
  environment = DEFAULT_EXECUTION_ENVIRONMENT,
  harness = "claude-code",
  platform = process.platform,
  arch = process.arch,
  osRelease = null,
  productVersion = null,
  env = {},
  run = defaultRun,
  permissionMode = null,
  declaredAgentAuth = null,
  agentAuth = checkAgentAuthentication,
} = {}) {
  const host = {
    os: platform,
    arch,
    release: osRelease ?? null,
    macos: platform === "darwin" ? (productVersion ? Number.parseInt(String(productVersion), 10) : macosMajor(osRelease)) : null,
  };
  const checks = [];
  const extra = [];
  const report = (runtime) => {
    const all = [...checks, ...extra];
    const failing = all.find((check) => !check.informational && !NON_BLOCKING.has(check.status));
    return {
      environment,
      harness,
      permissionMode: environment === "sandbox" ? permissionMode?.mode ?? null : null,
      platform: host,
      runtime,
      status: failing ? failing.status : "ready",
      checks: all,
      warnings: all.filter((check) => check.status === "declared" || (check.informational && check.value !== undefined && check.value !== "off" && !(Array.isArray(check.value) && check.value.length === 0))).map((check) => `${check.name}: ${check.detail}`),
      remediation: failing?.remediation ?? null,
    };
  };

  if (environment === "local") {
    checks.push({ name: "environment", status: "ready", detail: "local: workers run under the coding tool's own permissions; nothing to probe" });
    return report(null);
  }

  if (!EXECUTION_ENVIRONMENTS.includes(environment)) {
    checks.push({
      name: "environment",
      status: "unsupported",
      detail: environment === null ? `${EXECUTION_MODE_PATH} could not be read` : `\`${environment}\` is not an execution environment`,
      remediation: `Fix the line in ${EXECUTION_MODE_PATH} to \`<!-- pathfinder:execution-environment local|sandbox -->\`; the valid values are ${EXECUTION_ENVIRONMENTS.join(" and ")}.`,
    });
    return report(null);
  }

  // sandbox: the permission mode is a recorded choice, checked whatever the host.
  extra.push(permissionCheck(permissionMode));

  if (!SANDBOX_HARNESSES.includes(harness)) {
    checks.push({
      name: "harness",
      status: "unsupported",
      detail: `${harness} has not been verified inside a sandbox; only ${SANDBOX_HARNESSES.join(", ")} is supported`,
      remediation: `Use --harness ${SANDBOX_HARNESSES[0]}, or select local to run ${harness} workers on this host.`,
    });
    return report(null);
  }
  checks.push({ name: "harness", status: "ready", detail: `${harness} is supported inside a sandbox` });

  const hostCheck = platformCheck({ platform, arch, osRelease, productVersion });
  checks.push(hostCheck);
  if (hostCheck.status !== "ready") return report(null);

  const found = resolveSbx(env);
  if (!found.ok) {
    checks.push({ name: "sbx", status: "missing", detail: found.detail, remediation: SBX_INSTALL });
    return report({ name: "sbx", path: null, version: null });
  }
  const runtime = { name: "sbx", path: found.path, version: null };
  checks.push({ name: "sbx", status: "ready", detail: `found through ${found.source}` });

  const sbx = (...args) => run([found.path, "--no-input", ...args], { env });

  const upgrade = `Upgrade sbx to ${SBX_MIN_VERSION} or later: brew upgrade docker/tap/sbx`;
  const version = sbx("version", "--json");
  if (version.status !== 0) {
    checks.push({ name: "version", status: "not-ready", detail: `\`sbx version --json\` ${exited(version)}`, remediation: upgrade });
    return report(runtime);
  }
  const parsed = parseJson(version.stdout);
  const value = parsed.ok ? findVersion(parsed.value) : null;
  if (!value) {
    checks.push({ name: "version", status: "not-ready", detail: "`sbx version --json` reported no version Pathfinder can read", remediation: upgrade });
    return report(runtime);
  }
  runtime.version = value;
  if (!versionAtLeast(value, SBX_MIN_VERSION)) {
    checks.push({ name: "version", status: "not-ready", detail: `sbx ${value} is older than ${SBX_MIN_VERSION}`, remediation: upgrade });
    return report(runtime);
  }
  checks.push({ name: "version", status: "ready", detail: `sbx ${value}` });

  // Nothing below runs unless the daemon already runs: readiness never starts it.
  const daemon = sbx("daemon", "status", "--json");
  const daemonParsed = daemon.status === 0 ? parseJson(daemon.stdout) : { ok: false };
  if (daemon.status !== 0 || !daemonParsed.ok || !daemonRunning(daemonParsed.value)) {
    checks.push({
      name: "daemon",
      status: "not-ready",
      detail: daemon.status !== 0 ? `\`sbx daemon status --json\` ${exited(daemon)}` : "the sbx daemon is not reported running",
      remediation: "sbx daemon start",
    });
    return report(runtime);
  }
  checks.push({ name: "daemon", status: "ready", detail: "running" });

  let secrets = null;
  const ls = sbx("ls", "--json");
  if (ls.status !== 0) {
    const auth = NOT_AUTHENTICATED.test(`${ls.stdout}\n${ls.stderr}`);
    checks.push(
      auth
        ? { name: "docker-login", status: "authentication-required", detail: "sbx is not signed in to Docker", remediation: "sbx login" }
        : { name: "docker-login", status: "not-ready", detail: `\`sbx ls --json\` ${exited(ls)}`, remediation: "Run `sbx ls` to see the error" },
    );
  } else {
    checks.push({ name: "docker-login", status: "ready", detail: "signed in" });
    secrets = listSecrets(sbx);
    checks.push(agentAuth({ secrets, declared: declaredAgentAuth, harness }));
  }

  extra.push(...hostAccessChecks(sbx, secrets));
  const policy = sbx("policy", "ls", "--json");
  const policyList = policy.status === 0 ? parseJson(policy.stdout) : { ok: false };
  extra.push({
    name: "network-policy",
    status: "info",
    informational: true,
    detail:
      (policyList.ok && Array.isArray(policyList.value)
        ? `${policyList.value.length} polic${policyList.value.length === 1 ? "y" : "ies"} listed`
        : "unknown: the policy list could not be read") + "; the network preset is global to this machine and Pathfinder never changes it",
  });
  return report(runtime);
}

/**
 * The project's selected environment, checked: its markers, and readiness.
 */
export function projectReadiness(root, options = {}) {
  const settings = readSandboxSettings(root);
  const readiness = checkReadiness({
    ...options,
    environment: settings.environment.environment,
    permissionMode: settings.permissionMode,
    declaredAgentAuth: settings.agentAuth,
  });
  return { selected: settings.environment, readiness };
}

/**
 * Refuse a local dispatch when the project selects anything but `local`.
 *
 * Every harness translation `brief` knows — a Claude Code subagent, a Codex
 * subagent, a session the human starts — starts a session on this host. Under
 * `sandbox` that would be the silent local fallback the selection exists to
 * prevent, so it is refused, and moving to local is the human's edit of the
 * marker. An invalid marker refuses too. Returns null when local dispatch is
 * the project's choice.
 */
export function localDispatchRefusal(root, harness) {
  const selected = readExecutionEnvironment(root);
  if (selected.valid && selected.environment === "local") return null;
  if (!selected.valid) {
    return (
      `${EXECUTION_MODE_PATH} names ${selected.environment === null ? "an unreadable" : `an invalid (\`${selected.environment}\`)`} execution environment, ` +
      `so no worker is dispatched. The valid values are ${EXECUTION_ENVIRONMENTS.join(" and ")}; ` +
      "fix the `<!-- pathfinder:execution-environment ... -->` line, then check it with `orchestrate environment`."
    );
  }
  return (
    `this project selects the \`${selected.environment}\` execution environment (${EXECUTION_MODE_PATH}), ` +
    `and the ${harness} translation would start a local session on this host instead. Refusing rather than falling back to local. ` +
    "Check sandbox readiness with `orchestrate environment`. " +
    "To run workers locally instead, the human edits that line to `<!-- pathfinder:execution-environment local -->`."
  );
}

/** The readiness report as a person reads it. */
export function formatReadiness({ selected, readiness, mode = null }) {
  const lines = [];
  const source = selected.explicit ? EXECUTION_MODE_PATH : `default; no line in ${EXECUTION_MODE_PATH}`;
  const host = readiness.platform;
  const platform = `${host.os} ${host.arch}${host.macos ? `, macOS ${host.macos}` : ""}${host.release ? ` (kernel ${host.release})` : ""}`;
  const runtime = !readiness.runtime
    ? readiness.environment === "local" ? "none needed" : "not probed"
    : readiness.runtime.path === null
      ? "sbx not found"
      : `sbx ${readiness.runtime.version ?? "(version unknown)"} at ${readiness.runtime.path}`;

  lines.push(`${readiness.environment ?? "(unreadable)"} … ${readiness.status}`, "");
  lines.push(`  environment      ${readiness.environment ?? "(unreadable)"} (${source})`);
  lines.push(`  harness          ${readiness.harness}`);
  if (readiness.environment === "sandbox") lines.push(`  permission mode  ${readiness.permissionMode ?? "(not chosen)"}`);
  lines.push(`  platform         ${platform}`);
  lines.push(`  runtime          ${runtime}`);
  lines.push(`  status           ${readiness.status}`);
  lines.push("", "Checks:");
  const width = Math.max(...readiness.checks.map((check) => check.status.length));
  for (const check of readiness.checks) {
    lines.push(`  ${check.status.padEnd(width)}  ${check.name}: ${check.detail}`);
    if (!NON_BLOCKING.has(check.status) && check.remediation) lines.push(`  ${" ".repeat(width)}  → ${check.remediation}`);
  }
  if (readiness.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of readiness.warnings) lines.push(`  ! ${warning}`);
  }
  if (readiness.remediation) lines.push("", `Next: ${readiness.remediation}`);
  if (mode !== null && mode !== "orchestrator" && readiness.environment === "sandbox") {
    lines.push("", `This project runs ${mode}: Pathfinder launches no workers, so the environment applies only to orchestrated dispatch.`);
  }
  if (readiness.environment === "sandbox") {
    lines.push("", "Readiness changes nothing: it creates no sandbox, secret, setting or policy and starts no daemon.");
  }
  return lines.join("\n") + "\n";
}
