/**
 * The producer contract, made executable.
 *
 * Every producer is prose. There is no producer code here to mock, and the
 * failure this file exists to catch is not a faked renderer — it is a skill
 * document that drifts back into telling an agent to write the page itself, or
 * that promises something its contract cannot represent. Prose drifts quietly
 * and nothing else in the repository would notice.
 *
 * The table is keyed by **contract** rather than assuming `lesson`. Two
 * producers write lessons and one writes diagrams; what they have in common is
 * that each writes a specification and none of them writes a page, and that is
 * the property asserted for all of them alike.
 *
 * Two rules govern what is asserted:
 *
 * 1. **Assert the architecture, not the wording.** These skills are going to be
 *    rewritten again. A test that pinned their phrasing would fail on every
 *    honest edit and would be deleted, which is worse than never having
 *    existed. So the assertions below are about retired instructions, the real
 *    commands, and the shape of each document's code blocks.
 * 2. **An assertion about the work must fail against the pre-integration file.**
 *    Each producer's `retired` list is quoted verbatim from the file its ticket
 *    replaced, so that property is checkable rather than claimed: run this
 *    suite against `git show main:<skill>` from before that ticket and the
 *    retired-instruction assertions fail.
 *
 *    The structural `demonstrates no markup` assertion passes against the old
 *    files too, and is kept deliberately with that understood. It is a forward
 *    guard rather than a regression: the old skills told an agent to author
 *    HTML without always showing any, so the absence of markup was luck, not
 *    contract. It is also the only assertion here that survives a rewording,
 *    which is what earns it a place beside the rest.
 *
 * Every registered producer runs the same assertions, driven from one table.
 * A further producer is an entry, not a new suite — and it cannot land with
 * thinner coverage than the ones already here.
 *
 * The diagram producer carries three assertions the lesson producers cannot:
 * its example specifications are parsed and checked for presentation controls,
 * and its documented role and relation vocabularies are compared against the
 * schema's own enums. A producer skill that documented a value the schema does
 * not have would send an agent to write a specification that is refused, and
 * the agent would have no way to know the skill was wrong.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { PRESENTATION_CONTROLS }
  from "../../../skills/render-artifact/engine/validate/diagnostics.mjs";
import { REPO_ROOT } from "../lib/harness.mjs";

/**
 * Every producer of a shared contract, with the promises its integration
 * retired.
 *
 * Each retired instruction is a promise the contract cannot keep, and each was
 * retired by narrowing the producer rather than widening the schema. None of
 * them can legitimately return: a future skill that wants any of these is a
 * skill asking for a consumer-specific escape hatch, which is the thing
 * Feature 50 exists to prevent.
 */
const PRODUCERS = [
  {
    name: "learn-feature",
    contract: "lesson",
    skill: join("skills", "learn-feature", "SKILL.md"),
    output: "learning/features/[feature-slug]",
    retired: [
      ["a second output format", "Default to self-contained HTML/CSS/JS"],
      ["MDX as an artifact path", "Use MDX only when the repository already supports it"],
      ["a question type the schema has no section for", "ordering or matching"],
      ["diagrams the renderer cannot draw", "visual diagrams or interactive demonstrations"],
    ],
  },
  {
    name: "learn-codebase",
    contract: "lesson",
    skill: join("skills", "learn-codebase", "SKILL.md"),
    output: "learning/codebase",
    retired: [
      ["a second output format", "Use self-contained HTML/CSS/JS by default"],
      ["MDX as an artifact path", "use an existing docs/MDX system when approved"],
      ["diagrams the renderer cannot draw", "Include navigable diagrams"],
      // The multi-file portal is the presentation decision this producer used
      // to own outright. How a lesson is split and linked is the renderer's,
      // so the directory tree had to go with the rest of the page.
      ["owning the artifact's file layout", "\u251c\u2500\u2500 index.html"],
      ["a second rendering path", "\u251c\u2500\u2500 modules/"],
    ],
  },
  {
    name: "map-system",
    contract: "diagram",
    skill: join("skills", "map-system", "SKILL.md"),
    output: "diagrams/[system-slug]",
    // Nothing retired. This producer replaced no file: before it, there was no
    // way to ask Pathfinder for a diagram at all, so there is no earlier
    // instruction for the second rule of this suite to bite against. Said
    // plainly rather than padded with invented entries — an empty list here is
    // honest, and a fabricated one would make the rule look stronger than it is.
    retired: [],
    // What this producer is checked on instead: its own example specifications,
    // and its documented vocabulary against the schema.
    checksExamples: true,
    // Sections the ticket requires the document to carry. Headings rather than
    // sentences: the prose will be rewritten and should be, but a document that
    // stopped telling an agent when to ask a question, or that the artifact is
    // the proposal, has lost a decision the Feature made.
    sections: [
      "The artifact is the proposal",
      "Provenance",
      "Evidence",
      "Scope and size",
      "Material ambiguity",
      "The vocabulary is closed",
      "What you cannot ask for",
      "What to say afterwards",
    ],
  },
];

for (const producer of PRODUCERS) {
  producer.source = readFileSync(join(REPO_ROOT, producer.skill), "utf8");
}

/** The engine every producer must route through — no other path exists. */
const ENGINE_CLI = "skills/render-artifact/engine/bin/render.mjs";

for (const producer of PRODUCERS) {
  const { name, contract, skill, output, retired, source } = producer;
  describe(`${name} no longer authors the artifact itself`, () => {
    for (const [what, instruction] of retired) {
      it(`does not instruct ${what}`, () => {
        assert.ok(!source.includes(instruction),
          `${skill} still contains the retired instruction "${instruction}". ` +
          `The producer owns semantics; the renderer owns the page. If this ` +
          `promise is wanted back, it is a Feature decision about the shared ` +
          `contract, justified for every consumer — not a line in one ` +
          `producer's skill.`);
      });
    }

    it("demonstrates no markup, in any fenced block", () => {
      // The structural half of the same rule, and the half that survives
      // rewording. A skill that told an agent to author a page would show it
      // what to author. Fence languages are a closed set here on purpose:
      // `text` for paths, `json` for the citation shape, `sh` for the commands.
      const fences = [...source.matchAll(/^```([a-z]*)$/gm)].map((m) => m[1]);
      const allowed = new Set(["text", "json", "sh", ""]);

      const offenders = fences.filter((language) => !allowed.has(language));
      assert.deepEqual(offenders, [],
        `${skill} declares fenced blocks [${offenders.join(", ")}]. A producer ` +
        `skill has no reason to carry html, css, javascript, jsx or mdx: it ` +
        `writes a specification, and the renderer writes the page.`);

      // `svg` is in this list for the diagram producer's sake and applies to
      // all of them: a hand-drawn picture is the same boundary failure as a
      // hand-written page, and it is the one a diagram producer is tempted by.
      assert.doesNotMatch(source, /<(html|head|body|div|span|style|script|svg)\b/i,
        `${skill} contains markup, which is the renderer's output, not the ` +
        `producer's input`);
    });
  });

  describe(`${name} documents a contract the engine actually has`, {
    skip: producer.checksExamples ? false : `${name} carries no example specification`,
  }, () => {
    /** Every fenced JSON block in the skill, parsed. */
    const examples = [...source.matchAll(/^```json\n([\s\S]*?)^```/gm)]
      .map(([, body], index) => {
        try {
          return { index, value: JSON.parse(body) };
        } catch (error) {
          assert.fail(`${skill} JSON example ${index} does not parse: ${error.message}`);
          return null;
        }
      });

    it("shows at least one example, and every one is valid JSON", () => {
      assert.ok(examples.length > 0,
        `${skill} shows no example specification, so an agent has only prose ` +
        `to infer the shape from`);
    });

    it("shows no presentation control in any example", () => {
      // The assertion a grep cannot make. This skill's prose *names* the
      // forbidden fields in order to forbid them, so searching the document
      // for "width" would fire on the sentence refusing it. What matters is
      // whether the shapes it tells an agent to copy are clean, so the
      // examples are parsed and walked instead.
      const offenders = [];
      const walk = (value, path) => {
        if (Array.isArray(value)) {
          value.forEach((item, i) => walk(item, `${path}[${i}]`));
          return;
        }
        if (value === null || typeof value !== "object") return;
        for (const [key, inner] of Object.entries(value)) {
          if (PRESENTATION_CONTROLS.has(key)) offenders.push(`${path}.${key}`);
          walk(inner, `${path}.${key}`);
        }
      };
      for (const { index, value } of examples) walk(value, `example[${index}]`);

      assert.deepEqual(offenders, [],
        `${skill} demonstrates presentation control. An example is what an ` +
        `agent copies, so a coordinate here is a coordinate in every ` +
        `specification this skill produces.`);
    });

    it("names exactly the roles and relations the schema has", () => {
      // Read from the schema rather than restated here. A skill documenting a
      // role the schema does not carry sends an agent to write a specification
      // that is refused, with nothing to tell it the skill was wrong; a skill
      // omitting one quietly narrows the vocabulary.
      const schema = JSON.parse(readFileSync(join(
        REPO_ROOT, "skills", "render-artifact", "engine", "schemas",
        "diagram.schema.json"), "utf8"));

      for (const field of ["role", "relation"]) {
        const expected = schema.$defs[field].enum;
        const documented = expected.filter((value) =>
          source.includes(`\`${value}\``));
        assert.deepEqual(documented, expected,
          `${skill} does not name every ${field} the schema has. Missing: ` +
          `${expected.filter((v) => !documented.includes(v)).join(", ")}`);
      }
    });

    it("carries the sections the Feature's decisions live in", () => {
      const headings = [...source.matchAll(/^#{2,3}\s+(.+)$/gm)].map(([, text]) => text.trim());
      const missing = producer.sections.filter((section) => !headings.includes(section));
      assert.deepEqual(missing, [],
        `${skill} is missing section(s) [${missing.join(", ")}]. Each one holds ` +
        `a decision the Feature made — when to ask a question, that the ` +
        `artifact is the proposal, what cannot be asked for — and a document ` +
        `that stopped saying so has lost it.`);
    });
  });

  describe(`${name} routes through the shared renderer`, () => {
    it("validates before it delivers, through the real engine CLI", () => {
      const validate = source.indexOf(`${ENGINE_CLI} validate`);
      const deliver = source.indexOf(`${ENGINE_CLI} deliver`);

      assert.notEqual(validate, -1,
        `${skill} never invokes \`${ENGINE_CLI} validate\`. Delivery without ` +
        `validation is how an artifact ends up claiming its evidence was ` +
        `checked when nothing checked it.`);
      assert.notEqual(deliver, -1,
        `${skill} never invokes \`${ENGINE_CLI} deliver\`, so it does not ` +
        `produce the artifact through the one path that exists.`);
      assert.ok(validate < deliver,
        `${skill} delivers before it validates; the order is the guarantee`);
    });

    it("persists the semantic specification beside the artifact", () => {
      // The JSON is the producer's reviewable output and the input to a later
      // redelivery. Without it the lesson is only its rendering, and a renderer
      // release would have nothing to re-render.
      assert.ok(source.includes(`${output}/${contract}.json`),
        `${skill} does not persist ${output}/${contract}.json, so nothing ` +
        `records what was claimed or makes the artifact reproducible`);
      assert.ok(source.includes(`${output}/${contract}.html`),
        `${skill} does not name the delivered artifact's path`);
    });

    it("keeps the honest-reporting obligations", () => {
      const lowered = source.toLowerCase();
      assert.ok(lowered.includes("receipt"),
        `${skill} does not mention the receipt, which is the only thing that ` +
        `says what was actually checked`);
      assert.ok(lowered.includes("perceptual"),
        `${skill} does not distinguish deterministic validation from human ` +
        `perceptual review, so a successful delivery can be reported as though ` +
        `somebody had looked at the page`);
    });
  });
}
