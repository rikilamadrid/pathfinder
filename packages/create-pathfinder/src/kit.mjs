/**
 * What the kit is, and where to find it.
 *
 * The copy list is the single fact this whole tool exists to act on. It is
 * duplicated in exactly two other places — the README quickstart and
 * NOT_A_FRAMEWORK.md — and nowhere else. Nothing here embeds a copy of the
 * kit's content: the real directories are read at install time.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Everything a destination project receives, and nothing else.
 *
 * Read from copy-list.json rather than declared here, so the list is data with
 * one home instead of a value restated in every file that needs it. The
 * validator reads the same file and checks the README and npm's `files`
 * against it; nothing has to parse this source code to learn the list.
 *
 * Deliberately absent from it: CHANGELOG.md and README.md (the kit's own
 * history and front page, not the project's), .github/, assets/, site/,
 * packages/, and .features/. A destination project that wants a changelog
 * starts from templates/CHANGELOG.template.md instead.
 *
 * Read with readFileSync rather than a JSON import, which still requires an
 * import attribute on the Node 18 this package supports.
 */
export const COPY_LIST = Object.freeze(
  JSON.parse(readFileSync(join(HERE, "..", "copy-list.json"), "utf8")).entries,
);

/**
 * Junk that is never part of the kit, matched by basename at any depth.
 *
 * These are git-ignored in the kit repository, so they exist in a maintainer's
 * working tree but not in version control — and npm strips them from the
 * published tarball on its own. Without this list the installer would copy
 * `skills/.DS_Store` when run from a checkout and not when run from npm, which
 * is the worst kind of difference: invisible, and only on someone else's
 * machine.
 */
const EXCLUDED = new Set([".DS_Store", "Thumbs.db", "__MACOSX", ".git"]);

export function isExcluded(basename) {
  return EXCLUDED.has(basename) || basename.startsWith("._");
}

const PACKAGE_ROOT = resolve(HERE, "..");

/**
 * Locate the kit directories this tool should copy from.
 *
 * Two layouts are possible and both are checked, nearest first:
 *
 *   1. Published package — the kit ships inside the tarball alongside this
 *      code. How it gets there is chunk 2's decision; this resolver only
 *      requires that it ends up at the package root.
 *   2. Development — running from a checkout of the kit itself, where the
 *      package sits at packages/create-pathfinder/ and the kit is two levels up.
 *
 * Returns null when neither candidate holds a complete kit, which is a bug in
 * the package rather than a user error, and is reported as such.
 */
export function findKitRoot() {
  const candidates = [PACKAGE_ROOT, resolve(PACKAGE_ROOT, "..", "..")];
  return candidates.find(isKitRoot) ?? null;
}

function isKitRoot(directory) {
  return COPY_LIST.every((entry) => existsSync(join(directory, entry)));
}

/**
 * Find the Git repository containing `startDirectory`, or null.
 *
 * Walks the filesystem rather than shelling out to `git`, so the tool works
 * without the git binary on PATH and cannot be confused by its exit codes.
 * `.git` is tested with existsSync rather than as a directory because linked
 * worktrees and submodules use a `.git` *file* pointing elsewhere.
 */
export function findGitRoot(startDirectory) {
  let current = resolve(startDirectory);

  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
