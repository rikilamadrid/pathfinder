/**
 * Where the findings report is allowed to appear.
 *
 * The rule under test is the one that keeps this feature compatible: the report
 * is written for a person at a terminal, so a piped run, a redirect, and a CI
 * log all keep the output 1.4.1 produced. Every case here runs `--dry-run`, so
 * the tests cannot write into the temp directory even if the guard is wrong.
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { run } from "../src/cli.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

/** A temp directory that is a Git repository, without needing the git binary. */
function makeRepository() {
  const root = mkdtempSync(join(tmpdir(), "pathfinder-cli-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, ".git"));
  return root;
}

async function dryRun({ cwd, ...environment }) {
  let out = "";
  let err = "";
  const code = await run(["--dry-run"], {
    cwd,
    out: (text) => (out += text),
    err: (text) => (err += text),
    env: {},
    platform: "linux",
    ...environment,
  });
  return { code, out, err };
}

describe("run — the findings report", () => {
  it("is printed to a terminal", async () => {
    const { code, out } = await dryRun({ cwd: makeRepository(), stdoutIsTTY: true });

    assert.equal(code, 0);
    assert.match(out, /\+ Git repository detected/);
  });

  it("is absent when stdout is not a terminal", async () => {
    const { code, out } = await dryRun({ cwd: makeRepository() });

    assert.equal(code, 0);
    assert.doesNotMatch(out, /Git repository detected/);
    assert.match(out, /^Would install the Pathfinder kit into /);
  });

  it("comes before the install summary, not after it", async () => {
    const { out } = await dryRun({ cwd: makeRepository(), stdoutIsTTY: true });

    assert.ok(out.indexOf("Git repository detected") < out.indexOf("Would install"));
  });

  it("uses the decorated marks in a UTF-8 terminal", async () => {
    const { out } = await dryRun({
      cwd: makeRepository(),
      stdoutIsTTY: true,
      env: { LANG: "en_US.UTF-8" },
    });

    assert.match(out, /✓ Git repository detected/);
  });

  it("is not printed when the arguments never got as far as a run", async () => {
    let out = "";
    const code = await run(["--nonsense"], {
      cwd: makeRepository(),
      out: (text) => (out += text),
      err: () => {},
      env: {},
      platform: "linux",
      stdoutIsTTY: true,
    });

    assert.equal(code, 2);
    assert.equal(out, "");
  });

  it("is not printed by --help", async () => {
    let out = "";
    const code = await run(["--help"], {
      cwd: makeRepository(),
      out: (text) => (out += text),
      err: () => {},
      env: {},
      platform: "linux",
      stdoutIsTTY: true,
    });

    assert.equal(code, 0);
    assert.doesNotMatch(out, /Git repository detected/);
  });
});

describe("run — refusals still hold", () => {
  it("refuses outside a Git repository and writes nothing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pathfinder-cli-"));
    temporaryRoots.push(cwd);

    let err = "";
    const code = await run([], {
      cwd,
      out: () => {},
      err: (text) => (err += text),
      env: {},
      platform: "linux",
    });

    assert.equal(code, 1);
    assert.match(err, /is not inside a Git repository/);
    assert.deepEqual(readdirSync(cwd), []);
  });

  it("exits 2 on an unknown flag, naming it", async () => {
    let err = "";
    const code = await run(["--nonsense"], {
      cwd: makeRepository(),
      out: () => {},
      err: (text) => (err += text),
      env: {},
      platform: "linux",
    });

    assert.equal(code, 2);
    assert.match(err, /unknown option `--nonsense`/);
  });

  it("writes nothing under --dry-run, not even to a terminal", async () => {
    const cwd = makeRepository();
    await dryRun({ cwd, stdoutIsTTY: true });

    assert.deepEqual(readdirSync(cwd), [".git"]);
  });
});
