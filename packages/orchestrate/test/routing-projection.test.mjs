import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareRouting, validateRoutingProjection } from "../../../skills/orchestrate/engine/routing-projection.mjs";
import { validatePreparation } from "../../../skills/orchestrate/engine/routing-contract.mjs";

const identity = { ticket: "57.2", pr: "https://github.com/example/project/pull/8", head_sha: "a".repeat(40) };
const workflow = { identity_current: true, evidence_current: true, checkpoints_complete: true, ownership_valid: true,
  human_boundary: true, unresolved_concern: true, live_worker: false, failed_without_guidance: false,
  confirmed_tester_findings: false, missing_required_reports: false, known_concern: false };
function fixture() {
  return {
    identity: { ...identity }, workflow: { ...workflow },
    concern: { source: "coordinator:concern:1", original: "Check file:src/input.mjs against PR https://example.org/pull/8", summary: "The empty input boundary needs additional evidence." },
    requirements: [{ source: "ticket:verification:1", original: "Run `node --test test/input.mjs`", summary: "Empty input produces a useful error." }],
    findings: { ...identity, result: "PASS", findings: [], verification: ["cmd:node --test test/input.mjs; PASS; log:/private/result.log"], limits: "Not checked on another platform." },
    experiments: { ...identity, experiments: [{ experiment_id: "empty-1", contract: "Useful error on empty input", hypothesis: "Empty input may be accepted",
      setup: "Scratch project", steps: ["Invoke empty input"], expected_result: "Useful error", observed_result: "Useful error appeared",
      evidence: ["cmd:node probe.mjs", "file:src/input.mjs#L1"], reproducibility: "Repeated twice", potential_impact: "Unclear input feedback", verifier_instruction: "Repeat on current head" }] },
    evidence: [{ role: "tester", index: 1, action: "Exercised empty input.", observation: "A useful error appeared." },
      { role: "adversary", index: 1, action: "Repeated the empty input experiment.", observation: "The error was stable across both attempts." }],
  };
}
const refused = (value) => assert.deepEqual(value, { ok: false, recommendation: "human", reason: "Routing preparation requires complete, current, safely summarized local evidence." });
const stripSummaries = (input) => {
  delete input.concern.summary;
  input.requirements.forEach((r) => delete r.summary);
  input.evidence.forEach((e) => { delete e.action; delete e.observation; });
  return input;
};

test("ordinary reports prepare independently of Judge, without network or input mutation", () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const fetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network forbidden"); };
  try {
    const result = prepareRouting(input);
    assert.equal(result.ok, true);
    assert.equal(validatePreparation(result.preparation).ok, true);
    assert.equal(validateRoutingProjection(result.projection).ok, true);
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(prepareRouting(input), result);
    assert.equal(result.originals.evidence[0].record, input.findings.verification[0]);
    assert.deepEqual(result.originals.evidence[1].record, input.experiments.experiments[0]);
    assert.deepEqual(result.originals.evidence[0].report, input.findings);
    assert.equal(result.preparation.evidence[0].source, "tester:verification:1");
    assert.equal(result.preparation.evidence[1].source, "adversary:experiments:1");
    assert.deepEqual(result.projection.evidence.map((e) => e.id), ["e1", "e2"]);
    const out = JSON.stringify(result.projection);
    for (const raw of [identity.pr, identity.head_sha, "PASS", "cmd:", "file:", "log:", "--test", "coordinator:", "ticket:"]) assert.equal(out.includes(raw), false, raw);
    result.originals.evidence[0].report.result = "changed";
    assert.equal(JSON.stringify(input), before);
  } finally { globalThis.fetch = fetch; }
});

test("source digests bind exact original records including complete report identity", () => {
  const input = fixture();
  const result = prepareRouting(input);
  const sorted = (v) => Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
  const local = result.originals.evidence[0];
  const bytes = JSON.stringify(sorted({ identity: input.identity, source: local.source, original: { report: local.report, record: local.record } }));
  assert.equal(result.preparation.evidence[0].source_digest, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  assert.equal(result.preparation.requirements[0].summarized, true);
  input.requirements[0].original = input.requirements[0].summary;
  assert.equal(prepareRouting(input).preparation.requirements[0].summarized, false);
});

test("missing or invalid author summaries have no raw or model fallback", () => {
  const changes = [
    (x) => delete x.concern.summary, (x) => delete x.requirements[0].summary,
    (x) => delete x.evidence[0].action, (x) => delete x.evidence[1].observation,
    (x) => { x.evidence[0].action = ""; }, (x) => { x.concern.summary = "x".repeat(281); },
    (x) => { x.evidence[0].raw = "ignored extra"; }, (x) => { x.evidence[0].index = 9; },
    (x) => { x.evidence.push(x.evidence[0]); }, (x) => { x.evidence[0].role = "developer"; },
    (x) => { x.requirements.push(x.requirements[0]); }, (x) => { x.findings.head_sha = "b".repeat(40); },
    (x) => { x.experiments.head_sha = "b".repeat(40); }, (x) => { x.evidence[0].index = NaN; },
  ];
  for (const change of changes) { const input = fixture(); change(input); refused(prepareRouting(input)); }
  for (const key of Object.keys(workflow)) { const input = fixture(); input.workflow[key] = !input.workflow[key]; refused(prepareRouting(input)); }
});

test("whole-bundle restricted prose and credential screening cover every outbound text field", () => {
  const unsafe = ["cmd:node test.mjs", "node --test", "file:src/main.mjs", "https://example.org/pull/8", "PASS", "fail", identity.head_sha, "secret=hidden", "First line\nlog line", "ghp_" + "A".repeat(36)];
  const setters = [ (x, s) => x.concern.summary = s, (x, s) => x.requirements[0].summary = s,
    (x, s) => x.evidence[0].action = s, (x, s) => x.evidence[1].observation = s ];
  for (const text of unsafe) for (const set of setters) { const input = fixture(); set(input, text); refused(prepareRouting(input)); }
  const cross = fixture(); cross.concern.summary = "The access token was inspected."; cross.requirements[0].summary = "A1b2C3 was observed.";
  refused(prepareRouting(cross));
  const known = fixture(); known.concern.summary = "The empty input boundary needs additional evidence.";
  refused(prepareRouting(known, { secrets: ["boundary"] }));
  const split = fixture(); split.concern.summary = "alpha"; split.requirements[0].summary = "bravo";
  refused(prepareRouting(split, { secrets: ["alphabravo"] }));
  const fragments = fixture(); fragments.concern.summary = "AKIAIOSFOD"; fragments.requirements[0].summary = "NN7EXAMPLE";
  refused(prepareRouting(fragments));
});

test("strict whole outbound shape rejects local bindings, IDs, roles and authority extras", () => {
  const p = prepareRouting(fixture()).projection;
  for (const modify of [
    (x) => x.head_sha = identity.head_sha, (x) => x.dispatch = true,
    (x) => x.evidence[0].source = "file:report", (x) => x.requirements[0].id = "r2",
    (x) => x.evidence[1].id = "e1", (x) => x.evidence[0].role = "developer",
    (x) => x.evidence[0].next_state = "done", (x) => x.requirements = [],
  ]) { const value = structuredClone(p); modify(value); assert.equal(validateRoutingProjection(value).ok, false); }
});

test("valid prepared summaries reuse only with exact current provenance and workflow", () => {
  const previous = prepareRouting(fixture()).preparation;
  assert.deepEqual(prepareRouting(stripSummaries(fixture()), { previous }).preparation, previous);
  for (const modify of [
    (x) => x.concern.original += " Changed", (x) => x.requirements[0].original += " Changed",
    (x) => x.findings.limits += " Changed", (x) => x.findings.verification[0] += " Changed",
    (x) => x.experiments.experiments[0].steps.push("Another step"),
    (x) => x.evidence.reverse(), (x) => x.evidence.pop(),
    (x) => { x.identity.head_sha = x.findings.head_sha = x.experiments.head_sha = "b".repeat(40); },
  ]) { const input = stripSummaries(fixture()); modify(input); refused(prepareRouting(input, { previous })); }
  const forged = structuredClone(previous); forged.evidence[0].source_digest = "sha256:" + "0".repeat(64);
  refused(prepareRouting(stripSummaries(fixture()), { previous: forged }));
  const unsafe = structuredClone(previous); unsafe.evidence[0].action = "PASS";
  refused(prepareRouting(stripSummaries(fixture()), { previous: unsafe }));
});

test("current report projections may supply author summaries without enabling Evidence Judge", () => {
  const input = fixture();
  input.findings.judge = { verification: [{ action_summary: input.evidence[0].action, observation_summary: input.evidence[0].observation }], limits_summary: "Only empty input was checked." };
  input.experiments.experiments[0].judge = { contract_attacked: "Empty input produces a useful error.", action_summary: input.evidence[1].action, observation_summary: input.evidence[1].observation, expected_result: "A useful error appears." };
  input.evidence.forEach((e) => { delete e.action; delete e.observation; });
  assert.equal(prepareRouting(input).ok, true);
  input.findings.judge.verification[0].action_summary = "PASS";
  refused(prepareRouting(input));
});

test("non-JSON inputs cannot execute getters or hide extra members", () => {
  const input = fixture();
  Object.defineProperty(input.concern, "summary", { enumerable: true, get() { throw new Error("getter called"); } });
  refused(prepareRouting(input));
  const other = fixture(); other.evidence.extra = "authority"; refused(prepareRouting(other));
  const cyclic = fixture(); cyclic.loop = cyclic; refused(prepareRouting(cyclic));
  const symbol = fixture(); symbol[Symbol("authority")] = true; refused(prepareRouting(symbol));
});

test("selection generates IDs independently of raw positions and retains the selected original", () => {
  const input = fixture();
  input.findings.verification.push("cmd:node secondary.mjs; log:/private/second.log");
  input.evidence = [{ role: "tester", index: 2, action: "Exercised a second input.", observation: "A useful error appeared." }];
  const output = prepareRouting(input);
  assert.equal(output.ok, true);
  assert.equal(output.projection.evidence[0].id, "e1");
  assert.equal(output.preparation.evidence[0].source, "tester:verification:2");
  assert.equal(output.originals.evidence[0].record, input.findings.verification[1]);
  assert.equal(output.originals.evidence[0].report.verification[0], input.findings.verification[0]);
});

test("a contradictory findings report cannot be presented as eligible by boolean facts", () => {
  const input = fixture();
  input.findings.result = "findings";
  input.findings.findings = [{ severity: "high", location: "file:src/input.mjs", impact: "Empty input is accepted", evidence: ["cmd:node probe.mjs"], repair_instruction: "Check the empty input case" }];
  refused(prepareRouting(input));
});
