/**
 * The publish guard, from the outside: what it refuses, and why.
 *
 * This is the last thing standing between a mistake and a permanent public
 * artifact, so every refusal is tested as a refusal — a non-zero exit *and* the
 * explanation, because a guard that blocks for a reason nobody can read gets
 * disabled by whoever hits it at midnight.
 *
 * The guard locates the repository from its own path, so each case builds a
 * throwaway repository with the same shape — CHANGELOG.md at the root, the
 * manifest and the script under packages/create-pathfinder — and runs the real
 * script inside it. Nothing here reaches the network, and nothing here can
 * publish: `prepublishOnly` is never invoked, the script is.
 */

import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD_SOURCE = join(PACKAGE_ROOT, "scripts", "publish-guard.mjs");

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * A repository shaped like the kit, at `version`, released on `main`.
 *
 * Defaults describe the state the workflow publishes from: merged to main,
 * clean, changelogged, and deliberately *not* tagged.
 */
function makeRelease({ version = "1.7.0", changelogVersion = version, manifest = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pathfinder-guard-"));
  temporaryRoots.push(root);

  const packageRoot = join(root, "packages", "create-pathfinder");
  mkdirSync(join(packageRoot, "scripts"), { recursive: true });
  cpSync(GUARD_SOURCE, join(packageRoot, "scripts", "publish-guard.mjs"));

  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "create-pathfinder", version, ...manifest }, null, 2),
  );
  writeFileSync(
    join(root, "CHANGELOG.md"),
    `# Changelog\n\n## [Unreleased]\n\n## [${changelogVersion}] - 2026-08-16\n\n- a change\n`,
  );

  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "-m", `release ${version}`);

  return { root, packageRoot };
}

/** Run the guard as npm would, and report how it went. */
function runGuard(packageRoot, env = { PATHFINDER_PUBLISH: "yes" }) {
  const result = spawnSync(
    process.execPath,
    [join(packageRoot, "scripts", "publish-guard.mjs")],
    { cwd: packageRoot, encoding: "utf8", env: { ...process.env, ...env } },
  );
  return {
    code: result.status,
    out: result.stdout ?? "",
    err: result.stderr ?? "",
  };
}

function assertRefused(result, reason) {
  assert.notEqual(result.code, 0, `expected a refusal, got:\n${result.out}`);
  assert.match(result.err, /publish blocked/);
  assert.match(result.err, reason);
}

describe("publish guard: what it allows", () => {
  it("allows an untagged release commit on main — the state the workflow publishes from", () => {
    const { packageRoot } = makeRelease();
    const result = runGuard(packageRoot);

    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /publishing 1\.7\.0 from [0-9a-f]{7}/);
    assert.match(result.out, /release verified/);
  });

  it("allows a release commit that is already tagged, for a manual publish", () => {
    const { root, packageRoot } = makeRelease();
    git(root, "tag", "-a", "v1.7.0", "-m", "v1.7.0");

    const result = runGuard(packageRoot);

    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /publishing 1\.7\.0 from v1\.7\.0/);
  });

  it("allows an older release commit that main has since moved past", () => {
    // Containment, not tip-of-main: republishing an earlier tagged release is
    // legitimate, and main is always ahead by the time anyone needs to.
    const { root, packageRoot } = makeRelease();
    git(root, "tag", "-a", "v1.7.0", "-m", "v1.7.0");
    const release = git(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "later.md"), "work since the release\n");
    git(root, "add", "--all");
    git(root, "commit", "--quiet", "-m", "later work");
    git(root, "checkout", "--quiet", release);

    const result = runGuard(packageRoot);

    assert.equal(result.code, 0, result.err);
  });
});

describe("publish guard: what it refuses", () => {
  it("refuses without explicit intent, even when everything else is right", () => {
    const { packageRoot } = makeRelease();
    assertRefused(runGuard(packageRoot, { PATHFINDER_PUBLISH: undefined }),
                  /no explicit intent/);
  });

  it("refuses a near-miss intent value rather than reading it charitably", () => {
    const { packageRoot } = makeRelease();
    for (const value of ["YES", "true", "1", "y"]) {
      assertRefused(runGuard(packageRoot, { PATHFINDER_PUBLISH: value }),
                    /no explicit intent/);
    }
  });

  it("refuses the never-released sentinel", () => {
    const { packageRoot } = makeRelease({ version: "0.0.0", changelogVersion: "0.0.0" });
    assertRefused(runGuard(packageRoot), /still 0\.0\.0/);
  });

  it("refuses while `private: true` remains", () => {
    const { packageRoot } = makeRelease({ manifest: { private: true } });
    assertRefused(runGuard(packageRoot), /private: true/);
  });

  it("refuses a dirty working tree, because npm publishes the tree not the commit", () => {
    const { root, packageRoot } = makeRelease();
    writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## [1.7.0]\n\nedited\n");

    assertRefused(runGuard(packageRoot), /uncommitted changes/);
  });

  it("refuses an untracked file too — it would be packed if it were under the package", () => {
    const { packageRoot } = makeRelease();
    writeFileSync(join(packageRoot, "stray.mjs"), "export const oops = 1;\n");

    assertRefused(runGuard(packageRoot), /uncommitted changes/);
  });

  it("refuses when the tag at HEAD names a different version", () => {
    const { root, packageRoot } = makeRelease();
    git(root, "tag", "-a", "v1.6.0", "-m", "v1.6.0");

    const result = runGuard(packageRoot);
    assertRefused(result, /tagged v1\.6\.0 but the package version is 1\.7\.0/);
  });

  it("refuses an untagged commit that is not contained in main", () => {
    // The failure mode the tag requirement used to cover: publishing from a
    // branch. Dropping the tag must not drop this.
    const { root, packageRoot } = makeRelease();
    git(root, "checkout", "--quiet", "-b", "feature");
    writeFileSync(join(root, "wip.md"), "unreviewed\n");
    git(root, "add", "--all");
    git(root, "commit", "--quiet", "-m", "wip");

    assertRefused(runGuard(packageRoot), /not contained in main/);
  });

  it("refuses when the changelog has no section for the version", () => {
    const { packageRoot } = makeRelease({ version: "1.8.0", changelogVersion: "1.7.0" });
    assertRefused(runGuard(packageRoot), /no released section for 1\.8\.0/);
  });

  it("refuses outside a Git repository", () => {
    const root = mkdtempSync(join(tmpdir(), "pathfinder-guard-bare-"));
    temporaryRoots.push(root);
    const packageRoot = join(root, "packages", "create-pathfinder");
    mkdirSync(join(packageRoot, "scripts"), { recursive: true });
    cpSync(GUARD_SOURCE, join(packageRoot, "scripts", "publish-guard.mjs"));
    writeFileSync(join(packageRoot, "package.json"),
                  JSON.stringify({ name: "create-pathfinder", version: "1.7.0" }));
    writeFileSync(join(root, "CHANGELOG.md"), "## [1.7.0]\n");

    // A repository above the temporary directory would make this pass for the
    // wrong reason; macOS puts temp dirs outside any checkout, but assert it.
    const enclosing = spawnSync("git", ["rev-parse", "--show-toplevel"],
                                { cwd: root, encoding: "utf8" });
    if (enclosing.status === 0) return;

    assertRefused(runGuard(packageRoot), /not a Git repository/);
  });
});
