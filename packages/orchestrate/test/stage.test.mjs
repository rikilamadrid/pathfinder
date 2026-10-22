import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { after, describe, it } from "node:test";
import { replaceExperimentReport } from "../../../skills/orchestrate/engine/experiments.mjs";
import { DEFERRED_CLASSES, readFindingsReport, renderFindingsReport, replaceFindingsReport, validateFindingsReport } from "../../../skills/orchestrate/engine/findings.mjs";
import { PROTOCOLS } from "../../../skills/orchestrate/engine/brief.mjs";
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
/** A findings report whose findings carry stable ids, as a checkpoint write requires. */
const identified = (report, ...ids) => ({ ...report, findings: report.result === "PASS" ? [] : (ids.length ? ids : ["invalid-input"]).map((id) => ({ ...report.findings[0], id })) });
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
    assert.notEqual(run(identified(s.review()), s.root).status, 0); assert.equal(readFileSync(s.path, "utf8"), original);
    assert.equal(run(identified(s.review())).status, 0);
    const checkpoint = readFileSync(s.path, "utf8"); assert.ok(checkpoint.startsWith(original));
    assert.deepEqual(readFindingsReport(checkpoint).report, identified(s.review()));
    for (const key of Object.keys(s.review())) { const bad = s.review(); delete bad[key]; assert.equal(validateFindingsReport(bad).ok, false, key); }
    for (const change of [(r) => r.findings = {}, (r) => r.findings[0].evidence = ["bad:log"], (r) => r.verification = [], (r) => r.limits = "x".repeat(2049), (r) => r.result = "accepted"]) {
      const bad = s.review(); change(bad); assert.equal(validateFindingsReport(bad).ok, false); assert.notEqual(run(bad).status, 0); assert.equal(readFileSync(s.path, "utf8"), checkpoint);
    }
  });
});

describe("engine-held repair budget and stable finding identity", () => {
  const checkpoint = (s) => readFileSync(s.path, "utf8");
  const line = (s, name) => (new RegExp(`^- ${name}: (.*)$`, "m").exec(checkpoint(s)) ?? [])[1] ?? null;
  const tool = (s, report) => spawnSync(process.execPath, [join(ENGINE_ROOT, "findings.mjs"), "--checkpoint"], { cwd: s.worktree, input: JSON.stringify(report), encoding: "utf8" });
  /** Experiments at the current head, then Tester findings with these ids, then advance. */
  const reviewed = (s, ...ids) => {
    s.experiments(); assert.equal(s.stage("--advance").state, "review");
    s.findings(identified(s.review(), ...ids));
    return s.stage("--advance");
  };
  /** The owning Developer starts, commits and completes the pending repair. */
  const repaired = (s) => {
    const origin = s.sha();
    assert.equal(s.begin().status, 0); s.commit();
    s.set({ State: "adversary", Adversary: "required", Review: "ordinary", Repair: `completed:${origin}` });
    assert.equal(s.stage("--advance").session, "adversary");
    return origin;
  };
  const adversary = () => { const s = setup(); s.set({ State: "adversary", Review: "ordinary" }); return s; };

  it("counts the first and second repairs and gates the third with its ids and no session", () => {
    const s = adversary();
    const first = reviewed(s, "invalid-input");
    assert.equal(first.session, "repair"); assert.equal(first.rounds, 1);
    assert.equal(line(s, "Repair rounds"), "1");
    repaired(s);
    assert.equal(line(s, "Resolved findings"), "invalid-input", "a completed repair resolves its report's ids");
    const second = reviewed(s, "empty-name");
    assert.equal(second.session, "repair"); assert.equal(second.rounds, 2);
    assert.equal(line(s, "Repair rounds"), "2");
    repaired(s);
    assert.equal(line(s, "Resolved findings"), "invalid-input, empty-name");
    const origin = s.sha();
    const third = reviewed(s, "long-name", "unicode-name");
    assert.equal(third.session, null, "no repair is dispatched past the budget");
    assert.equal(third.state, "human-gate");
    assert.equal(third.gate, "repair budget exhausted after 2 rounds: long-name, unicode-name");
    assert.equal(line(s, "State"), "human-gate");
    assert.equal(line(s, "Gate stage"), "repair");
    assert.equal(line(s, "Gate"), "repair budget exhausted after 2 rounds: long-name, unicode-name");
    assert.equal(line(s, "Repair"), `pending:${origin}`);
    assert.equal(line(s, "Repair rounds"), "3");
    assert.match(s.run("stage", "1.1").stderr, /human gate: repair budget exhausted/);
    for (const harness of ["manual", "claude-code", "codex"]) assert.match(s.run("brief", "1.1", "--approval", APPROVAL, "--session", "repair", "--harness", harness).stderr, /human gate: repair budget exhausted/);
    assert.equal(s.begin().status, 1, "the Developer cannot start a repair the gate holds");
    // Resolving the gate resumes exactly that counted repair, never a fourth.
    assert.equal(s.run("gate", "1.1", "open", "--question", third.gate).status, 0);
    assert.equal(s.run("gate", "1.1", "resolve", "--answer", "one more repair").status, 0);
    const resumed = s.stage("--advance");
    assert.equal(resumed.session, "repair"); assert.equal(resumed.rounds, 3);
    assert.equal(line(s, "Repair rounds"), "3");
    repaired(s);
    assert.equal(reviewed(s, "fourth-defect").gate, "repair budget exhausted after 3 rounds: fourth-defect");
  });

  it("gates an unknown count instead of guessing one", () => {
    for (const recorded of [null, "many", "-1"]) {
      const s = adversary(); s.experiments(); s.stage("--advance");
      s.set({ Repair: `completed:${"b".repeat(40)}`, ...(recorded === null ? {} : { "Repair rounds": recorded }) });
      s.findings(identified(s.review(), "invalid-input"));
      const before = checkpoint(s);
      const plain = s.stage();
      assert.equal(plain.session, null); assert.equal(plain.gate, "repair round count unknown: invalid-input");
      assert.equal(checkpoint(s), before, "selection without --advance writes nothing");
      const gated = s.stage("--advance");
      assert.equal(gated.state, "human-gate"); assert.equal(gated.session, null);
      assert.equal(line(s, "Gate"), "repair round count unknown: invalid-input");
      assert.equal(line(s, "Gate stage"), "repair");
      assert.equal(line(s, "Repair rounds"), recorded, "an unknown count is never written as a number");
    }
    const legacy = adversary(); legacy.experiments(); legacy.stage("--advance");
    legacy.set({ Repair: `completed:${"b".repeat(40)}` }); legacy.findings();
    assert.equal(legacy.stage().gate, "repair round count unknown: #1", "a legacy report without ids still names its findings");
  });

  it("never double-counts a pending or restarted started repair of the same origin", () => {
    const s = adversary();
    assert.equal(reviewed(s, "invalid-input").rounds, 1);
    assert.equal(s.stage("--advance").rounds, 1, "re-advancing a pending repair does not count again");
    assert.equal(s.begin().status, 0); s.commit();
    const restarted = s.stage("--advance");
    assert.equal(restarted.session, "repair"); assert.equal(restarted.started, true); assert.equal(restarted.rounds, 1);
    assert.equal(s.begin().status, 0);
    assert.equal(line(s, "Repair rounds"), "1");
    // A started repair recorded before the engine held the count stays unknown.
    const legacy = adversary(); reviewed(legacy, "invalid-input");
    writeFileSync(legacy.path, checkpoint(legacy).replace(/^- Repair rounds:.*\n/m, ""));
    const continued = legacy.stage("--advance");
    assert.equal(continued.session, "repair"); assert.equal(continued.rounds, null);
    assert.equal(line(legacy, "Repair rounds"), null);
  });

  it("requires a finding id when writing and still reads a legacy report without one", () => {
    const s = setup(); const original = checkpoint(s);
    const legacy = s.review();
    assert.equal(validateFindingsReport(legacy).ok, true, "legacy report shape is still valid");
    assert.deepEqual(readFindingsReport(replaceFindingsReport(original, legacy)).report, legacy, "legacy report still reads");
    const refused = tool(s, legacy);
    assert.notEqual(refused.status, 0); assert.match(refused.stderr, /finding 1 needs an id/);
    assert.equal(checkpoint(s), original);
    for (const id of ["Bad_ID", "-leading", "a".repeat(49), 7, ""]) {
      const bad = identified(s.review()); bad.findings[0].id = id;
      assert.equal(validateFindingsReport(bad).ok, false, String(id));
      assert.notEqual(tool(s, bad).status, 0); assert.equal(checkpoint(s), original);
    }
    const duplicate = identified(s.review(), "same-defect", "same-defect");
    assert.match(validateFindingsReport(duplicate).errors.join(), /duplicate finding id: same-defect/);
    assert.equal(tool(s, identified(s.review(), "a".repeat(48), "x")).status, 0);
  });

  it("refuses a resolved id without reopened evidence and accepts it with that evidence", () => {
    const s = setup();
    assert.equal(tool(s, identified(s.review(), "invalid-input", "empty-name")).status, 0);
    const origin = s.sha(); s.commit();
    s.set({ State: "adversary", Repair: `completed:${origin}` });
    const before = checkpoint(s);
    const again = identified(s.review(), "invalid-input");
    const refused = tool(s, again);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /finding id invalid-input was resolved by a completed repair; reopen it only with reopened/);
    assert.equal(checkpoint(s), before, "nothing was written");
    for (const reopened of [{}, { because: "regressed" }, { because: "regressed", evidence: ["bad:log"] }, { because: "", evidence: ["cmd:node example"] }, { because: "regressed", evidence: ["cmd:node example"], extra: true }]) {
      const bad = identified(s.review(), "invalid-input"); bad.findings[0].reopened = reopened;
      assert.equal(validateFindingsReport(bad).ok, false, JSON.stringify(reopened));
      assert.notEqual(tool(s, bad).status, 0); assert.equal(checkpoint(s), before);
    }
    const withoutId = s.review(); withoutId.findings[0].reopened = { because: "regressed", evidence: ["cmd:node example"] };
    assert.match(validateFindingsReport(withoutId).errors.join(), /reopened requires the finding's id/);
    again.findings[0].reopened = { because: "the empty-input case fails again at the new head", evidence: ["cmd:node example --empty"] };
    const accepted = tool(s, again);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.deepEqual(readFindingsReport(checkpoint(s)).report, again);
    assert.equal(line(s, "Resolved findings"), "invalid-input, empty-name", "resolved ids survive the report that replaced theirs");
    assert.equal(tool(s, identified(s.review(), "unrelated-defect")).status, 0, "an unresolved id needs no reopening");
    const recorded = tool(s, identified(s.review(), "empty-name"));
    assert.notEqual(recorded.status, 0, "a recorded resolved id stays resolved after its report is gone");
    assert.match(recorded.stderr, /finding id empty-name was resolved/);
  });
});

describe("classified findings and convergent worker protocols", () => {
  const checkpoint = (s) => readFileSync(s.path, "utf8");
  const line = (s, name) => (new RegExp(`^- ${name}: (.*)$`, "m").exec(checkpoint(s)) ?? [])[1] ?? null;
  const tool = (s, report) => spawnSync(process.execPath, [join(ENGINE_ROOT, "findings.mjs"), "--checkpoint"], { cwd: s.worktree, input: JSON.stringify(report), encoding: "utf8" });
  const item = (id, cls = "polish", note = "a clearer message would help") => ({ id, class: cls, location: "example.mjs:2", note });
  const deferring = (report, ...items) => ({ ...report, deferred: items });
  /** A claim in review at its current head, with matching experiments. */
  const inReview = () => { const s = setup(); s.set({ State: "adversary", Review: "ordinary" }); s.experiments(); assert.equal(s.stage("--advance").state, "review"); return s; };
  const brief = (s, session, harness = "manual") => s.run("brief", "1.1", "--approval", APPROVAL, "--session", session, "--harness", harness);

  it("checks deferred shape, class and limits, and keeps findings for blocking defects", () => {
    const s = setup(); const original = checkpoint(s);
    const pass = s.review("PASS");
    for (const cls of DEFERRED_CLASSES) {
      const report = deferring(pass, item("seen", "polish"), item("other", cls, "same as seen"));
      assert.equal(validateFindingsReport(report).ok, true, `${cls}: ${validateFindingsReport(report).errors}`);
    }
    assert.equal(validateFindingsReport(deferring(pass)).ok, true, "an empty deferred list is allowed");
    assert.equal(validateFindingsReport(deferring(identified(s.review(), "invalid-input"), item("wording"))).ok, true, "findings may carry deferred items");
    const twelve = Array.from({ length: 12 }, (_, i) => item(`polish-${i}`));
    assert.equal(validateFindingsReport(deferring(pass, ...twelve)).ok, true);
    assert.match(validateFindingsReport(deferring(pass, ...twelve, item("thirteen"))).errors.join(), /at most 12/);
    assert.match(validateFindingsReport({ ...pass, deferred: {} }).errors.join(), /at most 12/);
    const refused = [
      [item("x", "blocking"), /deferred class must be/],
      [item("x", "Polish"), /deferred class must be/],
      [{ id: "x", class: "polish", location: "a" }, /exactly \{ id, class, location, note \}/],
      [{ ...item("x"), severity: "low" }, /exactly \{ id, class, location, note \}/],
      [{ ...item("x"), note: " " }, /exactly \{ id, class, location, note \}/],
      [item("Bad_ID"), /deferred id must match/],
      [item(7), /deferred id must match/],
      ["not an item", /exactly \{ id, class, location, note \}/],
    ];
    for (const [bad, error] of refused) {
      const report = deferring(pass, bad);
      assert.match(validateFindingsReport(report).errors.join(), error, JSON.stringify(bad));
      assert.notEqual(tool(s, report).status, 0); assert.equal(checkpoint(s), original);
    }
    assert.match(validateFindingsReport(deferring(identified(s.review(), "same"), item("same"))).errors.join(), /duplicate finding id: same/, "one id namespace across findings and deferred");
    assert.match(validateFindingsReport(deferring(pass, item("a"), item("a"))).errors.join(), /duplicate finding id: a/);
    // A duplicate names the id it duplicates: of this report, not itself, not a near miss.
    assert.match(validateFindingsReport(deferring(pass, item("dup", "duplicate", "repeats something"))).errors.join(), /dup must name/);
    assert.match(validateFindingsReport(deferring(pass, item("dup", "duplicate", "same as dup"))).errors.join(), /dup must name/);
    assert.match(validateFindingsReport(deferring(pass, item("seen"), item("dup", "duplicate", "same as seen-again"))).errors.join(), /dup must name/);
    assert.equal(validateFindingsReport(deferring(identified(s.review(), "invalid-input"), item("dup", "duplicate", "Adversary E2 repeats invalid-input"))).ok, true);
    const written = deferring(identified(s.review(), "invalid-input"), item("wording"), item("old-bug", "pre-existing", "present at the base"));
    assert.equal(tool(s, written).status, 0, tool(s, written).stderr);
    assert.deepEqual(readFindingsReport(checkpoint(s)).report, written, "deferred items are kept in the checkpoint");
  });

  it("selects done for a PASS with only non-gating deferred items, which stay in the checkpoint", () => {
    const s = inReview();
    const report = deferring(s.review("PASS"), item("wording"), item("old-bug", "pre-existing", "present at the base"), item("again", "duplicate", "same as wording"));
    assert.equal(tool(s, report).status, 0);
    const done = s.stage("--advance");
    assert.equal(done.state, "done"); assert.equal(done.session, null);
    assert.deepEqual(readFindingsReport(checkpoint(s)).report.deferred, report.deferred);
    assert.equal(line(s, "Gated requirements"), null);
  });

  it("gates an unclear requirement at the current head before repair or done, then sends it back to a fresh Tester", () => {
    for (const result of ["PASS", "findings"]) {
      const s = inReview();
      const report = deferring(result === "PASS" ? s.review("PASS") : identified(s.review(), "invalid-input"), item("wording"), item("empty-policy", "unclear-requirement", "ticket sets no empty-result policy"), item("length-cap", "unclear-requirement", "no length rule"));
      assert.equal(tool(s, report).status, 0);
      const before = checkpoint(s);
      const plain = s.stage();
      assert.equal(plain.state, "human-gate"); assert.equal(plain.session, null);
      assert.equal(checkpoint(s), before, "selection without --advance writes nothing");
      const gated = s.stage("--advance");
      assert.equal(gated.state, "human-gate"); assert.equal(gated.session, null, `${result}: never repair or done`);
      assert.equal(gated.gate, "unclear requirement: empty-policy, length-cap");
      assert.equal(line(s, "State"), "human-gate");
      assert.equal(line(s, "Gate stage"), "review");
      assert.equal(line(s, "Gate"), "unclear requirement: empty-policy, length-cap");
      assert.equal(line(s, "Gated requirements"), "empty-policy, length-cap");
      assert.equal(line(s, "Repair"), null, "no repair is pending"); assert.equal(line(s, "Repair rounds"), null, "a gate is not a repair round");
      assert.deepEqual(readFindingsReport(checkpoint(s)).report, report, "the report and its deferred items are kept");
      for (const session of ["repair", "review"]) assert.match(brief(s, session).stderr, /human gate: unclear requirement/);
      assert.equal(s.run("gate", "1.1", "open", "--question", gated.gate).status, 0);
      assert.equal(s.run("gate", "1.1", "resolve", "--answer", "empty input throws; no length cap").status, 0);
      const fresh = s.stage("--advance");
      assert.equal(fresh.session, "review", "an answered gate goes to a fresh Tester, not the same gate again");
      assert.deepEqual(fresh.clarified, ["empty-policy", "length-cap"]);
      assert.equal(line(s, "State"), "review");
      const text = brief(s, "review").stdout;
      assert.match(text, /A human gate answered unclear requirement empty-policy, length-cap; the decision is in the ticket's latest gate note/);
      const again = tool(s, deferring(s.review("PASS"), item("empty-policy", "unclear-requirement", "still unclear")));
      assert.notEqual(again.status, 0);
      assert.match(again.stderr, /unclear requirement empty-policy was already put to the human at a gate/);
      const answered = deferring(identified(s.review(), "empty-policy"), item("length-cap", "polish", "the human ruled length out of contract"));
      assert.equal(tool(s, answered).status, 0);
      const repair = s.stage("--advance");
      assert.equal(repair.session, "repair", "the clarified requirement became a blocking finding");
      assert.equal(repair.rounds, 1);
      const another = inReview();
      assert.equal(tool(another, deferring(another.review("PASS"), item("q-one", "unclear-requirement", "unstated"))).status, 0);
      another.stage("--advance");
      another.set({ State: "review", "Gated requirements": "q-one" });
      writeFileSync(another.path, checkpoint(another).replace(/^- Gate(?: stage)?:.*\n/gm, ""));
      assert.equal(tool(another, deferring(another.review("PASS"), item("q-two", "unclear-requirement", "another unstated policy"))).status, 0);
      const second = another.stage("--advance");
      assert.equal(second.gate, "unclear requirement: q-two", "a new unclear requirement gates again");
      assert.equal(line(another, "Gated requirements"), "q-one, q-two");
    }
  });

  it("never lets a report carrying an unclear requirement repair or finish", () => {
    const repair = inReview();
    assert.equal(tool(repair, deferring(identified(repair.review(), "invalid-input"), item("policy", "unclear-requirement", "unstated"))).status, 0);
    repair.set({ State: "repair", Repair: `pending:${repair.sha()}`, "Repair rounds": "1" });
    assert.match(repair.run("stage", "1.1", "--advance").stderr, /unclear requirement policy .*never repair/);
    assert.match(brief(repair, "repair").stderr, /unclear requirement policy/);
    const done = inReview();
    assert.equal(tool(done, deferring(done.review("PASS"), item("policy", "unclear-requirement", "unstated"))).status, 0);
    done.set({ State: "done" });
    assert.match(done.run("stage", "1.1").stderr, /unclear requirement policy .*never done/);
    const damaged = inReview();
    assert.equal(tool(damaged, deferring(damaged.review("PASS"), item("policy", "unclear-requirement", "unstated"))).status, 0);
    damaged.set({ "Gated requirements": "Not An Id" });
    assert.match(damaged.run("stage", "1.1").stderr, /Gated requirements carries an invalid id: Not An Id/);
  });

  it("hands a repair the findings and deferred items, repairing only the findings", () => {
    const s = inReview();
    const report = deferring(identified(s.review(), "invalid-input", "empty-name"), item("wording"));
    assert.equal(tool(s, report).status, 0);
    assert.equal(s.stage("--advance").session, "repair");
    const text = brief(s, "repair").stdout;
    assert.match(text, /repair every one of its findings and only those — not its deferred items, which are listed, not repaired/);
    assert.match(text, /"deferred":\[\{"id":"wording"/);
    assert.match(text, /"id":"invalid-input".*"id":"empty-name"/);
  });

  it("names the repaired ids and range to the post-repair Adversary, and resolved ids to the Tester", () => {
    const s = inReview();
    assert.equal(tool(s, identified(s.review(), "invalid-input", "empty-name")).status, 0);
    s.stage("--advance");
    const origin = s.sha();
    assert.equal(s.begin().status, 0); s.commit();
    s.set({ State: "adversary", Adversary: "required", Review: "ordinary", Repair: `completed:${origin}` });
    for (const harness of ["manual", "claude-code", "codex"]) {
      const r = brief(s, "adversary", harness);
      assert.equal(r.status, 0, r.stderr);
    }
    const text = brief(s, "adversary").stdout;
    assert.match(text, new RegExp(`Repaired finding ids: invalid-input, empty-name\\. Repair range: ${origin}\\.\\.${s.sha()}\\.`));
    assert.match(text, /one fresh regression experiment per repaired id/);
    assert.match(text, /at least one experiment on the repair diff/);
    assert.match(text, /never cited or copied as this round's|do not cite or copy them as this round's/);
    s.experiments(); assert.equal(s.stage("--advance").state, "review");
    const review = brief(s, "review").stdout;
    assert.match(review, /Resolved finding ids: invalid-input, empty-name\. A finding naming one again needs reopened/);
    // A first-round Adversary is not told about a repair that never happened.
    const first = setup(); first.set({ State: "adversary", Review: "ordinary" });
    assert.doesNotMatch(brief(first, "adversary").stdout, /Repaired finding ids|Post-repair round/);
    first.experiments(); first.stage("--advance");
    assert.doesNotMatch(brief(first, "review").stdout, /Resolved finding ids/);
  });

  it("carries the self-check, batch repair and targeted-regression steps in the protocols", () => {
    for (const session of ["implementation", "resume"]) {
      const steps = PROTOCOLS[session].join("\n");
      assert.match(steps, /Before DONE, self-check: check each acceptance criterion .* against the diff/);
      assert.match(steps, /Self-check: <command> \| head <sha> \| exit 0 \| criteria <n>\/<n>/);
      assert.ok(PROTOCOLS[session].findIndex((step) => step.includes("Self-check:")) < PROTOCOLS[session].findIndex((step) => step.includes("report DONE:")), "self-check comes before DONE");
    }
    const repair = PROTOCOLS.repair.join("\n");
    assert.match(repair, /Fix every blocking finding of the report in this one session/);
    assert.match(repair, /For each finding id add or name a regression check .* or state why none is possible/);
    assert.match(repair, /Self-check: <command> \| head <sha> \| exit 0 \| addressed <ids>/);
    assert.match(repair, /deferred items are listed, not repaired/);
    const adversary = PROTOCOLS.adversary.join("\n");
    assert.match(adversary, /repaired finding ids and the repair range <reviewed sha>\.\.<head>/);
    assert.match(adversary, /one fresh regression experiment per repaired id and at least one experiment on the repair diff/);
    assert.match(adversary, /Never cite the previous round's experiments as current/);
    const review = PROTOCOLS.review.join("\n");
    assert.match(review, /findings holds blocking defects only/);
    assert.match(review, /deferred items are listed in the report, never dropped/);
    assert.match(review, /pre-existing, polish, unclear-requirement or duplicate/);
    assert.doesNotMatch(review, /\/ticket start|draft pull request|Run \/ticket load/, "review stays review");
  });
});
