/**
 * The renderer registry: `kind` in, HTML out.
 *
 * One entry, `lesson`, and no placeholder for anything else. A registry with a
 * stub in it invites a caller to render a kind that does not exist yet, and the
 * result would be an artifact carrying the Pathfinder identity around content
 * nothing checked. An unsupported kind is refused in the structural layer,
 * before anything reaches here.
 */

import { renderLesson } from "./lesson.mjs";

export const RENDERERS = Object.freeze({
  lesson: renderLesson,
});

/**
 * Render a validated specification.
 *
 * Deterministic by construction: the only input is the specification and this
 * module's code. Nothing here reads a clock, an environment variable, a
 * hostname, a working directory, or a locale, and no ordering comes from a
 * directory listing or a hash table — every list is emitted in the order the
 * specification wrote it.
 *
 * Rendering does not validate and does not pretend to. Called without an
 * attestation — the ordinary case, and the only one available to an outside
 * caller — the artifact carries its provenance rows and no claim to have been
 * checked. Only `deliver()`, which validates first, can supply one.
 *
 * @param {object} spec a specification whose `kind` this engine renders
 * @param {object} [verification] an attestation minted from a passing
 *        validation. Cannot be forged: see `verification.mjs`.
 * @returns {string} a complete, self-contained HTML document
 */
export function render(spec, verification) {
  const renderer = RENDERERS[spec.kind];
  if (!renderer) {
    throw new Error(
      `no renderer for kind ${JSON.stringify(spec.kind)}; this should have been ` +
      `refused by the structural layer`);
  }
  return renderer(spec, verification);
}
