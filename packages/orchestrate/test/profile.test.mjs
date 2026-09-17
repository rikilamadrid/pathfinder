/**
 * The routing seam: estimate → select → dispatch.
 *
 * Four claims are defended. The profile schema is closed. The estimate is a
 * deterministic count over the ticket body at documented thresholds. The
 * policy is chosen by one marker and found by file name, so adding a policy
 * changes no other engine code — proven here by adding one to a copy of the
 * engine. And a brief's model and effort reach a harness exactly or are
 * refused by name, never dropped and never rewritten.
 */

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { after, describe, it } from "node:test";

import { buildBrief, formatBrief, translateBrief } from "../../../skills/orchestrate/engine/brief.mjs";
import {
  THRESHOLDS,
  contextPaths,
  countChanges,
  deriveRisk,
  estimateTicket,
  parallelSafety,
  relevantAreas,
} from "../../../skills/orchestrate/engine/estimate.mjs";
import { PROFILE_SCHEMA, parseProfile, renderProfile, validateProfile } from "../../../skills/orchestrate/engine/profile.mjs";
import { loadPolicy, runPolicy, shippedPolicies } from "../../../skills/orchestrate/engine/policies/registry.mjs";
import {
  ENGINE_ROOT,
  cleanUpTemporaryDirectories,
  gitEnv,
  json,
  makeProject,
  orchestrate,
  temporaryDirectory,
} from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

const NOW = "2026-09-17T12:00:00.000Z";

/** A ticket body with `changes` bullets, `paths` Context paths, and a Relevant area. */
function body({ changes = 1, paths = 1, area = ["src/a"] } = {}) {
  const context = Array.from({ length: paths }, (_, index) => `- Read: \`docs/file-${index}.md\``);
  context.push(`- Relevant area: ${area.map((path) => `\`${path}\``).join(", ")}`);
  const distinct = new Set([...Array.from({ length: paths }, (_, index) => `docs/file-${index}.md`), ...area]);
  // The Relevant area line names paths too; `paths` counts the Read lines, and
  // the estimate counts every distinct path, so report what it will see.
  return {
    text: [
      "# T",
      "",
      "## Status",
      "",
      "Proposed",
      "",
      "## Blocked by",
      "",
      "None",
      "",
      "## Context",
      "",
      ...context,
      "",
      "## Changes",
      "",
      ...Array.from({ length: changes }, (_, index) => `- change ${index}\n  - a sub-point that is not a change`),
      "",
      "## Verification",
      "",
      "- it works",
      "",
    ].join("\n"),
    distinctPaths: distinct.size,
  };
}

function validProfile(overrides = {}) {
  return {
    schema: PROFILE_SCHEMA,
    ticket: "1.1",
    estimate: {
      complexity: { value: "low", source: "derived", reason: "1 bullet under ## Changes" },
      context: { value: "small", source: "derived", reason: "2 paths named under ## Context" },
      "parallel-safety": { value: "isolated", source: "derived", reason: "no other ticket is in flight" },
      risk: { value: "low", source: "derived", reason: "low complexity, small context, isolated" },
    },
    selection: { policy: "static", role: "developer", model: "inherited", effort: "inherited" },
    ...overrides,
  };
}

describe("the profile schema", () => {
  it("accepts a complete profile and round-trips it through YAML byte for byte", () => {
    const profile = validProfile();
    assert.deepEqual(validateProfile(profile), { ok: true });
    const yaml = renderProfile(profile);
    assert.equal(yaml, renderProfile(profile));
    const parsed = parseProfile(yaml);
    assert.equal(parsed.ok, true, JSON.stringify(parsed));
    assert.deepEqual(parsed.profile, profile);
    assert.match(yaml, /^schema: pathfinder\.execution-profile\/1\nticket: "1\.1"\nestimate:\n  complexity:\n    value: low\n/);
  });

  it("refuses an unknown field anywhere", () => {
    for (const mutate of [
      (p) => (p.extra = 1),
      (p) => (p.estimate.cost = { value: "low", source: "derived" }),
      (p) => (p.estimate.complexity.basis = "x"),
      (p) => (p.selection.temperature = "high"),
    ]) {
      const profile = validProfile();
      mutate(profile);
      const result = validateProfile(profile);
      assert.equal(result.ok, false);
      assert.match(result.errors.join(" "), /unknown field/);
    }
  });

  it("refuses an unknown value, a missing field, and a wrong schema version", () => {
    const badValue = validProfile();
    badValue.estimate.complexity.value = "enormous";
    assert.match(validateProfile(badValue).errors.join(" "), /complexity\.value `enormous` is not one of low, medium, high/);

    const missing = validProfile();
    delete missing.estimate.risk;
    assert.match(validateProfile(missing).errors.join(" "), /estimate\.risk is missing/);

    assert.match(validateProfile(validProfile({ schema: "pathfinder.execution-profile/2" })).errors.join(" "), /schema must be/);
    assert.match(validateProfile(validProfile({ ticket: "one" })).errors.join(" "), /ticket must be a key/);

    const upper = validProfile();
    upper.selection.model = "Claude Opus";
    assert.match(validateProfile(upper).errors.join(" "), /selection\.model must be a lower-case name/);
  });

  it("allows only risk to be assessed, and only with a reason", () => {
    const assessedComplexity = validProfile();
    assessedComplexity.estimate.complexity.source = "assessed";
    assert.match(validateProfile(assessedComplexity).errors.join(" "), /always derived; only risk may be assessed/);

    const noReason = validProfile();
    noReason.estimate.risk = { value: "high", source: "assessed" };
    assert.match(validateProfile(noReason).errors.join(" "), /assessed and must carry a reason/);

    const assessedUnknown = validProfile();
    assessedUnknown.estimate.risk = { value: "unassessed", source: "assessed", reason: "x" };
    assert.match(validateProfile(assessedUnknown).errors.join(" "), /never an assessment/);
  });

  it("refuses YAML it did not write", () => {
    assert.equal(parseProfile("schema: x\nsurprise: yes\n").ok, false);
    assert.equal(parseProfile(renderProfile(validProfile()).replace("  role: developer", "  role: Developer")).ok, false);
  });
});

describe("the estimate", () => {
  it("counts top-level Changes bullets only, and distinct Context paths", () => {
    const { text } = body({ changes: 4, paths: 3, area: ["src/a/", "src/a"] });
    assert.equal(countChanges(text), 4, "sub-points are part of their change");
    assert.deepEqual(contextPaths(text), ["docs/file-0.md", "docs/file-1.md", "docs/file-2.md", "src/a"]);
    assert.deepEqual(relevantAreas(text), ["src/a"]);
  });

  it("puts complexity at its documented thresholds", () => {
    const at = (changes) => estimateTicket({ key: "1.1", body: body({ changes }).text }).estimate.complexity;
    assert.equal(THRESHOLDS.complexity.low, 3);
    assert.equal(THRESHOLDS.complexity.medium, 7);
    assert.equal(at(0).value, "low");
    assert.equal(at(3).value, "low");
    assert.equal(at(4).value, "medium");
    assert.equal(at(7).value, "medium");
    assert.equal(at(8).value, "high");
    assert.equal(at(4).reason, "4 bullets under ## Changes");
    assert.equal(at(1).reason, "1 bullet under ## Changes");
  });

  it("puts context at its documented thresholds", () => {
    const at = (paths) => {
      // One Relevant area path is always present, so `paths - 1` Read lines give `paths` distinct paths.
      const { text, distinctPaths } = body({ paths: paths - 1, area: ["src/area"] });
      assert.equal(distinctPaths, paths);
      return estimateTicket({ key: "1.1", body: text }).estimate.context;
    };
    assert.equal(THRESHOLDS.context.small, 3);
    assert.equal(THRESHOLDS.context.medium, 8);
    assert.equal(at(3).value, "small");
    assert.equal(at(4).value, "medium");
    assert.equal(at(8).value, "medium");
    assert.equal(at(9).value, "large");
  });

  it("derives parallel safety from Relevant area overlap with in-flight tickets", () => {
    const mine = { key: "1.1", body: body({ area: ["skills/orchestrate/engine", "README.md"] }).text };
    const other = (key, area) => ({ key, body: body({ area }).text });

    assert.equal(parallelSafety(mine, []).value, "isolated");
    assert.equal(parallelSafety(mine, [other("1.2", ["site/src"])]).value, "isolated");

    const sharedDirectory = parallelSafety(mine, [other("1.2", ["skills/orchestrate/engine/store.mjs"])]);
    assert.equal(sharedDirectory.value, "shared-surface");
    assert.match(sharedDirectory.reason, /skills\/orchestrate\/engine overlaps skills\/orchestrate\/engine\/store\.mjs in 1\.2/);

    const sameDirectory = parallelSafety(mine, [other("1.2", ["skills/orchestrate/engine/"])]);
    assert.equal(sameDirectory.value, "shared-surface");

    const sameFile = parallelSafety(mine, [other("1.2", ["site/src"]), other("1.3", ["README.md"])]);
    assert.equal(sameFile.value, "serialize");
    assert.equal(sameFile.reason, "names README.md, which 1.3 also names");

    assert.equal(parallelSafety(mine, [mine]).value, "isolated", "a ticket does not overlap itself");
    const noArea = { key: "1.4", body: "## Context\n\n- Read: `x/y.md`\n" };
    assert.equal(parallelSafety(noArea, [other("1.2", ["x"])]).reason, "the ticket names no Relevant area");
  });

  it("derives risk only by its two documented rules", () => {
    assert.equal(deriveRisk("low", "small", "isolated").value, "low");
    assert.equal(deriveRisk("high", "large", "serialize").value, "high");
    for (const [c, x, p] of [["low", "small", "shared-surface"], ["medium", "small", "isolated"], ["high", "medium", "isolated"]]) {
      const risk = deriveRisk(c, x, p);
      assert.equal(risk.value, "unassessed", `${c} ${x} ${p}`);
      assert.equal(risk.source, "derived");
    }
  });

  it("records an assessed risk with its reason, and never as derived", () => {
    const ticket = { key: "1.1", body: body({ changes: 5 }).text };
    const assessed = estimateTicket(ticket, [], { risk: "high", reason: "touches the release path" });
    assert.deepEqual(assessed.estimate.risk, { value: "high", source: "assessed", reason: "touches the release path" });
    assert.equal(assessed.estimate.complexity.source, "derived", "only risk is assessed");

    assert.match(estimateTicket(ticket, [], { risk: "high" }).message, /needs both --risk and a non-empty --reason/);
    assert.match(estimateTicket(ticket, [], { reason: "why" }).message, /needs both/);
    assert.match(estimateTicket(ticket, [], { risk: "unassessed", reason: "x" }).message, /must be low, medium, or high/);
  });
});

describe("the routing policy", () => {
  it("ships static alone, and static selects developer, tester, inherited, inherited", async () => {
    assert.deepEqual(shippedPolicies(), ["static"]);
    const policy = await loadPolicy("static");
    assert.equal(policy.ok, true);
    const estimate = validProfile().estimate;
    assert.deepEqual(runPolicy(policy, estimate, { session: "implementation" }).selection, {
      policy: "static",
      role: "developer",
      model: "inherited",
      effort: "inherited",
    });
    assert.equal(runPolicy(policy, estimate, { session: "review" }).selection.role, "tester");
    assert.match(runPolicy(policy, estimate, { session: "deploy" }).message, /session must be implementation or review/);
  });

  it("refuses a policy the engine does not ship, naming the shipped ones", async () => {
    const result = await loadPolicy("victoria");
    assert.equal(result.ok, false);
    assert.equal(result.message, "routing policy `victoria` is not shipped with this engine. Shipped: static");
  });

  it("is static when the mode file names none, and refuses a claim when it names an unshipped one", () => {
    const tickets = { "1.1": { title: "Alpha" } };
    const plain = makeProject({ tickets });
    const profile = parseProfile(orchestrate(["estimate", "1.1"], { root: plain }).stdout);
    assert.equal(profile.ok, true);
    assert.equal(profile.profile.selection.policy, "static");

    const named = makeProject({
      tickets,
      modeFile: "# Execution Mode\n\n<!-- pathfinder:execution-mode orchestrator -->\n<!-- pathfinder:routing-policy static -->\n",
    });
    assert.equal(parseProfile(orchestrate(["estimate", "1.1"], { root: named }).stdout).profile.selection.policy, "static");

    const unshipped = makeProject({
      tickets,
      modeFile: "# Execution Mode\n\n<!-- pathfinder:execution-mode orchestrator -->\n<!-- pathfinder:routing-policy victoria -->\n",
    });
    const refused = orchestrate(["claim", "1.1"], { root: unshipped });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /routing policy `victoria` is not shipped with this engine\. Shipped: static/);
    assert.equal(orchestrate(["owner", "1.1", "--json"], { root: unshipped }).stdout.includes('"claim": null'), true, "nothing was claimed");
  });
});

describe("the estimate and claim commands", () => {
  function project() {
    return makeProject({
      tickets: { "1.1": { title: "Alpha" }, "1.2": { title: "Beta", status: "Ready" } },
    });
  }

  it("prints identical YAML twice, and a validated profile", () => {
    const root = project();
    const first = orchestrate(["estimate", "1.1"], { root });
    const second = orchestrate(["estimate", "1.1"], { root, env: { TZ: "Pacific/Kiritimati", LANG: "tr_TR.UTF-8" } });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, second.stdout);
    assert.equal(parseProfile(first.stdout).ok, true);
    assert.deepEqual(validateProfile(json(orchestrate(["estimate", "1.1", "--json"], { root }))), { ok: true });
  });

  it("records an assessed risk from the command line", () => {
    const root = project();
    const result = orchestrate(["estimate", "1.1", "--risk", "high", "--reason", "touches the release path"], { root });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /  risk:\n    value: high\n    source: assessed\n    reason: "touches the release path"\n/);
  });

  it("persists the profile in the claim's state file, and status shows the role", () => {
    const root = project();
    assert.equal(orchestrate(["claim", "1.1", "--now", NOW], { root }).status, 0);

    const state = readFileSync(join(root, ".pathfinder", "worktrees", "1.1", "context", "current-ticket.md"), "utf8");
    const block = /## Execution\n\n```yaml\n([\s\S]*?)```\n/.exec(state);
    assert.ok(block, "the state file carries a fenced Execution profile");
    const parsed = parseProfile(block[1]);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.profile.ticket, "1.1");
    assert.equal(parsed.profile.selection.role, "developer");

    const row = json(orchestrate(["status", "--json", "--live", "1.1"], { root })).rows.find((entry) => entry.key === "1.1");
    assert.equal(row.worker, "1.1 developer");
  });

  it("estimates the second claim against the first one in flight", () => {
    const root = makeProject({
      tickets: { "1.1": { title: "Alpha" }, "1.2": { title: "Beta" } },
    });
    // Both tickets from the harness name no Relevant area, so the estimate
    // says so rather than inventing overlap.
    orchestrate(["claim", "1.1"], { root });
    const second = parseProfile(orchestrate(["estimate", "1.2"], { root }).stdout).profile;
    assert.equal(second.estimate["parallel-safety"].reason, "the ticket names no Relevant area");
  });
});

describe("the seam: adding a policy changes nothing else", () => {
  /**
   * The proof, on a copy of the engine so the shipped tree is never touched:
   * add one policy file, and every other engine file is byte-identical; board,
   * status, and an unmarked estimate print identical bytes; and only the
   * project whose mode file names the new policy gets its selection — through
   * claim, status, and a brief — with no code outside `policies/` edited.
   */
  function digestTree(root, skip = new Set()) {
    const out = {};
    const walk = (dir) => {
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        const rel = relative(root, path);
        if (skip.has(rel)) continue;
        if (statSync(path).isDirectory()) walk(path);
        else out[rel] = createHash("sha256").update(readFileSync(path)).digest("hex");
      }
    };
    walk(root);
    return out;
  }

  function engineCopy() {
    const home = temporaryDirectory("orchestrate-engine-copy-");
    const engine = join(home, "engine");
    cpSync(ENGINE_ROOT, engine, { recursive: true });
    return engine;
  }

  function run(engine, args, root) {
    const result = spawnSync(process.execPath, [join(engine, "bin", "orchestrate.mjs"), ...args], {
      cwd: root,
      env: gitEnv(),
      encoding: "utf8",
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  const DUMMY = [
    'export const description = "test-only: a routing policy the engine does not ship";',
    "export function select(estimate, { session }) {",
    '  if (session === "review") return { role: "tester", model: "sonnet", effort: "inherited" };',
    '  return { role: "developer", model: estimate.complexity.value === "low" ? "haiku" : "opus", effort: "high" };',
    "}",
    "",
  ].join("\n");

  it("leaves every other engine file, and every unmarked output, byte-identical", () => {
    const engine = engineCopy();
    const root = makeProject({ tickets: { "1.1": { title: "Alpha" }, "1.2": { title: "Beta", status: "Ready" } } });
    run(engine, ["claim", "1.1", "--now", NOW], root);

    const beforeFiles = digestTree(engine);
    const before = ["board", "status --live 1.1", "estimate 1.2"].map((args) => run(engine, args.split(" "), root));

    writeFileSync(join(engine, "policies", "dummy.mjs"), DUMMY);

    const afterFiles = digestTree(engine, new Set([join("policies", "dummy.mjs")]));
    assert.deepEqual(afterFiles, beforeFiles, "no engine file other than the new policy changed");

    const after = ["board", "status --live 1.1", "estimate 1.2"].map((args) => run(engine, args.split(" "), root));
    for (let index = 0; index < before.length; index += 1) {
      assert.equal(after[index].status, 0, after[index].stderr);
      assert.equal(after[index].stdout, before[index].stdout, "unmarked output is byte-identical");
    }
  });

  it("routes a project that names the new policy through claim, status, and brief", () => {
    const engine = engineCopy();
    writeFileSync(join(engine, "policies", "dummy.mjs"), DUMMY);
    const root = makeProject({
      tickets: { "1.1": { title: "Alpha" } },
      modeFile: "# Execution Mode\n\n<!-- pathfinder:execution-mode orchestrator -->\n<!-- pathfinder:routing-policy dummy -->\n",
    });

    const claimed = run(engine, ["claim", "1.1", "--now", NOW, "--json"], root);
    assert.equal(claimed.status, 0, claimed.stderr);
    assert.deepEqual(JSON.parse(claimed.stdout).profile.selection, {
      policy: "dummy",
      role: "developer",
      model: "haiku",
      effort: "high",
    });

    const row = JSON.parse(run(engine, ["status", "--json", "--live", "1.1"], root).stdout).rows[0];
    assert.equal(row.worker, "1.1 developer");

    const manual = JSON.parse(run(engine, ["brief", "1.1", "--harness", "manual", "--json"], root).stdout);
    assert.deepEqual(
      { model: manual.brief.model, effort: manual.brief.effort, invocation: manual.translation.invocation.effort },
      { model: "haiku", effort: "high", invocation: "high" },
    );

    const claude = run(engine, ["brief", "1.1", "--harness", "claude-code"], root);
    assert.equal(claude.status, 1, "Claude Code subagents take no effort, so effort: high is refused");
    assert.match(claude.stderr, /cannot honour effort `high`: the subagent call takes no reasoning-effort setting/);

    const review = JSON.parse(run(engine, ["brief", "1.1", "--harness", "manual", "--session", "review", "--json"], root).stdout);
    assert.deepEqual(
      { role: review.brief.role, model: review.brief.model, session: review.brief.session },
      { role: "tester", model: "sonnet", session: "review" },
    );
  });
});

const BRIEF_BASE = {
  ticket: "1.1",
  title: "Alpha",
  ref: "#11",
  worktree: "/work/project/.pathfinder/worktrees/1.1",
  main: "/work/project",
  branch: "ticket/1.1-alpha",
  approval: "execution of Feature 1's tickets; no merges",
};

describe("the brief and its translation", () => {
  const base = {
    ticket: "1.1",
    title: "Alpha",
    ref: "#11",
    worktree: "/work/project/.pathfinder/worktrees/1.1",
    main: "/work/project",
    branch: "ticket/1.1-alpha",
    approval: "execution of Feature 1's tickets; no merges",
  };
  const brief = (selection) => buildBrief({ ...base, selection }).brief;

  it("carries role, model, and effort as first-class fields, inherited included", () => {
    const built = brief({ role: "developer", model: "inherited", effort: "inherited" });
    for (const field of ["role", "model", "effort"]) assert.ok(Object.hasOwn(built, field), field);
    assert.equal(built.model, "inherited");
    const text = formatBrief(built);
    assert.match(text, /^Role: {6}developer$/m);
    assert.match(text, /^Model: {5}inherited$/m);
    assert.match(text, /^Effort: {4}inherited$/m);
    assert.match(text, /Run \/ticket load 1\.1, then \/ticket start/);
    assert.equal(formatBrief(built), text, "same brief, same bytes");
  });

  it("refuses a brief missing a field rather than defaulting it", () => {
    const missingModel = buildBrief({ ...base, selection: { role: "developer", effort: "inherited" } });
    assert.equal(missingModel.ok, false);
    assert.match(missingModel.message, /a brief needs model/);
    assert.match(buildBrief({ ...base, approval: "", selection: { role: "developer", model: "inherited", effort: "inherited" } }).message, /approval/);
  });

  it("passes nothing to Claude Code for inherited, and an alias as a model override", () => {
    const inherited = translateBrief(brief({ role: "developer", model: "inherited", effort: "inherited" }), "claude-code");
    assert.equal(inherited.ok, true);
    assert.equal(Object.hasOwn(inherited.invocation, "model"), false, "inherited sends no override");
    assert.equal(Object.hasOwn(inherited.invocation, "effort"), false);

    const alias = translateBrief(brief({ role: "developer", model: "opus", effort: "inherited" }), "claude-code");
    assert.equal(alias.ok, true);
    assert.equal(alias.invocation.model, "opus");
  });

  it("refuses a pinned model ID for Claude Code instead of rewriting it to an alias", () => {
    const pinned = translateBrief(brief({ role: "developer", model: "claude-opus-5", effort: "inherited" }), "claude-code");
    assert.equal(pinned.ok, false);
    assert.match(pinned.message, /cannot honour model `claude-opus-5`: it takes a family alias \(opus, sonnet, haiku, fable\), not a pinned model ID/);
  });

  it("refuses an effort Claude Code cannot honour, by name", () => {
    const effort = translateBrief(brief({ role: "developer", model: "inherited", effort: "high" }), "claude-code");
    assert.equal(effort.ok, false);
    assert.match(effort.message, /cannot honour effort `high`/);
  });

  it("gives a manually started session every value, and refuses an unknown harness", () => {
    const manual = translateBrief(brief({ role: "developer", model: "claude-opus-5", effort: "high" }), "manual");
    assert.equal(manual.ok, true);
    assert.deepEqual([manual.invocation.model, manual.invocation.effort], ["claude-opus-5", "high"]);
    assert.match(translateBrief(brief({ role: "developer", model: "inherited", effort: "inherited" }), "cursor").message, /no translation for harness `cursor`/);
  });
});

describe("repairs from the 53.7 review", () => {
  it("gives a policy a deep-frozen copy, so it cannot rewrite the estimate or fake an assessment", async () => {
    const { mkdtempSync, writeFileSync: write, cpSync: copy } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const engine = join(mkdtempSync(join(tmpdir(), "orchestrate-mutating-")), "engine");
    copy(ENGINE_ROOT, engine, { recursive: true });
    write(
      join(engine, "policies", "forger.mjs"),
      [
        "export function select(estimate) {",
        '  estimate.risk.value = "high"; estimate.risk.source = "assessed"; estimate.risk.reason = "policy says";',
        '  return { role: "developer", model: "inherited", effort: "inherited" };',
        "}",
        "",
      ].join("\n"),
    );
    const { loadPolicy: load, runPolicy: runIt } = await import(join(engine, "policies", "registry.mjs"));
    const estimate = estimateTicket({ key: "1.1", body: body({ changes: 5 }).text }).estimate;
    const before = JSON.stringify(estimate);

    const result = runIt(await load("forger"), estimate, { session: "implementation" });

    assert.equal(result.ok, false, "a policy that writes to the estimate is refused");
    assert.match(result.message, /routing policy `forger` failed: Cannot assign to read only property/);
    assert.equal(JSON.stringify(estimate), before, "the engine's estimate is untouched");
  });

  it("refuses a policy whose select is asynchronous, and does not list helpers or tests as policies", async () => {
    const { mkdtempSync, writeFileSync: write, cpSync: copy } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const engine = join(mkdtempSync(join(tmpdir(), "orchestrate-async-")), "engine");
    copy(ENGINE_ROOT, engine, { recursive: true });
    write(join(engine, "policies", "later.mjs"), 'export async function select() { return { role: "developer", model: "inherited", effort: "inherited" }; }\n');
    write(join(engine, "policies", "_shared.mjs"), "export const x = 1;\n");
    write(join(engine, "policies", "later.test.mjs"), "export const y = 1;\n");
    const registry = await import(join(engine, "policies", "registry.mjs"));

    assert.deepEqual(registry.shippedPolicies(), ["later", "static"]);
    const result = registry.runPolicy(await registry.loadPolicy("later"), validProfile().estimate, { session: "implementation" });
    assert.match(result.message, /returned a promise; select must return its choice synchronously/);
  });

  it("gives a review brief review steps, never implementation ones", () => {
    const review = buildBrief({ ...BRIEF_BASE, session: "review", selection: { role: "tester", model: "inherited", effort: "inherited" } }).brief;
    const text = formatBrief(review);
    assert.match(text, /run \/ticket review as the role named above/);
    assert.match(text, /Change no implementation, commit nothing, and push nothing/);
    assert.doesNotMatch(text, /\/ticket start/);
    assert.doesNotMatch(text, /draft pull request/);

    const implementation = formatBrief(buildBrief({ ...BRIEF_BASE, selection: { role: "developer", model: "inherited", effort: "inherited" } }).brief);
    assert.match(implementation, /\/ticket load 1\.1, then \/ticket start/);
    assert.match(buildBrief({ ...BRIEF_BASE, session: "deploy", selection: { role: "developer", model: "inherited", effort: "inherited" } }).message, /session must be implementation, resume, review/);
  });

  it("reads the ticket shapes the estimate previously missed", () => {
    const text = [
      "## Context",
      "",
      "- Read: `./src/app.mjs`, `src/{a,b}.mjs`, `packages/*/test/`, `**/*.md`",
      "- Not paths: `53.2`, `v1.2.3`, `pathfinder.execution-profile/1`, `https://example.com/x`",
      "- Also a dot-directory: `.github/workflows/validate.yml`",
      "- Relevant area:",
      "  - `src/app.mjs`",
      "  - `lib/`",
      "",
      "## Changes",
      "",
      "1. numbered",
      "2) numbered too",
      "+ plus",
      "   - nested, not counted",
      "",
    ].join("\n");
    assert.equal(countChanges(text), 3);
    assert.deepEqual(contextPaths(text), [".github/workflows/validate.yml", "lib", "packages", "src/a.mjs", "src/app.mjs", "src/b.mjs"]);
    assert.deepEqual(relevantAreas(text), ["lib", "src/app.mjs"]);

    const other = { key: "1.2", body: "## Context\n\n- Relevant area: `src/app.mjs`\n" };
    assert.equal(parallelSafety({ key: "1.1", body: text }, [other]).value, "serialize", "./src/app.mjs and src/app.mjs are one file");
  });

  it("parses only the exact form it writes", () => {
    const yaml = renderProfile(validProfile());
    assert.equal(parseProfile(yaml).ok, true);
    assert.equal(parseProfile(yaml.replace(/\n$/, "")).ok, true, "a missing final newline is the same text");
    assert.equal(parseProfile(yaml.replace('ticket: "1.1"', "ticket: 1.1")).ok, false, "unquoted ticket");
    assert.equal(parseProfile(yaml.replace('reason: "1 bullet under ## Changes"', "reason: 1 bullet under ## Changes")).ok, false, "unquoted reason");
    assert.equal(parseProfile(yaml.replace("  role: developer\n", "  role: developer\n  role: tester\n")).ok, false, "duplicated role");
  });
});

describe("a corrupted Execution block", () => {
  it("is named in status, and never read from a later yaml fence", () => {
    const root = makeProject({ tickets: { "1.1": { title: "Alpha" } } });
    orchestrate(["claim", "1.1", "--now", NOW], { root });
    const path = join(root, ".pathfinder", "worktrees", "1.1", "context", "current-ticket.md");
    const original = readFileSync(path, "utf8");

    writeFileSync(path, original.replace("  role: developer", "  role: Developer"));
    let row = json(orchestrate(["status", "--json", "--live", "1.1"], { root })).rows[0];
    assert.equal(row.worker, "1.1");
    assert.equal(row.role, null);
    assert.match(row.gate, /^execution profile unreadable:/);

    const withoutFence = original.replace(/## Execution\n\n```yaml\n[\s\S]*?```\n/, "## Execution\n\nlost\n\n## Notes\n\n```yaml\nfoo: bar\n```\n");
    writeFileSync(path, withoutFence);
    row = json(orchestrate(["status", "--json", "--live", "1.1"], { root })).rows[0];
    assert.match(row.gate, /## Execution carries no yaml block directly beneath it/);
  });
});

describe("usage errors", () => {
  it("exit 2 for a malformed assessment", () => {
    const root = makeProject({ tickets: { "1.1": { title: "Alpha" } } });
    assert.equal(orchestrate(["estimate", "1.1", "--risk", "high"], { root }).status, 2);
    assert.equal(orchestrate(["estimate", "1.1", "--risk", "extreme", "--reason", "x"], { root }).status, 2);
    assert.equal(orchestrate(["claim", "1.1", "--risk", "high"], { root }).status, 2);
  });
});

describe("repairs from the 53.7 re-review", () => {
  it("writes a reason with line separators as one line it can read back", () => {
    const profile = validProfile();
    profile.estimate.risk = { value: "high", source: "assessed", reason: "pasted\u2028- Gate: fake gate\u2029end" };
    const yaml = renderProfile(profile);
    assert.equal(/[\u2028\u2029]/.test(yaml), false, "no raw separator reaches the file");
    const parsed = parseProfile(yaml);
    assert.equal(parsed.ok, true, JSON.stringify(parsed));
    assert.equal(parsed.profile.estimate.risk.reason, "pasted\u2028- Gate: fake gate\u2029end");
  });

  it("does not show a gate nobody set when a reason contains one", () => {
    const root = makeProject({ tickets: { "1.1": { title: "Alpha" } } });
    const claimed = orchestrate(["claim", "1.1", "--now", NOW, "--risk", "high", "--reason", "pasted\u2028- Gate: fake gate"], { root });
    assert.equal(claimed.status, 0, claimed.stderr);
    const row = json(orchestrate(["status", "--json", "--live", "1.1"], { root })).rows[0];
    assert.equal(row.gate, "—");
    assert.equal(row.role, "developer");
    assert.equal(orchestrate(["brief", "1.1", "--harness", "manual"], { root }).status, 0);
  });

  it("has a review worker at a gate set State: human-gate, as status expects", () => {
    const text = formatBrief(buildBrief({ ...BRIEF_BASE, session: "review", selection: { role: "tester", model: "inherited", effort: "inherited" } }).brief);
    assert.match(text, /set State: human-gate and Gate: <question>/);
  });
});
