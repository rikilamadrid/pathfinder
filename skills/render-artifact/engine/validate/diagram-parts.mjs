/**
 * Every place a diagram may carry evidence, in document order, named the way a
 * reader would name it.
 *
 * Two layers need this list and they need it to agree. The structural layer
 * refuses a citation in a specification that has no source to resolve it
 * against; the evidence layer requires citations of a `derived` diagram's nodes,
 * edges and claim-bearing prose. If each walked the specification itself the two
 * would drift — one would learn about a new place evidence can live and the
 * other would not — and the drift would show up as a rule that silently stopped
 * applying to part of the document.
 *
 * So the walk is defined once, here, and both layers read it.
 *
 * `claim` is the distinction the provenance contract rests on for a group, path
 * or view: a label is a name, and a name is not a factual assertion that needs
 * backing. `summary` and `note` are prose that asserts something, so they are
 * what makes one of these claim-bearing. A node or an edge is claim-bearing by
 * existing at all — saying a component is there, or that two things relate, is
 * the assertion — which is why `claim` is not what decides their requirement.
 *
 * Imports nothing. It is walked by a layer that spawns Git and by one that does
 * not, and it has no business knowing which.
 */

/**
 * @typedef {object} EvidenceSite
 * @property {"group"|"node"|"edge"|"path"|"view"} role  what kind of thing it is
 * @property {string} subject  the thing, named for a diagnostic
 * @property {string} path     where its evidence lives, in specification terms
 * @property {object[]} evidence  the citations present, possibly none
 * @property {boolean} claim   whether it asserts something beyond its own name
 */

/**
 * @param {object} diagram a `diagram` body that passed schema validation
 * @returns {EvidenceSite[]} in document order
 */
export function diagramEvidenceSites(diagram) {
  const sites = [];

  const site = (role, subject, path, holder, claim) => {
    sites.push({ role, subject, path, evidence: holder.evidence ?? [], claim });
  };

  // Groups first, then nodes, edges, paths and views. This order is the order
  // citations are reported in, so it is fixed rather than convenient.
  (diagram.groups ?? []).forEach((group, g) => {
    site("group", `group "${group.label}"`, `diagram.groups[${g}].evidence`,
      group, group.summary !== undefined);
  });
  diagram.nodes.forEach((node, n) => {
    site("node", `node "${node.label}"`, `diagram.nodes[${n}].evidence`, node, true);
  });
  diagram.edges.forEach((edge, e) => {
    site("edge", `edge \`${edge.id}\``, `diagram.edges[${e}].evidence`, edge, true);
  });
  (diagram.paths ?? []).forEach((path, p) => {
    site("path", `path "${path.label}"`, `diagram.paths[${p}].evidence`,
      path, path.note !== undefined);
  });
  (diagram.views ?? []).forEach((view, v) => {
    site("view", `view "${view.label}"`, `diagram.views[${v}].evidence`,
      view, view.note !== undefined);
  });

  return sites;
}
