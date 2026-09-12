/**
 * The semantic index a reader's interactions run on, and the traversal that
 * runs on it.
 *
 * **Interactions read the graph, never the picture.** Downstream of a node is
 * decided by following directed edges the producer authored, not by asking
 * which boxes happen to sit to the right of it or which polylines happen to
 * touch. Geometry is a rendering of the graph and is the wrong thing to infer
 * meaning from: two nodes can be adjacent on the canvas and unrelated in the
 * system, an edge can route past a node it has nothing to do with, and a
 * layout change would silently change what "downstream" meant. So the model
 * below is built from `nodes` and `edges` and consulted by id.
 *
 * **The model is an index, never content.** Ids, labels, adjacency, and each
 * path's exact ordered edge ids — and nothing else. No summary, no detail, no
 * citation, no evidence. Every one of those is already in the document as
 * text, which is what lets the artifact be read with scripting off; putting a
 * second copy in a script would be the one way to make a fact exist only
 * behind an interaction, and that is precisely what the progressive
 * enhancement contract forbids.
 *
 * **Nothing here is producer-authored.** There is no traversal field, no
 * reachable-set field, no adjacency in the specification. All of it is derived,
 * because all of it is derivable: a producer who could hand-write an adjacency
 * list could hand-write one that disagreed with its own edges, and then the
 * diagram and its behaviour would be two different claims.
 *
 * Imports nothing. This is on the render path, which reaches no `node:`
 * builtin by design.
 */

/**
 * @typedef {object} InteractionModel
 * @property {string[]} nodes  node ids, in specification order
 * @property {Record<string,string>} labels  node id to its label, for the
 *           renderer's own status line. A label is a name, not a claim.
 * @property {Record<string,[string,string][]>} out  node id to [edge id, target]
 * @property {Record<string,[string,string][]>} in   node id to [edge id, source]
 * @property {Record<string,[string,string]>} edges  edge id to [source, target]
 * @property {Record<string,string[]>} paths  path id to its authored edge ids,
 *           in order, exactly as written
 */

/**
 * Build the index for one validated diagram.
 *
 * Adjacency is keyed by node and carries the **edge id** alongside the
 * neighbour, not just the neighbour. That is what keeps two edges joining one
 * pair distinguishable: a traversal that recorded only "from `a` you can reach
 * `b`" would lose which of the two relationships it walked, and highlighting
 * would then light up both — reporting a claim the producer did not make.
 *
 * Ordering is specification order throughout, so the serialized model is a
 * pure function of the specification.
 *
 * @param {object} diagram a `diagram` body that passed validation
 * @returns {InteractionModel}
 */
export function interactionModel(diagram) {
  const nodes = diagram.nodes.map((node) => node.id);

  const labels = {};
  for (const node of diagram.nodes) labels[node.id] = node.label;

  const out = {};
  const inbound = {};
  for (const id of nodes) {
    out[id] = [];
    inbound[id] = [];
  }

  // Edge id to its endpoints. This is what makes a path highlight exact: a
  // path names edge ids, and lighting up the nodes a path touches has to start
  // from the edges the producer wrote rather than from any pair of nodes that
  // happen to be joined somehow.
  const edges = {};

  for (const edge of diagram.edges) {
    // Endpoints resolved by the composition layer before this runs, so an
    // edge naming a node that does not exist cannot reach here. The guards are
    // still here because a model that silently dropped an edge would make
    // traversal quietly wrong rather than loudly broken.
    if (out[edge.from] !== undefined) out[edge.from].push([edge.id, edge.to]);
    if (inbound[edge.to] !== undefined) inbound[edge.to].push([edge.id, edge.from]);
    edges[edge.id] = [edge.from, edge.to];
  }

  const paths = {};
  for (const path of diagram.paths ?? []) paths[path.id] = [...path.edges];

  return { nodes, labels, out, in: inbound, edges, paths };
}

/**
 * The traversal, as the source that ships.
 *
 * This is a string rather than a function for one reason: it is emitted into
 * the artifact, and it is also the thing the tests run. Writing it twice —
 * once for the browser and once for Node — would leave two implementations
 * free to disagree about what "downstream" means, and the one that shipped
 * would be the one nobody had tested. The test evaluates this exact text.
 *
 * Breadth-first over the index, with a visited set, which is what makes the
 * three awkward graph shapes safe rather than special-cased:
 *
 *   a cycle          a node already visited is not queued again, so a ring
 *                    terminates instead of spinning
 *   a self-edge      the node is already visited when its own edge is read,
 *                    so `a -> a` adds the edge and queues nothing
 *   repeated edges   both are recorded, because the frontier is keyed by node
 *                    and the result keeps edge ids separately
 *
 * The start node is reported in `nodes` — a reader tracing downstream of a
 * thing is still looking at that thing — and every edge crossed is reported in
 * `edges`, so the caller can light up exactly the relationships walked rather
 * than every relationship between the nodes involved.
 */
export const TRAVERSAL_JS = `
function pfTraverse(model, start, direction) {
  var adjacency = direction === "in" ? model["in"] : model.out;
  if (!adjacency || !adjacency[start]) return { nodes: [start], edges: [] };

  var seenNodes = Object.create(null);
  var seenEdges = Object.create(null);
  var nodes = [];
  var edges = [];
  var queue = [start];

  seenNodes[start] = true;
  nodes.push(start);

  while (queue.length > 0) {
    var current = queue.shift();
    var next = adjacency[current] || [];

    for (var i = 0; i < next.length; i += 1) {
      var edgeId = next[i][0];
      var neighbour = next[i][1];

      /* Every edge crossed is recorded, including one that leads somewhere
         already reached. Two edges joining one pair are two claims, and a
         traversal that kept only the first would highlight the wrong one. */
      if (!seenEdges[edgeId]) {
        seenEdges[edgeId] = true;
        edges.push(edgeId);
      }

      /* A node already reached is never queued again. This single guard is
         what terminates a cycle and what stops a self-edge looping. */
      if (!seenNodes[neighbour]) {
        seenNodes[neighbour] = true;
        nodes.push(neighbour);
        queue.push(neighbour);
      }
    }
  }

  return { nodes: nodes, edges: edges };
}
`.trim();

/**
 * Serialize the model for the artifact.
 *
 * `JSON.stringify` with no spacing, and with the keys written in the order
 * this module builds them, so the bytes are a function of the specification
 * and this file. The closing-tag guard matters: a producer label containing
 * `</script>` would otherwise end the script element early and put the rest of
 * the model into the document as text. Escaping the slash keeps the JSON
 * identical to the parser and inert to the HTML tokenizer.
 */
export function serializeModel(model) {
  return JSON.stringify(model).replace(/<\/script/gi, "<\\/script");
}
