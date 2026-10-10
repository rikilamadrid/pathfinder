import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { after, describe, it } from "node:test";
import { replaceExperimentReport } from "../../../skills/orchestrate/engine/experiments.mjs";
import { readFindingsReport, renderFindingsReport, replaceFindingsReport, validateFindingsReport } from "../../../skills/orchestrate/engine/findings.mjs";
import { updateStateText } from "../../../skills/orchestrate/engine/statefile.mjs";
import { cleanUpTemporaryDirectories, ENGINE_ROOT, makeProject, orchestrate, prGh, json, runGit } from "../lib/harness.mjs";
after(cleanUpTemporaryDirectories);

/** Every brief needs the human approval scope the run was granted; the engine never defaults it. */
const APPROVAL = "execution of this Feature's tickets in this round; no merges";
const PR = "https://github.com/acme/widgets/pull/7";
function setup() {
  const root = makeProject({ tickets: { "1.1": { title: "A" }, "1.2": { title: "B" } } });
  assert.equal(orchestrate(["claim", "1.1"], { root }).status, 0);
  const worktree = join(root, ".pathfinder/worktrees/1.1");
  const path = join(worktree, "context/current-ticket.md");
  const gh = prGh(root);
  const run = (...args) => orchestrate([...args, "--gh", gh], { root });
  const begin = () => orchestrate(["stage", "1.1", "--begin-repair", "--json", "--gh", gh], { root, cwd: worktree });
  const sha = () => runGit(["rev-parse", "HEAD"], worktree).trim();
  const set = (fields) => writeFileSync(path, updateStateText(readFileSync(path, "utf8"), { set: fields }));
  const stage = (...args) => { const r = run("stage", "1.1", "--json", ...args); assert.equal(r.status, 0, r.stderr); return json(r); };
  const experiment = (head = sha()) => ({ ticket: "1.1", pr: PR, head_sha: head, experiments: [{ experiment_id: "edge1", contract: "bounded input", hypothesis: "empty input may escape", setup: "scratch project", steps: ["submit empty input"], expected_result: "reject invalid input", observed_result: "invalid input rejected", evidence: ["cmd:node example"], reproducibility: "twice; other inputs unexplored", potential_impact: "if accepted unexpected state could persist", verifier_instruction: "independently repeat" }] });
  const review = (result = "findings", head = sha()) => ({ ticket: "1.1", pr: PR, head_sha: head, result, findings: result === "PASS" ? [] : [{ severity: "high", location: "example.mjs:1", impact: "input escapes contract", evidence: ["cmd:node example"], repair_instruction: "reject this invalid input" }], verification: ["independent reproduction and required ticket checks"], limits: "other input classes not explored" });
  const experiments = (r = experiment()) => writeFileSync(path, replaceExperimentReport(readFileSync(path, "utf8"), r));
  const findings = (r = review()) => writeFileSync(path, replaceFindingsReport(readFileSync(path, "utf8"), r));
  const commit = () => { writeFileSync(join(worktree, "example.txt"), sha()); runGit(["add", "example.txt"], worktree); runGit(["commit", "-qm", "repair"], worktree); };
  return { root, worktree, path, run, begin, sha, set, stage, experiment, review, experiments, findings, commit };
}
describe("recoverable Adversary and Tester delivery", () => {
  it("uses one claim through interrupted implementation, experiments, findings, partial repair and fresh review", () => {
    const s = setup(); const original = readFileSync(s.path, "utf8");
    const profile = original.split("## Execution")[1];
    const claimRef = runGit(["rev-parse", "refs/pathfinder/claims/1.1"], s.root);
    assert.equal(s.stage().session, "resume");
    s.set({ State: "adversary", Review: "ordinary" });
    assert.equal(s.stage().session, "adversary", "stop after Developer never exposes done");
    for (const harness of ["manual", "claude-code", "codex"]) {
      const r = s.run("brief", "1.1", "--approval", APPROVAL, "--session", "adversary", "--harness", harness, "--json");
      assert.equal(r.status, 0, r.stderr); assert.equal(json(r).brief.role, "adversary");
      assert.match(JSON.stringify(json(r).translation), /EXPERIMENTS/);
    }
    writeFileSync(s.path, readFileSync(s.path, "utf8") + "\n## Adversary experiments\n\n```json\n{\n");
    assert.equal(s.stage().session, "adversary", "interrupted report resumes attacker");
    s.experiments();
    assert.equal(s.stage().session, "review", "complete report before state transition survives stop");
    assert.equal(s.stage("--advance").state, "review");
    for (const harness of ["manual", "claude-code", "codex"]) {
      const r = s.run("brief", "1.1", "--approval", APPROVAL, "--session", "review", "--harness", harness, "--json");
      assert.equal(r.status, 0, r.stderr);
      const brief = json(r); assert.equal(brief.brief.role, "tester");
      assert.match(JSON.stringify(brief.translation), /edge1/);
    }
    writeFileSync(s.path, readFileSync(s.path, "utf8") + "\n## Tester findings\n\n```json\n{\n");
    assert.equal(s.stage().session, "review", "missing/incomplete findings do not become invented repairs");
    s.findings();
    assert.equal(s.stage("--advance").session, "repair", "restart after complete findings needs no new Tester");
    assert.equal(s.begin().status, 0);
    const reviewed = s.sha(); s.commit();
    assert.equal(s.stage().session, "repair", "partial repair uses original findings, not current verification");
    const repair = json(s.run("brief", "1.1", "--approval", APPROVAL, "--session", "repair", "--harness", "codex", "--json"));
    assert.match(repair.translation.invocation.arguments.message, new RegExp(reviewed));
    s.set({ State: "adversary", Review: "ordinary", Repair: `completed:${reviewed}` });
    assert.equal(s.stage().session, "adversary", "new head invalidates previous experiment report");
    s.experiments(); s.stage("--advance");
    assert.equal(s.stage().session, "review", "old completed findings cannot restart repair");
    s.findings(s.review("PASS"));
    assert.equal(s.stage("--advance").state, "done");
    assert.equal(s.stage().session, null);
    assert.equal(runGit(["rev-parse", "refs/pathfinder/claims/1.1"], s.root), claimRef);
    assert.ok(readFileSync(s.path, "utf8").includes("## Execution" + profile), "profile preserved through all handoffs");
  });
  it("refuses wrong ticket/PR/SHA, marker loss, stale findings and duplicate live dispatch", () => {
    const s = setup(); s.set({ State: "adversary" });
    for (const field of ["ticket", "pr", "head_sha"]) {
      const report = s.experiment(); report[field] = field === "ticket" ? "1.2" : field === "pr" ? PR.replace("7", "8") : "a".repeat(40);
      s.experiments(report); assert.equal(s.stage().session, "adversary");
      assert.equal(s.run("brief", "1.1", "--approval", APPROVAL, "--session", "review", "--harness", "manual").status, 1);
    }
    s.experiments(); s.stage("--advance"); s.findings(); s.commit();
    assert.match(s.run("stage", "1.1").stderr, /stale Tester findings|SHA-matching Adversary/g);
    s.set({ State: "repair" }); assert.match(s.run("stage", "1.1").stderr, /stale Tester findings|SHA-matching Adversary/g);
    assert.match(s.run("stage", "1.1", "--live", "1.1", "--advance").stderr, /live session/);
    writeFileSync(s.path, readFileSync(s.path, "utf8").replace(/^- Adversary:.*\n/m, ""));
    assert.match(s.run("stage", "1.1").stderr, /compatibility marker/);
    s.set({ Adversary: "nonsense" }); assert.match(s.run("stage", "1.1").stderr, /compatibility marker/);
  });
  it("grandfathers only one actual legacy head and converts on confirmed repair", () => {
    const s = setup(); s.set({ State: "review" });
    writeFileSync(s.path, readFileSync(s.path, "utf8").replace(/^- Adversary:.*\n/m, ""));
    const before = readFileSync(s.path, "utf8");
    assert.equal(s.run("stage", "1.1", "--adopt", "--live", "1.1").status, 1);
    assert.equal(readFileSync(s.path, "utf8"), before);
    assert.equal(s.run("stage", "1.1", "--adopt").status, 0);
    assert.equal(s.stage().legacy, true);
    assert.equal(s.run("stage", "1.1", "--adopt").status, 1, "classified only once");
    s.findings(); s.stage("--advance");
    assert.match(readFileSync(s.path, "utf8"), /^- Adversary: required$/m);
    s.set({ State: "adversary", Repair: `completed:${s.sha()}` }); s.commit();
    assert.equal(s.stage().session, "adversary");
    const pass = setup(); pass.set({ State: "review", Adversary: `legacy-review:${pass.sha()}` });
    pass.findings(pass.review("PASS")); assert.equal(pass.stage("--advance").state, "done");
    pass.commit(); pass.set({ State: "review", Review: `integration:${pass.sha()}`, Next: `verification and push complete at ${pass.sha()}; Tester pending` });
    assert.equal(pass.stage().integration, true, "legacy PASS does not force attacker for unchanged integration refresh");
    const stale = setup(); stale.set({ State: "review", Adversary: `legacy-review:${stale.sha()}` }); stale.commit();
    assert.equal(stale.stage("--advance").session, "adversary");
  });
  it("records integration-only head, preserves refresh strategy and requires fresh Tester", () => {
    for (const session of ["merge-and-reverify", "rebase-and-reverify"]) {
      const s = setup(); s.set({ Next: `${session} target ${s.sha()}; full verification pending; future Tester` });
      assert.equal(s.stage().session, session);
      const text = s.run("brief", "1.1", "--approval", APPROVAL, "--session", session, "--harness", "manual").stdout;
      assert.match(text, /rerun every check|rerun every check/);
      assert.match(text, /If behavior changed/); assert.match(text, /never set done before fresh Tester/);
      s.set({ State: "review", Review: `integration:${s.sha()}`, Next: `verification and push complete at ${s.sha()}; Tester pending` });
      assert.equal(s.stage().integration, true, "unchanged behavior skips attacker despite old/missing report");
      s.findings(s.review("PASS")); assert.equal(s.stage("--advance").state, "done");
      s.commit(); assert.match(s.run("stage", "1.1").stderr, /current PR head|full revalidation/);
      s.set({ State: "review" }); assert.match(s.run("stage", "1.1").stderr, /full revalidation/);
      s.set({ State: "adversary", Review: "ordinary" }); assert.equal(s.stage().session, "adversary");
    }
  });
  it("keeps a gated verification phase and accounts for adversary/repair worker slots", () => {
    const s = setup(); s.set({ State: "adversary" });
    assert.equal(json(s.run("status", "--json")).rows[0].state, "stale");
    assert.equal(json(s.run("status", "--live", "1.1", "--json")).rows[0].state, "adversary");
    assert.equal(json(s.run("plan", "--workers", "1", "--live", "1.1", "--json")).dispatch.length, 0);
    assert.equal(s.run("gate", "1.1", "open", "--question", "Q?").status, 0);
    assert.equal(s.run("gate", "1.1", "resolve", "--answer", "proceed").status, 0);
    assert.equal(s.stage().session, "adversary");
    s.experiments(); s.stage("--advance");
    s.set({ "Gate stage": "review", State: "human-gate", Gate: "Tester question?" });
    assert.equal(s.run("gate", "1.1", "open", "--question", "Tester question?").status, 0);
    assert.equal(s.run("gate", "1.1", "resolve", "--answer", "contract clarified").status, 0);
    assert.equal(s.stage().session, "review", "worker-opened gate retains Tester phase");
  });
  it("refuses head drift after pending repair advancement until the owning worker starts", () => {
    const pending = setup(); pending.set({ State: "adversary", Review: "ordinary" });
    pending.experiments(); pending.stage("--advance"); pending.findings();
    pending.stage("--advance"); const origin = pending.sha();
    assert.match(readFileSync(pending.path, "utf8"), new RegExp(`^- Repair: pending:${origin}$`, "m"));
    assert.equal(pending.run("stage", "1.1", "--begin-repair").status, 1, "coordinator cannot impersonate worker start");
    pending.commit(); const checkpoint = readFileSync(pending.path, "utf8");
    assert.match(pending.run("stage", "1.1", "--advance").stderr, /stale Tester findings/);
    assert.notEqual(pending.begin().status, 0, "undispatched worker cannot waive changed-head freshness");
    for (const harness of ["manual", "claude-code", "codex"]) assert.equal(pending.run("brief", "1.1", "--approval", APPROVAL, "--session", "repair", "--harness", harness).status, 1);
    assert.equal(readFileSync(pending.path, "utf8"), checkpoint);
    const started = setup(); started.set({ State: "adversary", Review: "ordinary" });
    started.experiments(); started.stage("--advance"); started.findings(); started.stage("--advance");
    const begun = orchestrate(["stage", "1.1", "--begin-repair", "--live", "1.1", "--gh", prGh(started.root)], { root: started.root, cwd: started.worktree });
    assert.equal(begun.status, 0, begun.stderr);
    const reviewed = started.sha(); started.commit();
    assert.equal(started.stage().started, true); assert.equal(started.stage().report.head_sha, reviewed);
    assert.equal(started.begin().status, 0, "restarted owning repair keeps original handoff idempotently");
  });
  it("retains validated integration repair origin after partial commits and Next progress updates", () => {
    for (const source of ["integration", "ordinary", "legacy"]) {
      const s = setup(); const origin = s.sha();
      s.set({ State: "review", Review: source === "integration" ? `integration:${origin}` : "ordinary",
        Adversary: source === "legacy" ? `legacy-review:${origin}` : "required" });
      if (source === "ordinary") s.experiments();
      s.findings();
      if (source === "integration") {
        const before = readFileSync(s.path, "utf8");
        assert.match(s.run("stage", "1.1", "--advance").stderr, /completed full verification/);
        assert.equal(readFileSync(s.path, "utf8"), before);
        s.set({ Next: `verification and push complete at ${origin}; Tester pending` });
      }
      s.stage("--advance");
      if (source === "integration") {
        s.set({ Next: "repair progress; verification not complete" });
        const pending = readFileSync(s.path, "utf8");
        assert.notEqual(s.begin().status, 0, "pending cannot consume unvalidated completion");
        assert.equal(readFileSync(s.path, "utf8"), pending);
        s.set({ Next: `verification and push complete at ${origin}; Tester pending` });
      }
      assert.equal(s.begin().status, 0);
      s.commit(); s.set({ Next: "partial repair committed; remaining repair and full verification pending" });
      const preserved = readFileSync(s.path, "utf8");
      assert.equal(s.stage().started, true);
      assert.equal(s.stage().report.head_sha, origin);
      assert.equal(s.begin().status, 0, "owning resumed repair is idempotent after progress update");
      for (const harness of ["manual", "claude-code", "codex"]) {
        const brief = s.run("brief", "1.1", "--approval", APPROVAL, "--session", "repair", "--harness", harness, "--json");
        assert.equal(brief.status, 0, brief.stderr);
        assert.match(JSON.stringify(json(brief).translation), new RegExp(origin));
      }
      assert.deepEqual(readFindingsReport(readFileSync(s.path, "utf8")).report, readFindingsReport(preserved).report);
      if (source === "integration") {
        s.set({ Review: `integration:${s.sha()}` });
        assert.match(s.run("stage", "1.1").stderr, /full revalidation/);
        s.set({ Review: `integration:${origin}` });
      }
      s.set({ State: "adversary", Adversary: "required", Review: "ordinary", Repair: `completed:${origin}` });
      assert.equal(s.stage().session, "adversary", "changed behavior requires fresh experiments");
    }
  });
  it("recovers failed phases only with explicit human guidance and their recorded origin", () => {
    for (const phase of ["working", "adversary", "review", "repair", "integration-refresh"]) {
      const s = setup();
      if (phase === "working") s.set({ State: "working" });
      if (phase === "adversary") s.set({ State: "adversary" });
      if (phase === "review" || phase === "repair") {
        s.set({ State: "adversary", Review: "ordinary" }); s.experiments(); s.stage("--advance");
        if (phase === "repair") { s.findings(); s.stage("--advance"); assert.equal(s.begin().status, 0); s.commit(); }
      }
      if (phase === "integration-refresh") s.set({ State: "working", Next: `merge-and-reverify target ${s.sha()}; update/verification pending` });
      const profile = readFileSync(s.path, "utf8").split("## Execution")[1];
      assert.equal(s.run("state", "1.1", "--set", "failed", "--last", "tool unavailable").status, 0);
      const failed = readFileSync(s.path, "utf8");
      assert.match(failed, /^- Failed stage: (working|adversary|review|repair)$/m);
      assert.equal(s.run("stage", "1.1", "--advance").status, 1);
      assert.equal(s.run("stage", "1.1", "--advance", "--guidance", "retry approved", "--live", "1.1").status, 1);
      assert.equal(readFileSync(s.path, "utf8"), failed);
      const resumed = s.stage("--advance", "--guidance", "retry this same pending phase");
      const expected = phase === "working" ? "resume" : phase === "integration-refresh" ? "merge-and-reverify" : phase;
      assert.equal(resumed.session, expected);
      assert.doesNotMatch(readFileSync(s.path, "utf8"), /^- Failed stage:/m);
      assert.ok(readFileSync(s.path, "utf8").includes("## Execution" + profile));
      const brief = s.run("brief", "1.1", "--approval", APPROVAL, "--session", resumed.session, "--harness", "codex", "--json");
      assert.equal(brief.status, 0, brief.stderr);
    }
    const unknown = setup(); unknown.set({ State: "failed", Last: "review failed; human says retry", Next: "resume Tester" });
    assert.match(unknown.run("stage", "1.1", "--advance", "--guidance", "retry approved").stderr, /recorded Failed stage/);
  });
  it("never lets matching Tester evidence bypass ordinary matching experiments", () => {
    for (const result of ["PASS", "findings"]) for (const experiment of ["missing", "stale"]) for (const converted of [false, true]) {
      const s = setup(); s.set({ State: "review", Review: converted ? `legacy:${s.sha()}` : "ordinary", Adversary: "required" });
      if (experiment === "stale") s.experiments(s.experiment("a".repeat(40)));
      s.findings(s.review(result)); const before = readFileSync(s.path, "utf8");
      assert.match(s.run("stage", "1.1", "--advance").stderr, /SHA-matching Adversary/);
      assert.equal(readFileSync(s.path, "utf8"), before, "findings survive refusal");
      if (result === "PASS") { s.set({ State: "done" }); assert.match(s.run("stage", "1.1").stderr, /SHA-matching Adversary/); }
      else { s.set({ State: "repair", Review: "ordinary", Repair: `started:${s.sha()}` }); assert.match(s.run("stage", "1.1").stderr, /SHA-matching Adversary/); }
    }
  });
  it("keeps adjacent sections and CRLF while refusing interrupted or duplicate reviews", () => {
    const s = setup(); const report = s.review();
    const prefix = "- State: review\r\n\r\n"; const suffix = "\r\n## Notes\r\n\r\nkeep\r\n";
    const text = prefix + renderFindingsReport(report).replace(/\n/g, "\r\n") + suffix;
    const replaced = replaceFindingsReport(text, report);
    assert.ok(replaced.startsWith(prefix)); assert.ok(replaced.endsWith(suffix));
    assert.deepEqual(readFindingsReport(replaced).report, report);
    for (const broken of [renderFindingsReport(report).slice(0, -4), renderFindingsReport(report).repeat(2), renderFindingsReport(report) + "unexpected prose"]) assert.equal(readFindingsReport(broken).ok, false);
    assert.throws(() => replaceFindingsReport(renderFindingsReport(report).repeat(2), report), /duplicate/);
  });
  it("checkpoint tool writes complete bounded review only inside owner worktree", () => {
    const s = setup(); const original = readFileSync(s.path, "utf8");
    const tool = join(ENGINE_ROOT, "findings.mjs");
    const run = (report, cwd = s.worktree) => spawnSync(process.execPath, [tool, "--checkpoint"], { cwd, input: JSON.stringify(report), encoding: "utf8" });
    assert.notEqual(run(s.review(), s.root).status, 0); assert.equal(readFileSync(s.path, "utf8"), original);
    assert.equal(run(s.review()).status, 0);
    const checkpoint = readFileSync(s.path, "utf8"); assert.ok(checkpoint.startsWith(original));
    assert.deepEqual(readFindingsReport(checkpoint).report, s.review());
    for (const key of Object.keys(s.review())) { const bad = s.review(); delete bad[key]; assert.equal(validateFindingsReport(bad).ok, false, key); }
    for (const change of [(r) => r.findings = {}, (r) => r.findings[0].evidence = ["bad:log"], (r) => r.verification = [], (r) => r.limits = "x".repeat(2049), (r) => r.result = "accepted"]) {
      const bad = s.review(); change(bad); assert.equal(validateFindingsReport(bad).ok, false); assert.notEqual(run(bad).status, 0); assert.equal(readFileSync(s.path, "utf8"), checkpoint);
    }
  });
});
