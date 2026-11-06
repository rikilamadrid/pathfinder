/**
 * Execution environment: selection, read-only readiness, and no silent
 * fallback to local.
 *
 * Every `sbx` answer below comes from a FIXTURE runner — scripted responses
 * standing in for the real CLI, which is not installed on the machines these
 * tests run on. Nothing here talks to Docker. The fixtures are labelled as
 * such wherever they are built.
 */

import { strict as assert } from "node:assert";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  DEFAULT_EXECUTION_ENVIRONMENT,
  EXECUTION_ENVIRONMENTS,
  SANDBOX_PERMISSION_MODES,
  readExecutionEnvironment,
  readExecutionEnvironmentMarker,
  readSandboxAgentAuthMarker,
  readSandboxPermissionModeMarker,
  readSandboxSettings,
} from "../../../skills/orchestrate/engine/mode.mjs";
import {
  DECLARED,
  READINESS_STATUSES,
  SBX_INSTALL,
  checkReadiness,
  formatReadiness,
  localDispatchRefusal,
  macosMajor,
  resolveSbx,
  versionAtLeast,
} from "../../../skills/orchestrate/engine/environment.mjs";
import { cleanUpTemporaryDirectories, json, makeProject, orchestrate, temporaryDirectory } from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

const APPROVAL = "execution of this Feature's tickets in this round; no merges";
const NOW = "2026-11-06T12:00:00.000Z";
const SECRET = "sk-ant-FIXTURE-never-echo-0123456789";
/** FIXTURE: the partially masked value `sbx secret ls` prints, shaped like Docker's documented example. */
const MASKED = "gho_GCaw4o****...****43qy";
const MAC = { platform: "darwin", arch: "arm64", osRelease: "25.6.0" };

/** A file that resolves as `sbx`. The FIXTURE runner answers for it; it is never executed. */
function fakeSbxPath() {
  const dir = temporaryDirectory("fixture-sbx-");
  const path = join(dir, "sbx");
  writeFileSync(path, "#!/bin/sh\nexit 99\n");
  chmodSync(path, 0o755);
  return { dir, path };
}

/**
 * FIXTURE runner: answers scripted `sbx` subcommands and records every call.
 * `answers` maps the subcommand (argv after `--no-input`, space-joined) to a
 * partial result; anything unscripted fails the test.
 */
function fixtureRunner(answers) {
  const calls = [];
  const run = (argv) => {
    calls.push(argv);
    const key = argv.slice(2).join(" ");
    if (!Object.hasOwn(answers, key)) throw new Error(`FIXTURE runner: unscripted call ${JSON.stringify(argv)}`);
    return { status: 0, signal: null, stdout: "", stderr: "", error: null, ...answers[key] };
  };
  run.calls = calls;
  return run;
}

describe("the execution environment marker", () => {
  const cases = [
    ["no file", null, { environment: "local", explicit: false, valid: true }],
    ["no line", "# Execution Mode\n\n<!-- pathfinder:execution-mode orchestrator -->\n", { environment: "local", explicit: false, valid: true }],
    ["local", "<!-- pathfinder:execution-environment local -->\n", { environment: "local", explicit: true, valid: true }],
    ["sandbox", "<!-- pathfinder:execution-environment sandbox -->\n", { environment: "sandbox", explicit: true, valid: true }],
    ["invalid", "<!-- pathfinder:execution-environment cloud -->\n", { environment: "cloud", explicit: true, valid: false }],
    ["CRLF and padding", "# M\r\n\r\n  <!--  pathfinder:execution-environment   sandbox  -->  \r\n", { environment: "sandbox", explicit: true, valid: true }],
    ["quoted inline", "It says `<!-- pathfinder:execution-environment sandbox -->` here.\n", { environment: "local", explicit: false, valid: true }],
    ["first marker wins", "<!-- pathfinder:execution-environment sandbox -->\n<!-- pathfinder:execution-environment local -->\n", { environment: "sandbox", explicit: true, valid: true }],
  ];
  for (const [name, content, expected] of cases) {
    it(name, () => assert.deepEqual(readExecutionEnvironmentMarker(content), expected));
  }

  it("defaults to local, of the two environments", () => {
    assert.deepEqual([...EXECUTION_ENVIRONMENTS], ["local", "sandbox"]);
    assert.equal(DEFAULT_EXECUTION_ENVIRONMENT, "local");
  });

  it("reads a project's file, and an unreadable one is invalid, never local", () => {
    assert.deepEqual(readExecutionEnvironment(temporaryDirectory("no-mode-")), { environment: "local", explicit: false, valid: true });
    const root = temporaryDirectory("dir-mode-");
    mkdirSync(join(root, "context", "execution-mode.md"), { recursive: true });
    assert.deepEqual(readExecutionEnvironment(root), { environment: null, explicit: true, valid: false });
  });
});

/** FIXTURE answers: an sbx that is installed, current, running and signed in, with an API key. */
const READY_ANSWERS = Object.freeze({
  "version --json": { stdout: JSON.stringify([{ client: { version: "0.48.0" } }]) },
  "daemon status --json": { stdout: JSON.stringify([{ status: "running" }]) },
  "ls --json": { stdout: "[]" },
  "secret ls --json": { stdout: JSON.stringify([{ service: "anthropic", scope: "global", value: MASKED }, { service: "github", scope: "global", value: MASKED }]) },
  "settings get ssh.agentForwardingEnabled --json": { stdout: "true" },
  "settings get browser.enabled --json": { stdout: JSON.stringify({ value: false }) },
  "policy ls --json": { stdout: JSON.stringify([{ name: "balanced" }]) },
});

const CHOSEN = Object.freeze({ mode: "bypassPermissions", explicit: true, valid: true });

function sandbox(answers, extra = {}) {
  const sbx = fakeSbxPath();
  const run = fixtureRunner(answers);
  const report = checkReadiness({
    environment: "sandbox",
    harness: "claude-code",
    ...MAC,
    env: { PATHFINDER_SBX: sbx.path, PATH: "" },
    run,
    permissionMode: CHOSEN,
    ...extra,
  });
  return { report, run, sbx };
}

const never = () => {
  throw new Error("the runner must not be called");
};

const withSecrets = (entries) => ({ ...READY_ANSWERS, "secret ls --json": { stdout: JSON.stringify(entries) } });
const check = (report, name) => report.checks.find((entry) => entry.name === name);
const text = (report) => formatReadiness({ selected: { environment: "sandbox", explicit: true, valid: true }, readiness: report, mode: "orchestrator" });

describe("the sandbox permission-mode and agent-auth markers", () => {
  it("reads the permission mode, with no default and an unknown value invalid", () => {
    assert.deepEqual([...SANDBOX_PERMISSION_MODES], ["bypassPermissions", "acceptEdits"]);
    assert.deepEqual(readSandboxPermissionModeMarker(null), { mode: null, explicit: false, valid: false });
    assert.deepEqual(readSandboxPermissionModeMarker("<!-- pathfinder:execution-environment sandbox -->\n"), { mode: null, explicit: false, valid: false });
    for (const mode of ["bypassPermissions", "acceptEdits"]) {
      assert.deepEqual(readSandboxPermissionModeMarker(`<!-- pathfinder:sandbox-permission-mode ${mode} -->\r\n`), { mode, explicit: true, valid: true });
    }
    assert.deepEqual(readSandboxPermissionModeMarker("<!-- pathfinder:sandbox-permission-mode plan -->"), { mode: "plan", explicit: true, valid: false });
    assert.deepEqual(readSandboxPermissionModeMarker("<!-- pathfinder:sandbox-permission-mode bypasspermissions -->"), { mode: "bypasspermissions", explicit: true, valid: false });
    assert.deepEqual(readSandboxPermissionModeMarker("says `<!-- pathfinder:sandbox-permission-mode acceptEdits -->`"), { mode: null, explicit: false, valid: false });
  });

  it("reads a subscription declaration, and nothing else declares one", () => {
    assert.deepEqual(readSandboxAgentAuthMarker(null), { value: null, explicit: false, valid: false });
    assert.deepEqual(readSandboxAgentAuthMarker("  <!-- pathfinder:sandbox-agent-auth subscription -->  \r\n"), { value: "subscription", explicit: true, valid: true });
    assert.deepEqual(readSandboxAgentAuthMarker("<!-- pathfinder:sandbox-agent-auth oauth -->"), { value: "oauth", explicit: true, valid: false });
  });

  it("reads every sandbox setting from one file, and an unreadable file is never a default", () => {
    const root = temporaryDirectory("sandbox-settings-");
    mkdirSync(join(root, "context"));
    writeFileSync(join(root, "context", "execution-mode.md"), "<!-- pathfinder:execution-environment sandbox -->\n<!-- pathfinder:sandbox-permission-mode acceptEdits -->\n<!-- pathfinder:sandbox-agent-auth subscription -->\n");
    assert.deepEqual(readSandboxSettings(root), {
      environment: { environment: "sandbox", explicit: true, valid: true },
      permissionMode: { mode: "acceptEdits", explicit: true, valid: true },
      agentAuth: { value: "subscription", explicit: true, valid: true },
    });
    const broken = temporaryDirectory("sandbox-settings-dir-");
    mkdirSync(join(broken, "context", "execution-mode.md"), { recursive: true });
    const read = readSandboxSettings(broken);
    assert.equal(read.environment.valid, false);
    assert.equal(read.permissionMode.valid, false);
    assert.equal(read.agentAuth.valid, false);
  });
});

describe("readiness, read-only", () => {
  it("local is ready and calls no runner", () => {
    const report = checkReadiness({ environment: "local", harness: "codex", platform: "linux", arch: "x64", env: { PATHFINDER_SBX: "/nowhere/sbx" }, run: never });
    assert.equal(report.status, "ready");
    assert.equal(report.runtime, null);
    assert.equal(report.remediation, null);
    assert.equal(report.permissionMode, null);
    assert.deepEqual(report.checks.map((entry) => entry.status), ["ready"]);
  });

  it("an invalid environment is unsupported, naming the valid values, with no probe", () => {
    const report = checkReadiness({ environment: "cloud", ...MAC, run: never });
    assert.equal(report.status, "unsupported");
    assert.match(report.remediation, /local and sandbox/);
  });

  for (const harness of ["codex", "manual"]) {
    it(`sandbox with ${harness} is unsupported by name`, () => {
      const report = checkReadiness({ environment: "sandbox", harness, ...MAC, permissionMode: CHOSEN, run: never });
      assert.equal(report.status, "unsupported");
      assert.match(check(report, "harness").detail, new RegExp(`${harness} has not been verified`));
    });
  }

  const platforms = [
    ["linux", { platform: "linux", arch: "x64", osRelease: "6.8.0" }],
    ["win32", { platform: "win32", arch: "x64", osRelease: "10.0.26100" }],
    ["Intel mac", { platform: "darwin", arch: "x64", osRelease: "25.6.0" }],
    ["macOS 13 by kernel", { platform: "darwin", arch: "arm64", osRelease: "22.6.0" }],
    ["macOS 13 by product version", { platform: "darwin", arch: "arm64", osRelease: "25.6.0", productVersion: "13.6.1" }],
  ];
  for (const [name, host] of platforms) {
    it(`sandbox on ${name} is unsupported, naming Docker's other hosts as unverified`, () => {
      const report = checkReadiness({ environment: "sandbox", harness: "claude-code", ...host, permissionMode: CHOSEN, run: never });
      assert.equal(report.status, "unsupported");
      const platform = check(report, "platform");
      assert.equal(platform.status, "unsupported");
      assert.match(platform.remediation, /macOS 14\+ on Apple silicon/);
      assert.match(platform.remediation, /Windows 11[\s\S]*Ubuntu 24\.04\+[\s\S]*not verified/);
    });
  }

  it("macOS 14 and later on Apple silicon pass the platform check", () => {
    assert.equal(macosMajor("23.0.0"), 14);
    assert.equal(macosMajor("24.6.0"), 15);
    assert.equal(macosMajor("25.6.0"), 26);
    for (const osRelease of ["23.0.0", "25.6.0"]) {
      const report = checkReadiness({ environment: "sandbox", ...MAC, osRelease, env: { PATH: "" }, permissionMode: CHOSEN, run: never });
      assert.equal(check(report, "platform").status, "ready");
    }
  });

  it("missing sbx is missing, with the brew remediation, and runs nothing", () => {
    const empty = temporaryDirectory("empty-path-");
    for (const env of [{ PATH: empty }, { PATH: "" }, { PATHFINDER_SBX: join(empty, "sbx") }, { PATHFINDER_SBX: "relative/sbx" }]) {
      const report = checkReadiness({ environment: "sandbox", ...MAC, env, permissionMode: CHOSEN, run: never });
      assert.equal(report.status, "missing", JSON.stringify(env));
      assert.equal(report.remediation, SBX_INSTALL);
      assert.equal(SBX_INSTALL, "brew trust docker/tap && brew install docker/tap/sbx");
    }
  });

  it("finds sbx on PATH, or at PATHFINDER_SBX first", () => {
    const onPath = fakeSbxPath();
    assert.deepEqual(resolveSbx({ PATH: onPath.dir }), { ok: true, path: onPath.path, source: "PATH" });
    const override = fakeSbxPath();
    assert.deepEqual(resolveSbx({ PATH: onPath.dir, PATHFINDER_SBX: override.path }), { ok: true, path: override.path, source: "PATHFINDER_SBX" });
  });

  it("an old sbx is not-ready with an upgrade", () => {
    const { report, run } = sandbox({ "version --json": { stdout: '{"version":"0.47.9"}' } });
    assert.equal(report.status, "not-ready");
    assert.equal(report.runtime.version, "0.47.9");
    assert.match(report.remediation, /Upgrade sbx to 0\.48\.0/);
    assert.equal(run.calls.length, 1);
  });

  it("a version that cannot be read is not-ready, whether the command fails or says nothing parseable", () => {
    for (const answer of [{ stdout: "sbx version 0.50.0\n" }, { stdout: '{"build":"abc"}' }, { status: 2, stderr: "unknown flag: --json" }]) {
      const { report, run } = sandbox({ "version --json": answer });
      assert.equal(report.status, "not-ready", JSON.stringify(answer));
      assert.match(report.remediation, /Upgrade sbx/);
      assert.equal(run.calls.length, 1, "nothing past the version is probed");
    }
  });

  it("compares versions numerically, a pre-release below its release", () => {
    assert.equal(versionAtLeast("0.48.0", "0.48.0"), true);
    assert.equal(versionAtLeast("0.100.0", "0.48.0"), true);
    assert.equal(versionAtLeast("1.0.0", "0.48.0"), true);
    assert.equal(versionAtLeast("v0.49.1", "0.48.0"), true);
    assert.equal(versionAtLeast("0.48.0-rc.1", "0.48.0"), false);
    assert.equal(versionAtLeast("0.9.0", "0.48.0"), false);
    assert.equal(versionAtLeast("garbage", "0.48.0"), false);
  });

  it("a daemon that is down is not-ready, and nothing that needs it is probed — settings included", () => {
    for (const answer of [{ status: 1, stderr: "daemon not running" }, { stdout: '[{"status":"stopped"}]' }, { stdout: "{}" }]) {
      const { report, run } = sandbox({ "version --json": READY_ANSWERS["version --json"], "daemon status --json": answer });
      assert.equal(report.status, "not-ready", JSON.stringify(answer));
      assert.equal(report.remediation, "sbx daemon start");
      assert.deepEqual(run.calls.map((argv) => argv.slice(2).join(" ")), ["version --json", "daemon status --json"]);
    }
  });

  it("Docker not signed in is authentication-required with sbx login, and no secret is listed", () => {
    const { report, run } = sandbox({ ...READY_ANSWERS, "ls --json": { status: 1, stderr: "Error: You are not authenticated to Docker. Run sbx login.\n" } });
    assert.equal(report.status, "authentication-required");
    assert.equal(report.remediation, "sbx login");
    assert.equal(run.calls.some((argv) => argv.includes("secret")), false);
    assert.equal(check(report, "global-secrets").value, "unknown", "stated, not hidden");
  });

  it("all ready with an API key: every call --no-input, in order, the billing note stated", () => {
    const { report, run, sbx } = sandbox(READY_ANSWERS);
    assert.equal(report.status, "ready");
    assert.equal(report.remediation, null);
    assert.equal(report.permissionMode, "bypassPermissions");
    assert.deepEqual(report.runtime, { name: "sbx", path: sbx.path, version: "0.48.0" });
    assert.ok(run.calls.every((argv) => argv[0] === sbx.path && argv[1] === "--no-input"));
    assert.deepEqual(run.calls.map((argv) => argv.slice(2).join(" ")), Object.keys(READY_ANSWERS));
    const auth = check(report, "agent-auth");
    assert.equal(auth.method, "api-key");
    assert.match(auth.detail, /billed per token to the Anthropic API account, separately from any Claude subscription/);
    for (const entry of report.checks) assert.ok([...READINESS_STATUSES, DECLARED, "info"].includes(entry.status));
  });

  it("a custom secret for api.anthropic.com is ready, labelled experimental and unverified", () => {
    const { report } = sandbox(withSecrets([{ scope: "global", hosts: ["api.anthropic.com"], value: MASKED }]));
    assert.equal(report.status, "ready");
    assert.equal(check(report, "agent-auth").method, "custom-secret");
    assert.match(check(report, "agent-auth").detail, /experimental[\s\S]*unverified with Claude Code/);
  });

  it("a declared subscription is declared: non-blocking, and shown as a warning", () => {
    const { report } = sandbox(withSecrets([]), { declaredAgentAuth: { value: "subscription", explicit: true, valid: true } });
    assert.equal(report.status, "ready");
    const auth = check(report, "agent-auth");
    assert.equal(auth.status, "declared");
    assert.match(auth.detail, /not visible to read-only checks; a launch that fails authentication stops with the claim preserved/);
    assert.ok(report.warnings.some((warning) => warning.startsWith("agent-auth: declared")));
    assert.match(text(report), /Warnings:[\s\S]*! agent-auth: declared/);
  });

  it("no credential is authentication-required, the subscription route listed before the API key", () => {
    for (const declaredAgentAuth of [null, { value: "oauth", explicit: true, valid: false }]) {
      const { report } = sandbox(withSecrets([{ service: "github", scope: "global" }]), { declaredAgentAuth });
      assert.equal(report.status, "authentication-required");
      assert.match(report.remediation, /^Claude subscription: sign in once with \/login in an interactive `sbx run claude <empty directory>` session[\s\S]*sandbox-agent-auth subscription[\s\S]*unverified[\s\S]*Anthropic API key: sbx secret set anthropic \(billed per token/);
    }
  });

  it("a secret listing that fails stops at agent-auth without echoing it", () => {
    const failed = sandbox({ ...READY_ANSWERS, "secret ls --json": { status: 1, stderr: "You are not authenticated" } });
    assert.equal(failed.report.status, "authentication-required");
    assert.equal(failed.report.remediation, "sbx login");
    const broken = sandbox({ ...READY_ANSWERS, "secret ls --json": { status: 3, stdout: MASKED, stderr: MASKED } });
    assert.equal(broken.report.status, "not-ready");
    assert.equal(check(broken.report, "global-secrets").value, "unknown");
  });

  it("the permission mode must be chosen explicitly, and an unknown one is not-ready", () => {
    for (const permissionMode of [null, { mode: null, explicit: false, valid: false }]) {
      const { report } = sandbox(READY_ANSWERS, { permissionMode });
      assert.equal(report.status, "not-ready");
      assert.match(check(report, "permission-mode").detail, /choose the in-sandbox permission mode explicitly/);
      assert.match(report.remediation, /sandbox-permission-mode <bypassPermissions\|acceptEdits>/);
      assert.match(text(report), /permission mode {2}\(not chosen\)/);
    }
    const { report } = sandbox(READY_ANSWERS, { permissionMode: { mode: "plan", explicit: true, valid: false } });
    assert.equal(report.status, "not-ready");
    assert.match(check(report, "permission-mode").detail, /`plan` is not a supported permission mode/);
    const accepted = sandbox(READY_ANSWERS, { permissionMode: { mode: "acceptEdits", explicit: true, valid: true } });
    assert.equal(accepted.report.permissionMode, "acceptEdits");
    assert.match(text(accepted.report), /permission mode {2}acceptEdits/);
  });

  it("an unchosen permission mode is reported beside a missing sbx, which stays the overall status", () => {
    const report = checkReadiness({ environment: "sandbox", ...MAC, env: { PATH: "" }, run: never });
    assert.equal(report.status, "missing");
    assert.equal(check(report, "permission-mode").status, "not-ready");
  });

  it("reports host access every sandbox inherits as warnings, and changes none of it", () => {
    const { report, run } = sandbox(READY_ANSWERS);
    assert.equal(check(report, "ssh-agent-forwarding").value, "on");
    assert.match(check(report, "ssh-agent-forwarding").detail, /host SSH agent to sign, including for Git authentication[\s\S]*sbx settings set ssh\.agentForwardingEnabled false && sbx daemon restart/);
    assert.equal(check(report, "host-browser").value, "off");
    assert.deepEqual(check(report, "global-secrets").value, ["anthropic", "github"]);
    assert.ok(report.warnings.some((warning) => warning.startsWith("ssh-agent-forwarding: on")));
    assert.ok(report.warnings.some((warning) => warning.startsWith("global-secrets: every sandbox inherits: anthropic, github")));
    assert.equal(report.warnings.some((warning) => warning.startsWith("host-browser")), false, "off is not a warning");
    assert.equal(run.calls.some((argv) => argv.includes("set") || argv.includes("start") || argv.includes("create") || argv.includes("run")), false, "readiness changes nothing");
  });

  it("unreadable host settings are unknown, stated rather than hidden", () => {
    const { report } = sandbox({
      ...READY_ANSWERS,
      "settings get ssh.agentForwardingEnabled --json": { status: 1, stderr: "unknown setting" },
      "settings get browser.enabled --json": { stdout: '{"other":1}' },
    });
    assert.equal(report.status, "ready");
    assert.equal(check(report, "ssh-agent-forwarding").value, "unknown");
    assert.equal(check(report, "host-browser").value, "unknown");
    assert.match(text(report), /! ssh-agent-forwarding: unknown/);
  });

  it("the agent-auth check is replaceable, and runs only after sign-in", () => {
    const seen = [];
    const agentAuth = ({ secrets, declared, harness }) => {
      seen.push({ harness, ok: secrets.ok, declared });
      return { name: "agent-auth", status: "ready", detail: "FIXTURE: replaced check" };
    };
    const { report } = sandbox(READY_ANSWERS, { agentAuth });
    assert.equal(report.status, "ready");
    assert.deepEqual(seen, [{ harness: "claude-code", ok: true, declared: null }]);
    const refused = sandbox(READY_ANSWERS, { agentAuth: () => ({ name: "agent-auth", status: "authentication-required", detail: "FIXTURE", remediation: "sign in" }) });
    assert.equal(refused.report.remediation, "sign in");
    const notSignedIn = sandbox({ ...READY_ANSWERS, "ls --json": { status: 1, stderr: "You are not authenticated to Docker" } }, { agentAuth: never });
    assert.equal(notSignedIn.report.status, "authentication-required");
  });

  it("never prints, returns or stores a secret value, masked or not, from any secret output", () => {
    const outputs = [
      { stdout: JSON.stringify([{ service: "anthropic", scope: "global", value: MASKED, secret: SECRET }]) },
      { stdout: JSON.stringify([{ service: "github", value: MASKED, token: SECRET }]) },
      { status: 1, stdout: `${MASKED} ${SECRET}`, stderr: `bad ${MASKED} ${SECRET}` },
      { stdout: `not json ${MASKED} ${SECRET}` },
    ];
    for (const answer of outputs) {
      for (const declaredAgentAuth of [null, { value: "subscription", explicit: true, valid: true }]) {
        const { report } = sandbox({ ...READY_ANSWERS, "secret ls --json": answer }, { declaredAgentAuth });
        for (const leak of [MASKED, SECRET, "GCaw4o", "43qy"]) {
          assert.equal(JSON.stringify(report).includes(leak), false, `--json carries ${leak}`);
          assert.equal(text(report).includes(leak), false, `text carries ${leak}`);
        }
      }
    }
  });
});

describe("orchestrate environment", () => {
  /** FIXTURE `sbx`: a script that only records that it ran. */
  function recordingSbx() {
    const dir = temporaryDirectory("fixture-recording-sbx-");
    const path = join(dir, "sbx");
    const log = join(dir, "ran");
    writeFileSync(path, `#!/bin/sh\necho "$@" >> '${log}'\nexit 1\n`);
    chmodSync(path, 0o755);
    return { path, log };
  }
  const withEnvironment = (value) => `# Execution Mode\n\n<!-- pathfinder:execution-mode orchestrator -->\n${value ? `<!-- pathfinder:execution-environment ${value} -->\n` : ""}`;

  it("prints the requested permission mode and never echoes a FIXTURE sbx's secret output", () => {
    const dir = temporaryDirectory("fixture-cli-sbx-");
    const path = join(dir, "sbx");
    // FIXTURE sbx: answers each probe as a ready installation would, printing masked secret values.
    writeFileSync(path, [
      "#!/bin/sh",
      'case "$*" in',
      `  "--no-input version --json") echo '{"version":"0.48.0"}' ;;`,
      `  "--no-input daemon status --json") echo '[{"status":"running"}]' ;;`,
      `  "--no-input ls --json") echo '[]' ;;`,
      `  "--no-input secret ls --json") echo '[{"service":"github","scope":"global","value":"${MASKED}"}]' ;;`,
      `  "--no-input settings get"*) echo 'true' ;;`,
      `  "--no-input policy ls --json") echo '[]' ;;`,
      "  *) exit 64 ;;",
      "esac",
      "",
    ].join("\n"));
    chmodSync(path, 0o755);
    const root = makeProject({ modeFile: withEnvironment("sandbox") + "<!-- pathfinder:sandbox-permission-mode acceptEdits -->\n" });
    const supportedHost = process.platform === "darwin" && process.arch === "arm64";
    for (const args of [["environment"], ["environment", "--json"]]) {
      const result = orchestrate(args, { root, env: { PATHFINDER_SBX: path } });
      assert.equal(result.status, 1);
      assert.equal(`${result.stdout}${result.stderr}`.includes("GCaw4o"), false);
      if (supportedHost) assert.match(result.stdout, args.length === 1 ? /permission mode {2}acceptEdits[\s\S]*authentication-required/ : /"permissionMode": "acceptEdits"/);
    }
  });

  it("reports local … ready, exits 0, and probes nothing", () => {
    for (const value of [null, "local"]) {
      const root = makeProject({ modeFile: withEnvironment(value) });
      const sbx = recordingSbx();
      const text = orchestrate(["environment"], { root, env: { PATHFINDER_SBX: sbx.path } });
      assert.equal(text.status, 0, text.stderr);
      assert.match(text.stdout, /^local … ready$/m);
      assert.match(text.stdout, /harness {10}claude-code/);
      const report = json(orchestrate(["environment", "--json"], { root, env: { PATHFINDER_SBX: sbx.path } }));
      assert.equal(report.status, "ready");
      assert.equal(report.selected.explicit, value !== null);
      assert.equal(existsSync(sbx.log), false, "local never runs sbx");
    }
  });

  it("reports a sandbox with no sbx as missing (or the host as unsupported), and exits 1", () => {
    const root = makeProject({ modeFile: withEnvironment("sandbox") });
    const result = orchestrate(["environment"], { root, env: { PATHFINDER_SBX: "/nonexistent/pathfinder-fixture/sbx" } });
    assert.equal(result.status, 1);
    const supportedHost = process.platform === "darwin" && process.arch === "arm64";
    if (supportedHost) {
      assert.match(result.stdout, /^sandbox … missing$/m);
      assert.match(result.stdout, /brew trust docker\/tap && brew install docker\/tap\/sbx/);
    } else {
      assert.match(result.stdout, /^sandbox … unsupported$/m);
    }
  });

  it("refuses an unknown harness as a usage error", () => {
    const root = makeProject();
    assert.equal(orchestrate(["environment", "--harness", "vim"], { root }).status, 2);
  });
});

describe("no silent fallback to local", () => {
  const modeFile = "# Execution Mode\n\n<!-- pathfinder:execution-mode orchestrator -->\n";
  const project = () => {
    const root = makeProject({ modeFile, tickets: { "1.1": { title: "A" } } });
    assert.equal(orchestrate(["claim", "1.1", "--now", NOW], { root }).status, 0);
    return root;
  };
  const select = (root, line) => writeFileSync(join(root, "context", "execution-mode.md"), modeFile + (line ? `${line}\n` : ""));

  it("brief refuses every local harness session under sandbox, naming the way out", () => {
    const root = project();
    select(root, "<!-- pathfinder:execution-environment sandbox -->");
    for (const harness of ["claude-code", "codex", "manual"]) {
      const result = orchestrate(["brief", "1.1", "--harness", harness, "--approval", APPROVAL], { root });
      assert.equal(result.status, 1, harness);
      assert.equal(result.stdout, "", "no brief is printed");
      assert.match(result.stderr, /selects the `sandbox` execution environment/);
      assert.match(result.stderr, new RegExp(`the ${harness} translation would start a local session`));
      assert.match(result.stderr, /orchestrate environment/);
      assert.match(result.stderr, /edits that line to `<!-- pathfinder:execution-environment local -->`/);
    }
    assert.match(localDispatchRefusal(root, "manual"), /Refusing rather than falling back to local/);
  });

  it("brief refuses under an invalid environment too", () => {
    const root = project();
    select(root, "<!-- pathfinder:execution-environment cloud -->");
    const result = orchestrate(["brief", "1.1", "--harness", "manual", "--approval", APPROVAL], { root });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid \(`cloud`\) execution environment/);
  });

  it("brief and plan are byte-identical under local and under no line", () => {
    const root = project();
    const outputs = (label) => ({
      label,
      text: ["claude-code", "codex", "manual"].map((harness) => orchestrate(["brief", "1.1", "--harness", harness, "--approval", APPROVAL], { root })),
      json: orchestrate(["brief", "1.1", "--harness", "claude-code", "--approval", APPROVAL, "--json"], { root }),
      plan: orchestrate(["plan"], { root }),
      planJson: orchestrate(["plan", "--json"], { root }),
    });
    const none = outputs("none");
    select(root, "<!-- pathfinder:execution-environment local -->");
    const local = outputs("local");
    assert.equal(none.text[0].status, 0, none.text[0].stderr);
    assert.deepEqual({ ...local, label: null }, { ...none, label: null });
    assert.doesNotMatch(none.plan.stdout, /Execution environment/);
    assert.equal(Object.hasOwn(json(none.planJson), "environment"), false);
  });

  it("plan shows the sandbox environment and its readiness", () => {
    const root = makeProject({ modeFile: modeFile + "<!-- pathfinder:execution-environment sandbox -->\n", tickets: { "1.1": { title: "A" } } });
    const env = { PATHFINDER_SBX: "/nonexistent/pathfinder-fixture/sbx" };
    const text = orchestrate(["plan"], { root, env });
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /Execution environment: sandbox — readiness for claude-code: (missing|unsupported)/);
    assert.match(text.stdout, /brief refuses every local harness session/);
    const planned = json(orchestrate(["plan", "--json"], { root, env }));
    assert.equal(planned.environment.name, "sandbox");
    assert.equal(planned.environment.localDispatch, "refused");
    assert.ok(["missing", "unsupported"].includes(planned.environment.readiness));
  });
});
