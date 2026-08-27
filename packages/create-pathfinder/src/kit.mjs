/**
 * What the kit is, and where to find it.
 *
 * The copy list is the single fact this whole tool exists to act on. It is
 * duplicated in exactly two other places — the README quickstart and
 * NOT_A_FRAMEWORK.md — and nowhere else. Nothing here embeds a copy of the
 * kit's content: the real directories are read at install time.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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

/**
 * Kit files that are deliberately not part of the kit, by kit-relative path.
 *
 * A different idea from EXCLUDED above, and kept separate for that reason.
 * Those are OS and editor droppings that were never anybody's file. These are
 * real, hand-written files that live inside a copy-list directory and must
 * still never reach a destination project.
 *
 * Every one of them would be actively wrong in somebody else's project,
 * though not all for the same reason — see `context/history.md` below.
 *
 * `context/tracker.md` is the original case. Work Tracking's off switch is the
 * *absence* of that file in a destination project, so shipping this
 * repository's own copy would hand every new project a configuration naming a
 * tracker it does not own, pointing at a spec directory it does not have, with
 * the off switch already defeated on first install.
 *
 * `context/current-ticket.md` and `context/handoff.md` are transient session
 * state, and they are here for the same reason one step further on: the kit
 * stopped shipping a blank `current-ticket.md` stencil, because `/ticket load`
 * writes the real one on first use and a placeholder is just a file a reader
 * has to recognise as empty. Having stopped shipping the blank one, the thing
 * to guard against is shipping a *filled-in* one — a destination project
 * opening its first session to a note about whichever ticket a Pathfinder
 * maintainer had loaded on the day of the release.
 *
 * `context/current-feature.md` is the same file under its former name. The
 * delivery loop stopped writing it when tickets became the executable unit, and
 * it stays on this list because a project installed before that change still
 * has one sitting in `context/`, and an upgrade must not ship a maintainer's
 * copy over it.
 *
 * `context/history.md` is the odd one out, and the reason this set now has two
 * kinds in it. The others are transient or local session state, ignored by
 * Git as well as excluded here. This one is durable project truth, tracked in
 * version control exactly as `README.md` says a project should track it — it is
 * simply *another project's* truth. A destination project gets its own, written
 * by `/ticket complete` from `templates/history.template.md` on the day it
 * first completes something, and that template must keep shipping. So the
 * promise made about this path is the publication half only: never shipped, but
 * emphatically tracked.
 *
 * `context` is a *directory* entry in the copy list, so anything placed beneath
 * it ships by default. Making the invariant enforced rather than intended is
 * the same move `check_no_junk_tracked` made: an ignore rule is advisory, one
 * `git add -f` defeats it, and `stage-kit.mjs` copies from the working tree
 * without consulting it at all.
 *
 * Matched on the kit-relative path, never the basename — a project's own
 * `tracker.md` somewhere else is not this file and must not be caught by it.
 */
const NEVER_SHIPS = new Set([
  "context/tracker.md",
  "context/current-ticket.md",
  "context/current-feature.md",
  "context/handoff.md",
  "context/history.md",
]);

/**
 * Is this kit-relative path one the kit must never hand over?
 *
 * @param {string} relativePath forward-slashed, relative to the kit root
 */
export function neverShips(relativePath) {
  return NEVER_SHIPS.has(relativePath);
}

/**
 * A `cpSync` filter that drops never-ships files from a recursive copy.
 *
 * Lives here rather than inline in `stage-kit.mjs` so the staging path and its
 * test run the same code. A test that rebuilds the predicate proves only that
 * `cpSync` honours `filter`; it cannot catch the path arithmetic below going
 * wrong, which is the part with anything to get wrong in it.
 *
 * `cpSync` hands the filter absolute paths and calls it for the copy root
 * itself, so the root resolves to `""` and is kept — filtering a directory out
 * would take its whole subtree with it.
 *
 * @param {string} rootDir absolute path the kit-relative paths are relative to
 * @returns {(source: string) => boolean} true to copy, false to skip
 */
export function neverShipsFilter(rootDir) {
  return (source) => !neverShips(relative(rootDir, source).split(sep).join("/"));
}

const PACKAGE_ROOT = resolve(HERE, "..");

/**
 * This installer's own version, for the identity block to state.
 *
 * Read from the package manifest for the same reason the copy list is: the
 * number has one home, and a constant declared here would be a second one that
 * `npm version` does not know to update. Read once at module load, because a
 * file that is part of the running package cannot change underneath a single
 * run, and because a failure to read it should surface at import rather than
 * halfway through a report.
 *
 * Not exported through `findKitRoot`'s resolution: the manifest sits beside
 * this source in both layouts, published and checkout alike, so there is
 * nothing to search for.
 */
export const VERSION = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version;

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
