/**
 * The copier.
 *
 * Split in two on purpose. `planInstall` decides what would happen and touches
 * nothing; `applyPlan` carries a plan out. That split is what makes --dry-run
 * honest — it runs the identical planning code the real install runs, rather
 * than a parallel description of it that can drift.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import { COPY_LIST, isExcluded } from "./kit.mjs";

/**
 * Decide the fate of every file in the kit. Reads only; writes nothing.
 *
 * Existing files are detected one file at a time rather than one top-level
 * entry at a time. A project that already has `context/` gets the files it is
 * missing and keeps the ones it wrote, instead of the whole directory being
 * declared present and skipped.
 *
 * @returns {{relativePath: string, source: string, destination: string,
 *            status: "write" | "skip" | "overwrite"}[]}
 */
export function planInstall(kitRoot, targetRoot, { force = false } = {}) {
  const plan = [];

  for (const entry of COPY_LIST) {
    for (const source of walkFiles(join(kitRoot, entry))) {
      const relativePath = relative(kitRoot, source).split(sep).join("/");
      const destination = join(targetRoot, relativePath);
      const exists = existsSync(destination);

      plan.push({
        relativePath,
        source,
        destination,
        status: !exists ? "write" : force ? "overwrite" : "skip",
      });
    }
  }

  return plan.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Carry out a plan.
 *
 * Failures are collected rather than thrown, so one unwritable path reports
 * itself alongside everything that did succeed instead of aborting the run
 * halfway with no summary. Entries marked `skip` are never opened.
 *
 * @returns {{written: number, skipped: number, overwritten: number,
 *            errors: {relativePath: string, message: string}[]}}
 */
export function applyPlan(plan, { dryRun = false } = {}) {
  const result = { written: 0, skipped: 0, overwritten: 0, errors: [] };

  for (const item of plan) {
    if (item.status === "skip") {
      result.skipped += 1;
      continue;
    }

    if (!dryRun) {
      try {
        mkdirSync(dirname(item.destination), { recursive: true });
        copyFileSync(item.source, item.destination);
      } catch (error) {
        result.errors.push({
          relativePath: item.relativePath,
          message: error.message,
        });
        continue;
      }
    }

    if (item.status === "overwrite") result.overwritten += 1;
    else result.written += 1;
  }

  return result;
}

/** Every file under `path`, recursively, minus junk. A file yields itself. */
function* walkFiles(path) {
  const stats = statSync(path);

  if (!stats.isDirectory()) {
    yield path;
    return;
  }

  for (const child of readdirSync(path).sort()) {
    if (isExcluded(child)) continue;
    yield* walkFiles(join(path, child));
  }
}
