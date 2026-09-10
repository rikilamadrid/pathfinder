/**
 * The validation layers, run in order and reported apart.
 *
 * Layers stay separate all the way to the caller. Collapsing them into one
 * boolean is the failure this design exists to prevent: "valid" is not a claim,
 * and each of these layers supports a different one.
 */

import { validateStructure } from "./structural.mjs";
import { validateComposition } from "./composition.mjs";
import { validateEvidence } from "./evidence.mjs";
import { byLayer, LAYER_CLAIMS } from "./diagnostics.mjs";
import { markPassed } from "../verification.mjs";

export { LAYERS, LAYER_CLAIMS, byLayer, diagnostic } from "./diagnostics.mjs";
export { KINDS } from "./structural.mjs";

// Deliberately not re-exported here: `attest` and `isAttestation`.
// `verification.mjs` is the one module they are imported from. A second
// door onto the surface that gates an artifact's truth claim buys nothing
// and gives a future caller somewhere else to look.

/**
 * @typedef {object} ValidationResult
 * @property {boolean} ok
 * @property {import("./diagnostics.mjs").Diagnostic[]} diagnostics
 * @property {string[]} ran      layers that actually executed
 * @property {string[]} skipped  layers that did not, because an earlier one failed
 */

/**
 * @param {unknown} spec
 * @param {{ repoDir: string }} options  where evidence resolves
 * @returns {ValidationResult}
 */
export function validateSpecification(spec, { repoDir }) {
  const structural = validateStructure(spec);
  if (structural.length > 0) {
    return {
      ok: false,
      diagnostics: structural,
      ran: ["structural"],
      skipped: ["composition", "evidence"],
    };
  }

  // Composition and evidence are independent of one another: a duplicate
  // identifier does not make a citation unresolvable, and reporting both in one
  // pass saves a producer a second round trip.
  const rest = [...validateComposition(spec), ...validateEvidence(spec, repoDir)];
  const result = {
    ok: rest.length === 0,
    diagnostics: rest,
    ran: ["structural", "composition", "evidence"],
    skipped: [],
  };

  // Brand the pass. This is the only place a result becomes something an
  // attestation can be minted from, so a verification claim in an artifact
  // traces back to this line and to no other.
  return result.ok ? markPassed(result) : result;
}

/** Human-readable layer report. Ordering comes from `LAYERS`, never from a hash. */
export function formatReport(result) {
  const lines = [];
  for (const group of byLayer(result.diagnostics)) {
    if (group.layer === "delivery") continue;
    if (result.skipped.includes(group.layer)) {
      lines.push(`  ~ ${group.layer}: not run — an earlier layer failed`);
      continue;
    }
    if (group.diagnostics.length === 0) {
      lines.push(`  ok ${group.layer}: ${LAYER_CLAIMS[group.layer]}`);
      continue;
    }
    lines.push(`  FAIL ${group.layer}: ${group.diagnostics.length} problem(s)`);
    for (const d of group.diagnostics) {
      lines.push(`       [${d.code}] ${d.path}`);
      lines.push(`       ${d.message}`);
    }
  }
  return lines.join("\n");
}
