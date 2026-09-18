import { strict as assert } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { cleanUpTemporaryDirectories, makeProject, orchestrate, json, runGit } from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);
function project() { return makeProject({ tickets: { "1.1": { title: "Alpha" }, "1.2": { title: "Beta" } } }); }
function call(root, ...args) {
  const result = orchestrate(args, { root });
  assert.equal(result.status, 0, result.stderr);
  return result;
}
function worker(root, key) { return json(call(root, "claim", key, "--json")); }
function edit(root, path, text) {
  writeFileSync(join(root, path), text);
  runGit(["add", path], root);
  runGit(["commit", "-qm", `change ${path}`], root);
}
function done(root, key) { call(root, "state", key, "--set", "done", "--last", "review PASS"); }
function check(root, key) { return json(call(root, "check", key, "--json")); }
function path(root, key) { return join(root, ".pathfinder", "worktrees", key); }

describe("integration evidence from real Git branches", () => {
  it("a clean done branch is candidate, in check and the status row, without dirtying main", () => {
    const root = project(); worker(root, "1.1");
    edit(path(root, "1.1"), "alpha.txt", "alpha\n"); done(root, "1.1");
    const result = check(root, "1.1");
    assert.equal(result.result, "candidate");
    assert.equal(result.behind, false);
    assert.equal(result.baseHead, runGit(["rev-parse", "main"], root).trim());
    assert.deepEqual(result.conflicts, []);
    assert.equal(json(call(root, "status", "--json")).rows[0].check.result, "candidate");
    assert.match(call(root, "status").stdout, /candidate/);
    assert.equal(runGit(["status", "--porcelain"], root), "");
  });

  it("overlap is advisory until one branch lands and the other conflicts", () => {
    const root = project(); const a = worker(root, "1.1"); worker(root, "1.2");
    edit(path(root, "1.1"), "README.md", "alpha\n");
    edit(path(root, "1.2"), "README.md", "beta\n");
    done(root, "1.1"); done(root, "1.2");
    const before = check(root, "1.2");
    assert.equal(before.result, "candidate");
    assert.deepEqual(before.overlaps, [{ branch: a.branch, paths: ["README.md"], advisory: true }]);
    runGit(["merge", "--squash", a.branch], root); runGit(["commit", "-qm", "land alpha"], root);
    const after = check(root, "1.2");
    assert.equal(after.result, "conflict");
    assert.deepEqual(after.conflicts, ["README.md"]);
    assert.equal(after.behind, true);
    assert.deepEqual(after.overlaps, [], "squash-integrated branches are no longer in flight");
    assert.equal(runGit(["status", "--porcelain"], root), "");
  });

  it("a nonconflicting branch left behind becomes candidate after rebase and revalidation", () => {
    const root = project(); worker(root, "1.1");
    edit(path(root, "1.1"), "alpha.txt", "alpha\n"); done(root, "1.1");
    edit(root, "other.txt", "main advanced\n");
    assert.equal(check(root, "1.1").result, "behind");
    runGit(["rebase", "main"], path(root, "1.1")); done(root, "1.1");
    assert.equal(check(root, "1.1").result, "candidate");
    assert.equal(runGit(["status", "--porcelain"], root), "");
  });

  it("preserves unusual conflicted path names", () => {
    const root = project(); const filename = 'space and\nnewline.txt';
    edit(root, filename, "original\n"); worker(root, "1.1");
    edit(path(root, "1.1"), filename, "worker\n"); done(root, "1.1");
    edit(root, filename, "main\n");
    assert.deepEqual(check(root, "1.1").conflicts, [filename]);
  });

  it("refuses a dirty done claim and a worktree switched off its ticket branch", () => {
    const root = project(); worker(root, "1.1"); done(root, "1.1");
    writeFileSync(join(path(root, "1.1"), "README.md"), "uncommitted");
    assert.match(orchestrate(["check", "1.1"], { root }).stderr, /dirty/);
    runGit(["checkout", "-b", "unrelated"], path(root, "1.1"));
    for (const command of ["check", "release"]) {
      const result = orchestrate([command, "1.1"], { root });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /not on its ticket branch/);
    }
  });

  it("refuses working, gated, orphan and unknown claims", () => {
    const root = project(); worker(root, "1.1");
    assert.equal(orchestrate(["check", "1.1"], { root }).status, 1);
    call(root, "state", "1.1", "--set", "human-gate", "--gate", "Needs human");
    assert.equal(orchestrate(["check", "1.1"], { root }).status, 1);
    runGit(["branch", "ticket/1.2-orphan"], root);
    assert.equal(orchestrate(["check", "1.2"], { root }).status, 1);
    assert.equal(orchestrate(["check", "9.9"], { root }).status, 1);
  });
});

describe("claim release", () => {
  it("refuses unmerged work and preserves worktree, branch and claim ref", () => {
    const root = project(); const claim = worker(root, "1.1");
    edit(path(root, "1.1"), "alpha.txt", "alpha\n"); done(root, "1.1");
    const result = orchestrate(["release", "1.1"], { root });
    assert.equal(result.status, 1); assert.match(result.stderr, /not proven merged/);
    assert.ok(existsSync(path(root, "1.1")));
    runGit(["rev-parse", claim.branch, "refs/pathfinder/claims/1.1"], root);
  });

  for (const squash of [false, true]) {
    it(`releases after ${squash ? "squash" : "ancestry"} inclusion without touching main`, () => {
      const root = project(); const claim = worker(root, "1.1");
      edit(path(root, "1.1"), "alpha.txt", "alpha\n"); done(root, "1.1");
      runGit(["merge", ...(squash ? ["--squash"] : ["--ff-only"]), claim.branch], root);
      if (squash) runGit(["commit", "-qm", "squash"], root);
      edit(root, "later.txt", "later unrelated work\n");
      const result = json(call(root, "release", "1.1", "--json"));
      assert.equal(result.merged, true); assert.equal(result.forced, false);
      assert.ok(!existsSync(path(root, "1.1")));
      assert.equal(json(call(root, "owner", "1.1", "--json")).claim, null);
      assert.equal(runGit(["status", "--porcelain"], root), "");
    });
  }

  it("refuses dirty work even when the committed branch is merged", () => {
    const root = project(); worker(root, "1.1");
    writeFileSync(join(path(root, "1.1"), "uncommitted.txt"), "keep me");
    const result = orchestrate(["release", "1.1"], { root });
    assert.equal(result.status, 1); assert.match(result.stderr, /uncommitted work/);
    assert.ok(existsSync(path(root, "1.1")));
  });

  it("refuses --force without explicit approval and supports intentional disposal", () => {
    const root = project(); worker(root, "1.1");
    edit(path(root, "1.1"), "alpha.txt", "alpha\n");
    assert.equal(orchestrate(["release", "1.1", "--force"], { root }).status, 1);
    const result = json(call(root, "release", "1.1", "--force", "--approval", "human explicitly cancelled and authorised discarding this work", "--json"));
    assert.equal(result.forced, true); assert.equal(result.merged, false);
    assert.equal(json(call(root, "owner", "1.1", "--json")).claim, null);
  });

  it("preserves interrupted claim refs unless the human explicitly releases them", () => {
    const root = project();
    runGit(["update-ref", "refs/pathfinder/claims/1.1", "HEAD"], root);
    assert.equal(orchestrate(["release", "1.1"], { root }).status, 1);
    assert.equal(json(call(root, "owner", "1.1", "--json")).claim.orphan, true);
    call(root, "release", "1.1", "--force", "--approval", "discard interrupted claim ref");
    assert.equal(json(call(root, "owner", "1.1", "--json")).claim, null);
    assert.equal(runGit(["status", "--porcelain"], root), "");
  });

  it("releases a merged orphan branch and retains an unmerged orphan", () => {
    const root = project();
    runGit(["branch", "ticket/1.1-orphan"], root);
    call(root, "release", "1.1");
    assert.equal(json(call(root, "owner", "1.1", "--json")).claim, null);
    const claim = worker(root, "1.1");
    edit(path(root, "1.1"), "alpha.txt", "keep this commit\n");
    runGit(["worktree", "remove", path(root, "1.1")], root);
    assert.equal(orchestrate(["release", "1.1"], { root }).status, 1);
    assert.equal(json(call(root, "owner", "1.1", "--json")).claim.branch, claim.branch);
    runGit(["rev-parse", "refs/pathfinder/claims/1.1"], root);
  });

  it("refuses check and release outside orchestrator mode", () => {
    const root = project(); worker(root, "1.1"); done(root, "1.1");
    writeFileSync(join(root, "context", "execution-mode.md"), "<!-- pathfinder:execution-mode human-in-the-loop -->\n");
    for (const command of ["check", "release"]) {
      assert.equal(orchestrate([command, "1.1"], { root }).status, 1);
    }
  });
});

describe("recovery and integration briefs", () => {
  it("a fresh run preserves State, Updated and Next and resume uses the original execution unit", () => {
    const root = project(); const claim = worker(root, "1.1");
    edit(path(root, "1.1"), "partial.txt", "completed increment\n");
    call(root, "state", "1.1", "--set", "working", "--next", "verify completed increment", "--now", "2026-09-17T12:00:00Z");
    const statePath = join(path(root, "1.1"), "context", "current-ticket.md");
    const before = readFileSync(statePath, "utf8");
    const row = json(call(root, "status", "--json")).rows[0];
    assert.equal(row.state, "stale"); assert.equal(row.recordedState, "working");
    assert.equal(row.updated, "2026-09-17T12:00:00Z"); assert.equal(row.next, "verify completed increment");
    assert.equal(orchestrate(["claim", "1.1"], { root }).status, 1);
    const resumed = json(call(root, "brief", "1.1", "--harness", "codex", "--session", "resume", "--json"));
    assert.equal(resumed.brief.branch, claim.branch);
    assert.equal(resumed.brief.model, claim.profile.selection.model);
    assert.match(resumed.translation.invocation.arguments.message, /Continue from its Next line/);
    assert.equal(readFileSync(statePath, "utf8"), before);
    assert.ok(readFileSync(join(path(root, "1.1"), "partial.txt"), "utf8").includes("completed"));
  });

  for (const session of ["rebase-and-reverify", "resolve-conflict"]) {
    it(`${session} uses the existing profile and returns work to developer`, () => {
      const root = project(); const claim = worker(root, "1.1"); done(root, "1.1");
      const result = json(call(root, "brief", "1.1", "--harness", "codex", "--session", session, "--json"));
      assert.equal(result.brief.session, session);
      assert.equal(result.brief.branch, claim.branch);
      assert.equal(result.brief.role, "developer");
      assert.equal(result.brief.model, "inherited"); assert.equal(result.brief.effort, "inherited");
      assert.match(result.translation.invocation.arguments.message, /Verification/);
      assert.match(result.translation.invocation.arguments.message, /Never merge/);
      assert.match(result.translation.invocation.arguments.message, /independent review/);
    });
  }
});
