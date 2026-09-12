/**
 * The diagram's own colours, measured rather than eyeballed.
 *
 * `theme.mjs` records measured ratios for the lesson's surfaces and explains
 * why `--pf-accent` may take a rule or a fill but never a word: at 3.47:1 on
 * the light page it clears the boundary bar and misses the text one. Diagrams
 * introduced surfaces that note does not cover — node strokes, edge lines,
 * captions on a boundary fill — and inheriting the tokens is not the same as
 * clearing the bar on new things built from them. So they are measured here.
 *
 * The ratios are computed from the tokens the renderer actually ships, so a
 * palette change cannot leave a stale pass behind.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { BAR, measure } from "../lib/contrast.mjs";
import { SPECS, cleanUpTemporaryDirectories, deliverInSubprocess } from "../lib/harness.mjs";
import { after } from "node:test";
import { readFileSync } from "node:fs";

after(cleanUpTemporaryDirectories);

for (const theme of ["light", "dark"]) {
  describe(`diagram contrast — ${theme}`, () => {
    const measured = measure(theme);

    it("every text surface meets WCAG 2.1 AA", () => {
      const failing = measured
        .filter((m) => m.kind === "text" && m.ratio < BAR.text)
        .map((m) => `${m.what}: ${m.ratio}:1 (needs ${BAR.text})`);
      assert.deepEqual(failing, []);
    });

    it("every boundary and graphical surface meets WCAG 2.1 AA", () => {
      const failing = measured
        .filter((m) => m.kind === "non-text" && m.ratio < BAR["non-text"])
        .map((m) => `${m.what}: ${m.ratio}:1 (needs ${BAR["non-text"]})`);
      assert.deepEqual(failing, []);
    });

    it("the accent never carries a word", () => {
      // The rule `theme.mjs` states, checked against the diagram's own usage:
      // words in accent colour take `--pf-link`, which is the same hue darkened
      // until it passes the text bar.
      const words = measured.filter((m) => m.kind === "text");
      assert.ok(!words.some((m) => m.fg === "--pf-accent"),
        "a diagram text surface is painted with the accent");
    });

    it("records the decorative fills without holding them to a bar", () => {
      const decorative = measured.filter((m) => m.kind === "decorative");
      assert.ok(decorative.length > 0);
      for (const m of decorative) {
        assert.ok(Number.isFinite(m.ratio), `${m.what} was not measured`);
      }
    });
  });
}

describe("role survives without colour", () => {
  const spec = JSON.parse(readFileSync(SPECS.multilingual, "utf8"));
  const delivery = deliverInSubprocess({ spec: SPECS.multilingual });

  it("every node prints its role as a word", () => {
    // The claim is not that the palette is redundant, it is that the palette is
    // never the only carrier. A reader in greyscale, with a colour-vision
    // difference, or holding a printout reads the role off the node itself.
    const missing = [];
    for (const node of spec.diagram.nodes) {
      const at = delivery.html.indexOf(`id="n--${node.id}"`);
      const group = delivery.html.slice(at, at + 700);
      if (!group.includes(`class="pf-node-role"`) || !group.includes(`>${node.role}<`)) {
        missing.push(node.id);
      }
    }
    assert.deepEqual(missing, []);
  });

  it("each role is also carried by the shape of the box", () => {
    // Corner radius is the second non-colour channel. Roles sharing a radius
    // are still separated by the printed word above, so this asserts the
    // channel exists and varies rather than that it is injective.
    const radii = new Set();
    for (const node of spec.diagram.nodes) {
      const at = delivery.html.indexOf(`id="n--${node.id}"`);
      const [, rx] = delivery.html.slice(at, at + 300).match(/rx="(\d+)"/) ?? [];
      assert.ok(rx !== undefined, `${node.id} has no corner radius`);
      radii.add(rx);
    }
    assert.ok(radii.size >= 3,
      `only ${radii.size} distinct shapes across ${spec.diagram.nodes.length} nodes`);
  });

  it("the role word is the renderer's, not the producer's", () => {
    // A producer cannot rename a role, so the word cannot be made to lie.
    assert.ok(!delivery.html.includes('data-pf-role=""'));
    for (const node of spec.diagram.nodes) {
      assert.ok(delivery.html.includes(`data-pf-role="${node.role}"`));
    }
  });
});
