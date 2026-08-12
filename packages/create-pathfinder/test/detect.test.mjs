/**
 * `detect()` against synthesized filesystems.
 *
 * Every fixture is a real directory tree in a temp dir, not a mock. The point
 * of these tests is the awkward environments — no $HOME, no PATH, a PATH full
 * of directories that do not exist, a Windows layout on a POSIX host — and a
 * mocked `fs` would answer for the mock rather than for Node.
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { detect, detectedToolLabels, onPath } from "../src/detect.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

/** A fresh temp directory, cleaned up when the run ends. */
function makeDirectory() {
  const root = mkdtempSync(join(tmpdir(), "pathfinder-detect-"));
  temporaryRoots.push(root);
  return root;
}

/** A directory tree from a map of relative path → file contents. */
function makeTree(files = {}) {
  const root = makeDirectory();
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = join(root, relativePath);
    mkdirSync(join(destination, ".."), { recursive: true });
    writeFileSync(destination, contents);
  }
  return root;
}

/** A directory holding executables of the given names. */
function makeBinDirectory(names) {
  return makeTree(Object.fromEntries(names.map((name) => [name, ""])));
}

function toolNamed(findings, id) {
  return findings.tools.find((tool) => tool.id === id);
}

describe("detect — git", () => {
  it("finds a repository at the current directory", () => {
    const cwd = makeTree({ ".git/HEAD": "ref: refs/heads/main\n" });
    const findings = detect({ cwd, env: {} });

    assert.equal(findings.git.insideRepository, true);
    assert.equal(findings.git.repositoryRoot, cwd);
  });

  it("finds a repository from a subdirectory, reporting the root", () => {
    const root = makeTree({ ".git/HEAD": "ref: refs/heads/main\n", "app/main.js": "" });
    const findings = detect({ cwd: join(root, "app"), env: {} });

    assert.equal(findings.git.insideRepository, true);
    assert.equal(findings.git.repositoryRoot, root);
  });

  it("treats a `.git` file as a repository, as linked worktrees use one", () => {
    const cwd = makeTree({ ".git": "gitdir: /elsewhere/.git/worktrees/x\n" });

    assert.equal(detect({ cwd, env: {} }).git.insideRepository, true);
  });

  it("reports no repository, and no crash, in a bare directory", () => {
    const findings = detect({ cwd: makeDirectory(), env: {} });

    assert.equal(findings.git.insideRepository, false);
    assert.equal(findings.git.repositoryRoot, null);
  });

  it("detects the git binary on PATH without running it", () => {
    const bin = makeBinDirectory(["git"]);
    const findings = detect({ cwd: makeDirectory(), env: { PATH: bin }, platform: "linux" });

    assert.equal(findings.git.binary, true);
  });

  it("reports the binary as absent when PATH does not hold it", () => {
    const bin = makeBinDirectory(["node"]);
    const findings = detect({ cwd: makeDirectory(), env: { PATH: bin }, platform: "linux" });

    assert.equal(findings.git.binary, false);
  });
});

describe("detect — an existing Pathfinder installation", () => {
  it("counts skill directories that actually hold a SKILL.md", () => {
    const cwd = makeTree({
      "skills/reflect/SKILL.md": "# Reflect\n",
      "skills/handoff/SKILL.md": "# Handoff\n",
      "skills/notes/README.md": "not a skill\n",
    });
    const findings = detect({ cwd, env: {} });

    assert.deepEqual(findings.pathfinder, { installed: true, skillCount: 2 });
  });

  it("reports not installed when `skills/` is absent", () => {
    const findings = detect({ cwd: makeDirectory(), env: {} });

    assert.deepEqual(findings.pathfinder, { installed: false, skillCount: 0 });
  });

  it("reports not installed when `skills/` holds nothing recognizable", () => {
    const cwd = makeTree({ "skills/notes/README.md": "" });

    assert.deepEqual(detect({ cwd, env: {} }).pathfinder, { installed: false, skillCount: 0 });
  });
});

describe("detect — tools", () => {
  it("detects a harness by its command on PATH", () => {
    const bin = makeBinDirectory(["claude"]);
    const findings = detect({ cwd: makeDirectory(), env: { PATH: bin }, platform: "linux" });

    assert.equal(toolNamed(findings, "claude-code").detected, true);
    assert.equal(toolNamed(findings, "codex").detected, false);
  });

  it("detects a harness by a marker in $HOME", () => {
    const home = makeTree({ ".codex/config.toml": "" });
    const findings = detect({ cwd: makeDirectory(), env: { HOME: home }, platform: "linux" });

    assert.equal(toolNamed(findings, "codex").detected, true);
  });

  it("detects a harness by a marker in the project", () => {
    const cwd = makeTree({ ".claude/settings.json": "{}" });
    const findings = detect({ cwd, env: {}, platform: "linux" });

    assert.equal(toolNamed(findings, "claude-code").detected, true);
  });

  it("detects the editor it is running inside from TERM_PROGRAM", () => {
    const findings = detect({
      cwd: makeDirectory(),
      env: { TERM_PROGRAM: "vscode" },
      platform: "linux",
    });

    assert.equal(toolNamed(findings, "vscode").detected, true);
  });

  it("reports every tool as undetected in an empty environment", () => {
    const findings = detect({ cwd: makeDirectory(), env: {}, platform: "linux" });

    assert.deepEqual(detectedToolLabels(findings), []);
  });

  it("keeps the tool list in table order", () => {
    const findings = detect({ cwd: makeDirectory(), env: {}, platform: "linux" });

    assert.deepEqual(
      findings.tools.map((tool) => tool.id),
      ["claude-code", "codex", "vscode", "cursor"],
    );
  });
});

describe("detect — degradation", () => {
  it("survives an environment with no HOME and no PATH", () => {
    const findings = detect({ cwd: makeDirectory(), env: {}, platform: "linux" });

    assert.equal(findings.git.binary, false);
    assert.deepEqual(detectedToolLabels(findings), []);
  });

  it("survives a PATH of directories that do not exist", () => {
    const env = { PATH: ["/no/such/place", "/nor/this"].join(":") };
    const findings = detect({ cwd: makeDirectory(), env, platform: "linux" });

    assert.equal(findings.git.binary, false);
  });

  it("survives a HOME that does not exist", () => {
    const env = { HOME: join(makeDirectory(), "gone") };
    const findings = detect({ cwd: makeDirectory(), env, platform: "linux" });

    assert.equal(toolNamed(findings, "claude-code").detected, false);
  });

  it("survives a cwd that does not exist", () => {
    const cwd = join(makeDirectory(), "gone");
    const findings = detect({ cwd, env: {}, platform: "linux" });

    assert.deepEqual(findings.pathfinder, { installed: false, skillCount: 0 });
    assert.deepEqual(detectedToolLabels(findings), []);
  });
});

describe("onPath", () => {
  it("splits PATH on `;` and honors PATHEXT on Windows", () => {
    const bin = makeBinDirectory(["git.EXE"]);
    const env = { PATH: ["C:\\nowhere", bin].join(";"), PATHEXT: ".COM;.EXE;.BAT" };

    assert.equal(onPath("git", env, "win32"), true);
    assert.equal(onPath("codex", env, "win32"), false);
  });

  it("splits PATH on `:` elsewhere and adds no extension", () => {
    const bin = makeBinDirectory(["git"]);
    const env = { PATH: ["/nowhere", bin].join(":") };

    assert.equal(onPath("git", env, "linux"), true);
  });

  it("reads `Path` when `PATH` is absent, as Windows environments vary", () => {
    const bin = makeBinDirectory(["git.EXE"]);

    assert.equal(onPath("git", { Path: bin }, "win32"), true);
  });

  it("is false for an empty PATH rather than searching the current directory", () => {
    assert.equal(onPath("git", { PATH: "" }, "linux"), false);
    assert.equal(onPath("git", {}, "linux"), false);
  });

  it("ignores empty PATH segments", () => {
    const bin = makeBinDirectory(["git"]);

    assert.equal(onPath("git", { PATH: `::${bin}::` }, "linux"), true);
  });
});
