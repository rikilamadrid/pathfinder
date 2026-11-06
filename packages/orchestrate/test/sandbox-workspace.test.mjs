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
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, realpathSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";

import { cleanUpTemporaryDirectories, ENGINE_ROOT, gitEnv, runGit, temporaryDirectory } from "../lib/harness.mjs";

const {
  bundleCommand, bundleOutcome, collectWorkspace, defaultRun, IMPORT_REF_PREFIX, importPathProblem, inputPathProblem,
  PROTECTED_PATHS, prepareWorkspace, symlinkProblem,
} = await import(pathToFileURL(join(ENGINE_ROOT, "sandbox-workspace.mjs")));

after(cleanUpTemporaryDirectories);

const WINDOWS = process.platform === "win32";
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
    assert.equal(command.argv[0], "git");
    assert.equal(command.bundle, join(prepared.workspace, ".pathfinder-sandbox", "out", "branch.bundle"));
    const outcome = bundleOutcome(defaultRun(command.argv, { env: gitEnv() }));
    assert.deepEqual(outcome, { ok: true, bundle: false, message: "no commits" });
    assert.equal(existsSync(command.bundle), false);

    assert.equal(bundleOutcome({ status: 128, signal: null, stdout: "", stderr: "fatal: something else", error: null }).ok, false);
    assert.match(bundleCommand({ workspace: "/a:b", branch: BRANCH, dispatchedHead: p.head }).message, /contains ":"/);
    assert.equal(bundleCommand({ workspace: prepared.workspace, branch: BRANCH, dispatchedHead: "HEAD" }).ok, false);
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

describe("treating sandbox output as untrusted", () => {
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
    for (const bad of ["a/.git/config", ".Git", "x/.GIT./y", "a/../b", ".gitignore", ".GitHub/x", ".claude/settings.json", ".codex/x", ".agents/x", ".pathfinder/x", "context/tracker.md"]) {
      assert.ok(importPathProblem(bad), bad);
    }
    for (const good of ["src/a.js", "context/history.md", "docs/.github-notes.md", "a/.gitkeep", "sub/.gitignore"]) assert.equal(importPathProblem(good), null, good);
    assert.ok(symlinkProblem("a", "/abs"));
    assert.ok(symlinkProblem("a", "C:\\x"));
    assert.ok(symlinkProblem("a/b", "../../x"));
    assert.ok(symlinkProblem("a", ".git/config"));
    assert.equal(symlinkProblem("a/b", "../c"), null);
  });
});

