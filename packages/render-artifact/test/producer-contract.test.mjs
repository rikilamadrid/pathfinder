/**
 * The producer contract, made executable.
 *
 * `learn-feature` is prose. There is no producer code here to mock, and the
 * failure this file exists to catch is not a faked renderer — it is a skill
 * document that drifts back into telling an agent to write the page itself, or
 * that promises something the `lesson` contract cannot represent. Prose drifts
 * quietly and nothing else in the repository would notice.
 *
 * Two rules govern what is asserted:
 *
 * 1. **Assert the architecture, not the wording.** The skill is going to be
 *    rewritten again. A test that pins its phrasing would fail on every honest
 *    edit and would be deleted, which is worse than never having existed. So
 *    the assertions below are about retired instructions, the real commands,
 *    and the shape of the document's code blocks.
 * 2. **An assertion about the work must fail against the pre-50.3 file.**
 *    `RETIRED` is quoted verbatim from the file this ticket replaced, so that
 *    property is checkable rather than claimed: run this suite against
 *    `git show main:skills/learn-feature/SKILL.md` and seven of the eight tests
 *    fail.
 *
 *    The eighth — `demonstrates no markup` — passes against the old file too,
 *    and is kept deliberately with that understood. It is a forward guard
 *    rather than a regression: the old skill told an agent to author HTML
 *    without showing any, so the absence of markup was luck, not contract.
 *    It is also the only assertion here that survives a rewording of the
 *    skill, which is what earns it a place beside the seven.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { REPO_ROOT } from "../lib/harness.mjs";

const SKILL = join(REPO_ROOT, "skills", "learn-feature", "SKILL.md");
const source = readFileSync(SKILL, "utf8");

/**
 * Instructions the pre-50.3 skill gave, quoted from it exactly.
 *
 * Each is a promise the `lesson` contract cannot keep, and each was retired by
 * narrowing the producer rather than widening the schema. None of them can
 * legitimately return: a future skill that wants any of these is a skill
 * asking for a consumer-specific escape hatch, which is the thing Feature 50
 * exists to prevent.
 */
const RETIRED = [
  ["a second output format", "Default to self-contained HTML/CSS/JS"],
  ["MDX as an artifact path", "Use MDX only when the repository already supports it"],
  ["a question type the schema has no section for", "ordering or matching"],
  ["diagrams the renderer cannot draw", "visual diagrams or interactive demonstrations"],
];

/** The engine this skill must actually route through — no other path exists. */
const ENGINE_CLI = "skills/render-artifact/engine/bin/render.mjs";

describe("learn-feature no longer authors the artifact itself", () => {
  for (const [what, instruction] of RETIRED) {
    it(`does not instruct ${what}`, () => {
      assert.ok(!source.includes(instruction),
        `skills/learn-feature/SKILL.md still contains the retired instruction ` +
        `"${instruction}". The producer owns semantics; the renderer owns the ` +
        `page. If this promise is wanted back, it is a Feature decision about ` +
        `the shared contract, justified for every consumer — not a line in one ` +
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
      `fenced blocks declare [${offenders.join(", ")}]. A producer skill has ` +
      `no reason to carry html, css, javascript, jsx or mdx: it writes a ` +
      `specification, and the renderer writes the page.`);

    assert.doesNotMatch(source, /<(html|head|body|div|span|style|script)\b/i,
      "the skill contains markup, which is the renderer's output, not the " +
      "producer's input");
  });
});

describe("learn-feature routes through the shared renderer", () => {
  it("validates before it delivers, through the real engine CLI", () => {
    const validate = source.indexOf(`${ENGINE_CLI} validate`);
    const deliver = source.indexOf(`${ENGINE_CLI} deliver`);

    assert.notEqual(validate, -1,
      `the skill never invokes \`${ENGINE_CLI} validate\`. Delivery without ` +
      `validation is how an artifact ends up claiming its evidence was checked ` +
      `when nothing checked it.`);
    assert.notEqual(deliver, -1,
      `the skill never invokes \`${ENGINE_CLI} deliver\`, so it does not ` +
      `produce the artifact through the one path that exists.`);
    assert.ok(validate < deliver,
      "the skill delivers before it validates; the order is the guarantee");
  });

  it("persists the semantic specification beside the artifact", () => {
    // The JSON is the producer's reviewable output and the input to a later
    // redelivery. Without it the lesson is only its rendering, and a renderer
    // release would have nothing to re-render.
    assert.match(source, /learning\/features\/\[feature-slug\]\/lesson\.json/,
      "the skill does not persist lesson.json, so nothing records what was " +
      "claimed or makes the artifact reproducible");
    assert.match(source, /learning\/features\/\[feature-slug\]\/lesson\.html/,
      "the skill does not name the delivered artifact's path");
  });

  it("keeps the honest-reporting obligations", () => {
    const lowered = source.toLowerCase();
    assert.ok(lowered.includes("receipt"),
      "the skill does not mention the receipt, which is the only thing that " +
      "says what was actually checked");
    assert.ok(lowered.includes("perceptual"),
      "the skill does not distinguish deterministic validation from human " +
      "perceptual review, so a successful delivery can be reported as though " +
      "somebody had looked at the page");
  });
});
