/**
 * The whole matrix of what this tool does when nobody is there to answer it.
 *
 * This is the contract that keeps `create-pathfinder` usable from a script, a
 * Dockerfile, and a CI job, and it is the one that is easiest to break by
 * accident: every future feature that adds a question inherits the obligation
 * to have an answer for the case where there is no terminal. So the cases are
 * enumerated in one table rather than described in prose, and the table is the
 * thing a reviewer reads.
 *
 * Two invariants are asserted on *every* row, not just the interesting ones:
 *
 *   1. No question was asked. The prompter throws if `confirm` is called, so a
 *      guard bug fails here rather than hanging on someone's runner.
 *   2. No question was printed. A prompt nobody can answer is worse than no
 *      prompt, and stdout must not contain one even as decoration.
 *
 * `--dry-run` carries most of the rows because it reaches every decision and
 * then performs none of it, which makes "the directory is untouched" a true
 * assertion about both the install and the `git init`.
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { run } from "../src/cli.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function makeLooseDirectory() {
  const cwd = mkdtempSync(join(tmpdir(), "pathfinder-matrix-"));
  temporaryRoots.push(cwd);
  return cwd;
}

/** `findGitRoot` looks for `.git` and never runs the binary. */
function makeRepository() {
  const cwd = makeLooseDirectory();
  mkdirSync(join(cwd, ".git"));
  return cwd;
}

function makeFakeGitPath() {
  const binary = mkdtempSync(join(tmpdir(), "pathfinder-matrix-bin-"));
  temporaryRoots.push(binary);
  writeFileSync(join(binary, "git"), "");
  return binary;
}

/**
 * The prompter `bin/` builds when the TTY guard says no.
 *
 * Local rather than imported so that this file states its own premise: reaching
 * a question here is a test failure, and the reason is named at the point of
 * failure instead of in another module's stack frame.
 */
function forbiddenPrompter() {
  return {
    interactive: false,
    confirm: async () => {
      throw new Error("a question was asked with no terminal to answer it");
    },
    chooseMany: async () => {
      throw new Error("a question was asked with no terminal to answer it");
    },
    close: () => {},
  };
}

async function invoke(argv, { cwd, gitOnPath = true }) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    cwd,
    out: (text) => (out += text),
    err: (text) => (err += text),
    env: gitOnPath ? { PATH: makeFakeGitPath() } : {},
    platform: "linux",
    // Both ends, because `bin/` requires both. A findings report printed into a
    // pipe would break byte-parity with 1.4.1 on its own.
    stdoutIsTTY: false,
    prompter: forbiddenPrompter(),
  });
  return { code, out, err };
}

/**
 * Every row: what was passed, where it ran, and what should come back.
 *
 * `expect.untouched` means the directory has exactly the entries it started
 * with — no `.git`, no kit. `stderr` and `stdout` are substrings that must
 * appear; `absent` must not.
 */
const MATRIX = [
  // --- Not a repository, `git` available -----------------------------------
  {
    name: "bare run in a loose directory refuses, and names the flag",
    argv: [],
    where: "loose",
    code: 1,
    stderr: ["is not inside a Git repository", "pass --git-init"],
    untouched: true,
  },
  {
    name: "--yes is not authorization to create a repository",
    argv: ["--yes"],
    where: "loose",
    code: 1,
    stderr: ["is not inside a Git repository", "pass --git-init"],
    untouched: true,
  },
  {
    name: "--no-input is the same flag by another name",
    argv: ["--no-input"],
    where: "loose",
    code: 1,
    stderr: ["is not inside a Git repository"],
    untouched: true,
  },
  {
    name: "--no-git-init refuses without ceremony",
    argv: ["--no-git-init"],
    where: "loose",
    code: 1,
    stderr: ["is not inside a Git repository"],
    untouched: true,
  },
  {
    name: "--git-init authorizes what no terminal could",
    argv: ["--git-init", "--dry-run"],
    where: "loose",
    code: 0,
    stdout: ["Would run `git init`", "files to write"],
    untouched: true,
  },
  {
    name: "--yes --git-init is the fully scripted install",
    argv: ["--yes", "--git-init", "--dry-run"],
    where: "loose",
    code: 0,
    stdout: ["Would run `git init`", "files to write"],
    untouched: true,
  },
  {
    name: "--dry-run reports the plan rather than refusing it",
    argv: ["--dry-run"],
    where: "loose",
    code: 0,
    stdout: ["Would run `git init`", "files to write"],
    untouched: true,
  },
  {
    name: "--dry-run --no-git-init reports the refusal it would hit",
    argv: ["--dry-run", "--no-git-init"],
    where: "loose",
    code: 1,
    stderr: ["is not inside a Git repository"],
    untouched: true,
  },

  // --- Not a repository, no `git` on PATH ----------------------------------
  {
    name: "no `git` binary refuses with advice that can actually be followed",
    argv: [],
    where: "loose",
    gitOnPath: false,
    code: 1,
    stderr: ["is not available to create one", "Install Git"],
    absent: ["pass --git-init"],
    untouched: true,
  },
  {
    name: "--git-init cannot conjure a binary",
    argv: ["--git-init"],
    where: "loose",
    gitOnPath: false,
    code: 1,
    stderr: ["is not available to create one"],
    untouched: true,
  },
  {
    name: "--dry-run does not report a plan that could never run",
    argv: ["--dry-run"],
    where: "loose",
    gitOnPath: false,
    code: 1,
    stderr: ["is not available to create one"],
    absent: ["Would run `git init`"],
    untouched: true,
  },

  // --- Already a repository ------------------------------------------------
  {
    name: "an existing repository is never asked about",
    argv: ["--dry-run"],
    where: "repository",
    code: 0,
    stdout: ["files to write"],
    absent: ["Would run `git init`"],
    untouched: true,
  },
  {
    name: "--no-git-init is a no-op where no init was coming",
    argv: ["--dry-run", "--no-git-init"],
    where: "repository",
    code: 0,
    stdout: ["files to write"],
    absent: ["Would run `git init`"],
    untouched: true,
  },
  {
    name: "--git-init is a no-op too, not a second repository",
    argv: ["--dry-run", "--git-init"],
    where: "repository",
    code: 0,
    absent: ["Would run `git init`"],
    untouched: true,
  },

  // --- Arguments that never reach a decision -------------------------------
  {
    name: "contradicting flags exit 2 before anything is inspected",
    argv: ["--git-init", "--no-git-init"],
    where: "loose",
    code: 2,
    stderr: ["contradict each other", "Usage:"],
    untouched: true,
  },
  {
    name: "an unknown flag exits 2 naming the offender",
    argv: ["--recursive"],
    where: "loose",
    code: 2,
    stderr: ["unknown option `--recursive`"],
    untouched: true,
  },
  {
    name: "--help asks nothing and inspects nothing",
    argv: ["--help"],
    where: "loose",
    code: 0,
    stdout: ["Usage:", "--git-init", "--no-git-init", "--yes"],
    untouched: true,
  },
];

describe("the non-interactive matrix", () => {
  for (const row of MATRIX) {
    it(row.name, async () => {
      const cwd = row.where === "repository" ? makeRepository() : makeLooseDirectory();
      const before = readdirSync(cwd).sort();

      const { code, out, err } = await invoke(row.argv, { cwd, gitOnPath: row.gitOnPath });

      assert.equal(code, row.code, `exit code for \`${row.argv.join(" ")}\``);

      for (const text of row.stdout ?? []) assert.ok(out.includes(text), `stdout missing: ${text}`);
      for (const text of row.stderr ?? []) assert.ok(err.includes(text), `stderr missing: ${text}`);
      for (const text of row.absent ?? []) {
        assert.ok(!(out + err).includes(text), `should not have said: ${text}`);
      }

      if (row.untouched) assert.deepEqual(readdirSync(cwd).sort(), before);

      // The two invariants that hold for the whole table. `forbiddenPrompter`
      // covers the first by throwing; this covers the second.
      assert.ok(!out.includes("Initialize a Git repository here?"), "printed a question");
      assert.ok(!out.includes("[Y/n]"), "printed a prompt");
    });
  }
});

describe("the non-interactive matrix — what it still writes", () => {
  // One row that is not a dry run, because a matrix that only ever proves
  // nothing happened would pass just as well on a tool that does nothing.
  it("installs into an existing repository without asking anything", async () => {
    const cwd = makeRepository();

    const { code, out } = await invoke([], { cwd });

    assert.equal(code, 0);
    assert.match(out, /Installed the Pathfinder kit into /);
    assert.ok(readdirSync(cwd).includes("skills"), "the kit was written");
  });

  it("prints no findings report, because stdout is not a terminal", async () => {
    const cwd = makeRepository();

    const { out } = await invoke(["--dry-run"], { cwd });

    assert.ok(!out.includes("Pathfinder\n\n  "), "the report leaked into a pipe");
  });
});
