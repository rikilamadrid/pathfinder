import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { authorizeRoutingAllowance, attemptRoutingAssessment, checkpointRoutingPreparation, readRoutingRecord, recoverRoutingLock, routingFingerprint } from "../../../skills/orchestrate/engine/routing-record.mjs";
import { ROUTING_CONTRACT, PROVENANCE_SCHEMA } from "../../../skills/orchestrate/engine/routing-contract.mjs";
import { ROUTING_POLICY } from "../../../skills/orchestrate/engine/routing-policy.mjs";
import { prepareRouting } from "../../../skills/orchestrate/engine/routing-projection.mjs";

const moduleURL = pathToFileURL(resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "../../../skills/orchestrate/engine/routing-record.mjs")).href;
const ticket = "57.4";
function input() {
  const identity = { ticket, pr: "https://github.com/example/project/pull/8", head_sha: "a".repeat(40) };
  return { identity, workflow: { identity_current: true, evidence_current: true, checkpoints_complete: true, ownership_valid: true, human_boundary: true, unresolved_concern: true, live_worker: false, failed_without_guidance: false, confirmed_tester_findings: false, missing_required_reports: false, known_concern: false },
    concern: { source: "coordinator:concern:1", original: "Potential empty input boundary ambiguity", summary: "The empty input boundary needs more evidence." },
    requirements: [{ source: "ticket:verification:1", original: "Run node --test", summary: "Empty input produces a useful error." }],
    findings: { ...identity, result: "PASS", findings: [], verification: ["cmd:node --test; PASS; log:/private/result.log"], limits: "One platform only." },
    experiments: null, evidence: [{ role: "tester", index: 1, action: "Exercised empty input.", observation: "A useful error appeared." }] };
}
const assessment = () => ({ schema: ROUTING_CONTRACT, likely_route: "tester", confidence: 0.9, rationale: "missing_observation", evidence_refs: ["e1"], concern: "none" });
function fixture(t, eol = "\n") {
  const worktree = mkdtempSync(join(tmpdir(), "routing-record-"));
  mkdirSync(join(worktree, "context"));
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  const path = join(worktree, "context/current-ticket.md");
  const original = ["# Current Ticket", "", "- Worker: 57.4", "- State: human-gate", "- Gate: Pending clarification", "- Review: ordinary", "- Next: Human decision", "", "## Execution", "", "```yaml", "unrelated: exactly preserved", "```", "", "## Tester findings", "", "PASS evidence is local.", ""].join(eol);
  writeFileSync(path, original);
  const current = { input: input(), provider: "double", model: "pinned-model", contract: ROUTING_CONTRACT, policy: ROUTING_POLICY };
  let calls = 0;
  const args = { worktree, ticket, readCurrent: () => current, consent: { ticket, authorized: true }, assess: async () => { calls++; return { ok: true, model: current.model, assessment: assessment() }; } };
  const auth = (kind, extra = {}) => ({ worktree, ticket, authorization: { by: "human", ticket, direction: "Explicit human direction for this test", kind, ...extra } });
  const init = () => authorizeRoutingAllowance(auth("initialize"));
  const record = () => readRoutingRecord(readFileSync(path, "utf8")).record;
  return { worktree, path, original, current, args, auth, init, record, calls: () => calls };
}

test("allowance initialization is explicit, defaults to two, and is not call consent", async (t) => {
  const f = fixture(t);
  assert.equal((await attemptRoutingAssessment(f.args)).reason, "reconciliation-required");
  for (const authorization of [undefined, {}, { by: "provider", ticket, direction: "Allow" }, { by: "human", ticket: "57.8", direction: "Allow", kind: "initialize" }]) assert.equal(authorizeRoutingAllowance({ worktree: f.worktree, ticket, authorization }).ok, false);
  assert.equal(readFileSync(f.path, "utf8"), f.original);
  assert.deepEqual(f.init(), { ok: true, allowance: 2, consumed: 0 });
  assert.equal(f.init().reason, "reconciliation-required");
  assert.equal((await attemptRoutingAssessment({ ...f.args, consent: undefined })).reason, "call-consent-required");
  assert.equal(f.calls(), 0); assert.equal(f.record().attempts.length, 0);
});

test("preparation persists with exact provenance without spending or calling", (t) => {
  const f = fixture(t); f.init();
  assert.equal(checkpointRoutingPreparation(f.args).ok, true);
  const prepared = prepareRouting(f.current.input);
  assert.deepEqual(f.record().preparation.preparation, prepared.preparation);
  assert.deepEqual(f.record().preparation.projection, prepared.projection);
  assert.equal(f.record().attempts.length, 0); assert.equal(f.calls(), 0);
});

test("unchanged valid assessment reuses cache, recomputes recommendation, and preserves all other sections", async (t) => {
  for (const eol of ["\n", "\r\n"]) {
    const f = fixture(t, eol); f.init();
    const first = await attemptRoutingAssessment(f.args);
    assert.equal(first.from, "assessment"); assert.equal(first.recommendation.recommendation, "tester");
    const second = await attemptRoutingAssessment({ ...f.args, consent: undefined, assess: undefined });
    assert.equal(second.from, "cache"); assert.deepEqual(second.recommendation, first.recommendation);
    assert.equal(f.calls(), 1); assert.equal(f.record().attempts.length, 1);
    assert.equal(readFileSync(f.path, "utf8").split("## Routing assessments")[0], f.original + eol);
    const body = readFileSync(f.path, "utf8") + eol + "## Other section" + eol + "Exact bytes." + eol;
    writeFileSync(f.path, body);
    checkpointRoutingPreparation(f.args);
    assert.equal(readFileSync(f.path, "utf8").split("## Other section")[1], body.split("## Other section")[1]);
  }
});

test("failure consumes a durable attempt; retry needs explicit invocation and exhaustion needs direction", async (t) => {
  const f = fixture(t); f.init();
  let calls = 0;
  const args = { ...f.args, assess: async () => { calls++; assert.equal(f.record().attempts.at(-1).status, "reserved"); throw new Error("synthetic transport failure"); } };
  assert.equal((await attemptRoutingAssessment(args)).reason, "provider-error");
  assert.equal(calls, 1); assert.equal(f.record().attempts[0].status, "failed");
  assert.equal((await attemptRoutingAssessment(args)).reason, "provider-error"); assert.equal(calls, 2);
  assert.equal((await attemptRoutingAssessment(args)).reason, "allowance-exhausted"); assert.equal(calls, 2);
  assert.equal(authorizeRoutingAllowance(f.auth("extend", { additional: 1 })).ok, true);
  assert.equal((await attemptRoutingAssessment(args)).reason, "provider-error"); assert.equal(calls, 3);
  assert.equal(f.record().allowance, 3); assert.equal(f.record().attempts.length, 3);
});

test("interruption before reservation costs nothing; in-flight failure remains consumed", async (t) => {
  const f = fixture(t); f.init();
  assert.equal((await attemptRoutingAssessment({ ...f.args, readCurrent: () => { throw new Error("interrupted preparation"); } })).ok, false);
  assert.equal(f.record().attempts.length, 0);
  let unblock;
  const active = attemptRoutingAssessment({ ...f.args, assess: () => new Promise((resolve) => { unblock = resolve; }) });
  assert.equal(f.record().attempts.length, 1); assert.equal(f.record().attempts[0].status, "reserved");
  assert.equal((await attemptRoutingAssessment(f.args)).reason, "attempt-in-flight-or-interrupted");
  assert.equal(authorizeRoutingAllowance(f.auth("extend", { additional: 1 })).reason, "attempt-in-flight-or-unknown");
  unblock({ ok: false, failure: "timeout" });
  assert.equal((await active).reason, "timeout"); assert.equal(f.record().attempts.length, 1);
});

test("killed process leaves reservation consumed and requires explicit dead-lock recovery plus reconciliation", async (t) => {
  const f = fixture(t); f.init();
  const code = `import { attemptRoutingAssessment } from ${JSON.stringify(moduleURL)}; await attemptRoutingAssessment({worktree:${JSON.stringify(f.worktree)},ticket:'57.4',readCurrent:()=>(${JSON.stringify(f.current)}),consent:{ticket:'57.4',authorized:true},assess:()=>{process.stdout.write('reserved'); return new Promise(()=>setInterval(()=>{},1000));}});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));
  await new Promise((resolve, reject) => { child.stdout.once("data", resolve); child.once("error", reject); child.once("exit", (code) => { if (code !== null) reject(new Error(`child exited ${code}`)); }); });
  const recovery = f.auth("recover-lock");
  assert.equal(recoverRoutingLock(recovery).reason, "live-or-unknown-attempt-owner");
  child.kill("SIGKILL"); await new Promise((resolve) => child.once("exit", resolve));
  assert.equal((await attemptRoutingAssessment(f.args)).reason, "attempt-in-flight-or-interrupted");
  assert.equal(f.record().attempts[0].status, "reserved");
  assert.equal(recoverRoutingLock(recovery).ok, true);
  assert.equal((await attemptRoutingAssessment(f.args)).reason, "attempt-in-flight-or-interrupted");
  assert.equal(authorizeRoutingAllowance(f.auth("reconcile", { allowance: 2, consumed: 0 })).reason, "reconciliation-cannot-refund");
  assert.equal(authorizeRoutingAllowance(f.auth("reconcile", { allowance: 2, consumed: 1 })).ok, true);
  assert.equal(f.record().attempts[0].failure, "interrupted");
  assert.equal((await attemptRoutingAssessment(f.args)).ok, true); assert.equal(f.record().attempts.length, 2);
});

test("independent processes cannot reserve concurrently", async (t) => {
  const f = fixture(t); f.init(); let done;
  const active = attemptRoutingAssessment({ ...f.args, assess: () => new Promise((resolve) => { done = resolve; }) });
  const code = `import { attemptRoutingAssessment } from ${JSON.stringify(moduleURL)}; console.log(JSON.stringify(await attemptRoutingAssessment({worktree:${JSON.stringify(f.worktree)},ticket:'57.4',readCurrent:()=>(${JSON.stringify(f.current)})})));`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).reason, "attempt-in-flight-or-interrupted");
  assert.equal(f.record().attempts.length, 1);
  done({ ok: true, model: f.current.model, assessment: assessment() }); assert.equal((await active).ok, true);
});

test("missing/corrupt established budget cannot initialize or call and requires explicit accounting", async (t) => {
  for (const corrupt of [false, true]) {
    const f = fixture(t); f.init(); await attemptRoutingAssessment(f.args);
    writeFileSync(f.path, corrupt ? readFileSync(f.path, "utf8").replace('"allowance":2', '"allowance":"two"') : f.original);
    assert.equal(f.init().reason, "reconciliation-required");
    assert.equal((await attemptRoutingAssessment(f.args)).reason, "reconciliation-required");
    assert.equal(authorizeRoutingAllowance(f.auth("reconcile", { allowance: 2, consumed: 1 })).ok, true);
    assert.equal(f.record().prior_consumed, 1); assert.equal(f.record().allowance, 2);
    assert.equal(readdirSync(join(f.worktree, ".pathfinder/routing")).some((p) => p.startsWith("recovery-")), true);
    assert.equal((await attemptRoutingAssessment(f.args)).ok, true);
    f.current.input.concern.original += " New.";
    assert.equal((await attemptRoutingAssessment(f.args)).reason, "allowance-exhausted");
  }
});

test("missing or corrupt establishment marker refuses reuse and extension", async (t) => {
  const f = fixture(t); f.init(); await attemptRoutingAssessment(f.args);
  rmSync(join(f.worktree, ".pathfinder/routing/established.json"));
  assert.equal((await attemptRoutingAssessment(f.args)).reason, "reconciliation-required");
  assert.equal(authorizeRoutingAllowance(f.auth("extend", { additional: 1 })).reason, "reconciliation-required");
  assert.equal(f.init().reason, "reconciliation-required");
});

test("complete semantic fingerprints invalidate changed identity, concern, evidence, requirements, provider, model or projection", async (t) => {
  const changes = [
    (x) => x.input.identity.head_sha = x.input.findings.head_sha = "b".repeat(40),
    (x) => x.input.identity.pr = x.input.findings.pr = "https://github.com/example/project/pull/9",
    (x) => x.input.concern.original += " Changed.",
    (x) => x.input.concern.summary = "The populated input boundary needs more evidence.",
    (x) => x.input.findings.limits += " Another limit.",
    (x) => x.input.requirements[0].original += " Again.",
    (x) => x.input.evidence[0].observation = "An informative error appeared.",
    (x) => x.provider = "another-double", (x) => x.model = "another-model",
  ];
  for (const change of changes) {
    const f = fixture(t); f.init(); await attemptRoutingAssessment(f.args); change(f.current);
    assert.equal((await attemptRoutingAssessment(f.args)).from, "assessment"); assert.equal(f.calls(), 2); assert.equal(f.record().attempts.length, 2);
  }
  const f = fixture(t); f.init(); await attemptRoutingAssessment(f.args);
  const p = prepareRouting(f.current.input);
  const input = { schema: PROVENANCE_SCHEMA, contract: ROUTING_CONTRACT, policy: ROUTING_POLICY, provider: "double", model: "pinned-model", preparation: p.preparation, projection: p.projection };
  assert.notEqual(routingFingerprint(input), routingFingerprint({ ...input, policy: "pathfinder.routing-policy/2" }));
  f.current.policy = "pathfinder.routing-policy/2";
  assert.equal((await attemptRoutingAssessment(f.args)).ok, false); assert.equal(f.calls(), 1);
});

test("fresh deterministic restrictions win over cache and do not consume attempts", async (t) => {
  const f = fixture(t); f.init(); await attemptRoutingAssessment(f.args);
  for (const key of Object.keys(f.current.input.workflow)) {
    f.current.input.workflow[key] = !f.current.input.workflow[key];
    assert.equal((await attemptRoutingAssessment(f.args)).ok, false, key);
    f.current.input.workflow[key] = !f.current.input.workflow[key];
  }
  assert.equal(f.calls(), 1); assert.equal(f.record().attempts.length, 1);
});

test("forged cached decision, authority and malformed assessments never get reused", async (t) => {
  const changes = [
    (r) => r.attempts[0].recommendation = "developer", (r) => r.attempts[0].dispatch = true,
    (r) => r.attempts[0].assessment.likely_route = "developer", (r) => r.attempts[0].assessment.evidence_refs = ["e99"],
    (r) => r.attempts[0].assessment.confidence = "high", (r) => r.attempts[0].fingerprint = "sha256:" + "0".repeat(64),
    (r) => r.attempts[0].input.projection.concern = "PASS", (r) => r.allowance = 99,
  ];
  for (const change of changes) {
    const f = fixture(t); f.init(); await attemptRoutingAssessment(f.args); const r = f.record(); change(r);
    writeFileSync(f.path, f.original + "\n## Routing assessments\n\n```json\n" + JSON.stringify(r) + "\n```\n");
    assert.equal((await attemptRoutingAssessment(f.args)).ok, false); assert.equal(f.calls(), 1);
  }
});

test("policy is recomputed from validated assessment, never a saved recommendation", async (t) => {
  const f = fixture(t); f.init();
  const low = { ...assessment(), confidence: 0.79 };
  const a = await attemptRoutingAssessment({ ...f.args, assess: () => ({ ok: true, model: f.current.model, assessment: low }) });
  assert.equal(a.recommendation.recommendation, "human");
  const b = await attemptRoutingAssessment(f.args); assert.equal(b.from, "cache"); assert.equal(b.recommendation.recommendation, "human");
  assert.equal(Object.hasOwn(f.record().attempts[0], "recommendation"), false);
});

test("stale state during callback records failure, preserves concurrent unrelated updates, and never caches", async (t) => {
  const f = fixture(t); f.init();
  const result = await attemptRoutingAssessment({ ...f.args, assess: async () => {
    f.current.input.identity.head_sha = f.current.input.findings.head_sha = "b".repeat(40);
    writeFileSync(f.path, readFileSync(f.path, "utf8").replace("Pending clarification", "Another human question"));
    return { ok: true, model: f.current.model, assessment: assessment() };
  } });
  assert.equal(result.reason, "stale-state"); assert.equal(f.record().attempts[0].status, "failed");
  assert.match(readFileSync(f.path, "utf8"), /- Gate: Another human question/);
  assert.equal((await attemptRoutingAssessment(f.args)).from, "assessment");
});

test("malicious callback results cannot mutate validated returned or persisted values", async (t) => {
  const f = fixture(t); f.init(); let reads = 0;
  const result = await attemptRoutingAssessment({ ...f.args, assess: () => ({ ok: true, model: f.current.model, get assessment() { return ++reads === 1 ? assessment() : { ...assessment(), likely_route: "developer", dispatch: true }; } }) });
  assert.equal(result.ok, true); assert.equal(reads, 1); assert.equal(result.assessment.likely_route, "tester");
  assert.equal(f.record().attempts[0].assessment.likely_route, "tester");
});

test("local refusal and all storage operations have no real network or phase/status/verdict authority", async (t) => {
  const f = fixture(t); const old = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network forbidden"); };
  try {
    f.init(); f.current.input.concern.summary = "PASS";
    assert.equal((await attemptRoutingAssessment(f.args)).ok, false); assert.equal(f.calls(), 0);
    assert.equal(f.record().attempts.length, 0);
    f.current.input.concern.summary = "The input boundary needs more evidence.";
    await attemptRoutingAssessment(f.args);
    const prefix = readFileSync(f.path, "utf8").split("## Routing assessments")[0];
    assert.equal(prefix, f.original + "\n");
  } finally { globalThis.fetch = old; }
  const source = readFileSync(new URL("../../../skills/orchestrate/engine/routing-record.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'][^"']*(?:routing-provider|stage\.mjs|config\.mjs)/);
});

test("a budget and marker copied from another ticket cannot fund this claim", async (t) => {
  const f = fixture(t); f.init();
  const record = f.record(); record.ticket = "57.8";
  writeFileSync(f.path, f.original + "\n## Routing assessments\n\n```json\n" + JSON.stringify(record) + "\n```\n");
  const markerPath = join(f.worktree, ".pathfinder/routing/established.json");
  const marker = JSON.parse(readFileSync(markerPath, "utf8")); marker.ticket = "57.8"; writeFileSync(markerPath, JSON.stringify(marker));
  assert.equal((await attemptRoutingAssessment(f.args)).reason, "reconciliation-required");
  assert.equal(authorizeRoutingAllowance(f.auth("extend", { additional: 1 })).ok, false);
  assert.equal(f.calls(), 0);
});

import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mutateCheckpoint, recoverCheckpointLock, replaceCheckpoint } from "../../../skills/orchestrate/engine/checkpoint-write.mjs";
import { updateStateFile } from "../../../skills/orchestrate/engine/statefile.mjs";
import { replaceFindingsReport } from "../../../skills/orchestrate/engine/findings.mjs";
import { replaceExperimentReport } from "../../../skills/orchestrate/engine/experiments.mjs";
import { judgmentRecord, replaceJudgment } from "../../../skills/orchestrate/engine/judgment.mjs";

function writerData(f) {
  return {
    findings: { ...f.current.input.findings, limits: "Fresh independent writer observation." },
    experiments: { ...f.current.input.identity, experiments: [{ experiment_id: "edge", contract: "Empty input clarity", hypothesis: "Empty input may confuse", setup: "Local fixture", steps: ["Exercise empty input"], expected_result: "Useful error", observed_result: "Useful error", evidence: ["cmd:node test.mjs"], reproducibility: "Repeated", potential_impact: "Input clarity", verifier_instruction: "Repeat independently" }] },
    judgment: judgmentRecord({ ticket, pr: f.current.input.identity.pr, head: f.current.input.identity.head_sha, judge: { name: "double", model: "pinned" }, outcome: { status: "failed", failure: { kind: "provider-error", message: "Synthetic failure" } } }),
  };
}
function writeOther(kind, f) {
  if (kind === "state") return updateStateFile(f.worktree, { set: { State: "failed", Gate: "Independent newer human gate" } });
  const replace = { findings: replaceFindingsReport, experiments: replaceExperimentReport, judgment: replaceJudgment }[kind];
  replaceCheckpoint(f.path, readFileSync(f.path, "utf8"), (source) => replace(source, writerData(f)[kind]));
  return { ok: true };
}
function childWriter(kind, f) {
  const url = (name) => JSON.stringify(new URL(name, moduleURL).href);
  const program = `import {readFileSync} from 'node:fs';
    import {updateStateFile} from ${url('statefile.mjs')};
    import {replaceCheckpoint} from ${url('checkpoint-write.mjs')};
    import {replaceFindingsReport} from ${url('findings.mjs')};
    import {replaceExperimentReport} from ${url('experiments.mjs')};
    import {replaceJudgment} from ${url('judgment.mjs')};
    const kind=${JSON.stringify(kind)}, path=${JSON.stringify(f.path)}, data=${JSON.stringify(writerData(f))};
    try { if(kind==='state') console.log(JSON.stringify(updateStateFile(${JSON.stringify(f.worktree)},{set:{State:'failed',Gate:'Independent newer human gate'}})));
    else {const replace={findings:replaceFindingsReport,experiments:replaceExperimentReport,judgment:replaceJudgment}[kind]; replaceCheckpoint(path,readFileSync(path,'utf8'),text=>replace(text,data[kind])); console.log('{"ok":true}');} }
    catch(error){console.log(JSON.stringify({ok:false,message:error.message}));}`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const writerMarker = (kind) => ({ state: "- Gate: Independent newer human gate", findings: "Fresh independent writer observation.", experiments: "## Adversary experiments", judgment: "## Evidence judgment" })[kind];

test("every section writer and routing mutually exclude the final-read/rename race, with explicit retry preserving both", (t) => {
  for (const kind of ["state", "findings", "experiments", "judgment"]) {
    const f = fixture(t); f.init();
    const originalRename = fs.renameSync; let child, reverse;
    try {
      fs.renameSync = (from, to) => {
        if (to === fs.realpathSync(f.path) && child === undefined) { child = childWriter(kind, f); assert.equal(child.ok, false); }
        return originalRename(from, to);
      }; syncBuiltinESMExports();
      assert.equal(checkpointRoutingPreparation(f.args).ok, true);
    } finally { fs.renameSync = originalRename; syncBuiltinESMExports(); }
    assert.equal(child.ok, false); assert.equal(childWriter(kind, f).ok, true);
    const saved = f.record();
    assert.ok(readFileSync(f.path, "utf8").includes(writerMarker(kind)));
    try {
      fs.renameSync = (from, to) => {
        if (to === fs.realpathSync(f.path) && reverse === undefined) { reverse = checkpointRoutingPreparation(f.args); assert.equal(reverse.ok, false); }
        return originalRename(from, to);
      }; syncBuiltinESMExports();
      // Change the value again so atomic replacement is actually necessary.
      if (kind === "state") assert.equal(updateStateFile(f.worktree, { set: { Gate: "Another writer update" } }).ok, true);
      else { const data = writerData(f)[kind]; if (kind === "findings") data.limits += " Changed."; else if (kind === "experiments") data.experiments[0].setup += " Changed."; else data.failure.message += " Changed.";
        replaceCheckpoint(f.path, readFileSync(f.path, "utf8"), (s) => ({ findings: replaceFindingsReport, experiments: replaceExperimentReport, judgment: replaceJudgment })[kind](s, data)); }
    } finally { fs.renameSync = originalRename; syncBuiltinESMExports(); }
    assert.equal(reverse.ok, false); assert.deepEqual(f.record(), saved);
    assert.equal(checkpointRoutingPreparation(f.args).ok, true); assert.equal(f.record().attempts.length, 0);
  }
});

test("assessment and fresh reader run outside shared lock; intervening evidence invalidates outcome", async (t) => {
  for (const kind of ["state", "findings", "experiments", "judgment"]) {
    const f = fixture(t); f.init();
    const result = await attemptRoutingAssessment({ ...f.args, assess: async () => {
      assert.equal(childWriter(kind, f).ok, true);
      return { ok: true, model: f.current.model, assessment: assessment() };
    } });
    assert.equal(result.reason, "stale-state"); assert.equal(f.record().attempts.length, 1);
    assert.equal(f.record().attempts[0].failure, "stale-state");
    assert.ok(readFileSync(f.path, "utf8").includes(writerMarker(kind)));
  }
  const f = fixture(t); f.init();
  const result = await attemptRoutingAssessment({ ...f.args, readCurrent: () => {
    assert.equal(updateStateFile(f.worktree, { set: { Gate: "Changed by fresh reader" } }).ok, true);
    return f.current;
  } });
  assert.equal(result.reason, "stale-state"); assert.equal(f.record().attempts.length, 0);
});

test("shared lock rejects accidental nesting, async mutations and live/ambiguous recovery without retry", (t) => {
  const f = fixture(t); f.init();
  const auth = { by: "human", kind: "recover-checkpoint-lock", direction: "Explicit recovery" };
  mutateCheckpoint(f.path, (latest) => {
    assert.equal(updateStateFile(f.worktree, { set: { State: "failed" } }).ok, false);
    assert.equal(checkpointRoutingPreparation(f.args).ok, false);
    assert.equal(recoverCheckpointLock(f.path, auth).reason, "live-lock-owner");
    return { text: latest + "\n## Notes\nOuter transaction survived.\n" };
  });
  let ran = false;
  assert.throws(() => mutateCheckpoint(f.path, async () => { ran = true; }), /synchronous/);
  assert.equal(ran, false); assert.match(readFileSync(f.path, "utf8"), /Outer transaction survived/);
  const area = join(f.worktree, ".pathfinder/checkpoint-writes");
  mutateCheckpoint(f.path, (latest) => {
    const lock = readdirSync(area).find((name) => name.endsWith(".lock"));
    writeFileSync(join(area, lock, "owner.json"), "{}");
    assert.equal(recoverCheckpointLock(f.path, auth).reason, "unknown-lock-owner");
    return { text: latest };
  });
});

test("interrupted shared writer needs explicit dead-owner recovery and preserves routing consumption", async (t) => {
  const f = fixture(t); f.init(); await attemptRoutingAssessment(f.args);
  const checkpointURL = JSON.stringify(new URL("checkpoint-write.mjs", moduleURL).href);
  const code = `import {mutateCheckpoint} from ${checkpointURL}; mutateCheckpoint(${JSON.stringify(f.path)},()=>{process.stdout.write('locked'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));
  await new Promise((resolve, reject) => { child.stdout.once("data", resolve); child.once("error", reject); child.once("exit", (code) => { if (code !== null) reject(new Error(`child exited ${code}`)); }); });
  assert.equal(updateStateFile(f.worktree, { set: { Gate: "Should refuse" } }).ok, false);
  child.kill("SIGKILL"); await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(updateStateFile(f.worktree, { set: { Gate: "Still refuses" } }).ok, false);
  assert.equal(recoverCheckpointLock(f.path, {}).ok, false);
  assert.equal(recoverCheckpointLock(f.path, { by: "human", kind: "recover-checkpoint-lock", direction: "Owner termination verified" }).ok, true);
  assert.equal(updateStateFile(f.worktree, { set: { Gate: "Explicitly recovered" } }).ok, true);
  assert.equal(f.record().attempts.length, 1);
});

test("isolated valid-shaped changes to every assessment field invalidate integrity; ordering alone does not", async (t) => {
  const changes = [
    (a) => a.confidence = 0.99, (a) => a.likely_route = "human",
    (a) => a.rationale = "insufficient_context", (a) => a.evidence_refs = ["e2"],
    (a) => a.concern = "security", (a) => { a.likely_route = "adversary"; a.rationale = "untested_assumption"; },
  ];
  for (const change of changes) {
    const f = fixture(t); f.init();
    f.current.input.findings.verification.push("cmd:node second.mjs; PASS");
    f.current.input.evidence.push({ role: "tester", index: 2, action: "Exercised populated input.", observation: "A useful error appeared." });
    const low = { ...assessment(), confidence: 0.79 };
    assert.equal((await attemptRoutingAssessment({ ...f.args, assess: () => ({ ok: true, model: f.current.model, assessment: low }) })).recommendation.recommendation, "human");
    const source = readFileSync(f.path, "utf8"), record = f.record(); change(record.attempts[0].assessment);
    writeFileSync(f.path, source.replace(/(## Routing assessments\n\n```json\n)[^\n]+/, (_, prefix) => prefix + JSON.stringify(record)));
    assert.equal((await attemptRoutingAssessment({ ...f.args, consent: undefined, assess: undefined })).ok, false);
    assert.equal(f.calls(), 0);
  }
  const f = fixture(t); f.init(); await attemptRoutingAssessment(f.args);
  const source = readFileSync(f.path, "utf8"), record = f.record();
  record.attempts[0].assessment = Object.fromEntries(Object.entries(record.attempts[0].assessment).reverse());
  writeFileSync(f.path, source.replace(/(## Routing assessments\n\n```json\n)[^\n]+/, (_, prefix) => prefix + JSON.stringify(record)));
  assert.equal((await attemptRoutingAssessment(f.args)).from, "cache"); assert.equal(f.calls(), 1);
});
