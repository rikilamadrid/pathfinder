/**
 * Where everything goes. The renderer's half of the boundary, in integers.
 *
 * The producer said what exists and what relates to what. Nothing it wrote
 * mentions a coordinate, and nothing here asks it to: rank, order, axis,
 * position, size and route are all computed from the graph's own shape.
 *
 * Four rules keep this deterministic, and they are the reason the algorithms
 * below are duller than they could be:
 *
 * 1. **Every number is an integer.** Not rounded on the way out — integer all
 *    the way through. No transcendental math, so nothing depends on an engine's
 *    `Math.sin`; no division that does not floor; no floating-point comparison
 *    anywhere. Barycentres are compared as exact fractions by cross-multiplying
 *    two integers, never by dividing them.
 * 2. **Order comes from the specification.** Every list is walked in the order
 *    it was written, every traversal takes its frontier in that order, and ties
 *    are broken by it. No `Set` iteration decides anything.
 * 3. **Iteration is a fixed number of passes.** Crossing reduction stops after
 *    `ORDER_PASSES` because it was told to, not because a tolerance was met —
 *    a convergence test is exactly where floating-point sensitivity gets in.
 * 4. **Nothing ambient.** No clock, no randomness, no viewport, no text
 *    measurement, no locale. This module imports nothing at all.
 *
 * The axis is chosen from the graph's shape and from nothing else: a graph
 * deeper than it is wide reads top-to-bottom, and a graph wider than it is deep
 * reads left-to-right. The viewport never enters into it — a delivered artifact
 * has one geometry, and the browser adapts by scaling rather than by relaying.
 *
 * Box sizing here is provisional and deliberately generous. The width-aware
 * model that makes it correct for every script, and the decision to freeze it
 * or fall back to uniform boxes, belong to the ticket that owns typography.
 */

/** The grid. Every dimension a multiple of 4, so every derived value stays whole. */
export const GEOMETRY = Object.freeze({
  NODE_W: 208,
  NODE_H: 76,
  RANK_GAP: 88,
  // Wide enough that two boundaries in neighbouring column bands cannot touch:
  // each pads itself by GROUP_PAD on both sides, so the gap has to clear twice
  // that. The same arithmetic holds along the ranks, where RANK_GAP clears
  // GROUP_PAD twice over plus the room a boundary's label needs.
  ORDER_GAP: 64,
  MARGIN: 56,
  GROUP_PAD: 24,
  GROUP_HEAD: 28,
  DETOUR: 44,
  /** Fixed, never a convergence test. */
  ORDER_PASSES: 4,
  /** Provisional label budget, in characters. The cell-aware model is 51.2's. */
  LABEL_CHARS_PER_LINE: 22,
  LABEL_MAX_LINES: 2,
});

/**
 * @typedef {object} Layout
 * @property {number} width    canvas width, integer
 * @property {number} height   canvas height, integer
 * @property {"vertical"|"horizontal"} axis  which way ranks advance
 * @property {number} rankCount
 * @property {object[]} nodes  each with id, box {x,y,w,h}, rank, order
 * @property {object[]} edges  each with id, points [[x,y],...], and its shape
 * @property {object[]} groups each with id, box {x,y,w,h}, depth
 */

/**
 * Lay out a `graph` topology.
 *
 * @param {object} diagram the specification's `diagram` object, already validated
 * @returns {Layout}
 */
export function layoutGraph(diagram) {
  const nodes = diagram.nodes;
  const edges = diagram.edges;
  const groups = diagram.groups ?? [];

  const indexOf = new Map();
  nodes.forEach((node, i) => indexOf.set(node.id, i));

  const ranks = assignRanks(nodes, edges, indexOf);
  const rankCount = ranks.reduce((most, rank) => (rank > most ? rank : most), 0) + 1;

  const allocation = allocateBands(nodes, groups);
  const order = orderWithinRanks(nodes, edges, indexOf, ranks, rankCount, allocation.bandOf);
  const columns = measureBands(nodes, ranks, rankCount, allocation);

  // Shape decides the axis, and shape is the only thing that may. A graph with
  // more ranks than it has columns is a progression, and a progression reads
  // downward.
  const axis = rankCount > columns.total ? "vertical" : "horizontal";

  const placement = placeNodes(nodes, ranks, order, rankCount, allocation, columns, axis);
  const boxes = placement.boxes;
  const groupBoxes = placeGroups(groups, allocation, columns, placement, axis);
  const extent = canvasExtent(boxes, groupBoxes);

  // Everything was laid out from the origin; shift once so the margin is real
  // and no coordinate is negative.
  const dx = GEOMETRY.MARGIN - extent.minX;
  const dy = GEOMETRY.MARGIN - extent.minY;
  for (const box of boxes) { box.x += dx; box.y += dy; }
  for (const box of groupBoxes) { box.box.x += dx; box.box.y += dy; }

  const placed = nodes.map((node, i) => ({
    id: node.id,
    rank: ranks[i],
    order: order[i],
    box: boxes[i],
  }));

  return {
    width: extent.maxX - extent.minX + GEOMETRY.MARGIN * 2,
    height: extent.maxY - extent.minY + GEOMETRY.MARGIN * 2,
    axis,
    rankCount,
    nodes: placed,
    groups: groupBoxes,
    edges: routeEdges(edges, indexOf, boxes, ranks, axis),
  };
}

/**
 * Longest-path ranking over the graph with its back edges set aside.
 *
 * Cycles are legal — a retry loop is a fact, not a modelling error — so they
 * are broken for ranking only, and only by a depth-first walk that visits
 * nodes and their neighbours in specification order. The same specification
 * therefore breaks the same edge every time.
 */
function assignRanks(nodes, edges, indexOf) {
  const forward = nodes.map(() => []);
  const indegree = nodes.map(() => 0);

  for (const edge of forwardEdges(nodes, edges, indexOf)) {
    forward[edge.from].push(edge.to);
    indegree[edge.to] += 1;
  }

  // Kahn, with the frontier taken in specification order rather than as a
  // queue of whatever finished last.
  const rank = nodes.map(() => 0);
  const remaining = indegree.slice();
  const settled = nodes.map(() => false);

  for (let done = 0; done < nodes.length; done += 1) {
    let next = -1;
    for (let i = 0; i < nodes.length; i += 1) {
      if (!settled[i] && remaining[i] === 0) { next = i; break; }
    }
    // Unreachable while back edges are excluded: the remaining graph is a DAG.
    if (next < 0) break;

    settled[next] = true;
    for (const target of forward[next]) {
      if (rank[next] + 1 > rank[target]) rank[target] = rank[next] + 1;
      remaining[target] -= 1;
    }
  }

  return rank;
}

/**
 * The edges that may carry rank, as `{from, to}` index pairs.
 *
 * Self-edges never can. A back edge — one that closes a cycle during a
 * specification-order depth-first walk — is excluded too, and stays a fully
 * drawn relationship; it just does not get a say in how deep its target sits.
 */
function forwardEdges(nodes, edges, indexOf) {
  const adjacency = nodes.map(() => []);
  edges.forEach((edge, e) => {
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    if (from === undefined || to === undefined || from === to) return;
    adjacency[from].push({ to, e });
  });

  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = nodes.map(() => WHITE);
  const isBack = edges.map(() => false);

  for (let start = 0; start < nodes.length; start += 1) {
    if (colour[start] !== WHITE) continue;
    colour[start] = GREY;
    const stack = [{ node: start, cursor: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.cursor >= adjacency[frame.node].length) {
        colour[frame.node] = BLACK;
        stack.pop();
        continue;
      }
      const { to, e } = adjacency[frame.node][frame.cursor];
      frame.cursor += 1;
      if (colour[to] === GREY) { isBack[e] = true; continue; }
      if (colour[to] === WHITE) {
        colour[to] = GREY;
        stack.push({ node: to, cursor: 0 });
      }
    }
  }

  const out = [];
  edges.forEach((edge, e) => {
    if (isBack[e]) return;
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    if (from === undefined || to === undefined || from === to) return;
    out.push({ from, to });
  });
  return out;
}

/**
 * Give every boundary its own columns.
 *
 * A group drawn as the bounding box of wherever its members happened to land is
 * a lie as soon as the members are not adjacent: the box swallows nodes that
 * are not in it and asserts a membership the specification never claimed. So
 * the columns are partitioned up front instead. Each boundary gets a band of
 * columns of its own, every rank places that boundary's members inside that
 * band, and a boundary's box is therefore a clean rectangle that contains its
 * members and nothing else. Two boundaries cannot overlap because their bands
 * do not.
 *
 * Bands are allocated in one fixed order — ungrouped first, then each root
 * boundary in specification order, and inside a root, its own direct members
 * before each of its children in specification order. That is the whole of the
 * grouping algorithm. It costs width, which is the right thing to spend to stop
 * a boundary claiming something untrue.
 */
function allocateBands(nodes, groups) {
  const position = new Map();
  groups.forEach((group, g) => position.set(group.id, g));

  const roots = groups.filter((group) =>
    group.parent === undefined || !position.has(group.parent));
  const childrenOf = new Map();
  for (const group of groups) childrenOf.set(group.id, []);
  for (const group of groups) {
    if (group.parent === undefined) continue;
    const siblings = childrenOf.get(group.parent);
    if (siblings && siblings !== childrenOf.get(group.id)) siblings.push(group.id);
  }

  /** Leaf bands, in allocation order. Each owns a contiguous run of columns. */
  const bands = [];
  const bandOfGroup = new Map();

  const ungrouped = nodes.some((node) =>
    node.group === undefined || !position.has(node.group));
  if (ungrouped) bands.push({ owner: null });

  for (const root of roots) {
    const direct = nodes.some((node) => node.group === root.id);
    if (direct) {
      bandOfGroup.set(root.id, bands.length);
      bands.push({ owner: root.id });
    }
    for (const childId of childrenOf.get(root.id)) {
      if (!nodes.some((node) => node.group === childId)) continue;
      bandOfGroup.set(childId, bands.length);
      bands.push({ owner: childId });
    }
  }

  const bandOf = nodes.map((node) => {
    if (node.group === undefined || !position.has(node.group)) return 0;
    const at = bandOfGroup.get(node.group);
    return at === undefined ? 0 : at;
  });

  return { bands, bandOf, bandOfGroup, childrenOf, roots };
}

/**
 * Crossing reduction: a fixed number of barycentre passes, alternating
 * direction, seeded from specification order.
 *
 * Barycentres are fractions. Comparing them by dividing would put the layout at
 * the mercy of floating point, so they are compared by cross-multiplying two
 * integers instead — exact, and identical on every engine. A node with no
 * neighbour in the rank being consulted keeps the position it already has,
 * which is both a sensible answer and a total order.
 */
function orderWithinRanks(nodes, edges, indexOf, ranks, rankCount, bandOf) {
  const members = [];
  for (let r = 0; r < rankCount; r += 1) members.push([]);
  nodes.forEach((node, i) => members[ranks[i]].push(i));

  const predecessors = nodes.map(() => []);
  const successors = nodes.map(() => []);
  for (const edge of edges) {
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    if (ranks[from] === ranks[to]) continue;
    predecessors[to].push(from);
    successors[from].push(to);
  }

  const position = nodes.map(() => 0);
  const reposition = () => {
    for (const rank of members) rank.forEach((node, at) => { position[node] = at; });
  };
  reposition();

  for (let pass = 0; pass < GEOMETRY.ORDER_PASSES; pass += 1) {
    const downward = pass % 2 === 0;
    const sequence = [];
    for (let r = 0; r < rankCount; r += 1) sequence.push(downward ? r : rankCount - 1 - r);

    for (const r of sequence) {
      const neighboursOf = downward ? predecessors : successors;
      const keys = new Map();
      for (const node of members[r]) {
        const relevant = neighboursOf[node].filter((other) =>
          downward ? ranks[other] < r : ranks[other] > r);
        keys.set(node, relevant.length === 0
          ? { num: position[node], den: 1 }
          : { num: relevant.reduce((sum, other) => sum + position[other], 0),
              den: relevant.length });
      }
      // `sort` is stable, so equal keys keep the order they already had, which
      // on the first pass is the order the specification wrote.
      members[r].sort((a, b) => {
        const ga = bandOf[a];
        const gb = bandOf[b];
        if (ga !== gb) return ga - gb;
        const ka = keys.get(a);
        const kb = keys.get(b);
        return ka.num * kb.den - kb.num * ka.den;
      });
      members[r].forEach((node, at) => { position[node] = at; });
    }
    reposition();
  }

  const order = nodes.map(() => 0);
  for (const rank of members) rank.forEach((node, at) => { order[node] = at; });
  return order;
}

/**
 * How many columns each band needs, and where its run starts.
 *
 * A band is as wide as its busiest rank. Offsets are the running total, so the
 * runs are contiguous, disjoint, and in allocation order.
 */
function measureBands(nodes, ranks, rankCount, allocation) {
  const width = allocation.bands.map(() => 0);

  for (let b = 0; b < allocation.bands.length; b += 1) {
    for (let r = 0; r < rankCount; r += 1) {
      let count = 0;
      nodes.forEach((node, i) => {
        if (allocation.bandOf[i] === b && ranks[i] === r) count += 1;
      });
      if (count > width[b]) width[b] = count;
    }
  }

  const offset = [];
  let running = 0;
  for (const w of width) { offset.push(running); running += w; }
  return { width, offset, total: running === 0 ? 1 : running };
}

/**
 * Integer coordinates on a fixed grid.
 *
 * `along` advances with the rank. `across` is the node's column: its band's
 * offset, plus its position among that band's members in this rank, centred
 * inside the band so a rank that uses less than the band's full width sits in
 * the middle of it rather than jammed to one side. The halving is a floor, so
 * an odd remainder lands the same way on every machine.
 */
function placeNodes(nodes, ranks, order, rankCount, allocation, columns, axis) {
  const vertical = axis === "vertical";
  const alongExtent = vertical ? GEOMETRY.NODE_H : GEOMETRY.NODE_W;
  const acrossExtent = vertical ? GEOMETRY.NODE_W : GEOMETRY.NODE_H;
  const alongStep = alongExtent + GEOMETRY.RANK_GAP;
  const acrossStep = acrossExtent + GEOMETRY.ORDER_GAP;

  // Position within the band, for this rank, in the order the ordering pass
  // settled on.
  const local = nodes.map(() => 0);
  const counts = new Map();
  const sorted = nodes.map((_, i) => i)
    .sort((a, b) => (ranks[a] - ranks[b]) || (order[a] - order[b]));
  for (const i of sorted) {
    const key = `${allocation.bandOf[i]}:${ranks[i]}`;
    const at = counts.get(key) ?? 0;
    local[i] = at;
    counts.set(key, at + 1);
  }

  const boxes = nodes.map((node, i) => {
    const band = allocation.bandOf[i];
    const used = counts.get(`${band}:${ranks[i]}`) ?? 0;
    const centring = Math.floor(((columns.width[band] - used) * acrossStep) / 2);
    const across = (columns.offset[band] * acrossStep) + centring + local[i] * acrossStep;
    const along = ranks[i] * alongStep;
    return vertical
      ? { x: across, y: along, w: GEOMETRY.NODE_W, h: GEOMETRY.NODE_H }
      : { x: along, y: across, w: GEOMETRY.NODE_W, h: GEOMETRY.NODE_H };
  });

  return { boxes, alongStep, acrossStep, alongExtent, acrossExtent, ranks };
}

/**
 * A boundary's box: its band's columns, across the ranks its members occupy.
 *
 * Because the band is the boundary's own, this rectangle contains its members
 * and can contain nothing else. A root boundary with children covers its own
 * band and theirs, which are adjacent by construction, so the union is still
 * one rectangle.
 */
function placeGroups(groups, allocation, columns, placement, axis) {
  if (groups.length === 0) return [];
  const vertical = axis === "vertical";
  const { acrossStep, alongStep, alongExtent, ranks } = placement;

  const bandsOf = (group) => {
    const own = allocation.bandOfGroup.get(group.id);
    const list = own === undefined ? [] : [own];
    for (const childId of allocation.childrenOf.get(group.id) ?? []) {
      const at = allocation.bandOfGroup.get(childId);
      if (at !== undefined) list.push(at);
    }
    return list;
  };

  const memberRanks = (group) => {
    const ids = [group.id, ...(allocation.childrenOf.get(group.id) ?? [])];
    const wanted = new Set(ids.map((id) => allocation.bandOfGroup.get(id))
      .filter((b) => b !== undefined));
    const out = [];
    ranks.forEach((rank, i) => {
      if (wanted.has(allocation.bandOf[i])) out.push(rank);
    });
    return out;
  };

  const out = [];
  for (const group of groups) {
    const bands = bandsOf(group);
    const rankList = memberRanks(group);
    if (bands.length === 0 || rankList.length === 0) continue;

    const firstColumn = Math.min(...bands.map((b) => columns.offset[b]));
    const lastColumn = Math.max(...bands.map((b) => columns.offset[b] + columns.width[b]));
    const firstRank = Math.min(...rankList);
    const lastRank = Math.max(...rankList);

    const acrossStart = firstColumn * acrossStep - GEOMETRY.GROUP_PAD;
    const acrossSize = (lastColumn - firstColumn) * acrossStep - GEOMETRY.ORDER_GAP
      + GEOMETRY.GROUP_PAD * 2;
    const alongStart = firstRank * alongStep - GEOMETRY.GROUP_PAD - GEOMETRY.GROUP_HEAD;
    const alongSize = (lastRank - firstRank) * alongStep + alongExtent
      + GEOMETRY.GROUP_PAD * 2 + GEOMETRY.GROUP_HEAD;

    const depth = group.parent === undefined ? 0 : 1;
    const box = vertical
      ? { x: acrossStart, y: alongStart, w: acrossSize, h: alongSize }
      : { x: alongStart, y: acrossStart, w: alongSize, h: acrossSize };

    // A boundary holding other boundaries needs room around them, or it shares
    // a corner with its first child and the two labels sit on top of each
    // other. One more pad all round, and one more label's height at the start.
    if (depth === 0 && bands.length > 1) {
      const lead = GEOMETRY.GROUP_PAD + GEOMETRY.GROUP_HEAD;
      if (vertical) {
        box.x -= GEOMETRY.GROUP_PAD; box.w += GEOMETRY.GROUP_PAD * 2;
        box.y -= lead; box.h += lead + GEOMETRY.GROUP_PAD;
      } else {
        box.y -= GEOMETRY.GROUP_PAD; box.h += GEOMETRY.GROUP_PAD * 2;
        box.x -= lead; box.w += lead + GEOMETRY.GROUP_PAD;
      }
    }

    out.push({ id: group.id, depth, box });
  }

  // Parents behind children, each tier in specification order.
  return [...out.filter((g) => g.depth === 0), ...out.filter((g) => g.depth === 1)];
}

function canvasExtent(boxes, groupBoxes) {
  const all = [...boxes, ...groupBoxes.map((g) => g.box)];
  let minX = all[0].x, minY = all[0].y;
  let maxX = all[0].x + all[0].w, maxY = all[0].y + all[0].h;
  for (const box of all) {
    if (box.x < minX) minX = box.x;
    if (box.y < minY) minY = box.y;
    if (box.x + box.w > maxX) maxX = box.x + box.w;
    if (box.y + box.h > maxY) maxY = box.y + box.h;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Orthogonal routes, as integer waypoints.
 *
 * Three shapes, and which one an edge gets is decided by the ranks it joins,
 * never by the producer:
 *
 *   forward   down one side, across the gap between ranks, into the next
 *   lateral   out to the side and back in, for an edge inside one rank
 *   loop      a small rectangle, for a node that relates to itself
 *
 * Every point is an integer because every input is. The midpoint between two
 * ranks is a floor, so it lands on the same pixel everywhere.
 */
function routeEdges(edges, indexOf, boxes, ranks, axis) {
  const vertical = axis === "vertical";

  return edges.map((edge) => {
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    const a = boxes[from];
    const b = boxes[to];

    if (from === to) {
      return { id: edge.id, shape: "loop", points: loopPoints(a, vertical) };
    }
    if (ranks[from] === ranks[to]) {
      return { id: edge.id, shape: "lateral", points: lateralPoints(a, b, vertical) };
    }
    return { id: edge.id, shape: "forward", points: forwardPoints(a, b, vertical) };
  });
}

function centreAlong(box, vertical) {
  return vertical ? box.x + Math.floor(box.w / 2) : box.y + Math.floor(box.h / 2);
}

function forwardPoints(a, b, vertical) {
  const descending = vertical ? b.y >= a.y : b.x >= a.x;
  if (vertical) {
    const ax = centreAlong(a, true);
    const bx = centreAlong(b, true);
    const ay = descending ? a.y + a.h : a.y;
    const by = descending ? b.y : b.y + b.h;
    const mid = ay + Math.floor((by - ay) / 2);
    if (ax === bx) return [[ax, ay], [bx, by]];
    return [[ax, ay], [ax, mid], [bx, mid], [bx, by]];
  }
  const ay = centreAlong(a, false);
  const by = centreAlong(b, false);
  const ax = descending ? a.x + a.w : a.x;
  const bx = descending ? b.x : b.x + b.w;
  const mid = ax + Math.floor((bx - ax) / 2);
  if (ay === by) return [[ax, ay], [bx, by]];
  return [[ax, ay], [mid, ay], [mid, by], [bx, by]];
}

/**
 * An edge inside one rank leaves the way it came in and goes over the top.
 *
 * Two nodes in the same rank sit side by side with other nodes possibly between
 * them, so the route steps out of the rank entirely rather than trying to find
 * a gap. Four points, all integers, and no case analysis beyond the axis.
 */
function lateralPoints(a, b, vertical) {
  const d = GEOMETRY.DETOUR;
  if (vertical) {
    const ax = a.x + Math.floor(a.w / 2);
    const bx = b.x + Math.floor(b.w / 2);
    const above = Math.min(a.y, b.y) - d;
    return [[ax, a.y], [ax, above], [bx, above], [bx, b.y]];
  }
  const ay = a.y + Math.floor(a.h / 2);
  const by = b.y + Math.floor(b.h / 2);
  const left = Math.min(a.x, b.x) - d;
  return [[a.x, ay], [left, ay], [left, by], [b.x, by]];
}

function loopPoints(box, vertical) {
  const d = GEOMETRY.DETOUR;
  if (vertical) {
    const y1 = box.y + Math.floor(box.h / 3);
    const y2 = box.y + Math.floor((box.h * 2) / 3);
    const x = box.x + box.w;
    return [[x, y1], [x + d, y1], [x + d, y2], [x, y2]];
  }
  const x1 = box.x + Math.floor(box.w / 3);
  const x2 = box.x + Math.floor((box.w * 2) / 3);
  const y = box.y;
  return [[x1, y], [x1, y - d], [x2, y - d], [x2, y]];
}

/**
 * Break a label into lines, losing nothing.
 *
 * The line budget is provisional — a character is not a width, which is the
 * problem the typography ticket exists to solve — and how wide a label may be
 * is that ticket's to settle. What is not provisional, and is settled here, is
 * that the renderer never deletes a producer's words. Text that will not fit
 * the line budget is carried onto the last line rather than dropped, so the
 * label may overflow its box until the geometry contract is frozen, and it is
 * never quietly shortened.
 *
 * That is the right way round. A label that spills past its border is visibly
 * wrong and someone fixes it; a label missing its last word looks correct and
 * lies. The renderer owns presentation, and owns none of the content.
 */
export function wrapLabel(text) {
  const budget = GEOMETRY.LABEL_CHARS_PER_LINE;
  const source = String(text);

  // Greedy wrap on spaces, hard-breaking any single word longer than the
  // budget. Nothing is discarded at this stage; the result is the label.
  const lines = [];
  let current = "";
  const flush = () => { if (current !== "") { lines.push(current); current = ""; } };

  for (const word of source.split(" ")) {
    if (word.length > budget) {
      flush();
      let rest = word;
      while (rest.length > budget) {
        lines.push(rest.slice(0, budget));
        rest = rest.slice(budget);
      }
      current = rest;
      continue;
    }
    if (current === "") { current = word; continue; }
    if (current.length + 1 + word.length <= budget) { current = `${current} ${word}`; continue; }
    flush();
    current = word;
  }
  flush();

  if (lines.length === 0) return [source];
  if (lines.length <= GEOMETRY.LABEL_MAX_LINES) return lines;

  // More lines than the box has room for. The overflow joins the last line
  // instead of disappearing: every character the producer wrote is still in
  // the document, and the box is the thing that has to give.
  const kept = lines.slice(0, GEOMETRY.LABEL_MAX_LINES - 1);
  kept.push(lines.slice(GEOMETRY.LABEL_MAX_LINES - 1).join(" "));
  return kept;
}
