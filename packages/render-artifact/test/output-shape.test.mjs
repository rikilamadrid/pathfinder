/**
 * Properties of the bytes themselves, checked as bytes.
 *
 * Delivery already refuses a carriage return and a byte-order mark, which is
 * why these tests read the committed file rather than trusting the refusal:
 * a guard that is never exercised against a real artifact is a guard nobody
 * has seen work.
 *
 * The ordering tests are here for the same reason. "Every ordering the
 * renderer chooses is derived from the specification" is checkable, and the
 * cheapest way to check it is to reverse the question: read the order out of
 * the artifact and compare it with the order in the specification.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";

import { SPECS, cleanUpTemporaryDirectories, deliverInSubprocess } from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

for (const name of Object.keys(SPECS)) {
  describe(`output shape — ${name}`, () => {
    const delivery = deliverInSubprocess({ spec: SPECS[name] });
    const spec = JSON.parse(readFileSync(SPECS[name], "utf8"));

    it("delivered", () => {
      assert.equal(delivery.status, 0,
        `${JSON.stringify(delivery.receipt, null, 2)}\n${delivery.stderr}`);
    });

    it("is UTF-8 that round-trips", () => {
      // Decoding and re-encoding is lossless exactly when the bytes were valid
      // UTF-8 to begin with: an invalid sequence decodes to U+FFFD and comes
      // back as three different bytes.
      assert.ok(
        Buffer.from(delivery.bytes.toString("utf8"), "utf8").equals(delivery.bytes),
        "the artifact is not valid UTF-8");
      assert.ok(!delivery.html.includes("�"),
        "a replacement character means something was decoded with the wrong encoding");
    });

    it("has no byte-order mark", () => {
      const [a, b, c] = delivery.bytes;
      assert.ok(!(a === 0xEF && b === 0xBB && c === 0xBF),
        "the artifact begins with a UTF-8 byte-order mark");
      assert.notEqual(delivery.html.charCodeAt(0), 0xFEFF);
    });

    it("uses LF newlines only", () => {
      const carriageReturns = delivery.bytes.filter((byte) => byte === 0x0D).length;
      assert.equal(carriageReturns, 0,
        `${carriageReturns} carriage return(s) in the artifact; artifacts use ` +
        `\\n only, on every platform`);
    });

    it("declares UTF-8 and the specification's locale", () => {
      assert.match(delivery.html, /<meta charset="utf-8">/i);
      if (spec.artifact.locale) {
        assert.match(delivery.html, new RegExp(`<html[^>]*lang="${spec.artifact.locale}"`),
          "the document language comes from the specification, not the machine");
      }
    });

    it("emits modules in specification order", () => {
      const declared = spec.lesson.modules.map((module) => module.id);

      // Two orderings, both derived from the same list: the navigation and the
      // sections themselves. Located by the exact id the renderer derives from
      // the producer's own identifier, so a renderer that generated ids from a
      // counter or a hash would not be found here at all.
      assertAppearInOrder(delivery.html, declared.map((id) => `data-pf-nav="m--${id}"`),
        "navigation");
      assertAppearInOrder(delivery.html, declared.map((id) => `id="m--${id}"`),
        "module sections");
    });

    it("emits quiz questions in specification order", () => {
      const declared = spec.lesson.modules
        .flatMap((module) => module.sections)
        .filter((section) => section.type === "quiz")
        .flatMap((section) => section.questions.map((question) => question.id));

      if (declared.length === 0) return;

      assertAppearInOrder(delivery.html, declared.map((id) => `--${id}--0"`), "quiz questions");
    });

    it("emits objectives in specification order", () => {
      const declared = spec.lesson.objectives ?? [];
      if (declared.length === 0) return;

      assertAppearInOrder(delivery.html, declared.map(escapeForHtml), "objectives");
    });

    it("opens from the filesystem with nothing fetched", () => {
      // Self-contained is part of the deliverable: an artifact that reached
      // the network would render differently depending on what answered.
      assert.doesNotMatch(delivery.html, /<script[^>]+src=/i,
        "an external script makes the artifact depend on something it does not carry");
      assert.doesNotMatch(delivery.html, /<link[^>]+rel="stylesheet"/i,
        "an external stylesheet makes the artifact depend on something it does not carry");
      assert.doesNotMatch(delivery.html, /https?:\/\/(?!www\.w3\.org)/i,
        "an absolute URL in the artifact is a fetch waiting to happen");
    });
  });
}

/**
 * Assert that each needle is in the haystack, and that they are in this order.
 *
 * Ordering is checked by position rather than by re-parsing the artifact,
 * because the claim is about what a reader meets first, not about the shape of
 * the markup around it.
 */
function assertAppearInOrder(haystack, needles, what) {
  const positions = needles.map((needle) => ({ needle, at: haystack.indexOf(needle) }));

  for (const position of positions) {
    assert.notEqual(position.at, -1,
      `${what}: \`${position.needle}\` is not in the artifact at all`);
  }

  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i].at > positions[i - 1].at,
      `${what} appear in an order the specification did not choose: ` +
      `\`${positions[i].needle}\` precedes \`${positions[i - 1].needle}\``);
  }
}

/** The subset of escaping the renderer applies to prose, for locating text. */
function escapeForHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
