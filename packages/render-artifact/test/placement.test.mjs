/**
 * Why this package is here rather than next to the code it tests.
 *
 * `skills/` is copied whole into every installed project, and `NEVER_SHIPS`
 * lists five `context/` paths and nothing else. So there is no exclusion
 * keeping engine tests out of somebody else's repository — placement is the
 * entire mechanism, and placement is a thing a later change can undo by
 * accident while meaning something else entirely.
 *
 * These assertions are cheap and structural: they read the copy list and the
 * paths, and they fail the moment the mechanism stops being true. What they
 * cannot see is the published tarball, which is checked separately by
 * `npm pack --dry-run` in `packages/create-pathfinder`.
 */

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";

import { ENGINE_ROOT, PACKAGE_ROOT, REPO_ROOT } from "../lib/harness.mjs";

const COPY_LIST = JSON.parse(
  readFileSync(join(REPO_ROOT, "packages", "create-pathfinder", "copy-list.json"), "utf8"));

describe("placement keeps the tests out of installed projects", () => {
  it("this package is outside every entry the installer copies", () => {
    const fromRoot = relative(REPO_ROOT, PACKAGE_ROOT).split(sep);

    assert.equal(fromRoot[0], "packages",
      "the test package moved out of packages/, which is the directory the " +
      "copy list does not name");
    assert.ok(!COPY_LIST.entries.includes("packages"),
      "`packages` is in the copy list, so every test in this package now " +
      "installs into other people's repositories");
    assert.ok(!COPY_LIST.entries.includes(fromRoot[0]));
  });

  it("the engine it tests is inside an entry the installer copies", () => {
    // The other half of the same arrangement, and the half that would fail
    // silently: tests that no longer exercise the shipped engine still pass.
    assert.equal(relative(REPO_ROOT, ENGINE_ROOT).split(sep)[0], "skills");
    assert.ok(COPY_LIST.entries.includes("skills"));
    assert.ok(existsSync(join(ENGINE_ROOT, "bin", "render.mjs")));
  });

  it("holds no copy of the engine", () => {
    // A vendored copy would keep every test green while the shipped engine
    // rotted, which is the one failure this whole package exists to prevent.
    //
    // The needle is assembled rather than written out, because a file
    // searching for a string contains that string and would find itself.
    const needle = `export function ${"render"}(`;

    for (const file of filesUnder(PACKAGE_ROOT)) {
      if (!file.endsWith(".mjs")) continue;
      assert.ok(!readFileSync(file, "utf8").includes(needle),
        `${relative(REPO_ROOT, file)} defines a renderer. These tests exercise ` +
        `the engine under skills/, never a copy of it.`);
    }
  });

  it("ships nothing: the manifest is private and unpublishable", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));

    assert.equal(manifest.private, true,
      "a manifest that is not private can be published by accident");
    assert.equal(manifest.dependencies, undefined,
      "the engine has zero runtime dependencies and its tests add none");
    assert.equal(manifest.devDependencies, undefined,
      "`node --test` is the standard library; a devDependency here would mean " +
      "a fresh clone with only Node installed can no longer run these tests");
  });

  it("leaves no manifest at the repository root", () => {
    // NOT_A_FRAMEWORK.md's promise. Nested tooling may carry a manifest —
    // this package is one — and the root may not.
    for (const name of ["package.json", "package-lock.json", "pnpm-lock.yaml",
      "yarn.lock", "requirements.txt", "pyproject.toml", "Gemfile", "go.mod"]) {
      assert.equal(existsSync(join(REPO_ROOT, name)), false,
        `${name} at the repository root contradicts NOT_A_FRAMEWORK.md`);
    }
  });
});

/** Every file under `root`, skipping directories a checkout does not track. */
function filesUnder(root) {
  const out = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(root);
  return out;
}
