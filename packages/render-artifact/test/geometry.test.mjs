/**
 * The geometry contract 51.2 freezes, as assertions.
 *
 * These are renderer invariants, not producer-facing rules. A box that overlaps
 * another, an edge that stops short of the node it names, a label wider than
 * the box holding it — each is the renderer's arithmetic being wrong, and a
 * producer can do nothing about any of them. That is exactly why they are tests
 * here and not a fifth validation layer: a diagnostic telling a producer to fix
 * the renderer's sums would be noise.
 *
 * Every fixture the repository commits is put through all of them, so a
 * diagram added later inherits the whole contract without anyone remembering
 * to ask for it.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";

import {
  GEOMETRY, layoutGraph, wrapLabel,
} from "../../../skills/render-artifact/engine/render/graph/layout.mjs";
import { cellWidth } from "../../../skills/render-artifact/engine/render/graph/width.mjs";
import { SPECS, cleanUpTemporaryDirectories, deliverInSubprocess } from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

/** Every committed specification that is a diagram. */
const DIAGRAMS = Object.entries(SPECS)
  .map(([name, path]) => [name, JSON.parse(readFileSync(path, "utf8"))])
  .filter(([, spec]) => spec.kind === "diagram");

/**
 * The widest a column can render, in pixels, for the renderer's own type.
 *
 * Labels are set in `--pf-mono` at 13px. A monospace face advances every cell
 * by the same amount, and across the faces that stack resolves to — SF Mono,
 * Menlo, Consolas, Liberation Mono, and the generic `monospace` fallback — that
 * advance sits near 0.6em. This takes 0.65em as a deliberately pessimistic
 * ceiling, so the margin the assertions prove is a floor on the real margin
 * rather than an estimate of it.
 *
 * This is not measurement. Nothing here is asked of a browser, a font file, or
 * the machine; it is a documented upper bound used to check that the geometry
 * leaves room, and the browser probe is what confirms the bound in practice.
 */
const FONT_SIZE_PX = 13;
const ADVANCE_CEILING_PX = FONT_SIZE_PX * 0.65;
/** Horizontal padding inside a node box, matching the type's own inset. */
const NODE_TEXT_INSET_PX = 14;

/** Is `point` on the perimeter of `box`? Integers throughout, so exactly. */
function onBoundary([x, y], box) {
  const onVertical = (x === box.x || x === box.x + box.w) && y >= box.y && y <= box.y + box.h;
  const onHorizontal = (y === box.y || y === box.y + box.h) && x >= box.x && x <= box.x + box.w;
  return onVertical || onHorizontal;
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

for (const [name, spec] of DIAGRAMS) {
  describe(`geometry — ${name}`, () => {
    const layout = layoutGraph(spec.diagram);
    const boxOf = new Map(layout.nodes.map((node) => [node.id, node.box]));
    const nodeById = new Map(spec.diagram.nodes.map((node) => [node.id, node]));

    it("places every node the specification declared, and no others", () => {
      assert.deepEqual(
        layout.nodes.map((node) => node.id),
        spec.diagram.nodes.map((node) => node.id));
    });

    it("no two node boxes overlap", () => {
      const collisions = [];
      for (let i = 0; i < layout.nodes.length; i += 1) {
        for (let j = i + 1; j < layout.nodes.length; j += 1) {
          if (overlaps(layout.nodes[i].box, layout.nodes[j].box)) {
            collisions.push(`${layout.nodes[i].id} / ${layout.nodes[j].id}`);
          }
        }
      }
      assert.deepEqual(collisions, []);
    });

    it("every edge terminates on the boundary of the node it names", () => {
      const wrong = [];
      for (const route of layout.edges) {
        const edge = spec.diagram.edges.find((e) => e.id === route.id);
        const from = boxOf.get(edge.from);
        const to = boxOf.get(edge.to);
        const first = route.points[0];
        const last = route.points[route.points.length - 1];
        if (!onBoundary(first, from)) wrong.push(`${edge.id} starts at ${first}, off ${edge.from}`);
        if (!onBoundary(last, to)) wrong.push(`${edge.id} ends at ${last}, off ${edge.to}`);
      }
      assert.deepEqual(wrong, []);
    });

    it("nothing is drawn outside the canvas", () => {
      const outside = [];
      const within = (box, what) => {
        if (box.x < 0 || box.y < 0
          || box.x + box.w > layout.width || box.y + box.h > layout.height) {
          outside.push(what);
        }
      };
      for (const node of layout.nodes) within(node.box, `node ${node.id}`);
      for (const group of layout.groups) within(group.box, `group ${group.id}`);
      for (const route of layout.edges) {
        for (const [x, y] of route.points) {
          if (x < 0 || y < 0 || x > layout.width || y > layout.height) {
            outside.push(`edge ${route.id} waypoint ${x},${y}`);
          }
        }
      }
      assert.deepEqual(outside, []);
    });

    it("every boundary contains its own members and nothing else", () => {
      const groups = spec.diagram.groups ?? [];
      const childrenOf = new Map(groups.map((g) =>
        [g.id, groups.filter((c) => c.parent === g.id).map((c) => c.id)]));
      const inside = (inner, outer) =>
        inner.x >= outer.x && inner.y >= outer.y
        && inner.x + inner.w <= outer.x + outer.w
        && inner.y + inner.h <= outer.y + outer.h;

      const wrong = [];
      for (const placed of layout.groups) {
        const own = new Set([placed.id, ...(childrenOf.get(placed.id) ?? [])]);
        for (const node of spec.diagram.nodes) {
          const isMember = own.has(node.group);
          const contained = inside(boxOf.get(node.id), placed.box);
          if (contained !== isMember) {
            wrong.push(`${placed.id} ${contained ? "contains" : "excludes"} ${node.id}`);
          }
        }
      }
      assert.deepEqual(wrong, []);
    });

    it("no label escapes its box", () => {
      const escaping = [];
      const inner = GEOMETRY.NODE_W - NODE_TEXT_INSET_PX * 2;

      for (const node of spec.diagram.nodes) {
        const lines = wrapLabel(node.label);
        assert.ok(lines.length <= GEOMETRY.LABEL_MAX_LINES,
          `${node.id} wrapped to ${lines.length} lines`);
        for (const line of lines) {
          const columns = cellWidth(line);
          const widest = columns * ADVANCE_CEILING_PX;
          if (columns > GEOMETRY.LABEL_CELLS_PER_LINE || widest > inner) {
            escaping.push(`${node.id}: ${columns} columns, up to ${widest.toFixed(1)}px in ${inner}px`);
          }
        }
      }
      assert.deepEqual(escaping, []);
    });

    it("wrapping keeps every character the producer wrote", () => {
      const lost = [];
      for (const node of spec.diagram.nodes) {
        const rejoined = wrapLabel(node.label).join("").replace(/\s+/g, "");
        if (rejoined !== node.label.replace(/\s+/g, "")) lost.push(node.id);
      }
      assert.deepEqual(lost, []);
    });

    it("laying out twice produces identical geometry", () => {
      assert.deepEqual(layoutGraph(spec.diagram), layoutGraph(spec.diagram));
    });

    it("every emitted number is an integer", () => {
      const fractional = [];
      const check = (what, value) => {
        if (!Number.isInteger(value)) fractional.push(`${what} = ${value}`);
      };
      check("width", layout.width);
      check("height", layout.height);
      for (const node of layout.nodes) {
        for (const k of ["x", "y", "w", "h"]) check(`${node.id}.${k}`, node.box[k]);
      }
      for (const group of layout.groups) {
        for (const k of ["x", "y", "w", "h"]) check(`${group.id}.${k}`, group.box[k]);
      }
      for (const route of layout.edges) {
        route.points.forEach(([x, y], i) => {
          check(`${route.id}[${i}].x`, x);
          check(`${route.id}[${i}].y`, y);
        });
      }
      assert.deepEqual(fractional, []);
    });

    it("delivers, and the artifact carries every node", () => {
      const delivery = deliverInSubprocess({ spec: SPECS[name] });
      assert.equal(delivery.status, 0,
        `${JSON.stringify(delivery.receipt, null, 2)}\n${delivery.stderr}`);
      for (const node of spec.diagram.nodes) {
        assert.ok(delivery.html.includes(`id="n--${node.id}"`), `${node.id} missing`);
      }
    });

    it("puts every word of every label into the artifact", () => {
      const delivery = deliverInSubprocess({ spec: SPECS[name] });
      for (const node of spec.diagram.nodes) {
        for (const word of node.label.split(" ").filter(Boolean)) {
          assert.ok(delivery.html.includes(word),
            `"${word}" of "${node.label}" is not in the artifact`);
        }
      }
    });
  });
}

describe("the column budget and the cap are the same number", () => {
  it("two lines of the budget is exactly the node label cap", () => {
    // This is what makes wrapping lossless by construction. If someone widens
    // the cap or narrows the budget without the other, a label the schema
    // accepts stops fitting, and the failure would surface as a clipped word
    // in a picture rather than as a broken test.
    assert.equal(GEOMETRY.LABEL_CELLS_PER_LINE * GEOMETRY.LABEL_MAX_LINES, 32,
      "the node label cap is 32 columns; the budget must multiply to it exactly");
  });

  it("any label within the cap fits, whatever its script", () => {
    const alphabets = {
      latin: "abcdefghijklmnopqrstuvwxyz ",
      cjk: "漢字を使う",
      arabic: "العربية ",
      devanagari: "नमस्ते ",
      emoji: "\u{1F680}\u{1F510}\u{1F4E6}",
    };
    const offenders = [];
    for (const [script, alphabet] of Object.entries(alphabets)) {
      const characters = [...alphabet];
      for (let length = 1; length <= 40; length += 1) {
        let label = "";
        for (let i = 0; i < length; i += 1) label += characters[i % characters.length];
        if (cellWidth(label) > 32) continue;  // refused by the structural layer
        const lines = wrapLabel(label);
        const widest = Math.max(...lines.map(cellWidth));
        const lossless = lines.join("").replace(/\s+/g, "") === label.replace(/\s+/g, "");
        if (lines.length > GEOMETRY.LABEL_MAX_LINES
          || widest > GEOMETRY.LABEL_CELLS_PER_LINE || !lossless) {
          offenders.push(`${script}/${length}: ${JSON.stringify(lines)}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });
});
