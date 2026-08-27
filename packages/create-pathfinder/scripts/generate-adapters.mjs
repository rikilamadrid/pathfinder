#!/usr/bin/env node
/**
 * Write this repository's own Claude Code adapters.
 *
 * Pathfinder commits harness adapters only for the harness its own maintainers
 * use. That is Claude Code today, and it is one directory: `.claude/skills/`,
 * twenty-one small generated files. Every other harness is generated on demand by
 * users and is git-ignored here.
 *
 * Committing generated files is only tolerable because of two properties this
 * script does not implement — it borrows them. `planAdapters` and
 * `applyAdapterPlan` are the exact functions `npx create-pathfinder` runs, so
 * the committed output is dogfooding rather than a parallel implementation: if
 * the generator is wrong, maintainers see it in their own tool first. And
 * because adapters are rendered from canonical *frontmatter* alone, editing a
 * skill body — the overwhelming majority of skill changes — produces no diff
 * here at all.
 *
 * Why a script rather than a setup step: there is no root manifest to hang one
 * on, and CI forbids adding one. A contributor who never runs this would simply
 * have no native skills and notice nothing wrong, so the committed files are
 * the working environment and CI keeps them honest.
 *
 *     node scripts/generate-adapters.mjs             # write into the repository
 *     node scripts/generate-adapters.mjs --check     # exit 1 if anything is stale
 *     node scripts/generate-adapters.mjs --out DIR   # render into DIR instead
 *
 * `--check` is what CI and `validate-kit.py` use. `--out` renders into a scratch
 * directory, which is how freshness is compared without touching the checkout.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { findHarness } from "../src/harnesses/index.mjs";
import { planAdapters, applyAdapterPlan } from "../src/install.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");

/** The one harness this repository commits adapters for. See the note above. */
const HARNESS_ID = "claude-code";

function parseArguments(argv) {
  const options = { check: false, out: REPO_ROOT };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--check") {
      options.check = true;
    } else if (argument === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail("--out needs a directory");
      options.out = resolve(value);
      index += 1;
    } else if (argument.startsWith("--out=")) {
      options.out = resolve(argument.slice("--out=".length));
    } else {
      fail(`unknown option: ${argument}`);
    }
  }

  return options;
}

function fail(message) {
  console.error(`generate-adapters: ${message}`);
  process.exit(2);
}

function main() {
  const options = parseArguments(process.argv.slice(2));

  const harness = findHarness(HARNESS_ID);
  if (!harness) fail(`the registry has no harness \`${HARNESS_ID}\``);

  // The kit is read from the repository root, which is where the canonical
  // skills live — not from the staged copy inside the package, which exists
  // only during `npm pack` and may not be there at all.
  const plan = planAdapters([harness], { kitRoot: REPO_ROOT, targetRoot: options.out });

  const conflicts = plan.filter((item) => item.action === "conflict");
  const orphans = plan.filter((item) => item.action === "orphan");

  if (options.check) {
    // Stale is the interesting failure: a skill was added, removed, or had its
    // description edited, and the committed adapters were not regenerated.
    const stale = plan.filter((item) => item.action === "write");
    report(stale, conflicts, orphans);
    if (stale.length > 0 || conflicts.length > 0) {
      console.error(
        "\nRun `node packages/create-pathfinder/scripts/generate-adapters.mjs` " +
          "and commit the result.",
      );
      process.exit(1);
    }
    console.log(`generate-adapters: ${plan.length} adapter(s) up to date`);
    return;
  }

  const result = applyAdapterPlan(plan);

  for (const error of result.errors) {
    console.error(`generate-adapters: ${error.relativePath}: ${error.message}`);
  }
  report([], conflicts, orphans);

  console.log(
    `generate-adapters: ${result.generated} written, ${result.unchanged} unchanged, ` +
      `${result.conflicts.length} left alone`,
  );

  // A conflict is exactly as fatal here as it is under `--check`: the file at a
  // generated path is not one this script wrote, so freshness validation stays
  // red. Exiting 0 would let the documented repair command report success while
  // CI keeps failing.
  if (result.errors.length > 0 || conflicts.length > 0) process.exit(1);
}

/**
 * Name every file that needs a human, individually.
 *
 * Conflicts and orphans are never fixed by rerunning this script — a conflict
 * is a file this repository did not generate sitting at a generated path, and
 * an orphan outlives the skill it points at — so counting them would be the
 * one thing a maintainer cannot act on.
 */
function report(stale, conflicts, orphans) {
  for (const item of stale) {
    console.error(`stale: ${item.relativePath}`);
  }
  for (const item of conflicts) {
    console.error(`conflict: ${item.relativePath} is not a generated adapter; left alone`);
  }
  if (conflicts.length > 0) {
    console.error(
      "To regenerate a conflicted adapter, delete the file above and re-run this script.",
    );
  }
  for (const item of orphans) {
    console.error(`orphan: ${item.relativePath} names a skill this version does not ship`);
  }
}

main();
