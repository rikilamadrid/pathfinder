/**
 * Proof that this engine validated something, in a form a caller cannot fake.
 *
 * The rule this exists to enforce:
 *
 *   render()   does not prove validation
 *   validate() does not prove delivery
 *   deliver()  may claim verification only after performing it
 *
 * An artifact carries a sentence in its provenance block saying its evidence
 * was checked against the named commit. That sentence is worth exactly what it
 * costs to obtain. Before this module it cost nothing: `render()` is a public
 * export, so any caller could hand it an unvalidated specification and get back
 * a page asserting that every citation had been verified.
 *
 * So the claim is now gated on an attestation, and an attestation can only be
 * minted from a validation result this engine produced and that passed. The
 * brand is a module-private symbol — not `Symbol.for`, so it is not reachable
 * through the global registry, and not a string key a caller could guess and
 * set. `attest()` refuses anything unbranded, which means the only route to a
 * verification claim is to actually pass validation.
 *
 * Deliberately importable by the render path: this file imports nothing at all,
 * so it does not put a `node:` builtin anywhere near rendering.
 *
 * There is no producer-facing counterpart. No `verified`, no
 * `validation_status`, no field of any name in the specification can influence
 * this — a producer asserting its own work was checked is precisely the claim
 * this module exists to make impossible.
 */

const PASSED = Symbol("pathfinder.render-artifact.validated");

/**
 * Brand a passing validation result. Called by the validator, and nowhere else.
 * The brand is non-enumerable, so it never reaches JSON, a receipt, or a log.
 */
export function markPassed(result) {
  Object.defineProperty(result, PASSED, { value: true, enumerable: false });
  return result;
}

/**
 * Mint an attestation from a validation this engine performed and that passed.
 *
 * The attestation carries *what* passed, not merely that something did, because
 * the sentence an artifact is entitled to depends on it. `layers` says which
 * layers ran — the evidence layer does not run for a specification with no
 * source — and `resolvedCitations` says how many citations actually resolved at
 * the declared commit.
 *
 * That count is the guard against a vacuous claim. A specification carrying no
 * citations passes the evidence layer by having nothing to fail, and an artifact
 * that said "every citation above was verified" on the strength of that would be
 * making a stronger statement than anyone made. Zero is therefore a number the
 * shell reads and declines to claim on, rather than a pass it cannot see.
 *
 * @throws when handed anything else — an unbranded object, a hand-built
 *         `{ ok: true }`, or a result that failed.
 */
export function attest(result) {
  if (!result || result[PASSED] !== true) {
    throw new Error(
      "a verification claim can only be minted from a validation this engine " +
      "performed and that passed; nothing else can vouch for an artifact");
  }
  return markPassed({
    layers: Object.freeze([...result.ran]),
    resolvedCitations: result.resolvedCitations ?? 0,
  });
}

/** Is this a real attestation? Used by the shell to decide whether to claim. */
export function isAttestation(value) {
  return Boolean(value) && value[PASSED] === true;
}
