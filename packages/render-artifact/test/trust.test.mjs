/**
 * The two invariants 50.1 landed that an artifact's truthfulness rests on.
 *
 * Both are regression tests for behaviour that already ships. Neither is new
 * product behaviour, and that is exactly why they are worth committing: they
 * are the kind of guarantee that is easy to remove by accident, months later,
 * while making something else work — a convenience parameter here, a
 * re-export there — and impossible to notice from the outside once it is gone.
 *
 * **Receipt integrity.** A receipt describes the specification that was
 * rendered, or it describes nothing. Delivery takes bytes and only bytes, and
 * copies them before it parses them, so there is no window in which a caller
 * can leave the receipt pointing at one specification and the artifact at
 * another.
 *
 * **Verification gating.** An artifact says its evidence was checked only when
 * this engine checked it. The claim is gated on an attestation that can be
 * minted from nothing but a passing validation result this engine produced.
 */

import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { deliver, renderOnly, sha256 as engineSha256 }
  from "../../../skills/render-artifact/engine/deliver.mjs";
import { render } from "../../../skills/render-artifact/engine/render/index.mjs";
import { validateSpecification }
  from "../../../skills/render-artifact/engine/validate/index.mjs";
import * as validateIndex
  from "../../../skills/render-artifact/engine/validate/index.mjs";
import { attest, isAttestation }
  from "../../../skills/render-artifact/engine/verification.mjs";
import { RENDERER_VERSION }
  from "../../../skills/render-artifact/engine/version.mjs";
import {
  REPO_ROOT, SPECS, cleanUpTemporaryDirectories, goldenPaths, sha256, temporaryDirectory,
} from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

const FIXTURE_BYTES = readFileSync(SPECS.fixture);
const FIXTURE = JSON.parse(FIXTURE_BYTES.toString("utf8"));
const GOLDEN_FIXTURE_DIGEST = readFileSync(goldenPaths("fixture").digest, "utf8").trim();

/** The sentence the artifact carries only when its evidence really was checked. */
const CLAIM = "was verified against the commit named here";

describe("receipt integrity — the receipt describes what was rendered", () => {
  it("takes the specification as bytes and offers no second way in", () => {
    // `(specBytes, specPath, outPath, options)`. A fifth parameter through
    // which a caller could hand in a parsed object alongside unrelated bytes
    // is the thing this guarantee is the absence of. The absent parameter is
    // the mechanism; a check inside would only be a second thing to get wrong.
    assert.equal(deliver.length, 4,
      "deliver's signature grew a parameter. If it is a way to supply the " +
      "specification other than as the bytes that get digested, the receipt " +
      "can now describe a specification that was never rendered.");
  });

  it("digests the bytes it was handed, not the file on disk", () => {
    const out = join(temporaryDirectory(), "artifact.html");
    const result = deliver(FIXTURE_BYTES, SPECS.fixture, out, { repoDir: REPO_ROOT });

    assert.ok(result.ok, JSON.stringify(result.diagnostics, null, 2));
    assert.equal(result.receipt.specification.sha256, sha256(FIXTURE_BYTES));
    assert.equal(result.receipt.specification.bytes, FIXTURE_BYTES.byteLength);
    assert.equal(result.receipt.artifact.sha256, sha256(readFileSync(out)));
    assert.equal(result.receipt.artifact.bytes, readFileSync(out).byteLength);
    assert.equal(result.receipt.renderer_version, RENDERER_VERSION);
  });

  it("describes the bytes it was handed, not the file at the path it was told", () => {
    // `specPath` is a label for the receipt and nothing more. If delivery ever
    // re-read it, the receipt could describe one specification while the
    // artifact was rendered from another, and nothing downstream could tell.
    // Handing it a path that holds something else is the only way to see that
    // from outside.
    const decoyPath = join(temporaryDirectory(), "decoy.json");
    const decoy = structuredClone(FIXTURE);
    decoy.artifact.title = "A specification that was never rendered";
    writeFileSync(decoyPath, JSON.stringify(decoy, null, 2), "utf8");

    const out = join(temporaryDirectory(), "artifact.html");
    const result = deliver(FIXTURE_BYTES, decoyPath, out, { repoDir: REPO_ROOT });
    assert.ok(result.ok, JSON.stringify(result.diagnostics, null, 2));

    assert.equal(result.receipt.specification.sha256, sha256(FIXTURE_BYTES),
      "the receipt describes the file at specPath rather than the bytes rendered");
    assert.notEqual(result.receipt.specification.sha256, sha256(readFileSync(decoyPath)));

    const html = readFileSync(out, "utf8");
    assert.ok(html.includes("A specification that cites nothing"),
      "the artifact was rendered from something other than the bytes handed in");
    assert.ok(!html.includes(decoy.artifact.title));
    assert.equal(result.receipt.artifact.sha256, GOLDEN_FIXTURE_DIGEST,
      "the handed bytes are the fixture, so the artifact is the fixture's golden");
  });

  it("exports its own digest function, and it is SHA-256", () => {
    assert.equal(engineSha256(FIXTURE_BYTES), sha256(FIXTURE_BYTES),
      "the engine's digest and the test's disagree, so one of them is not SHA-256");
  });

  it("leaves the previous artifact untouched when delivery fails", () => {
    const out = join(temporaryDirectory(), "artifact.html");

    const first = deliver(FIXTURE_BYTES, SPECS.fixture, out, { repoDir: REPO_ROOT });
    assert.ok(first.ok);
    const delivered = readFileSync(out);

    const broken = Buffer.from(JSON.stringify({ ...FIXTURE, kind: "diagram" }), "utf8");
    const second = deliver(broken, SPECS.fixture, out, { repoDir: REPO_ROOT });

    assert.equal(second.ok, false, "an unsupported kind was delivered rather than refused");
    assert.ok(readFileSync(out).equals(delivered),
      "a failed delivery overwrote the artifact that was already there");
  });

  it("writes nothing at all when the first delivery fails", () => {
    const out = join(temporaryDirectory(), "artifact.html");
    const broken = Buffer.from("{ not json", "utf8");

    const result = deliver(broken, SPECS.fixture, out, { repoDir: REPO_ROOT });

    assert.equal(result.ok, false);
    assert.equal(existsSync(out), false,
      "a failed delivery left a file behind, so a reader can meet a half-made artifact");
  });

  it("stages beside the destination and leaves no temporary file", () => {
    const directory = temporaryDirectory();
    const out = join(directory, "artifact.html");

    assert.ok(deliver(FIXTURE_BYTES, SPECS.fixture, out, { repoDir: REPO_ROOT }).ok);

    const leftovers = readdirSyncSorted(directory).filter((name) => name !== "artifact.html");
    assert.deepEqual(leftovers, [],
      "delivery left a staging file behind; the rename is supposed to consume it");
  });
});

describe("verification gating — a claim can only be earned", () => {
  const passing = () => validateSpecification(FIXTURE, { repoDir: REPO_ROOT });

  it("mints an attestation from a validation this engine performed", () => {
    const result = passing();
    assert.ok(result.ok, JSON.stringify(result.diagnostics, null, 2));

    const attestation = attest(result);
    assert.ok(isAttestation(attestation));
    assert.deepEqual([...attestation.layers], ["structural", "composition", "evidence"]);
  });

  it("refuses a hand-built result that merely says it passed", () => {
    assert.throws(() => attest({ ok: true, ran: ["structural", "composition", "evidence"] }),
      /can only be minted from a validation this engine performed/);
  });

  it("refuses nothing, and refuses an attestation-shaped object", () => {
    assert.throws(() => attest(null), /can only be minted/);
    assert.throws(() => attest(undefined), /can only be minted/);
    assert.throws(() => attest({ layers: ["structural", "composition", "evidence"] }),
      /can only be minted/);
  });

  it("refuses a validation that failed", () => {
    // A concept that cites nothing. Structurally legal, and rejected by the
    // evidence layer — so this fails without needing a commit to resolve,
    // which keeps the test saying the same thing on every machine.
    const uncited = structuredClone(FIXTURE);
    uncited.lesson.modules[0].sections.push({
      type: "concept",
      id: "uncited-claim",
      title: "A claim with nothing behind it",
      body: ["This asserts something about a source and cites none of it."],
      evidence: [],
    });

    const failed = validateSpecification(uncited, { repoDir: REPO_ROOT });

    assert.equal(failed.ok, false,
      "a concept without evidence is supposed to be an error, not a warning");
    assert.equal(failed.diagnostics[0].code, "concept_without_evidence");
    assert.throws(() => attest(failed), /can only be minted/,
      "a failing validation minted an attestation, so an artifact could claim " +
      "its evidence was checked when the check is what said no");
  });

  it("does not reach the brand through the global symbol registry", () => {
    const result = passing();
    const forged = { ok: true, ran: [...result.ran] };
    forged[Symbol.for("pathfinder.render-artifact.validated")] = true;

    assert.throws(() => attest(forged), /can only be minted/,
      "the brand is a module-private symbol, not one reachable through Symbol.for");
  });

  it("keeps the brand out of JSON, receipts, and logs", () => {
    const result = passing();

    assert.ok(!JSON.stringify(result).includes("validated"),
      "the brand is enumerable and is reaching serialized output");
    assert.deepEqual(Object.keys(result), ["ok", "diagnostics", "ran", "skipped"]);
  });

  it("renders no claim without an attestation", () => {
    const html = render(FIXTURE);

    assert.ok(!html.includes(CLAIM),
      "an artifact rendered without an attestation asserted that its evidence " +
      "was checked, which is the forgery this gate exists to prevent");
    assert.ok(!html.toLowerCase().includes("unverified"),
      "saying \"unverified\" would still be the renderer making a claim about " +
      "work it did not do; the absence of the sentence is the signal");
  });

  it("renders the claim against a real attestation, and only then", () => {
    const withClaim = render(FIXTURE, attest(passing()));
    assert.ok(withClaim.includes(CLAIM),
      "delivery validated and the artifact still made no verification claim");

    // Same specification, same renderer, one difference: whether validation
    // happened. If these were equal the attestation would be decorative.
    assert.notEqual(withClaim, render(FIXTURE));
  });

  it("gives `renderOnly` no route to a claim", () => {
    // `doctor` and anyone comparing two renders go through here. Neither
    // validates, so neither may produce a page that says otherwise.
    assert.ok(!renderOnly(FIXTURE).html.includes(CLAIM));
  });

  it("delivers an artifact that does carry the claim", () => {
    const out = join(temporaryDirectory(), "artifact.html");
    assert.ok(deliver(FIXTURE_BYTES, SPECS.fixture, out, { repoDir: REPO_ROOT }).ok);

    assert.ok(readFileSync(out, "utf8").includes(CLAIM),
      "delivery is the one path that validates, so it is the one path whose " +
      "artifact may say so");
  });

  it("offers exactly one door onto the gate", () => {
    // A second export of `attest` would be a second place a future caller
    // looks, and the value of a single gate is that there is nowhere else.
    assert.equal(validateIndex.attest, undefined,
      "validate/index.mjs re-exports attest; verification.mjs is the one module it comes from");
    assert.equal(validateIndex.isAttestation, undefined,
      "validate/index.mjs re-exports isAttestation; verification.mjs is the one module it comes from");
  });
});

function readdirSyncSorted(directory) {
  return readdirSync(directory).sort();
}
