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

  const body = [
    renderLead(spec),
    `<div class="pf-canvas">${drawGraph(diagram, layout)}</div>`,
    renderComponents(diagram),
    renderRelationships(diagram),
    renderPaths(diagram),
    renderViews(diagram),
  ].filter((part) => part !== "").join("\n");

  return renderShell({
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
    verification,
  });
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
    if (members.length === 0) continue;
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
    `<div class="pf-card" id="${esc(domId("s", "n", node.id))}">`,
    `<h4 class="pf-section-title">${esc(node.label)}` +
    `<span class="pf-legend-role">${esc(node.role)}</span></h4>`,
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
      `<li id="${esc(domId("s", "e", edge.id))}">`,
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
    ].filter(Boolean).join("\n"));
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

function section(id, title, inner) {
  const out = [`<section class="pf-section" id="${esc(id)}">`];
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
