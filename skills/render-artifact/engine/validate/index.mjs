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
 * @typedef {object} LayerNotRun
 * @property {string} layer
 * @property {string} reason  why it does not apply, in the reader's terms
 */

/**
 * @typedef {object} ValidationResult
 * @property {boolean} ok
 * @property {import("./diagnostics.mjs").Diagnostic[]} diagnostics
 * @property {string[]} ran      layers that actually executed
 * @property {string[]} skipped  layers that did not, because an earlier one failed
 * @property {LayerNotRun[]} notRun  layers that did not apply, each with its reason
 * @property {number} resolvedCitations  citations that resolved at the declared commit
 */

/**
 * Why the evidence layer does not run for a specification with no source.
 *
 * It is reported, never inferred and never quietly passed. A layer that had
 * nothing to check is not a layer that checked something: reporting it as
 * `ok evidence` would put the strongest word in the report against the weakest
 * claim in it, and a reader skimming four green lines would conclude the
 * citations had been verified when there were none.
 *
 * There is nothing missing here to fix. A diagram describing an intended system
 * legitimately has no repository behind it, and the honest report of that is
 * this sentence rather than either a pass or a failure.
 */
const EVIDENCE_NOT_RUN =
  "this specification declares no source, so there is no commit to resolve " +
  "against and no citation to resolve — citations are refused outright for " +
  "such a specification. Nothing was checked here, which is not the same as " +
  "nothing being wrong.";

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
      notRun: [],
      resolvedCitations: 0,
    };
  }

  // A specification with no source has no evidence layer to run. The structural
  // layer has already refused any citation in it, so this is not a check being
  // waived — there is provably nothing for it to check.
  const sourceless = !Object.prototype.hasOwnProperty.call(spec, "source");

  // Composition and evidence are independent of one another: a duplicate
  // identifier does not make a citation unresolvable, and reporting both in one
  // pass saves a producer a second round trip.
  const composition = validateComposition(spec);
  const evidence = sourceless
    ? { diagnostics: [], resolved: 0 }
    : validateEvidence(spec, repoDir);

  const rest = [...composition, ...evidence.diagnostics];
  const result = {
    ok: rest.length === 0,
    diagnostics: rest,
    ran: sourceless
      ? ["structural", "composition"]
      : ["structural", "composition", "evidence"],
    skipped: [],
    notRun: sourceless ? [{ layer: "evidence", reason: EVIDENCE_NOT_RUN }] : [],
    resolvedCitations: evidence.resolved,
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
    const notRun = (result.notRun ?? []).find((entry) => entry.layer === group.layer);
    if (notRun) {
      lines.push(`  ~ ${group.layer}: not run — ${notRun.reason}`);
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
