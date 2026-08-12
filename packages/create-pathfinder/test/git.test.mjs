/**
 * The one Git command, and everything it must not do.
 *
 * The success case runs the real binary, because the thing worth proving is
 * that a repository exists afterwards — a mocked `git init` proves only that
 * the mock was called. The failure cases are injected, since a missing binary
 * and a permissions error are not reproducible on demand on a developer's
 * machine, and the behaviour under test is what we do with the failure rather
 * than how it arose.
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { initRepository } from "../src/git.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function makeDirectory(prefix = "pathfinder-git-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

describe("initRepository — the real binary", () => {
  it("initializes a repository in the directory it was given", () => {
    const cwd = makeDirectory();

    const result = initRepository(cwd);

    assert.deepEqual(result, { ok: true });
    assert.ok(existsSync(join(cwd, ".git")));
  });

  it("initializes in a path containing a space", () => {
    const cwd = makeDirectory("pathfinder git ");

    assert.deepEqual(initRepository(cwd), { ok: true });
    assert.ok(existsSync(join(cwd, ".git")));
  });

  it("prints nothing of git's own to our streams", () => {
    // `git init` emits a `hint:` block about default branch names on many
    // installations. Inherited stdio would make that paragraph read as
    // Pathfinder's own voice inside Pathfinder's own report.
    const calls = [];
    const spawn = (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: "", stderr: "" };
    };

    initRepository("/somewhere", { spawn });

    assert.deepEqual(calls[0].options.stdio, ["ignore", "pipe", "pipe"]);
  });
});

describe("initRepository — the command it builds", () => {
  it("runs `git init`, as an argument array, and nothing else", () => {
    const calls = [];
    const spawn = (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    };

    initRepository("/some/path", { spawn });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "git");
    assert.deepEqual(calls[0].args, ["init"]);
    assert.equal(calls[0].options.cwd, "/some/path");
  });

  it("never reaches a parent directory", () => {
    // There is no argument in the call that could name one. This test exists to
    // fail loudly if a future edit adds a path argument to `git init`.
    const spawn = (command, args) => {
      assert.deepEqual(args, ["init"]);
      return { status: 0 };
    };

    initRepository("/some/path", { spawn });
  });
});

describe("initRepository — failure", () => {
  it("reports git's stderr, because that is the actionable part", () => {
    const spawn = () => ({
      status: 128,
      stderr: "fatal: cannot mkdir /read-only/.git: Permission denied\n",
    });

    const result = initRepository("/read-only", { spawn });

    assert.equal(result.ok, false);
    assert.equal(result.message, "fatal: cannot mkdir /read-only/.git: Permission denied");
  });

  it("says something useful when git failed silently", () => {
    const result = initRepository("/x", { spawn: () => ({ status: 1, stderr: "" }) });

    assert.equal(result.ok, false);
    assert.match(result.message, /exited with status 1/);
  });

  it("degrades when the binary is missing rather than throwing", () => {
    const result = initRepository("/x", {
      spawn: () => ({ error: new Error("spawnSync git ENOENT"), status: null }),
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /ENOENT/);
  });

  it("degrades when the spawn itself throws", () => {
    const result = initRepository("/x", {
      spawn: () => {
        throw new Error("EACCES");
      },
    });

    assert.deepEqual(result, { ok: false, message: "EACCES" });
  });
});
