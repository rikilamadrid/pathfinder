/**
 * The trust contract: what a diagram is allowed to say about where it came from.
 *
 * A reader has to be able to tell three things apart, and the engine is what
 * makes that possible rather than a convention nobody enforces:
 *
 *   derived                  mapped from a repository, every fact cited
 *   proposed, with source    a design, citing the parts of itself that exist
 *   proposed, no source      an intended system, with nothing behind it at all
 *
 * The rule underneath every assertion below is that the renderer must never
 * imply more verification than happened. That cuts in both directions. An
 * artifact whose citations were checked may say so; one with no citations may
 * not say so on the strength of having had nothing to fail; and one with no
 * repository at all must be deliverable and honest rather than either refused
 * or quietly dressed up with a commit row it does not have.
 *
 * **What the evidence layer establishes, and what it does not.** That the cited
 * file exists at the declared commit, that the cited range exists, and that the
 * material is there to read. Not that the claim resting on it is true. The
 * wording assertions below are written against that distinction deliberately:
 * each checks that a sentence exists *and* that it stops where the checking
 * stopped. Provenance is not truth, and an artifact that blurred the two would
 * be worse than one that said nothing.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { render } from "../../../skills/render-artifact/engine/render/index.mjs";
import { validateSpecification }
  from "../../../skills/render-artifact/engine/validate/index.mjs";
import {
  PROVENANCE_SPECIMENS, REPO_ROOT, SPECS, bareEnv, cleanUpTemporaryDirectories,
  deliverInSubprocess, temporaryDirectory,
} from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

const DERIVED = JSON.parse(readFileSync(SPECS.diagram, "utf8"));
const PROPOSED = JSON.parse(readFileSync(SPECS.proposed, "utf8"));
const SOURCELESS = JSON.parse(readFileSync(SPECS["intended-system"], "utf8"));

/** Deliver a specification built in memory, and report what the engine said. */
function deliverSpec(spec, { repo = REPO_ROOT } = {}) {
  const directory = temporaryDirectory("provenance-");
  const specPath = join(directory, "spec.json");
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  return deliverInSubprocess({ spec: specPath, repo, outDirectory: directory });
}

/** Every diagnostic code a delivery reported, in order. */
function codes(delivery) {
  return (delivery.receipt.diagnostics ?? []).map((d) => d.code);
}

function diagnosticNamed(delivery, code) {
  return (delivery.receipt.diagnostics ?? []).find((d) => d.code === code);
}

const derived = () => structuredClone(DERIVED);
const proposed = () => structuredClone(PROPOSED);
const sourceless = () => structuredClone(SOURCELESS);

/** The artifact's provenance footer, which is the only place a claim may live. */
function footerOf(html) {
  const opensAt = html.indexOf('<footer class="pf-provenance">');
  assert.notEqual(opensAt, -1, "the artifact carries no provenance footer");
  return html.slice(opensAt, html.indexOf("</footer>", opensAt));
}

/**
 * A refusal must leave nothing behind — not the artifact, and not the staging
 * file the commit would have renamed. Asserted together because they are the
 * same promise from a reader's side: there is no half-made artifact to meet.
 */
function assertWroteNothing(delivery) {
  assert.equal(delivery.status, 1, "the specification was accepted, not refused");
  assert.equal(existsSync(delivery.outPath), false,
    "a refused delivery wrote its artifact anyway");

  const directory = join(delivery.outPath, "..");
  const leftovers = readdirSync(directory).filter((name) => name !== "spec.json");
  assert.deepEqual(leftovers, [],
    `a refused delivery left ${leftovers.join(", ")} behind`);
}

describe("provenance — three states a reader can tell apart", () => {
  const delivered = Object.fromEntries(
    Object.entries(PROVENANCE_SPECIMENS).map(([state, specimen]) =>
      [state, deliverInSubprocess({ spec: SPECS[specimen] })]));

  for (const [state, delivery] of Object.entries(delivered)) {
    it(`delivers the ${state} specimen`, () => {
      assert.equal(delivery.status, 0,
        `${JSON.stringify(delivery.receipt, null, 2)}\n${delivery.stderr}`);
    });
  }

  it("says different things in each state", () => {
    const notes = Object.entries(delivered).map(([state, delivery]) => {
      const footer = footerOf(delivery.html);
      const match = footer.match(/<p class="pf-caveat">([\s\S]*?)<\/p>/);
      return [state, match ? match[1] : null];
    });

    const present = notes.filter(([, note]) => note !== null);
    assert.equal(present.length, 3, "a state said nothing at all about itself");
    assert.equal(new Set(present.map(([, note]) => note)).size, 3,
      `two states produced the same wording:\n${
        present.map(([state, note]) => `  ${state}: ${note}`).join("\n")}`);
  });

  it("lets the derived artifact say its citations were checked, and no more", () => {
    const footer = footerOf(delivered.derived.html);

    assert.match(footer, /checked deterministically against the commit named here/);
    assert.match(footer, /every component, relationship and claim/);
    // The sentence stops at provenance. It must not become a statement that the
    // reading of the repository is the right one.
    assert.match(footer, /not a finding that the\s+architecture drawn here is correct/);
    assert.doesNotMatch(footer, /proposed design/);
  });

  it("makes the proposed artifact deny that its design exists", () => {
    const footer = footerOf(delivered["proposed-with-citations"].html);

    assert.match(footer, /describes a proposed design/);
    assert.match(footer, /verified against the commit named here/);
    // The half that matters. A reader who met the derived wording here would
    // conclude the architecture had been found in the repository.
    assert.match(footer, /do not\s+establish that the system drawn here exists/);
  });

  it("gives the source-less artifact no verification sentence at all", () => {
    const footer = footerOf(delivered["proposed-without-source"].html);

    assert.match(footer, /describes an intended system/);
    assert.match(footer, /names no repository and no commit/);
    assert.doesNotMatch(footer, /checked deterministically/);
    assert.doesNotMatch(footer, /verified against the commit/);
  });

  it("gives a proposed diagram with a source and no citations no sentence either", () => {
    // The multilingual specimen: a real source, and nothing cited against it.
    // Its evidence layer runs and passes by having nothing to fail, and that
    // success is worth exactly nothing — which is why it earns no sentence.
    const delivery = deliverInSubprocess({ spec: SPECS.multilingual });
    assert.equal(delivery.status, 0, delivery.stderr);

    const footer = footerOf(delivery.html);
    assert.match(footer, /<dt>Commit<\/dt>/, "it does declare a commit");
    assert.doesNotMatch(footer, /pf-caveat/,
      "a diagram that cited nothing claimed its citations had been checked");
  });

  it("never says \"unverified\", in any state", () => {
    // The absence of a sentence is the signal. Saying "unverified" would still
    // be the renderer reporting on a process it did not observe.
    for (const [state, delivery] of Object.entries(delivered)) {
      assert.ok(!delivery.html.toLowerCase().includes("unverified"),
        `the ${state} artifact hedges instead of staying silent`);
    }
  });
});

describe("provenance — the wording is the renderer's and nobody else's", () => {
  it("is not selectable by any field a specification may carry", () => {
    // There is no field for this, so the attempt to add one is what gets
    // tested: every plausible name a producer would reach for is refused.
    for (const field of [
      "verification", "verified", "verification_wording", "validation_status",
      "wording", "caveat", "trust", "claim", "attestation", "checked",
    ]) {
      const spec = derived();
      spec[field] = "This diagram is fully verified and its architecture is correct.";
      const delivery = deliverSpec(spec);

      assert.equal(delivery.status, 1, `\`${field}\` was accepted`);
      assert.ok(codes(delivery).some((code) =>
        code === "unknown_field" || code === "presentation_control"),
      `\`${field}\` produced ${codes(delivery).join(", ")}`);
    }
  });

  it("does not change when a producer writes the sentence into its own prose", () => {
    // A producer cannot reach the renderer's sentence, but it can write
    // something that looks like one into a field it does own. That text must
    // arrive as escaped content in the body and must not touch the footer.
    const spec = proposed();
    spec.diagram.nodes[0].summary =
      "This artifact was checked deterministically and every citation was verified.";

    const delivery = deliverSpec(spec);
    assert.equal(delivery.status, 0, delivery.stderr);

    const footer = footerOf(delivery.html);
    assert.match(footer, /describes a proposed design/,
      "the producer's prose displaced the renderer's own wording");
    assert.ok(delivery.html.includes(spec.diagram.nodes[0].summary),
      "the producer's words were altered rather than merely quoted");
  });

  it("comes from the shared shell, so both kinds are gated the same way", () => {
    // A diagram and a lesson, each rendered without an attestation. Neither may
    // claim anything. If the gate lived in a kind renderer this would pass for
    // one of them and not the other.
    for (const [name, spec] of [
      ["diagram", DERIVED],
      ["lesson", JSON.parse(readFileSync(SPECS.example, "utf8"))],
    ]) {
      const html = render(structuredClone(spec));
      assert.ok(!html.includes("was verified against the commit named here"),
        `the ${name} kind claimed verification with no attestation`);
      assert.ok(!html.includes("checked deterministically"),
        `the ${name} kind claimed verification with no attestation`);
    }
  });
});

describe("provenance — a source-less diagram invents nothing", () => {
  const delivery = deliverInSubprocess({ spec: SPECS["intended-system"] });

  it("delivers, and opens as an ordinary artifact", () => {
    assert.equal(delivery.status, 0, delivery.stderr);
    assert.match(delivery.html, /<svg class="pf-graph"/);
    assert.match(delivery.html, /<div class="pf-eyebrow">Pathfinder diagram<\/div>/);
  });

  it("carries no repository row and no commit row", () => {
    const footer = footerOf(delivery.html);
    assert.ok(!footer.includes("<dt>Repository</dt>"));
    assert.ok(!footer.includes("<dt>Commit</dt>"));
    assert.match(footer, /<dt>Renderer<\/dt>/,
      "the renderer version is the engine's own fact and is always reported");
  });

  it("carries no timestamp, real or invented", () => {
    const footer = footerOf(delivery.html);
    assert.ok(!footer.includes("<dt>Specification generated</dt>"),
      "a specification with no source has no generated_at to report");

    // `generated_at` lives inside `source`, so there is no honest value here.
    // A plausible one would be worse than none: it would read as provenance.
    assert.doesNotMatch(delivery.html, /\d{4}-\d{2}-\d{2}/,
      "a date reached an artifact whose specification supplied none");
  });

  it("takes nothing from the filesystem or the environment in its place", () => {
    // Delivered from an unrelated working directory with a bare environment, so
    // anything ambient that reached the page would have to come from there.
    const elsewhere = deliverInSubprocess({
      spec: SPECS["intended-system"],
      cwd: temporaryDirectory("sourceless-cwd-"),
      env: bareEnv({ TZ: "Pacific/Kiritimati", LANG: "tr_TR.UTF-8" }),
    });

    assert.equal(elsewhere.status, 0, elsewhere.stderr);
    assert.equal(elsewhere.receipt.artifact.sha256, delivery.receipt.artifact.sha256,
      "the artifact changed with the environment, so it read something from it");
    assert.ok(!elsewhere.html.includes(REPO_ROOT));
    assert.ok(!elsewhere.html.includes("file://"));
  });

  it("reports its evidence layer as not run, with the reason, never as passed", () => {
    const result = validateSpecification(SOURCELESS, { repoDir: REPO_ROOT });

    assert.ok(result.ok, JSON.stringify(result.diagnostics, null, 2));
    assert.ok(!result.ran.includes("evidence"),
      "the evidence layer is reported as having run against a specification " +
      "with no commit to resolve and no citation to resolve");
    assert.deepEqual(result.notRun.map((entry) => entry.layer), ["evidence"]);
    assert.match(result.notRun[0].reason, /declares no source/);
    assert.equal(result.resolvedCitations, 0);
  });

  it("says so in the report a human reads", () => {
    const { stdout } = validateCli();

    assert.match(stdout, /~ evidence: not run/);
    assert.doesNotMatch(stdout, /ok evidence/,
      "the strongest word in the report appeared against the weakest claim in it");
  });

  it("says so in the report a machine reads", () => {
    // `--json` is how a producer skill consumes this engine, so the reason has
    // to survive the trip. A caller seeing `ok: true` beside two layers, with
    // nothing saying why the third is missing, would have to infer the
    // difference between "everything passed" and "one layer did not apply" —
    // and not inferring it is the whole point of reporting the layers apart.
    const report = JSON.parse(validateCli("--json").stdout);

    assert.equal(report.ok, true);
    assert.deepEqual(report.ran, ["structural", "composition"]);
    assert.deepEqual(report.not_run.map((entry) => entry.layer), ["evidence"]);
    assert.match(report.not_run[0].reason, /declares no source/);
    assert.equal(report.resolved_citations, 0);
  });

  it("reports a resolved-citation count a caller can act on", () => {
    // The number the verification sentence is gated on. Exposed so a producer
    // can tell "checked, and there was something to check" from "checked
    // nothing", which is a distinction it would otherwise have to guess at.
    const derivedReport = JSON.parse(
      validateCli("--json", SPECS.diagram).stdout);
    assert.ok(derivedReport.resolved_citations >= 1);
    assert.deepEqual(derivedReport.not_run, []);

    const vacuous = JSON.parse(validateCli("--json", SPECS.multilingual).stdout);
    assert.equal(vacuous.ok, true);
    assert.ok(vacuous.ran.includes("evidence"),
      "the layer did run here; there was simply nothing in it to resolve");
    assert.equal(vacuous.resolved_citations, 0);
  });

  /** The engine's own CLI, on the source-less specimen unless told otherwise. */
  function validateCli(...args) {
    const flags = args.filter((arg) => arg.startsWith("--"));
    const spec = args.find((arg) => !arg.startsWith("--")) ?? SPECS["intended-system"];

    const result = spawnSync(process.execPath, [
      join(REPO_ROOT, "skills", "render-artifact", "engine", "bin", "render.mjs"),
      "validate", spec, "--repo", REPO_ROOT, ...flags,
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    return result;
  }
});

describe("provenance — refusals, each with its own diagnostic", () => {
  it("refuses a diagram that declares no provenance", () => {
    // No default. A diagram that did not say would have a trust level assigned
    // to it by the engine, and the engine has no business guessing which claim
    // its producer meant to make.
    const spec = derived();
    delete spec.provenance;
    const delivery = deliverSpec(spec);

    assertWroteNothing(delivery);
    assert.ok(codes(delivery).includes("missing_field"), codes(delivery).join(", "));
  });

  it("refuses a provenance value it does not implement", () => {
    const spec = derived();
    spec.provenance = "reverse-engineered";
    const delivery = deliverSpec(spec);

    assertWroteNothing(delivery);
    assert.ok(codes(delivery).includes("schema_enum"), codes(delivery).join(", "));
  });

  it("refuses a derived diagram with no source, naming the claim", () => {
    const spec = derived();
    delete spec.source;
    const delivery = deliverSpec(spec);

    assertWroteNothing(delivery);
    const d = diagnosticNamed(delivery, "source_required_for_derived");
    assert.ok(d, codes(delivery).join(", "));
    assert.match(d.message, /must say which repository and which commit/);
    assert.match(d.message, /is `proposed`/,
      "the diagnostic should say what the producer's other option is");
  });

  it("refuses a citation in a specification with no source, naming the citation", () => {
    const spec = sourceless();
    spec.diagram.nodes[1].evidence = [{ path: "README.md", lines: [1, 2] }];
    const delivery = deliverSpec(spec);

    assertWroteNothing(delivery);
    const d = diagnosticNamed(delivery, "citation_without_source");
    assert.ok(d, codes(delivery).join(", "));
    assert.match(d.message, /README\.md/, "the diagnostic does not name the citation");
    assert.match(d.message, /nothing to resolve\s+it against/);
  });

  it("refuses artifact.summary on a derived diagram", () => {
    const spec = derived();
    spec.artifact.summary =
      "Four states and two exits, and nothing here cites any of it.";
    const delivery = deliverSpec(spec);

    assertWroteNothing(delivery);
    const d = diagnosticNamed(delivery, "artifact_summary_forbidden");
    assert.ok(d, codes(delivery).join(", "));
    assert.match(d.message, /artifact\.subtitle/,
      "the diagnostic should name the field that is still available");
  });

  it("permits artifact.summary on a proposed diagram", () => {
    // The same field, and legitimate here: the document is a design argument,
    // and its opening paragraph saying so is the honest thing for it to do.
    assert.ok(PROPOSED.artifact.summary,
      "the proposed specimen needs an artifact.summary for this to mean anything");
    assert.equal(deliverInSubprocess({ spec: SPECS.proposed }).status, 0);
  });

  it("refuses a derived diagram with an uncited node, naming the node", () => {
    const spec = derived();
    delete spec.diagram.nodes[6].evidence;
    const delivery = deliverSpec(spec);

    assertWroteNothing(delivery);
    const d = diagnosticNamed(delivery, "node_without_evidence");
    assert.ok(d, codes(delivery).join(", "));
    assert.equal(d.subject, `node "${spec.diagram.nodes[6].label}"`);
    assert.match(d.message, /the diagram is\s+`proposed`/,
      "the diagnostic should name the provenance a producer can legitimately use");
  });

  it("refuses a derived diagram with an uncited edge, naming the edge", () => {
    const spec = derived();
    delete spec.diagram.edges[4].evidence;
    const delivery = deliverSpec(spec);

    assertWroteNothing(delivery);
    const d = diagnosticNamed(delivery, "edge_without_evidence");
    assert.ok(d, codes(delivery).join(", "));
    assert.equal(d.subject, `edge \`${spec.diagram.edges[4].id}\``);
  });

  for (const [what, mutate] of [
    ["group", (spec) => {
      const group = spec.diagram.groups.find((g) => g.summary !== undefined);
      delete group.evidence;
      return `group "${group.label}"`;
    }],
    ["path", (spec) => {
      const path = spec.diagram.paths.find((p) => p.note !== undefined);
      delete path.evidence;
      return `path "${path.label}"`;
    }],
    ["view", (spec) => {
      const view = spec.diagram.views.find((v) => v.note !== undefined);
      delete view.evidence;
      return `view "${view.label}"`;
    }],
  ]) {
    it(`refuses a derived ${what} carrying prose with no citation`, () => {
      const spec = derived();
      const subject = mutate(spec);
      const delivery = deliverSpec(spec);

      assertWroteNothing(delivery);
      const d = diagnosticNamed(delivery, "claim_without_evidence");
      assert.ok(d, codes(delivery).join(", "));
      assert.equal(d.subject, subject);
    });
  }

  for (const [what, strip] of [
    ["group", (spec) => {
      const group = spec.diagram.groups.find((g) => g.summary !== undefined);
      delete group.summary;
      delete group.evidence;
    }],
    ["path", (spec) => {
      const path = spec.diagram.paths.find((p) => p.note !== undefined);
      delete path.note;
      delete path.evidence;
    }],
    ["view", (spec) => {
      const view = spec.diagram.views.find((v) => v.note !== undefined);
      delete view.note;
      delete view.evidence;
    }],
  ]) {
    it(`accepts a label-only ${what} with no citation`, () => {
      // The narrow half of the rule, and the half worth protecting: a label is
      // a name, and a name asserts nothing its already-cited members do not.
      const spec = derived();
      strip(spec);
      const delivery = deliverSpec(spec);

      assert.equal(delivery.status, 0,
        `a label-only ${what} was required to cite something:\n` +
        JSON.stringify(delivery.receipt.diagnostics, null, 2));
    });
  }

  it("refuses a citation naming a path absent at the declared commit", () => {
    const spec = derived();
    spec.diagram.nodes[0].evidence = [{ path: "skills/ticket/nowhere.md" }];
    const delivery = deliverSpec(spec);

    assertWroteNothing(delivery);
    const d = diagnosticNamed(delivery, "evidence_path_absent");
    assert.ok(d, codes(delivery).join(", "));
    assert.match(d.message, /skills\/ticket\/nowhere\.md/);
    assert.match(d.message, /not the\s+working tree/);
  });

  it("refuses a citation whose range does not exist at that commit", () => {
    const spec = derived();
    spec.diagram.nodes[0].evidence = [
      { path: "skills/ticket/SKILL.md", lines: [1, 99999] },
    ];
    const delivery = deliverSpec(spec);

    assertWroteNothing(delivery);
    assert.ok(codes(delivery).includes("evidence_range_invalid"), codes(delivery).join(", "));
  });

  it("refuses a proposed diagram whose supplied citation does not resolve", () => {
    // Citations are optional for a proposed diagram. Every one present is still
    // checked, which is the whole difference between citing something and
    // gesturing at it.
    const spec = proposed();
    spec.diagram.nodes[1].evidence = [{ path: "engine/does-not-exist.mjs" }];
    const delivery = deliverSpec(spec);

    assertWroteNothing(delivery);
    assert.ok(codes(delivery).includes("evidence_path_absent"), codes(delivery).join(", "));
  });
});

describe("provenance — evidence resolves against the commit, not the tree", () => {
  /**
   * A throwaway repository, so the clobbering is real and this repository is
   * never touched.
   *
   * The proof needs a working tree that disagrees with history: a file
   * committed with enough lines to cite, then truncated on disk. If validation
   * still passes, the citation was read from the commit. Doing that to a file in
   * the Pathfinder checkout would prove the same thing and would leave a
   * developer's tree modified if the process died mid-test, which is not a
   * trade worth making for a test that can own its own repository.
   */
  function throwawayRepository() {
    const root = temporaryDirectory("cited-repo-");
    const git = (...args) => {
      const result = spawnSync("git", args, {
        cwd: root, encoding: "utf8",
        env: bareEnv({
          GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
          GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
        }),
      });
      assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
      return result.stdout.trim();
    };

    git("init", "--quiet", "-b", "main");
    writeFileSync(join(root, "ARCHITECTURE.md"),
      `${Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n")}\n`, "utf8");
    git("add", "ARCHITECTURE.md");
    git("commit", "--quiet", "-m", "the commit the diagram cites");

    return { root, commit: git("rev-parse", "HEAD") };
  }

  const { root, commit } = throwawayRepository();

  /** A minimal derived diagram citing that file, at that commit. */
  const citing = () => ({
    schema_version: "1.0",
    kind: "diagram",
    provenance: "derived",
    artifact: { title: "Cited at a commit" },
    source: { repo: "throwaway", commit },
    diagram: {
      topology: "graph",
      nodes: [{
        id: "documented", label: "A documented thing", role: "service",
        evidence: [{ path: "ARCHITECTURE.md", lines: [30, 40] }],
      }],
      edges: [],
    },
  });

  it("passes while the citation resolves in both history and the tree", () => {
    const delivery = deliverSpec(citing(), { repo: root });
    assert.equal(delivery.status, 0,
      `${JSON.stringify(delivery.receipt, null, 2)}\n${delivery.stderr}`);
  });

  it("still passes once the cited file is clobbered in the working tree", () => {
    // The file on disk no longer has a line 30. The commit does.
    writeFileSync(join(root, "ARCHITECTURE.md"), "clobbered\n", "utf8");
    assert.equal(readFileSync(join(root, "ARCHITECTURE.md"), "utf8").trim(), "clobbered");

    const delivery = deliverSpec(citing(), { repo: root });
    assert.equal(delivery.status, 0,
      "the citation was resolved against the working tree, which means every " +
      "artifact's evidence goes stale the moment anybody edits a file:\n" +
      JSON.stringify(delivery.receipt, null, 2));
  });

  it("fails when the range is wrong at the commit, clobbered tree or not", () => {
    // The mirror image, and what makes the assertion above worth anything: it
    // is the commit that decides, so a range the commit does not have fails
    // even though nothing about the tree changed.
    const spec = citing();
    spec.diagram.nodes[0].evidence = [{ path: "ARCHITECTURE.md", lines: [30, 60] }];

    const delivery = deliverSpec(spec, { repo: root });
    assertWroteNothing(delivery);
    assert.ok(codes(delivery).includes("evidence_range_invalid"), codes(delivery).join(", "));
  });

  it("refuses a commit this checkout does not have", () => {
    const spec = citing();
    spec.source.commit = "0".repeat(40);

    const delivery = deliverSpec(spec, { repo: root });
    assertWroteNothing(delivery);
    assert.ok(codes(delivery).includes("source_commit_unavailable"), codes(delivery).join(", "));
  });
});

describe("provenance — a failed delivery is atomic", () => {
  it("leaves a previously delivered diagram byte-identical", () => {
    const directory = temporaryDirectory("atomic-");
    const out = join(directory, "artifact.html");
    const specPath = join(directory, "spec.json");

    writeFileSync(specPath, `${JSON.stringify(DERIVED, null, 2)}\n`, "utf8");
    const first = deliverInSubprocess({
      spec: specPath, repo: REPO_ROOT, outDirectory: directory,
    });
    assert.equal(first.status, 0, first.stderr);
    const delivered = readFileSync(out);

    // Every failure mode in turn, against the same destination. Each must leave
    // the artifact exactly as the successful delivery left it.
    const broken = {
      node_without_evidence: (spec) => { delete spec.diagram.nodes[1].evidence; },
      edge_without_evidence: (spec) => { delete spec.diagram.edges[1].evidence; },
      evidence_path_absent: (spec) => {
        spec.diagram.nodes[0].evidence = [{ path: "gone.md" }];
      },
      artifact_summary_forbidden: (spec) => { spec.artifact.summary = "uncited"; },
      source_required_for_derived: (spec) => { delete spec.source; },
      topology_unsupported: (spec) => { spec.diagram.topology = "sequence"; },
      unresolved_reference: (spec) => { spec.diagram.edges[0].to = "nowhere"; },
    };

    for (const [expected, mutate] of Object.entries(broken)) {
      const spec = structuredClone(DERIVED);
      mutate(spec);
      writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");

      const failed = deliverInSubprocess({
        spec: specPath, repo: REPO_ROOT, outDirectory: directory,
      });

      assert.equal(failed.status, 1, `${expected} was delivered rather than refused`);
      assert.ok(codes(failed).includes(expected),
        `expected ${expected}, got ${codes(failed).join(", ")}`);
      assert.ok(readFileSync(out).equals(delivered),
        `a failed delivery (${expected}) overwrote the artifact already there`);

      const leftovers = readdirSync(directory)
        .filter((name) => name !== "artifact.html" && name !== "spec.json");
      assert.deepEqual(leftovers, [],
        `a failed delivery (${expected}) left ${leftovers.join(", ")} behind`);
    }
  });

  it("writes nothing at all when the first delivery of a diagram fails", () => {
    const spec = derived();
    delete spec.diagram.nodes[2].evidence;
    assertWroteNothing(deliverSpec(spec));
  });
});

describe("provenance — the lesson kind is unchanged by all of it", () => {
  it("has no provenance field, and refuses one", () => {
    const lesson = JSON.parse(readFileSync(SPECS.example, "utf8"));
    lesson.provenance = "derived";

    const delivery = deliverSpec(lesson);
    assert.equal(delivery.status, 1,
      "a lesson accepted a diagram's field, so the two schemas are entangled");
    assert.ok(codes(delivery).includes("unknown_field"), codes(delivery).join(", "));
  });

  it("still requires a source", () => {
    const lesson = JSON.parse(readFileSync(SPECS.example, "utf8"));
    delete lesson.source;

    const delivery = deliverSpec(lesson);
    assertWroteNothing(delivery);
    const d = diagnosticNamed(delivery, "missing_field");
    assert.ok(d, codes(delivery).join(", "));
    assert.equal(d.subject, "source",
      "`source` is conditional for a diagram only; making it conditional in " +
      "the shared contract would have made every lesson's provenance optional");
  });

  it("keeps every committed lesson specification exactly as valid as it was", () => {
    // The whole-set assertion. Not "the ones we remembered to check" — every
    // lesson in the harness, none of which may have changed validity.
    for (const name of ["fixture", "example", "learn-feature", "learn-codebase"]) {
      const spec = JSON.parse(readFileSync(SPECS[name], "utf8"));
      assert.equal(spec.kind, "lesson");

      const result = validateSpecification(spec, { repoDir: REPO_ROOT });
      assert.ok(result.ok,
        `the ${name} lesson became invalid:\n` +
        JSON.stringify(result.diagnostics, null, 2));
      assert.deepEqual([...result.ran], ["structural", "composition", "evidence"],
        `the ${name} lesson's evidence layer stopped running`);
      assert.deepEqual(result.notRun, [],
        `a lesson layer was reported as not run; lessons always declare a source`);
    }
  });

  it("leaves the schema file itself untouched", () => {
    // `lesson.schema.json` is named in the ticket's out-of-scope list. Asserted
    // against Git rather than by reading the file, so the claim is about the
    // change rather than about the content.
    const diff = spawnSync("git", [
      "diff", "origin/main", "--",
      "skills/render-artifact/engine/schemas/lesson.schema.json",
    ], { cwd: REPO_ROOT, encoding: "utf8" });

    assert.equal(diff.status, 0, diff.stderr);
    assert.equal(diff.stdout, "",
      "lesson.schema.json changed, and the ticket says it may not");
  });
});
