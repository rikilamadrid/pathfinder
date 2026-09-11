/**
 * The invariant, checked the only way it can be checked.
 *
 *   same specification bytes + same renderer version
 *     -> byte-identical HTML across supported environments
 *
 * `doctor`'s determinism check compares two renders inside one process. That
 * catches a renderer that varies run to run and cannot see an environment
 * dependency at all, because both renders read the same environment. So these
 * tests vary the environment for real: a fresh process per render, a working
 * directory somewhere else, a different timezone, a different locale, and a
 * set of ambient variables chosen because a renderer that reached for one
 * would produce different bytes.
 *
 * The specimen is the citation-free fixture. Its evidence layer runs and has
 * nothing to resolve, so no commit is read, no blob is fetched, and the
 * repository's history cannot be the thing that moved a digest. `--repo` still
 * names the repository root because the evidence layer asks Git whether it is
 * in a repository before it asks it anything else — a precondition of the
 * layer, not an input to rendering.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";

import { RENDERER_VERSION } from "../../../skills/render-artifact/engine/version.mjs";
import {
  SPECS, bareEnv, cleanUpTemporaryDirectories, deliverInSubprocess,
  describeEnvironment, goldenPaths, temporaryDirectory,
} from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

const EXPECTED = readFileSync(goldenPaths("fixture").digest, "utf8").trim();

/**
 * Environments chosen to move output if anything ambient reaches rendering.
 *
 * `tr_TR` is deliberate: Turkish is the locale where `"I".toLowerCase()` is
 * not `"i"`, so a single locale-sensitive case fold or `localeCompare`
 * anywhere in the render path shows up here and nowhere else. The locale need
 * not be installed on the runner for the test to mean something — an
 * uninstalled locale still varies the variables a renderer must not read.
 */
const ENVIRONMENTS = [
  {
    name: "bare",
    env: bareEnv(),
  },
  {
    name: "Turkish locale, far-future timezone",
    env: bareEnv({ TZ: "Pacific/Kiritimati", LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8" }),
  },
  {
    name: "C locale, UTC",
    env: bareEnv({ TZ: "UTC", LANG: "C", LC_ALL: "C" }),
  },
  {
    name: "German collation and number formatting, half-hour offset",
    env: bareEnv({
      TZ: "Asia/Kathmandu",
      LANG: "de_DE.UTF-8",
      LC_ALL: "de_DE.UTF-8",
      LC_COLLATE: "de_DE.UTF-8",
      LC_NUMERIC: "de_DE.UTF-8",
      LC_TIME: "de_DE.UTF-8",
    }),
  },
  {
    name: "ambient machine identity",
    // Every one of these is a value the invariant forbids in output. A
    // renderer reading any of them produces a different artifact here.
    env: bareEnv({
      TZ: "America/St_Johns",
      LANG: "ja_JP.UTF-8",
      LC_ALL: "ja_JP.UTF-8",
      HOSTNAME: "not-this-machine",
      HOST: "not-this-machine",
      USER: "nobody",
      USERNAME: "nobody",
      LOGNAME: "nobody",
      PWD: "/nowhere",
      OLDPWD: "/nowhere-else",
      SOURCE_DATE_EPOCH: "1",
      NODE_ENV: "production",
      NO_COLOR: "1",
      COLUMNS: "40",
    }),
  },
];

describe("determinism across environments", () => {
  /** Fresh directories, so `cwd` is not merely different but unrelated. */
  const workingDirectories = [
    { name: "the repository root", cwd: undefined },
    { name: "an unrelated temporary directory", cwd: temporaryDirectory("cwd-a-") },
    { name: "a directory with a space and non-ASCII in its name",
      cwd: temporaryDirectory("cwd b ünïcödé-") },
  ];

  const observed = [];

  for (const environment of ENVIRONMENTS) {
    for (const directory of workingDirectories) {
      it(`${environment.name}, from ${directory.name}`, () => {
        const options = { spec: SPECS.fixture, env: environment.env };
        if (directory.cwd !== undefined) options.cwd = directory.cwd;

        const delivery = deliverInSubprocess(options);

        assert.equal(delivery.status, 0,
          `delivery failed under ${environment.name}: ` +
          `${JSON.stringify(delivery.receipt, null, 2)}\n${delivery.stderr}`);

        observed.push({
          label: `${environment.name} / ${directory.name}`,
          digest: delivery.receipt.artifact.sha256,
        });

        assert.equal(delivery.receipt.artifact.sha256, EXPECTED,
          `the artifact digest moved under ${describeEnvironment({
            cwd: options.cwd ?? "(repository root)", env: environment.env,
          })}. Rendering read something outside the specification.`);
      });
    }
  }

  it("every environment agreed on one digest", () => {
    const distinct = new Set(observed.map((o) => o.digest));
    assert.equal(distinct.size, 1,
      `${observed.length} renders produced ${distinct.size} distinct digests:\n` +
      observed.map((o) => `  ${o.digest}  ${o.label}`).join("\n"));
    assert.equal(observed.length, ENVIRONMENTS.length * workingDirectories.length);
  });
});

describe("determinism of the renderer version itself", () => {
  it("the receipt names the version that is part of the deterministic input", () => {
    const delivery = deliverInSubprocess({ spec: SPECS.fixture });

    assert.equal(delivery.receipt.renderer_version, RENDERER_VERSION,
      "a receipt naming only the digests would describe half the compiler: " +
      "the invariant is same bytes *and* same renderer version");
  });
});

