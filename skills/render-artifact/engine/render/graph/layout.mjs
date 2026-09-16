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
 *    measurement, no locale. The one thing this module imports is the pinned
 *    character-width table, which is generated data and literal ranges — never
 *    a question asked of the engine it is running on.
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

import { cellWidth, codePointWidth } from "./width.mjs";

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
  /**
   * The label budget, in columns, and the lines a node box has room for.
   *
   * These two multiply to the node label's hard cap of 32 columns, and that is
   * not a coincidence — it is what makes wrapping lossless by construction
   * rather than by luck. Any label the schema accepts fits in two lines of
   * sixteen, so there is never a remainder to drop, overflow, or apologise for.
   */
  LABEL_CELLS_PER_LINE: 16,
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

  const spread = explorerSpread(rankCount, columns.total, axis);

  const placement = placeNodes(nodes, ranks, order, rankCount, allocation, columns, axis, spread);
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
 * The explorer layout profile: how far apart the horizontal steps stand.
 *
 * A graph is laid out into a canvas whose shape falls out of the node counts,
 * and that shape is reliably too tall. Measured across the six diagram
 * fixtures, every one of them fits its stage on height and leaves width empty
 * — the acceptance specimen worst of all, at 2148x1612 against a stage nearer
 * 2.17 wide, which is the 62% the Feature named and 38% of the width standing
 * empty before the camera has done anything.
 *
 * The cause is that `axis` is chosen by comparing *counts* while the canvas is
 * measured in *extents*, and a node box is 208 wide against 76 tall. Seven
 * ranks of a 208-wide box is a different distance from eleven rows of a
 * 76-tall one, so "more columns than ranks" decides the reading direction
 * correctly and says nothing at all about the proportion that comes out.
 *
 * This closes that gap the cheapest honest way: it widens the step that
 * advances along x until the canvas is about as wide as it is meant to be, and
 * touches nothing else. What it is *not* is worth stating, because each was
 * available and each was rejected:
 *
 * - Not a retune of GEOMETRY. A bigger RANK_GAP widens a horizontal graph and
 *   makes a vertical one taller; measured, it takes `multilingual` from 22% of
 *   the stage to 11%. The lever has to know which axis it is pushing on, and a
 *   constant cannot.
 * - Not a runtime measurement. TARGET is a constant of the profile, not a
 *   reading of anyone's window. The same specification and renderer still give
 *   byte-identical output on any screen, including no screen at all.
 * - Not a change of shape. Rank, order, band, grouping and routing are decided
 *   before this runs and are not consulted again; this moves the steps apart
 *   and cannot reorder, regroup or reroute anything.
 *
 * The arithmetic stays inside the module's rules: integers throughout, one
 * floored division, no convergence test, and a result quantised to the grid's
 * multiple of 4 so every derived coordinate stays whole.
 *
 * Both bounds are load-bearing. The floor is the documented minimum — a step
 * narrower than the base gap puts neighbouring boundaries back within
 * GROUP_PAD of each other, which is the collision the base gaps exist to
 * prevent — so the profile may only ever spread, never tighten. The cap is
 * what keeps a deep narrow graph from being stretched into a dotted line:
 * three columns asked to reach a 2.1 canvas want a 1606px step, which is not a
 * diagram, so the spread stops at SPREAD_MAX and the graph stays honestly tall.
 *
 * TARGET is 2.0 because the overview and the focus state pull against each
 * other, and 2.0 is where the curve turns. The focus camera holds the focused
 * label at its authored size, so its window is a fixed number of *user units*
 * — about 1060 by 607 with the panel open. Spreading x moves rank-neighbours
 * further apart in exactly those units, so every point of overview width is
 * paid for out of the context a focus can frame. Measured on the specimen, at
 * 1440x900:
 *
 *     target   overview width   neighbourhoods framed whole
 *     none              51.9%   theme, detect
 *     2.0               80.2%   theme, detect
 *     2.2               88.3%   theme
 *     2.4               95.7%   none
 *
 * 2.4 reads better as a number and is the worse artifact: with nothing framed
 * whole, every selection ends "N related components outside the frame", and an
 * affordance that fires on all twenty components is one a reader learns to
 * skip. 2.0 buys two thirds of the empty width back and costs none of it —
 * the same neighbourhoods fit whole as before any of this ran.
 */
const TARGET_NUM = 20;
const TARGET_DEN = 10;
const SPREAD_MAX = GEOMETRY.NODE_W * 2;

function explorerSpread(rankCount, columnTotal, axis) {
  const vertical = axis === "vertical";
  // x advances by rank on a horizontal graph and by column on a vertical one;
  // y takes whichever is left. Both use NODE_W across and NODE_H down, because
  // the box does not turn when the reading direction does.
  const xSteps = vertical ? columnTotal : rankCount;
  const ySteps = vertical ? rankCount : columnTotal;
  const xGapBase = vertical ? GEOMETRY.ORDER_GAP : GEOMETRY.RANK_GAP;
  const yGap = vertical ? GEOMETRY.RANK_GAP : GEOMETRY.ORDER_GAP;

  // One step has no gap to widen, so there is nothing to steer.
  if (xSteps < 2) return xGapBase;

  const height = ySteps * GEOMETRY.NODE_H + (ySteps - 1) * yGap + GEOMETRY.MARGIN * 2;
  const wanted = Math.floor((height * TARGET_NUM) / TARGET_DEN);
  const room = wanted - xSteps * GEOMETRY.NODE_W - GEOMETRY.MARGIN * 2;
  const step = Math.floor(room / (xSteps - 1));

  const capped = step > SPREAD_MAX ? SPREAD_MAX : step;
  const floored = capped < xGapBase ? xGapBase : capped;
  return floored - (floored % 4);
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
function placeNodes(nodes, ranks, order, rankCount, allocation, columns, axis, spread) {
  const vertical = axis === "vertical";
  const alongExtent = vertical ? GEOMETRY.NODE_H : GEOMETRY.NODE_W;
  const acrossExtent = vertical ? GEOMETRY.NODE_W : GEOMETRY.NODE_H;
  // The profile widens whichever step runs along x, and leaves the other at
  // the base gap. On a vertical graph that is the order step; on a horizontal
  // one, the rank step.
  const alongStep = alongExtent + (vertical ? GEOMETRY.RANK_GAP : spread);
  const acrossStep = acrossExtent + (vertical ? spread : GEOMETRY.ORDER_GAP);

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
 * Break a label into lines, in columns rather than characters, losing nothing.
 *
 * A character is not a width. `A` and `漢` are one character each and one and
 * two columns; a Devanagari matra is a character and no columns at all. So the
 * budget is spent in columns, counted against the pinned table in `width.mjs`,
 * and never against `String.length` — which is not even a character count, but
 * a count of UTF-16 units.
 *
 * Two stages, and the second is what makes the guarantee structural:
 *
 * 1. **Wrap on spaces.** What anyone would expect of a label with words in it.
 *    Word boundaries waste room, though, so this stage can need more lines than
 *    the box has — `aaaaaaaaa bbbbbbbbb ccccccccc` is twenty-nine columns and
 *    wants three lines of sixteen.
 * 2. **When it does, wrap on columns instead.** The cap is thirty-two columns
 *    and a box holds two lines of sixteen, so a column-wrapped label always
 *    fits. Exactly, with nothing left over.
 *
 * That is why nothing here truncates, ellipsises, drops a word, or spills past
 * the last line. It is not a rule the code remembers to follow; it is
 * arithmetic the caps and the budget already settled. A label the schema
 * accepts cannot fail to fit.
 *
 * Scripts without spaces reach stage two and are wrapped on column boundaries,
 * which is the correct behaviour for them and needs no dictionary and no
 * locale-sensitive line breaking — both of which are forbidden here and neither
 * of which would be deterministic.
 */
export function wrapLabel(text) {
  const budget = GEOMETRY.LABEL_CELLS_PER_LINE;
  const source = String(text);
  if (source === "") return [""];

  // Stage one is accepted only if it fits on both counts: few enough lines, and
  // no line over budget. Checking the line count alone would pass a single word
  // wider than the box, which has no space to break at and so comes back from
  // the space-wrapper as one long line.
  const byWord = wrapOnSpaces(source, budget);
  const fits = byWord.length <= GEOMETRY.LABEL_MAX_LINES
    && byWord.every((line) => cellWidth(line) <= budget);
  return fits ? byWord : wrapOnCells(source, budget);
}

/** Greedy wrap at spaces. May need more lines than the box has; the caller checks. */
function wrapOnSpaces(source, budget) {
  const lines = [];
  let current = "";
  let width = 0;

  for (const word of source.split(" ")) {
    const wordWidth = cellWidth(word);
    if (current === "") { current = word; width = wordWidth; continue; }
    if (width + 1 + wordWidth <= budget) {
      current = `${current} ${word}`;
      width += 1 + wordWidth;
      continue;
    }
    lines.push(current);
    current = word;
    width = wordWidth;
  }
  if (current !== "") lines.push(current);
  return lines.length === 0 ? [source] : lines;
}

/**
 * Wrap at column boundaries, ignoring spaces.
 *
 * A zero-width code point never forces a break and never starts a line: a
 * combining mark belongs to the character it modifies, and moving it to the
 * next line would render it against the wrong base. So the break is decided by
 * the next code point that actually occupies a column.
 */
function wrapOnCells(source, budget) {
  const lines = [];
  let current = "";
  let width = 0;

  for (const character of source) {
    const w = codePointWidth(character.codePointAt(0));
    if (w > 0 && width + w > budget && current !== "") {
      lines.push(current);
      current = "";
      width = 0;
    }
    current += character;
    width += w;
  }
  if (current !== "") lines.push(current);
  return lines.length === 0 ? [source] : lines;
}
