/**
 * The `diagram` kind: the tracer bullet's contract, made executable.
 *
 * Two things are being proved here, and they are different claims.
 *
 * **The boundary holds.** A producer cannot place, size, colour, route, rank or
 * emphasise anything, and the attempt fails loudly rather than being ignored.
 * Every assertion of that shape below is written as *this specification is
 * refused*, because a field silently dropped is a producer believing it had an
 * effect.
 *
 * **The geometry is integer, structurally.** Not by looking for a decimal
 * character in the delivered HTML — a stylesheet is full of them, and a test
 * that failed because `stroke-width: .5` appeared somewhere would be failing
 * for a reason that has nothing to do with layout. Instead the layout's own
 * representation is walked, every number in it asserted whole, and then the
 * geometry attributes of the emitted SVG are parsed and asserted the same way.
 * Both halves fail if and only if a geometric value is not an integer.
 */

import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { layoutGraph } from "../../../skills/render-artifact/engine/render/graph/layout.mjs";
import {
  REPO_ROOT, SPECS, cleanUpTemporaryDirectories, deliverInSubprocess, temporaryDirectory,
} from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

const EXAMPLE = JSON.parse(readFileSync(SPECS.diagram, "utf8"));

/** Deliver a specification built in memory, and report what the engine said. */
function deliverSpec(spec) {
  const directory = temporaryDirectory("diagram-spec-");
  const specPath = join(directory, "spec.json");
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  return deliverInSubprocess({ spec: specPath, repo: REPO_ROOT, outDirectory: directory });
}

/** The shipped example, deep-copied, as a starting point for a mutation. */
function example() {
  return JSON.parse(JSON.stringify(EXAMPLE));
}

/** Every diagnostic code a delivery reported, in order. */
function codes(delivery) {
  return (delivery.receipt.diagnostics ?? []).map((d) => d.code);
}

describe("diagram — the pipeline, end to end", () => {
  const delivery = deliverInSubprocess({ spec: SPECS.diagram });

  it("validates, renders and delivers", () => {
    assert.equal(delivery.status, 0,
      `${JSON.stringify(delivery.receipt, null, 2)}\n${delivery.stderr}`);
  });

  it("reports the renderer version that supports two kinds", () => {
    assert.equal(delivery.receipt.renderer_version, "0.2.0");
  });

  it("carries the shared shell, one stylesheet, and the Pathfinder identity", () => {
    assert.match(delivery.html, /<div class="pf-eyebrow">Pathfinder diagram<\/div>/);
    assert.equal((delivery.html.match(/<style\b/g) ?? []).length, 1,
      "an artifact carries one stylesheet whatever its kind");
    assert.match(delivery.html, /--pf-accent:/, "the diagram inherits the shared theme");
  });

  it("carries an inline SVG canvas and no external reference", () => {
    assert.match(delivery.html, /<svg class="pf-graph" viewBox="0 0 \d+ \d+"/);
    assert.doesNotMatch(delivery.html, /<img\b/, "an image would not be self-contained");
    assert.doesNotMatch(delivery.html, /https?:\/\/(?!www\.w3\.org)/i);
  });

  it("says its evidence was checked, having had some to check", () => {
    assert.match(delivery.html, /checked deterministically/);
  });

  it("emits every node, edge and group", () => {
    for (const node of EXAMPLE.diagram.nodes) {
      assert.ok(delivery.html.includes(`id="n--${node.id}"`), `node ${node.id} is missing`);
    }
    for (const edge of EXAMPLE.diagram.edges) {
      assert.ok(delivery.html.includes(`id="e--${edge.id}"`), `edge ${edge.id} is missing`);
    }
    for (const group of EXAMPLE.diagram.groups) {
      assert.ok(delivery.html.includes(`id="g--${group.id}"`), `group ${group.id} is missing`);
    }
  });

  it("derives emphasis from authored paths and from nothing else", () => {
    // There is no emphasis field. An edge is drawn heavier exactly when a path
    // the producer authored walks it, so this compares the rendered emphasis
    // against the path membership and nothing else.
    const onPath = new Set(EXAMPLE.diagram.paths.flatMap((path) => path.edges));
    assert.ok(onPath.size > 0 && onPath.size < EXAMPLE.diagram.edges.length,
      "the example needs edges both on and off a path for this to mean anything");

    for (const edge of EXAMPLE.diagram.edges) {
      assert.equal(
        groupClassOf(delivery.html, edge.id).includes("pf-edge-on-path"),
        onPath.has(edge.id),
        `edge ${edge.id} is drawn emphasised=${!onPath.has(edge.id)}, which the ` +
        `authored paths do not say`);
    }
  });
});

/** The class attribute of the `<g>` wrapping one edge. */
function groupClassOf(html, edgeId) {
  const at = html.indexOf(`id="e--${edgeId}"`);
  const openedAt = html.lastIndexOf("<g class=\"", at);
  return html.slice(openedAt, html.indexOf(">", openedAt));
}

describe("diagram — geometry is integer, checked structurally", () => {
  const layout = layoutGraph(EXAMPLE.diagram);

  it("every number the layout produces is an integer", () => {
    const offenders = [];
    const check = (path, value) => {
      if (typeof value !== "number") return;
      if (!Number.isInteger(value)) offenders.push(`${path} = ${value}`);
    };

    check("width", layout.width);
    check("height", layout.height);
    for (const node of layout.nodes) {
      for (const key of ["x", "y", "w", "h"]) check(`node ${node.id}.box.${key}`, node.box[key]);
      check(`node ${node.id}.rank`, node.rank);
      check(`node ${node.id}.order`, node.order);
    }
    for (const group of layout.groups) {
      for (const key of ["x", "y", "w", "h"]) check(`group ${group.id}.box.${key}`, group.box[key]);
    }
    for (const edge of layout.edges) {
      edge.points.forEach(([x, y], i) => {
        check(`edge ${edge.id}.points[${i}].x`, x);
        check(`edge ${edge.id}.points[${i}].y`, y);
      });
    }

    assert.deepEqual(offenders, [],
      "a non-integer coordinate is a layout that computed a fraction, and a " +
      "fraction is where platform-dependent arithmetic gets into the artifact");
  });

  it("the walk bites when a geometric value is made fractional", () => {
    // The assertion above is only worth anything if it fails on a fraction.
    // Same walk, on a layout deliberately spoilt by half a pixel.
    const spoilt = layoutGraph(EXAMPLE.diagram);
    spoilt.nodes[0].box.x += 0.5;

    const offenders = [];
    for (const node of spoilt.nodes) {
      for (const key of ["x", "y", "w", "h"]) {
        if (!Number.isInteger(node.box[key])) offenders.push(`${node.id}.${key}`);
      }
    }
    assert.deepEqual(offenders, [`${spoilt.nodes[0].id}.x`],
      "the integer walk did not notice a fractional coordinate");
  });

  it("every geometry attribute in the delivered SVG parses as an integer", () => {
    const html = deliverInSubprocess({ spec: SPECS.diagram }).html;
    const opensAt = html.indexOf("<svg class=\"pf-graph\"");
    assert.notEqual(opensAt, -1, "no diagram canvas in the artifact");
    // The header mark is an `<svg>` too, so the close is searched for from the
    // canvas onward rather than from the top of the document.
    const svg = html.slice(opensAt, html.indexOf("</svg>", opensAt));

    const offenders = [];

    // Named numeric attributes, read one at a time rather than by scanning the
    // document for digits: only these carry geometry, and only these are asserted.
    for (const attribute of ["x", "y", "width", "height", "rx", "x1", "y1", "x2", "y2"]) {
      const pattern = new RegExp(`\\s${attribute}="([^"]*)"`, "g");
      for (const [, value] of svg.matchAll(pattern)) {
        if (!/^-?\d+$/.test(value)) offenders.push(`${attribute}="${value}"`);
      }
    }

    // Point lists, which carry the routes.
    for (const [, value] of svg.matchAll(/\spoints="([^"]*)"/g)) {
      for (const pair of value.split(" ")) {
        if (!/^-?\d+,-?\d+$/.test(pair)) offenders.push(`points pair "${pair}"`);
      }
    }

    // The canvas itself.
    const [, viewBox] = svg.match(/viewBox="([^"]*)"/) ?? [];
    assert.ok(viewBox, "the canvas declares no viewBox");
    for (const value of viewBox.split(" ")) {
      if (!/^-?\d+$/.test(value)) offenders.push(`viewBox value "${value}"`);
    }

    assert.ok(offenders.length === 0,
      `non-integer geometry in the delivered SVG: ${offenders.join(", ")}`);
    assert.ok(svg.includes("points="), "no routes were emitted, so nothing was checked");
  });
});

describe("diagram — the producer owns meaning, never the canvas", () => {
  const DRAWING_CONTROLS = [
    ["pos", [40, 300]], ["x", 40], ["y", 300], ["width", 120], ["height", 60],
    ["size", [120, 60]], ["via", [[10, 10]]], ["route", "drop"], ["lane", "main"],
    ["col", 2], ["rank", 1], ["stage", "one"], ["side", "left"], ["offset", 8],
    ["color", "#E0611F"], ["colour", "red"], ["icon", "database"], ["dot", "cyan"],
    ["preset", "blueprint"], ["emphasis", "primary"], ["animation", "trace"],
    ["orientation", "left-to-right"], ["theme", "dark"], ["style", "bold"],
    ["css", ".x{}"], ["class", "big"], ["html", "<b>x</b>"], ["svg", "<path/>"],
    ["shape", "circle"], ["stroke", "2"], ["viewBox", [100, 100]], ["zoom", 2],
  ];

  for (const [field, value] of DRAWING_CONTROLS) {
    it(`refuses \`${field}\` on a node rather than ignoring it`, () => {
      const spec = example();
      spec.diagram.nodes[0][field] = value;
      const delivery = deliverSpec(spec);

      assert.equal(delivery.status, 1, `\`${field}\` was accepted`);
      assert.ok(codes(delivery).some((code) =>
        code === "presentation_control" || code === "unknown_field"),
      `\`${field}\` produced ${codes(delivery).join(", ")}`);
    });
  }

  it("names presentation control as the renderer's, not as an unknown field", () => {
    const spec = example();
    spec.diagram.nodes[0].pos = [10, 10];
    const delivery = deliverSpec(spec);

    const diagnostic = delivery.receipt.diagnostics.find((d) => d.subject === "pos");
    assert.ok(diagnostic, `no diagnostic named \`pos\`: ${JSON.stringify(delivery.receipt)}`);
    assert.equal(diagnostic.code, "presentation_control");
    assert.match(diagnostic.message, /belongs to the\s+renderer/);
  });

  it("refuses a drawing control on an edge, a group and the diagram itself", () => {
    for (const [where, mutate] of [
      ["edge", (s) => { s.diagram.edges[0].via = [[1, 2]]; }],
      ["group", (s) => { s.diagram.groups[0].color = "red"; }],
      ["diagram", (s) => { s.diagram.orientation = "top-to-bottom"; }],
    ]) {
      const spec = example();
      mutate(spec);
      assert.equal(deliverSpec(spec).status, 1, `a drawing control on a ${where} was accepted`);
    }
  });
});

describe("diagram — refusals that are not improvisation", () => {
  it("refuses an unsupported topology by name", () => {
    const spec = example();
    spec.diagram.topology = "sequence";
    const delivery = deliverSpec(spec);

    assert.equal(delivery.status, 1);
    assert.deepEqual(codes(delivery), ["topology_unsupported"]);
    assert.match(delivery.receipt.diagnostics[0].message, /"sequence" is not a topology/);
  });

  it("refuses an unknown role", () => {
    const spec = example();
    spec.diagram.nodes[0].role = "microservice";
    assert.equal(deliverSpec(spec).status, 1);
  });

  it("refuses an unknown relation", () => {
    const spec = example();
    spec.diagram.edges[0].relation = "talks_to";
    assert.equal(deliverSpec(spec).status, 1);
  });

  it("refuses an over-long label rather than shortening it", () => {
    const spec = example();
    spec.diagram.nodes[0].label = "x".repeat(33);
    const delivery = deliverSpec(spec);

    assert.equal(delivery.status, 1);
    assert.ok(codes(delivery).includes("schema_maxLength"));
  });

  it("refuses a diagram over the node cap", () => {
    const spec = example();
    spec.diagram.nodes = [];
    for (let i = 0; i < 41; i += 1) {
      spec.diagram.nodes.push({ id: `n${i}`, label: `Node ${i}`, role: "service" });
    }
    spec.diagram.edges = [];
    spec.diagram.paths = [];
    spec.diagram.views = [];
    spec.diagram.groups = [];
    assert.ok(codes(deliverSpec(spec)).includes("schema_maxItems"));
  });

  it("refuses a diagram over the edge cap", () => {
    const spec = example();
    spec.diagram.edges = [];
    for (let i = 0; i < 81; i += 1) {
      spec.diagram.edges.push({
        id: `x${i}`, from: "human", to: "ready", relation: "triggers",
      });
    }
    spec.diagram.paths = [];
    assert.ok(codes(deliverSpec(spec)).includes("schema_maxItems"));
  });
});

describe("diagram — coherence the schema cannot express", () => {
  it("refuses an edge endpoint that is not a node", () => {
    const spec = example();
    spec.diagram.edges[0].to = "nowhere";
    assert.ok(codes(deliverSpec(spec)).includes("unresolved_reference"));
  });

  it("refuses a group parent that is itself parented", () => {
    const spec = example();
    spec.diagram.groups[0].parent = "lifecycle";
    const delivery = deliverSpec(spec);
    assert.equal(delivery.status, 1);
    assert.ok(codes(delivery).includes("group_parent_not_root"));
  });

  it("refuses a group parented to itself, by the same rule", () => {
    const spec = example();
    spec.diagram.groups[1].parent = "lifecycle";
    assert.ok(codes(deliverSpec(spec)).includes("group_parent_not_root"));
  });

  it("refuses the same relationship asserted twice", () => {
    const spec = example();
    spec.diagram.edges.push({
      id: "e-again", from: "proposed", to: "ready", relation: "transitions_to",
    });
    assert.ok(codes(deliverSpec(spec)).includes("duplicate_edge"));
  });

  it("allows two different relations between the same pair", () => {
    const spec = example();
    spec.diagram.edges.push({
      id: "e-other", from: "proposed", to: "ready", relation: "triggers",
    });
    assert.equal(deliverSpec(spec).status, 0);
  });

  it("refuses a path whose edges do not meet, naming the break", () => {
    const spec = example();
    spec.diagram.paths[0].edges = ["e-load", "e-submit"];
    const delivery = deliverSpec(spec);

    assert.equal(delivery.status, 1);
    const diagnostic = delivery.receipt.diagnostics.find((d) => d.code === "path_discontinuous");
    assert.ok(diagnostic, codes(delivery).join(", "));
    assert.match(diagnostic.message, /ends at `ready`.*starts at `in-progress`/s);
  });

  it("refuses a path that walks an edge the diagram does not have", () => {
    const spec = example();
    spec.diagram.paths[0].edges = ["e-load", "e-imaginary"];
    assert.ok(codes(deliverSpec(spec)).includes("unresolved_reference"));
  });

  it("refuses a view focused on something that is not a node", () => {
    const spec = example();
    spec.diagram.views[0].focus = ["nobody"];
    assert.ok(codes(deliverSpec(spec)).includes("unresolved_reference"));
  });

  it("refuses two things sharing an identifier", () => {
    const spec = example();
    spec.diagram.edges[0].id = "human";
    assert.ok(codes(deliverSpec(spec)).includes("duplicate_identifier"));
  });
});

describe("diagram — what stays legal, because systems are like this", () => {
  it("a self-edge is a fact, and renders", () => {
    // The example already has one: a ticket resumed across sessions.
    const resumed = EXAMPLE.diagram.edges.find((edge) => edge.from === edge.to);
    assert.ok(resumed, "the example must carry a self-edge for this to mean anything");

    const delivery = deliverInSubprocess({ spec: SPECS.diagram });
    assert.equal(delivery.status, 0);
    assert.ok(delivery.html.includes(`id="e--${resumed.id}"`));
    assert.match(groupClassOf(delivery.html, resumed.id), /pf-edge/);
  });

  it("a cycle is a fact, and ranks without one", () => {
    const cycle = EXAMPLE.diagram.edges.find((edge) =>
      edge.from === "review" && edge.to === "in-progress");
    assert.ok(cycle, "the example must carry a cycle for this to mean anything");

    const layout = layoutGraph(EXAMPLE.diagram);
    const rankOf = new Map(layout.nodes.map((node) => [node.id, node.rank]));
    assert.ok(rankOf.get("review") > rankOf.get("in-progress"),
      "the back edge should not have dragged the ranks around");
  });

  it("an isolated node is legal", () => {
    const spec = example();
    spec.diagram.nodes.push({ id: "orphan", label: "Not wired up", role: "service" });
    assert.equal(deliverSpec(spec).status, 0);
  });

  it("a diagram with no edges at all is legal", () => {
    const spec = example();
    spec.diagram.edges = [];
    delete spec.diagram.paths;
    assert.equal(deliverSpec(spec).status, 0);
  });
});

describe("diagram — the lesson kind is untouched by any of it", () => {
  it("a lesson still delivers, and still says it is a lesson", () => {
    const delivery = deliverInSubprocess({ spec: SPECS.example });
    assert.equal(delivery.status, 0);
    assert.match(delivery.html, /<div class="pf-eyebrow">Pathfinder lesson<\/div>/);
  });

  it("a lesson carries no diagram styling", () => {
    const delivery = deliverInSubprocess({ spec: SPECS.example });
    assert.ok(!delivery.html.includes(".pf-graph"),
      "diagram CSS reached a lesson, so the kind stylesheet is not per kind");
  });

  it("a lesson without a source is still refused", () => {
    const spec = JSON.parse(readFileSync(SPECS.example, "utf8"));
    delete spec.source;
    assert.ok(codes(deliverSpec(spec)).includes("missing_field"));
  });
});
