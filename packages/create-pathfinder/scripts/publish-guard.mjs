#!/usr/bin/env node
/**
 * Refuse to publish unless a human asked for it *and* this commit is a release.
 *
 * Publishing to npm is public and effectively irreversible: a version can be
 * deprecated but never reused, and a wrong `create-pathfinder@1.3.0` cannot be
 * taken back.
 *
 * Two different questions are checked here, in order — cheapest and most
 * likely first:
 *
 *   1. Intent. Did someone mean to publish at all?
 *   2. Correctness. Is this commit actually the release it claims to be?
 *
 * CI checks agreement continuously; this checks it again at the last moment,
 * because CI validates a branch while `npm publish` uploads a working tree.
 *
 * `"private": true` in the manifest is npm's own block and stays until the
 * first publication, but it is not relied on: on npm 11 its check was observed
 * to run *after* registry authentication. This runs from `prepublishOnly`,
 * which fires before authentication and before the tarball is built, on both a
 * real publish and `--dry-run`. It does not run on `npm pack`, so local
 * packing and installer testing need none of this.
 *
 * To publish a release:
 *
 *     PATHFINDER_PUBLISH=yes npm publish
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");

/** Never published. See CHANGELOG.md's versioning policy. */
const SENTINEL = "0.0.0";

function refuse(problem, fix) {
  console.error(`\ncreate-pathfinder: publish blocked — ${problem}\n\n${fix}\n`);
  process.exit(1);
}

function git(...args) {
  // stderr is piped, not inherited. `git describe --exact-match` failing is an
  // expected outcome here — it means "not a release commit" — and its `fatal:`
  // line would otherwise print above this script's own explanation and read
  // like the real error.
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const manifest = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
);
const { version } = manifest;

// 1. Intent.
if (process.env.PATHFINDER_PUBLISH !== "yes") {
  refuse(
    "no explicit intent to publish.",
    "Publishing is irreversible, so it is never the default. If you mean it:\n\n" +
      "    PATHFINDER_PUBLISH=yes npm publish",
  );
}

// 2. Correctness.
if (version === SENTINEL) {
  refuse(
    `the version is still ${SENTINEL}, which means never released.`,
    "Cut the release first: add the `## [X.Y.Z]` section to CHANGELOG.md, then\n" +
      "run `python3 .github/scripts/set-release-version.py` to derive the version\n" +
      "from it. See the release checklist in CONTRIBUTING.md.",
  );
}

if (manifest.private === true) {
  refuse(
    "`private: true` is still set in package.json.",
    "That flag is the deliberate boundary before the first registry publication.\n" +
      "Remove it only when you are ready for `create-pathfinder` to exist publicly\n" +
      "and permanently under this name.",
  );
}

let status;
try {
  status = git("status", "--porcelain");
} catch {
  refuse(
    "this is not a Git repository, so the commit being published cannot be identified.",
    "Publish from a checkout of the kit repository.",
  );
}

if (status !== "") {
  refuse(
    "the working tree has uncommitted changes.",
    "npm publishes the working tree, not the commit. Commit or stash first, so\n" +
      "what reaches the registry is exactly what the tag points at.",
  );
}

let tag;
try {
  tag = git("describe", "--tags", "--exact-match");
} catch {
  refuse(
    "HEAD is not a release commit — no version tag points at it.",
    `Tag the release commit first:\n\n    git tag -a v${version} -m "v${version} — <summary>"`,
  );
}

if (tag !== `v${version}`) {
  refuse(
    `HEAD is tagged ${tag} but the package version is ${version}.`,
    "The installer mirrors the kit version exactly. Whichever is wrong, fix it\n" +
      "before publishing — a published mismatch cannot be corrected, only\n" +
      "superseded.",
  );
}

const changelog = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
if (!changelog.includes(`## [${version}]`)) {
  refuse(
    `CHANGELOG.md has no released section for ${version}.`,
    "The changelog is the source of truth for the release version. If this\n" +
      "version is real, it belongs there.",
  );
}

console.log(
  `create-pathfinder: publishing ${version} from ${tag}, ` +
    "intent confirmed and release verified.",
);
