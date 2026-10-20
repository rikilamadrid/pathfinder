/**
 * The `adaptive` policy and the tiered translation it relies on.
 *
 * Three claims are defended. The policy is exactly the spec's level rule and
 * level × session table, cell by cell. A tier reaches a harness only through
 * a map — the shipped Claude Code one or a project's marker — and is refused
 * by name otherwise, as is any effort a harness cannot take. And `static`
 * still selects `inherited` for every session, repair included, so its briefs
 * carry no override anywhere.
 */

import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { PROTOCOLS, buildBrief, formatBrief, translateBrief } from "../../../skills/orchestrate/engine/brief.mjs";
import { replaceExperimentReport } from "../../../skills/orchestrate/engine/experiments.mjs";
import { replaceFindingsReport } from "../../../skills/orchestrate/engine/findings.mjs";
import { MODEL_TIERS, readModelTiersMarker } from "../../../skills/orchestrate/engine/mode.mjs";
import { level, select } from "../../../skills/orchestrate/engine/policies/adaptive.mjs";
import { loadPolicy, runPolicy } from "../../../skills/orchestrate/engine/policies/registry.mjs";
import { updateStateText } from "../../../skills/orchestrate/engine/statefile.mjs";
import { cleanUpTemporaryDirectories, json, makeProject, orchestrate, prGh, runGit } from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

const APPROVAL = "execution of this Feature's tickets in this round; no merges";
const ADAPTIVE = "# Execution Mode\n\n<!-- pathfinder:execution-mode orchestrator -->\n<!-- pathfinder:routing-policy adaptive -->\n";
const SESSIONS = ["implementation", "adversary", "review", "repair"];
const ROLES = { implementation: "developer", adversary: "adversary", review: "tester", repair: "developer" };

/** The spec's table, written out independently of the module under test. */
const EXPECTED = {
  0: { implementation: "light/low", adversary: "standard/low", review: "standard/medium", repair: "standard/medium" },
  1: { implementation: "standard/medium", adversary: "standard/high", review: "standard/high", repair: "strong/high" },
  2: { implementation: "strong/high", adversary: "strong/high", review: "strong/high", repair: "strong/xhigh" },
};

function estimate({ complexity = "low", context = "small", risk = "low", source = "derived" } = {}) {
  return {
    complexity: { value: complexity, source: "derived", reason: "x" },
    context: { value: context, source: "derived", reason: "x" },
    "parallel-safety": { value: "isolated", source: "derived", reason: "x" },
    risk: { value: risk, source, reason: "x" },
  };
}

const ALL_ESTIMATES = [];
for (const complexity of ["low", "medium", "high"])
  for (const context of ["small", "medium", "large"])
    for (const [risk, source] of [["low", "derived"], ["unassessed", "derived"], ["high", "derived"], ["low", "assessed"], ["medium", "assessed"], ["high", "assessed"]])
      ALL_ESTIMATES.push(estimate({ complexity, context, risk, source }));

describe("the adaptive policy", () => {
  it("levels an estimate by the spec's rule, for every combination", () => {
    for (const value of ALL_ESTIMATES) {
      const c = value.complexity.value;
      const x = value.context.value;
      const r = value.risk.value;
      const expected = r === "high" || c === "high" ? 2 : c === "low" && x === "small" && r === "low" ? 0 : 1;
      assert.equal(level(value), expected, JSON.stringify({ c, x, r }));
    }
  });

  it("never puts unassessed risk at level 0, and puts complexity high at level 2 under assessed low risk", () => {
    assert.equal(level(estimate({ risk: "unassessed" })), 1);
    for (const context of ["small", "medium", "large"]) {
      assert.equal(level(estimate({ complexity: "high", context, risk: "low", source: "assessed" })), 2);
    }
    assert.equal(level(estimate({ risk: "medium", source: "assessed" })), 1);
  });

  it("selects every level × session cell of the table, with the static roles", async () => {
    const policy = await loadPolicy("adaptive");
    assert.equal(policy.ok, true, policy.message);
    const representative = {
      0: estimate(),
      1: estimate({ complexity: "medium", risk: "unassessed" }),
      2: estimate({ complexity: "high", context: "large", risk: "high" }),
    };
    for (const [lvl, value] of Object.entries(representative)) {
      for (const session of SESSIONS) {
        const result = runPolicy(policy, value, { session });
        assert.equal(result.ok, true, result.message);
        assert.deepEqual(result.selection, {
          policy: "adaptive",
          role: ROLES[session],
          model: EXPECTED[lvl][session].split("/")[0],
          effort: EXPECTED[lvl][session].split("/")[1],
        }, `level ${lvl} ${session}`);
      }
    }
  });

  it("never selects below the implementation row for adversary, review, or repair, and repair sits above it", () => {
    const tier = (model) => MODEL_TIERS.indexOf(model);
    const effort = (value) => ["low", "medium", "high", "xhigh", "max"].indexOf(value);
    for (const value of ALL_ESTIMATES) {
      const implementation = select(value, { session: "implementation" });
      for (const session of ["adversary", "review", "repair"]) {
        const other = select(value, { session });
        assert.ok(tier(other.model) >= tier(implementation.model), `${session} model`);
        assert.ok(effort(other.effort) >= effort(implementation.effort), `${session} effort`);
      }
      const repair = select(value, { session: "repair" });
      assert.ok(tier(repair.model) + effort(repair.effort) > tier(implementation.model) + effort(implementation.effort), "repair is a step up");
    }
  });

  it("is refused for a session the registry does not know", async () => {
    const result = runPolicy(await loadPolicy("adaptive"), estimate(), { session: "deploy" });
    assert.equal(result.ok, false);
    assert.match(result.message, /session must be/);
  });
});

const BASE = {
  ticket: "1.1",
  title: "Alpha",
  ref: "#11",
  worktree: "/work/project/.pathfinder/worktrees/1.1",
  main: "/work/project",
  branch: "ticket/1.1-alpha",
  approval: "execution of Feature 1's tickets; no merges",
};
const brief = (model, effort, session = "implementation") =>
  buildBrief({ ...BASE, session, selection: { role: "developer", model, effort } }).brief;

describe("tier translation", () => {
  it("maps each tier through Claude Code's shipped map and passes the effort", () => {
    for (const [tierName, model] of [["light", "haiku"], ["standard", "sonnet"], ["strong", "opus"]]) {
      const input = brief(tierName, "high");
      const before = structuredClone(input);
      const translated = translateBrief(input, "claude-code");
      assert.equal(translated.ok, true, translated.message);
      assert.equal(translated.invocation.model, model);
      assert.equal(translated.invocation.effort, "high");
      assert.match(translated.invocation.prompt, new RegExp(`^Model: {5}${model}$`, "m"), "the worker reads the concrete model");
      assert.deepEqual(input, before, "the brief itself keeps the tier");
    }
  });

  it("refuses a tier no map covers, by name, for codex and manual", () => {
    for (const harness of ["codex", "manual"]) {
      const translated = translateBrief(brief("strong", "high"), harness);
      assert.equal(translated.ok, false);
      assert.match(translated.message, new RegExp(`has no map for model tier \`strong\`: Pathfinder ships none for ${harness}`));
      assert.match(translated.message, new RegExp(`pathfinder:model-tiers ${harness} light=`));
    }
  });

  it("honours a marker map, replacing the shipped one or supplying a missing one", () => {
    const tiers = readModelTiersMarker([
      "<!-- pathfinder:model-tiers claude-code light=sonnet standard=sonnet strong=fable -->",
      "<!-- pathfinder:model-tiers codex light=gpt-5.6-luna standard=gpt-5.6-terra strong=gpt-6-astra -->",
    ].join("\n"));
    assert.equal(tiers.ok, true, tiers.message);
    assert.equal(translateBrief(brief("light", "low"), "claude-code", { tiers }).invocation.model, "sonnet");
    assert.equal(translateBrief(brief("strong", "max"), "claude-code", { tiers }).invocation.model, "fable");
    const codex = translateBrief(brief("strong", "xhigh"), "codex", { tiers });
    assert.equal(codex.ok, true, codex.message);
    assert.deepEqual([codex.invocation.arguments.model, codex.invocation.arguments.reasoning_effort], ["gpt-6-astra", "xhigh"]);
    assert.equal(codex.invocation.arguments.fork_turns, "none");
  });

  it("still applies the harness's effort check to a mapped tier", () => {
    const tiers = readModelTiersMarker("<!-- pathfinder:model-tiers codex light=gpt-5.2 standard=gpt-5.5 strong=gpt-5.5 -->");
    const refused = translateBrief(brief("strong", "max"), "codex", { tiers });
    assert.equal(refused.ok, false);
    assert.match(refused.message, /cannot honour effort `max` with model `gpt-5\.5`/);
  });

  it("refuses a marker whose model fails the harness's model check, or whose harness is unknown", () => {
    const pinned = readModelTiersMarker("<!-- pathfinder:model-tiers claude-code light=haiku standard=sonnet strong=claude-opus-5 -->");
    assert.equal(pinned.ok, true, "the reader checks shape, the translation checks models");
    const refused = translateBrief(brief("light", "low"), "claude-code", { tiers: pinned });
    assert.equal(refused.ok, false);
    assert.match(refused.message, /maps claude-code tier `strong` to `claude-opus-5`, which Claude Code background subagent cannot honour/);

    const unknown = readModelTiersMarker("<!-- pathfinder:model-tiers cursor light=a standard=b strong=c -->");
    assert.match(translateBrief(brief("light", "low"), "claude-code", { tiers: unknown }).message, /maps harness `cursor`, which has no translation/);
  });

  it("refuses every malformed marker, and refuses translation under one", () => {
    for (const line of [
      "<!-- pathfinder:model-tiers claude-code light=haiku standard=sonnet -->",
      "<!-- pathfinder:model-tiers claude-code light=haiku standard=sonnet strong=opus huge=opus -->",
      "<!-- pathfinder:model-tiers claude-code light=haiku light=haiku standard=sonnet strong=opus -->",
      "<!-- pathfinder:model-tiers claude-code light=Haiku standard=sonnet strong=opus -->",
      "<!-- pathfinder:model-tiers claude-code light haiku standard=sonnet strong=opus -->",
      "<!-- pathfinder:model-tiers light=haiku standard=sonnet strong=opus -->",
      "<!-- pathfinder:model-tiers claude-code light=haiku standard=sonnet strong=opus",
      "<!-- pathfinder:model-tiers -->",
      "<!-- pathfinder:model-tiers claude-code light=haiku standard=sonnet strong=opus -->\n<!-- pathfinder:model-tiers claude-code light=haiku standard=sonnet strong=opus -->",
    ]) {
      const tiers = readModelTiersMarker(line);
      assert.equal(tiers.ok, false, line);
      assert.match(tiers.message, /malformed model-tiers marker in context\/execution-mode\.md/);
      const translated = translateBrief(brief("inherited", "inherited"), "claude-code", { tiers });
      assert.equal(translated.ok, false, "nothing is dispatched under a malformed marker");
    }
    assert.deepEqual(readModelTiersMarker("no marker here\n`<!-- pathfinder:model-tiers x -->` quoted"), { ok: true, maps: {} });
  });

  it("leaves an inherited brief untouched on every harness and session, with or without maps", () => {
    const tiers = readModelTiersMarker("<!-- pathfinder:model-tiers claude-code light=sonnet standard=sonnet strong=opus -->");
    for (const session of Object.keys(PROTOCOLS)) {
      const input = brief("inherited", "inherited", session);
      for (const harness of ["claude-code", "manual"]) {
        const expected = { ok: true, harness, invocation: { role: "developer", prompt: formatBrief(input) } };
        assert.deepEqual(translateBrief(input, harness), expected);
        assert.deepEqual(translateBrief(input, harness, { tiers }), expected);
      }
      assert.deepEqual(translateBrief(input, "codex", { tiers }), translateBrief(input, "codex"));
      assert.equal(translateBrief(input, "codex").invocation.arguments.fork_turns, "all");
    }
  });
});

/** A project with a low ticket and a high one, both claimed. */
function claimedPair(modeFile = ADAPTIVE) {
  const root = makeProject({ modeFile, tickets: { "1.1": { title: "Low" }, "1.2": { title: "High" } } });
  return root;
}

describe("adaptive through the CLI", () => {
  it("plans different selections for a low ticket and a high ticket, translated for --harness", () => {
    const root = claimedPair();
    // The high ticket gets its risk from the orchestrator's assessment at
    // claim time; until then the plan shows its derived estimate. Make it high
    // by complexity instead, which the plan derives itself.
    const ticket = join(root, "context", "tickets", "1.2-1-2.md");
    writeFileSync(ticket, readFileSync(ticket, "utf8") + "\n## Changes\n\n" + Array.from({ length: 9 }, (_, i) => `- change ${i}`).join("\n") + "\n");
    runGit(["commit", "-qam", "high"], root);

    const planned = json(orchestrate(["plan", "--harness", "claude-code", "--json"], { root }));
    const [low, high] = planned.dispatch;
    assert.equal(low.key, "1.1");
    assert.deepEqual(low.sessions.implementation, { role: "developer", model: "light", effort: "low", translation: { ok: true, harness: "claude-code", model: "haiku", effort: "low" } });
    assert.deepEqual(low.sessions.review.translation, { ok: true, harness: "claude-code", model: "sonnet", effort: "medium" });
    assert.deepEqual(high.sessions.implementation.translation, { ok: true, harness: "claude-code", model: "opus", effort: "high" });
    assert.deepEqual(high.sessions.repair, { role: "developer", model: "strong", effort: "xhigh", translation: { ok: true, harness: "claude-code", model: "opus", effort: "xhigh" } });
    assert.deepEqual(Object.keys(low.sessions), SESSIONS);

    const text = orchestrate(["plan", "--harness", "claude-code"], { root }).stdout;
    assert.match(text, /^ {8}implementation +developer light\/low → claude-code haiku\/low$/m);
    assert.match(text, /^ {8}implementation +developer strong\/high → claude-code opus\/high$/m);

    const codex = json(orchestrate(["plan", "--harness", "codex", "--json"], { root }));
    assert.equal(codex.dispatch[0].sessions.implementation.translation.ok, false);
    assert.match(codex.dispatch[0].sessions.implementation.translation.message, /has no map for model tier `light`/);
    assert.match(orchestrate(["plan", "--harness", "codex"], { root }).stdout, /→ codex refused: Codex subagent has no map for model tier/);

    const untranslated = json(orchestrate(["plan", "--json"], { root }));
    assert.equal(Object.hasOwn(untranslated.dispatch[0].sessions.implementation, "translation"), false);
    assert.equal(orchestrate(["plan", "--harness", "cursor"], { root }).status, 2);
  });

  it("briefs a claimed low and high ticket on different Claude Code model and effort", () => {
    const root = claimedPair();
    assert.equal(orchestrate(["claim", "1.1"], { root }).status, 0);
    const claimed = orchestrate(["claim", "1.2", "--risk", "high", "--reason", "touches permissions"], { root });
    assert.equal(claimed.status, 0, claimed.stderr);
    const low = json(orchestrate(["brief", "1.1", "--harness", "claude-code", "--approval", APPROVAL, "--json"], { root }));
    const high = json(orchestrate(["brief", "1.2", "--harness", "claude-code", "--approval", APPROVAL, "--json"], { root }));
    assert.deepEqual([low.brief.model, low.brief.effort], ["light", "low"], "the brief stays harness-neutral");
    assert.deepEqual([low.translation.invocation.model, low.translation.invocation.effort], ["haiku", "low"]);
    assert.deepEqual([high.translation.invocation.model, high.translation.invocation.effort], ["opus", "high"]);

    const codex = orchestrate(["brief", "1.1", "--harness", "codex", "--approval", APPROVAL], { root });
    assert.equal(codex.status, 1);
    assert.match(codex.stderr, /Codex subagent has no map for model tier `light`/);
    assert.equal(codex.stdout, "");
  });

  it("honours the project's marker and refuses a malformed one before any brief", () => {
    const mapped = claimedPair(ADAPTIVE + "<!-- pathfinder:model-tiers codex light=gpt-5.2 standard=gpt-5.5 strong=gpt-6-astra -->\n");
    assert.equal(orchestrate(["claim", "1.1"], { root: mapped }).status, 0);
    const codex = json(orchestrate(["brief", "1.1", "--harness", "codex", "--approval", APPROVAL, "--json"], { root: mapped }));
    assert.deepEqual([codex.translation.invocation.arguments.model, codex.translation.invocation.arguments.reasoning_effort], ["gpt-5.2", "low"]);

    const broken = claimedPair(ADAPTIVE + "<!-- pathfinder:model-tiers claude-code light=haiku -->\n");
    assert.equal(orchestrate(["claim", "1.1"], { root: broken }).status, 0);
    const refused = orchestrate(["brief", "1.1", "--harness", "claude-code", "--approval", APPROVAL], { root: broken });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /malformed model-tiers marker/);
    assert.equal(refused.stdout, "");
  });

  it("asks the recorded policy for repair, from the recorded estimate", () => {
    const root = makeProject({ modeFile: ADAPTIVE, tickets: { "1.1": { title: "A" } } });
    assert.equal(orchestrate(["claim", "1.1"], { root }).status, 0);
    const worktree = join(root, ".pathfinder/worktrees/1.1");
    const path = join(worktree, "context/current-ticket.md");
    const gh = prGh(root);
    const head = runGit(["rev-parse", "HEAD"], worktree).trim();
    const PR = "https://github.com/acme/widgets/pull/7";
    const advance = () => assert.equal(orchestrate(["stage", "1.1", "--advance", "--json", "--gh", gh], { root }).status, 0);
    writeFileSync(path, updateStateText(readFileSync(path, "utf8"), { set: { State: "adversary", Review: "ordinary" } }));
    writeFileSync(path, replaceExperimentReport(readFileSync(path, "utf8"), { ticket: "1.1", pr: PR, head_sha: head, experiments: [{ experiment_id: "edge1", contract: "bounded input", hypothesis: "empty input may escape", setup: "scratch project", steps: ["submit empty input"], expected_result: "reject invalid input", observed_result: "invalid input accepted", evidence: ["cmd:node example"], reproducibility: "twice", potential_impact: "unexpected state could persist", verifier_instruction: "independently repeat" }] }));
    advance();
    writeFileSync(path, replaceFindingsReport(readFileSync(path, "utf8"), { ticket: "1.1", pr: PR, head_sha: head, result: "findings", findings: [{ severity: "high", location: "example.mjs:1", impact: "input escapes contract", evidence: ["cmd:node example"], repair_instruction: "reject this invalid input" }], verification: ["independent reproduction"], limits: "other inputs not explored" }));
    advance();
    const begun = orchestrate(["stage", "1.1", "--begin-repair", "--json", "--gh", gh], { root, cwd: worktree });
    assert.equal(begun.status, 0, begun.stderr);

    const repair = orchestrate(["brief", "1.1", "--session", "repair", "--harness", "claude-code", "--approval", APPROVAL, "--json", "--gh", gh], { root });
    assert.equal(repair.status, 0, repair.stderr);
    const result = json(repair);
    assert.deepEqual([result.brief.role, result.brief.model, result.brief.effort], ["developer", "standard", "medium"]);
    assert.deepEqual([result.translation.invocation.model, result.translation.invocation.effort], ["sonnet", "medium"]);
  });

  it("marks a derived risk provisional, and plans with --assess the selections the assessed claim dispatches", () => {
    const root = makeProject({ modeFile: ADAPTIVE, tickets: { "1.1": { title: "Low" } } });

    const derived = json(orchestrate(["plan", "--harness", "claude-code", "--json"], { root }));
    assert.equal(derived.dispatch[0].provisional, true);
    assert.deepEqual(derived.dispatch[0].sessions.implementation.translation, { ok: true, harness: "claude-code", model: "haiku", effort: "low" });
    assert.match(orchestrate(["plan", "--harness", "claude-code"], { root }).stdout, /^ {8}provisional: risk derived, not assessed/m);

    const assess = ["--assess", "1.1=high:touches permissions"];
    const assessed = json(orchestrate(["plan", "--harness", "claude-code", ...assess, "--json"], { root }));
    const [entry] = assessed.dispatch;
    assert.equal(entry.provisional, false);
    assert.deepEqual(entry.profile.estimate.risk, { value: "high", source: "assessed", reason: "touches permissions" });
    assert.doesNotMatch(orchestrate(["plan", "--harness", "claude-code", ...assess], { root }).stdout, /provisional/);

    // The claim records the same assessment, and the brief dispatches exactly
    // what the assessed plan showed.
    assert.equal(orchestrate(["claim", "1.1", "--risk", "high", "--reason", "touches permissions"], { root }).status, 0);
    const briefed = json(orchestrate(["brief", "1.1", "--harness", "claude-code", "--approval", APPROVAL, "--json"], { root }));
    const shown = entry.sessions.implementation;
    assert.deepEqual([briefed.brief.model, briefed.brief.effort], [shown.model, shown.effort]);
    assert.deepEqual([briefed.translation.invocation.model, briefed.translation.invocation.effort], [shown.translation.model, shown.translation.effort]);
    assert.deepEqual([shown.translation.model, shown.translation.effort], ["opus", "high"]);
  });

  it("refuses a malformed, duplicate, or out-of-scope --assess", () => {
    const root = makeProject({ modeFile: ADAPTIVE, tickets: { "1.1": { title: "Low" } } });
    for (const bad of [["1.1=high"], ["1.1=extreme:x"], ["1.1=high:  "], ["nope=high:x"], ["1.1=high:a", "1.1=low:b"]]) {
      const result = orchestrate(["plan", ...bad.flatMap((value) => ["--assess", value])], { root });
      assert.equal(result.status, 2, bad.join(" "));
      assert.match(result.stderr, /--assess/);
    }
    const outside = orchestrate(["plan", "--assess", "9.9=high:x"], { root });
    assert.equal(outside.status, 1);
    assert.match(outside.stderr, /--assess names 9\.9, which is not a ticket in the whole board/);
  });

  it("keeps static at inherited for every planned session, with no override on any harness", () => {
    const root = makeProject({ tickets: { "1.1": { title: "A" } } });
    for (const harness of ["claude-code", "codex", "manual"]) {
      const planned = json(orchestrate(["plan", "--harness", harness, "--json"], { root }));
      assert.equal(planned.dispatch[0].provisional, false, "static reads no risk, so nothing is provisional");
      assert.doesNotMatch(orchestrate(["plan", "--harness", harness], { root }).stdout, /provisional/);
      for (const session of SESSIONS) {
        assert.deepEqual(planned.dispatch[0].sessions[session], {
          role: ROLES[session], model: "inherited", effort: "inherited",
          translation: { ok: true, harness, model: "inherited", effort: "inherited" },
        });
      }
    }
    assert.equal(orchestrate(["claim", "1.1"], { root }).status, 0);
    for (const harness of ["claude-code", "manual"]) {
      const result = json(orchestrate(["brief", "1.1", "--harness", harness, "--approval", APPROVAL, "--json"], { root }));
      assert.deepEqual(Object.keys(result.translation.invocation).sort(), ["prompt", "role"]);
    }
  });
});
