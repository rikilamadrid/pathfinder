#!/usr/bin/env node
/**
 * Regenerate the committed goldens.
 *
 * Run this only when rendered output was *meant* to change — and in the same
 * commit as the `RENDERER_VERSION` bump that makes the change a release rather
 * than a determinism failure. Running it to make a red test green is how the
 * invariant stops meaning anything.
 *
 *   node scripts/regenerate-goldens.mjs
 */

import { writeFileSync } from "node:fs";

import {
  GOLDEN_DIR, SPECS, cleanUpTemporaryDirectories, deliverInSubprocess, goldenPaths,
} from "../lib/harness.mjs";

let failed = false;

for (const name of Object.keys(SPECS)) {
  const delivery = deliverInSubprocess({ spec: SPECS[name] });

  if (delivery.status !== 0) {
    process.stderr.write(
      `FAIL ${name}: the engine refused to deliver, so there is nothing to ` +
      `record.\n${JSON.stringify(delivery.receipt, null, 2)}\n`);
    failed = true;
    continue;
  }

  const { html, digest } = goldenPaths(name);
  writeFileSync(html, delivery.bytes);
  writeFileSync(digest, `${delivery.receipt.artifact.sha256}\n`, "utf8");

  process.stdout.write(
    `wrote ${name}: ${delivery.receipt.artifact.bytes} bytes, ` +
    `sha256 ${delivery.receipt.artifact.sha256}\n`);
}

cleanUpTemporaryDirectories();

if (failed) {
  process.exitCode = 1;
} else {
  process.stdout.write(
    `\nGoldens in ${GOLDEN_DIR} now describe this renderer. If that was an ` +
    `intentional\noutput change, bump RENDERER_VERSION in the same commit.\n`);
}
