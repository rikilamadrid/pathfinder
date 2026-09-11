/**
 * The goldens: what this renderer, at this version, produces from these bytes.
 *
 * Both halves are committed on purpose. The digest is the invariant's own
 * currency — the thing a cross-environment comparison compares — and a digest
 * alone tells a reader that output moved without telling them how. The full
 * HTML makes the diff readable, so an intentional change is reviewed as a
 * change to a page rather than as a hex string that used to be different.
 *
 * When one of these fails, exactly one question matters: was the output change
 * intended? If it was, `npm run goldens` and a `RENDERER_VERSION` bump belong
 * in the same commit. If it was not, the renderer just became nondeterministic
 * or the specification changed underneath it.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";

import {
  SPECS, cleanUpTemporaryDirectories, deliverInSubprocess, goldenPaths, sha256,
} from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

const REMEDY =
  "If this output change was intended, bump RENDERER_VERSION in " +
  "skills/render-artifact/engine/version.mjs and run `npm run goldens` in " +
  "the same commit. If it was not, rendering is no longer a pure function of " +
  "the specification and the renderer.";

for (const name of Object.keys(SPECS)) {
  describe(`golden — ${name}`, () => {
    const golden = goldenPaths(name);
    const expectedBytes = readFileSync(golden.html);
    const expectedDigest = readFileSync(golden.digest, "utf8").trim();

    it("the committed digest describes the committed HTML", () => {
      // Without this, a regeneration that wrote one file and not the other
      // would leave two goldens disagreeing and both tests below passing
      // against whichever one they happened to read.
      assert.equal(sha256(expectedBytes), expectedDigest,
        `golden/${name}.sha256 does not describe golden/${name}.html`);
    });

    it("delivering the specification reproduces the golden bytes", () => {
      const delivery = deliverInSubprocess({ spec: SPECS[name] });

      assert.equal(delivery.status, 0,
        `delivery failed: ${JSON.stringify(delivery.receipt, null, 2)}`);

      if (!delivery.bytes.equals(expectedBytes)) {
        assert.equal(delivery.html, expectedBytes.toString("utf8"), REMEDY);
        assert.fail(`delivered bytes differ from golden/${name}.html. ${REMEDY}`);
      }
    });

    it("the receipt reports the golden digest and byte count", () => {
      const delivery = deliverInSubprocess({ spec: SPECS[name] });

      assert.equal(delivery.receipt.artifact.sha256, expectedDigest, REMEDY);
      assert.equal(delivery.receipt.artifact.bytes, expectedBytes.byteLength, REMEDY);
    });

    it("the receipt's specification digest describes the specification on disk", () => {
      const delivery = deliverInSubprocess({ spec: SPECS[name] });

      assert.equal(delivery.receipt.specification.sha256, sha256(readFileSync(SPECS[name])),
        "the receipt describes a specification other than the one delivered");
    });
  });
}
