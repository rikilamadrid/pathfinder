/**
 * Interactive reading: the semantics, proved without a browser.
 *
 * The interactions are the product, but almost none of what can go wrong about
 * them is visual. Traversal that loops forever on a cycle, a path highlight
 * that lights both edges between one pair, a downstream set inferred from where
 * boxes happen to sit, an artifact whose content only exists once a script has
 * run — every one of those is a semantic defect, and every one is checkable
 * here. What a person has to judge is whether the result is *usable*, and that
 * is a separate walkthrough recorded separately.
 *
 * **The traversal under test is the traversal that ships.** `TRAVERSAL_JS` is
 * emitted into the artifact verbatim and evaluated here verbatim. Writing the
 * algorithm twice — once for the browser, once for Node — would leave two
 * implementations free to disagree about what "downstream" means, and the one
 * that shipped would be the one nobody had tested. `new Function` is how this
 * file reaches the shipped source; the engine itself contains no eval, and the
 * determinism guard forbids one on the render path.
 */

import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  TRAVERSAL_JS, interactionModel, serializeModel,
} from "../../../skills/render-artifact/engine/render/graph/interaction.mjs";
import { graphBehavior }
  from "../../../skills/render-artifact/engine/render/graph/behavior.mjs";
import { CAMERA_JS }
  from "../../../skills/render-artifact/engine/render/graph/camera.mjs";
import { layoutGraph }
  from "../../../skills/render-artifact/engine/render/graph/layout.mjs";
import { BEHAVIOR_JS } from "../../../skills/render-artifact/engine/render/behavior.mjs";
import {
  DIAGRAM_SPECIMENS, REPO_ROOT, SPECS, cleanUpTemporaryDirectories,
  deliverInSubprocess, temporaryDirectory,
} from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

/** The shipped traversal, as the artifact will run it. */
const pfTraverse = new Function(`${TRAVERSAL_JS}\nreturn pfTraverse;`)();

/** The shipped camera, on exactly the same terms. */
const pfCameraTarget =
  new Function(`${CAMERA_JS}\nreturn pfCameraTarget;`)();

const INSTALLER = JSON.parse(readFileSync(SPECS.installer, "utf8"));
/** The acceptance specimen's own geometry, as the engine computes it. */
const LAYOUT = layoutGraph(INSTALLER.diagram);
const CANVAS = `0 0 ${LAYOUT.width} ${LAYOUT.height}`;
const EXAMPLE = JSON.parse(readFileSync(SPECS.diagram, "utf8"));

/** A diagram body from a compact description, for the awkward shapes. */
function graph(nodes, edges, paths = []) {
  return {
    topology: "graph",
    nodes: nodes.map((id) => ({ id, label: id.toUpperCase(), role: "service" })),
    edges: edges.map(([id, from, to]) => ({ id, from, to, relation: "calls" })),
    paths: paths.map(([id, walked]) => ({ id, label: id, edges: walked })),
  };
}

const sorted = (list) => [...list].sort();

describe("the interaction model indexes the graph, and only the graph", () => {
  const model = interactionModel(INSTALLER.diagram);

  it("carries every node in specification order", () => {
    assert.deepEqual(model.nodes, INSTALLER.diagram.nodes.map((node) => node.id));
  });

  it("carries adjacency keyed by edge id, in both directions", () => {
    // The edge id travels with the neighbour. Without it a traversal could say
    // "from here you can reach that" and not which relationship it walked,
    // which is the whole difference between highlighting a claim and
    // highlighting a pair of boxes.
    for (const edge of INSTALLER.diagram.edges) {
      assert.ok(model.out[edge.from].some(([id, to]) => id === edge.id && to === edge.to),
        `${edge.id} is missing from the forward adjacency of ${edge.from}`);
      assert.ok(model.in[edge.to].some(([id, from]) => id === edge.id && from === edge.from),
        `${edge.id} is missing from the reverse adjacency of ${edge.to}`);
    }
  });

  it("carries each path's authored edge ids, in order, unchanged", () => {
    for (const path of INSTALLER.diagram.paths) {
      assert.deepEqual(model.paths[path.id], path.edges,
        "a path is an ordered list of exact edge ids and must survive as one");
    }
  });

  it("carries no summary, detail, note or citation", () => {
    // The model is an index. The moment it carried content, that content could
    // exist only behind a script, which is the one thing the progressive
    // enhancement contract forbids outright.
    const serialized = serializeModel(model);

    for (const node of INSTALLER.diagram.nodes) {
      if (node.summary) {
        assert.ok(!serialized.includes(node.summary),
          `node ${node.id}'s summary reached the interaction model`);
      }
      for (const citation of node.evidence ?? []) {
        assert.ok(!serialized.includes(citation.path),
          `node ${node.id}'s citation reached the interaction model`);
      }
    }
    for (const group of INSTALLER.diagram.groups) {
      if (group.summary) assert.ok(!serialized.includes(group.summary));
    }
    for (const path of INSTALLER.diagram.paths) {
      if (path.note) assert.ok(!serialized.includes(path.note));
    }
  });

  it("is a pure function of the specification", () => {
    assert.equal(
      serializeModel(interactionModel(INSTALLER.diagram)),
      serializeModel(interactionModel(structuredClone(INSTALLER.diagram))));
  });

  it("neutralises a closing script tag in a producer label", () => {
    // A label is producer text and ends up inside a script element. Unescaped,
    // `</script>` there would end the element early and spill the rest of the
    // model into the document as visible text.
    const hostile = graph(["a"], []);
    hostile.nodes[0].label = "before </script> after";

    const serialized = serializeModel(interactionModel(hostile));
    assert.ok(!/<\/script/i.test(serialized), "the closing tag survived serialization");
    assert.equal(JSON.parse(serialized.replace(/<\\\/script/g, "</script")).labels.a,
      "before </script> after",
      "escaping changed what the label says");
  });
});

describe("traversal follows directed edges, and terminates", () => {
  it("derives the reachable set from graph semantics", () => {
    // The shape from the ticket: A -> B, B -> C, B -> D, D -> E. Downstream of
    // B is C, D and E, and none of that depends on where anything is drawn.
    const model = interactionModel(graph(
      ["a", "b", "c", "d", "e"],
      [["ab", "a", "b"], ["bc", "b", "c"], ["bd", "b", "d"], ["de", "d", "e"]]));

    const down = pfTraverse(model, "b", "out");
    assert.deepEqual(sorted(down.nodes), ["b", "c", "d", "e"]);
    assert.deepEqual(sorted(down.edges), ["bc", "bd", "de"]);

    const up = pfTraverse(model, "b", "in");
    assert.deepEqual(sorted(up.nodes), ["a", "b"]);
    assert.deepEqual(sorted(up.edges), ["ab"]);
  });

  it("reports the start node as part of its own traversal", () => {
    const model = interactionModel(graph(["a", "b"], [["ab", "a", "b"]]));
    assert.equal(pfTraverse(model, "a", "out").nodes[0], "a",
      "a reader tracing downstream of a thing is still looking at that thing");
  });

  it("terminates on a cycle", () => {
    const model = interactionModel(graph(
      ["a", "b", "c"], [["ab", "a", "b"], ["bc", "b", "c"], ["ca", "c", "a"]]));

    const down = pfTraverse(model, "a", "out");
    assert.deepEqual(sorted(down.nodes), ["a", "b", "c"]);
    assert.deepEqual(sorted(down.edges), ["ab", "bc", "ca"],
      "every edge of the ring is crossed exactly once");

    const up = pfTraverse(model, "a", "in");
    assert.deepEqual(sorted(up.nodes), ["a", "b", "c"]);
  });

  it("terminates on a self-edge", () => {
    const model = interactionModel(graph(["a", "b"], [["aa", "a", "a"], ["ab", "a", "b"]]));

    const down = pfTraverse(model, "a", "out");
    assert.deepEqual(sorted(down.nodes), ["a", "b"],
      "a self-edge adds no node: the node was already there");
    assert.deepEqual(sorted(down.edges), ["aa", "ab"],
      "the self-edge is still a relationship and is still reported");
  });

  it("terminates on a two-node cycle and on a cycle of self-edges", () => {
    const pair = interactionModel(graph(["a", "b"], [["ab", "a", "b"], ["ba", "b", "a"]]));
    assert.deepEqual(sorted(pair.nodes ? pfTraverse(pair, "a", "out").nodes : []), ["a", "b"]);

    const looped = interactionModel(graph(["a"], [["aa", "a", "a"]]));
    assert.deepEqual(pfTraverse(looped, "a", "out").nodes, ["a"]);
    assert.deepEqual(pfTraverse(looped, "a", "out").edges, ["aa"]);
  });

  it("keeps both identities when two edges join one pair", () => {
    // The case that makes edge-keyed adjacency necessary. Recording only the
    // neighbour would collapse these two claims into one.
    const model = interactionModel(graph(
      ["a", "b"], [["first", "a", "b"], ["second", "a", "b"]]));

    const down = pfTraverse(model, "a", "out");
    assert.deepEqual(sorted(down.nodes), ["a", "b"]);
    assert.deepEqual(sorted(down.edges), ["first", "second"],
      "two edges between one pair are two relationships, not one");
  });

  it("returns the node alone when it is isolated", () => {
    const model = interactionModel(graph(["a", "lonely"], [["aa", "a", "a"]]));
    assert.deepEqual(pfTraverse(model, "lonely", "out"), { nodes: ["lonely"], edges: [] });
    assert.deepEqual(pfTraverse(model, "lonely", "in"), { nodes: ["lonely"], edges: [] });
  });

  it("refuses to invent a traversal for a node it does not have", () => {
    const model = interactionModel(graph(["a"], []));
    assert.deepEqual(pfTraverse(model, "nowhere", "out"), { nodes: ["nowhere"], edges: [] });
  });

  it("agrees with the real repository's graph", () => {
    // Computed independently of the renderer: the installer fixture's own
    // edges, walked here, must give the same answer the artifact will.
    const model = interactionModel(INSTALLER.diagram);
    const expected = reachable(INSTALLER.diagram, "cli");

    const down = pfTraverse(model, "cli", "out");
    assert.deepEqual(sorted(down.nodes), sorted([...expected.out, "cli"]));

    const up = pfTraverse(model, "cli", "in");
    assert.deepEqual(sorted(up.nodes), sorted([...expected.in, "cli"]));

    assert.ok(expected.out.size >= 15 && expected.in.size >= 5,
      "run() must stay the dense node this assertion is interesting about");
    assert.ok(expected.out.has("developer"),
      "the installer graph must keep its cycle back through the human, or " +
      "termination is no longer being exercised on the real specimen");
  });

  /** Breadth-first reachability, written here so the test owns its own answer. */
  function reachable(diagram, start) {
    const step = (pick) => {
      const seen = new Set();
      const queue = [start];
      while (queue.length > 0) {
        const current = queue.shift();
        for (const edge of diagram.edges) {
          const [from, to] = pick(edge);
          if (from !== current || seen.has(to) || to === start) continue;
          seen.add(to);
          queue.push(to);
        }
      }
      return seen;
    };
    return {
      out: step((edge) => [edge.from, edge.to]),
      in: step((edge) => [edge.to, edge.from]),
    };
  }
});

describe("path highlight selects the authored edges and no others", () => {
  it("selects exactly the edge the path names, where two join one pair", () => {
    const model = interactionModel(graph(
      ["a", "b"],
      [["first", "a", "b"], ["second", "a", "b"]],
      [["chosen", ["second"]]]));

    assert.deepEqual(model.paths.chosen, ["second"]);
    assert.ok(!model.paths.chosen.includes("first"),
      "the highlight would light up a relationship the producer did not walk");
  });

  it("keeps a repeated edge's position in the walk", () => {
    // `publish` in the installer fixture and `offswitch` share `e-plan`-class
    // reuse: an edge may legitimately appear in more than one path, and a path
    // may cross the same pair twice. Order and multiplicity are the claim.
    const model = interactionModel(graph(
      ["a", "b", "c"],
      [["ab", "a", "b"], ["bc", "b", "c"], ["ca", "c", "a"]],
      [["loop", ["ab", "bc", "ca", "ab"]]]));

    assert.deepEqual(model.paths.loop, ["ab", "bc", "ca", "ab"],
      "a walk that crosses an edge twice says so, and the model must not dedupe it");
  });

  it("carries the real fixture's three paths exactly", () => {
    const model = interactionModel(INSTALLER.diagram);
    assert.deepEqual(model.paths, {
      install: ["e-invoke", "e-serve", "e-handoff", "e-plan", "e-apply", "e-write"],
      offswitch: ["e-plan", "e-planfilters"],
      publish: ["e-prepack", "e-serve", "e-handoff"],
    });
  });

  it("can resolve each authored edge to its endpoints without touching geometry", () => {
    const model = interactionModel(INSTALLER.diagram);
    for (const path of INSTALLER.diagram.paths) {
      for (const id of path.edges) {
        const edge = INSTALLER.diagram.edges.find((candidate) => candidate.id === id);
        assert.deepEqual(model.edges[id], [edge.from, edge.to]);
      }
    }
  });
});

/**
 * The emitted script, compiled and run.
 *
 * Every other assertion in this file tests a function the engine exports. None
 * of them would notice a syntax error in the script that actually ships, or a
 * null dereference on load — the artifact would deliver, the goldens would
 * faithfully record the broken bytes, and the whole suite would stay green
 * while the delivered page did nothing at all.
 *
 * So the script is compiled here, and then run against a DOM small enough to
 * be obviously honest: the elements the real artifact emits, the attributes the
 * script is allowed to set, and nothing that pretends to lay anything out. What
 * this proves is that the interactions compute the right state. Whether that
 * state *looks* right is a person's judgement, recorded separately.
 */
describe("the script that ships runs, and computes the right state", () => {
  const model = interactionModel(INSTALLER.diagram);
  const script = graphBehavior(serializeModel(model));

  it("compiles", () => {
    // The cheapest guard in this file, and the one covering the largest
    // failure: a broken script ships silently.
    assert.doesNotThrow(() => new Function(script),
      "the inline script does not parse, so the delivered artifact is inert");
  });

  it("initialises without touching anything it should not", () => {
    const dom = fakeDocument();
    run(script, dom);

    assert.ok(dom.controls.every((group) => group.hidden === false),
      "the controls were never revealed, so nothing is operable");
    assert.equal(dom.svg.getAttribute("viewBox"), CANVAS,
      "the initial view is the whole graph");
    assert.equal(dom.canvas.getAttribute("data-pf-zoom"), "fit");
    assert.match(dom.status.textContent, /Nothing selected/);
    assert.equal(dom.tool("upstream").disabled, true,
      "traversal is offered before anything is selected");
    assert.equal(dom.tool("zoom-out").disabled, true,
      "zoom-out is offered at the fit floor, where it does nothing");
  });

  it("focuses a node, and dims what the node does not touch", () => {
    const dom = fakeDocument();
    run(script, dom);
    dom.clickPick("cli");

    assert.deepEqual(dom.state("node", "on"), ["cli"]);
    assert.equal(dom.canvas.getAttribute("data-pf-mode"), "focus");
    assert.deepEqual(dom.current(), ["cli"],
      "the written entry carrying the evidence is not marked current");

    // Exactly the edges incident to the node, from the model's own adjacency.
    const incident = new Set([
      ...model.out.cli.map(([id]) => id), ...model.in.cli.map(([id]) => id),
    ]);
    assert.deepEqual(sorted(dom.state("edge", "on")), sorted([...incident]));
    assert.ok(dom.state("node", "off").length > 0, "nothing was dimmed");
    assert.equal(dom.tool("upstream").disabled, false);
  });

  it("traces downstream over the graph, terminating through the cycle", () => {
    const dom = fakeDocument();
    run(script, dom);
    dom.clickPick("cli");
    dom.clickAct("downstream");

    const expected = pfTraverse(model, "cli", "out");
    assert.deepEqual(sorted(dom.state("node", "on")), sorted(expected.nodes));
    assert.deepEqual(sorted(dom.state("edge", "on")), sorted(expected.edges));
    assert.match(dom.status.textContent, /^Downstream of run\(\): \d+ components reached/);
  });

  it("traces upstream over the reverse edges", () => {
    const dom = fakeDocument();
    run(script, dom);
    dom.clickPick("cli");
    dom.clickAct("upstream");

    const expected = pfTraverse(model, "cli", "in");
    assert.deepEqual(sorted(dom.state("node", "on")), sorted(expected.nodes));
    assert.match(dom.status.textContent, /^Upstream of run\(\)/);
  });

  it("highlights exactly the edges an authored path names", () => {
    const dom = fakeDocument();
    run(script, dom);
    dom.clickPath("offswitch");

    assert.deepEqual(sorted(dom.state("edge", "on")), sorted(model.paths.offswitch));
    assert.equal(dom.canvas.getAttribute("data-pf-mode"), "path");

    // Every other edge is dimmed, including ones between the same nodes.
    const lit = new Set(model.paths.offswitch);
    for (const id of Object.keys(model.edges)) {
      if (lit.has(id)) continue;
      assert.ok(!dom.state("edge", "on").includes(id),
        `edge ${id} lit up and the path does not walk it`);
    }
  });

  it("zooms, pans within the graph's bounds, and fits back", () => {
    const dom = fakeDocument();
    run(script, dom);

    /* The camera is transform state now, and the viewBox is the build-time
       frame it never rewrites. Reading `style.transform` is reading exactly
       what the browser would paint. */
    const camera = () => {
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/
        .exec(dom.svg.style.transform || "");
      assert.ok(m, `camera transform unreadable: ${dom.svg.style.transform}`);
      return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
    };

    dom.clickAct("zoom-in");
    const zoomed = camera();
    assert.ok(zoomed.scale > 1, "zooming in did not raise the scale");
    assert.equal(dom.svg.getAttribute("viewBox"), CANVAS,
      "the camera rewrote the viewBox, which is the build-time frame");
    assert.equal(dom.tool("zoom-out").disabled, false);

    dom.key("ArrowRight");
    const panned = camera();
    assert.notEqual(panned.x, zoomed.x, "arrow-key panning did not move the camera");
    assert.ok(panned.x <= 0 && panned.y <= 0,
      "the camera left the graph's bounds, so there is empty space on screen");
    assert.ok(panned.x >= 800 - 800 * panned.scale,
      "the camera panned past the content's far edge");

    dom.clickAct("fit");
    assert.deepEqual(camera(), { x: 0, y: 0, scale: 1 }, "fit did not restore the overview");
  });

  it("clears on Escape, and reset clears with it", () => {
    const dom = fakeDocument();
    run(script, dom);
    dom.clickPick("cli");
    dom.key("Escape", { onDocument: true });

    assert.equal(dom.state("node", "on").length, 0);
    assert.deepEqual(dom.current(), []);
    assert.match(dom.status.textContent, /Selection cleared/);

    dom.clickPick("cli");
    dom.clickAct("zoom-in");
    dom.clickAct("reset");
    assert.equal(dom.svg.getAttribute("viewBox"), CANVAS);
    assert.equal(dom.state("node", "on").length, 0);
  });

  /* ---- the map is the application, so the map is the keyboard surface ----

     Enhanced, the written reading is closed and its per-node focus buttons go
     with it. If selection is only reachable through them, a keyboard-only
     reader cannot select a component at all without first leaving the
     explorer for the fallback document — which is the defect these four cases
     exist to keep repaired. */

  it("makes every drawn component a control, named from the index", () => {
    const dom = fakeDocument();
    run(script, dom);

    assert.equal(dom.svg.getAttribute("role"), "group",
      "the SVG kept role=img, which prunes everything inside it from the " +
      "accessibility tree: the nodes would take focus and announce nothing");

    for (const node of INSTALLER.diagram.nodes) {
      const drawn = dom.node(node.id);
      assert.equal(drawn.getAttribute("tabindex"), "0",
        `${node.id} is not a tab stop, so the keyboard cannot reach it`);
      assert.equal(drawn.getAttribute("role"), "button");
      assert.equal(drawn.getAttribute("aria-label"), `Focus ${node.label}`,
        "the accessible name has to carry the label the reader can see");
    }
  });

  for (const key of ["Enter", " "]) {
    it(`selects from the keyboard on ${key === " " ? "Space" : key}`, () => {
      const dom = fakeDocument();
      run(script, dom);
      const event = dom.pressNode("cli", key);

      assert.equal(dom.canvas.getAttribute("data-pf-mode"), "focus");
      assert.deepEqual(dom.state("node", "on"), ["cli"]);
      assert.equal(dom.node("cli").getAttribute("aria-current"), "true",
        "a reader who is not looking at the picture cannot tell which of " +
        "twenty buttons is the current selection");
      assert.ok(dom.state("node", "off").length > 0, "nothing was dimmed");
      assert.equal(dom.tool("upstream").disabled, false);
      assert.ok(event.prevented,
        "left alone, Space scrolls and Enter can navigate");
    });
  }

  it("reaches the same selection by keyboard and by pointer", () => {
    const shape = (dom) => ({
      mode: dom.canvas.getAttribute("data-pf-mode"),
      on: sorted(dom.state("node", "on")),
      near: sorted(dom.state("node", "near")),
      off: sorted(dom.state("node", "off")),
      edges: sorted(dom.state("edge", "on")),
      current: dom.current(),
      status: dom.status.textContent,
      reading: dom.document.body.getAttribute("data-pf-reading"),
      tools: ["upstream", "downstream", "details", "clear"]
        .map((name) => `${name}:${dom.tool(name).disabled}`),
    });

    const byKey = fakeDocument();
    run(script, byKey);
    byKey.pressNode("prompter", "Enter");

    const byPointer = fakeDocument();
    run(script, byPointer);
    byPointer.clickNode("prompter");

    assert.deepEqual(shape(byKey), shape(byPointer),
      "one visible control with two ways in has to reach one state");
  });

  it("offers no control for a drawn node the model does not carry", () => {
    // A focusable thing that does nothing when pressed is the defect this
    // repair removes, so an unnameable node is not promoted in the first place.
    const dom = fakeDocument();
    run(script, dom);
    const orphan = dom.pressNode("no-such-node", "Enter");

    assert.equal(dom.canvas.getAttribute("data-pf-mode"), "",
      "the script invented a selection for an id the model does not carry");
    assert.ok(!orphan.prevented,
      "a key the script does not act on must stay the page's");
  });

  it("aims the one skip link at whichever reading is on screen", () => {
    const dom = fakeDocument();
    run(script, dom);

    assert.equal(dom.skip.getAttribute("href"), "#pf-map",
      "closed, the reading is display:none and the skip link is the page's " +
      "first tab stop: it has to land on the map, not inside the hidden article");
    assert.equal(dom.skip.textContent, "Skip to the map");

    dom.clickAct("reading");
    assert.equal(dom.skip.getAttribute("href"), "#pf-content",
      "open, the written reading is the content again");
    assert.equal(dom.skip.textContent, "Skip to content",
      "the fallback wording is read off the delivered link, never restated");

    dom.clickAct("reading");
    assert.equal(dom.skip.getAttribute("href"), "#pf-map");
  });

  it("docks the selected component's own card, and no copy of it", () => {
    const dom = fakeDocument();
    run(script, dom);
    const before = dom.readingOrder();
    const card = dom.entry("node", "cli");

    dom.clickNode("cli");

    assert.deepEqual(dom.docked(), ["cli"],
      "the panel shows the selected component and nothing else");
    assert.equal(dom.panel.hidden, false, "the panel is still closed");
    // The element in the panel is the element that was in the reading. Not an
    // element carrying the same id -- the same object. A clone would satisfy
    // every other assertion here and is exactly what must not happen.
    assert.equal(dom.panelSlot.children[0], card,
      "the panel holds a different element than the one the reading had");
    assert.ok(!dom.readingOrder().includes("cli"),
      "the card is in two places at once, so a reader meets it twice");
    assert.equal(before.filter((id) => id === "cli").length, 1,
      "the reading carried more than one card for this component to begin with");
  });

  it("puts every moved element back exactly where it came from", () => {
    const dom = fakeDocument();
    run(script, dom);
    const before = dom.readingOrder();

    // A sequence, not a single round trip: the restore that breaks is the one
    // after a selection has already moved rows out of the middle of a list.
    dom.clickNode("cli");
    dom.clickNode("installer");
    dom.clickNode("cli");
    dom.clickAct("clear");

    assert.deepEqual(dom.readingOrder(), before,
      "a card or an evidence row came back in the wrong place");
    assert.deepEqual(dom.docked(), [], "the panel still holds a card");
    assert.deepEqual(dom.dockedEdges(), [], "the panel still holds evidence rows");
    assert.equal(dom.panel.hidden, true, "an empty panel is left on screen");
  });

  it("shows what runs in and what runs out, as the document's own rows", () => {
    const dom = fakeDocument();
    run(script, dom);
    dom.clickNode("cli");

    const incident = INSTALLER.diagram.edges
      .filter((edge) => edge.from === "cli" || edge.to === "cli")
      .map((edge) => edge.id);

    assert.deepEqual([...dom.dockedEdges()].sort(), [...incident].sort(),
      "the panel names a different set of relationships than the graph does");
    assert.equal(dom.panelRelations.hidden, false);
  });

  it("gives the reading back its rows before the full reading opens", () => {
    const dom = fakeDocument();
    run(script, dom);
    const before = dom.readingOrder();

    dom.clickNode("cli");
    dom.clickAct("reading");

    assert.deepEqual(dom.readingOrder(), before,
      "the full reading is missing the rows the panel borrowed");
    assert.equal(dom.panel.hidden, true,
      "the panel competes with the reading it just handed everything back to");

    // ...and closing it re-docks, so the two never disagree about selection.
    dom.clickAct("reading");
    assert.deepEqual(dom.docked(), ["cli"],
      "returning to the map lost the selection the map still shows");
  });

  it("disables every control that carries an action, not the first one", () => {
    const dom = fakeDocument();
    run(script, dom);

    assert.equal(dom.tool("clear").disabled, true);
    assert.equal(dom.tool("details").disabled, true);
    dom.clickNode("cli");
    assert.equal(dom.tool("clear").disabled, false);
    assert.equal(dom.tool("details").disabled, false);
  });

  it("publishes a free rectangle for the camera that comes next", () => {
    const dom = fakeDocument();
    run(script, dom);

    const free = dom.canvas.getAttribute("data-pf-free");
    assert.ok(free, "52.2 has no rectangle to frame into");
    assert.match(free, /^\d+ \d+ \d+ \d+$/,
      "the contract is four integers in canvas-local pixels");

    const [x, y, width, height] = free.split(" ").map(Number);
    const box = dom.canvas.getBoundingClientRect();
    const bar = dom.controls[0].getBoundingClientRect();
    assert.ok(width > 0 && height > 0, "an empty rectangle frames nothing");
    assert.ok(x + width <= box.width && y + height <= box.height,
      "the free rectangle reaches outside the canvas it describes");
    assert.ok(dom.document.querySelectorAll("[data-pf-chrome]").length === 1,
      "the camera rectangle is computed from a hook that matches more than " +
      "one element, so which one it means is document order and not intent");
    assert.equal(height, bar.top - box.top,
      "the rectangle includes the band the controls float over, so a camera " +
      "framing into it would park a node under them");
  });

  /* ---- selecting a component moves the camera to it ----

     52.3 asserted here that selection moved no camera, because the panel was
     the only thing being built and a camera framing into a rectangle that did
     not exist yet would have been guesswork. The rectangle exists now, so the
     assertion inverts: the camera moves, it frames into what the panel and the
     toolbar left free, and the graph underneath it does not move at all. */

  it("moves the camera to the component the reader selected", () => {
    const dom = fakeDocument();
    run(script, dom);
    const before = dom.svg.style.transform;

    dom.clickNode("cli");

    assert.notEqual(dom.svg.style.transform, before,
      "selecting a component left the camera where it was, so the reader was " +
      "given a selection they may not be able to see");
    assert.equal(dom.canvas.getAttribute("data-pf-zoom"), "in",
      "the camera framed a component without leaving the overview scale, " +
      "which is the scale this Feature exists to escape");
    assert.equal(dom.svg.getAttribute("viewBox"), CANVAS,
      "the camera rewrote the viewBox rather than moving the viewpoint");
  });

  it("moves the viewpoint, and never the graph", () => {
    const dom = fakeDocument();
    run(script, dom);

    /* Every coordinate the build-time layout wrote, before and after a
       sequence that moves the camera four times. Nothing in the graph may
       translate, reflow or appear to change position, because nothing in the
       graph does -- and the integers on the drawn elements are where that
       claim is either true or false. */
    const coordinates = () => LAYOUT.nodes.map((placed) => {
      const rect = dom.node(placed.id).querySelector("rect");
      return [
        rect.getAttribute("x"), rect.getAttribute("y"),
        rect.getAttribute("width"), rect.getAttribute("height"),
      ].join(",");
    });

    const before = coordinates();
    dom.clickNode("cli");
    dom.clickNode("copylist");
    dom.clickAct("zoom-in");
    dom.key("ArrowRight");
    dom.clickAct("fit");

    assert.deepEqual(coordinates(), before,
      "a node's drawn coordinates changed across a sequence of interactions, " +
      "so the map is not fixed and the motion is not a camera");
  });

  it("says how many related components the frame left out", () => {
    const dom = fakeDocument();
    run(script, dom);

    /* `copylist` is the specimen's worst case: its direct neighbours span
       1984x1476 of a 2148x1612 canvas, which cannot be framed whole at any
       readable scale. The reader is told so rather than left to conclude the
       relationships are not there. */
    dom.clickNode("copylist");
    assert.match(dom.status.textContent,
      /^Focused: .*\. \d+ direct relationships?\. \d+ related components? outside the frame\.$/,
      `the status line does not report the off-frame remainder: ` +
      `"${dom.status.textContent}"`);

    /* And a component whose neighbourhood does fit says nothing about a
       remainder, because there is none. An affordance that fires either way
       teaches a reader to ignore it. */
    dom.clickNode("theme");
    assert.match(dom.status.textContent, /^Focused: .*\. \d+ direct relationships?\.$/,
      `a fully framed neighbourhood still claimed something was off-frame: ` +
      `"${dom.status.textContent}"`);
  });

  it("applies the camera immediately when the reader prefers reduced motion", () => {
    const dom = fakeDocument();
    run(script, dom, { reduceMotion: true });
    const before = dom.svg.style.transform;

    dom.clickNode("cli");

    assert.equal(dom.canvas.getAttribute("data-pf-camera"), null,
      "the camera announced an animated move to a reader who asked for none");
    assert.notEqual(dom.svg.style.transform, before,
      "reduced motion withheld the camera change itself; the state has to " +
      "remain reachable, only the animation goes");
  });

  it("animates a step, and leaves a drag alone", () => {
    const dom = fakeDocument();
    run(script, dom);

    /* A zoom control is a jump between two positions of a fixed map, so it
       moves the way an automatic focus moves. */
    dom.clickAct("zoom-in");
    assert.equal(dom.canvas.getAttribute("data-pf-camera"), "move",
      "pressing a zoom control jumped the camera instead of moving it");

    const at = () => {
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/
        .exec(dom.svg.style.transform);
      assert.ok(m, `camera transform unreadable: ${dom.svg.style.transform}`);
      return { x: Number(m[1]), y: Number(m[2]) };
    };
    const before = at();

    /* A drag is already continuous. Easing it would put the map behind the
       hand moving it, which is the opposite of the 1:1 pan this Feature
       requires. */
    dom.drag(-40, -24);
    assert.equal(dom.canvas.getAttribute("data-pf-camera"), null,
      "the camera animated a drag, so the map lags the pointer and the pan " +
      "is no longer 1:1");

    /* And it followed the pointer exactly: the delta the hand travelled,
       straight into the camera, with nothing rounded or eased out of it. */
    const after = at();
    assert.equal(after.x - before.x, -40, "the drag lost horizontal movement");
    assert.equal(after.y - before.y, -24, "the drag lost vertical movement");
  });

  it("does not leave a move running when the camera did not move", () => {
    const dom = fakeDocument();
    run(script, dom);

    /* Focusing the component that is already focused computes the same target,
       so the transform never changes, so no transition starts and no
       transitionend can arrive to end the move. Left set, the moving state
       outlives a move that never happened and the next camera write animates
       when it should track -- a resize correction easing into place instead of
       following the window. */
    dom.clickNode("cli");
    assert.equal(dom.canvas.getAttribute("data-pf-camera"), "move",
      "the first focus did not start a move, so this case proves nothing");

    dom.clickNode("cli");
    assert.equal(dom.canvas.getAttribute("data-pf-camera"), null,
      "re-focusing the focused component left the camera in its moving state, " +
      "waiting for a transitionend that cannot happen");

    /* The same defect reached through a different door: fit, while already
       fitted, writes the transform it already wrote. */
    dom.clickAct("fit");
    dom.key("0");
    assert.equal(dom.canvas.getAttribute("data-pf-camera"), null,
      "fitting an already-fitted camera left the moving state set");
  });

  it("animates a move, and hands it to the reader where it had reached", () => {
    const dom = fakeDocument();
    /* Mid-flight: what the browser is painting part-way through the move,
       which is neither where the camera started nor where it was going. */
    const painting = { value: "none" };
    run(script, dom, { computedTransform: () => painting.value });

    dom.clickNode("cli");
    assert.equal(dom.canvas.getAttribute("data-pf-camera"), "move",
      "an automatic camera move was not animated, so there is nothing for a " +
      "reader to interrupt");

    painting.value = "matrix(1.7, 0, 0, 1.7, -120.5, -240.25)";
    dom.press();

    assert.equal(dom.canvas.getAttribute("data-pf-camera"), null,
      "the move carried on after the reader took hold of the map");
    assert.equal(dom.svg.style.transform,
      "translate(-120.5px, -240.25px) scale(1.7)",
      "the camera snapped to the target or back to the start instead of " +
      "continuing from where the reader could see it");
  });

  it("ignores a node it does not have", () => {
    const dom = fakeDocument();
    run(script, dom);
    dom.clickPick("no-such-node");

    assert.equal(dom.canvas.getAttribute("data-pf-mode"), "",
      "the script invented a selection for an id the model does not carry");
  });

  /**
   * Run the emitted script against a stub document.
   *
   * The two options are the browser facts the camera legitimately asks for:
   * whether the reader prefers reduced motion, and what transform is being
   * painted right now. Both are defaulted to the plain case, so every test
   * that does not care about motion reads as though neither existed.
   */
  function run(source, dom, { reduceMotion = false, computedTransform } = {}) {
    new Function("document", "window", source)(dom.document, {
      localStorage: null,
      addEventListener() {},
      matchMedia: (query) => ({
        matches: reduceMotion && query.includes("reduce"),
        addEventListener() {},
      }),
      getComputedStyle: computedTransform
        ? () => ({ transform: computedTransform() })
        : undefined,
    });
  }

  /**
   * The smallest document the script can be judged against: the elements the
   * renderer emits, and attribute bookkeeping. It lays nothing out and draws
   * nothing, which is the point — the script is not allowed to depend on that.
   */
  function fakeDocument() {
    /* The panel moves real elements between real containers, so the stub
       carries a parent/child model. Without one, "the card was moved and put
       back exactly where it was" is not a claim this file could make — and it
       is the claim most worth making, because a restore that misfiles an
       evidence row corrupts the reading silently. */
    const element = (attrs = {}) => ({
      attrs: { ...attrs },
      hidden: true,
      disabled: false,
      textContent: "",
      children: [],
      parentNode: null,
      get nextSibling() {
        if (!this.parentNode) return null;
        const at = this.parentNode.children.indexOf(this);
        return at === -1 ? null : (this.parentNode.children[at + 1] ?? null);
      },
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      insertBefore(child, before) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        const at = before ? this.children.indexOf(before) : -1;
        if (at === -1) this.children.push(child);
        else this.children.splice(at, 0, child);
        return child;
      },
      removeChild(child) {
        const at = this.children.indexOf(child);
        if (at !== -1) this.children.splice(at, 1);
        child.parentNode = null;
        return child;
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name)
          ? this.attrs[name] : null;
      },
      setAttribute(name, value) { this.attrs[name] = String(value); },
      removeAttribute(name) { delete this.attrs[name]; },
      addEventListener() {},
      closest() { return null; },
      hasAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name);
      },
      /* The camera asks a drawn node for its box, which is a child element
         carrying the integers the layout wrote. A stub that could not answer
         that would force the camera to reach for something else, and the
         something else would be the rendered picture. */
      querySelector(selector) {
        for (const child of this.children) {
          if (child.tag === selector) return child;
        }
        return null;
      },
      scrollIntoView() {},
      getBoundingClientRect() {
        return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600,
          width: 800, height: 600 };
      },
      // A screen-space camera writes one style property and reads the box the
      // browser is painting. Both are legitimate for the script to touch, so
      // the stub carries them; it still lays nothing out and draws nothing.
      style: {},
      clientWidth: 800,
      clientHeight: 600,
    });

    /* The real canvas, from the real layout. The camera reads its dimensions
       off the viewBox and each node's box off the drawn rect, so a stub with
       invented geometry would be testing arithmetic against numbers no
       artifact will ever carry. */
    const svg = element({
      viewBox: `0 0 ${LAYOUT.width} ${LAYOUT.height}`, role: "img",
    });
    const canvas = element({ "data-pf-canvas": "" });
    canvas.querySelector = () => svg;
    // The explorer's map carries the id the one skip link is aimed at.
    canvas.id = "pf-map";

    const nodes = INSTALLER.diagram.nodes.map((node) => {
      const drawn = element({ "data-pf-node": node.id });
      /* The box `draw.mjs` emits, with the integers `layout.mjs` computed. */
      const box = LAYOUT.nodes.find((placed) => placed.id === node.id).box;
      const rect = element({
        x: box.x, y: box.y, width: box.w, height: box.h,
      });
      rect.tag = "rect";
      drawn.appendChild(rect);
      // A drawn node is the control now, so the stub has to answer the same
      // question the script asks of a key event's target.
      drawn.closest = (selector) =>
        selector === "[data-pf-node]" ? drawn : null;
      return drawn;
    });
    const edges = INSTALLER.diagram.edges.map((edge) =>
      element({ "data-pf-edge": edge.id }));
    const entries = [
      ...INSTALLER.diagram.nodes.map((node) =>
        element({ "data-pf-entry": "node", "data-pf-for": node.id })),
      ...INSTALLER.diagram.edges.map((edge) =>
        element({ "data-pf-entry": "edge", "data-pf-for": edge.id })),
      ...INSTALLER.diagram.paths.map((path) =>
        element({ "data-pf-entry": "path", "data-pf-for": path.id })),
    ];
    /* The written reading's own containers, so a docked card has somewhere to
       come back to and the order it comes back in is observable. */
    const reading = element();
    const edgeList = element();
    for (const entry of entries) {
      const home = entry.getAttribute("data-pf-entry") === "edge" ? edgeList : reading;
      home.appendChild(entry);
    }

    const panel = element({ "data-pf-panel": "" });
    const panelSlot = element({ "data-pf-panel-slot": "" });
    const panelEdges = element({ "data-pf-panel-edges": "" });
    const panelRelations = element({ "data-pf-panel-relations": "" });

    const controls = [element(), element()];
    controls[0].attrs["data-pf-controls"] = "";
    controls[0].attrs["data-pf-chrome"] = "";
    /* The controls float over the map's bottom edge, and the free rectangle is
       the map above them. The stub says where they are, so the arithmetic has
       something real to subtract rather than the canvas's own box. */
    controls[0].getBoundingClientRect = () => ({
      x: 24, y: 500, top: 500, left: 24, right: 500, bottom: 580,
      width: 476, height: 80,
    });
    const status = element();

    const tools = {};
    for (const name of [
      "zoom-in", "zoom-out", "fit", "reset",
      "upstream", "downstream", "details", "clear", "reading",
    ]) tools[name] = element({ "data-pf-act": name });

    const listeners = { document: [], canvas: [], svg: [] };
    canvas.addEventListener = (type, fn) => listeners.canvas.push([type, fn]);
    svg.addEventListener = (type, fn) => listeners.svg.push([type, fn]);

    // The shell's one skip link, shipped aimed at the written reading.
    const skip = element({ "data-pf-skip": "", href: "#pf-content" });
    skip.textContent = "Skip to content";

    // The explorer closes the written reading on the body, so the stub has
    // one. It carries nothing else: the page shape it drives is a stylesheet
    // concern, and this document lays nothing out.
    const body = element();

    const document = {
      body,
      querySelector(selector) {
        if (selector.includes("data-pf-canvas")) return canvas;
        if (selector.includes("data-pf-status")) return status;
        if (selector.includes("data-pf-skip")) return skip;
        if (selector.includes("data-pf-panel-slot")) return panelSlot;
        if (selector.includes("data-pf-panel-edges")) return panelEdges;
        if (selector.includes("data-pf-panel-relations")) return panelRelations;
        if (selector.includes("data-pf-panel")) return panel;
        if (selector.includes("data-pf-chrome")) return controls[0];
        if (selector.includes("data-pf-controls")) return controls[0];
        const act = selector.match(/data-pf-act="([a-z-]+)"/);
        if (act) return tools[act[1]] ?? null;
        const entry = selector.match(/data-pf-for="([^"]*)"/);
        if (entry) {
          return entries.find((candidate) =>
            candidate.getAttribute("data-pf-for") === entry[1]) ?? null;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector.includes("data-pf-chrome")) return [controls[0]];
        if (selector.includes("data-pf-controls")) return controls;
        // Two surfaces now carry "clear" and "details", so the script asks for
        // every control with an action rather than the first one.
        const act = selector.match(/data-pf-act="([a-z-]+)"/);
        if (act) return tools[act[1]] ? [tools[act[1]]] : [];
        if (selector.includes("data-pf-node")) return nodes;
        if (selector.includes("data-pf-edge")) return edges;
        if (selector.includes("data-pf-entry")) return entries;
        return [];
      },
      addEventListener(type, fn) { listeners.document.push([type, fn]); },
    };

    const fire = (where, type, event) => {
      for (const [kind, fn] of listeners[where]) if (kind === type) fn(event);
    };

    const clickTarget = (attribute, value) => {
      const target = element({ [attribute]: value });
      target.closest = (selector) =>
        selector === `[${attribute}]` ? target : null;
      fire("document", "click", { target });
    };

    /* What the reading looks like right now, as ids in order. Comparing this
       before and after an interaction is how "the card went back exactly where
       it came from" becomes a check rather than a hope. */
    const readingOrder = () => [
      ...reading.children.map((el) => el.getAttribute("data-pf-for")),
      "|",
      ...edgeList.children.map((el) => el.getAttribute("data-pf-for")),
    ];

    return {
      document, canvas, svg, status, controls, skip,
      panel, panelSlot, panelEdges, panelRelations, readingOrder,
      entry: (kind, id) => entries.find((el) =>
        el.getAttribute("data-pf-entry") === kind
        && el.getAttribute("data-pf-for") === id),
      docked: () => panelSlot.children.map((el) => el.getAttribute("data-pf-for")),
      dockedEdges: () => panelEdges.children.map((el) => el.getAttribute("data-pf-for")),
      node: (id) => nodes.find((n) => n.getAttribute("data-pf-node") === id),
      tool: (name) => tools[name],
      state: (kind, value) => (kind === "node" ? nodes : edges)
        .filter((el) => el.getAttribute("data-pf-state") === value)
        .map((el) => el.getAttribute(`data-pf-${kind}`)),
      current: () => entries
        .filter((el) => el.getAttribute("aria-current"))
        .map((el) => el.getAttribute("data-pf-for")),
      clickPick: (id) => clickTarget("data-pf-pick", id),
      clickAct: (name) => {
        const target = tools[name];
        target.closest = (selector) =>
          selector === "[data-pf-act]" ? target : null;
        fire("document", "click", { target });
      },
      clickPath: (id) => {
        const target = element({ "data-pf-act": "path", "data-pf-path": id });
        target.closest = (selector) =>
          selector === "[data-pf-act]" ? target : null;
        fire("document", "click", { target });
      },
      key: (name, { onDocument = false } = {}) => fire(
        onDocument ? "document" : "canvas", "keydown",
        { key: name, preventDefault() {} }),
      // The keyboard route into selection: a key pressed while a drawn
      // component holds focus, delivered where the browser would deliver it.
      pressNode: (id, name) => {
        const target = nodes.find((n) => n.getAttribute("data-pf-node") === id)
          ?? element({ "data-pf-node": id });
        if (!target.closest) target.closest = () => target;
        const event = {
          key: name, target, prevented: false,
          preventDefault() { this.prevented = true; },
        };
        fire("svg", "keydown", event);
        return event;
      },
      // The pointer route, for comparing the two against each other.
      clickNode: (id) => clickTarget("data-pf-node", id),
      /* A reader putting a hand on the map. Delivered where the browser
         delivers it, on the map itself, which is where an automatic move
         finds out it has been overruled. */
      press: () => fire("svg", "pointerdown", {
        button: 0, clientX: 0, clientY: 0, target: svg,
      }),
      /* A drag on the background: the press, then travel past the slop. The
         target answers for the map and for nothing else, which is what makes
         it a pan surface rather than a component. */
      drag: (dx, dy) => {
        const target = element({ "data-pf-graph": "" });
        target.closest = (selector) =>
          selector === "[data-pf-graph]" ? target : null;
        fire("svg", "pointerdown",
          { button: 0, clientX: 0, clientY: 0, target });
        fire("svg", "pointermove",
          { clientX: dx, clientY: dy, target, pointerId: 1 });
      },
    };
  }
});

/**
 * The semantic camera, proved over every component of the acceptance specimen.
 *
 * This is the ticket's guarantee and the one thing a browser walkthrough can
 * only sample: a person can judge four or five focuses in a sitting, and the
 * claim is about all twenty, at more than one window shape. So the shipped
 * camera source is evaluated here the way the traversal is — verbatim, the
 * same text the artifact runs — and driven over every node against the real
 * layout.
 *
 * **What is asserted is the observable outcome, not the arithmetic.** Each case
 * projects the camera's answer back through the coordinate chain the browser
 * will apply — the viewBox fit, its letterbox, then the camera transform — and
 * asks where the focused node actually lands. A test that re-derived the
 * camera's own reasoning would agree with it whatever it decided.
 */
describe("the semantic camera frames the focused component", () => {
  const model = interactionModel(INSTALLER.diagram);
  const BOXES = Object.fromEntries(
    LAYOUT.nodes.map((placed) => [placed.id, placed.box]));
  const CANVAS_BOX = { w: LAYOUT.width, h: LAYOUT.height };

  /* Map cells a reader really gets, each with the band the toolbar floats
     over. The first is the panel-open desktop case this ticket inherits: the
     panel is a grid sibling, so it has already taken its width out of the
     canvas by the time the camera reads the rectangle. The rest are the
     shapes that break a camera tuned on one window -- a tall one, a short
     one, and a narrow one where the controls wrap to three rows and take
     nearly half the map. */
  const FRAMES = [
    ["desktop, panel open", { w: 1060, h: 640 }, 72],
    ["desktop, panel closed", { w: 1440, h: 640 }, 72],
    ["tall window", { w: 1060, h: 900 }, 72],
    ["short window", { w: 1300, h: 420 }, 72],
    ["narrow, controls wrapped", { w: 700, h: 620 }, 220],
  ];

  /** Every id the focus mode calls related: the direct neighbours, both ways. */
  function neighbours(id) {
    const near = [];
    for (const [, target] of model.out[id]) {
      if (target !== id && !near.includes(target)) near.push(target);
    }
    for (const [, source] of model.in[id]) {
      if (source !== id && !near.includes(source)) near.push(source);
    }
    return near;
  }

  function aim(id, frame, free) {
    return pfCameraTarget({
      canvas: CANVAS_BOX, frame, free, boxes: BOXES,
      focus: id, near: neighbours(id),
    });
  }

  /**
   * Where a user-space box lands on screen once the camera is applied.
   *
   * The chain, spelled out rather than borrowed: the browser fits the viewBox
   * into the element at one uniform scale and centres it, and the camera's
   * transform applies on top of that from the top-left corner.
   */
  function projected(box, frame, target) {
    const s0 = Math.min(frame.w / CANVAS_BOX.w, frame.h / CANVAS_BOX.h);
    const ox = (frame.w - CANVAS_BOX.w * s0) / 2;
    const oy = (frame.h - CANVAS_BOX.h * s0) / 2;
    return {
      left: target.x + ox * target.scale + target.painted * box.x,
      right: target.x + ox * target.scale + target.painted * (box.x + box.w),
      top: target.y + oy * target.scale + target.painted * box.y,
      bottom: target.y + oy * target.scale + target.painted * (box.y + box.h),
    };
  }

  for (const [name, frame, band] of FRAMES) {
    const free = { x: 0, y: 0, width: frame.w, height: frame.h - band };

    describe(name, () => {
      it("renders every focused label at no less than its authored size", () => {
        /* The layout's user units are CSS pixels at the authored size -- a node
           box is 208x76 user units and its label is 13px in that same space --
           so one painted pixel per user unit *is* the authored size, with
           nothing measured to find out. */
        for (const id of model.nodes) {
          const target = aim(id, frame, free);
          assert.ok(target, `no camera answer for ${id}`);
          assert.ok(target.painted >= 1,
            `focusing ${id} paints ${target.painted.toFixed(3)} pixels per ` +
            `user unit, so its 13px label renders at ` +
            `${(13 * target.painted).toFixed(1)}px -- below the size it was ` +
            `authored at, which is the overview scale this Feature exists to ` +
            `escape`);
        }
      });

      it("leaves every focused component inside the rectangle the chrome left free", () => {
        for (const id of model.nodes) {
          const target = aim(id, frame, free);
          const at = projected(BOXES[id], frame, target);

          assert.ok(target.inside, `the camera reports ${id} outside the frame`);
          assert.ok(at.left >= free.x - 0.5 && at.right <= free.x + free.width + 0.5,
            `focusing ${id} puts it at ${at.left.toFixed(1)}..` +
            `${at.right.toFixed(1)}, outside the free rectangle's ` +
            `0..${free.width}`);
          assert.ok(at.top >= free.y - 0.5 && at.bottom <= free.y + free.height + 0.5,
            `focusing ${id} puts it at ${at.top.toFixed(1)}..` +
            `${at.bottom.toFixed(1)}; the free rectangle ends at ` +
            `${free.height}, so the component the camera just framed is under ` +
            `the chrome`);
        }
      });

      it("puts the focused component near the middle of the frame", () => {
        /* Dominance the camera can actually deliver. The scale is uniform, so
           the camera cannot make the focused component bigger than its
           neighbours -- what it can do is put it where the eye goes first.

           Two things legitimately outrank that, and both are checked rather
           than excused. A neighbourhood that fits whole is centred as a group,
           which is the composition that shows a component *in* its context.
           And a component at the edge of the canvas cannot be brought to the
           middle without sliding the map off its own bounds, so the clamp
           wins and the test proves the clamp really was the reason. */
        const half = { x: free.x + free.width / 2, y: free.y + free.height / 2 };

        for (const id of model.nodes) {
          const target = aim(id, frame, free);
          const at = projected(BOXES[id], frame, target);
          const dx = (at.left + at.right) / 2 - half.x;
          const dy = (at.top + at.bottom) / 2 - half.y;

          /* The whole neighbourhood on screen, observed rather than inferred:
             every neighbour's box entirely inside the free rectangle. */
          const framedWhole = neighbours(id).every((other) => {
            const box = projected(BOXES[other], frame, target);
            return box.left >= free.x - 0.5
              && box.right <= free.x + free.width + 0.5
              && box.top >= free.y - 0.5
              && box.bottom <= free.y + free.height + 0.5;
          });
          if (framedWhole) continue;

          /* Where the map's own edge has come into the frame on the side the
             camera would have had to travel toward. */
          const map = projected(
            { x: 0, y: 0, w: CANVAS_BOX.w, h: CANVAS_BOX.h }, frame, target);
          const heldX = dx < 0
            ? map.left >= free.x - 0.5
            : map.right <= free.x + free.width + 0.5;
          const heldY = dy < 0
            ? map.top >= free.y - 0.5
            : map.bottom <= free.y + free.height + 0.5;

          assert.ok(Math.abs(dx) <= free.width / 4 || heldX,
            `focusing ${id} leaves it ${Math.round(dx)}px off the horizontal ` +
            `centre of a ${free.width}px rectangle, and the map's own edge is ` +
            `not what stopped the camera -- so the reader's eye lands ` +
            `somewhere other than the component they selected`);
          assert.ok(Math.abs(dy) <= free.height / 4 || heldY,
            `focusing ${id} leaves it ${Math.round(dy)}px off the vertical ` +
            `centre of a ${free.height}px rectangle, with the map's own edge ` +
            `nowhere near the frame`);
        }
      });

      it("reports exactly the neighbours a reader cannot see", () => {
        for (const id of model.nodes) {
          const target = aim(id, frame, free);
          const near = neighbours(id);

          for (const other of target.offFrame) {
            assert.ok(near.includes(other),
              `${id}'s camera reported ${other} off-frame, but ${other} is ` +
              `not one of its direct neighbours -- the camera is deciding ` +
              `what is related instead of consuming it`);
          }

          /* And the other direction, which is the half that would rot quietly:
             a neighbour left out of the report has to genuinely be on screen. */
          for (const other of near) {
            if (target.offFrame.includes(other)) continue;
            const at = projected(BOXES[other], frame, target);
            assert.ok(
              at.right > free.x && at.left < free.x + free.width
              && at.bottom > free.y && at.top < free.y + free.height,
              `${id}'s camera did not report ${other} as off-frame, but no ` +
              `part of it is inside the free rectangle`);
          }
        }
      });
    });
  }

  it("frames the worst neighbourhoods on the specimen without giving up readability", () => {
    /* The four the Feature names, whose direct neighbours sit at opposite
       corners of the canvas. A plain bounding-box fit would frame each of them
       whole at around 0.39 to 0.48 painted pixels per unit -- the overview
       scale, with 5px labels. Readability wins and the remainder is reported. */
    const frame = { w: 1060, h: 640 };
    const free = { x: 0, y: 0, width: frame.w, height: frame.h - 72 };

    for (const id of ["copylist", "stage", "nevership", "registry"]) {
      const target = aim(id, frame, free);
      assert.ok(target.painted >= 1,
        `${id} fell back to a whole-neighbourhood fit at ` +
        `${target.painted.toFixed(3)}`);
      assert.ok(target.offFrame.length > 0,
        `${id}'s neighbourhood spans nearly the whole canvas, so something ` +
        `has to be outside a readable frame; the camera reported nothing, ` +
        `which would leave a reader believing they can see all of it`);
      assert.ok(target.inside, `${id} is not inside the free rectangle`);
    }
  });

  it("frames the neighbourhood whole when it fits, without magnifying it", () => {
    const frame = { w: 1060, h: 640 };
    const free = { x: 0, y: 0, width: frame.w, height: frame.h - 72 };

    /* One relationship, and both boxes comfortably inside one screen. The
       camera should frame both and stop climbing: a component with a small
       neighbourhood magnified to fill the map is not reading a diagram.

       `theme` is the only component of the specimen whose neighbourhood fits
       at a readable scale in every frame these tests use, which is itself the
       measurement behind the aim rule below: on this map, framing the whole
       neighbourhood is the rare case and not the common one. */
    const target = aim("theme", frame, free);
    assert.deepEqual(target.offFrame, [],
      "a neighbourhood that fits was reported as partly off-frame");
    assert.ok(target.painted <= 1.5 + 1e-9,
      `framed at ${target.painted.toFixed(3)} pixels per unit, above the ` +
      `comfort ceiling -- the camera is magnifying rather than framing`);
  });

  it("consumes the published rectangle rather than centring on the viewport", () => {
    /* The inherited contract from 52.3, and the one an implementation can most
       easily fake: framing into the middle of the map looks correct until a
       panel takes 380 pixels of it, and then the camera parks the component it
       just framed underneath the panel.

       Two rectangles inside one identical frame. If the camera were centring
       on the viewport, both answers would be the same. */
    const frame = { w: 1440, h: 640 };
    const whole = { x: 0, y: 0, width: 1440, height: 568 };
    const beside = { x: 0, y: 0, width: 1060, height: 568 };

    const open = aim("cli", frame, beside);
    const closed = aim("cli", frame, whole);

    assert.notDeepEqual(
      { x: open.x, y: open.y }, { x: closed.x, y: closed.y },
      "the camera answered identically for a 1440-wide and a 1060-wide free " +
      "rectangle, so it is framing into the viewport and not into what the " +
      "panel left free");

    const at = projected(BOXES.cli, frame, open);
    assert.ok(at.right <= beside.width + 0.5,
      `with the panel open the focused component reaches ${at.right.toFixed(1)}, ` +
      `past the ${beside.width} the panel left free -- it is under the panel`);
  });

  it("never counts a component as a neighbour of itself", () => {
    /* A self-edge makes a component its own neighbour in the adjacency index.
       Reported off-frame it would tell a reader that the thing filling the
       middle of their screen is somewhere they cannot see. */
    const frame = { w: 1060, h: 640 };
    const free = { x: 0, y: 0, width: frame.w, height: frame.h - 72 };
    const target = pfCameraTarget({
      canvas: CANVAS_BOX, frame, free, boxes: BOXES,
      focus: "cli", near: ["cli"],
    });

    assert.deepEqual(target.offFrame, [],
      "the focused component was reported as outside its own frame");
  });

  it("refuses to aim at a component it has no box for", () => {
    const frame = { w: 1060, h: 640 };
    const free = { x: 0, y: 0, width: frame.w, height: frame.h - 72 };

    assert.equal(
      pfCameraTarget({
        canvas: CANVAS_BOX, frame, free, boxes: BOXES,
        focus: "no-such-node", near: [],
      }),
      null,
      "the camera invented a target for a component that is not drawn");
  });

  it("measures nothing but the window", () => {
    /* The Feature's rule, as a property of the module rather than a promise in
       a comment: the only runtime numbers the camera is given are the frame
       and the free rectangle. Everything else it reads is build-time integer
       geometry. A camera that had reached for a rendered box would need an API
       that is not in this source. */
    for (const forbidden of [
      "getBBox", "getBoundingClientRect", "getComputedStyle", "offsetWidth",
      "clientWidth", "measureText", "document", "window",
    ]) {
      assert.ok(!CAMERA_JS.includes(forbidden),
        `the camera source reaches for ${forbidden}, so it is reading the ` +
        `picture rather than the graph`);
    }
  });
});

describe("the delivered artifact carries its content before any script runs", () => {
  const STYLE = /<style\b[^>]*>[\s\S]*?<\/style>/g;
  const SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script>/g;

  for (const name of DIAGRAM_SPECIMENS) {
    describe(name, () => {
      const delivery = deliverInSubprocess({ spec: SPECS[name] });
      const spec = JSON.parse(readFileSync(SPECS[name], "utf8"));
      /** The document with the stylesheet and every script removed. */
      const noScript = delivery.html.replace(STYLE, "").replace(SCRIPT, "");

      it("delivers", () => {
        assert.equal(delivery.status, 0,
          `${JSON.stringify(delivery.receipt, null, 2)}\n${delivery.stderr}`);
      });

      it("removing the script leaves the document, not an empty page", () => {
        assert.ok(noScript.length > 2000,
          `only ${noScript.length} characters survived; the patterns are eating ` +
          `the document and the assertions below would pass on nothing`);
        assert.ok(!noScript.includes("<script"), "a script survived removal");
      });

      it("keeps every node's label and role", () => {
        for (const node of spec.diagram.nodes) {
          assert.ok(noScript.includes(escapeHtml(node.label)),
            `node ${node.id}'s label is only present once scripting runs`);
        }
      });

      it("keeps every edge's label", () => {
        for (const edge of spec.diagram.edges) {
          if (!edge.label) continue;
          assert.ok(noScript.includes(escapeHtml(edge.label)),
            `edge ${edge.id}'s label is only present once scripting runs`);
        }
      });

      it("keeps every group's label and summary", () => {
        for (const group of spec.diagram.groups ?? []) {
          assert.ok(noScript.includes(escapeHtml(group.label)),
            `group ${group.id}'s label is only present once scripting runs`);
          if (group.summary) {
            assert.ok(noScript.includes(escapeHtml(group.summary)),
              `group ${group.id}'s summary is only present once scripting runs`);
          }
        }
      });

      it("keeps every summary, detail, note and citation", () => {
        const claims = [];
        for (const node of spec.diagram.nodes) {
          if (node.summary) claims.push([`node ${node.id} summary`, node.summary]);
          for (const paragraph of node.detail ?? []) {
            claims.push([`node ${node.id} detail`, paragraph]);
          }
        }
        for (const path of spec.diagram.paths ?? []) {
          if (path.note) claims.push([`path ${path.id} note`, path.note]);
        }
        for (const view of spec.diagram.views ?? []) {
          if (view.note) claims.push([`view ${view.id} note`, view.note]);
        }
        for (const holder of [
          ...spec.diagram.nodes, ...spec.diagram.edges,
          ...(spec.diagram.groups ?? []), ...(spec.diagram.paths ?? []),
          ...(spec.diagram.views ?? []),
        ]) {
          for (const citation of holder.evidence ?? []) {
            claims.push([`citation in ${holder.id}`, citation.path]);
          }
        }

        const missing = claims
          .filter(([, text]) => !noScript.includes(escapeHtml(text)))
          .map(([what]) => what);
        assert.deepEqual(missing, [],
          "semantic or evidence content exists only behind a script");
      });

      it("offers no control that cannot work without scripting", () => {
        // Every interactive control sits inside a container that ships
        // `hidden` and is revealed by the script — the same bargain the
        // shell's theme toggle strikes. A reader with scripting off meets no
        // dead buttons, and loses nothing they could have read.
        // Matched on the whole tag rather than on `hidden` following
        // `data-pf-controls` directly: attribute order is not a promise the
        // renderer makes, and a test that reads it as one reports a hidden
        // group as exposed the first time another attribute lands between the
        // two. What is being asserted is that the element is hidden.
        const groups = [...noScript.matchAll(/<[a-z]+\b[^>]*\bdata-pf-controls\b[^>]*>/g)];
        assert.ok(groups.length > 0, "no control group in the document at all");

        const exposed = groups.filter(([tag]) => !/\shidden(\s|>|=)/.test(tag));
        assert.equal(exposed.length, 0,
          `${exposed.length} control group(s) ship visible without scripting`);

        // One for the toolbar, one per node card, one per path section.
        const expected = 1 + spec.diagram.nodes.length
          + (spec.diagram.paths ?? []).length;
        assert.equal(groups.length, expected,
          `expected ${expected} control groups, found ${groups.length}`);
      });

      it("keeps the verification wording 51.3 settled, untouched", () => {
        // Interaction must not upgrade, weaken or reinterpret provenance. The
        // surest way to keep that true is that nothing in the interaction path
        // writes provenance text at all — so the footer reads exactly as 51.3
        // settled it, for each of the three states.
        const footer = delivery.html.slice(
          delivery.html.indexOf('<footer class="pf-provenance">'),
          delivery.html.indexOf("</footer>"));

        if (spec.provenance === "derived") {
          assert.match(footer, /checked deterministically against the commit named here/);
          assert.match(footer, /not a finding that the\s+architecture drawn here is correct/);
        } else if (!spec.source) {
          assert.match(footer, /describes an intended system/);
          assert.doesNotMatch(footer, /verified against the commit/);
        } else if (hasCitation(spec)) {
          assert.match(footer, /describes a proposed design/);
          assert.match(footer, /do not\s+establish that the system drawn here exists/);
        } else {
          assert.doesNotMatch(footer, /pf-caveat/,
            "a diagram that cited nothing claimed its citations were checked");
        }
      });

      it("adds no verification claim of its own", () => {
        const script = delivery.html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
        for (const phrase of [
          "verified", "checked deterministically", "provenance", "evidence was",
        ]) {
          assert.ok(!script.includes(phrase),
            `the interaction script mentions "${phrase}"; trust wording is the ` +
            `shell's and must not be restated where a reader could see it change`);
        }
      });
    });
  }

  function hasCitation(spec) {
    return [
      ...spec.diagram.nodes, ...spec.diagram.edges,
      ...(spec.diagram.groups ?? []), ...(spec.diagram.paths ?? []),
      ...(spec.diagram.views ?? []),
    ].some((holder) => (holder.evidence ?? []).length > 0);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
});

describe("the diagram's behaviour is the diagram's alone", () => {
  const diagram = deliverInSubprocess({ spec: SPECS.installer });
  const lesson = deliverInSubprocess({ spec: SPECS.example });

  it("a lesson carries the shared behaviour and nothing else", () => {
    // The point of the per-kind slot. Appending traversal code to the shared
    // script would put it in every lesson, which is the mistake the shared
    // stylesheet already avoids for the same reason.
    const script = lesson.html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
    assert.equal(script, BEHAVIOR_JS,
      "a lesson's script is no longer exactly the shared behaviour");
    assert.ok(!lesson.html.includes("pfTraverse"),
      "traversal code reached a lesson, which has no graph to traverse");
    assert.ok(!lesson.html.includes("data-pf-node"));
  });

  it("a diagram carries the shared behaviour and then its own", () => {
    const script = diagram.html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
    assert.ok(script.startsWith(BEHAVIOR_JS),
      "the diagram replaced the shared behaviour instead of extending it");
    assert.ok(script.includes("pfTraverse"));
  });

  it("still carries exactly one script and one stylesheet", () => {
    for (const [name, delivery] of [["diagram", diagram], ["lesson", lesson]]) {
      assert.equal((delivery.html.match(/<script\b/g) ?? []).length, 1,
        `the ${name} artifact carries more than one script`);
      assert.equal((delivery.html.match(/<style\b/g) ?? []).length, 1,
        `the ${name} artifact carries more than one stylesheet`);
    }
  });

  it("reuses the shell's theme toggle rather than adding a second", () => {
    assert.equal((diagram.html.match(/id="pf-theme-toggle"/g) ?? []).length, 1);
    const own = diagram.html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1]
      .slice(BEHAVIOR_JS.length);
    assert.ok(!own.includes("pf-theme-toggle"),
      "the diagram reimplemented the theme control the shell already owns");
    assert.ok(!own.includes("data-pf-theme"),
      "the diagram writes the theme attribute the shell owns");
  });
});

describe("interaction adds no producer control over presentation", () => {
  const REFUSED = [
    "focus", "focused", "highlight", "dim", "opacity", "zoom", "viewport",
    "transition", "duration", "easing", "animation", "traversal", "reachable",
    "upstream", "downstream", "adjacency", "interactive", "collapsed",
  ];

  for (const field of REFUSED) {
    it(`refuses \`${field}\` on a node`, () => {
      const spec = structuredClone(EXAMPLE);
      spec.diagram.nodes[0][field] = "whatever a producer hoped it would do";

      const delivery = deliverSpec(spec);
      assert.equal(delivery.status, 1, `\`${field}\` was accepted`);
      const codes = (delivery.receipt.diagnostics ?? []).map((d) => d.code);
      assert.ok(codes.some((code) =>
        code === "unknown_field" || code === "presentation_control"),
      `\`${field}\` produced ${codes.join(", ")}`);
    });
  }

  it("refuses a producer-supplied traversal or adjacency on the diagram", () => {
    for (const field of ["adjacency", "traversal", "reachable", "interactions"]) {
      const spec = structuredClone(EXAMPLE);
      spec.diagram[field] = { anything: true };
      assert.equal(deliverSpec(spec).status, 1,
        `\`${field}\` was accepted on the diagram; traversal is derived, never authored`);
    }
  });
});

/** Deliver a specification built in memory, and report what the engine said. */
function deliverSpec(spec) {
  const directory = temporaryDirectory("interaction-");
  const specPath = join(directory, "spec.json");
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  return deliverInSubprocess({ spec: specPath, repo: REPO_ROOT, outDirectory: directory });
}
