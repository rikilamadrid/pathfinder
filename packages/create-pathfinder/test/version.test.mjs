/**
 * `--version` answers a question about the package, not about the run.
 *
 * The contract is narrow on purpose: one line, the bare version, exit 0, and
 * nothing else on stdout. It is read by scripts and by people checking what
 * they have installed, so every case below asserts the *whole* output rather
 * than that the version appears somewhere in it — a leading identity block
 * would satisfy a substring check and break every caller.
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { run } from "../src/cli.mjs";
import { VERSION } from "../src/kit.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function temporaryDirectory() {
  const root = mkdtempSync(join(tmpdir(), "pathfinder-version-"));
  temporaryRoots.push(root);
  return root;
}

async function version(argv, { cwd = temporaryDirectory(), ...rest } = {}) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    cwd,
    out: (text) => (out += text),
    err: (text) => (err += text),
    env: {},
    platform: "linux",
    ...rest,
  });
  return { code, out, err, cwd };
}

describe("--version", () => {
  it("prints the bare version and exits 0", async () => {
    for (const flag of ["--version", "-v"]) {
      const { code, out, err } = await version([flag]);
      assert.equal(code, 0, flag);
      assert.equal(out, `${VERSION}\n`, flag);
      assert.equal(err, "", flag);
    }
  });

  it("prints the version in the package manifest", async () => {
    const { out } = await version(["--version"]);
    assert.match(out.trim(), /^\d+\.\d+\.\d+/);
  });

  it("works outside a Git repository, where every other run is refused", async () => {
    // The directory is deliberately not a repository. `run([])` here exits 1
    // with a refusal; asking for a version number must not inherit that.
    const { code, out } = await version(["--version"]);
    assert.equal(code, 0);
    assert.equal(out, `${VERSION}\n`);
  });

  it("writes nothing to the directory it was run in", async () => {
    const cwd = temporaryDirectory();
    mkdirSync(join(cwd, ".git"));
    await version(["--version"], { cwd });
    assert.deepEqual(readdirSync(cwd), [".git"]);
  });

  it("wins over other flags, and over an unparseable one", async () => {
    for (const argv of [
      ["--version", "--help"],
      ["--help", "--version"],
      ["--dry-run", "--version"],
      ["--version", "--agents=nonsense"],
    ]) {
      const { code, out } = await version(argv);
      assert.equal(code, 0, argv.join(" "));
      assert.equal(out, `${VERSION}\n`, argv.join(" "));
    }
  });

  // The refusals in the parser return on the argument that caused them, so a
  // version flag standing behind one is the case that actually breaks. It is
  // not a contrived ordering: a wrapper script appends its own `--version` to
  // whatever it was handed, and what it was handed may be a typo.
  it("wins from behind a refusal, whichever refusal it is", async () => {
    for (const argv of [
      ["--nonsense", "--version"],
      ["--nonsense", "-v"],
      ["--agents", "bogus", "--version"],
      ["--agents=bogus", "--version"],
      ["--agents", "--version"],
      ["--git-init", "--no-git-init", "--version"],
    ]) {
      const { code, out, err } = await version(argv);
      assert.equal(code, 0, argv.join(" "));
      assert.equal(out, `${VERSION}\n`, argv.join(" "));
      assert.equal(err, "", argv.join(" "));
    }
  });

  it("is documented in `--help` under both spellings", async () => {
    // `check_help_text` requires the parser's `case` labels to appear in the
    // help text, and these two are recognized before the switch, so that rule
    // cannot see them. This is the replacement guarantee.
    let out = "";
    const cwd = temporaryDirectory();
    mkdirSync(join(cwd, ".git"));
    await run(["--help"], {
      cwd,
      out: (text) => (out += text),
      err: () => {},
      env: {},
      platform: "linux",
    });
    assert.match(out, /-v, --version/);
  });

  it("prints no identity block or findings at a terminal", async () => {
    // The decorated presentation is chosen by tier, and `--version` returns
    // before that branch is reached. A TTY must change nothing here.
    const cwd = temporaryDirectory();
    mkdirSync(join(cwd, ".git"));
    const { out } = await version(["--version"], { cwd, stdoutIsTTY: true });
    assert.equal(out, `${VERSION}\n`);
  });
});
