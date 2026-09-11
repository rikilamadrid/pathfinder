/**
 * Shared machinery for the engine's tests. Deliberately not under `test/`:
 * `node --test` runs every file it finds in a directory named `test`, so a
 * helper module placed there would be executed as a test suite with no tests
 * in it.
 *
 * Everything here answers one question — *what did the real engine produce* —
 * so the suites can spend their assertions on the invariant rather than on
 * plumbing. Nothing in this file renders, digests, or decides anything itself.
 * A test whose every input it supplied itself proves nothing.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `packages/render-artifact/` — this package. */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The repository root. Two levels up, and asserted rather than assumed. */
export const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");

/** The shippable engine. These tests exercise this, never a copy of it. */
export const ENGINE_ROOT = join(REPO_ROOT, "skills", "render-artifact", "engine");
export const ENGINE_BIN = join(ENGINE_ROOT, "bin", "render.mjs");

/**
 * The two specifications under test.
 *
 * `fixture` cites nothing, so delivering it resolves no commit and reads no
 * blob. That is what makes it the right specimen for determinism: a digest
 * that moved has one suspect, the renderer, rather than two.
 *
 * `example` is the engine's shipped example and does cite the repository, so
 * it is the specimen that proves evidence resolution and the provenance block
 * on a real lesson.
 */
export const SPECS = Object.freeze({
  fixture: join(PACKAGE_ROOT, "fixtures", "deterministic-lesson.json"),
  example: join(ENGINE_ROOT, "examples", "lesson.json"),
});

export const GOLDEN_DIR = join(PACKAGE_ROOT, "golden");

/** Where a golden's HTML and its expected digest live. */
export function goldenPaths(name) {
  return {
    html: join(GOLDEN_DIR, `${name}.html`),
    digest: join(GOLDEN_DIR, `${name}.sha256`),
  };
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A process environment built from nothing, so a variable is present only
 * because a test put it there.
 *
 * `PATH` stays because the evidence layer spawns `git`, and `HOME` because Git
 * looks for a configuration file. Both are the engine's dependencies, not this
 * harness's convenience.
 */
export function bareEnv(extra = {}) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? tmpdir(),
    ...extra,
  };
}

const temporaryRoots = [];

/** A temporary directory, removed when the process exits. */
export function temporaryDirectory(prefix = "render-artifact-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

export function cleanUpTemporaryDirectories() {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
}

/**
 * Deliver a specification by running the engine's own CLI in a fresh process.
 *
 * A subprocess rather than an import, because the environment is the thing
 * under test: `TZ`, `LANG` and `LC_ALL` are read once per process by anything
 * that reads them at all, and the working directory cannot be varied for an
 * in-process call the way a real invocation varies it.
 *
 * `--repo` is always absolute and always the repository root, so a varying
 * `cwd` varies the renderer's environment without changing where evidence
 * would resolve. Anything that moves is therefore the environment, not the
 * question being asked of Git.
 *
 * @returns {{ status: number, receipt: object, html: string, bytes: Buffer,
 *             outPath: string, stderr: string }}
 */
export function deliverInSubprocess({
  spec = SPECS.fixture,
  cwd = REPO_ROOT,
  env = bareEnv(),
  repo = REPO_ROOT,
  outDirectory = temporaryDirectory(),
} = {}) {
  const outPath = join(outDirectory, "artifact.html");
  const result = spawnSync(
    process.execPath,
    [ENGINE_BIN, "deliver", spec, outPath, "--repo", repo, "--json"],
    { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  if (result.error) throw result.error;

  let receipt;
  try {
    receipt = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `the engine did not print a JSON receipt (exit ${result.status})\n` +
      `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }

  const bytes = result.status === 0 ? readFileSync(outPath) : Buffer.alloc(0);

  return {
    status: result.status,
    receipt,
    bytes,
    html: bytes.toString("utf8"),
    outPath,
    stderr: result.stderr,
  };
}

/** A short label for a delivery, used in assertion messages. */
export function describeEnvironment({ cwd, env }) {
  const named = ["TZ", "LANG", "LC_ALL"]
    .map((key) => `${key}=${env[key] ?? "unset"}`)
    .join(" ");
  return `cwd=${cwd} ${named}`;
}
