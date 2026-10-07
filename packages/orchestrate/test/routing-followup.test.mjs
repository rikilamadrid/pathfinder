import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, describe, it } from "node:test";
import { replaceExperimentReport, renderExperimentReport, readExperimentReport } from "../../../skills/orchestrate/engine/experiments.mjs";
import { replaceFindingsReport, renderFindingsReport, readFindingsReport } from "../../../skills/orchestrate/engine/findings.mjs";
import { updateStateFile } from "../../../skills/orchestrate/engine/statefile.mjs";
import { checkpointDigest, followupDigest, readFollowups } from "../../../skills/orchestrate/engine/followup-record.mjs";
import { mutateCheckpoint, recoverCheckpointLock } from "../../../skills/orchestrate/engine/checkpoint-write.mjs";
import { humanDirectedFollowup } from "../../../skills/orchestrate/engine/routing-followup.mjs";
import { cleanUpTemporaryDirectories, makeProject, orchestrate, prGh, json, runGit } from "../lib/harness.mjs";
after(cleanUpTemporaryDirectories);
const PR = "https://github.com/acme/widgets/pull/7";
function setup() {
  const root = makeProject({ tickets: { "1.1": { title: "A" } } });
  assert.equal(orchestrate(["claim", "1.1"], { root }).status, 0);
  const worktree = join(root, ".pathfinder/worktrees/1.1"), path = join(worktree, "context/current-ticket.md"), gh = prGh(root);
  const sha = () => runGit(["rev-parse", "HEAD"], worktree).trim();
  const text = () => readFileSync(path, "utf8");
  const set = fields => assert.equal(updateStateFile(worktree, { set: fields }).ok, true);
  const run = (...args) => orchestrate([...args, "--gh", gh], { root });
  const stage = (...args) => { const r = run("stage", "1.1", "--json", ...args); assert.equal(r.status, 0, r.stderr); return json(r); };
  const experiment = () => ({ ticket: "1.1", pr: PR, head_sha: sha(), experiments: [{ experiment_id: "edge1", contract: "bounded input", hypothesis: "empty input may escape", setup: "scratch project", steps: ["submit empty input"], expected_result: "reject invalid input", observed_result: "invalid input rejected", evidence: ["cmd:node example"], reproducibility: "twice", potential_impact: "unexpected state", verifier_instruction: "independently repeat" }] });
  const review = (result = "PASS") => ({ ticket: "1.1", pr: PR, head_sha: sha(), result, findings: result === "PASS" ? [] : [{ severity: "high", location: "example.mjs:1", impact: "invalid input accepted", evidence: ["cmd:node example"], repair_instruction: "reject invalid input" }], verification: ["independent reproduction"], limits: "other classes unexplored" });
  const experiments = r => writeFileSync(path, replaceExperimentReport(text(), r));
  const findings = r => writeFileSync(path, replaceFindingsReport(text(), r));
  set({ State: "review", Review: "ordinary" }); experiments(experiment()); findings(review());
  const direction = (target = "tester") => ({ schema: "pathfinder.human-followup/1", ticket: "1.1", pr: PR, head_sha: sha(), target, concern: { id: "boundary-one", summary: "Investigate repeated boundary input" }, checkpoint: checkpointDigest(text()), authorization: { by: "human", kind: "review-follow-up", direction: "Perform fresh investigation of this concern" } });
  const apply = (request = direction(), live = []) => humanDirectedFollowup({ root, request, live, gh });
  const bind = (report, role) => {
    const record = readFollowups(text()).records.at(-1);
    if (role === "tester") report.verification.push("independently exercised repeated boundary input");
    else report.experiments[0].steps.push("repeat boundary input");
    return { ...report, followup: { id: record.id, concern: followupDigest(record.request.concern), response: "Repeated boundary input produced the expected restriction", experiments_digest: role === "tester" ? followupDigest(readExperimentReport(text()).report) : record.experiments_digest } };
  };
  return { root, worktree, path, gh, sha, text, set, run, stage, experiment, review, experiments, findings, direction, apply, bind };
}
describe("human-directed same-head follow-up", () => {
  it("reproduces the old shortcut, then requires fresh Tester evidence at unchanged head", () => {
    const s = setup();
    assert.equal(s.stage("--advance").state, "done", "baseline old same-head reports reach done");
    s.set({ State: "review", Next: "human requests more investigation" });
    assert.equal(s.stage().state, "done", "a prose request alone previously reused old PASS");
    const original = s.text(), old = s.review();
    assert.equal(s.apply().ok, true);
    assert.match(s.text(), /## Historical Tester findings/);
    assert.equal(s.stage().session, "review");
    assert.throws(() => s.findings(old), /fresh report/);
    writeFileSync(s.path, s.text() + "\n" + renderFindingsReport(old));
    assert.equal(s.stage().session, "review", "direct replay is not active authority");
    assert.equal(readFindingsReport(s.text()).ok, false);
    s.findings(s.bind(s.review(), "tester"));
    assert.equal(s.stage("--advance").state, "done");
    assert.ok(s.text().includes(original.slice(original.indexOf("## Execution"), original.indexOf("## Adversary experiments"))), "execution profile retained");
  });
  it("retires both reports for Adversary then requires independent Tester over fresh experiments", () => {
    const s = setup(), oldE = s.experiment(), oldT = s.review();
    assert.equal(s.apply(s.direction("adversary")).ok, true);
    assert.equal(s.stage().session, "adversary");
    assert.match(s.text(), /Historical Adversary experiments/);
    assert.throws(() => s.findings(oldT), /fresh report/);
    assert.throws(() => s.experiments(oldE), /fresh report/);
    writeFileSync(s.path, s.text() + "\n" + renderExperimentReport(oldE) + "\n" + renderFindingsReport(oldT));
    assert.equal(s.stage().session, "adversary");
    const fresh = s.bind(s.experiment(), "adversary"); s.experiments(fresh);
    assert.equal(s.stage("--advance").session, "review");
    const review = s.bind(s.review(), "tester");
    review.followup.experiments_digest = followupDigest(oldE);
    assert.throws(() => s.findings(review), /current experiment/);
    review.followup.experiments_digest = followupDigest(fresh); s.findings(review);
    assert.equal(s.stage().state, "done");
  });
  it("refuses relabeling retired content, stale bindings and historical direction replay", () => {
    const s = setup(), request = s.direction(); assert.equal(s.apply(request).ok, true);
    const bound = s.bind(s.review(), "tester"); bound.verification.pop();
    assert.throws(() => s.findings(bound), /relabeling/);
    const fresh = s.bind(s.review(), "tester"); fresh.followup.concern = "a".repeat(64);
    assert.throws(() => s.findings(fresh), /current human-directed concern/);
    s.findings(s.bind(s.review(), "tester")); s.stage("--advance");
    const second = s.direction(); second.concern.id = "boundary-two";
    assert.equal(s.apply(second).ok, true);
    assert.equal(s.apply(request).ok, false);
    assert.equal(s.stage().session, "review");
  });
  it("requires exact human authorization and rejects provider/cached/Judge-only direction", () => {
    const s = setup(), before = s.text();
    for (const change of [r => delete r.authorization, r => r.authorization.by = "provider", r => r.authorization.kind = "routing-recommendation", r => r.assessment = { likely_route: "tester" }, r => r.authorization.direction = "", r => r.target = "developer", r => r.target = "continue", r => delete r.concern, r => r.ticket = "1.2"]) {
      const r = s.direction(); change(r); assert.equal(s.apply(r).ok, false); assert.equal(s.text(), before);
    }
    assert.equal(s.apply(s.direction(), ["1.1"]).ok, false);
    assert.equal(humanDirectedFollowup({ root: s.root, request: s.direction(), gh: s.gh }).ok, false);
    assert.equal(s.text(), before);
  });
  it("refuses stale PR/head, concern and changed ownership without touching reports", () => {
    const s = setup();
    for (const change of [r => r.pr = PR.replace("7", "8"), r => r.head_sha = "a".repeat(40), r => r.checkpoint = "a".repeat(64)]) {
      const before = s.text(), r = s.direction(); change(r); assert.equal(s.apply(r).ok, false); assert.equal(s.text(), before);
    }
    const r = s.direction(); s.set({ Next: "new concern recorded" });
    assert.equal(s.apply(r).ok, false);
    writeFileSync(s.path, s.text().replace("- Worker: 1.1", "- Worker: 1.2"));
    const before = s.text(); assert.equal(s.apply(s.direction()).ok, false); assert.equal(s.text(), before);
  });
  it("preserves gates, findings-only repair authority and disallowed states", () => {
    for (const state of ["working", "adversary", "repair", "failed", "human-gate"]) {
      const s = setup(); s.set({ State: state }); if (state === "human-gate") s.set({ Gate: "unresolved human choice", "Gate stage": "review" });
      const before = s.text(); assert.equal(s.apply().ok, false); assert.equal(s.text(), before);
    }
    const s = setup(); s.findings(s.review("findings")); const before = s.text();
    assert.equal(s.apply().ok, false); assert.equal(s.text(), before); assert.equal(s.stage().session, "repair");
  });
  it("is atomic/idempotent on interruption, rejects lock contention and preserves other writes", () => {
    const s = setup(), r = s.direction(), before = s.text();
    assert.throws(() => mutateCheckpoint(s.path, () => { throw Error("interrupt before commit"); }), /interrupt/);
    assert.equal(s.text(), before); assert.equal(s.stage().state, "done");
    mutateCheckpoint(s.path, () => { assert.equal(s.apply(r).ok, false); return {}; });
    assert.equal(s.text(), before);
    assert.equal(s.apply(r).ok, true); const committed = s.text();
    assert.equal(s.apply(r).duplicate, true); assert.equal(s.text(), committed, "lost acknowledgement resumes without retirement twice");
    s.set({ Last: "concurrent unrelated update" });
    assert.equal(s.apply(r).duplicate, true); assert.match(s.text(), /concurrent unrelated update/);
    assert.equal(s.stage().session, "review");
  });
  it("coordinates real concurrent writes and explicitly recovers an interrupted owner", async () => {
    const s = setup(), request = s.direction();
    const writer = new URL("../../../skills/orchestrate/engine/checkpoint-write.mjs", import.meta.url).href;
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { mutateCheckpoint } from ${JSON.stringify(writer)};
      mutateCheckpoint(${JSON.stringify(s.path)}, latest => {
        process.stdout.write("locked\\n");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
        return {text: latest + "\\n## Concurrent note\\n\\nretained\\n"};
      });
    `]);
    const exited = once(child, "exit");
    await once(child.stdout, "data");
    assert.equal(s.apply(request).ok, false, "live checkpoint writer is never overwritten");
    assert.equal((await exited)[0], 0);
    assert.match(s.text(), /Concurrent note/);
    assert.equal(s.apply(request).ok, false, "old direction cannot silently acquire new checkpoint bytes");
    const latest = s.direction();
    const interrupted = spawn(process.execPath, ["--input-type=module", "-e", `
      import { mutateCheckpoint } from ${JSON.stringify(writer)};
      mutateCheckpoint(${JSON.stringify(s.path)}, () => process.exit(0));
    `]);
    await once(interrupted, "exit");
    assert.equal(s.apply(latest).ok, false, "interrupted lock requires explicit recovery");
    assert.equal(recoverCheckpointLock(s.path, {by: "human", kind: "recover-checkpoint-lock", direction: "recover dead writer"}).ok, true);
    assert.equal(s.apply(latest).ok, true);
    assert.match(s.text(), /Concurrent note/);
    assert.equal(s.stage().session, "review");
  });
  it("keeps fresh confirmed findings as the sole Developer repair authority", () => {
    const s = setup(); assert.equal(s.apply().ok, true);
    s.findings(s.bind(s.review("findings"), "tester"));
    assert.equal(s.stage("--advance").session, "repair");
    const begin = orchestrate(["stage", "1.1", "--begin-repair", "--gh", s.gh], { root: s.root, cwd: s.worktree });
    assert.equal(begin.status, 0, begin.stderr);
    assert.match(s.text(), /Repair: started:/);
  });
  it("changed head requires ordinary fresh evidence and never revives same-head PASS", () => {
    const s = setup(), r = s.direction(); assert.equal(s.apply(r).ok, true);
    writeFileSync(join(s.worktree, "change.txt"), "new code"); runGit(["add", "change.txt"], s.worktree); runGit(["commit", "-qm", "change"], s.worktree);
    assert.equal(s.apply(r).ok, false);
    s.set({ State: "adversary" }); assert.equal(s.stage().session, "adversary");
    s.experiments(s.experiment()); s.stage("--advance"); assert.equal(s.stage().session, "review");
    s.findings(s.review()); assert.equal(s.stage().state, "done");
  });
  it("CLI changes only checkpoint authority; briefs carry fresh concern without dispatch", () => {
    const s = setup(), request = s.direction("adversary"), input = join(s.worktree, "direction.json"); writeFileSync(input, JSON.stringify(request));
    const branch = runGit(["rev-parse", "HEAD"], s.worktree), claim = runGit(["rev-parse", "refs/pathfinder/claims/1.1"], s.root);
    assert.notEqual(s.run("followup", "1.1", "--request", input).status, 0);
    const result = s.run("followup", "1.1", "--request", input, "--live", "", "--json"); assert.equal(result.status, 0, result.stderr);
    assert.equal(json(result).ok, true);
    const brief = s.run("brief", "1.1", "--session", "adversary", "--harness", "manual"); assert.equal(brief.status, 0, brief.stderr);
    assert.match(brief.stdout, /Human-directed fresh review/);
    assert.equal(runGit(["rev-parse", "HEAD"], s.worktree), branch); assert.equal(runGit(["rev-parse", "refs/pathfinder/claims/1.1"], s.root), claim);
    assert.equal(s.stage().session, "adversary"); assert.doesNotMatch(s.text(), /^- Gate:/m);
  });
  it("corrupt or partially written follow-up records fail closed even with replayed reports", () => {
    const s = setup(); assert.equal(s.apply().ok, true);
    const valid = s.text();
    writeFileSync(s.path, valid.slice(0, valid.indexOf("## Human follow-ups")) + "\n" + renderFindingsReport(s.review()));
    assert.equal(readFindingsReport(s.text()).ok, false, "lost ledger cannot restore historical authority");
    for (const tail of ["\n## Human follow-ups\n\n```json\n{", valid.slice(valid.indexOf("## Human follow-ups"))]) {
      writeFileSync(s.path, valid + tail + "\n" + renderFindingsReport(s.review()));
      assert.equal(readFindingsReport(s.text()).ok, false);
      assert.notEqual(s.run("stage", "1.1", "--advance").status, 0);
    }
  });
});
