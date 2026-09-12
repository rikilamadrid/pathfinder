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
import { BEHAVIOR_JS } from "../../../skills/render-artifact/engine/render/behavior.mjs";
import {
  DIAGRAM_SPECIMENS, REPO_ROOT, SPECS, cleanUpTemporaryDirectories,
  deliverInSubprocess, temporaryDirectory,
} from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

/** The shipped traversal, as the artifact will run it. */
const pfTraverse = new Function(`${TRAVERSAL_JS}\nreturn pfTraverse;`)();

const INSTALLER = JSON.parse(readFileSync(SPECS.installer, "utf8"));
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
        const groups = [...noScript.matchAll(/data-pf-controls(\s+hidden)?/g)];
        assert.ok(groups.length > 0, "no control group in the document at all");

        const exposed = groups.filter(([, isHidden]) => !isHidden);
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
