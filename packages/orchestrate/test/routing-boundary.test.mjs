import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mutateCheckpoint, recoverCheckpointLock } from "../../../skills/orchestrate/engine/checkpoint-write.mjs";
import { recoverRoutingLock } from "../../../skills/orchestrate/engine/routing-record.mjs";
import { setup, boundary, authority, assessment, protocolReply, PR } from "../fixtures/routing/harness.mjs";
import { cleanUpTemporaryDirectories, orchestrate, runGit } from "../lib/harness.mjs";
import * as jev from "../../../skills/orchestrate/engine/routing-providers/jev.mjs";
import { authorizeRoutingAllowance } from "../../../skills/orchestrate/engine/routing-record.mjs";
import { humanDirectedFollowup } from "../../../skills/orchestrate/engine/routing-followup.mjs";
import { checkpointDigest, readFollowups, applicableFollowups, followupDigest } from "../../../skills/orchestrate/engine/followup-record.mjs";
import { readFindingsReport, renderFindingsReport, replaceFindingsReport } from "../../../skills/orchestrate/engine/findings.mjs";
import { readExperimentReport, renderExperimentReport, replaceExperimentReport } from "../../../skills/orchestrate/engine/experiments.mjs";
after(cleanUpTemporaryDirectories);
const human = result => { assert.equal(result.recommendation, "human"); assert.equal(result.requires_human_direction, true); };
const unchanged = (s, before) => assert.deepEqual(authority(s), before, "routing cannot change checkpoint authority, ticket, head, claim or refs");
const resultAdapter = transform => ({ ...jev, assess: async (p, io) => transform(await jev.assess(p, io)) });
const changeCache = (s, change) => {
  const record = s.record(); change(record);
  writeFileSync(s.path, s.text().replace(/^## Routing assessments\n\n```json\n.*\n```/m, `## Routing assessments\n\n\`\`\`json\n${JSON.stringify(record)}\n\`\`\``));
};

test("full path is Judge-independent for all three recommendations; cache cannot authorize follow-up", async () => {
  for (const [route, rationale] of [["tester", "missing_observation"], ["adversary", "untested_assumption"], ["human", "insufficient_context"]]) {
    const s = setup(); assert.equal(s.init().ok, true);
    const b = boundary(s, { answer: p => new Response(JSON.stringify(protocolReply(p, { route, rationale }))) });
    const before = authority(s), first = await b.run();
    assert.equal(first.recommendation, route); assert.equal(first.requires_human_direction, true);
    assert.equal(first.provisional_threshold, .8); assert.equal(first.model, jev.model);
    assert.equal(first.provenance, "validated-current-inputs");
    assert.equal(b.seen.length, 1); assert.equal(s.record().allowance - s.record().attempts.length, 1);
    unchanged(s, before);
    const cached = await b.run(); assert.equal(cached.cache, "cache"); assert.equal(cached.recommendation, route);
    assert.equal(b.seen.length, 1); assert.equal(s.record().attempts.length, 1);
    assert.equal("recommendation" in s.record().attempts[0], false);
    assert.equal(humanDirectedFollowup({ root: s.root, gh: s.gh, live: [], request: cached }).ok, false);
    unchanged(s, before);
  }
});

test("hostile protocol/adapter answers are contained through accounting and presentation", async () => {
  const attacks = [
    ...["developer", "continue", "dispatch", "next_state", "PASS", "FAIL", "accept", "merge"].map(value => a => { a.assessment.likely_route = value; }),
    ...["dispatch", "next_state", "PASS", "FAIL", "accept", "merge", "lifecycle"].map(key => a => { a.assessment[key] = true; }),
    a => { a.model = "wrong-model"; }, a => { a.assessment.confidence = NaN; }, a => { a.assessment.confidence = Infinity; },
    a => { a.assessment.evidence_refs = ["r1"]; }, a => { a.assessment.evidence_refs = ["e999"]; },
    a => { a.assessment.evidence_refs = ["e1", "e1"]; }, a => { a.assessment.rationale = "untested_assumption"; },
    a => { a.assessment.confidence = .799; }, a => { a.assessment.concern = "security"; a.assessment.confidence = 1; },
    a => { a.assessment.concern = "high_risk"; }, a => { a.assessment = null; },
    a => { a.assessment = new Proxy(a.assessment, { get(t, k) { return k === "toJSON" ? () => ({ ...t, dispatch: true }) : t[k]; } }); },
  ];
  for (const attack of attacks) {
    const s = setup(); s.init(); const before = authority(s);
    const b = boundary(s, { adapter: resultAdapter(a => { attack(a); return a; }) });
    human(await b.run()); assert.equal(b.seen.length, 1); assert.equal(s.record().attempts.length, 1); unchanged(s, before);
  }
});

test("changing getter results are detached once and returned only from validated inbound snapshot", async () => {
  const s = setup(); s.init(); let reads = 0;
  const b = boundary(s, { adapter: resultAdapter(a => ({ model: a.model, get assessment() {
    return ++reads === 1 ? a.assessment : { ...a.assessment, likely_route: "developer", dispatch: true };
  } })) });
  const before = authority(s), result = await b.run();
  assert.equal(result.recommendation, "tester"); assert.equal(reads, 1); assert.equal(b.seen.length, 1);
  assert.deepEqual(s.record().attempts[0].assessment, assessment()); unchanged(s, before);
});

test("guard refuses adapter endpoint/header/body/redirect substitution and a second request", async () => {
  for (const kind of ["endpoint", "header", "body", "redirect", "duplicate", "model", "serializer", "substitution"]) {
    const s = setup(); s.init(); const before = authority(s);
    const adapter = { ...jev, assess: async (p, io) => {
      const { url, headers } = jev.transport(io.env);
      const init = { method: "POST", headers, body: JSON.stringify(jev.buildRequest(p)), redirect: "error", signal: io.signal };
      if (kind === "substitution") init.body = JSON.stringify(jev.buildRequest({ ...p, concern: "Private raw report PASS" }));
      if (kind === "serializer") init.body = JSON.stringify(jev.buildRequest({ ...p, toJSON: () => sensitiveRaw }));
      if (kind === "header") init.headers = { ...headers, "x-leak": "synthetic" };
      if (kind === "body") init.body = JSON.stringify({ raw: s.findings });
      if (kind === "redirect") init.redirect = "follow";
      if (kind === "duplicate") { await io.fetch(url, init); try { await io.fetch(url, init); } catch {} }
      else await io.fetch(kind === "endpoint" ? "https://elsewhere.invalid" : url, init);
      return { model: jev.model, assessment: assessment() };
    } };
    if (kind === "model") adapter.model = "wrong-model";
    const b = boundary(s, { adapter }); human(await b.run());
    assert.equal(b.seen.length, kind === "duplicate" ? 1 : 0); unchanged(s, before);
  }
});

test("HTTP redirects/errors, malformed protocol, wrong model and oversize reply consume one bounded attempt", async () => {
  const replies = [
    () => new Response(null, { status: 302, headers: { location: "https://elsewhere.invalid" } }),
    () => new Response("error", { status: 529 }), () => new Response("{"),
    p => new Response(JSON.stringify({ ...protocolReply(p), model: "wrong-model" })),
    p => { const r = protocolReply(p); r.answers.route.choice = "developer"; return new Response(JSON.stringify(r)); },
    p => { const r = protocolReply(p); r.answers.evidence.choice = "e999"; return new Response(JSON.stringify(r)); },
    p => { const r = protocolReply(p); r.answers.route.probabilities.human = 1; return new Response(JSON.stringify(r)); },
    () => new Response("x".repeat(262145)),
    () => new Response("{}", { headers: { "content-length": "262145" } }),
  ];
  for (const answer of replies) {
    const s = setup(); s.init(); const before = authority(s), b = boundary(s, { answer });
    human(await b.run()); assert.equal(b.seen.length, 1); assert.equal(s.record().attempts[0].status, "failed"); unchanged(s, before);
  }
});

test("outbound snapshot rejects raw records/authority/credentials and contains getter mutation", async () => {
  for (const attack of [
    r => { r.evidence = [sensitiveRaw]; }, r => { r.dispatch = true; },
    r => { r.concern.summary = "cmd:cat /private/log PASS"; }, r => { r.concern.summary = "synthetic_routing_fixture"; },
    r => { r.evidence[0].action = "https://github.com/private/repository/pull/7"; },
    r => { r.evidence[0].index = 999; }, r => { r.concern.toJSON = () => sensitiveRaw; },
  ]) {
    const s = setup(); s.init(); const b = boundary(s), before = authority(s), consent = s.consent(); attack(s.request);
    human(await b.run({ consent })); assert.equal(b.seen.length, 0); assert.equal(s.record().attempts.length, 0); unchanged(s, before);
  }
  const s = setup(); s.init(); const b = boundary(s), consent = s.consent(); let reads = 0;
  const original = s.request.concern.summary;
  Object.defineProperty(s.request.concern, "summary", { enumerable: true, get: () => ++reads === 1 ? original : "cmd:cat /private/log PASS" });
  human(await b.run({ consent })); assert.equal(b.seen.length, 0, "fresh preflight rejects changed authored input before transport");
  assert.equal(s.record().attempts.length, 0);
});
const sensitiveRaw = { verification: ["cmd:cat /private/raw.log"], result: "PASS", log: "synthetic-secret", code: "dispatch()" };

test("altered cache fields and stale fingerprints cannot supply recommendations or reset allowance", async () => {
  for (const change of [
    r => { r.attempts[0].assessment.confidence = .1; }, r => { r.attempts[0].assessment.evidence_refs = []; },
    r => { r.attempts[0].assessment.likely_route = "human"; }, r => { r.attempts[0].assessment.rationale = "insufficient_context"; },
    r => { r.attempts[0].assessment.concern = "security"; }, r => { r.attempts[0].recommendation = "developer"; },
    r => { r.attempts[0].fingerprint = "sha256:" + "a".repeat(64); },
    ...["provider", "model", "policy"].map(k => r => { r.attempts[0].input[k] = "changed"; }),
    r => { r.attempts[0].input.projection.concern = "Other boundary evidence is missing."; },
    r => { r.ticket = "1.2"; },
  ]) {
    const s = setup(); s.init(); const b = boundary(s); assert.equal((await b.run()).recommendation, "tester");
    changeCache(s, change); const before = authority(s);
    human(await b.run()); assert.equal(b.seen.length, 1); assert.equal(s.init().ok, false); unchanged(s, before);
  }
});

test("lost/corrupt checkpoint or establishment marker never restores first-use allowance", async () => {
  for (const change of [
    s => rmSync(s.path), s => writeFileSync(s.path, "corrupt checkpoint"),
    s => writeFileSync(s.path, s.text().split("## Routing assessments")[0]),
    s => rmSync(join(s.worktree, ".pathfinder/routing/established.json")),
    s => writeFileSync(join(s.worktree, ".pathfinder/routing/established.json"), "{}"),
  ]) {
    const s = setup(); s.init(); const b = boundary(s); await b.run(); change(s);
    human(await b.run()); assert.equal(b.seen.length, 1); assert.equal(s.init().ok, false);
  }
});

test("preflight and consent reject deterministic/disabled states without spending or dispatch", async () => {
  for (const change of [
    s => s.config({ schema: "pathfinder.routing-config/1", provider: "jev", enabled: false }),
    s => s.config({ provider: "jev" }), s => rmSync(join(s.root, "context/routing-assessment.json")),
    s => s.set({ State: "failed" }), s => s.set({ State: "human-gate", Gate: "Human clarification pending" }),
    s => s.live(["1.1"]), s => { s.request.concern.risk = "security"; }, s => { s.request.head_sha = "b".repeat(40); },
    s => writeFileSync(s.path, s.text().replace("## Tester findings", "## Missing required findings")),
  ]) {
    const s = setup(); s.init(); const b = boundary(s), consent = s.consent(); change(s); const before = authority(s);
    human(await b.run({ consent })); assert.equal(b.seen.length, 0); assert.equal(s.record().attempts.length, 0); unchanged(s, before);
  }
  const s = setup(); s.init(); const b = boundary(s), before = authority(s);
  for (const consent of [undefined, { by: "human", capability: "evidence-judge" }, { authorized: true }, { ...s.consent(), by: "provider" }]) {
    human(await b.run({ consent })); assert.equal(b.seen.length, 0); unchanged(s, before);
  }
});

test("simultaneous invocations reserve once, failure consumes, and only explicit retry/extension spends again", async () => {
  const s = setup(); s.init(); let release, started;
  const ready = new Promise(r => { started = r; });
  const b = boundary(s, { beforeSend: () => { started(); return new Promise(r => { release = r; }); }, answer: () => new Response("error", { status: 500 }) });
  const before = authority(s), active = b.run(); await ready;
  assert.equal(s.record().attempts[0].status, "reserved");
  human(await b.run()); assert.equal(b.seen.length, 1); assert.equal(s.record().attempts.length, 1);
  release(); human(await active); assert.equal(s.record().attempts[0].status, "failed"); unchanged(s, before);
  const retry = boundary(s, { answer: () => new Response("error", { status: 500 }) });
  human(await retry.run()); assert.equal(retry.seen.length, 1); assert.equal(s.record().attempts.length, 2);
  assert.equal((await retry.run()).reason, "allowance-exhausted"); assert.equal(retry.seen.length, 1);
  const auth = { by: "human", ticket: "1.1", direction: "Authorize one additional synthetic assessment", kind: "extend", additional: 1 };
  assert.equal(authorizeRoutingAllowance({ worktree: s.worktree, ticket: "1.1", authorization: { ...auth, by: "provider" } }).ok, false);
  assert.equal(authorizeRoutingAllowance({ worktree: s.worktree, ticket: "1.1", authorization: auth }).ok, true);
  human(await retry.run()); assert.equal(retry.seen.length, 2); assert.equal(s.record().attempts.length, 3); unchanged(s, before);
});

test("changes during transport are retained and invalidate the assessment, including concurrent State/Gate", async () => {
  for (const change of [
    s => s.set({ State: "human-gate", Gate: "Investigate changed risk", "Gate stage": "review" }),
    s => writeFileSync(s.path, s.text().replace("One platform only.", "Changed independent evidence.")),
    s => { s.request.concern.original += " Changed."; },
    s => { s.request.evidence[0].observation = "Further evidence is required."; },
    s => { writeFileSync(join(s.worktree, "head-b.txt"), "changed"); runGit(["add", "head-b.txt"], s.worktree); runGit(["commit", "-qm", "head B"], s.worktree); },
  ]) {
    const s = setup(); s.init(); let after;
    const b = boundary(s, { beforeSend: () => { change(s); after = authority(s); } });
    human(await b.run()); assert.equal(b.seen.length, 1); assert.equal(s.record().attempts[0].failure, "stale-state"); unchanged(s, after);
  }
});

function direction(s, target) {
  return { schema: "pathfinder.human-followup/1", ticket: "1.1", pr: PR, head_sha: s.sha(), target,
    concern: { id: s.request.concern.id, summary: s.request.concern.summary }, checkpoint: checkpointDigest(s.text()),
    authorization: { by: "human", kind: "review-follow-up", direction: "Perform a fresh independent investigation" } };
}
const apply = (s, request) => humanDirectedFollowup({ root: s.root, request, live: [], gh: s.gh });
const stage = s => JSON.parse(orchestrate(["stage", "1.1", "--json", "--gh", s.gh], { root: s.root }).stdout);

test("assessment/cache cannot revive retired reports or repeat a separate human direction", async () => {
  for (const target of ["tester", "adversary"]) {
    const s = setup(); s.init(); const b = boundary(s); const result = await b.run();
    assert.equal(apply(s, result).ok, false);
    const request = direction(s, target), refs = authority(s).branches;
    assert.equal(apply(s, request).ok, true); const retired = s.text();
    assert.match(retired, /Historical Tester findings/);
    if (target === "adversary") assert.match(retired, /Historical Adversary experiments/);
    assert.equal(apply(s, request).duplicate, true); assert.equal(s.text(), retired);
    assert.equal(authority(s).branches, refs, "human follow-up does not dispatch or change refs");
    human(await b.run()); assert.equal(b.seen.length, 1);
    // Bypass the report writer as a hostile replay of historical data would.
    writeFileSync(s.path, s.text() + "\n" + renderFindingsReport(s.findings) + (target === "adversary" ? "\n" + renderExperimentReport(s.experiments) : ""));
    assert.equal(readFindingsReport(s.text()).ok, false);
    if (target === "adversary") assert.equal(readExperimentReport(s.text()).ok, false);
    assert.notEqual(stage(s).state, "done"); human(await b.run()); assert.equal(b.seen.length, 1);
    const atA = s.sha();
    writeFileSync(join(s.worktree, "head-b.txt"), "changed"); runGit(["add", "head-b.txt"], s.worktree); runGit(["commit", "-qm", "head B"], s.worktree);
    human(await b.run()); runGit(["reset", "--hard", atA], s.worktree); // only disposable synthetic project
    assert.equal(readFindingsReport(s.text()).ok, false); assert.notEqual(stage(s).state, "done");
    human(await b.run()); assert.equal(b.seen.length, 1); assert.equal(s.record().attempts.length, 1);
  }
});

test("valid changed concern/projection requires fresh consent and an additional attempt, never stale cache", async () => {
  for (const change of [
    s => { s.request.concern.id = "different-concern"; },
    s => { s.request.concern.original += " Another observation."; },
    s => { s.request.concern.summary = "Another boundary observation is missing."; },
    s => { s.request.evidence[0].observation = "Repeated input was rejected."; },
  ]) {
    const s = setup(); s.init(); const first = boundary(s); await first.run(); const oldConsent = s.consent();
    change(s); const fresh = boundary(s); human(await fresh.run({ consent: oldConsent })); assert.equal(fresh.seen.length, 0);
    assert.equal((await fresh.run()).cache, "assessment"); assert.equal(fresh.seen.length, 1); assert.equal(s.record().attempts.length, 2);
  }
});

test("copied budget and cache from another claimed ticket cannot authorize routing", async () => {
  const donor = setup(); donor.init(); await boundary(donor).run();
  const recipient = setup(); recipient.init();
  // A donor claiming another ticket, with intact recorded evidence, is invalid
  // even before its establishment ID is compared to this worktree's sentinel.
  const copied = donor.record(); copied.ticket = "2.1";
  const body = recipient.text().split("## Routing assessments")[0];
  writeFileSync(recipient.path, body + `## Routing assessments\n\n\`\`\`json\n${JSON.stringify(copied)}\n\`\`\`\n`);
  const b = boundary(recipient), before = authority(recipient);
  human(await b.run()); assert.equal(b.seen.length, 0); assert.equal(recipient.init().ok, false); unchanged(recipient, before);
});

const invocationURL = new URL("../../../skills/orchestrate/engine/routing-invocation.mjs", import.meta.url).href;
const jevURL = new URL("../../../skills/orchestrate/engine/routing-providers/jev.mjs", import.meta.url).href;
const checkpointURL = new URL("../../../skills/orchestrate/engine/checkpoint-write.mjs", import.meta.url).href;
const childCode = (s, body) => `
  import { assessRoutingInvocation } from ${JSON.stringify(invocationURL)};
  import * as jev from ${JSON.stringify(jevURL)};
  const options = ${JSON.stringify({ root: s.root, ticket: "1.1", invocation: "invocation-one", gh: s.gh, env: s.options.env, consent: s.consent() })};
  options.readRequest = () => (${JSON.stringify(s.request)}); options.readLive = () => [];
  ${body}
`;
const runChild = code => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); return result;
};

test("process exit before/after reservation preserves accounting and requires explicit recovery", async () => {
  const s = setup(); s.init(); const before = authority(s);
  runChild(childCode(s, 'options.readRequest = () => process.exit(0); await assessRoutingInvocation(options);'));
  assert.equal(s.record().attempts.length, 0); unchanged(s, before);
  runChild(childCode(s, 'await assessRoutingInvocation(options, {adapter: {...jev, assess: () => process.exit(0)}, fetch: () => {throw Error("must not call");}});'));
  assert.equal(s.record().attempts.length, 1); assert.equal(s.record().attempts[0].status, "reserved"); unchanged(s, before);
  const b = boundary(s); human(await b.run()); assert.equal(b.seen.length, 0);
  const auth = kind => ({ worktree: s.worktree, ticket: "1.1", authorization: { by: "human", ticket: "1.1", kind, direction: "Recover interrupted synthetic invocation" } });
  assert.equal(recoverRoutingLock(auth("recover-lock")).ok, true);
  human(await b.run()); assert.equal(s.record().attempts.length, 1, "lock recovery never refunds a reservation");
  const reconcile = auth("reconcile"); Object.assign(reconcile.authorization, { allowance: 2, consumed: 0 });
  assert.equal(authorizeRoutingAllowance(reconcile).ok, false);
  reconcile.authorization.consumed = 1; assert.equal(authorizeRoutingAllowance(reconcile).ok, true);
  assert.equal(s.record().attempts[0].failure, "interrupted");
  assert.equal((await b.run()).recommendation, "tester"); assert.equal(b.seen.length, 1); assert.equal(s.record().attempts.length, 2); unchanged(s, before);
});

test("shared live/dead/malformed checkpoint ownership fails closed through coordinator invocation", async t => {
  const s = setup(); s.init(); const before = authority(s), b = boundary(s);
  const recovery = { by: "human", kind: "recover-checkpoint-lock", direction: "Recover dead synthetic checkpoint writer" };
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { mutateCheckpoint } from ${JSON.stringify(checkpointURL)};
    mutateCheckpoint(${JSON.stringify(s.path)}, () => { process.stdout.write("locked"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000); return {}; });
  `], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL")); const exited = once(child, "exit");
  let readinessTimer;
  try {
    await Promise.race([once(child.stdout, "data"), exited.then(() => { throw Error("synthetic lock owner exited before readiness"); }),
      new Promise((_, reject) => { readinessTimer = setTimeout(() => reject(Error("synthetic lock owner readiness timeout")), 10000); })]);
  } finally { clearTimeout(readinessTimer); }
  human(await b.run()); assert.equal(b.seen.length, 0); assert.equal(s.record().attempts.length, 0);
  assert.equal(recoverCheckpointLock(s.path, recovery).reason, "live-lock-owner");
  child.kill("SIGKILL"); await exited;
  human(await b.run()); assert.equal(b.seen.length, 0, "dead owner is not stolen on timeout");
  assert.equal(recoverCheckpointLock(s.path, recovery).ok, true); unchanged(s, before);
  // Crash while holding the lock before a reservation is committed.
  runChild(`import {mutateCheckpoint} from ${JSON.stringify(checkpointURL)}; mutateCheckpoint(${JSON.stringify(s.path)}, () => process.exit(0));`);
  assert.equal(s.record().attempts.length, 0); assert.equal(recoverCheckpointLock(s.path, recovery).ok, true);
  // Accidental nesting refuses synchronously rather than deadlocking.
  mutateCheckpoint(s.path, () => { assert.throws(() => mutateCheckpoint(s.path, () => ({})), /busy|interrupted/); return {}; });
  const { readdirSync } = await import("node:fs");
  runChild(`import {mutateCheckpoint} from ${JSON.stringify(checkpointURL)}; mutateCheckpoint(${JSON.stringify(s.path)}, () => process.exit(0));`);
  const locks = join(s.worktree, ".pathfinder/checkpoint-writes");
  const ownerPath = join(locks, readdirSync(locks).find(n => n.endsWith(".lock")), "owner.json");
  const owner = readFileSync(ownerPath, "utf8"); writeFileSync(ownerPath, "{}");
  assert.equal(recoverCheckpointLock(s.path, recovery).ok, false); human(await b.run()); assert.equal(b.seen.length, 0);
  writeFileSync(ownerPath, owner); assert.equal(recoverCheckpointLock(s.path, recovery).ok, true);
  assert.equal((await b.run()).recommendation, "tester"); assert.equal(b.seen.length, 1); unchanged(s, before);
});


test("retired content cannot be relabeled, incomplete follow-up blocks assessment, and only fresh evidence completes it", async () => {
  const s = setup(); s.init(); const b = boundary(s); await b.run();
  const request = direction(s, "adversary"); assert.equal(apply(s, request).ok, true);
  const record = applicableFollowups(readFollowups(s.text()).records, s.experiments, "adversary").at(-1);
  const experiments = structuredClone(s.experiments);
  experiments.followup = { id: record.id, concern: followupDigest(record.request.concern), response: "Investigated repeated boundary input", experiments_digest: record.experiments_digest };
  assert.throws(() => replaceExperimentReport(s.text(), experiments), /relabeling/);
  experiments.experiments[0].steps.push("Repeat the boundary input independently");
  writeFileSync(s.path, replaceExperimentReport(s.text(), experiments));
  assert.equal(stage(s).session, "review"); human(await b.run()); assert.equal(b.seen.length, 1);
  assert.equal(orchestrate(["stage", "1.1", "--advance", "--gh", s.gh], { root: s.root }).status, 0);
  const findings = structuredClone(s.findings);
  findings.followup = { id: record.id, concern: followupDigest(record.request.concern), response: "Independently checked repeated boundary input", experiments_digest: followupDigest(experiments) };
  assert.throws(() => replaceFindingsReport(s.text(), findings), /relabeling/);
  findings.verification.push("Independently exercised repeated boundary input");
  const stale = structuredClone(findings); stale.followup.concern = "a".repeat(64);
  assert.throws(() => replaceFindingsReport(s.text(), stale), /concern/);
  writeFileSync(s.path, replaceFindingsReport(s.text(), findings));
  assert.equal(stage(s).state, "done");
  // A new human concern retires the just-completed evidence again. Neither old
  // report nor the old direction/cache can silently satisfy this new cycle.
  const next = direction(s, "tester"); next.concern.id = "new-boundary-concern";
  assert.equal(apply(s, next).ok, true); assert.equal(apply(s, request).ok, false);
  assert.throws(() => replaceFindingsReport(s.text(), findings), /retired|concern/);
  human(await b.run()); assert.equal(b.seen.length, 1); assert.notEqual(stage(s).state, "done");
});
