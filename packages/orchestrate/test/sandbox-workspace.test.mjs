/**
 * The sandbox workspace and its Git exchange, against real repositories.
 *
 * The test plays both sides. As the host it calls prepare and collect through
 * a recording runner; as the sandboxed agent it runs Git directly in the
 * workspace — commits, bundles, and hostile config — because that is exactly
 * what an agent may do there. The guarantee under test is the host's: it
 * never runs Git with the workspace as its repository or directory, and it
 * treats everything the sandbox produced as untrusted input.
 *
 * No `sbx` is involved or needed: the sandbox here is a labelled fixture — a
 * plain directory the test writes into as the agent would.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, realpathSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";

import { cleanUpTemporaryDirectories, ENGINE_ROOT, gitEnv, runGit, temporaryDirectory } from "../lib/harness.mjs";

const {
  bundleCommand, bundleOutcome, collectWorkspace, defaultRun, foldName, IMPORT_REF_PREFIX, importPathProblem, inputPathProblem,
  MAX_COMMAND_OUTPUT, MAX_IMPORT_OBJECT_BYTES, MAX_IMPORT_WRITTEN_BYTES, MAX_IMPORT_WRITTEN_PATHS, MAX_NAME_BYTES, MAX_PATH_BYTES, OUTPUT_LIMITS,
  PROTECTED_PATHS, prepareWorkspace, symlinkProblem,
} = await import(pathToFileURL(join(ENGINE_ROOT, "sandbox-workspace.mjs")));

after(cleanUpTemporaryDirectories);

const WINDOWS = process.platform === "win32";
/** File modes only bind a process that is neither Windows nor root. */
const MODES_BIND = !WINDOWS && process.getuid?.() !== 0;
const KEY = "1.1";
const BRANCH = "ticket/1.1-sandboxed";
const RUN_ID = "20261106T120000Z-1a2b3c4d";
const PR = "https://github.com/example/project/pull/7";
const STATE_FILE = "# Current Ticket\n\n- Ticket: 1.1 — Sandboxed\n- State: working\n- Next: implement\n";

/** The host's runner: every call recorded, deterministic Git environment. */
function recorder() {
  const calls = [];
  const run = (argv, options = {}) => {
    calls.push({ argv, cwd: options.cwd });
    return defaultRun(argv, { ...options, env: gitEnv() });
  };
  return { run, calls };
}

/** A repository with a claim worktree on BRANCH, one commit past main. */
function project(name = "repo") {
  const root = join(temporaryDirectory("sandbox-ws-"), name);
  mkdirSync(root, { recursive: true });
  runGit(["init", "--quiet", "--initial-branch=main"], root);
  runGit(["config", "user.name", "Host Person"], root);
  runGit(["config", "user.email", "host@example.com"], root);
  writeFileSync(join(root, ".gitignore"), "/.pathfinder/\n/context/current-ticket.md\n");
  writeFileSync(join(root, "README.md"), "# project\n");
  runGit(["add", "."], root);
  runGit(["commit", "--quiet", "-m", "init"], root);
  const worktree = join(root, ".pathfinder", "worktrees", KEY);
  runGit(["worktree", "add", "--quiet", "-b", BRANCH, worktree], root);
  writeFileSync(join(worktree, "work.txt"), "one\n");
  runGit(["add", "work.txt"], worktree);
  runGit(["commit", "--quiet", "-m", "claimed work"], worktree);
  mkdirSync(join(worktree, "context"), { recursive: true });
  writeFileSync(join(worktree, "context", "current-ticket.md"), STATE_FILE);
  return { root, worktree, head: runGit(["rev-parse", "HEAD"], worktree).trim() };
}

function prepare(p, overrides = {}) {
  const host = recorder();
  const prepared = prepareWorkspace({ root: p.root, key: KEY, worktree: p.worktree, branch: BRANCH, session: "implementation", runId: RUN_ID, inputs: {}, run: host.run, ...overrides });
  return { ...prepared, host };
}

/** As the agent: a commit in the workspace, then the bundle the host will import. */
function agentCommits(workspace, dispatchedHead, files = { "feature.txt": "from the sandbox\n" }) {
  for (const [name, content] of Object.entries(files)) writeFileSync(join(workspace, name), content);
  runGit(["add", "."], workspace);
  runGit(["commit", "--quiet", "-m", "sandboxed work"], workspace);
  const command = bundleCommand({ workspace, branch: BRANCH, dispatchedHead });
  assert.equal(command.ok, true, command.message);
  const outcome = bundleOutcome(defaultRun(command.argv, { env: gitEnv() }));
  assert.equal(outcome.bundle, true, outcome.message);
  return runGit(["rev-parse", "HEAD"], workspace).trim();
}

function writeOut(workspace, name, value) {
  writeFileSync(join(workspace, ".pathfinder-sandbox", "out", name), typeof value === "string" ? value : JSON.stringify(value));
}

const result = (outcome = "DONE", extra = {}) => ({ schema: "pathfinder.sandbox-result/1", outcome, message: `${outcome}: ${PR}`, ...extra });

function collect(p, prepared, overrides = {}) {
  const host = recorder();
  const collected = collectWorkspace({ root: p.root, key: KEY, runDir: prepared.runDir, worktree: p.worktree, branch: BRANCH, dispatchedHead: prepared.dispatchedHead, allowCommits: true, run: host.run, ...overrides });
  return { ...collected, host };
}

/** No host Git call names the workspace as its directory or its repository. */
function assertNeverInWorkspace(calls, workspace) {
  assert.ok(calls.length > 0, "the host ran Git");
  for (const { argv, cwd } of calls) {
    assert.ok(!String(cwd ?? "").startsWith(workspace), `git ran in the workspace: ${argv.join(" ")}`);
    assert.ok(!argv.some((arg) => arg.startsWith(workspace)), `git named the workspace: ${argv.join(" ")}`);
  }
}

describe("preparing a sandbox workspace", () => {
  it("clones the exact head with no remotes, alternates or hardlinks, and only the host identity", () => {
    const p = project();
    const prepared = prepare(p);
    assert.equal(prepared.ok, true, prepared.message);
    assert.equal(prepared.dispatchedHead, p.head);
    assert.equal(prepared.runDir, join(realpathSync.native(p.root), ".pathfinder", "sandboxes", KEY, RUN_ID));
    assert.equal(prepared.workspace, join(prepared.runDir, "workspace"));

    const ws = prepared.workspace;
    assert.equal(runGit(["rev-parse", "HEAD"], ws).trim(), p.head);
    assert.equal(runGit(["symbolic-ref", "--short", "HEAD"], ws).trim(), BRANCH);
    assert.equal(runGit(["remote"], ws).trim(), "", "no remote");
    assert.equal(runGit(["for-each-ref", "refs/remotes"], ws).trim(), "", "no remote-tracking refs");
    assert.equal(existsSync(join(ws, ".git", "objects", "info", "alternates")), false, "no alternates");
    assert.equal(runGit(["config", "--local", "--get", "user.name"], ws).trim(), "Host Person");
    assert.equal(runGit(["config", "--local", "--get", "user.email"], ws).trim(), "host@example.com");
    const local = runGit(["config", "--local", "--list"], ws);
    assert.doesNotMatch(local, /^remote\./m);

    // No object file is shared with the host's object store.
    const objects = join(ws, ".git", "objects");
    const files = readdirSync(objects, { recursive: true }).map((name) => join(objects, name)).filter((file) => lstatSync(file).isFile());
    assert.ok(files.length > 0);
    for (const file of files) assert.equal(lstatSync(file).nlink, 1, `${file} is hard-linked`);

    assert.match(readFileSync(join(ws, ".git", "info", "exclude"), "utf8"), /^\/\.pathfinder-sandbox\/$/m);
    writeFileSync(join(ws, ".pathfinder-sandbox", "out", "result.json"), "{}");
    assert.equal(runGit(["status", "--porcelain"], ws), "", "the I/O directory is never committed");
    assert.equal(runGit(["status", "--porcelain"], p.worktree), "", "the claim worktree is untouched");
  });

  it("writes inputs under in/ and refuses paths that could escape it", () => {
    const p = project();
    const prepared = prepare(p, { inputs: { "brief.md": "the brief\n", "context/tracker.md": "tracker\n", ".features/64-x.md": "spec\n" } });
    assert.equal(prepared.ok, true, prepared.message);
    const inDir = join(prepared.workspace, ".pathfinder-sandbox", "in");
    assert.equal(readFileSync(join(inDir, "brief.md"), "utf8"), "the brief\n");
    assert.equal(readFileSync(join(inDir, "context", "tracker.md"), "utf8"), "tracker\n");
    assert.equal(readFileSync(join(inDir, ".features", "64-x.md"), "utf8"), "spec\n");

    for (const name of ["../escape.md", "a/../../b", "/etc/passwd", "C:/x", "a\\b", "a//b", "./a", "", "a\nb"]) {
      assert.ok(inputPathProblem(name), `${JSON.stringify(name)} is refused`);
      const q = project();
      const refused = prepare(q, { inputs: { [name]: "x" } });
      assert.equal(refused.ok, false, JSON.stringify(name));
      assert.equal(existsSync(join(q.root, ".pathfinder", "sandboxes")), false, "nothing was created");
    }
  });

  it("refuses a dirty or wrong-branch worktree, and a run that already exists", () => {
    const dirty = project();
    writeFileSync(join(dirty.worktree, "stray.txt"), "x\n");
    assert.match(prepare(dirty).message, /uncommitted changes/);

    const elsewhere = project();
    runGit(["checkout", "--quiet", "-b", "other"], elsewhere.worktree);
    assert.match(prepare(elsewhere).message, /is on other, not ticket\/1\.1-sandboxed/);

    const twice = project();
    assert.equal(prepare(twice).ok, true);
    assert.match(prepare(twice).message, /already exists; every session gets a fresh workspace/);
  });

  it("refuses bad keys, sessions, run ids and an unignored .pathfinder/", () => {
    const p = project();
    assert.match(prepare(p, { key: "1" }).message, /not a ticket key/);
    assert.match(prepare(p, { session: "whatever" }).message, /session must be one of/);
    assert.match(prepare(p, { runId: "20261106-xyz" }).message, /run id/);
    writeFileSync(join(p.root, ".gitignore"), "/context/current-ticket.md\n");
    assert.match(prepare(p).message, /not ignored by Git/);
  });

  it("works under a repository path with spaces, quotes, $, backticks and unicode", () => {
    const name = WINDOWS ? "with space $HOME ünïcødé ✓" : "it's a \"quoted\" $HOME `tick` ünïcødé ✓";
    const p = project(name);
    const prepared = prepare(p, { inputs: { "brief.md": "x\n" } });
    assert.equal(prepared.ok, true, prepared.message);
    assert.ok(prepared.workspace.includes(name));
    const tip = agentCommits(prepared.workspace, prepared.dispatchedHead);
    writeOut(prepared.workspace, "result.json", result());
    const collected = collect(p, prepared);
    assert.equal(collected.ok, true, collected.message);
    assert.deepEqual(collected.commits, { imported: true, from: p.head, to: tip, count: 1, verified: false });
    assert.equal(runGit(["rev-parse", "HEAD"], p.worktree).trim(), tip);
  });

  it("refuses a repository path containing \":\" by name", () => {
    if (WINDOWS) return;
    const p = project("with:colon");
    const refused = prepare(p);
    assert.equal(refused.ok, false);
    assert.match(refused.message, /contains ":", which sbx reads as PATH:TARGET/);
    assert.equal(existsSync(join(p.root, ".pathfinder", "sandboxes")), false);
  });
});

describe("the bundle command", () => {
  it("is an argv, and a session with no new commits produces no bundle, reported as no commits", () => {
    const p = project();
    const prepared = prepare(p);
    const command = bundleCommand({ workspace: prepared.workspace, branch: BRANCH, dispatchedHead: prepared.dispatchedHead });
    assert.deepEqual(command.argv.slice(0, 3), ["env", "LC_ALL=C", "git"], "Git runs untranslated, so its refusal keeps one wording");
    assert.equal(command.bundle, join(prepared.workspace, ".pathfinder-sandbox", "out", "branch.bundle"));
    const outcome = bundleOutcome(defaultRun(command.argv, { env: gitEnv() }));
    assert.deepEqual(outcome, { ok: true, bundle: false, message: "no commits" });
    assert.equal(existsSync(command.bundle), false);

    assert.equal(bundleOutcome({ status: 128, signal: null, stdout: "", stderr: "fatal: something else", error: null }).ok, false);
    assert.match(bundleCommand({ workspace: "/a:b", branch: BRANCH, dispatchedHead: p.head }).message, /contains ":"/);
    assert.equal(bundleCommand({ workspace: prepared.workspace, branch: BRANCH, dispatchedHead: "HEAD" }).ok, false);
  });

  it("reports no commits only from Git's own refusal line, never from the words elsewhere", () => {
    const failed = (stderr) => bundleOutcome({ status: 128, signal: null, stdout: "", stderr, error: null });
    assert.deepEqual(failed("fatal: Refusing to create empty bundle.\n"), { ok: true, bundle: false, message: "no commits" });
    assert.deepEqual(failed("error: Refusing to create empty bundle."), { ok: true, bundle: false, message: "no commits" });
    for (const stderr of [
      "fatal: Unable to create '/x/my empty bundle repo/out/branch.bundle.lock': Permission denied",
      "fatal: could not write to /tmp/Refusing to create empty bundle./out",
      "fatal: Leere Bundles werden nicht erstellt.",
    ]) assert.equal(failed(stderr).ok, false, stderr);
  });

  it("does not mistake a failed write for no commits when the repository path says empty bundle", () => {
    if (!MODES_BIND) return;
    const p = project("my empty bundle repo");
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeFileSync(join(ws, "feature.txt"), "real work\n");
    runGit(["add", "."], ws);
    runGit(["commit", "--quiet", "-m", "real work"], ws);
    const command = bundleCommand({ workspace: ws, branch: BRANCH, dispatchedHead: prepared.dispatchedHead });
    const out = join(ws, ".pathfinder-sandbox", "out");
    chmodSync(out, 0o500);
    let outcome;
    try {
      outcome = bundleOutcome(defaultRun(command.argv, { env: gitEnv() }));
    } finally {
      chmodSync(out, 0o755);
    }
    assert.equal(outcome.ok, false, "a commit that could not be bundled is a failure");
    assert.match(outcome.message, /the bundle was not written: .*empty bundle repo.*Permission denied/);
    assert.equal(bundleOutcome(defaultRun(command.argv, { env: gitEnv() })).bundle, true, "with out/ writable the same argv bundles the commit");
  });

  it("passes shell-sensitive arguments as data", () => {
    const echoed = defaultRun([process.execPath, "-e", "process.stdout.write(process.argv[1])", "$HOME `id` ; 'q'"]);
    assert.equal(echoed.stdout, "$HOME `id` ; 'q'");
  });
});

describe("collecting a sandbox workspace", () => {
  it("imports a developer's commits by fast-forward, and never runs Git in the workspace", () => {
    const p = project();
    const prepared = prepare(p);
    const tip = agentCommits(prepared.workspace, prepared.dispatchedHead);
    writeOut(prepared.workspace, "result.json", result("DONE", { head: tip }));
    writeOut(prepared.workspace, "state.json", { State: "adversary", Next: "host adversary" });
    writeOut(prepared.workspace, "notes.txt", "not an output");

    const collected = collect(p, prepared);
    assert.equal(collected.ok, true, collected.message);
    assert.deepEqual(collected.commits, { imported: true, from: p.head, to: tip, count: 1, verified: false });
    assert.equal(collected.result.outcome, "DONE");
    assert.deepEqual(collected.state, { State: "adversary", Next: "host adversary" });
    assert.equal(readFileSync(join(p.worktree, "context", "current-ticket.md"), "utf8"), STATE_FILE, "collect writes no state: imported work is unverified");
    assert.deepEqual(collected.ignored, ["notes.txt"]);
    assert.equal(runGit(["rev-parse", BRANCH], p.worktree).trim(), tip);
    assert.equal(readFileSync(join(p.worktree, "feature.txt"), "utf8"), "from the sandbox\n");
    assert.equal(runGit(["status", "--porcelain"], p.worktree), "");
    assert.equal(runGit(["for-each-ref", IMPORT_REF_PREFIX], p.root).trim(), "", "the temporary ref is gone");
    assert.deepEqual(readdirSync(prepared.runDir), ["workspace"], "the bundle copy is gone");
    assertNeverInWorkspace(collected.host.calls, prepared.workspace);
  });

  it("reports no commits when a developer session made none", () => {
    const p = project();
    const prepared = prepare(p);
    writeOut(prepared.workspace, "result.json", result("GATE"));
    const collected = collect(p, prepared);
    assert.equal(collected.ok, true, collected.message);
    assert.deepEqual(collected.commits, { imported: false, reason: "no commits" });
    assert.equal(runGit(["rev-parse", "HEAD"], p.worktree).trim(), p.head);
  });

  it("refuses a bundle that does not descend from the dispatched head", () => {
    const p = project();
    const prepared = prepare(p);
    const ws = prepared.workspace;
    runGit(["reset", "--quiet", "--hard", "HEAD~1"], ws);
    writeFileSync(join(ws, "rewrite.txt"), "rewritten\n");
    runGit(["add", "."], ws);
    runGit(["commit", "--quiet", "-m", "rewritten history"], ws);
    const command = bundleCommand({ workspace: ws, branch: BRANCH, dispatchedHead: prepared.dispatchedHead });
    assert.equal(bundleOutcome(defaultRun(command.argv, { env: gitEnv() })).bundle, true);
    writeOut(ws, "result.json", result());

    const collected = collect(p, prepared);
    assert.equal(collected.ok, false);
    assert.match(collected.message, /does not descend from the dispatched head/);
    assert.equal(runGit(["rev-parse", "HEAD"], p.worktree).trim(), p.head);
    assert.equal(runGit(["for-each-ref", IMPORT_REF_PREFIX], p.root).trim(), "", "the temporary ref is gone");
  });

  it("refuses when the claim worktree moved or became dirty", () => {
    const moved = project();
    const a = prepare(moved);
    agentCommits(a.workspace, a.dispatchedHead);
    writeOut(a.workspace, "result.json", result());
    writeFileSync(join(moved.worktree, "host.txt"), "host\n");
    runGit(["add", "."], moved.worktree);
    runGit(["commit", "--quiet", "-m", "host moved"], moved.worktree);
    const movedHead = runGit(["rev-parse", "HEAD"], moved.worktree).trim();
    const refusedMoved = collect(moved, a);
    assert.equal(refusedMoved.ok, false);
    assert.match(refusedMoved.message, /moved from the dispatched head/);
    assert.equal(runGit(["rev-parse", "HEAD"], moved.worktree).trim(), movedHead);

    const dirty = project();
    const b = prepare(dirty);
    agentCommits(b.workspace, b.dispatchedHead);
    writeOut(b.workspace, "result.json", result());
    writeFileSync(join(dirty.worktree, "stray.txt"), "x\n");
    const refusedDirty = collect(dirty, b);
    assert.equal(refusedDirty.ok, false);
    assert.match(refusedDirty.message, /uncommitted changes/);
    assert.equal(runGit(["rev-parse", "HEAD"], dirty.worktree).trim(), dirty.head);
  });

  it("refuses a bundle from a session that may not commit, and imports its reports", () => {
    const p = project();
    const prepared = prepare(p, { session: "review" });
    agentCommits(prepared.workspace, prepared.dispatchedHead);
    writeOut(prepared.workspace, "result.json", result("PASS"));
    const refused = collect(p, prepared, { allowCommits: false });
    assert.equal(refused.ok, false);
    assert.match(refused.message, /may not commit; it is refused, not ignored/);
    assert.equal(runGit(["rev-parse", "HEAD"], p.worktree).trim(), p.head);

    rmSync(join(prepared.workspace, ".pathfinder-sandbox", "out", "branch.bundle"));
    const findings = { ticket: KEY, pr: PR, head_sha: prepared.dispatchedHead, result: "PASS", findings: [], verification: ["npm test passed"], limits: "local only" };
    writeOut(prepared.workspace, "findings.json", findings);
    const collected = collect(p, prepared, { allowCommits: false });
    assert.equal(collected.ok, true, collected.message);
    assert.deepEqual(collected.findings, findings);
    assert.deepEqual(collected.commits, { imported: false, reason: "this session may not commit" });

    writeOut(prepared.workspace, "findings.json", { ...findings, head_sha: "f".repeat(40) });
    assert.match(collect(p, prepared, { allowCommits: false }).message, /not the dispatched head/);
    writeOut(prepared.workspace, "findings.json", { ...findings, result: "maybe" });
    assert.match(collect(p, prepared, { allowCommits: false }).message, /findings\.json is invalid/);
  });

  it("refuses oversized, symlinked, hard-linked, malformed and missing outputs", () => {
    const p = project();
    const prepared = prepare(p);
    const out = join(prepared.workspace, ".pathfinder-sandbox", "out");
    const outside = join(temporaryDirectory("outside-"), "secret.json");
    writeFileSync(outside, JSON.stringify(result()));

    assert.match(collect(p, prepared).message, /result\.json is missing/);

    writeFileSync(join(out, "result.json"), JSON.stringify({ ...result(), message: "x".repeat(20000) }));
    assert.match(collect(p, prepared).message, /over its 16384-byte limit/);

    writeFileSync(join(out, "result.json"), "{not json");
    assert.match(collect(p, prepared).message, /not valid UTF-8 JSON/);

    writeFileSync(join(out, "result.json"), JSON.stringify(result("SHIPPED")));
    assert.match(collect(p, prepared).message, /outcome must be one of/);

    writeFileSync(join(out, "result.json"), JSON.stringify({ ...result(), extra: true }));
    assert.match(collect(p, prepared).message, /unknown result field: extra/);

    writeFileSync(join(out, "result.json"), JSON.stringify({ ...result(), message: "two\nlines" }));
    assert.match(collect(p, prepared).message, /one non-empty line/);

    rmSync(join(out, "result.json"));
    symlinkSync(outside, join(out, "result.json"));
    assert.match(collect(p, prepared).message, /result\.json is a symlink/);
    rmSync(join(out, "result.json"));

    linkSync(outside, join(out, "result.json"));
    assert.match(collect(p, prepared).message, /another hard link/);
    rmSync(join(out, "result.json"));

    mkdirSync(join(out, "result.json"));
    assert.match(collect(p, prepared).message, /not a regular file/);
    rmSync(join(out, "result.json"), { recursive: true });

    writeOut(prepared.workspace, "result.json", result());
    writeOut(prepared.workspace, "state.json", { Ticket: "9.9" });
    assert.match(collect(p, prepared).message, /`Ticket` is not one the engine writes/);
    writeOut(prepared.workspace, "state.json", { Next: "a\nb" });
    assert.match(collect(p, prepared).message, /one non-empty line/);
    writeOut(prepared.workspace, "state.json", { State: "accepted" });
    assert.match(collect(p, prepared).message, /State from this session must be one of/);
    rmSync(join(out, "state.json"));

    writeFileSync(join(out, "branch.bundle"), Buffer.alloc(2048));
    assert.match(collect(p, prepared, { limits: { "result.json": 16384, "branch.bundle": 1024 } }).message, /branch\.bundle is 2048 bytes, over its 1024-byte limit/);
    assert.match(collect(p, prepared).message, /does not verify/);
    rmSync(join(out, "branch.bundle"));

    // The out directory itself, and its parent, must not be links either.
    rmSync(out, { recursive: true });
    const elsewhere = temporaryDirectory("elsewhere-");
    writeFileSync(join(elsewhere, "result.json"), JSON.stringify(result()));
    symlinkSync(elsewhere, out, WINDOWS ? "junction" : "dir");
    assert.match(collect(p, prepared).message, /\.pathfinder-sandbox\/out is a symlink/);

    assert.equal(runGit(["rev-parse", "HEAD"], p.worktree).trim(), p.head, "nothing was imported");
  });

  it("refuses an unreadable out directory instead of throwing", () => {
    if (!MODES_BIND) return;
    const p = project();
    const prepared = prepare(p);
    writeOut(prepared.workspace, "result.json", result());
    const out = join(prepared.workspace, ".pathfinder-sandbox", "out");
    chmodSync(out, 0o000);
    let collected;
    try {
      assert.doesNotThrow(() => { collected = collect(p, prepared); });
    } finally {
      chmodSync(out, 0o755);
    }
    assert.equal(collected.ok, false);
    assert.match(collected.message, /cannot read \.pathfinder-sandbox\/out: EACCES/);
  });

  it("refuses when out/ is replaced between its check and a read", () => {
    // A labelled stand-in for a writer that has not stopped: reading the
    // result.json limit swaps out/ mid-collect, deterministically.
    const p = project();
    const prepared = prepare(p);
    const out = join(prepared.workspace, ".pathfinder-sandbox", "out");
    writeOut(prepared.workspace, "result.json", result());
    const elsewhere = temporaryDirectory("elsewhere-");
    writeFileSync(join(elsewhere, "result.json"), JSON.stringify({ ...result(), message: "OUTSIDE the workspace" }));
    const swapping = (swap) => ({ get "result.json"() { swap(); return 16 * 1024; } });

    const replaced = collect(p, prepared, { limits: swapping(() => {
      renameSync(out, `${out}.old`);
      mkdirSync(out);
      writeFileSync(join(out, "result.json"), JSON.stringify({ ...result(), message: "a replacement directory" }));
    }) });
    assert.equal(replaced.ok, false);
    assert.match(replaced.message, /\.pathfinder-sandbox\/out was replaced while it was collected; collect only once the sandbox has stopped/);

    rmSync(out, { recursive: true });
    renameSync(`${out}.old`, out);
    const linked = collect(p, prepared, { limits: swapping(() => {
      renameSync(out, `${out}.old`);
      symlinkSync(elsewhere, out, WINDOWS ? "junction" : "dir");
    }) });
    assert.equal(linked.ok, false, "the outside result.json is never returned");
    assert.match(linked.message, /\.pathfinder-sandbox\/out is a symlink/);
  });

  it("refuses a run directory outside .pathfinder/sandboxes/<key>/", () => {
    const p = project();
    const prepared = prepare(p);
    writeOut(prepared.workspace, "result.json", result());
    assert.match(collect(p, prepared, { runDir: prepared.workspace }).message, /not a run directory/);
    assert.match(collect(p, prepared, { key: "2.1" }).message, /2\.1 has no registered claim worktree/);
    const stray = join(p.root, ".pathfinder", "sandboxes", KEY, "not-a-run-id");
    mkdirSync(stray, { recursive: true });
    assert.match(collect(p, prepared, { runDir: stray }).message, /not a run directory under \.pathfinder\/sandboxes\/1\.1\//);
    assert.match(collect(p, prepared, { allowCommits: undefined }).message, /allowCommits must be stated/);
  });

  it("collects a workspace whose .git/config runs a marker command, without the marker ever appearing", () => {
    if (WINDOWS) return;
    const p = project();
    const prepared = prepare(p);
    const ws = prepared.workspace;
    const tip = agentCommits(ws, prepared.dispatchedHead);
    writeOut(ws, "result.json", result("DONE", { head: tip }));

    // Now the agent turns hostile: an fsmonitor and a hooks path that each
    // leave a marker if the host ever runs Git here.
    const markers = temporaryDirectory("markers-");
    const marker = join(markers, "marker");
    const script = join(markers, "hit.sh");
    writeFileSync(script, `#!/bin/sh\necho "$0 $1" >> '${marker}'\nexit 1\n`);
    chmodSync(script, 0o755);
    const hooks = join(markers, "hooks");
    mkdirSync(hooks);
    for (const hook of ["reference-transaction", "post-checkout", "post-merge", "pre-commit", "post-index-change"]) {
      writeFileSync(join(hooks, hook), `#!/bin/sh\necho "hook ${hook}" >> '${marker}'\n`);
      chmodSync(join(hooks, hook), 0o755);
    }
    runGit(["config", "core.fsmonitor", script], ws);
    runGit(["config", "core.hooksPath", hooks], ws);
    assert.equal(existsSync(marker), false, "configuring it ran nothing");

    const collected = collect(p, prepared);
    assert.equal(collected.ok, true, collected.message);
    assert.deepEqual(collected.commits, { imported: true, from: p.head, to: tip, count: 1, verified: false });
    assert.equal(existsSync(marker), false, "the host never executed the workspace's config");
    assertNeverInWorkspace(collected.host.calls, ws);

    // Control: the hostile config is live — Git run in the workspace executes it.
    spawnSync("git", ["status"], { cwd: ws, env: gitEnv() });
    spawnSync("git", ["commit", "--allow-empty", "-m", "control"], { cwd: ws, env: gitEnv() });
    const hits = readFileSync(marker, "utf8");
    assert.match(hits, /hit\.sh/, "the fsmonitor runs when Git runs in the workspace");
    assert.match(hits, /^hook /m, "the hooks run when Git runs in the workspace");
  });
});

/** As the agent: replace out/branch.bundle with a bundle of exactly these revisions. */
function agentBundle(workspace, revs) {
  const bundle = join(workspace, ".pathfinder-sandbox", "out", "branch.bundle");
  rmSync(bundle, { force: true });
  runGit(["bundle", "create", "--quiet", bundle, ...revs], workspace);
}

/** As the agent: start over from the dispatched head. */
function agentReset(workspace, head) {
  runGit(["checkout", "--quiet", "-f", BRANCH], workspace);
  runGit(["reset", "--quiet", "--hard", head], workspace);
  runGit(["clean", "-qfdx", "-e", ".pathfinder-sandbox"], workspace);
}

/** As the agent: a commit holding exactly this tree change, made with plumbing where porcelain would refuse. */
function agentRawCommit(workspace, entries, message = "raw") {
  // entries: [{ mode, type, object, path }] added to HEAD's tree at the top level.
  const base = runGit(["ls-tree", "HEAD"], workspace);
  const lines = base.split("\n").filter(Boolean).concat(entries.map(({ mode, type, object, path }) => `${mode} ${type} ${object}\t${path}`));
  const tree = spawnSync("git", ["mktree"], { cwd: workspace, env: gitEnv(), input: lines.join("\n") + "\n", encoding: "utf8" }).stdout.trim();
  const commit = runGit(["commit-tree", tree, "-p", "HEAD", "-m", message], workspace).trim();
  runGit(["update-ref", `refs/heads/${BRANCH}`, commit], workspace);
  return commit;
}

/**
 * One commit of these entries at any depth, written through the index so no
 * filesystem has to hold them first: `{ path, content, mode }`, mode 120000
 * for a symlink whose content is its target. Returns the new head.
 */
function indexCommit(repository, entries, message = "indexed") {
  for (const { path, content, mode = "100644" } of entries) {
    const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: repository, env: gitEnv(), input: content, encoding: "utf8" }).stdout.trim();
    runGit(["update-index", "--add", "--cacheinfo", `${mode},${blob},${path}`], repository);
  }
  runGit(["commit", "--quiet", "-m", message], repository);
  return runGit(["rev-parse", "HEAD"], repository).trim();
}
const link = (path, target) => ({ path, content: target, mode: "120000" });

/** Whether this Git runs hooks its configuration declares (`hook.<name>.command`, Git 2.54 here), asked in `repository`. */
function configHooksRun(repository) {
  const probe = spawnSync("git", ["-c", "hook.probe.command=true", "-c", "hook.probe.event=pre-commit", "hook", "list", "pre-commit"], { cwd: repository, env: gitEnv(), encoding: "utf8" });
  return probe.status === 0 && /probe/.test(probe.stdout);
}

/**
 * Programs inside the tracked tree, each appending `<tag> <kind> ...` to
 * `marker` when it runs: a script config-declared hooks run, a hooks
 * directory, and an fsmonitor (`configurePrograms` points the host at them).
 */
function trackedPrograms(marker, tag) {
  const hook = (what) => `#!/bin/sh\necho "${tag} ${what} $*" >> '${marker}'\n`;
  return [
    { path: "scripts/hook.sh", content: hook("config-hook"), mode: "100755" },
    ...["post-merge", "reference-transaction", "post-index-change", "post-checkout"].map((name) => ({ path: `hooks/${name}`, content: hook(`hooks-path ${name}`), mode: "100755" })),
    { path: "scripts/fsmonitor.sh", content: `#!/bin/sh\necho "${tag} fsmonitor" >> '${marker}'\nprintf 'token\\0'\n`, mode: "100755" },
  ];
}

/** Point the host's repository configuration at `trackedPrograms`: a hooks path, an fsmonitor, and (where Git runs them) config-declared hooks. */
function configurePrograms(root, withConfigHooks) {
  runGit(["config", "core.hooksPath", "hooks"], root);
  runGit(["config", "core.fsmonitor", "scripts/fsmonitor.sh"], root);
  if (!withConfigHooks) return;
  for (const event of ["post-merge", "reference-transaction", "post-index-change"]) {
    runGit(["config", `hook.on-${event}.command`, `sh scripts/hook.sh ${event}`], root);
    runGit(["config", `hook.on-${event}.event`, event], root);
  }
}

/** Bundle the agent's branch, collect, and check that the refusal left the claim exactly as it was. */
function assertRefusedUntouched(p, prepared, label, overrides = {}) {
  agentBundle(prepared.workspace, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
  const refused = collect(p, prepared, overrides);
  assert.equal(refused.ok, false, `${label}: refused`);
  assert.match(refused.message, /the imported commits are refused/, label);
  assert.ok(existsSync(refused.preserved), `${label}: the bundle is kept for inspection`);
  assert.equal(runGit(["rev-parse", BRANCH], p.worktree).trim(), prepared.dispatchedHead, `${label}: the branch is untouched`);
  assert.equal(runGit(["for-each-ref", IMPORT_REF_PREFIX], p.root).trim(), "", `${label}: the temporary ref is gone`);
  assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], p.worktree), "", `${label}: the worktree is clean`);
  return refused.message;
}

describe("treating sandbox output as untrusted", () => {
  it("runs no hook and no fsmonitor during the import, though host configuration names tracked programs the import rewrites", () => {
    // A hooks path inside the tracked tree (as husky sets one), hooks declared
    // in configuration (hook.<name>.command, which a hooks path of /dev/null
    // does not reach) and an fsmonitor script would each run during the
    // import: the host's version while Git reads the index, the imported one
    // once the fast-forward has checked it out.
    if (WINDOWS) return;
    const p = project();
    const marker = join(temporaryDirectory("programs-"), "marker");
    indexCommit(p.worktree, trackedPrograms(marker, "host"), "tracked programs");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    const withConfigHooks = configHooksRun(p.root);
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const tip = indexCommit(ws, [...trackedPrograms(marker, "IMPORTED"), { path: "src/x.js", content: "x\n" }], "agent rewrites the programs");
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    configurePrograms(p.root, withConfigHooks);
    rmSync(marker, { force: true });
    const collected = collect(p, prepared);
    const ran = existsSync(marker) ? readFileSync(marker, "utf8") : "";
    assert.equal(collected.ok, true, collected.message);
    assert.equal(collected.commits.to, tip);
    assert.equal(ran, "", "no hook or fsmonitor ran during the import, the host's own included");

    // Control: the configuration is live, and the host's next Git commands in the claim run the imported programs.
    runGit(["status", "--porcelain"], p.worktree);
    runGit(["update-ref", "refs/heads/control", "HEAD"], p.worktree);
    const after = readFileSync(marker, "utf8");
    assert.match(after, /^IMPORTED fsmonitor/m, "the imported fsmonitor runs on the host's next status");
    assert.match(after, /^IMPORTED hooks-path reference-transaction/m, "the imported hooks path runs on the next ref update");
    if (withConfigHooks) assert.match(after, /^IMPORTED config-hook reference-transaction/m, "the imported config-declared hook runs on the next ref update");
  });

  it("refuses an import while a configured hook's name cannot be switched off on Git's command line, running nothing", () => {
    if (WINDOWS) return;
    const p = project();
    const marker = join(temporaryDirectory("programs-"), "marker");
    const prepared = prepare(p);
    agentCommits(prepared.workspace, prepared.dispatchedHead);
    writeOut(prepared.workspace, "result.json", result());
    runGit(["config", "hook.a=b.command", `echo ran >> '${marker}'`], p.root);
    runGit(["config", "hook.a=b.event", "post-merge"], p.root);
    runGit(["config", "--add", "hook.a=b.event", "reference-transaction"], p.root);
    const refused = collect(p, prepared);
    assert.equal(refused.ok, false);
    assert.match(refused.message, /declares hook "a=b", whose name holds "=", so it cannot be switched off/);
    assert.match(refused.message, /nothing was imported, and the bundle is kept/);
    assert.equal(existsSync(marker), false, "nothing ran");
    assert.equal(runGit(["rev-parse", BRANCH], p.worktree).trim(), prepared.dispatchedHead);
    assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], p.worktree), "");
  });

  it("treats a file the host's configuration reads from the claim worktree as host-owned: an include, the attributes file, the excludes file", () => {
    // An imported include could declare a hook or an fsmonitor that every Git
    // process after the checkout reads; an attributes file could put a path
    // through a filter. So none of them may change.
    const p = project();
    indexCommit(p.worktree, [
      { path: "cfg/git.inc", content: "[user]\n\tname = Host Person\n" },
      { path: "tools/attrs", content: "*.bin -text\n" },
      { path: "tools/ignore", content: "*.tmp\n" },
    ], "host configuration files");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    // Relative to the file holding it, absolute, and relative to the worktree's top.
    runGit(["config", "include.path", "../.pathfinder/worktrees/1.1/cfg/git.inc"], p.root);
    runGit(["config", "includeIf.onbranch:ticket/**.path", join(p.worktree, "cfg", "later.inc")], p.root);
    runGit(["config", "core.attributesFile", "tools/attrs"], p.root);
    runGit(["config", "core.excludesFile", join(p.worktree, "tools", "ignore")], p.root);
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const cases = [
      ["cfg/git.inc", "[hook \"agent\"]\n\tcommand = touch marker\n\tevent = post-merge\n", /"cfg\/git\.inc" is host-owned: the host's Git configuration reads "cfg\/git\.inc" \(include\.path\)/],
      ["cfg/later.inc", "[core]\n\tfsmonitor = touch marker\n", /"cfg\/later\.inc" is host-owned: the host's Git configuration reads "cfg\/later\.inc" \(includeif\.onbranch:ticket\/\*\*\.path\)/],
      ["tools/attrs", "* filter=agent\n", /"tools\/attrs" is host-owned: .*\(core\.attributesfile\)/],
      ["tools/ignore", "*\n", /"tools\/ignore" is host-owned: .*\(core\.excludesfile\)/],
    ];
    for (const [file, content, pattern] of cases) {
      agentReset(ws, prepared.dispatchedHead);
      indexCommit(ws, [{ path: file, content }], `agent changes ${file}`);
      const message = assertRefusedUntouched(p, prepared, file);
      assert.match(message, pattern, file);
      assert.match(message, /the host commits it on the claim branch outside the sandbox/, file);
    }
    agentReset(ws, prepared.dispatchedHead);
    runGit(["rm", "-rq", "cfg"], ws);
    writeFileSync(join(ws, "cfg"), "a file where the directory was\n");
    runGit(["add", "cfg"], ws);
    runGit(["commit", "--quiet", "-m", "agent replaces cfg/"], ws);
    assert.match(assertRefusedUntouched(p, prepared, "cfg as a file"), /"cfg" stands where the directory holding "cfg\/git\.inc" belongs, and the host's Git configuration reads/);

    agentReset(ws, prepared.dispatchedHead);
    const tip = agentCommits(ws, prepared.dispatchedHead);
    const accepted = collect(p, prepared);
    assert.equal(accepted.ok, true, accepted.message);
    assert.equal(accepted.commits.to, tip, "an import that leaves them alone goes ahead");
  });

  it("treats the host's signature verifiers and allowed signers in the claim worktree as host-owned, and runs only the host's verifier, once, before checkout", () => {
    // With merge.verifySignatures the fast-forward verifies the tip's signature,
    // before it checks anything out, through the program the host configures
    // for the format the signature declares. A verifier or an allowed-signers
    // file that is a path in the claim worktree is host-owned: an import that
    // rewrote one would make the host's next verification run the sandbox's.
    if (WINDOWS) return;
    const p = project();
    const marker = join(temporaryDirectory("verifiers-"), "marker");
    const verifier = (tag) => [
      "#!/bin/sh", `echo "${tag} $*" >> '${marker}'`, "cat > /dev/null",
      "echo '[GNUPG:] NEWSIG'",
      "echo '[GNUPG:] GOODSIG 0123456789ABCDEF Test <test@example.com>'",
      "echo '[GNUPG:] VALIDSIG 0123456789ABCDEF0123456789ABCDEF01234567 2026-01-01 1767225600 0 4 0 1 10 00 0123456789ABCDEF0123456789ABCDEF01234567'",
      "echo '[GNUPG:] TRUST_ULTIMATE 0 pgp'", "",
    ].join("\n");
    indexCommit(p.worktree, [
      { path: "scripts/gpg.sh", content: verifier("host"), mode: "100755" },
      { path: "keys/allowed_signers", content: "test@example.com ssh-ed25519 AAAAhost\n" },
    ], "host verifiers");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    runGit(["config", "merge.verifySignatures", "true"], p.root);
    runGit(["config", "gpg.program", "scripts/gpg.sh"], p.root);
    runGit(["config", "gpg.ssh.allowedSignersFile", "keys/allowed_signers"], p.root);
    runGit(["config", "gpg.x509.program", join(p.worktree, "tools", "gpgsm")], p.root);
    runGit(["config", "gpg.ssh.program", "ssh-keygen"], p.root);
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    // As the agent: its own signer, outside every repository.
    const signer = join(temporaryDirectory("signer-"), "sign.sh");
    writeFileSync(signer, "#!/bin/sh\ncat > /dev/null\necho '[GNUPG:] SIG_CREATED D 1 10 00 1767225600 0123456789ABCDEF' >&2\nprintf -- '-----BEGIN PGP SIGNATURE-----\\n\\nAAAA\\n-----END PGP SIGNATURE-----\\n'\n", { mode: 0o755 });
    const signedCommit = (entries) => {
      for (const { path: file, content, mode = "100644" } of entries) {
        const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: ws, env: gitEnv(), input: content, encoding: "utf8" }).stdout.trim();
        runGit(["update-index", "--add", "--cacheinfo", `${mode},${blob},${file}`], ws);
      }
      runGit(["-c", `gpg.program=${signer}`, "commit", "--quiet", "-S", "-m", "signed by the agent"], ws);
    };
    const ran = () => (existsSync(marker) ? readFileSync(marker, "utf8") : "");
    const cases = [
      ["scripts/gpg.sh", verifier("IMPORTED"), "100755", /"scripts\/gpg\.sh" is host-owned: the host's Git configuration names "scripts\/gpg\.sh" \(gpg\.program\); a sandbox may not add, change or delete what the host's Git runs or reads to verify signatures/],
      ["keys/allowed_signers", "test@example.com ssh-ed25519 AAAAsandbox\n", "100644", /"keys\/allowed_signers" is host-owned: .*\(gpg\.ssh\.allowedsignersfile\)/],
      ["tools/gpgsm", verifier("IMPORTED"), "100755", /"tools\/gpgsm" is host-owned: .*\(gpg\.x509\.program\)/],
    ];
    for (const [file, content, mode, pattern] of cases) {
      agentReset(ws, prepared.dispatchedHead);
      signedCommit([{ path: file, content, mode }]);
      rmSync(marker, { force: true });
      const message = assertRefusedUntouched(p, prepared, file);
      assert.match(message, pattern, file);
      assert.equal(ran(), "", `${file}: refused before anything ran`);
    }

    // A bare program name is looked up on PATH, so a file of that name in the claim is the sandbox's to add.
    agentReset(ws, prepared.dispatchedHead);
    signedCommit([{ path: "feature.txt", content: "from the sandbox\n" }, { path: "ssh-keygen", content: "not on PATH\n" }]);
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    rmSync(marker, { force: true });
    const accepted = collect(p, prepared);
    assert.equal(accepted.ok, true, accepted.message);
    assert.equal(accepted.commits.imported, true);
    assert.match(ran(), /^host --keyid-format=long --status-fd=1 --verify \S+ -\n$/, "the host's verifier ran once, on the sandbox's commit, and nothing else did");
  });

  it("imports only into the registered claim worktree for the key, on its branch", () => {
    const p = project();
    const prepared = prepare(p);
    agentCommits(prepared.workspace, prepared.dispatchedHead);
    writeOut(prepared.workspace, "result.json", result());

    const notClaim = collect(p, prepared, { worktree: p.root, branch: "main" });
    assert.equal(notClaim.ok, false);
    assert.match(notClaim.message, /is not the registered claim worktree for 1\.1/);

    const other = join(p.root, ".pathfinder", "worktrees", "1.2");
    runGit(["worktree", "add", "--quiet", "-b", "ticket/1.2-other", other, BRANCH], p.root);
    assert.match(collect(p, prepared, { worktree: other }).message, /is not the registered claim worktree for 1\.1/);

    const wrongBranch = collect(p, prepared, { branch: "ticket/1.1-elsewhere" });
    assert.match(wrongBranch.message, /claim worktree for 1\.1 is on ticket\/1\.1-sandboxed, not ticket\/1\.1-elsewhere/);

    assert.equal(runGit(["rev-parse", "HEAD"], p.worktree).trim(), p.head, "nothing was imported");
    assert.equal(collect(p, prepared).ok, true, "the registered claim imports");
  });

  it("refuses a bundle carrying anything but exactly refs/heads/<branch>", () => {
    const p = project();
    const prepared = prepare(p);
    const ws = prepared.workspace;
    const tip = agentCommits(ws, prepared.dispatchedHead);
    writeOut(ws, "result.json", result());
    runGit(["tag", "v-sandbox"], ws);
    runGit(["branch", "renamed"], ws);

    const cases = [
      [[`${prepared.dispatchedHead}..refs/heads/${BRANCH}`, "refs/tags/v-sandbox"], /refs\/tags\/v-sandbox/],
      [[`${prepared.dispatchedHead}..refs/heads/${BRANCH}`, "refs/heads/renamed"], /refs\/heads\/renamed/],
      [[`${prepared.dispatchedHead}..HEAD`], /carries HEAD/],
      [[`${prepared.dispatchedHead}..refs/heads/renamed`], /carries refs\/heads\/renamed/],
    ];
    for (const [revs, pattern] of cases) {
      agentBundle(ws, revs);
      const refused = collect(p, prepared);
      assert.equal(refused.ok, false, revs.join(" "));
      assert.match(refused.message, /must carry exactly one ref, refs\/heads\/ticket\/1\.1-sandboxed/);
      assert.match(refused.message, pattern);
      assert.ok(existsSync(refused.preserved), "the bundle is kept for inspection");
      assert.equal(runGit(["rev-parse", "HEAD"], p.worktree).trim(), p.head);
    }
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    assert.equal(collect(p, prepared).commits.to, tip);
  });

  it("refuses merges, gitlinks, escaping symlinks, .git and host-owned paths, naming each, and leaves the branch untouched", () => {
    const p = project();
    const prepared = prepare(p);
    const ws = prepared.workspace;
    const head = prepared.dispatchedHead;
    writeOut(ws, "result.json", result());
    const blob = (text) => spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: ws, env: gitEnv(), input: text, encoding: "utf8" }).stdout.trim();

    const attempts = [
      ["merge commit", () => {
        runGit(["checkout", "--quiet", "-b", "side", "HEAD~1"], ws);
        writeFileSync(join(ws, "side.txt"), "side\n");
        runGit(["add", "."], ws);
        runGit(["commit", "--quiet", "-m", "side"], ws);
        runGit(["checkout", "--quiet", BRANCH], ws);
        runGit(["merge", "--quiet", "--no-ff", "-m", "merge side", "side"], ws);
        return runGit(["rev-parse", "HEAD"], ws).trim();
      }, (tip) => new RegExp(`commit ${tip} is a merge commit`)],
      ["gitlink", () => agentRawCommit(ws, [{ mode: "160000", type: "commit", object: head, path: "vendored" }]), () => /"vendored" is a gitlink/],
      ["absolute symlink", () => agentRawCommit(ws, [{ mode: "120000", type: "blob", object: blob("/etc/passwd"), path: "passwd" }]), () => /symlink "passwd" points at absolute "\/etc\/passwd"/],
      ["escaping symlink", () => agentRawCommit(ws, [{ mode: "120000", type: "blob", object: blob("../../outside"), path: "up" }]), () => /symlink "up" escapes the repository/],
      ["host-owned .gitignore", () => { writeFileSync(join(ws, ".gitignore"), "\n"); runGit(["commit", "--quiet", "-am", "ignore"], ws); }, () => /"\.gitignore" is host-owned/],
      ["host-owned workflow", () => { mkdirSync(join(ws, ".github", "workflows"), { recursive: true }); writeFileSync(join(ws, ".github", "workflows", "x.yml"), "on: push\n"); runGit(["add", "."], ws); runGit(["commit", "--quiet", "-m", "ci"], ws); }, () => /"\.github\/workflows\/x\.yml" is host-owned \(\.github\/\)/],
      ["host-owned mode file", () => { mkdirSync(join(ws, "context"), { recursive: true }); writeFileSync(join(ws, "context", "execution-mode.md"), "<!-- pathfinder:execution-mode human-in-the-loop -->\n"); runGit(["add", "."], ws); runGit(["commit", "--quiet", "-m", "mode"], ws); }, () => /"context\/execution-mode\.md" is host-owned/],
    ];
    for (const [label, make, expected] of attempts) {
      agentReset(ws, head);
      const tip = make() ?? runGit(["rev-parse", "HEAD"], ws).trim();
      agentBundle(ws, [`${head}..refs/heads/${BRANCH}`]);
      const refused = collect(p, prepared);
      assert.equal(refused.ok, false, label);
      assert.match(refused.message, /the imported commits are refused|cannot fetch/, label);
      assert.match(refused.message, expected(tip), label);
      assert.ok(existsSync(refused.preserved), `${label}: the bundle is kept for inspection`);
      assert.equal(runGit(["rev-parse", BRANCH], p.worktree).trim(), head, `${label}: the branch is untouched`);
      assert.equal(runGit(["for-each-ref", IMPORT_REF_PREFIX], p.root).trim(), "", `${label}: the temporary ref is gone`);
      assert.equal(runGit(["status", "--porcelain"], p.worktree), "", `${label}: the worktree is clean`);
    }

    // A .git path Git's own fsck refuses at fetch never reaches the branch
    // either; importPathProblem's own check is exercised directly below.
    agentReset(ws, head);
    agentRawCommit(ws, [{ mode: "100644", type: "blob", object: blob("x\n"), path: ".GIT" }]);
    agentBundle(ws, [`${head}..refs/heads/${BRANCH}`]);
    const dotGit = collect(p, prepared);
    assert.equal(dotGit.ok, false);
    assert.match(dotGit.message, /hasDotgit/, "fetch fsck refuses it before the range check runs");
    assert.equal(runGit(["rev-parse", BRANCH], p.worktree).trim(), head);
  });

  it("refuses symlinks that each look contained but compose into an escape, at any depth", () => {
    const p = project();
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const attempts = [
      // a/s lands on the repository root; x climbs from there to its parent.
      ["a/s -> .., x -> a/s/..", [[link("a/s", ".."), link("x", "a/s/..")]],
        [/symlink "x" climbs "\.\." after a name in "a\/s\/\.\."/]],
      // Each further link climbs one more directory, past the root to the host.
      ["a multi-level chain", [[link("a/s", ".."), link("x", "a/s/.."), link("p", "x/.."), link("q", "p/.."), link("r", "q/..")]],
        [/symlink "x" climbs/, /symlink "p" climbs "\.\." after a name in "x\/\.\."/, /symlink "q" climbs/, /symlink "r" climbs/]],
      // No ".." after a name, but a link leading through another link.
      ["a link through a link", [[link("a/s", ".."), link("y", "a/s/a/s/README.md")]],
        [/symlink "y" reaches "a\/s\/a\/s\/README\.md" through the symlink "a\/s"/]],
      // The link it passes through arrives in a later commit.
      ["a link through a later link", [[link("y", "a/s/README.md")], [link("a/s", "..")]],
        [/symlink "y" reaches "a\/s\/README\.md" through the symlink "a\/s"/]],
      // Spelled as a case-insensitive filesystem would still resolve it.
      ["a link through a differently cased link", [[link("a/s", ".."), link("y", "A/S/README.md")]],
        [/symlink "y" reaches "A\/S\/README\.md" through the symlink "A\/S"/]],
    ];
    for (const [label, commits, expected] of attempts) {
      agentReset(ws, prepared.dispatchedHead);
      for (const entries of commits) indexCommit(ws, entries, label);
      const message = assertRefusedUntouched(p, prepared, label);
      for (const pattern of expected) assert.match(message, pattern, label);
      assert.doesNotMatch(message, /commit [0-9a-f]+: symlink "a\/s"/, `${label}: a/s alone lands inside and is not the problem`);
    }
  });

  it("refuses an import that could redirect a host symlink climbing after a name, and imports one that leaves its way alone", () => {
    // The host's own x -> a/s/.. lands on a while a/s is a real directory;
    // the agent turns a/s into a link to the root, and x would then climb out.
    const p = project();
    mkdirSync(join(p.worktree, "a", "s"), { recursive: true });
    indexCommit(p.worktree, [{ path: "a/s/keep.txt", content: "kept\n" }, link("x", "a/s/..")], "host link");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    runGit(["rm", "--quiet", "--cached", "a/s/keep.txt"], ws);
    indexCommit(ws, [link("a/s", "..")], "a/s becomes a link");
    const message = assertRefusedUntouched(p, prepared, "a redirected host link");
    assert.match(message, /symlink "x", already at the dispatched head, climbs "\.\." after a name in "a\/s\/\.\."; imported changes could redirect it out of the repository: they add, change or remove a symlink at "a\/s" on its way/);
    assert.doesNotMatch(message, /commit [0-9a-f]+: symlink "a\/s"/);

    // Spelled as a case-insensitive filesystem would still resolve it.
    agentReset(ws, prepared.dispatchedHead);
    runGit(["rm", "--quiet", "--cached", "a/s/keep.txt"], ws);
    indexCommit(ws, [link("A", ".")], "A becomes a link beside a");
    assert.match(assertRefusedUntouched(p, prepared, "a link at a differently cased step"), /symlink "x", already at the dispatched head, .* a symlink at "a" on its way/);

    // An import that touches nothing on x's way goes ahead: x is the host's, and lands where it did.
    agentReset(ws, prepared.dispatchedHead);
    const tip = indexCommit(ws, [{ path: "src/new.js", content: "new\n" }, { path: "a/s/more.txt", content: "more\n" }, link("docs/readme", "../README.md")], "unrelated work");
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    const collected = collect(p, prepared);
    assert.equal(collected.ok, true, collected.message);
    assert.equal(collected.commits.to, tip);
    assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], p.worktree), "");
    if (!WINDOWS) assert.equal(realpathSync.native(join(p.worktree, "x")), join(realpathSync.native(p.worktree), "a"), "x still lands on a");
  });

  it("refuses an import that touches any symlink while a host link climbing after a name passes through another host link", () => {
    // x -> l/s/.. goes through the host's link l, past which its way is not
    // read; with an imported link anywhere, it is refused, and without one it imports.
    const p = project();
    indexCommit(p.worktree, [{ path: "a/s/keep.txt", content: "kept\n" }, link("l", "a"), link("x", "l/s/..")], "host links");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    indexCommit(ws, [link("docs/readme", "../README.md")], "an unrelated link");
    assert.match(assertRefusedUntouched(p, prepared, "a link elsewhere"), /symlink "x", already at the dispatched head, climbs "\.\." after a name in "l\/s\/\.\."; imported changes could redirect it out of the repository: it passes through the host's symlink "l"/);

    agentReset(ws, prepared.dispatchedHead);
    const tip = indexCommit(ws, [{ path: "src/new.js", content: "new\n" }], "no links");
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    const collected = collect(p, prepared);
    assert.equal(collected.ok, true, collected.message);
    assert.equal(collected.commits.to, tip);
  });

  it("refuses, conservatively, an import touching a symlink while a host link's target holds a backslash", () => {
    // On POSIX a backslash is part of a name: w -> a\s/.. climbs out of the
    // real directory "a\s", which Windows would read as a, then s. Turning
    // "a\s" into a link to the root would send w out of the claim worktree.
    if (WINDOWS) return;
    const p = project();
    indexCommit(p.worktree, [{ path: "a\\s/keep.txt", content: "kept\n" }, link("w", "a\\s/..")], "a host link with a backslash");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    const inside = realpathSync.native(p.worktree);
    assert.equal(realpathSync.native(join(p.worktree, "w")), inside, "w lands on the root at the head");
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    runGit(["rm", "--quiet", "--cached", "a\\s/keep.txt"], ws);
    indexCommit(ws, [link("a\\s", ".")], "a\\s becomes a link to the root");
    assert.match(assertRefusedUntouched(p, prepared, "a link at the backslashed name"),
      /symlink "w", already at the dispatched head, climbs "\.\." after a name in "a\\\\s\/\.\."; imported changes could redirect it out of the repository: they add, change or remove a symlink at "a\\\\s" on its way/);
    assert.equal(realpathSync.native(join(p.worktree, "w")), inside, "w still lands inside");

    // Its way is not read exactly, so any symlink change is refused, even one elsewhere.
    agentReset(ws, prepared.dispatchedHead);
    indexCommit(ws, [link("docs/readme", "../README.md")], "an unrelated link");
    assert.match(assertRefusedUntouched(p, prepared, "a link elsewhere"),
      /symlink "w", .*: its target holds a backslash, part of a name on POSIX and a separator on Windows, so its way cannot be read exactly, and the imported commits add, change or remove symlinks/);
    assert.equal(realpathSync.native(join(p.worktree, "w")), inside);

    // An import without links leaves a way that resolves alone.
    agentReset(ws, prepared.dispatchedHead);
    const tip = indexCommit(ws, [{ path: "src/new.js", content: "new\n" }], "no links");
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    const collected = collect(p, prepared);
    assert.equal(collected.ok, true, collected.message);
    assert.equal(collected.commits.to, tip);
    assert.equal(realpathSync.native(join(p.worktree, "w")), inside, "w lands where it did");
  });

  it("refuses, conservatively, an import touching a symlink while a host link's way climbs above the repository root", () => {
    // v -> q/../../1.1/s/.. leaves the repository and comes back in by the
    // claim worktree's own directory name; turning s into a link to the
    // root would send v out of it.
    if (WINDOWS) return;
    const p = project();
    indexCommit(p.worktree, [{ path: "q/keep.txt", content: "q\n" }, { path: "s/keep.txt", content: "s\n" }, link("v", `q/../../${KEY}/s/..`)], "a host link re-entering by name");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    const inside = realpathSync.native(p.worktree);
    assert.equal(realpathSync.native(join(p.worktree, "v")), inside, "v lands on the root at the head");
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    runGit(["rm", "--quiet", "--cached", "s/keep.txt"], ws);
    indexCommit(ws, [link("s", ".")], "s becomes a link to the root");
    assert.match(assertRefusedUntouched(p, prepared, "a link on the way back in"),
      /symlink "v", already at the dispatched head, climbs "\.\." after a name in "q\/\.\.\/\.\.\/1\.1\/s\/\.\."; imported changes could redirect it out of the repository: its way climbs above the repository root, so its way cannot be read exactly, and the imported commits add, change or remove symlinks/);
    assert.equal(realpathSync.native(join(p.worktree, "v")), inside, "v still lands inside");

    agentReset(ws, prepared.dispatchedHead);
    const tip = indexCommit(ws, [{ path: "src/new.js", content: "new\n" }], "no links");
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    const collected = collect(p, prepared);
    assert.equal(collected.ok, true, collected.message);
    assert.equal(collected.commits.to, tip);
    assert.equal(realpathSync.native(join(p.worktree, "v")), inside, "v lands where it did");
  });

  it("refuses every import while a host link whose way cannot be read does not resolve, since new directories alone could complete it", () => {
    // w -> q/../.. has no q at the head: adding the directory q would send
    // it above the root. y -> L/s/t/../.. runs through the host's L ->
    // real/deep, whose s -> ../.. lands on the root: adding t would send y out.
    if (WINDOWS) return;
    const attempts = [
      ["a way above the root", [link("w", "q/../..")], "q/new.txt", "w",
        /symlink "w", already at the dispatched head, climbs "\.\." after a name in "q\/\.\.\/\.\."; imported changes could redirect it out of the repository: its way climbs above the repository root, so its way cannot be read exactly, and it does not resolve at the dispatched head, where new directories alone could complete it anywhere; every import is refused until the link is fixed on the host/],
      ["a way through host links", [{ path: "real/deep/keep.txt", content: "k\n" }, link("L", "real/deep"), link("real/deep/s", "../.."), link("y", "L/s/t/../..")], "t/new.txt", "y",
        /symlink "y", .*: it passes through the host's symlink "L", so its way cannot be read exactly, and it does not resolve at the dispatched head/],
    ];
    for (const [label, hostEntries, added, watch, expected] of attempts) {
      const p = project();
      indexCommit(p.worktree, hostEntries, label);
      runGit(["reset", "--quiet", "--hard"], p.worktree);
      assert.throws(() => realpathSync.native(join(p.worktree, watch)), { code: "ENOENT" }, `${label}: ${watch} does not resolve at the head`);
      const prepared = prepare(p);
      writeOut(prepared.workspace, "result.json", result());
      indexCommit(prepared.workspace, [{ path: added, content: "new\n" }], `${label}: a new directory, no links`);
      assert.match(assertRefusedUntouched(p, prepared, label), expected, label);
      assert.throws(() => realpathSync.native(join(p.worktree, watch)), { code: "ENOENT" }, `${label}: ${watch} still leads nowhere`);
    }
  });

  it("imports symlinks that climb only from their own directory and stay inside", () => {
    const p = project();
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const tip = indexCommit(ws, [link("docs/readme", "../README.md"), link("a/b/up", "../.."), link("here", ".")], "contained links");
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    const collected = collect(p, prepared);
    assert.equal(collected.ok, true, collected.message);
    assert.equal(collected.commits.to, tip);
    if (WINDOWS) return;
    const inside = realpathSync.native(p.worktree);
    assert.equal(realpathSync.native(join(p.worktree, "docs", "readme")), join(inside, "README.md"));
    assert.equal(realpathSync.native(join(p.worktree, "a", "b", "up")), inside);
  });

  it("refuses host-owned paths spelled so a case-insensitive filesystem folds them onto the protected names", () => {
    const p = project();
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const attempts = [
      [".agentſ/skills/new/SKILL.md", /"\.agentſ\/skills\/new\/SKILL\.md" is host-owned \(\.agents\/\)/],
      [".pathﬁnder/evil.txt", /"\.pathﬁnder\/evil\.txt" is host-owned \(\.pathfinder\/\)/],
      ["context/tracKer.md", /"context\/tracKer\.md" is host-owned \(context\/tracker\.md\)/],
    ];
    for (const [path, expected] of attempts) {
      agentReset(ws, prepared.dispatchedHead);
      indexCommit(ws, [{ path, content: "from the sandbox\n" }], path);
      const message = assertRefusedUntouched(p, prepared, path);
      assert.match(message, expected, path);
    }
    assert.equal(existsSync(join(p.worktree, ".agents")), false, "nothing was written under .agents/");
    assert.equal(existsSync(join(p.worktree, ".pathfinder", "evil.txt")), false, "nothing was written under .pathfinder/");
  });

  it("refuses an entry named exactly a host-owned directory, in any spelling, and keeps the claim's .pathfinder/ evidence", () => {
    const p = project();
    const evidence = join(p.worktree, ".pathfinder", "scratch", KEY, "evidence.log");
    mkdirSync(join(evidence, ".."), { recursive: true });
    writeFileSync(evidence, "host evidence\n");
    const prepared = prepare(p);
    writeOut(prepared.workspace, "result.json", result());
    const attempts = [
      ["a file .pathfinder", [{ path: ".pathfinder", content: "agent\n" }], /"\.pathfinder" is host-owned \(\.pathfinder\/\)/],
      ["a symlink .Claude", [link(".Claude", "evil"), { path: "evil/settings.json", content: "{\"hooks\":{}}\n" }], /"\.Claude" is host-owned \(\.claude\/\)/],
      ["a symlink .codex", [link(".codex", "evil"), { path: "evil/config.toml", content: "x = 1\n" }], /"\.codex" is host-owned \(\.codex\/\)/],
      ["a symlink .GitHub", [link(".GitHub", "evil"), { path: "evil/workflows/x.yml", content: "on: push\n" }], /"\.GitHub" is host-owned \(\.github\/\)/],
      ["a symlink .agentſ", [link(".agentſ", "evil"), { path: "evil/skills/x/SKILL.md", content: "agent\n" }], /"\.agentſ" is host-owned \(\.agents\/\)/],
      ["a symlink context", [link("context", "evil"), { path: "evil/current-ticket.md", content: "- State: done\n" }], /"context" stands where the directory holding host-owned context\/execution-mode\.md belongs/],
    ];
    for (const [label, entries, expected] of attempts) {
      agentReset(prepared.workspace, prepared.dispatchedHead);
      indexCommit(prepared.workspace, entries, label);
      assert.match(assertRefusedUntouched(p, prepared, label), expected, label);
      assert.equal(readFileSync(evidence, "utf8"), "host evidence\n", `${label}: the claim's .pathfinder/ evidence is intact`);
      assert.equal(lstatSync(join(p.worktree, ".pathfinder")).isDirectory(), true, label);
      assert.equal(lstatSync(join(p.worktree, "context")).isDirectory(), true, label);
      assert.equal(readFileSync(join(p.worktree, "context", "current-ticket.md"), "utf8"), STATE_FILE, label);
      for (const name of [".claude", ".codex", ".github", ".agents", "evil"]) assert.equal(existsSync(join(p.worktree, name)), false, `${label}: no ${name}`);
    }
  });

  it("refuses an ignore file at any depth, added, changed or deleted, leaving the host's ignored files ignored", () => {
    // The host tracks a nested ignore file and ignores .env anywhere; its
    // state file, a secret and a local file are ignored and must stay so.
    const p = project();
    writeFileSync(join(p.worktree, ".gitignore"), "/.pathfinder/\n/context/current-ticket.md\n.env\n");
    runGit(["add", ".gitignore"], p.worktree);
    indexCommit(p.worktree, [{ path: "context/ai-interaction.md", content: "rules\n" }, { path: "apps/web/index.js", content: "web\n" }, { path: "pkg/.gitignore", content: "local.json\n" }], "host layout");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    const held = { "context/current-ticket.md": STATE_FILE, "apps/web/.env": "HOST_SECRET=keep-me\n", "pkg/local.json": "{\"host\": true}\n" };
    for (const [name, content] of Object.entries(held)) writeFileSync(join(p.worktree, name), content);
    assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], p.worktree), "", "the host's files are ignored");
    const prepared = prepare(p);
    assert.equal(prepared.ok, true, prepared.message);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const attempts = [
      ["a nested ignore un-ignoring the state file", () => indexCommit(ws, [{ path: "context/.gitignore", content: "!current-ticket.md\n" }]), "context/.gitignore"],
      ["a nested ignore un-ignoring a secret", () => indexCommit(ws, [{ path: "apps/web/.gitignore", content: "!.env\n" }]), "apps/web/.gitignore"],
      ["a changed nested ignore", () => indexCommit(ws, [{ path: "pkg/.gitignore", content: "!local.json\n" }]), "pkg/.gitignore"],
      ["a deleted nested ignore", () => { runGit(["rm", "--quiet", "--cached", "pkg/.gitignore"], ws); runGit(["commit", "--quiet", "-m", "drop it"], ws); }, "pkg/.gitignore"],
      ["a nested ignore in another case", () => indexCommit(ws, [{ path: "apps/web/.GitIgnore", content: "!.env\n" }]), "apps/web/.GitIgnore"],
      ["a nested ignore as a link", () => indexCommit(ws, [link("apps/web/.gitignore", "../../README.md")]), "apps/web/.gitignore"],
      ["the root ignore file", () => indexCommit(ws, [{ path: ".gitignore", content: "/.pathfinder/\n" }]), ".gitignore"],
    ];
    for (const [label, make, file] of attempts) {
      agentReset(ws, prepared.dispatchedHead);
      make();
      const message = assertRefusedUntouched(p, prepared, label);
      assert.ok(message.includes(`${JSON.stringify(file)} is host-owned (ignore files, at any depth): a sandbox may not add, change or delete ignore rules; if the ticket needs this change, the host commits it on the claim branch outside the sandbox`), `${label}: ${message}`);
      for (const [name, content] of Object.entries(held)) {
        assert.equal(readFileSync(join(p.worktree, name), "utf8"), content, `${label}: ${name} is the host's`);
        runGit(["check-ignore", "--quiet", "--", name], p.worktree);
      }
      assert.equal(readFileSync(join(p.worktree, "pkg", ".gitignore"), "utf8"), "local.json\n", `${label}: the host's ignore rules are unchanged`);
      assert.equal(existsSync(join(p.worktree, "context", ".gitignore")) || existsSync(join(p.worktree, "apps", "web", ".gitignore")), false, `${label}: no ignore file was written`);
      assert.equal(runGit(["add", "--all", "--dry-run"], p.worktree), "", `${label}: nothing the host holds could be staged`);
    }
    assert.equal(prepare(p, { runId: "20261106T120001Z-1a2b3c4e" }).ok, true, "the claim stays preparable");
  });

  it("refuses an attribute file at any depth, added, changed or deleted, so the host's attributes decide the checkout", () => {
    // An imported .gitattributes could grow a small blob many times over as
    // the host checks it out, or route it through a filter program.
    const p = project();
    indexCommit(p.worktree, [{ path: "pkg/.gitattributes", content: "*.txt text\n" }], "host attributes");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    const prepared = prepare(p);
    assert.equal(prepared.ok, true, prepared.message);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const attempts = [
      ["UTF-32", () => indexCommit(ws, [{ path: ".gitattributes", content: "data.txt working-tree-encoding=UTF-32\n" }, { path: "data.txt", content: "a".repeat(900_000) }]), ".gitattributes"],
      ["ident and UTF-32", () => indexCommit(ws, [{ path: ".gitattributes", content: "data.txt ident working-tree-encoding=UTF-32\n" }, { path: "data.txt", content: "$Id$".repeat(225_000) }]), ".gitattributes"],
      ["a nested filter", () => indexCommit(ws, [{ path: "src/.gitattributes", content: "* filter=lfs\n" }, { path: "src/a.js", content: "a\n" }]), "src/.gitattributes"],
      ["a changed nested file", () => indexCommit(ws, [{ path: "pkg/.gitattributes", content: "* ident\n" }]), "pkg/.gitattributes"],
      ["a deleted nested file", () => { runGit(["rm", "--quiet", "--cached", "pkg/.gitattributes"], ws); runGit(["commit", "--quiet", "-m", "drop it"], ws); }, "pkg/.gitattributes"],
      ["another case", () => indexCommit(ws, [{ path: "docs/.GitAttributes", content: "* ident\n" }]), "docs/.GitAttributes"],
      ["a link", () => indexCommit(ws, [link(".gitattributes", "README.md")]), ".gitattributes"],
    ];
    for (const [label, make, file] of attempts) {
      agentReset(ws, prepared.dispatchedHead);
      make();
      const message = assertRefusedUntouched(p, prepared, label, { maxWrittenBytes: 1_000_000 });
      assert.ok(message.includes(`${JSON.stringify(file)} is host-owned (attribute files, at any depth): a sandbox may not add, change or delete Git attributes, which decide how the host checks files out; if the ticket needs this change, the host commits it on the claim branch outside the sandbox`), `${label}: ${message}`);
      assert.equal(existsSync(join(p.worktree, "data.txt")), false, `${label}: nothing was checked out`);
      assert.equal(existsSync(join(p.worktree, ".gitattributes")), false, `${label}: no attribute file was written`);
      assert.equal(readFileSync(join(p.worktree, "pkg", ".gitattributes"), "utf8"), "*.txt text\n", `${label}: the host's attributes are unchanged`);
    }
  });

  it("never replaces a file the claim worktree holds but Git does not track, refusing each by name", () => {
    const p = project();
    writeFileSync(join(p.root, ".git", "info", "exclude"), "/.env\n/cache/\n/build/out.bin\n");
    indexCommit(p.worktree, [{ path: "build/keep", content: "kept\n" }], "a tracked build directory");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    const ignored = { ".env": "HOST_SECRET=keep-me\n", "cache/data.bin": "cached\n", "build/out.bin": "built\n" };
    for (const [name, content] of Object.entries(ignored)) {
      mkdirSync(join(p.worktree, name, ".."), { recursive: true });
      writeFileSync(join(p.worktree, name), content);
    }
    const prepared = prepare(p);
    assert.equal(prepared.ok, true, prepared.message);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const forged = "# Current Ticket\n\n- Ticket: 1.1\n- State: done\n- Adversary: skipped\n- Review: passed\n- Resolved findings: everything\n";
    const attempts = [
      ["the state file and .env", () => indexCommit(ws, [{ path: "context/current-ticket.md", content: forged }, { path: ".env", content: "HOST_SECRET=agent\n" }]),
        [/"context\/current-ticket\.md" is host-owned \(context\/current-ticket\.md\)/]],
      ["a handoff the host does not have yet", () => indexCommit(ws, [{ path: "context/handoff.md", content: "agent handoff\n" }]),
        [/"context\/handoff\.md" is host-owned \(context\/handoff\.md\)/]],
      [".env alone", () => indexCommit(ws, [{ path: ".env", content: "HOST_SECRET=agent\n" }]),
        [/"\.env" would replace "\.env", which the claim worktree holds but Git does not track/]],
      [".env in another case", () => indexCommit(ws, [{ path: ".ENV", content: "HOST_SECRET=agent\n" }]),
        [/"\.ENV" would replace "\.env", which the claim worktree holds but Git does not track/]],
      ["a file inside an ignored directory", () => indexCommit(ws, [{ path: "cache/data.bin", content: "agent\n" }]),
        [/"cache\/data\.bin" would replace "cache\/data\.bin", inside "cache", which the claim worktree holds but Git does not track/]],
      ["a path through an ignored file", () => indexCommit(ws, [{ path: "cache/data.bin/x", content: "agent\n" }]),
        [/"cache\/data\.bin\/x" would replace "cache\/data\.bin", inside "cache"/]],
      ["a path through .env", () => indexCommit(ws, [{ path: ".env/x", content: "agent\n" }]),
        [/"\.env\/x" would replace "\.env", which the claim worktree holds but Git does not track/]],
      ["a file where an ignored directory stands", () => indexCommit(ws, [{ path: "cache", content: "a file now\n" }]),
        [/"cache" would remove the files in "cache", which the claim worktree holds but Git does not track/]],
      ["a tracked directory that becomes a file", () => { runGit(["rm", "-r", "--quiet", "--cached", "build"], ws); indexCommit(ws, [{ path: "build", content: "a file now\n" }]); },
        [/"build" would remove "build\/out\.bin", which the claim worktree holds but Git does not track/]],
    ];
    for (const [label, make, expected] of attempts) {
      agentReset(ws, prepared.dispatchedHead);
      make();
      const message = assertRefusedUntouched(p, prepared, label);
      for (const pattern of expected) assert.match(message, pattern, label);
      assert.equal(readFileSync(join(p.worktree, "context", "current-ticket.md"), "utf8"), STATE_FILE, `${label}: the state file is the host's`);
      assert.equal(existsSync(join(p.worktree, "context", "handoff.md")), false, `${label}: no handoff was written`);
      for (const [name, content] of Object.entries(ignored)) assert.equal(readFileSync(join(p.worktree, name), "utf8"), content, `${label}: ${name} is the host's`);
      assert.equal(runGit(["ls-files"], p.worktree), ".gitignore\nREADME.md\nbuild/keep\nwork.txt\n", `${label}: nothing new is tracked`);
    }

    // A new file in a tracked directory replaces nothing and imports.
    agentReset(ws, prepared.dispatchedHead);
    const tip = indexCommit(ws, [{ path: "build/more.txt", content: "more\n" }]);
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    const collected = collect(p, prepared);
    assert.equal(collected.ok, true, collected.message);
    assert.equal(collected.commits.to, tip);
    assert.equal(readFileSync(join(p.worktree, "build", "out.bin"), "utf8"), "built\n");
  });

  it("imports a first file into an empty directory, one holding only ignored files, or an ignored one, replacing nothing", () => {
    const p = project();
    writeFileSync(join(p.root, ".git", "info", "exclude"), "/.vscode/settings.json\n/build/\n");
    mkdirSync(join(p.worktree, "out"));
    mkdirSync(join(p.worktree, "spare", "nested"), { recursive: true });
    mkdirSync(join(p.worktree, ".vscode"));
    writeFileSync(join(p.worktree, ".vscode", "settings.json"), "HOST settings\n");
    mkdirSync(join(p.worktree, "build"));
    writeFileSync(join(p.worktree, "build", "keep.bin"), "HOST build\n");
    const prepared = prepare(p);
    assert.equal(prepared.ok, true, prepared.message);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());

    // Still refused: a file where a directory holding only ignored files stands.
    indexCommit(ws, [{ path: ".vscode", content: "a file now\n" }]);
    assert.match(assertRefusedUntouched(p, prepared, ".vscode as a file"), /"\.vscode" would remove the files in "\.vscode", which the claim worktree holds but Git does not track/);
    assert.equal(readFileSync(join(p.worktree, ".vscode", "settings.json"), "utf8"), "HOST settings\n");

    agentReset(ws, prepared.dispatchedHead);
    const tip = indexCommit(ws, [
      { path: "out/report.txt", content: "report\n" },
      { path: ".vscode/extensions.json", content: "{}\n" },
      { path: "build/other.bin", content: "tracked\n" },
      { path: "spare", content: "a file where only empty directories stood\n" },
    ], "first files");
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    const collected = collect(p, prepared);
    assert.equal(collected.ok, true, collected.message);
    assert.equal(collected.commits.to, tip);
    assert.equal(readFileSync(join(p.worktree, "out", "report.txt"), "utf8"), "report\n");
    assert.equal(readFileSync(join(p.worktree, "spare"), "utf8"), "a file where only empty directories stood\n");
    assert.equal(readFileSync(join(p.worktree, ".vscode", "settings.json"), "utf8"), "HOST settings\n", "the ignored settings are the host's");
    assert.equal(readFileSync(join(p.worktree, "build", "keep.bin"), "utf8"), "HOST build\n", "the ignored build output is the host's");
    assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], p.worktree), "", "the claim is clean");
    assert.equal(prepare(p, { runId: "20261106T120001Z-1a2b3c4e" }).ok, true, "and preparable");
  });

  it("lets Git refuse to replace an ignored file too, leaving the branch where it was", () => {
    // Were the by-name check ever to miss one, the fast-forward itself runs
    // with --no-overwrite-ignore: here a runner hides every untracked file.
    const p = project();
    writeFileSync(join(p.root, ".git", "info", "exclude"), "/.env\n");
    writeFileSync(join(p.worktree, ".env"), "HOST_SECRET=keep-me\n");
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    indexCommit(ws, [{ path: ".env", content: "HOST_SECRET=agent\n" }]);
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    const blind = (argv, options = {}) => (argv.includes("ls-files")
      ? { status: 0, signal: null, stdout: "", stderr: "", error: null }
      : defaultRun(argv, { ...options, env: gitEnv() }));
    const refused = collect(p, prepared, { run: blind });
    assert.equal(refused.ok, false);
    assert.match(refused.message, /cannot fast-forward ticket\/1\.1-sandboxed to [0-9a-f]+: /);
    assert.doesNotMatch(refused.message, /is now at/);
    assert.ok(existsSync(refused.preserved), "the bundle is kept for inspection");
    assert.equal(runGit(["rev-parse", BRANCH], p.worktree).trim(), prepared.dispatchedHead, "the branch is untouched");
    assert.equal(readFileSync(join(p.worktree, ".env"), "utf8"), "HOST_SECRET=keep-me\n");
    assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], p.worktree), "");
    assert.equal(runGit(["for-each-ref", IMPORT_REF_PREFIX], p.root).trim(), "", "the temporary ref is gone");
  });

  it("refuses a tip whose paths a case-insensitive filesystem would fold onto each other, naming both", () => {
    const p = project();
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const attempts = [
      ["A -> . beside a/b/l", [link("A", "."), link("a/b/l", "../..")], /"A" and "a" are one path on a case- or normalization-insensitive filesystem/],
      ["readme.md beside README.md", [{ path: "readme.md", content: "agent\n" }], /"README\.md" and "readme\.md" are one path/],
    ];
    for (const [label, entries, expected] of attempts) {
      agentReset(ws, prepared.dispatchedHead);
      indexCommit(ws, entries, label);
      assert.match(assertRefusedUntouched(p, prepared, label), expected, label);
      assert.equal(existsSync(join(p.worktree, "a")), false, `${label}: nothing was checked out`);
    }
    assert.equal(prepare(p, { runId: "20261106T120001Z-1a2b3c4e" }).ok, true, "the claim stays clean for the next session");
  });

  it("imports beside a fold pair the dispatched head already holds, and refuses one the import brings", () => {
    const p = project();
    indexCommit(p.worktree, [{ path: "Docs/a.md", content: "a\n" }, { path: "docs/b.md", content: "b\n" }], "a case split the host holds");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], p.worktree), "", "the host holds the split clean");
    const prepared = prepare(p);
    assert.equal(prepared.ok, true, prepared.message);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const attempts = [
      ["docs/a.md beside Docs/a.md", [{ path: "docs/a.md", content: "agent\n" }], /"Docs\/a\.md" and "docs\/a\.md" are one path/],
      ["a link DOCS beside Docs/ and docs/", [link("DOCS", "Docs")], /"DOCS" and "Docs" are one path/],
    ];
    for (const [label, entries, expected] of attempts) {
      agentReset(ws, prepared.dispatchedHead);
      indexCommit(ws, entries, label);
      const message = assertRefusedUntouched(p, prepared, label);
      assert.match(message, expected, label);
      assert.doesNotMatch(message, /"Docs" and "docs" are one path/, `${label}: the host's own pair is not the problem`);
    }

    agentReset(ws, prepared.dispatchedHead);
    const tip = indexCommit(ws, [{ path: "src/new.js", content: "new\n" }, { path: "docs/c.md", content: "c\n" }], "unrelated work");
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    const collected = collect(p, prepared);
    assert.equal(collected.ok, true, collected.message);
    assert.equal(collected.commits.to, tip);
    assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], p.worktree), "", "the claim stays clean");
    assert.equal(prepare(p, { runId: "20261106T120001Z-1a2b3c4e" }).ok, true, "and preparable");
  });

  it("enforces the commit-count limit", () => {
    const p = project();
    const prepared = prepare(p);
    const ws = prepared.workspace;
    for (const n of [1, 2, 3]) { writeFileSync(join(ws, `f${n}.txt`), `${n}\n`); runGit(["add", "."], ws); runGit(["commit", "--quiet", "-m", `c${n}`], ws); }
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    writeOut(ws, "result.json", result());
    assert.match(collect(p, prepared, { maxCommits: 2 }).message, /3 commits, over the 2-commit limit/);
    assert.equal(runGit(["rev-parse", "HEAD"], p.worktree).trim(), p.head);
    assert.equal(collect(p, prepared, { maxCommits: 3 }).commits.count, 3);
  });

  it("accepts only the state a sandboxed session may propose", () => {
    const p = project();
    const prepared = prepare(p);
    writeOut(prepared.workspace, "result.json", result("GATE"));
    for (const field of ["Adversary", "Review", "Repair", "Repair rounds", "Resolved findings", "Updated"]) {
      writeOut(prepared.workspace, "state.json", { [field]: "x" });
      assert.match(collect(p, prepared).message, new RegExp(`\`${field}\` is host-owned`), field);
    }
    for (const state of ["review", "done", "working", "repair"]) {
      writeOut(prepared.workspace, "state.json", { State: state });
      assert.match(collect(p, prepared).message, /State from this session must be one of adversary, human-gate, failed/, state);
    }
    writeOut(prepared.workspace, "state.json", { State: "adversary" });
    assert.match(collect(p, prepared, { allowCommits: false }).message, /must be one of human-gate, failed/);
    writeOut(prepared.workspace, "state.json", { State: "human-gate", Gate: "which way?", "Gate stage": "implementation", Last: "asked", Next: "human decides" });
    const gated = collect(p, prepared, { allowCommits: false });
    assert.equal(gated.ok, true, gated.message);
    assert.equal(gated.state.Gate, "which way?");
    assert.equal(readFileSync(join(p.worktree, "context", "current-ticket.md"), "utf8"), STATE_FILE);
  });

  it("classifies imported paths and symlink targets", () => {
    assert.ok(PROTECTED_PATHS.includes(".github/") && PROTECTED_PATHS.includes("context/tracker.md"));
    assert.ok(PROTECTED_PATHS.includes("context/current-ticket.md") && PROTECTED_PATHS.includes("context/handoff.md"));
    for (const bad of ["a/.git/config", ".Git", "x/.GIT./y", "a/../b", ".gitignore", ".GitHub/x", ".claude/settings.json", ".codex/x", ".agents/x", ".pathfinder/x", "context/tracker.md",
      "context/current-ticket.md", "Context/Handoff.md", ".gitignore/x", "context/tracker.md/x"]) {
      assert.ok(importPathProblem(bad), bad);
    }
    // An entry named exactly a protected directory, or standing where one of
    // a protected path's leading directories belongs, is refused by name.
    for (const [bare, owner] of [[".pathfinder", ".pathfinder/"], [".Claude", ".claude/"], [".GITHUB", ".github/"], [".codex", ".codex/"], [".agentſ", ".agents/"], [".pathﬁnder", ".pathfinder/"]]) {
      assert.equal(importPathProblem(bare), `${JSON.stringify(bare)} is host-owned (${owner})`, bare);
    }
    assert.match(importPathProblem("CONTEXT"), /"CONTEXT" stands where the directory holding host-owned context\/execution-mode\.md belongs/);
    for (const good of ["src/a.js", "context/history.md", "docs/.github-notes.md", "a/.gitkeep", ".gitignore-template", "docs/gitignore.md", ".claudette", ".github-notes.md", "contexts/tracker.md", "docs/context", "sub/.claude"]) {
      assert.equal(importPathProblem(good), null, good);
    }
    // An ignore file is host-owned at any depth and in any spelling a filesystem could check out as one.
    for (const ignore of [".gitignore", "sub/.gitignore", "context/.gitignore", "a/b/c/.GitIgnore", "x/.gitignore/y", "pkg/.gitignore. ", "pkg/GITIGN~1", "pkg/gi250a~2", "pkg/.git\u200cignore", "pkg/\uff0egitignore"]) {
      assert.match(importPathProblem(ignore), /is host-owned \(ignore files, at any depth\): a sandbox may not add, change or delete ignore rules; if the ticket needs this change, the host commits it on the claim branch outside the sandbox$/, ignore);
    }
    // So is an attribute file, in the same spellings.
    for (const attributes of [".gitattributes", "sub/.gitattributes", "a/b/c/.GitAttributes", "x/.gitattributes/y", "pkg/.gitattributes. ", "pkg/GITATT~1", "pkg/gi7d29~2", "pkg/.git\u200cattributes", "pkg/\uff0egitattributes"]) {
      assert.match(importPathProblem(attributes), /is host-owned \(attribute files, at any depth\): a sandbox may not add, change or delete Git attributes, which decide how the host checks files out; if the ticket needs this change, the host commits it on the claim branch outside the sandbox$/, attributes);
    }
    for (const good of [".gitattributes-template", "docs/gitattributes.md", "a/.gitattribute"]) assert.equal(importPathProblem(good), null, good);
    // Folded as APFS (or HFS+) would check them out, never fewer spellings.
    for (const folded of [".agent\u017f/x", ".path\ufb01nder/x", "context/trac\u212aer.md", ".agen\u200cts/x", ".g\u200cit/config", "\uff0egithub/x"]) {
      assert.ok(importPathProblem(folded), folded);
    }
    assert.equal(foldName(".Agent\u017f"), ".agents");
    assert.equal(foldName("Stra\u1e9ee"), "strasse");
    assert.ok(symlinkProblem("a", "/abs"));
    assert.ok(symlinkProblem("a", "C:\\x"));
    assert.ok(symlinkProblem("a/b", "../../x"));
    assert.ok(symlinkProblem("a", ".git/config"));
    assert.ok(symlinkProblem("a", "sub/.G\u200cIT/config"));
    assert.equal(symlinkProblem("a/b", "../c"), null);
    // A ".." after a name is refused whatever it seems to normalize to.
    for (const [file, target] of [["x", "a/s/.."], ["a/b", "c/../d"], ["a", "./b/../c"], ["a/b", "..\\c\\..\\d"]]) {
      assert.match(symlinkProblem(file, target), /climbs "\.\." after a name/, `${file} -> ${target}`);
    }
    for (const [file, target] of [["a/s", ".."], ["a/b/up", "../.."], ["here", "."], ["a/b", "./../c/"]]) assert.equal(symlinkProblem(file, target), null, `${file} -> ${target}`);
    // A target no supported host can create as a link fails the checkout partway, so it is refused by its bytes.
    assert.equal(symlinkProblem("zz/link", `${"./".repeat(507)}README.md`), null, "1,023 bytes is within the limit");
    assert.match(symlinkProblem("zz/link", `${"./".repeat(507)}README.mdx`), /^symlink "zz\/link" has a target of 1024 bytes, over the 1023-byte limit macOS's symlink\(2\) accepts; the checkout would fail partway$/);
    assert.match(symlinkProblem("l", "\u00e9".repeat(512)), /a target of 1024 bytes/, "bytes, not characters, are counted");
  });
});

/** As the agent: one commit whose index lists `blob` at every one of `paths`, written through `update-index --index-info`. */
function sharedBlobCommit(workspace, blob, paths, message) {
  const listing = paths.map((path) => `100644 ${blob}\t${path}`).join("\n") + "\n";
  const updated = spawnSync("git", ["update-index", "--index-info"], { cwd: workspace, env: gitEnv(), input: listing, encoding: "utf8" });
  assert.equal(updated.status, 0, updated.stderr);
  runGit(["commit", "--quiet", "-m", message], workspace);
  return runGit(["rev-parse", "HEAD"], workspace).trim();
}

/** As the agent: a blob of `bytes` zeros, hashed from stdin. */
function zeroBlob(workspace, bytes) {
  const hashed = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: workspace, env: gitEnv(), input: Buffer.alloc(bytes) });
  assert.equal(hashed.status, 0, String(hashed.stderr));
  return String(hashed.stdout).trim();
}

/** The refusal left the claim exactly as it was, with nothing of the import checked out. */
function assertBoundedRefusal(p, prepared, refused, label) {
  assert.equal(refused.ok, false, `${label}: refused`);
  assert.match(refused.message, /the imported commits are refused/, label);
  assert.ok(existsSync(refused.preserved), `${label}: the bundle is kept for inspection`);
  assert.equal(runGit(["rev-parse", BRANCH], p.worktree).trim(), prepared.dispatchedHead, `${label}: the branch is untouched`);
  assert.equal(runGit(["for-each-ref", IMPORT_REF_PREFIX], p.root).trim(), "", `${label}: the temporary ref is gone`);
  assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], p.worktree), "", `${label}: the worktree is clean`);
  assert.deepEqual(runGit(["ls-files"], p.worktree), ".gitignore\nREADME.md\nwork.txt\n", `${label}: nothing new is tracked`);
}

describe("bounding what an import brings", () => {
  it("keeps the expanded and written limits separate from, and well above, the compressed bundle limit", () => {
    assert.equal(MAX_IMPORT_OBJECT_BYTES, 256 * 1024 * 1024);
    assert.equal(MAX_IMPORT_WRITTEN_BYTES, 256 * 1024 * 1024);
    assert.equal(MAX_IMPORT_WRITTEN_PATHS, 20_000);
    assert.equal(MAX_COMMAND_OUTPUT, 16 * 1024 * 1024);
    assert.equal(MAX_IMPORT_OBJECT_BYTES, 4 * OUTPUT_LIMITS["branch.bundle"]);
  });

  it("refuses a small bundle whose objects expand past the limit, before anything is checked out", () => {
    const p = project();
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    // A sparse file of zeros: no disk is spent, and zlib packs it a thousandfold.
    const size = MAX_IMPORT_OBJECT_BYTES + 1024 * 1024;
    writeFileSync(join(ws, "zeros.bin"), "");
    truncateSync(join(ws, "zeros.bin"), size);
    runGit(["add", "zeros.bin"], ws);
    runGit(["commit", "--quiet", "-m", "a quarter gigabyte of zeros"], ws);
    rmSync(join(ws, "zeros.bin"));
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    const bundled = statSync(join(ws, ".pathfinder-sandbox", "out", "branch.bundle")).size;
    assert.ok(bundled < 4 * 1024 * 1024 && bundled * 16 < OUTPUT_LIMITS["branch.bundle"], `the bundle is small: ${bundled} bytes`);

    const refused = collect(p, prepared);
    assertBoundedRefusal(p, prepared, refused, "an expanding bundle");
    assert.match(refused.message, new RegExp(`the imported objects expand to \\d+ bytes \\(3 objects\\), over the ${MAX_IMPORT_OBJECT_BYTES}-byte limit on expanded object data`));
    assert.match(refused.message, new RegExp(`the fast-forward would write ${size} bytes into the claim worktree, over the ${MAX_IMPORT_WRITTEN_BYTES}-byte limit`));
    assert.equal(existsSync(join(p.worktree, "zeros.bin")), false, "nothing was checked out");
    assert.equal(prepare(p, { runId: "20261106T120001Z-1a2b3c4e" }).ok, true, "the claim stays preparable");
  });

  it("refuses one small blob checked out at many paths past the written-bytes limit, though its objects stay small", () => {
    const p = project();
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const blob = zeroBlob(ws, 1024 * 1024);
    const copies = Array.from({ length: 300 }, (_, index) => `copies/copy-${String(index).padStart(3, "0")}.bin`);
    sharedBlobCommit(ws, blob, copies, "one megabyte, three hundred times");
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    assert.ok(statSync(join(ws, ".pathfinder-sandbox", "out", "branch.bundle")).size < 64 * 1024, "the bundle is a few kilobytes");

    const refused = collect(p, prepared);
    assertBoundedRefusal(p, prepared, refused, "a blob written many times");
    assert.match(refused.message, new RegExp(`the fast-forward would write ${300 * 1024 * 1024} bytes into the claim worktree, over the ${MAX_IMPORT_WRITTEN_BYTES}-byte limit`));
    assert.doesNotMatch(refused.message, /expand to/, "the objects themselves are within their limit");
    assert.equal(existsSync(join(p.worktree, "copies")), false, "nothing was checked out");
  });

  it("refuses more written paths than the limit", () => {
    const p = project();
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const empty = zeroBlob(ws, 0);
    const many = Array.from({ length: MAX_IMPORT_WRITTEN_PATHS + 1 }, (_, index) => `many/f-${String(index).padStart(5, "0")}`);
    sharedBlobCommit(ws, empty, many, "twenty thousand and one empty files");
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);

    const refused = collect(p, prepared);
    assertBoundedRefusal(p, prepared, refused, "too many paths");
    assert.match(refused.message, new RegExp(`the fast-forward would write ${MAX_IMPORT_WRITTEN_PATHS + 1} files and links into the claim worktree, over the ${MAX_IMPORT_WRITTEN_PATHS}-path limit`));
    assert.equal(existsSync(join(p.worktree, "many")), false, "nothing was checked out");
  });

  it("takes each limit as its own argument, and imports within all of them", () => {
    const p = project();
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const tip = agentCommits(ws, prepared.dispatchedHead, { "feature.txt": "x".repeat(4096) });
    assert.match(collect(p, prepared, { maxObjectBytes: 1024 }).message, /the imported objects expand to \d+ bytes \(3 objects\), over the 1024-byte limit/);
    assert.match(collect(p, prepared, { maxWrittenPaths: 0 }).message, /would write 1 files and links into the claim worktree, over the 0-path limit/);
    assert.match(collect(p, prepared, { maxWrittenBytes: 4095 }).message, /would write 4096 bytes into the claim worktree, over the 4095-byte limit/);
    assert.equal(runGit(["rev-parse", BRANCH], p.worktree).trim(), prepared.dispatchedHead);
    const collected = collect(p, prepared, { maxObjectBytes: 1 << 20, maxWrittenPaths: 1, maxWrittenBytes: 4096 });
    assert.equal(collected.ok, true, collected.message);
    assert.equal(collected.commits.to, tip);
  });

  it("refuses a listing too large to read whole, rather than judge a truncated one", () => {
    const p = project();
    const prepared = prepare(p);
    agentCommits(prepared.workspace, prepared.dispatchedHead);
    writeOut(prepared.workspace, "result.json", result());
    const overflowing = (argv, options = {}) => (argv.includes("--objects")
      ? { status: null, signal: "SIGTERM", stdout: "", stderr: "", error: Object.assign(new Error("spawnSync git ENOBUFS"), { code: "ENOBUFS" }) }
      : defaultRun(argv, { ...options, env: gitEnv() }));
    const refused = collect(p, prepared, { run: overflowing });
    assertBoundedRefusal(p, prepared, refused, "an overflowing listing");
    assert.match(refused.message, new RegExp(`cannot list the imported objects: git rev-list printed more than the runner reads \\(${MAX_COMMAND_OUTPUT} bytes by default\\); the listing is refused, not truncated`));
  });

  it("bounds what the host's own attributes make the checkout write, UTF-32 with and without ident, before anything is checked out", () => {
    // The host's .gitattributes, committed at the dispatched head, re-encode
    // data.txt as UTF-32 and expand each $Id$ to 47 bytes: a 900,000-byte
    // blob would be written as 3,600,004 or 42,300,004 bytes.
    const limit = 1_000_000;
    const cases = [
      ["UTF-32", "data.txt working-tree-encoding=UTF-32\n", "a".repeat(900_000), 900_000 * 4 + 4],
      ["ident and UTF-32", "data.txt ident working-tree-encoding=UTF-32\n", "$Id$".repeat(225_000), 225_000 * 47 * 4 + 4],
    ];
    for (const [label, rules, content, bound] of cases) {
      const p = project();
      indexCommit(p.worktree, [{ path: ".gitattributes", content: rules }], "host attributes");
      runGit(["reset", "--quiet", "--hard"], p.worktree);
      const prepared = prepare(p);
      writeOut(prepared.workspace, "result.json", result());
      indexCommit(prepared.workspace, [{ path: "data.txt", content }], label);
      const message = assertRefusedUntouched(p, prepared, label, { maxWrittenBytes: limit });
      assert.match(message, new RegExp(`the fast-forward could write up to ${bound} bytes into the claim worktree \\(900000 bytes of blobs, 1 file grown by the host's checkout attributes: ident, line endings or working-tree-encoding\\), over the ${limit}-byte limit`), label);
      assert.equal(existsSync(join(p.worktree, "data.txt")), false, `${label}: nothing was checked out`);
      assert.equal(prepare(p, { runId: "20261106T120001Z-1a2b3c4e" }).ok, true, `${label}: the claim stays preparable`);
    }
  });

  it("imports a file the host's attributes grow within the limit, writing no more than the bound", () => {
    const p = project();
    indexCommit(p.worktree, [{ path: ".gitattributes", content: "*.txt ident working-tree-encoding=UTF-32\n" }], "host attributes");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    const prepared = prepare(p);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    const tip = indexCommit(ws, [{ path: "data.txt", content: "$Id$".repeat(5000) }], "within the bound");
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    const bound = 5000 * 47 * 4 + 4;
    assert.match(collect(p, prepared, { maxWrittenBytes: bound - 1 }).message, new RegExp(`could write up to ${bound} bytes into the claim worktree \\(20000 bytes of blobs, 1 file grown`));
    const collected = collect(p, prepared, { maxWrittenBytes: bound });
    assert.equal(collected.ok, true, collected.message);
    assert.equal(collected.commits.to, tip);
    const written = statSync(join(p.worktree, "data.txt")).size;
    assert.ok(written > 20_000 && written <= bound, `the checkout grew the file within the bound: ${written} bytes`);
    assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], p.worktree), "", "the claim stays clean");
  });

  it("applies the host's other attribute sources and line endings: .git/info/attributes, core.attributesFile, eol=crlf and core.autocrlf", () => {
    const limit = 1_000_000;
    const hostCommits = (p, entries) => { indexCommit(p.worktree, entries, "host attributes"); runGit(["reset", "--quiet", "--hard"], p.worktree); };
    const cases = [
      ["info/attributes ident", (p) => writeFileSync(join(p.root, ".git", "info", "attributes"), "*.txt ident\n"), "data.txt", "$Id$".repeat(225_000), 225_000 * 47],
      ["core.attributesFile UTF-16", (p) => {
        const file = join(temporaryDirectory("attributes-"), "attributes");
        writeFileSync(file, "*.dat working-tree-encoding=UTF-16\n");
        runGit(["config", "core.attributesFile", file], p.root);
      }, "x.dat", "a".repeat(600_000), 600_000 * 2 + 4],
      ["eol=crlf", (p) => hostCommits(p, [{ path: ".gitattributes", content: "*.txt text eol=crlf\n" }]), "data.txt", "\n".repeat(600_000), 1_200_000],
      ["core.autocrlf", (p) => runGit(["config", "core.autocrlf", "true"], p.root), "data.txt", "\n".repeat(600_000), 1_200_000],
    ];
    for (const [label, setUp, file, content, bound] of cases) {
      const p = project();
      setUp(p);
      const prepared = prepare(p);
      assert.equal(prepared.ok, true, `${label}: ${prepared.message}`);
      writeOut(prepared.workspace, "result.json", result());
      indexCommit(prepared.workspace, [{ path: file, content }], label);
      const message = assertRefusedUntouched(p, prepared, label, { maxWrittenBytes: limit });
      assert.match(message, new RegExp(`the fast-forward could write up to ${bound} bytes into the claim worktree \\(${content.length} bytes of blobs, 1 file grown`), label);
      assert.equal(existsSync(join(p.worktree, file)), false, `${label}: nothing was checked out`);
    }

    // A binary file gets no line endings, so the same bytes import within the limit.
    const p = project();
    hostCommits(p, [{ path: ".gitattributes", content: "*.bin -text\n" }]);
    runGit(["config", "core.autocrlf", "true"], p.root);
    const prepared = prepare(p);
    writeOut(prepared.workspace, "result.json", result());
    const tip = indexCommit(prepared.workspace, [{ path: "data.bin", content: "\n".repeat(600_000) }], "binary newlines");
    agentBundle(prepared.workspace, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    const collected = collect(p, prepared, { maxWrittenBytes: limit });
    assert.equal(collected.ok, true, collected.message);
    assert.equal(collected.commits.to, tip);
    assert.equal(statSync(join(p.worktree, "data.bin")).size, 600_000);
  });

  it("refuses a file the host would check out through a configured filter driver, and never runs it", () => {
    if (WINDOWS) return;
    const p = project();
    indexCommit(p.worktree, [{ path: ".gitattributes", content: "*.dat filter=marker\n*.prc filter=proc\n*.req filter=req\n*.raw filter=absent\n" }], "host attributes");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    const markers = temporaryDirectory("filter-");
    const marker = join(markers, "marker");
    const script = join(markers, "filter.sh");
    writeFileSync(script, `#!/bin/sh\necho "$0 $1" >> '${marker}'\ncat\n`);
    chmodSync(script, 0o755);
    runGit(["config", "filter.marker.smudge", script], p.root);
    runGit(["config", "filter.proc.process", script], p.root);
    runGit(["config", "filter.req.required", "true"], p.root);
    const prepared = prepare(p);
    assert.equal(prepared.ok, true, prepared.message);
    const ws = prepared.workspace;
    writeOut(ws, "result.json", result());
    for (const [label, file, driver] of [["a smudge filter", "x.dat", "marker"], ["a long-running process filter", "x.prc", "proc"], ["a required filter", "x.req", "req"]]) {
      agentReset(ws, prepared.dispatchedHead);
      indexCommit(ws, [{ path: file, content: "agent\n" }], label);
      const message = assertRefusedUntouched(p, prepared, label);
      assert.ok(message.includes(`${JSON.stringify(file)} would be checked out through the host's filter driver ${JSON.stringify(driver)} (filter.${driver}.*), which can run an external program; the host checks it out outside the sandbox`), `${label}: ${message}`);
      assert.equal(existsSync(join(p.worktree, file)), false, `${label}: nothing was checked out`);
      assert.equal(existsSync(marker), false, `${label}: the filter never ran`);
    }

    // A filter attribute naming no configured driver changes nothing at checkout.
    agentReset(ws, prepared.dispatchedHead);
    const tip = indexCommit(ws, [{ path: "x.raw", content: "raw\n" }], "no driver");
    agentBundle(ws, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    const collected = collect(p, prepared);
    assert.equal(collected.ok, true, collected.message);
    assert.equal(collected.commits.to, tip);
    assert.equal(readFileSync(join(p.worktree, "x.raw"), "utf8"), "raw\n");
    assert.equal(existsSync(marker), false, "no filter ran");
  });
});

/**
 * One commit of these entries, written straight into the index so no
 * filesystem has to hold their names first — `{ path, content, mode }`, or
 * `{ raw }` bytes for a name that is not UTF-8 — after removing `deleted`.
 */
function rawIndexCommit(repository, entries, deleted = [], message = "raw names") {
  for (const { path, raw, content, mode = "100644" } of entries) {
    const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: repository, env: gitEnv(), input: content }).stdout.toString().trim();
    const line = Buffer.concat([Buffer.from(`${mode} ${blob}\t`), raw ?? Buffer.from(path), Buffer.from("\0")]);
    const added = spawnSync("git", ["update-index", "--add", "-z", "--index-info"], { cwd: repository, env: gitEnv(), input: line });
    assert.equal(added.status, 0, String(added.stderr));
  }
  for (const file of deleted) runGit(["rm", "-q", "--cached", "--", file], repository);
  runGit(["commit", "--quiet", "-m", message], repository);
  return runGit(["rev-parse", "HEAD"], repository).trim();
}

describe("leaving the claim exactly as it was when an import fails", () => {
  /**
   * A claim with a tracked file the import deletes, a directory the host may
   * make read-only, and an ignored directory holding a host file.
   */
  function failingProject() {
    const p = project();
    indexCommit(p.worktree, [
      { path: ".gitignore", content: "/.pathfinder/\n/context/current-ticket.md\n/build/\n" },
      { path: "gone.txt", content: "tracked; the import deletes it\n" },
      { path: "ro/keep.txt", content: "keep\n" },
    ], "host files");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    mkdirSync(join(p.worktree, "build"));
    writeFileSync(join(p.worktree, "build", "cache.o"), "an ignored host file\n");
    return { ...p, head: runGit(["rev-parse", "HEAD"], p.worktree).trim() };
  }

  /** What the claim holds — index entries, and every file Git sees, ignored ones included — to compare after a refusal. */
  const claimState = (worktree) => ({
    index: runGit(["ls-files", "--stage"], worktree),
    files: runGit(["status", "--porcelain", "--ignored", "--untracked-files=all"], worktree),
  });

  /** The import around a failing entry: an added file and directory, a changed and a deleted tracked file, a file in an ignored directory. */
  const around = [
    { path: "a.txt", content: "added\n" },
    { path: "work.txt", content: "CHANGED by the sandbox\n" },
    { path: "nd/x/y.txt", content: "in a new directory\n" },
    { path: "build/new.txt", content: "into an ignored directory\n" },
    { path: "z.txt", content: "added last\n" },
  ];

  function assertClaimAsBefore(p, prepared, refused, before, label) {
    assert.equal(refused.ok, false, `${label}: refused`);
    assert.ok(refused.preserved && existsSync(refused.preserved), `${label}: the bundle is kept for inspection`);
    assert.equal(runGit(["rev-parse", BRANCH], p.worktree).trim(), prepared.dispatchedHead, `${label}: the branch is untouched`);
    assert.equal(runGit(["symbolic-ref", "--short", "HEAD"], p.worktree).trim(), BRANCH, `${label}: still on the branch`);
    assert.deepEqual(claimState(p.worktree), before, `${label}: index, tracked, untracked and ignored files exactly as before`);
    assert.equal(runGit(["status", "--porcelain", "--untracked-files=all"], p.worktree), "", `${label}: clean`);
    assert.equal(readFileSync(join(p.worktree, "work.txt"), "utf8"), "one\n", `${label}: the changed file is the host's again`);
    assert.equal(readFileSync(join(p.worktree, "gone.txt"), "utf8"), "tracked; the import deletes it\n", `${label}: the deleted file is back`);
    assert.equal(readFileSync(join(p.worktree, "build", "cache.o"), "utf8"), "an ignored host file\n", `${label}: the ignored host file is kept`);
    for (const created of ["a.txt", "z.txt", "nd", "build/new.txt"]) assert.equal(existsSync(join(p.worktree, created)), false, `${label}: ${created} is gone`);
    assert.equal(runGit(["for-each-ref", IMPORT_REF_PREFIX], p.root).trim(), "", `${label}: the temporary ref is gone`);
    const again = prepare(p, { runId: "20261106T130000Z-0f0f0f0f" });
    assert.equal(again.ok, true, `${label}: the claim is ready for the next session: ${again.message}`);
    rmSync(again.runDir, { recursive: true, force: true });
  }

  it("refuses before checkout a name no supported filesystem can hold, beside changed and added files", () => {
    assert.match(importPathProblem(`m/${"n".repeat(300)}`), /has a component of 300 bytes, over the 255-byte name limit/);
    assert.equal(importPathProblem(`m/${"n".repeat(255)}`), null, "255 bytes is within the limit");
    assert.match(importPathProblem(`m/${"é".repeat(128)}`), /component of 256 bytes/, "bytes, not characters, are counted");
    assert.match(importPathProblem("bad�.txt"), /is not a valid UTF-8 name/);
    assert.equal(MAX_NAME_BYTES, 255);
    assert.equal(MAX_PATH_BYTES, 1023);
    const cases = [
      ["a 300-byte component", [{ path: `m/${"n".repeat(300)}`, content: "long\n" }], /has a component of 300 bytes, over the 255-byte name limit/],
      ["an invalid UTF-8 name", [{ raw: Buffer.from([0x62, 0x61, 0x64, 0xff, 0x2e, 0x74, 0x78, 0x74]), content: "bad\n" }], /is not a valid UTF-8 name/],
      ["a path past PATH_MAX", [{ path: Array.from({ length: 5 }, (_, index) => `${index}${"d".repeat(229)}`).join("/"), content: "deep\n" }], /would stand at a path of \d+ bytes in the claim worktree, over the 1023-byte path limit/],
    ];
    for (const [label, failing, pattern] of cases) {
      const p = failingProject();
      const before = claimState(p.worktree);
      const prepared = prepare(p);
      rawIndexCommit(prepared.workspace, [...around, ...failing], ["gone.txt"]);
      agentBundle(prepared.workspace, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
      writeOut(prepared.workspace, "result.json", result());
      const refused = collect(p, prepared);
      assert.match(refused.message, pattern, label);
      assert.match(refused.message, /the imported commits are refused: .*; nothing was imported, and the bundle is kept/, label);
      assertClaimAsBefore(p, prepared, refused, before, label);
    }
  });

  it("puts the claim back when the checkout fails partway on the filesystem, and says so", () => {
    // A directory the host made read-only: Git writes every other entry, then fails.
    if (!MODES_BIND) return;
    const p = failingProject();
    const before = claimState(p.worktree);
    const prepared = prepare(p);
    rawIndexCommit(prepared.workspace, [...around, { path: "ro/new.txt", content: "cannot be created\n" }], ["gone.txt"]);
    agentBundle(prepared.workspace, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    writeOut(prepared.workspace, "result.json", result());
    chmodSync(join(p.worktree, "ro"), 0o555);
    let refused;
    try {
      refused = collect(p, prepared);
    } finally {
      chmodSync(join(p.worktree, "ro"), 0o755);
    }
    assert.equal(refused.restored, true, refused.message);
    assert.match(refused.message, /cannot fast-forward .*unable to create file ro\/new\.txt.*; the claim worktree is restored to the dispatched head and clean, every directory the import touches holding exactly the names and files it held \(6 paths the failed checkout created removed, 2 tracked paths it changes or deletes checked out again\); nothing was imported, and the bundle is kept/);
    assertClaimAsBefore(p, prepared, refused, before, "read-only directory");
  });

  /**
   * A host runner whose fast-forward does what Git's does when it fails
   * partway: writes some of the import's entries, removes others, and exits
   * non-zero, leaving the branch and the index alone. `extra` runs after it.
   */
  function failingMerge(worktree, writes, removes, extra = () => {}) {
    return (argv, options = {}) => {
      if (argv.includes("--ff-only")) {
        for (const { path: file, content, mode } of writes) {
          mkdirSync(join(worktree, file, ".."), { recursive: true });
          rmSync(join(worktree, file), { force: true });
          writeFileSync(join(worktree, file), content, { mode: mode === "100755" ? 0o755 : 0o644 });
        }
        for (const file of removes) rmSync(join(worktree, file), { force: true });
        extra();
        return { status: 128, signal: null, stdout: "", stderr: "error: unable to create file m/nnnn: File name too long", error: null };
      }
      return defaultRun(argv, { ...options, env: gitEnv() });
    };
  }

  it("restores with no hook or fsmonitor run, and the host's filtered files last, once their filter's program is the host's again", () => {
    if (WINDOWS) return;
    const p = failingProject();
    const marker = join(temporaryDirectory("programs-"), "marker");
    const smudge = (tag) => ({ path: "scripts/smudge.sh", content: `#!/bin/sh\necho "${tag} smudge" >> '${marker}'\ncat\n`, mode: "100755" });
    indexCommit(p.worktree, [...trackedPrograms(marker, "host"), smudge("host"), { path: ".gitattributes", content: "*.dat filter=up\n" }, { path: "x.dat", content: "filtered data\n" }], "host programs and a filtered file");
    runGit(["config", "filter.up.smudge", "sh scripts/smudge.sh"], p.root);
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    const before = claimState(p.worktree);
    const withConfigHooks = configHooksRun(p.root);
    const prepared = prepare(p);
    const imported = [...trackedPrograms(marker, "IMPORTED"), smudge("IMPORTED")];
    rawIndexCommit(prepared.workspace, [...around, ...imported], ["gone.txt", "x.dat"]);
    agentBundle(prepared.workspace, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    writeOut(prepared.workspace, "result.json", result());
    configurePrograms(p.root, withConfigHooks);
    rmSync(marker, { force: true });
    const run = failingMerge(p.worktree, [...around, ...imported], ["gone.txt", "x.dat"]);
    const refused = collectWorkspace({ root: p.root, key: KEY, runDir: prepared.runDir, worktree: p.worktree, branch: BRANCH, dispatchedHead: prepared.dispatchedHead, allowCommits: true, run });
    const ran = existsSync(marker) ? readFileSync(marker, "utf8") : "";
    assert.equal(refused.restored, true, refused.message);
    assert.match(refused.message, /File name too long; the claim worktree is restored to the dispatched head and clean/);
    assert.equal(ran, "host smudge\n", "only the host's own smudge ran, restoring the filtered file the import deletes; no hook, fsmonitor or imported program");
    assert.equal(readFileSync(join(p.worktree, "x.dat"), "utf8"), "filtered data\n");
    assertClaimAsBefore(p, prepared, refused, before, "simulated partial checkout");
  });

  it("says by name when the claim cannot be proved restored, never that nothing was imported, and removes nothing it did not create", () => {
    if (WINDOWS) return;
    const run = (p, extra, fail) => {
      const prepared = prepare(p);
      rawIndexCommit(prepared.workspace, around, ["gone.txt"]);
      agentBundle(prepared.workspace, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
      writeOut(prepared.workspace, "result.json", result());
      const merge = failingMerge(p.worktree, around, ["gone.txt"], extra);
      const runner = (argv, options) => (fail && argv.includes("checkout-index") ? { status: 1, signal: null, stdout: "", stderr: "fatal: cannot write", error: null } : merge(argv, options));
      return { prepared, refused: collectWorkspace({ root: p.root, key: KEY, runDir: prepared.runDir, worktree: p.worktree, branch: BRANCH, dispatchedHead: prepared.dispatchedHead, allowCommits: true, run: runner }) };
    };

    // Something the import did not create stands in a directory it did.
    const p = failingProject();
    const foreign = join(p.worktree, "nd", "x", "foreign.txt");
    const { prepared, refused } = run(p, () => writeFileSync(foreign, "not the import's\n"));
    assert.equal(refused.ok, false);
    assert.equal(refused.restored, false);
    assert.match(refused.message, /restoring the claim worktree failed: .*\("nd\/x"/);
    assert.match(refused.message, /the claim worktree was NOT restored to the dispatched head [0-9a-f]{40} and may hold the import's files: inspect .* and put it back on the host before the next session; the bundle is kept at /);
    assert.doesNotMatch(refused.message, /nothing was imported/);
    assert.ok(existsSync(refused.preserved), "the bundle is kept");
    assert.equal(readFileSync(foreign, "utf8"), "not the import's\n", "what the import did not create is never removed");
    assert.equal(runGit(["rev-parse", BRANCH], p.worktree).trim(), prepared.dispatchedHead);

    // The tracked files cannot be checked out again.
    const q = failingProject();
    const failed = run(q, () => {}, true).refused;
    assert.equal(failed.restored, false);
    assert.match(failed.message, /cannot check the dispatched head's files out again: fatal: cannot write \("gone\.txt", "work\.txt"\)/);
    assert.doesNotMatch(failed.message, /nothing was imported/);
  });

  /**
   * A claim whose top holds `Docs/` (two tracked files, one a level down),
   * `Readme.txt`, a directory spelled `café` in NFC, and an ignored `.env`
   * beside them, on top of `failingProject`.
   */
  function spelledProject() {
    const p = failingProject();
    indexCommit(p.worktree, [
      { path: ".gitignore", content: "/.pathfinder/\n/context/current-ticket.md\n/build/\n/.env\n" },
      { path: "Docs/a.md", content: "doc\n" },
      { path: "Docs/sub/b.md", content: "deep\n" },
      { path: "Readme.txt", content: "read me\n" },
      { path: "café/c.md", content: "nfc\n" },
    ], "host names");
    runGit(["reset", "--quiet", "--hard"], p.worktree);
    writeFileSync(join(p.worktree, ".env"), "SECRET=host\n");
    return { ...p, head: runGit(["rev-parse", "HEAD"], p.worktree).trim() };
  }

  /** Every entry under `dir`, `.git` aside, by the exact name readdir returns: kind, permission bits, link target or content. */
  function exactTree(dir, rel = "", out = {}) {
    for (const name of readdirSync(rel ? join(dir, rel) : dir).sort()) {
      const file = rel ? `${rel}/${name}` : name;
      if (file === ".git") continue;
      const stats = lstatSync(join(dir, file));
      if (stats.isDirectory()) {
        out[file] = `directory ${(stats.mode & 0o7777).toString(8)}`;
        exactTree(dir, file, out);
      } else if (stats.isSymbolicLink()) out[file] = `link ${readlinkSync(join(dir, file))}`;
      else out[file] = `file ${(stats.mode & 0o7777).toString(8)} ${readFileSync(join(dir, file), "base64")}`;
    }
    return out;
  }

  /** Whether the volume the fixtures live on resolves one spelling of a name to an entry spelled `other`ly. */
  function folds(spelling, other) {
    const probe = temporaryDirectory("fold-probe-");
    mkdirSync(join(probe, spelling));
    return existsSync(join(probe, other)) && !readdirSync(probe).includes(other);
  }
  const FOLDS_CASE = folds("CaseProbe", "caseprobe");
  const FOLDS_NORMALIZATION = folds("café", "café");
  const CASE_SENSITIVE = "the volume is case-sensitive: there Docs/ and docs/ are two paths, a case-only rename is an ordinary delete and add, and no lookup finds one through the other";
  const NORMALIZATION_SENSITIVE = "the volume does not fold Unicode normalization: there the NFC and NFD spellings are two names, and no lookup finds one through the other";

  /** The renames that make `Docs/` the import's `docs/`, with the same bytes. */
  const caseRename = [{ path: "docs/a.md", content: "doc\n" }, { path: "docs/sub/b.md", content: "deep\n" }];
  const caseDeleted = ["Docs/a.md", "Docs/sub/b.md"];

  function assertExactlyAsBefore(p, prepared, before, label) {
    assert.deepEqual(exactTree(p.worktree), before, `${label}: every name, byte for byte, and every kind, mode, link and file exactly as before`);
    assert.equal(runGit(["rev-parse", BRANCH], p.worktree).trim(), prepared.dispatchedHead, `${label}: the branch is untouched`);
    assert.equal(runGit(["symbolic-ref", "--short", "HEAD"], p.worktree).trim(), BRANCH, `${label}: still on the branch`);
    assert.equal(runGit(["diff-index", "--cached", "--name-only", prepared.dispatchedHead], p.worktree), "", `${label}: the index is the dispatched head's`);
    assert.equal(runGit(["-c", "core.ignorecase=false", "status", "--porcelain", "--untracked-files=all"], p.worktree), "", `${label}: clean, read case-sensitively too`);
    assert.equal(runGit(["for-each-ref", IMPORT_REF_PREFIX], p.root).trim(), "", `${label}: the temporary ref is gone`);
    const again = prepare(p, { runId: "20261106T130000Z-0f0f0f0f" });
    assert.equal(again.ok, true, `${label}: the claim is ready for the next session: ${again.message}`);
    rmSync(again.runDir, { recursive: true, force: true });
  }

  it("refuses before checkout a symlink target no supported host can create, so a case-only directory rename beside it never reaches the claim", () => {
    // The Tester's combined case: on its own, the sandbox could fail the
    // checkout partway after Git had already removed Docs/ and created docs/.
    const p = spelledProject();
    const before = exactTree(p.worktree);
    const prepared = prepare(p);
    rawIndexCommit(prepared.workspace, [...caseRename, { path: "a.txt", content: "added\n" }, { path: "zz/link", content: `${"./".repeat(560)}README.md`, mode: "120000" }], caseDeleted);
    agentBundle(prepared.workspace, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    writeOut(prepared.workspace, "result.json", result());
    const refused = collect(p, prepared);
    assert.equal(refused.ok, false);
    assertExactlyAsBefore(p, prepared, before, "over-long link target");
    assert.match(refused.message, /symlink "zz\/link" has a target of 1129 bytes, over the 1023-byte limit macOS's symlink\(2\) accepts; the checkout would fail partway; nothing was imported, and the bundle is kept/);
    assert.equal(refused.restored, undefined, "refused before checkout: there was nothing to restore");
    assert.ok(existsSync(refused.preserved), "the bundle is kept for inspection");
  });

  it("gives a directory a failed checkout renamed by case back its own spelling, and proves every name, byte for byte", (t) => {
    if (!MODES_BIND) { t.skip("file modes do not bind here (Windows or root), so a read-only directory cannot fail the checkout"); return; }
    if (!FOLDS_CASE) { t.skip(CASE_SENSITIVE); return; }
    const p = spelledProject();
    const before = exactTree(p.worktree);
    const ignored = statSync(join(p.worktree, ".env")).ino;
    const prepared = prepare(p);
    rawIndexCommit(prepared.workspace, [...caseRename, { path: "README.TXT", content: "read me\n" }, { path: "work.txt", content: "CHANGED\n" }, { path: "ro/new.txt", content: "cannot be created\n" }], [...caseDeleted, "Readme.txt", "gone.txt"]);
    agentBundle(prepared.workspace, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    writeOut(prepared.workspace, "result.json", result());
    chmodSync(join(p.worktree, "ro"), 0o555);
    let refused;
    try {
      refused = collect(p, prepared);
    } finally {
      chmodSync(join(p.worktree, "ro"), 0o755);
    }
    assert.equal(refused.restored, true, refused.message);
    assertExactlyAsBefore(p, prepared, before, "case-only rename");
    assert.ok(readdirSync(p.worktree).includes("Docs") && !readdirSync(p.worktree).includes("docs"), "the top lists Docs, as the index names it");
    assert.equal(statSync(join(p.worktree, ".env")).ino, ignored, "the ignored host file beside it is the very same file");
    assert.match(refused.message, /unable to create file ro\/new\.txt.*; the claim worktree is restored to the dispatched head and clean, every directory the import touches holding exactly the names and files it held \(\d+ paths? the failed checkout created removed, \d+ tracked paths it changes or deletes checked out again, 1 name it respelled given back its own spelling\); nothing was imported, and the bundle is kept/);
  });

  it("gives a directory back its Unicode normalization too, whatever made the checkout fail", (t) => {
    if (WINDOWS) { t.skip("Windows does not fold Unicode normalization"); return; }
    if (!FOLDS_NORMALIZATION) { t.skip(NORMALIZATION_SENSITIVE); return; }
    const p = spelledProject();
    const before = exactTree(p.worktree);
    const prepared = prepare(p);
    runGit(["config", "core.precomposeUnicode", "false"], prepared.workspace);
    rawIndexCommit(prepared.workspace, [{ path: "café/c.md", content: "nfc\n" }], ["café/c.md"]);
    agentBundle(prepared.workspace, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    writeOut(prepared.workspace, "result.json", result());
    // A fast-forward that fails after it re-created the directory under the import's NFD spelling.
    const run = (argv, options = {}) => {
      if (!argv.includes("--ff-only")) return defaultRun(argv, { ...options, env: gitEnv() });
      renameSync(join(p.worktree, "café"), join(p.worktree, "café"));
      return { status: 128, signal: null, stdout: "", stderr: "error: unable to create file: No space left on device", error: null };
    };
    const refused = collectWorkspace({ root: p.root, key: KEY, runDir: prepared.runDir, worktree: p.worktree, branch: BRANCH, dispatchedHead: prepared.dispatchedHead, allowCommits: true, run });
    assert.equal(refused.restored, true, refused.message);
    assertExactlyAsBefore(p, prepared, before, "NFD rename");
    assert.ok(readdirSync(p.worktree).includes("café"), "the top lists the NFC spelling again");
    assert.match(refused.message, /1 name it respelled given back its own spelling\); nothing was imported/);
  });

  it("says restored: false, naming the entry, when it cannot give a directory back its spelling, and never that nothing was imported", (t) => {
    if (!MODES_BIND) { t.skip("file modes do not bind here (Windows or root), so the top cannot be made read-only"); return; }
    if (!FOLDS_CASE) { t.skip(CASE_SENSITIVE); return; }
    const p = spelledProject();
    const prepared = prepare(p);
    rawIndexCommit(prepared.workspace, caseRename, caseDeleted);
    agentBundle(prepared.workspace, [`${prepared.dispatchedHead}..refs/heads/${BRANCH}`]);
    writeOut(prepared.workspace, "result.json", result());
    // A fast-forward that respells Docs/ and fails, leaving a top that may no longer be written.
    const run = (argv, options = {}) => {
      if (!argv.includes("--ff-only")) return defaultRun(argv, { ...options, env: gitEnv() });
      renameSync(join(p.worktree, "Docs"), join(p.worktree, "docs"));
      chmodSync(p.worktree, 0o555);
      return { status: 128, signal: null, stdout: "", stderr: "error: unable to create file: Input/output error", error: null };
    };
    let refused;
    try {
      refused = collectWorkspace({ root: p.root, key: KEY, runDir: prepared.runDir, worktree: p.worktree, branch: BRANCH, dispatchedHead: prepared.dispatchedHead, allowCommits: true, run });
    } finally {
      chmodSync(p.worktree, 0o755);
    }
    assert.equal(refused.ok, false);
    assert.equal(refused.restored, false, refused.message);
    assert.match(refused.message, /restoring the claim worktree failed: these do not stand exactly as before the import: "Docs" is spelled "docs" on disk; the claim worktree was NOT restored to the dispatched head [0-9a-f]{40} and may hold the import's files: inspect .* and put it back on the host before the next session; the bundle is kept at /);
    assert.doesNotMatch(refused.message, /nothing was imported/);
    assert.ok(existsSync(refused.preserved), "the bundle is kept");
    assert.equal(readFileSync(join(p.worktree, ".env"), "utf8"), "SECRET=host\n", "the ignored host file is never removed");
    assert.equal(readFileSync(join(p.worktree, "docs", "a.md"), "utf8"), "doc\n", "the tracked file is the host's, under the spelling it could not give back");
  });
});
