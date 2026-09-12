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

  // The drawing controls. A producer describing a diagram reaches for these
  // first, and every one of them is the renderer deciding where something goes
  // rather than the producer saying what it is. `emphasis` belongs here for a
  // subtler reason than the rest: it is not a coordinate, but it is the
  // producer setting how much ink a thing gets. Emphasis is derived from
  // authored paths — say why it matters, and the renderer decides how loud.
  "anchor", "animation", "col", "cols", "dot", "edge_style", "emphasis",
  "importance", "lane", "lanes", "offset", "orientation", "pos", "rank",
  "route", "routing", "rx", "ry", "shape", "side", "stage", "stroke", "svg",
  "viewbox", "viewBox", "weight", "x1", "x2", "y1", "y2", "zoom",
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
