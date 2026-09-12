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
 *
 * `diagram` is the engine's shipped diagram example: a second artifact kind
 * through the same pipeline, which is the thing that makes this a shared
 * renderer rather than a lesson renderer with ambitions. It cites this
 * repository, so it also proves the one citation shape carries across kinds.
 *
 * `multilingual` is the typography probe's specimen: Latin, CJK, Arabic,
 * Devanagari and emoji, each at or near the column cap. It is a fixture rather
 * than a shipped example because it exists to stress the boundary, and it is
 * the specification a human opens in three browser engines. It is `proposed`
 * and cites nothing, which makes it the specimen for the state that earns no
 * verification sentence: a source, and no citation to check against it.
 *
 * `proposed` and `intended-system` are the other two provenance states. The
 * first supplies citations for the parts of itself that exist and none for the
 * parts it is proposing; the second declares no source at all, which is the
 * case the shell had to stop assuming. Between them and `diagram`, all three
 * states a reader must be able to tell apart are delivered by the real engine
 * rather than asserted in a test.
 *
 * `installer` is a diagram of a real repository, hand-authored before any
 * producer existed to generate one. Its topology was not chosen to suit the
 * layout — it is what `npx create-pathfinder` actually does, twenty nodes and
 * thirty edges of it, with a cycle back through the human, one node written to
 * by four separate jobs, and two subsystems that meet nowhere but a JSON file.
 * That is the point: deterministic layout either survives a graph nobody
 * designed for it or it does not, and a specimen shaped to flatter the renderer
 * could not tell the difference.
 *
 * `learn-feature` and `learn-codebase` are the producers' own output, frozen.
 * Each is a real lesson its skill produced — one for a completed feature, one
 * for this repository at a milestone — copied here unchanged, not a fixture
 * shaped to pass. That is what makes them evidence about the integration
 * rather than about this package: if the producer contract and the renderer
 * contract ever disagree, they disagree here first.
 */
export const SPECS = Object.freeze({
  fixture: join(PACKAGE_ROOT, "fixtures", "deterministic-lesson.json"),
  example: join(ENGINE_ROOT, "examples", "lesson.json"),
  diagram: join(ENGINE_ROOT, "examples", "diagram.json"),
  multilingual: join(PACKAGE_ROOT, "fixtures", "multilingual-diagram.json"),
  proposed: join(PACKAGE_ROOT, "fixtures", "proposed-diagram.json"),
  "intended-system": join(PACKAGE_ROOT, "fixtures", "intended-system-diagram.json"),
  installer: join(PACKAGE_ROOT, "fixtures", "installer-diagram.json"),
  "learn-feature": join(PACKAGE_ROOT, "fixtures", "learn-feature.json"),
  "learn-codebase": join(PACKAGE_ROOT, "fixtures", "learn-codebase.json"),
});

/**
 * The specimens that are a producer skill's real output, as opposed to the two
 * the engine owns.
 *
 * Tests iterate this rather than naming a producer, so registering a third
 * producer is one line here and no new assertions. That matters beyond tidiness:
 * a suite that named its producers would let a new one land with weaker coverage
 * than the old ones, and the whole claim of Feature 50 is that the producers are
 * interchangeable from the renderer's side.
 */
export const PRODUCER_SPECIMENS = Object.freeze(["learn-feature", "learn-codebase"]);

/**
 * The diagram specimens. Every one carries geometry, which is the part of
 * rendering most able to drift between machines, so all of them are swept
 * across environments rather than only the lesson specimens that predate them.
 *
 * `installer` is in this list deliberately rather than incidentally: a diagram
 * of a real repository is the specimen most likely to expose an environment
 * dependency, because it has the most geometry to get wrong.
 */
export const DIAGRAM_SPECIMENS = Object.freeze([
  "diagram", "multilingual", "proposed", "intended-system", "installer",
]);

/**
 * The three provenance states, and which specimen delivers each.
 *
 * Tests read this rather than naming a fixture, so the claim "a reader can tell
 * these three apart" is checked against all three every time and cannot quietly
 * become a claim about two of them.
 */
export const PROVENANCE_SPECIMENS = Object.freeze({
  derived: "diagram",
  "proposed-with-citations": "proposed",
  "proposed-without-source": "intended-system",
});

/** Everything the cross-environment sweep renders. */
export const CROSS_ENVIRONMENT_SPECIMENS = Object.freeze([
  ...PRODUCER_SPECIMENS, ...DIAGRAM_SPECIMENS,
]);

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
