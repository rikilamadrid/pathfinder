// Synthetic full-coordinator fixture. No network: every provider fetch is intercepted.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareRoutingInvocation, authorizeRoutingInvocation, assessRoutingInvocation, routingCheckpointDigest } from "../../../../skills/orchestrate/engine/routing-invocation.mjs";
import { readRoutingRecord } from "../../../../skills/orchestrate/engine/routing-record.mjs";
import { replaceFindingsReport } from "../../../../skills/orchestrate/engine/findings.mjs";
import { replaceExperimentReport } from "../../../../skills/orchestrate/engine/experiments.mjs";
import { updateStateFile } from "../../../../skills/orchestrate/engine/statefile.mjs";
import * as jev from "../../../../skills/orchestrate/engine/routing-providers/jev.mjs";
import { makeProject, orchestrate, prGh, runGit } from "../../lib/harness.mjs";

export const PR = "https://github.com/acme/widgets/pull/7";
export const assessment = () => ({ schema: "pathfinder.routing-assessment/1", likely_route: "tester", confidence: 0.9, rationale: "missing_observation", evidence_refs: ["e1"], concern: "none" });
export function setup() {
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
  let live = [];
  const env = { PATHFINDER_ROUTING_API_KEY: ["synthetic", "routing", "fixture"].join("_") };
  const options = { root, ticket: "1.1", invocation: "invocation-one", gh, readRequest: () => request, readLive: () => live, env };
  const prepare = () => prepareRoutingInvocation(options);
  const consent = () => ({ by: "human", capability: "routing-assessment", ticket: "1.1", concern: request.concern.id, provider: "jev", invocation: "invocation-one", fingerprint: prepare().fingerprint });
  const init = () => authorizeRoutingInvocation({ ...options, authorization: { by: "human", ticket: "1.1", kind: "initialize", direction: "Authorize two assessments, not external calls" } });
  const record = () => readRoutingRecord(text()).record;
  return { root, worktree, path, gh, sha, text, set, findings, experiments, config, request, options, prepare, consent, init, record, ticketPath, live: value => { live = value; } };
}

// Real pinned protocol, intercepted before any socket or credential use.
export function protocolReply(projection, picks = {}) {
  const selected = { route: "tester", rationale: "missing_observation", evidence: "e1", concern: "none", ...picks };
  return { model: jev.model, usage: { input_tokens: 100, output_tokens: 10 }, answers: Object.fromEntries(Object.entries(jev.buildRequest(projection).questions).map(([id, q]) => [id, { type: "choice", choice: selected[id], confidence: .9, probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, key === selected[id] ? 1 : 0])) }])) };
}
export function boundary(s, { adapter, answer = p => new Response(JSON.stringify(protocolReply(p))), beforeSend = () => {} } = {}) {
  const prepared = s.prepare();
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const bytes = JSON.stringify(jev.buildRequest(prepared.projection));
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, init });
    assert.equal(init.body, bytes, "transmitted bytes equal validated preparation snapshot");
    assert.deepEqual(init.headers, jev.transport({ TYPESAFE_API_KEY: s.options.env.PATHFINDER_ROUTING_API_KEY }).headers);
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(init.redirect, "error");
    assert.doesNotMatch(init.body, /cmd:|head_sha|github|synthetic|private|PASS|FAIL|raw_findings/);
    await beforeSend();
    return answer(prepared.projection);
  };
  return { seen, bytes, run: async (overrides = {}) => {
    const result = await assessRoutingInvocation({ ...s.options, consent: s.consent(), ...overrides }, { adapter, fetch });
    // Check again outside provider error handling: an assertion thrown inside
    // fetch becomes a conservative failure, which hostile cases also expect.
    // Such containment must never disguise bytes that already crossed the seam.
    for (const { url, init } of seen) {
      assert.equal(init.body, bytes, "observed transport bytes equal validated snapshot");
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.deepEqual(init.headers, jev.transport({ TYPESAFE_API_KEY: s.options.env.PATHFINDER_ROUTING_API_KEY }).headers);
      assert.equal(init.redirect, "error");
      assert.doesNotMatch(init.body, /cmd:|head_sha|github|synthetic|private|PASS|FAIL|raw_findings/);
    }
    return result;
  } };

}
export function authority(s) {
  return { checkpoint: routingCheckpointDigest(s.text()),
    ticket: readFileSync(s.ticketPath, "utf8"),
    head: s.sha(),
    claim: runGit(["rev-parse", "refs/pathfinder/claims/1.1"], s.root),
    branches: runGit(["for-each-ref", "--format=%(refname):%(objectname)"], s.root),
  };
}
