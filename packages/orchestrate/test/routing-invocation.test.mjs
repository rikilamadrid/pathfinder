import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { prepareRoutingInvocation, authorizeRoutingInvocation, assessRoutingInvocation, routingCheckpointDigest } from "../../../skills/orchestrate/engine/routing-invocation.mjs";
import { checkpointDigest } from "../../../skills/orchestrate/engine/followup-record.mjs";
import { humanDirectedFollowup } from "../../../skills/orchestrate/engine/routing-followup.mjs";
import { readRoutingRecord } from "../../../skills/orchestrate/engine/routing-record.mjs";
import { replaceFindingsReport, readFindingsReport } from "../../../skills/orchestrate/engine/findings.mjs";
import { replaceExperimentReport } from "../../../skills/orchestrate/engine/experiments.mjs";
import { updateStateFile } from "../../../skills/orchestrate/engine/statefile.mjs";
import * as jev from "../../../skills/orchestrate/engine/routing-providers/jev.mjs";
import { cleanUpTemporaryDirectories, makeProject, orchestrate, prGh, runGit } from "../lib/harness.mjs";
after(cleanUpTemporaryDirectories);
const PR = "https://github.com/acme/widgets/pull/7";
const assessment = () => ({ schema: "pathfinder.routing-assessment/1", likely_route: "tester", confidence: 0.9, rationale: "missing_observation", evidence_refs: ["e1"], concern: "none" });
function setup() {
  const root = makeProject({ tickets: { "1.1": { title: "A", status: "Ready" } } });
  const ticketPath = join(root, "context/tickets/1.1-1-1.md");
  writeFileSync(ticketPath, readFileSync(ticketPath, "utf8") + "\n## Verification\n\n- Empty input is rejected.\n");
  assert.equal(orchestrate(["claim", "1.1"], { root }).status, 0);
  const worktree = join(root, ".pathfinder/worktrees/1.1"), path = join(worktree, "context/current-ticket.md"), gh = prGh(root);
  const sha = () => runGit(["rev-parse", "HEAD"], worktree).trim();
  const text = () => readFileSync(path, "utf8");
  const set = fields => assert.equal(updateStateFile(worktree, { set: fields }).ok, true);
  const findings = { ticket: "1.1", pr: PR, head_sha: sha(), result: "PASS", findings: [], verification: ["cmd:node independent-check.mjs"], limits: "One platform only." };
  const experiments = { ticket: "1.1", pr: PR, head_sha: sha(), experiments: [{ experiment_id: "edge1", contract: "bounded input", hypothesis: "empty input may escape", setup: "scratch project", steps: ["submit empty input"], expected_result: "reject invalid input", observed_result: "invalid input rejected", evidence: ["cmd:node example"], reproducibility: "twice", potential_impact: "unexpected state", verifier_instruction: "independently repeat" }] };
  set({ State: "review", Review: "ordinary" });
  writeFileSync(path, replaceFindingsReport(replaceExperimentReport(text(), experiments), findings));
  const config = value => writeFileSync(join(root, "context/routing-assessment.json"), JSON.stringify(value));
  const enabled = () => config({ schema: "pathfinder.routing-config/1", enabled: true, provider: "jev" });
  enabled();
  const request = { schema: "pathfinder.routing-request/1", ticket: "1.1", pr: PR, head_sha: sha(), checkpoint: routingCheckpointDigest(text()), concern: { id: "boundary-one", original: "Boundary repetition lacks an observation", summary: "Repeated boundary input needs more evidence.", risk: "none" }, requirements: [{ source: "verification:1", original: "Empty input is rejected.", summary: "Empty input is rejected." }], evidence: [{ role: "tester", index: 1, action: "Exercised empty input.", observation: "Input was rejected." }] };
  let live = [], calls = 0, reply = assessment(), during = async () => {};
  const env = { PATHFINDER_ROUTING_API_KEY: ["synthetic", "routing", "fixture"].join("_") };
  const options = { root, ticket: "1.1", invocation: "invocation-one", gh, readRequest: () => request, readLive: () => live, env };
  const prepare = () => prepareRoutingInvocation(options);
  const consent = () => ({ by: "human", capability: "routing-assessment", ticket: "1.1", concern: request.concern.id, provider: "jev", invocation: "invocation-one", fingerprint: prepare().fingerprint });
  const adapter = { ...jev, assess: async (projection, io) => { await io.fetch(jev.transport(io.env).url, { method: "POST", headers: jev.transport(io.env).headers, body: JSON.stringify(jev.buildRequest(projection)), redirect: "error", signal: io.signal }); return { model: jev.model, assessment: reply }; } };
  const fetch = async (url, init) => { calls++; assert.deepEqual(JSON.parse(init.body).state, prepare().projection); assert.doesNotMatch(init.body, /cmd:|head_sha|github|PATHFINDER|synthetic/); await during(); return {}; };
  const assess = (overrides = {}) => assessRoutingInvocation({ ...options, consent: consent(), ...overrides }, { adapter, fetch });
  const init = () => authorizeRoutingInvocation({ ...options, authorization: { by: "human", ticket: "1.1", kind: "initialize", direction: "Authorize two assessments, not external calls" } });
  const record = () => readRoutingRecord(text()).record;
  return { adapter, fetch, root, worktree, path, gh, sha, text, set, findings, experiments, config, enabled, request, options, prepare, consent, assess, init, record, ticketPath, calls: () => calls, live: value => { live = value; }, reply: value => { reply = value; }, during: value => { during = value; } };
}

test("routing enabled and Judge disabled: preparation, separate budget/consent, guarded assessment, presentation and cache", async () => {
  const s = setup(), original = s.text();
  const prepared = s.prepare(); assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.equal(prepared.preparation.schema, "pathfinder.routing-preparation/1"); assert.equal(s.text(), original);
  assert.equal(s.init().ok, true); assert.equal(s.calls(), 0);
  const before = routingCheckpointDigest(s.text());
  const first = await s.assess(); assert.equal(first.ok, true, JSON.stringify(first)); assert.equal(first.recommendation, "tester");
  assert.equal(first.rationale, "missing_observation"); assert.equal(first.confidence, .9); assert.equal(first.provisional_threshold, .8);
  assert.equal(first.requires_human_direction, true); assert.match(first.human_direction, /Pending/); assert.equal(first.cache, "assessment");
  assert.equal(s.calls(), 1); assert.equal(routingCheckpointDigest(s.text()), before);
  assert.equal(s.record().attempts.length, 1);
  const cached = await s.assess(); assert.equal(cached.cache, "cache"); assert.equal(s.calls(), 1);
  assert.equal(s.record().attempts[0].assessment.likely_route, "tester"); assert.equal("recommendation" in s.record().attempts[0], false);
});

test("consent is capability, concern, provider, fingerprint and invocation scoped; budget/Judge consent cannot substitute", async () => {
  const s = setup(); s.init();
  const valid = s.consent();
  for (const consent of [undefined, {}, { authorized: true }, { ...valid, capability: "evidence-judge" }, { ...valid, concern: "another" }, { ...valid, provider: "other" }, { ...valid, fingerprint: "stale" }, { ...valid, invocation: "" }, { ...valid, invocation: "other-invocation" }, { ...valid, by: "provider" }]) {
    assert.equal((await s.assess({ consent })).ok, false);
  }
  assert.equal(s.calls(), 0); assert.equal(s.record().attempts.length, 0);
  const noCredentials = await s.assess({ env: {} });
  assert.equal(noCredentials.ok, false); assert.equal(s.calls(), 0); assert.equal(s.record().attempts.length, 0);
});

test("configuration and credentials never activate calls, missing/disabled/unknown config refuses", async () => {
  for (const config of [{ schema: "pathfinder.routing-config/1", enabled: false, provider: "jev" }, { provider: "jev" }, { schema: "pathfinder.routing-config/1", enabled: true, provider: "other" }]) {
    const s = setup(); s.config(config); s.init();
    assert.equal(s.prepare().ok, false); assert.equal((await s.assess()).ok, false); assert.equal(s.calls(), 0);
  }
  const absent = setup(); rmSync(join(absent.root, "context/routing-assessment.json")); assert.equal((await absent.assess()).ok, false); assert.equal(absent.calls(), 0);
  const s = setup(); s.init();
  assert.equal((await s.assess({ consent: undefined, env: { TYPESAFE_API_KEY: "judge-only" } })).ok, false); assert.equal(s.calls(), 0);
  writeFileSync(join(s.root, "context/execution-mode.md"), "<!-- pathfinder:execution-mode human-in-the-loop -->");
  assert.equal(s.prepare().ok, false); assert.equal((await s.assess()).ok, false);
});

test("deterministic restrictions, stale identities, invalid projections and live workers make zero requests", async () => {
  const cases = [
    s => s.set({ State: "failed" }), s => s.set({ State: "working" }), s => s.set({ State: "human-gate", Gate: "Clarify security" }),
    s => s.live(["1.1"]), s => { s.request.pr += "1"; }, s => { s.request.head_sha = "a".repeat(40); },
    s => { s.request.concern.risk = "security"; }, s => { s.request.concern.risk = "scope"; }, s => { s.request.concern.risk = "high_risk"; }, s => { s.request.concern.risk = "unknown"; },
    s => { s.request.evidence[0].action = "cmd:cat private.txt"; }, s => { s.request.concern.summary = s.options.env.PATHFINDER_ROUTING_API_KEY; },
    s => { s.request.requirements[0].original = "Altered requirement"; },
    s => { const r = structuredClone(s.findings); r.result = "findings"; r.findings = [{ severity: "high", location: "a.mjs:1", impact: "Invalid input accepted", evidence: ["cmd:node check"], repair_instruction: "Reject input" }]; writeFileSync(s.path, replaceFindingsReport(s.text(), r)); },
    s => writeFileSync(s.path, s.text().replace("## Adversary experiments", "## Missing experiments")),
  ];
  for (const change of cases) {
    const s = setup(); s.init(); const consent = s.consent(); change(s); s.request.checkpoint = routingCheckpointDigest(s.text());
    assert.equal((await s.assess({ consent })).ok, false); assert.equal(s.calls(), 0); assert.equal(s.record().attempts.length, 0);
  }
});

test("low confidence, security, malformed result and transport failure present Human without advancement", async () => {
  for (const reply of [{ ...assessment(), confidence: .79 }, { ...assessment(), concern: "security" }, { ...assessment(), dispatch: true }, { ...assessment(), likely_route: "developer" }]) {
    const s = setup(); s.init(); const before = routingCheckpointDigest(s.text()); s.reply(reply);
    const result = await s.assess(); assert.equal(result.recommendation, "human"); assert.equal(result.requires_human_direction, true);
    assert.equal(s.calls(), 1); assert.equal(routingCheckpointDigest(s.text()), before);
  }
  const s = setup(); s.init(); s.during(async () => { throw Error("synthetic transport error"); });
  assert.equal((await s.assess()).recommendation, "human"); assert.equal(s.record().attempts[0].status, "failed");
  assert.equal((await s.assess()).recommendation, "human"); assert.equal(s.calls(), 2);
  assert.equal((await s.assess()).reason, "allowance-exhausted"); assert.equal(s.calls(), 2);
});

test("head, evidence, concern, config, live state and requirements changes during await invalidate recording and presentation", async () => {
  for (const change of [
    s => { writeFileSync(join(s.worktree, "new-head.txt"), "changed"); runGit(["add", "new-head.txt"], s.worktree); runGit(["commit", "-qm", "new head"], s.worktree); },
    s => { const r = structuredClone(s.findings); r.verification.push("new observation"); writeFileSync(s.path, replaceFindingsReport(s.text(), r)); },
    s => { s.request.concern.original += " changed"; }, s => s.config({ schema: "pathfinder.routing-config/1", enabled: false, provider: "jev" }),
    s => s.live(["1.1"]), s => writeFileSync(s.ticketPath, readFileSync(s.ticketPath, "utf8").replace("Empty input is rejected.", "Other input is rejected.")),
  ]) {
    const s = setup(); s.init(); s.during(async () => change(s));
    const result = await s.assess(); assert.equal(result.recommendation, "human"); assert.equal(result.ok, false); assert.equal(s.calls(), 1);
    assert.equal(s.record().attempts[0].status, "failed"); assert.equal(s.record().attempts[0].failure, "stale-state");
  }
});

test("assessment never supplies follow-up authorization; a second human operation retires reports without dispatch", async () => {
  const s = setup(); s.init(); const result = await s.assess();
  assert.equal(humanDirectedFollowup({ root: s.root, request: result, live: [], gh: s.gh }).ok, false);
  assert.equal(readFindingsReport(s.text()).ok, true);
  const request = { schema: "pathfinder.human-followup/1", ticket: "1.1", pr: PR, head_sha: s.sha(), target: "adversary", concern: { id: s.request.concern.id, summary: s.request.concern.summary }, checkpoint: checkpointDigest(s.text()), authorization: { by: "human", kind: "review-follow-up", direction: "Investigate this concern with fresh experiments" } };
  assert.equal(humanDirectedFollowup({ root: s.root, request, live: [], gh: s.gh }).ok, true);
  assert.match(s.text(), /- State: adversary/); assert.match(s.text(), /Historical Tester findings/); assert.match(s.text(), /Historical Adversary experiments/);
  assert.equal((await s.assess()).ok, false); assert.equal(s.calls(), 1);
  assert.equal(humanDirectedFollowup({ root: s.root, request, live: [], gh: s.gh }).duplicate, true);
});

test("CLI local preparation/allowance and unconsented assessment use the same boundary", () => {
  const s = setup(), requestPath = join(s.root, "request.json"), authPath = join(s.root, "auth.json");
  writeFileSync(requestPath, JSON.stringify(s.request));
  writeFileSync(authPath, JSON.stringify({ by: "human", ticket: "1.1", kind: "initialize", direction: "Authorize allowance only" }));
  const run = (action, file) => orchestrate(["routing", "1.1", action, "--request", file, "--live", "", "--gh", s.gh], { root: s.root });
  assert.equal(run("prepare", requestPath).status, 0);
  assert.equal(run("allowance", authPath).status, 0);
  const refused = run("assess", requestPath); assert.equal(refused.status, 1); assert.match(refused.stdout, /routing-consent-required/);
  assert.equal(s.record().attempts.length, 0);
});


test("one explicit invocation cannot send a second request, even through an injected adapter", async () => {
  const s = setup(); s.init();
  const adapter = { ...s.adapter, assess: async (projection, io) => {
    await s.adapter.assess(projection, io);
    try { await s.adapter.assess(projection, io); } catch { /* guard records the violation */ }
    return { model: jev.model, assessment: assessment() };
  } };
  const result = await assessRoutingInvocation({ ...s.options, consent: s.consent() }, { adapter, fetch: s.fetch });
  assert.equal(s.calls(), 1); assert.equal(result.recommendation, "human"); assert.equal(result.ok, false);
});
