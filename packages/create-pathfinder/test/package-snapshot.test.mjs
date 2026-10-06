/** Actual offline tarballs from a committed kit, with local contamination. */
import { strict as assert } from "node:assert";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { COPY_LIST, neverShips } from "../src/kit.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PACKAGE = "packages/create-pathfinder";
const SCRIPT = `${PACKAGE}/scripts/package-snapshot.mjs`;
const temps = [];
function temporary() {
  const dir = mkdtempSync(join(tmpdir(), "pathfinder-snapshot-test-"));
  temps.push(dir);
  return dir;
}
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function write(root, path, contents) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), contents);
}
function fixture() {
  const root = temporary();
  const archive = execFileSync("git", ["archive", "HEAD"], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
  execFileSync("tar", ["-xf", "-", "-C", root], { input: archive });
  // Exercise this working implementation even before it has been committed.
  for (const file of [SCRIPT, `${PACKAGE}/scripts/publish-guard.mjs`]) cpSync(join(ROOT, file), join(root, file));
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "-m", "committed kit");
  return root;
}
function run(root, args, extraEnv = {}) {
  const temp = temporary();
  const result = spawnSync(process.execPath, [join(root, SCRIPT), ...args], {
    cwd: root, encoding: "utf8", timeout: 60000,
    env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp,
      npm_config_cache: join(temporary(), "cache"), npm_config_offline: "true", ...extraEnv },
  });
  assert.deepEqual(readdirSync(temp).filter((name) => name.startsWith("pathfinder-package-")), [], "snapshot must be removed on success or failure");
  return { ...result, out: `${result.stdout}\n${result.stderr}` };
}
function packedBytes(dir) {
  const files = readdirSync(dir).filter((name) => name.endsWith(".tgz"));
  assert.equal(files.length, 1);
  return readFileSync(join(dir, files[0]));
}
function tarFiles(bytes) {
  return execFileSync("tar", ["-tzf", "-"], { input: bytes, encoding: "utf8" }).trim().split("\n");
}

function fakePublish(root) {
  const bin = temporary();
  const evidence = join(temporary(), "evidence.json");
  // Never execute npm publish. Inspect the snapshot and run its real guard only.
  write(bin, "npm", `#!/usr/bin/env node
const {execFileSync}=require('node:child_process');
const {readFileSync,writeFileSync}=require('node:fs');
if(process.argv[2]!=='publish') process.exit(90);
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
writeFileSync(process.env.SNAPSHOT_EVIDENCE,JSON.stringify({
  cwd:process.cwd(),head:git('rev-parse','HEAD'),
  version:JSON.parse(readFileSync('package.json','utf8')).version,
  dirty:git('status','--porcelain'),args:process.argv.slice(2)
}));
try{execFileSync(process.execPath,['scripts/publish-guard.mjs'],{stdio:'inherit'});}
catch{process.exit(1);}
`);
  execFileSync("chmod", ["+x", join(bin, "npm")]);
  return { evidence, env: { PATH: `${bin}:${process.env.PATH}`, SNAPSHOT_EVIDENCE: evidence, PATHFINDER_PUBLISH: "yes" } };
}

describe("committed snapshot packaging", () => {
  let root;
  before(() => { root = fixture(); });

  it("packs identical bytes with all four contamination paths, preserving every legitimate file", () => {
    const commit = git(root, "rev-parse", "HEAD");
    const cleanOutput = temporary();
    let result = run(root, ["pack", commit, cleanOutput]);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, new RegExp(`pack commit ${commit}`));
    const baseline = packedBytes(cleanOutput);
    const paths = ["context/local-note.md", "skills/private/ignored.md",
      `${PACKAGE}/src/local-module.mjs`, `${PACKAGE}/README.private.md`];
    for (const path of paths) write(root, path, "not part of the commit\n");
    write(root, ".git/info/exclude", "skills/private/\n");
    assert.equal(git(root, "check-ignore", "skills/private/ignored.md"), "skills/private/ignored.md");
    // Even tracked edits and staged additions are not part of this commit.
    write(root, "context/ai-interaction.md", "local tracked edit\n");
    write(root, "templates/staged-only.md", "not committed\n");
    git(root, "add", "templates/staged-only.md");
    // An ignored nested npm ignore file must not remove legitimate runtime files.
    write(root, `${PACKAGE}/src/.npmignore`, "*\n");
    const status = git(root, "status", "--porcelain", "--untracked-files=all");
    const contaminatedOutput = temporary();
    result = run(root, ["pack", commit, contaminatedOutput]);
    assert.equal(result.status, 0, result.out);
    const contaminated = packedBytes(contaminatedOutput);
    assert.equal(createHash("sha512").update(contaminated).digest("hex"),
                 createHash("sha512").update(baseline).digest("hex"));
    assert.deepEqual(contaminated, baseline, "the entire tgz is byte-identical");
    assert.equal(git(root, "status", "--porcelain", "--untracked-files=all"), status);
    assert.equal(readFileSync(join(root, "context/ai-interaction.md"), "utf8"), "local tracked edit\n");
    for (const path of paths) assert.equal(readFileSync(join(root, path), "utf8"), "not part of the commit\n");
    const contents = new Set(tarFiles(contaminated));
    const tracked = git(root, "ls-tree", "-r", "--name-only", commit).split("\n");
    for (const path of tracked.filter((path) => COPY_LIST.some((entry) => path === entry || path.startsWith(`${entry}/`)))) {
      assert.equal(contents.has(`package/${path}`), !neverShips(path), path);
    }
    for (const path of paths) assert.equal(contents.has(`package/${path.replace(`${PACKAGE}/`, "")}`), false, path);
    for (const path of ["context/tracker.md", "context/current-ticket.md", "context/current-feature.md", "context/handoff.md", "context/history.md", "context/execution-mode.md", "context/improvement-ledger.md"])
      assert.equal(contents.has(`package/${path}`), false, path);
    for (const entry of COPY_LIST) assert.equal(existsSync(join(root, PACKAGE, entry)), false, "no source staging");
    // Compare a pristine direct npm pack of the same fixture's committed tree.
    const pristine = temporary();
    execFileSync("tar", ["-xf", "-", "-C", pristine], { input: execFileSync("git", ["archive", commit], { cwd: root, maxBuffer: 32 * 1024 * 1024 }) });
    const direct = temporary();
    execFileSync("npm", ["pack", "--offline", "--pack-destination", direct, "--cache", join(temporary(), "cache")], { cwd: join(pristine, PACKAGE), stdio: "pipe" });
    assert.deepEqual(packedBytes(direct), baseline, "legitimate package bytes are unchanged");
    const installed = temporary();
    execFileSync("tar", ["-xzf", "-", "-C", installed], { input: baseline });
    const target = temporary();
    git(target, "init", "--quiet");
    const install = spawnSync(process.execPath, [join(installed, "package/bin/create-pathfinder.mjs"), "--yes", "--no-git-init"], { cwd: target, encoding: "utf8" });
    assert.equal(install.status, 0, install.stderr);
    assert.equal(readFileSync(join(target, "context/ai-interaction.md"), "utf8"),
                 git(root, "show", `${commit}:context/ai-interaction.md`) + "\n");
    assert.equal(existsSync(join(target, "context/history.md")), false);
  });

  it("keeps the selected commit, version, and mainline context for publishing despite source edits", () => {
    const commit = git(root, "rev-parse", "HEAD");
    const fake = fakePublish(root);
    const result = run(root, ["publish", commit], fake.env);
    assert.equal(result.status, 0, result.out);
    const evidence = JSON.parse(readFileSync(fake.evidence, "utf8"));
    assert.equal(evidence.head, commit);
    assert.equal(evidence.version, JSON.parse(git(root, "show", `${commit}:${PACKAGE}/package.json`)).version);
    assert.equal(evidence.dirty, "");
    assert.deepEqual(evidence.args, ["publish", "--ignore-scripts=false"]);
    assert.notEqual(evidence.cwd, join(root, PACKAGE));
    assert.equal(existsSync(evidence.cwd), false);
  });

  it("refuses publication without explicit intent before invoking npm", () => {
    const fake = fakePublish(root);
    const result = run(root, ["publish", "HEAD"], { ...fake.env, PATHFINDER_PUBLISH: "" });
    assert.equal(result.status, 1);
    assert.match(result.out, /explicit PATHFINDER_PUBLISH=yes/);
    assert.equal(existsSync(fake.evidence), false);
  });

  it("cleans up on lifecycle failure and preserves the existing tag mismatch guard", () => {
    const bad = fixture();
    git(bad, "tag", "-a", "v0.0.1", "-m", "wrong version");
    const fake = fakePublish(bad);
    const result = run(bad, ["publish", "HEAD"], fake.env);
    assert.equal(result.status, 1);
    assert.match(result.out, /tagged v0.0.1/);
    assert.equal(existsSync(JSON.parse(readFileSync(fake.evidence, "utf8")).cwd), false);
  });

  it("pins an older selected commit from a linked worktree and ignores Git cwd overrides", () => {
    const source = fixture();
    const commit = git(source, "rev-parse", "HEAD");
    write(source, "later.md", "main moved after the selected commit\n");
    git(source, "add", "later.md");
    git(source, "commit", "--quiet", "-m", "later commit");
    const linked = join(temporary(), "linked");
    git(source, "worktree", "add", "--quiet", "--detach", linked, "HEAD");
    const fake = fakePublish(linked);
    const result = run(linked, ["publish", commit], {
      ...fake.env, GIT_DIR: "/nonexistent-ambient-git-dir", GIT_WORK_TREE: "/nonexistent-worktree",
    });
    assert.equal(result.status, 0, result.out);
    assert.equal(JSON.parse(readFileSync(fake.evidence, "utf8")).head, commit);
    assert.equal(git(linked, "status", "--porcelain"), "");
  });

  it("preserves origin/main preference and refuses an unmerged selected commit", () => {
    const source = fixture();
    const mainline = git(source, "rev-parse", "HEAD");
    git(source, "update-ref", "refs/remotes/origin/main", mainline);
    write(source, "unmerged.md", "not on origin/main\n");
    git(source, "add", "unmerged.md");
    git(source, "commit", "--quiet", "-m", "not on remote main");
    const fake = fakePublish(source);
    const result = run(source, ["publish", "HEAD"], fake.env);
    assert.equal(result.status, 1);
    assert.match(result.out, /not contained in origin\/main/);
  });

  it("removes the snapshot when the real npm prepack fails", () => {
    const source = fixture();
    git(source, "rm", "--quiet", "AGENTS.md");
    git(source, "commit", "--quiet", "-m", "incomplete kit");
    const result = run(source, ["pack", "HEAD", temporary()]);
    assert.equal(result.status, 1);
    assert.match(result.out, /missing AGENTS.md/);
    assert.equal(git(source, "status", "--porcelain"), "");
  });

  it("forwards parent-only cancellation to npm and removes the snapshot before exiting", async () => {
    const bin = temporary();
    const evidence = temporary();
    const temp = temporary();
    write(bin, "npm", `#!/usr/bin/env node
const {writeFileSync}=require('node:fs');
writeFileSync(process.env.SIGNAL_CWD,process.cwd());
console.log('snapshot-child-ready');
setTimeout(()=>{writeFileSync(process.env.SIGNAL_COMPLETED,'unexpected completion');process.exit(0);},3000);
`);
    execFileSync("chmod", ["+x", join(bin, "npm")]);
    for (const signal of ["SIGTERM", "SIGINT"]) {
      const cwdFile = join(evidence, signal + '-cwd');
      const completed = join(evidence, signal + '-completed');
      const processUnderTest = spawn(process.execPath, [join(root, SCRIPT), "pack", "HEAD", temporary()], {
        cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
          TMPDIR: temp, TMP: temp, TEMP: temp, SIGNAL_CWD: cwdFile, SIGNAL_COMPLETED: completed },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = '';
      let sent = false;
      processUnderTest.stdout.on('data', (data) => {
        output += data;
        if (!sent && output.includes('snapshot-child-ready')) {
          sent = true;
          processUnderTest.kill(signal);
        }
      });
      processUnderTest.stderr.on('data', (data) => { output += data; });
      const code = await new Promise((resolveExit, rejectExit) => {
        processUnderTest.on('error', rejectExit);
        processUnderTest.on('exit', resolveExit);
      });
      assert.equal(sent, true, output);
      assert.equal(code, signal === 'SIGTERM' ? 143 : 130, output);
      assert.equal(existsSync(completed), false, 'npm must not complete after cancellation');
      assert.equal(existsSync(readFileSync(cwdFile, 'utf8')), false);
      assert.deepEqual(readdirSync(temp).filter((name) => name.startsWith('pathfinder-package-')), []);
    }
  });

  it("refuses invalid revisions and invalid arguments without source changes", () => {
    const before = git(root, "status", "--porcelain");
    for (const args of [["pack", "not-a-ref", temporary()], ["publish"], ["pack", "HEAD"], ["publish", "HEAD", "extra"]]) {
      const result = run(root, args);
      assert.equal(result.status, 1, result.out);
    }
    assert.equal(git(root, "status", "--porcelain"), before);
  });
});
