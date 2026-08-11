#!/usr/bin/env node
/**
 * Refuse to publish unless a human deliberately asked for it.
 *
 * Publishing to npm is public and effectively irreversible: a version number
 * can be deprecated but never reused, and an accidental `create-pathfinder`
 * burns the name for the real release.
 *
 * `"private": true` in the manifest is the documented way to prevent this, and
 * it stays there — but on npm 11 its check was observed to run *after*
 * registry authentication, so it is not something to rely on alone. This runs
 * from `prepublishOnly`, which fires before authentication and before the
 * tarball is built, on both a real publish and `--dry-run`.
 *
 * To publish deliberately:
 *
 *     PATHFINDER_PUBLISH=yes npm publish
 */

if (process.env.PATHFINDER_PUBLISH !== "yes") {
  console.error(
    "\ncreate-pathfinder: publish blocked.\n\n" +
      "This package is not ready to publish, and publishing is irreversible.\n" +
      "Before the first release the version must move off 0.0.0 and `private`\n" +
      "must be removed from package.json — both are decisions for a human.\n\n" +
      "If you are that human and you mean it:\n\n" +
      "    PATHFINDER_PUBLISH=yes npm publish\n",
  );
  process.exit(1);
}

console.log("create-pathfinder: PATHFINDER_PUBLISH=yes — publish guard cleared.");
