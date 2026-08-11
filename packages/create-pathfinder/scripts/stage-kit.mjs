#!/usr/bin/env node
/**
 * Copy the kit into this package so it can be published, then remove it again.
 *
 * Why this exists: npm's `files` allowlist cannot reach outside the package
 * directory, and the kit lives at the repository root. Three ways out were
 * considered:
 *
 *   1. A manifest at the repository root — forbidden. NOT_A_FRAMEWORK.md
 *      promises the kit has no package manager, and CI enforces it.
 *   2. Symlinks into ../.. — npm packs the link, not the target, and the
 *      behaviour differs across npm versions and platforms.
 *   3. Stage on `prepack`, unstage on `postpack` — chosen.
 *
 * The staged copies are transient and git-ignored. Nothing is duplicated in
 * version control: the kit at the repository root remains the only copy, and
 * this script is the only thing that ever writes the second one.
 *
 * Run directly if you want to inspect the staged package:
 *
 *     node scripts/stage-kit.mjs            # stage
 *     node scripts/stage-kit.mjs --clean    # unstage
 */

import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { COPY_LIST } from "../src/kit.mjs";

/** The kit, plus the licence npm shows on the package page. */
const STAGED = [...COPY_LIST, "LICENSE"];

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");

function clean() {
  for (const entry of STAGED) {
    rmSync(join(PACKAGE_ROOT, entry), { recursive: true, force: true });
  }
}

function stage() {
  // Always clean first. A crashed or interrupted pack leaves the previous
  // staging behind, and silently publishing stale kit files is exactly the
  // failure this whole approach has to avoid.
  clean();

  const missing = STAGED.filter((entry) => !existsSync(join(REPO_ROOT, entry)));
  if (missing.length > 0) {
    console.error(
      `stage-kit: ${REPO_ROOT} is missing ${missing.join(", ")}.\n` +
        "This script must run from packages/create-pathfinder/ inside a\n" +
        "checkout of the Pathfinder kit.",
    );
    process.exit(1);
  }

  for (const entry of STAGED) {
    cpSync(join(REPO_ROOT, entry), join(PACKAGE_ROOT, entry), {
      recursive: true,
    });
  }

  console.log(`stage-kit: staged ${STAGED.join(", ")}`);
}

if (process.argv.includes("--clean")) {
  clean();
  console.log("stage-kit: removed staged kit files");
} else {
  stage();
}
