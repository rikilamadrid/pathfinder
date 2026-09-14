/**
 * The `diagram` renderer.
 *
 * A diagram artifact is two readings of one set of facts. The canvas is the
 * picture; everything below it is the same graph as text — every node with its
 * role and description, every relationship, every authored walk, every view,
 * and every citation. Both are emitted into the document, which is what lets
 * the artifact be read with no scripting at all, and what the interactions in
 * a later ticket will attach to rather than generate.
 *
 * Nothing here decides where anything goes. `layout.mjs` owns geometry,
 * `draw.mjs` owns the markup for it, and this module owns the page around
 * them — which sections exist, what they are called, and in what order. Every
 * word naming a section is renderer interface language; every word inside one
 * came from the specification.
 */

import { esc, domId } from "./escape.mjs";
import { renderShell, renderNav } from "./shell.mjs";
import { layoutGraph } from "./graph/layout.mjs";
import { drawGraph } from "./graph/draw.mjs";
import { GRAPH_CSS } from "./graph/style.mjs";
import { graphBehavior } from "./graph/behavior.mjs";
import { interactionModel, serializeModel } from "./graph/interaction.mjs";

/**
 * Where the skip link lands when the explorer is the presentation on screen.
 *
 * A literal rather than a `domId` composition, for the same reason `pf-content`
 * in the shell is one: it names a fixed part of the page shape, not a thing the
 * producer identified, so no specification identifier reaches it and it is the
 * same string in every artifact.
 */
const MAP_ID = "pf-map";

/** Renderer-owned interface language. The producer supplies none of this. */
const UI = Object.freeze({
  eyebrow: "Pathfinder diagram",
  navLabel: "In this diagram",
  components: "Components",
  ungrouped: "Not in a boundary",
  relationships: "Relationships",
  paths: "Paths",
  views: "Views",
  evidence: "Evidence",
  walks: "Walks",
  focuses: "Focuses on",
  canvasLabel: "Diagram canvas. Arrow keys pan, plus and minus zoom, 0 fits.",
  toolbar: "Diagram controls",
  // The scale readout's accessible name. The visible text is the live
  // percentage the script writes; this is what a screen reader hears instead
  // of a bare number.
  scaleLabel: "Current zoom",
  reading: "Full reading",
  nothing: "Nothing selected. Choose a component to focus it.",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  fit: "Fit",
  reset: "Reset",
  upstream: "Upstream",
  downstream: "Downstream",
  details: "Go to details",
  clear: "Clear",
  focusOne: "Focus",
  highlight: "Highlight",
  relations: {
    calls: "calls",
    reads: "reads",
    writes: "writes",
    publishes: "publishes to",
    consumes: "consumes from",
    depends_on: "depends on",
    transitions_to: "becomes",
    triggers: "triggers",
  },
});

/**
 * @param {object} spec a `diagram` specification
 * @param {object} [verification] an attestation, passed through to the shell
 * @returns {string} a complete HTML document
 */
export function renderDiagram(spec, verification) {
  const { diagram } = spec;
  const layout = layoutGraph(diagram);

  const groups = diagram.groups ?? [];
  const views = diagram.views ?? [];
  const nav = renderNav([
    ...groups.map((group) => ({ id: domId("s", "g", group.id), label: group.label })),
    ...views.map((view) => ({ id: domId("s", "v", view.id), label: view.label })),
  ], UI.navLabel);

  // The stage is the map and the controls that drive it. The body is the same
  // graph written out — every component, relationship, walk, view and citation
  // — and it stays a full part of the document rather than something the canvas
  // replaced. With no scripting the stage is a picture and the body is the
  // artifact, which is the whole of the progressive-enhancement bargain.
  const stage = [
    renderLead(spec),
    renderTools(),
    // `id` so the shell's one skip link can be aimed here when the enhanced
    // explorer has closed the written reading, and `tabindex` so landing on it
    // actually moves focus rather than only moving the sequential navigation
    // point. Both are as true with no scripting as with it: the canvas is a
    // real keyboard surface either way.
    `<div class="pf-canvas" id="${esc(MAP_ID)}" data-pf-canvas tabindex="0" ` +
    `role="group" aria-label="${esc(UI.canvasLabel)}">` +
    `${drawGraph(diagram, layout)}</div>`,
  ].join("\n");

  const body = [
    renderComponents(diagram),
    renderRelationships(diagram),
    renderPaths(diagram),
    renderViews(diagram),
  ].filter((part) => part !== "").join("\n");

  return renderShell({
    layout: "explorer",
    stage,
    lang: spec.artifact.locale ?? "en",
    title: spec.artifact.title,
    eyebrow: UI.eyebrow,
    description: spec.artifact.summary ?? spec.artifact.subtitle,
    style: GRAPH_CSS,
    nav,
    body,
    source: spec.source,
    // Handed over, never interpreted here. Which of the three things an
    // artifact may say about its own provenance is the shell's decision and the
    // shell's wording; this renderer's only part in it is reporting what the
    // specification declared.
    provenance: spec.provenance,
    // The reading interactions run on this index and on nothing else. It is
    // derived from the specification, carries no summary, detail or citation,
    // and is therefore incapable of being the only place a fact lives.
    behavior: graphBehavior(serializeModel(interactionModel(diagram))),
    verification,
  });
}

/**
 * The controls, and the line that says what is selected.
 *
 * `hidden` in the delivered document and revealed by the script, which is the
 * same bargain the shell's theme toggle strikes: a control that cannot work is
 * not offered. Without scripting a reader meets no dead buttons, and loses
 * nothing they could have read — every fact these controls navigate to is
 * already written out below the canvas.
 */
function renderTools() {
  const button = (action, text, extra = "") =>
    `<button type="button" class="pf-tool" data-pf-act="${esc(action)}"${extra}>` +
    `${esc(text)}</button>`;

  return [
    '<div class="pf-graph-tools" data-pf-controls hidden>',
    `<div class="pf-toolbar" role="toolbar" aria-label="${esc(UI.toolbar)}">`,
    button("zoom-out", UI.zoomOut),
    button("zoom-in", UI.zoomIn),
    button("fit", UI.fit),
    // The camera's own readout, beside the control that resets it. The script
    // writes the percentage; shipped as "100%" so the control is never blank
    // and the delivered bytes already say where the camera starts.
    `<span class="pf-tool-scale" data-pf-scale role="img" ` +
    `aria-label="${esc(UI.scaleLabel)}">100%</span>`,
    button("reset", UI.reset),
    '<span class="pf-tool-sep" aria-hidden="true"></span>',
    button("upstream", UI.upstream, " disabled"),
    button("downstream", UI.downstream, " disabled"),
    button("details", UI.details, " disabled"),
    button("clear", UI.clear, " disabled"),
    '<span class="pf-tool-sep" aria-hidden="true"></span>',
    // The explicit secondary route into the written reading, and the only
    // control that takes the reader off the map. Inside the controls block, so
    // the same script that can honour it is the one that reveals it: with no
    // scripting the reading is simply already there, and no control promising
    // to open it is offered.
    button("reading", UI.reading, ' aria-expanded="false"'),
    "</div>",
    `<p class="pf-graph-status" data-pf-status aria-live="polite">` +
    `${esc(UI.nothing)}</p>`,
    "</div>",
  ].join("\n");
}

function renderLead(spec) {
  const { artifact } = spec;
  const out = ['<div class="pf-lead">', `<h1>${esc(artifact.title)}</h1>`];
  if (artifact.subtitle) {
    out.push(`<p class="pf-lead-sub">${esc(artifact.subtitle)}</p>`);
  }
  if (artifact.summary) {
    out.push(`<div class="pf-lead-summary"><p>${esc(artifact.summary)}</p></div>`);
  }
  out.push("</div>");
  return out.join("\n");
}

/**
 * The nodes, under the boundary each belongs to.
 *
 * Groups come first in specification order, then whatever belongs to no group.
 * A node appears exactly once, so the list is the graph's node set rather than
 * a view of it.
 */
function renderComponents(diagram) {
  const groups = diagram.groups ?? [];
  const blocks = [];

  for (const group of groups) {
    const members = diagram.nodes.filter((node) => node.group === group.id);

    // A group with no members of its own is still written out when it has
    // something to say. A parent group holds other groups rather than nodes,
    // so skipping it for having no members dropped its summary and — worse —
    // its citations: the evidence layer requires a claim-bearing group to cite
    // its claim, and the reader was then never shown either. A label-only
    // group with no members has nothing to write and is represented by its
    // boundary on the canvas.
    const hasSomethingToSay = group.summary !== undefined
      || (group.evidence ?? []).length > 0;
    if (members.length === 0 && !hasSomethingToSay) continue;

    blocks.push(section(domId("s", "g", group.id), group.label, [
      group.summary ? `<p class="pf-module-summary">${esc(group.summary)}</p>` : "",
      renderEvidence(group.evidence),
      members.map(renderNode).join("\n"),
    ].filter(Boolean).join("\n")));
  }

  const loose = diagram.nodes.filter((node) =>
    node.group === undefined || !groups.some((group) => group.id === node.group));
  if (loose.length > 0) {
    blocks.push(section(domId("s", "ungrouped"), UI.ungrouped,
      loose.map(renderNode).join("\n")));
  }

  return blocks.length === 0 ? "" : heading(UI.components) + blocks.join("\n");
}

function renderNode(node) {
  const out = [
    `<div class="pf-card" id="${esc(domId("s", "n", node.id))}" ` +
    `data-pf-entry="node" data-pf-for="${esc(node.id)}">`,
    `<h4 class="pf-section-title">${esc(node.label)}` +
    `<span class="pf-legend-role">${esc(node.role)}</span>` +
    // Named for the component rather than "Focus" twenty times over: a
    // reader listing the page's buttons has to be able to tell them apart.
    `<span class="pf-pick" data-pf-controls hidden>` +
    `<button type="button" class="pf-tool" data-pf-pick="${esc(node.id)}" ` +
    `aria-label="${esc(`${UI.focusOne} ${node.label}`)}">${esc(UI.focusOne)}` +
    `</button></span></h4>`,
  ];
  if (node.summary) out.push(`<p>${esc(node.summary)}</p>`);
  for (const paragraph of node.detail ?? []) out.push(`<p>${esc(paragraph)}</p>`);
  const evidence = renderEvidence(node.evidence);
  if (evidence) out.push(evidence);
  out.push("</div>");
  return out.join("\n");
}

function renderRelationships(diagram) {
  if (diagram.edges.length === 0) return "";
  const labelOf = new Map(diagram.nodes.map((node) => [node.id, node.label]));

  const rows = diagram.edges.map((edge) => {
    const out = [
      `<li id="${esc(domId("s", "e", edge.id))}" data-pf-entry="edge" ` +
      `data-pf-for="${esc(edge.id)}">`,
      `<span class="pf-step-title">${esc(labelOf.get(edge.from) ?? edge.from)}</span> `,
      `<span class="pf-relation">${esc(UI.relations[edge.relation])}</span> `,
      `<span class="pf-step-title">${esc(labelOf.get(edge.to) ?? edge.to)}</span>`,
    ];
    if (edge.label) out.push(`<p class="pf-step-detail">${esc(edge.label)}</p>`);
    const evidence = renderEvidence(edge.evidence);
    if (evidence) out.push(evidence);
    out.push("</li>");
    return out.join("");
  });

  return heading(UI.relationships)
    + section(domId("s", "relationships"), "",
      `<ul class="pf-legend">${rows.join("\n")}</ul>`);
}

/**
 * The authored walks, expanded from the edge ids they name.
 *
 * A path names edges rather than nodes so the claim is exact, and this is where
 * that pays off for a reader: the walk below is the edges the producer chose,
 * in order, even where two of them join the same pair of things.
 */
function renderPaths(diagram) {
  const paths = diagram.paths ?? [];
  if (paths.length === 0) return "";

  const labelOf = new Map(diagram.nodes.map((node) => [node.id, node.label]));
  const edgeById = new Map(diagram.edges.map((edge) => [edge.id, edge]));

  const blocks = paths.map((path) => {
    const steps = path.edges.map((id) => {
      const edge = edgeById.get(id);
      if (edge === undefined) return "";
      return `<li>${esc(labelOf.get(edge.from) ?? edge.from)} ` +
        `<span class="pf-relation">${esc(UI.relations[edge.relation])}</span> ` +
        `${esc(labelOf.get(edge.to) ?? edge.to)}` +
        (edge.label ? ` — ${esc(edge.label)}` : "") + "</li>";
    }).filter(Boolean);

    return section(domId("s", "p", path.id), path.label, [
      path.note ? `<p class="pf-module-summary">${esc(path.note)}</p>` : "",
      `<div class="pf-kicker">${esc(UI.walks)}</div>`,
      `<ol class="pf-walk">${steps.join("\n")}</ol>`,
      renderEvidence(path.evidence),
      `<div class="pf-pick" data-pf-controls hidden>` +
      `<button type="button" class="pf-tool" data-pf-act="path" ` +
      `data-pf-path="${esc(path.id)}" ` +
      `aria-label="${esc(`${UI.highlight} ${path.label}`)}">` +
      `${esc(UI.highlight)}</button></div>`,
    ].filter(Boolean).join("\n"), `data-pf-entry="path" data-pf-for="${esc(path.id)}"`);
  });

  return heading(UI.paths) + blocks.join("\n");
}

function renderViews(diagram) {
  const views = diagram.views ?? [];
  if (views.length === 0) return "";
  const labelOf = new Map(diagram.nodes.map((node) => [node.id, node.label]));

  const blocks = views.map((view) => section(domId("s", "v", view.id), view.label, [
    view.note ? `<p class="pf-module-summary">${esc(view.note)}</p>` : "",
    `<div class="pf-kicker">${esc(UI.focuses)}</div>`,
    `<ul class="pf-legend">${view.focus.map((id) =>
      `<li>${esc(labelOf.get(id) ?? id)}</li>`).join("")}</ul>`,
    renderEvidence(view.evidence),
  ].filter(Boolean).join("\n")));

  return heading(UI.views) + blocks.join("\n");
}

function heading(text) {
  return `<h2 class="pf-module-title">${esc(text)}</h2>`;
}

function section(id, title, inner, attributes = "") {
  const out = [
    `<section class="pf-section" id="${esc(id)}"` +
    `${attributes ? ` ${attributes}` : ""}>`,
  ];
  if (title) out.push(`<h3 class="pf-section-title">${esc(title)}</h3>`);
  out.push('<div class="pf-card">', inner, "</div>", "</section>");
  return out.join("\n");
}

/**
 * Citations, in the presentation the lesson renderer already established.
 *
 * Identical on purpose. A reader who has learnt to read evidence in a lesson
 * has learnt to read it here, and the shape is the shared `citation` from the
 * common contract rather than anything this kind invented.
 */
function renderEvidence(evidence) {
  if (!evidence || evidence.length === 0) return "";
  return [
    '<div class="pf-evidence">',
    `<div class="pf-evidence-label">${esc(UI.evidence)}</div>`,
    "<ul>",
    ...evidence.map((citation) => {
      const parts = [`<span class="pf-cite-path">${esc(citation.path)}</span>`];
      if (citation.lines) {
        parts.push(`<span class="pf-cite-lines">lines ${citation.lines[0]}` +
          `–${citation.lines[1]}</span>`);
      }
      if (citation.commit) {
        parts.push(`<span class="pf-cite-commit">@ ${esc(citation.commit)}</span>`);
      }
      return `<li>${parts.join("")}</li>`;
    }),
    "</ul>",
    "</div>",
  ].join("\n");
}
