/**
 * The one diagnostic shape, and the layers that produce it.
 *
 * Four layers, each supporting a distinct claim and reported distinctly. A
 * caller that collapses them into "valid / invalid" throws away the only thing
 * that makes the result honest: *which* claim was checked. Delivery validation
 * proves the artifact was checked; it never proves the artifact looks correct.
 */

/** The layers, in the order they run. Later layers assume earlier ones passed. */
export const LAYERS = Object.freeze(["structural", "composition", "evidence", "delivery"]);

/** What each layer's passing result does and does not entitle a caller to say. */
export const LAYER_CLAIMS = Object.freeze({
  structural: "the specification satisfies its schema",
  composition: "identifiers, references, graphs, and answers are coherent",
  evidence: "every citation resolves at the declared commit",
  delivery: "the artifact was rendered, digested, and committed atomically",
});

/**
 * @typedef {object} Diagnostic
 * @property {"structural"|"composition"|"evidence"|"delivery"} layer
 * @property {string} code     stable, greppable, never localised
 * @property {string} path     where in the specification, in reader terms
 * @property {string} message  what is wrong
 * @property {string} [subject] the thing being talked about, named by title or id
 */

/** @returns {Diagnostic} */
export function diagnostic(layer, code, path, message, subject) {
  const result = { layer, code, path, message };
  if (subject !== undefined) result.subject = subject;
  return result;
}

/**
 * Property names that are presentation control, rejected rather than ignored.
 *
 * `additionalProperties: false` already rejects every one of these — this list
 * exists to change the *diagnostic*, not the outcome. "`color` is not part of
 * this contract" is true but unhelpful; a producer who wrote it believed
 * presentation was theirs to set, and the error should say so. Matched on the
 * property name at any depth, because that is the level at which the mistake
 * is made.
 */
export const PRESENTATION_CONTROLS = Object.freeze(new Set([
  "align", "background", "background_color", "backgroundColor", "border",
  "class", "class_name", "className", "color", "colors", "colour", "column",
  "coordinates", "css", "font", "font_family", "font_size", "fontSize",
  "gap", "grid", "height", "html", "icon", "layout", "margin", "padding",
  "position", "preset", "size", "spacing", "style", "styles", "template",
  "theme", "theme_default", "variant", "width", "x", "y", "z_index", "zIndex",
]));

/** Is this property name one a producer must never control? */
export function isPresentationControl(name) {
  return PRESENTATION_CONTROLS.has(name);
}

/**
 * Group diagnostics by layer, preserving order within each.
 * Returned as an array in `LAYERS` order so reporting never depends on
 * insertion or hash order.
 */
export function byLayer(diagnostics) {
  return LAYERS.map((layer) => ({
    layer,
    claim: LAYER_CLAIMS[layer],
    diagnostics: diagnostics.filter((d) => d.layer === layer),
  }));
}
