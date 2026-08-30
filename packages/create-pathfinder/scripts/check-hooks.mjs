#!/usr/bin/env node
/**
 * Prove that what the installer puts down is the canonical handler.
 *
 * A skill adapter is *rendered*, so freshness is checked by re-rendering and
 * comparing. A hook handler is not rendered at all — its canonical bytes are
 * shipped verbatim — so the equivalent question is different, and this script
 * asks it directly: install into a scratch directory, and compare the file
 * that lands there with the file in `src/hooks/`, byte for byte.
 *
 * That comparison is worth automating rather than eyeballing because the
 * failure it catches is silent. A handler that drifted from its canonical
 * source — a marker rewritten, a line normalised, an encoding changed on the
 * way through — still looks like a handler and still installs, and the only
 * evidence is bytes nobody reads.
 *
 * Two other properties are asserted here for the same reason, both of them
 * negative and neither visible by reading the installer:
 *
 * - a harness with no session lifecycle event receives *nothing* — no handler,
 *   no directory, no substitute;
 * - installing creates no settings file anywhere, which is what makes a
 *   generated handler inert.
 *
 *     node scripts/check-hooks.mjs
 *
 * Exits 0 when every check passes, 1 on the first failure it can report.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { HARNESSES } from "../src/harnesses/index.mjs";
import { hookPath, hookSourcePath, hooksFor, isPathfinderHook } from "../src/harnesses/hook.mjs";
import { applyHookPlan, planHooks } from "../src/install.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const problems = [];

function fail(message) {
  problems.push(message);
}

/** Every file under `root`, as forward-slashed paths relative to it. */
function treePaths(root) {
  const found = [];

  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(root, path).split(sep).join("/"));
    }
  };

  walk(root);
  return found;
}

function checkHarness(harness) {
  const scratch = mkdtempSync(join(tmpdir(), "pathfinder-hooks-"));

  try {
    const plan = planHooks([harness], { targetRoot: scratch });
    const result = applyHookPlan(plan);

    for (const error of result.errors) {
      fail(`${harness.id}: ${error.relativePath}: ${error.message}`);
    }

    const installed = treePaths(scratch);
    const expected = hooksFor(harness).map((hook) => hookPath(harness, hook));

    // Every destination gets exactly what the registry declares for it, and
    // nothing else. For a harness with no handlers that means an empty tree,
    // which is the whole of `AC-2` for every non-Claude destination.
    if (installed.join("\n") !== expected.join("\n")) {
      fail(
        `${harness.id}: installed ${installed.length ? installed.join(", ") : "nothing"}, ` +
          `expected ${expected.length ? expected.join(", ") : "nothing"}`,
      );
      return;
    }

    // No settings file, by any name, anywhere. Pathfinder owns the handler and
    // nothing else; a settings file appearing here would be the whole design
    // inverted, so it is checked rather than assumed.
    for (const path of installed) {
      if (/(^|\/)settings(\.[^/]+)?\.json$/.test(path)) {
        fail(`${harness.id}: installing wrote a settings file: ${path}`);
      }
    }

    for (const hook of hooksFor(harness)) {
      const canonical = readFileSync(hookSourcePath(hook), "utf8");
      const relativePath = hookPath(harness, hook);
      const written = readFileSync(join(scratch, ...relativePath.split("/")), "utf8");

      if (written !== canonical) {
        fail(
          `${harness.id}: ${relativePath} does not match ` +
            `${relative(PACKAGE_ROOT, hookSourcePath(hook)).split(sep).join("/")}`,
        );
      }

      // Without a marker the installer could never regenerate this file: it
      // would classify its own output as somebody else's and leave it alone
      // forever.
      if (!isPathfinderHook(canonical)) {
        fail(`${harness.id}: ${relativePath} carries no \`pathfinder:hook\` marker`);
      }

      if (statSync(join(scratch, ...relativePath.split("/"))).size === 0) {
        fail(`${harness.id}: ${relativePath} is empty`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

for (const harness of HARNESSES) checkHarness(harness);

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-hooks: ${problem}`);
  process.exit(1);
}

const total = HARNESSES.reduce((count, harness) => count + hooksFor(harness).length, 0);
console.log(`check-hooks: ${total} handler(s) match the canonical implementation`);
