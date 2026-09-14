/**
 * The layout, as SVG.
 *
 * This module turns integers into markup and makes no spatial decisions of its
 * own: every coordinate it emits came from `layout.mjs`, and every word it
 * emits about the *subject* came from the specification. The words about the
 * *interface* — the role names under each node, the arrowhead, the title text
 * a screen reader hears — are the renderer's, defined here, the same way the
 * shell owns the chrome around a lesson.
 *
 * Each drawn thing carries the identifier it was authored under —
 * `data-pf-node`, `data-pf-edge`, `data-pf-group`. That is the only handle the
 * reading interactions use. They never ask the picture what is next to what:
 * geometry is an output of the graph, so inferring meaning back out of it would
 * make "downstream" depend on where the layout happened to put things.
 *
 * Role decides shape and stroke, and never colour alone: a diagram whose
 * meaning is carried by hue is a diagram half its readers cannot use. Each node
 * carries its role as a word, so the distinction survives greyscale, a
 * colour-vision difference, and a printer.
 */

import { esc, domId } from "../escape.mjs";
import { GEOMETRY, wrapLabel } from "./layout.mjs";

/** Renderer-owned interface language for the canvas itself. */
const UI = Object.freeze({
  roles: {
    actor: "actor",
    interface: "interface",
    service: "service",
    store: "store",
    queue: "queue",
    job: "job",
    external: "external",
    step: "step",
    decision: "decision",
    terminal: "terminal",
  },
  relations: {
    calls: "calls",
    reads: "reads",
    writes: "writes",
    publishes: "publishes",
    consumes: "consumes",
    depends_on: "depends on",
    transitions_to: "becomes",
    triggers: "triggers",
  },
  canvasLabel: "Diagram",
});

/** Corner radius by role. Shape carries meaning; colour only reinforces it. */
const RADIUS = Object.freeze({
  actor: 38, external: 38, terminal: 38,
  store: 6, queue: 6,
  decision: 20,
  interface: 10, service: 10, job: 10, step: 10,
});

/**
 * @param {object} diagram the validated `diagram` object
 * @param {object} layout  the geometry `layoutGraph` computed for it
 * @returns {string} one inline `<svg>` element
 */
export function drawGraph(diagram, layout) {
  const boxOf = new Map(layout.nodes.map((node) => [node.id, node.box]));
  const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(diagram.edges.map((edge) => [edge.id, edge]));
  const groupById = new Map((diagram.groups ?? []).map((group) => [group.id, group]));

  // Which edges an authored path walks. This is the whole of emphasis: the
  // producer said which walk matters, and the renderer decides it gets a
  // heavier stroke. There is no emphasis field and there must never be one.
  const onPath = new Set();
  for (const path of diagram.paths ?? []) {
    for (const id of path.edges) onPath.add(id);
  }

  const titleId = domId("pf", "diagram", "title");
  const out = [
    // `data-pf-graph` is the behaviour hook, and it is what the camera holds
    // on to. The class beside it is the stylesheet's; keeping the two separate
    // is the same rule the rest of the document follows -- `data-pf-canvas`,
    // `data-pf-node`, `data-pf-edge` and `data-pf-act` are all hooks a script
    // addresses, and never selectors a theme could rename out from under it.
    `<svg class="pf-graph" data-pf-graph viewBox="0 0 ${layout.width} ${layout.height}" ` +
    `role="img" aria-labelledby="${esc(titleId)}" ` +
    `xmlns="http://www.w3.org/2000/svg">`,
    `<title id="${esc(titleId)}">${esc(UI.canvasLabel)}</title>`,
    arrowDefs(),
  ];

  for (const placed of layout.groups) {
    out.push(drawGroup(groupById.get(placed.id), placed));
  }
  for (const route of layout.edges) {
    out.push(drawEdge(edgeById.get(route.id), route, onPath.has(route.id), boxOf));
  }
  for (const placed of layout.nodes) {
    out.push(drawNode(nodeById.get(placed.id), placed));
  }

  out.push("</svg>");
  return out.join("\n");
}

/**
 * One arrowhead, defined once and referenced by every edge.
 *
 * `userSpaceOnUse` rather than the stroke-scaled default, so the head is the
 * same size on a heavy path stroke as on a light one — an emphasised edge
 * should read as emphasised, not as pointing harder.
 */
function arrowDefs() {
  return [
    "<defs>",
    '<marker id="pf-arrow" markerWidth="10" markerHeight="10" refX="9" refY="4" ' +
    'markerUnits="userSpaceOnUse" orient="auto">',
    '<path d="M 0 0 L 9 4 L 0 8 z" fill="context-stroke"/>',
    "</marker>",
    "</defs>",
  ].join("\n");
}

function drawGroup(group, placed) {
  const { box } = placed;
  const id = domId("g", group.id);
  return [
    `<g class="pf-group" data-pf-group="${esc(group.id)}" ` +
    `data-pf-depth="${placed.depth}">`,
    `<rect class="pf-group-box" id="${esc(id)}" x="${box.x}" y="${box.y}" ` +
    `width="${box.w}" height="${box.h}" rx="14"/>`,
    `<text class="pf-group-label" x="${box.x + GEOMETRY.GROUP_PAD}" ` +
    `y="${box.y + 20}">${esc(group.label)}</text>`,
    "</g>",
  ].join("\n");
}

function drawNode(node, placed) {
  const { box } = placed;
  const id = domId("n", node.id);
  const lines = wrapLabel(node.label);
  const centreX = box.x + Math.floor(box.w / 2);
  // The label block is centred on the box, then the role word sits below it.
  const lineHeight = 18;
  const blockTop = box.y + Math.floor((box.h - lines.length * lineHeight) / 2) + 2;

  const text = lines.map((line, i) =>
    `<tspan x="${centreX}" y="${blockTop + i * lineHeight}">${esc(line)}</tspan>`);

  return [
    `<g class="pf-node" data-pf-node="${esc(node.id)}" ` +
    `data-pf-role="${esc(node.role)}">`,
    `<rect class="pf-node-box" id="${esc(id)}" x="${box.x}" y="${box.y}" ` +
    `width="${box.w}" height="${box.h}" rx="${RADIUS[node.role]}"/>`,
    `<text class="pf-node-label" text-anchor="middle">${text.join("")}</text>`,
    `<text class="pf-node-role" text-anchor="middle" x="${centreX}" ` +
    `y="${box.y + box.h - 12}">${esc(UI.roles[node.role])}</text>`,
    "</g>",
  ].join("\n");
}

function drawEdge(edge, route, emphasised, boxOf) {
  const points = route.points.map(([x, y]) => `${x},${y}`).join(" ");
  const id = domId("e", edge.id);
  const classes = emphasised ? "pf-edge pf-edge-on-path" : "pf-edge";

  const out = [
    `<g class="${classes}" data-pf-edge="${esc(edge.id)}" ` +
    `data-pf-relation="${esc(edge.relation)}" ` +
    `data-pf-shape="${esc(route.shape)}">`,
    `<polyline class="pf-edge-line" id="${esc(id)}" points="${points}" ` +
    `marker-end="url(#pf-arrow)"/>`,
  ];

  const label = edge.label ?? UI.relations[edge.relation];
  const anchor = labelAnchor(route.points);
  out.push(
    `<text class="pf-edge-label" text-anchor="middle" x="${anchor[0]}" ` +
    `y="${anchor[1]}">${esc(label)}</text>`);

  out.push("</g>");
  return out.join("\n");
}

/**
 * Where an edge's label sits: the midpoint of the route's longest segment.
 *
 * Longest because that is the segment with room for text, and the midpoint of
 * it because there is nowhere better that does not need to measure the label.
 * Ties go to the earlier segment, so the choice is a property of the route
 * rather than of the order a comparison happened to run in.
 */
function labelAnchor(points) {
  let best = 0;
  let bestLength = -1;
  for (let i = 1; i < points.length; i += 1) {
    const length = Math.abs(points[i][0] - points[i - 1][0])
      + Math.abs(points[i][1] - points[i - 1][1]);
    if (length > bestLength) { bestLength = length; best = i; }
  }
  const a = points[best - 1];
  const b = points[best];
  return [
    a[0] + Math.floor((b[0] - a[0]) / 2),
    a[1] + Math.floor((b[1] - a[1]) / 2) - 6,
  ];
}
