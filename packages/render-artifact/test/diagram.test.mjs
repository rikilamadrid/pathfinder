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

import {
  GEOMETRY, layoutGraph, wrapLabel,
} from "../../../skills/render-artifact/engine/render/graph/layout.mjs";
import { cellWidth } from "../../../skills/render-artifact/engine/render/graph/width.mjs";
import { render } from "../../../skills/render-artifact/engine/render/index.mjs";
import { RENDERER_VERSION } from "../../../skills/render-artifact/engine/version.mjs";
import {
  DIAGRAM_SPECIMENS, REPO_ROOT, SPECS, cleanUpTemporaryDirectories,
  deliverInSubprocess, temporaryDirectory,
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
    // Against the constant, not a literal. The claim is that the receipt names
    // the engine that produced the artifact; pinning the number here would make
    // every deliberate renderer release look like a broken test.
    assert.equal(delivery.receipt.renderer_version, RENDERER_VERSION);
    assert.match(delivery.html,
      new RegExp(`Pathfinder render-artifact ${RENDERER_VERSION.replace(/\./g, "\\.")}`));
  });

  it("carries the shared shell, one stylesheet, and the Pathfinder identity", () => {
    assert.match(delivery.html, /<div class="pf-eyebrow">Pathfinder diagram<\/div>/);
    assert.equal((delivery.html.match(/<style\b/g) ?? []).length, 1,
      "an artifact carries one stylesheet whatever its kind");
    assert.match(delivery.html, /--pf-accent:/, "the diagram inherits the shared theme");
  });

  it("carries an inline SVG canvas and no external reference", () => {
    assert.match(delivery.html, /<svg class="pf-graph" data-pf-graph viewBox="0 0 \d+ \d+"/);
    assert.doesNotMatch(delivery.html, /<img\b/, "an image would not be self-contained");
    assert.doesNotMatch(delivery.html, /https?:\/\/(?!www\.w3\.org)/i);
  });

  /* The script and the markup are written in two different files, and the only
     thing joining them is a handful of attribute names. Nothing else in this
     suite notices when one side drops a hook: an assertion that the canvas is
     "an inline SVG" is satisfied by an SVG the camera cannot find, and every
     interaction test that parses the script or runs it against a stub DOM
     supplies its own elements and so cannot see the delivered document at all.
     That is how a diagram shipped with its entire behaviour layer dead --
     `canvas.querySelector("[data-pf-graph]")` returned null, the script
     returned on its third line, and the goldens recorded it without complaint.

     So this test asserts the join itself, against the delivered bytes: every
     element the script must find is really in the document, and the one it
     guards its own entry on is really inside the canvas it looks under. */
  it("ships every element its inline script has to find", () => {
    const markup = delivery.html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");

    for (const hook of [
      "data-pf-canvas",   // the camera's container, and the keyboard tab stop
      "data-pf-graph",    // the SVG the camera writes viewBox on
      "data-pf-status",   // the live region the status sentence goes to
      "data-pf-controls", // the groups the script reveals
      "data-pf-act",      // the toolbar buttons it wires
      "data-pf-node",
      "data-pf-edge",
      "data-pf-entry",
    ]) {
      assert.ok(markup.includes(hook),
        `the script addresses [${hook}] and the document carries no such ` +
        `element, so that interaction is dead in a browser`);
    }

    // The guard the whole script returns on, checked the way the script asks
    // it: the graph hook has to be *inside* the canvas, not merely present.
    const canvasAt = markup.indexOf("data-pf-canvas");
    const graphAt = markup.indexOf("data-pf-graph");
    assert.ok(canvasAt !== -1 && graphAt > canvasAt,
      "the script looks for [data-pf-graph] under [data-pf-canvas]; if the " +
      "graph is not nested there it finds nothing and every gesture is dead");
  });

  /* The gesture model this Feature removed. These are worth asserting because
     the removal is the requirement -- a later change that "adds zoom back" by
     reinstating a wheel handler would silently restore the conflict the
     amendment exists to end, and nothing else here would notice. */
  it("intercepts no wheel or pinch gesture, and takes no touch surface", () => {
    const script = delivery.html.slice(delivery.html.indexOf("<script"));

    assert.doesNotMatch(script, /addEventListener\(\s*["']wheel["']/,
      "the explorer must not intercept wheel or trackpad scrolling");
    assert.doesNotMatch(script, /\bdeltaMode\b|\bdeltaY\b/,
      "wheel delta handling is the removed gesture model");
    assert.doesNotMatch(delivery.html, /touch-action\s*:/,
      "touch-action existed only to starve the removed touch gestures of " +
      "native scrolling; with them gone it only takes the page from touch readers");
  });

  it("drives the camera by transform, never by rewriting the viewBox", () => {
    const script = delivery.html.slice(delivery.html.indexOf("<script"));

    assert.doesNotMatch(script, /setAttribute\(\s*["']viewBox["']/,
      "the viewBox is the build-time frame; a camera that rewrites it " +
      "quantises every pan into integers and cannot be transitioned");
    assert.match(script, /style\.transform\s*=/,
      "the camera is screen-space transform state");
    assert.match(delivery.html, /transform-origin:\s*0 0/,
      "the transform is anchored top-left, which is what makes the pan a " +
      "raw pixel delta and the clamp two comparisons");
  });

  it("offers the camera's scale and an explicit route to the full reading", () => {
    const markup = delivery.html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");

    assert.match(markup, /data-pf-scale/,
      "the camera says where it is, on the control surface");
    assert.match(markup, /data-pf-act="reading"/,
      "the written reading is reachable by a deliberate press");

    // Both live inside the controls block, so scripting reveals them together
    // with the buttons: with no scripting the reading is simply already there
    // and no control promising to open it is offered.
    const tools = markup.slice(markup.indexOf('class="pf-graph-tools"'));
    const closed = tools.indexOf("data-pf-status");
    assert.ok(tools.indexOf("data-pf-scale") < closed, "scale readout is inside the controls");
    assert.ok(tools.indexOf('data-pf-act="reading"') < closed, "reading control is inside the controls");
    assert.match(markup, /<div class="pf-graph-tools" data-pf-controls hidden>/,
      "a control that cannot work without scripting is not shipped visible");
  });

  /* The keyboard route into selection, asserted on both sides of the join.

     Enhanced, the written reading is closed and the per-node focus buttons in
     it are unreachable, so the drawn component is the only way a keyboard
     reader selects anything. What makes that safe is that the promotion is the
     script's and not the document's: shipped markup would put twenty tab stops
     and twenty button roles into an artifact where, with no scripting, nothing
     can answer a press. Both halves are checked here because either one alone
     passes while the artifact is broken. */
  it("ships no keyboard control it cannot honour, and promotes every one it can", () => {
    const markup = delivery.html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    const script = delivery.html.slice(delivery.html.indexOf("<script"));

    assert.doesNotMatch(markup, /<g class="pf-node"[^>]*tabindex/,
      "a drawn node ships as a tab stop, so a reader with no scripting meets " +
      "twenty focusable shapes that do nothing when pressed");
    assert.doesNotMatch(markup, /<g class="pf-node"[^>]*role="button"/,
      "a drawn node ships as a button, which is a promise the no-scripting " +
      "artifact cannot keep");
    assert.match(markup, /<svg class="pf-graph" data-pf-graph[^>]*role="img"/,
      "with no scripting the canvas is a picture, and says so");

    assert.match(script, /setAttribute\("tabindex", "0"\)/,
      "nothing in the map is a tab stop, so keyboard selection is unreachable");
    assert.match(script, /setAttribute\("role", "button"\)/);
    assert.match(script, /setAttribute\("aria-label",\s*"Focus"/,
      "a focusable node with no accessible name announces nothing");
    assert.match(script, /setAttribute\("role", "group"\)/,
      "role=img prunes the nodes from the accessibility tree; promoting them " +
      "without lifting it gives twenty buttons that announce nothing");
    assert.match(script, /event\.key !== "Enter"/,
      "a button role that Enter does not activate is a lie about the control");
  });

  it("aims its one skip link, and gives it somewhere to land", () => {
    const markup = delivery.html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    const script = delivery.html.slice(delivery.html.indexOf("<script"));

    assert.equal((markup.match(/class="pf-skip"/g) ?? []).length, 1,
      "one skip mechanism, re-aimed — two links is two first tab stops");
    assert.match(markup, /<a class="pf-skip" data-pf-skip href="#pf-content">/,
      "the shipped href is the one that is right with no scripting at all");
    assert.match(markup, /<div class="pf-canvas" id="pf-map" data-pf-canvas tabindex="0"/,
      "the enhanced skip target has to exist, and has to take focus");
    assert.match(script, /\[data-pf-skip\]/,
      "the skip link is never re-aimed, so closed it points into the hidden " +
      "reading and the page's first tab stop leads nowhere");
  });

  it("shows the keyboard where it is on the map", () => {
    const style = delivery.html.slice(delivery.html.indexOf("<style"),
      delivery.html.indexOf("</style>"));

    assert.match(style, /\.pf-node:focus-visible \{ outline: 3px solid var\(--pf-accent\)/,
      "a control with no visible focus indicator is not keyboard operable");
    assert.match(style, /\.pf-node:focus:not\(:focus-visible\) \{ outline: none; \}/,
      "a ring after an ordinary click is noise");
    assert.match(style, /\.pf-node\[data-pf-state\]:focus-visible \{ opacity: 1; \}/,
      "a focused node the selection dims to 22% has a focus ring nobody sees");
  });

  /* Finding 3's repair, asserted so it cannot come back. `THEME_CSS` already
     forces every transition to 1ms under reduced motion, with `!important`; a
     second rule saying the same thing more weakly never applies, and a rule
     that never applies is a rule nobody can be wrong about. */
  it("states reduced motion once, where it actually applies", () => {
    const style = delivery.html.slice(delivery.html.indexOf("<style"),
      delivery.html.indexOf("</style>"));

    assert.match(style, /transition-duration: 1ms !important/,
      "the global reduced-motion rule is what produces the behaviour");
    assert.doesNotMatch(style, /\[data-pf-layout="explorer"\] \.pf-graph \{ transition: none; \}/,
      "a reduced-motion rule the global one already overrides is dead weight");
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

/**
 * Every diagram specimen, not only the shipped example.
 *
 * The example was authored alongside the renderer, so it is the graph least
 * likely to catch a layout defect. `installer` is a diagram of a real
 * repository whose topology nobody chose to suit the layout, and the
 * multilingual and proposed specimens push the label and node extremes. A
 * geometry claim worth making is a claim about all of them.
 */
const GEOMETRY_SPECIMENS = DIAGRAM_SPECIMENS.map((name) => ({
  name,
  spec: JSON.parse(readFileSync(SPECS[name], "utf8")),
}));

describe("diagram — geometry is integer, checked structurally", () => {
  const layout = layoutGraph(EXAMPLE.diagram);

  for (const { name, spec } of GEOMETRY_SPECIMENS) {
    it(`every number the ${name} layout produces is an integer`, () => {
      const produced = layoutGraph(spec.diagram);
      const offenders = [];
      const check = (path, value) => {
        if (typeof value !== "number") return;
        if (!Number.isInteger(value)) offenders.push(`${path} = ${value}`);
      };

      check("width", produced.width);
      check("height", produced.height);
      for (const node of produced.nodes) {
        for (const key of ["x", "y", "w", "h"]) {
          check(`node ${node.id}.box.${key}`, node.box[key]);
        }
        check(`node ${node.id}.rank`, node.rank);
        check(`node ${node.id}.order`, node.order);
      }
      for (const group of produced.groups) {
        for (const key of ["x", "y", "w", "h"]) {
          check(`group ${group.id}.box.${key}`, group.box[key]);
        }
      }
      for (const edge of produced.edges) {
        edge.points.forEach(([x, y], i) => {
          check(`edge ${edge.id}.points[${i}].x`, x);
          check(`edge ${edge.id}.points[${i}].y`, y);
        });
      }

      assert.deepEqual(offenders, [],
        `a non-integer coordinate in the ${name} layout is a fraction, and a ` +
        `fraction is where platform-dependent arithmetic gets into the artifact`);
    });
  }

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

  for (const { name } of GEOMETRY_SPECIMENS) {
    it(`every geometry attribute in the delivered ${name} SVG is an integer`, () => {
      assertIntegerSvg(deliverInSubprocess({ spec: SPECS[name] }).html, name);
    });
  }

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

/**
 * Assert that every geometric value in a delivered artifact's canvas is a whole
 * number.
 *
 * Read attribute by attribute rather than by scanning the document for a
 * decimal point: a stylesheet is full of them, and a test that failed because
 * `stroke-width: .5` appeared somewhere would be failing for a reason that has
 * nothing to do with layout.
 */
function assertIntegerSvg(html, what) {
  const opensAt = html.indexOf('<svg class="pf-graph"');
  assert.notEqual(opensAt, -1, `no diagram canvas in the ${what} artifact`);
  // The header mark is an `<svg>` too, so the close is searched for from the
  // canvas onward rather than from the top of the document.
  const svg = html.slice(opensAt, html.indexOf("</svg>", opensAt));

  const offenders = [];

  for (const attribute of ["x", "y", "width", "height", "rx", "x1", "y1", "x2", "y2"]) {
    const pattern = new RegExp(`\\s${attribute}="([^"]*)"`, "g");
    for (const [, value] of svg.matchAll(pattern)) {
      if (!/^-?\d+$/.test(value)) offenders.push(`${attribute}="${value}"`);
    }
  }

  for (const [, value] of svg.matchAll(/\spoints="([^"]*)"/g)) {
    for (const pair of value.split(" ")) {
      if (!/^-?\d+,-?\d+$/.test(pair)) offenders.push(`points pair "${pair}"`);
    }
  }

  const [, viewBox] = svg.match(/viewBox="([^"]*)"/) ?? [];
  assert.ok(viewBox, `the ${what} canvas declares no viewBox`);
  for (const value of viewBox.split(" ")) {
    if (!/^-?\d+$/.test(value)) offenders.push(`viewBox value "${value}"`);
  }

  assert.deepEqual(offenders, [],
    `non-integer geometry in the delivered ${what} SVG`);
}

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
    assert.ok(codes(delivery).includes("label_too_long"), codes(delivery).join(", "));
  });

  it("counts the label cap in columns, not characters", () => {
    // Seventeen wide characters is thirty-four columns and is refused; sixteen
    // is thirty-two and is accepted. A cap counted in characters would have let
    // the first through and drawn a label half again as wide as its box.
    const over = example();
    over.diagram.nodes[0].label = "\u8a18".repeat(17);
    const refused = deliverSpec(over);
    assert.equal(refused.status, 1);
    assert.ok(codes(refused).includes("label_too_long"));
    assert.match(
      refused.receipt.diagnostics.find((d) => d.code === "label_too_long").message,
      /34 columns wide and the cap is 32/);

    const atCap = example();
    atCap.diagram.nodes[0].label = "\u8a18".repeat(16);
    assert.equal(deliverSpec(atCap).status, 0, "a label exactly at the cap must be accepted");
  });

  it("refuses an over-wide edge label at its own, lower cap", () => {
    const spec = example();
    spec.diagram.edges[0].label = "x".repeat(25);
    assert.ok(codes(deliverSpec(spec)).includes("label_too_long"));
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
      // The example is `derived`, so a relationship added to it is a claim that
      // needs a citation like every other. Borrowed from the edge this one sits
      // beside rather than invented, so the assertion stays about the duplicate
      // rule and not about evidence.
      evidence: [{ path: "skills/ticket/SKILL.md", lines: [47, 47] }],
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
    spec.diagram.nodes.push({
      id: "orphan", label: "Not wired up", role: "service",
      // Cited for the same reason as above: an isolated node is still a claim
      // that something exists. Being unwired is what is under test here, not
      // being unevidenced — the uncited case has its own test.
      evidence: [{ path: "skills/ticket/store.md", lines: [7, 17] }],
    });
    assert.equal(deliverSpec(spec).status, 0);
  });

  it("a diagram with no edges at all is legal", () => {
    const spec = example();
    spec.diagram.edges = [];
    delete spec.diagram.paths;
    assert.equal(deliverSpec(spec).status, 0);
  });

  it("a diagram exactly at the node ceiling is legal, and lays out", () => {
    // Forty-one is refused above. Forty is the ceiling itself, which is the
    // case a cap test usually forgets: the refusal is easy to get right and the
    // boundary is where an off-by-one lives. Proposed with no source, so the
    // subject under test is the ceiling rather than forty citations.
    const spec = {
      schema_version: "1.0",
      kind: "diagram",
      provenance: "proposed",
      artifact: { title: "Forty nodes" },
      diagram: {
        topology: "graph",
        nodes: Array.from({ length: 40 }, (_, i) => ({
          id: `n${i}`, label: `Node ${i}`, role: "service",
        })),
        // A chain, plus a back edge, so the ceiling is exercised with a cycle
        // in it rather than as forty things in a row.
        edges: [
          ...Array.from({ length: 39 }, (_, i) => ({
            id: `c${i}`, from: `n${i}`, to: `n${i + 1}`, relation: "calls",
          })),
          { id: "back", from: "n39", to: "n0", relation: "depends_on" },
        ],
      },
    };

    const delivery = deliverSpec(spec);
    assert.equal(delivery.status, 0,
      `the node ceiling itself was refused:\n${
        JSON.stringify(delivery.receipt.diagnostics, null, 2)}`);

    for (let i = 0; i < 40; i += 1) {
      assert.ok(delivery.html.includes(`id="n--n${i}"`), `node n${i} is missing`);
    }
    assert.match(delivery.html, /<svg class="pf-graph" data-pf-graph viewBox="0 0 \d+ \d+"/);
  });
});

describe("diagram — two edges between one pair stay distinguishable", () => {
  /**
   * The reason a path names edges rather than nodes.
   *
   * Two edges join the same pair here, and a path walks exactly one of them. A
   * node sequence could not say which, so the highlight would have to guess —
   * and the acceptance criterion is that it covers exactly the authored edges,
   * not the pair they happen to join.
   */
  const spec = (() => {
    const it = example();
    it.diagram.edges.push({
      id: "e-notify",
      from: "in-progress",
      to: "store",
      relation: "publishes",
      label: "progress",
      evidence: [{ path: "skills/ticket/store.md", lines: [46, 52] }],
    });
    it.diagram.paths = [{
      id: "recording",
      label: "Recording the status",
      note: "Walks the write, and deliberately not the publish beside it.",
      edges: ["e-start", "e-record"],
      evidence: [{ path: "skills/ticket/store.md", lines: [46, 52] }],
    }];
    return it;
  })();

  const delivery = deliverSpec(spec);

  it("accepts both edges and the path that walks one of them", () => {
    assert.equal(delivery.status, 0,
      `${JSON.stringify(delivery.receipt.diagnostics, null, 2)}\n${delivery.stderr}`);
  });

  it("emphasises exactly the authored edges, not the pair", () => {
    const authored = new Set(spec.diagram.paths[0].edges);

    for (const edge of spec.diagram.edges) {
      assert.equal(
        groupClassOf(delivery.html, edge.id).includes("pf-edge-on-path"),
        authored.has(edge.id),
        `edge ${edge.id} runs ${edge.from} -> ${edge.to} and is drawn ` +
        `${authored.has(edge.id) ? "unemphasised" : "emphasised"}, which the ` +
        `authored path does not say. Two edges join in-progress and store; ` +
        `only one is on the path.`);
    }

    // Both endpoints are shared, so this is the assertion that would pass by
    // accident if emphasis were derived from nodes.
    assert.ok(authored.has("e-record") && !authored.has("e-notify"),
      "the fixture no longer has one walked and one unwalked edge on the pair");
  });

  it("renders both relationships in the written reading", () => {
    assert.ok(delivery.html.includes('id="s--e--e-record"'));
    assert.ok(delivery.html.includes('id="s--e--e-notify"'));
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

describe("diagram — the renderer never deletes a producer's words", () => {
  /** Every character the producer wrote, still present once the lines are rejoined. */
  const lossless = (label) =>
    wrapLabel(label).join(" ").replace(/\s+/g, "") === label.replace(/\s+/g, "");

  // The two that regressed: an over-long word used to consume every line the
  // box had, and each word after it was dropped in silence. A label may spill
  // past its border until the geometry contract is frozen. It may never arrive
  // shorter than it was written.
  const ADVERSARIAL = [
    "Checkout API",
    "order-events",
    `${"x".repeat(23)} ab`,
    `${"x".repeat(23)} hello`,
    "supercalifragilistic ab",
    "a b c d e f g h i j k l m n o p",
    "x".repeat(32),
    "Reserve inventory before charging",
    "",
    "   ",
    "a".repeat(70),
  ];

  for (const label of ADVERSARIAL) {
    it(`keeps every character of ${JSON.stringify(label)}`, () => {
      assert.ok(lossless(label),
        `wrapping lost text: ${JSON.stringify(label)} -> ${JSON.stringify(wrapLabel(label))}`);
    });
  }

  it("keeps every character of every label the schema admits", () => {
    // Swept rather than sampled: one long word at every length up to the cap,
    // with a short word after it, which is the shape that broke.
    const offenders = [];
    for (let length = 1; length <= 32; length += 1) {
      for (const tail of ["", " ab", " a b", " hello there"]) {
        const label = "w".repeat(length) + tail;
        if (!lossless(label)) offenders.push(label);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("never returns more lines than the box has, for labels the schema admits", () => {
    // The guarantee is scoped, and the scope is the whole point: two lines of
    // the column budget is exactly the cap, so every label that can reach the
    // renderer fits. A wider one cannot reach it — the structural layer refuses
    // it first — and wrapping such a string stays lossless without pretending
    // it would fit a box it will never be drawn in.
    for (const label of ADVERSARIAL) {
      if (cellWidth(label) > 32) continue;
      assert.ok(wrapLabel(label).length <= GEOMETRY.LABEL_MAX_LINES,
        `${JSON.stringify(label)} is ${cellWidth(label)} columns and wrapped to ` +
        `${wrapLabel(label).length} lines`);
    }
  });

  it("stays lossless even for a label the schema would refuse", () => {
    const huge = "a".repeat(70);
    assert.ok(cellWidth(huge) > 32, "this label must be over the cap to be the case in point");
    assert.equal(wrapLabel(huge).join(""), huge);
  });

  it("puts the whole label in the delivered artifact", () => {
    const delivery = deliverInSubprocess({ spec: SPECS.diagram });
    for (const node of EXAMPLE.diagram.nodes) {
      const words = node.label.split(" ").filter(Boolean);
      for (const word of words) {
        assert.ok(delivery.html.includes(word),
          `"${word}" of node label "${node.label}" is not in the artifact`);
      }
    }
  });
});

describe("diagram — the shell tolerates a specification with no source", () => {
  // This branch was written before anything could reach it, against the day a
  // kind would describe a system with no repository behind it. That day is the
  // provenance contract, and `provenance.test.mjs` now drives it end to end
  // through validation and delivery.
  //
  // What is kept here is the narrower claim, at the level the branch lives: the
  // renderer itself tolerates an absent source, without help from a validator
  // that might one day stop calling it. Rendering a `derived` specification
  // stripped of its source is deliberately a state validation refuses — it
  // cannot arrive this way in practice, which is exactly why the shell is asked
  // directly rather than through the engine.
  const html = render(JSON.parse(JSON.stringify(
    { ...EXAMPLE, source: undefined })));

  it("renders rather than throwing", () => {
    assert.match(html, /<svg class="pf-graph"/);
  });

  it("omits the rows it has no facts for, and keeps the one it has", () => {
    const footer = html.slice(html.indexOf("pf-provenance"), html.indexOf("</footer>"));
    assert.ok(!footer.includes("<dt>Repository</dt>"));
    assert.ok(!footer.includes("<dt>Commit</dt>"));
    assert.match(footer, /<dt>Renderer<\/dt>/);
  });

  it("claims nothing about evidence it never had", () => {
    assert.ok(!html.includes("checked deterministically"),
      "an artifact with no source cannot say its evidence was checked");
  });
});
