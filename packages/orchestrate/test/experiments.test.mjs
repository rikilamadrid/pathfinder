import test from "node:test";
import assert from "node:assert/strict";
import { readExperimentReport, renderExperimentReport, replaceExperimentReport, validateExperimentReport }
  from "../../../skills/orchestrate/engine/experiments.mjs";
import { updateStateText } from "../../../skills/orchestrate/engine/statefile.mjs";

const report = () => ({
  ticket: "55.1", pr: "https://github.com/example/project/pull/7", head_sha: "a".repeat(40),
  experiments: [{
    experiment_id: "boundary-1", contract: "Empty input has a useful error", hypothesis: "Empty input may be accepted silently",
    setup: "A scratch project with no configured tracker", steps: ["Invoke the command with an empty key"],
    expected_result: "An actionable error without a write", observed_result: "An actionable error; no files changed",
    evidence: ["cmd:node command.mjs", "file:README.md#L1-L2"], reproducibility: "Observed twice; other inputs were not explored",
    potential_impact: "If silently accepted, a user could lose the intended ticket selection",
    verifier_instruction: "Repeat on the reported head; check the error and absence of writes",
  }],
});

test("an attempted experiment without a defect round-trips; state updates preserve it", () => {
  const original = "# Current Ticket\n\n- Ticket: 55.1 — scratch\n- State: working\n- Next: review\n\n## Execution\n\n```yaml\nprofile: unchanged\n```\n\n## Notes\n\nKeep these notes.\n";
  const next = replaceExperimentReport(original, report());
  assert.ok(next.startsWith(original));
  assert.deepEqual(readExperimentReport(next), { ok: true, report: report() });
  assert.deepEqual(readExperimentReport(updateStateText(next, { set: { State: "review", Last: "Reported" } })), { ok: true, report: report() });
  const newer = report(); newer.head_sha = "b".repeat(40);
  const replaced = replaceExperimentReport(next, newer);
  assert.ok(replaced.startsWith(original));
  assert.deepEqual(readExperimentReport(replaced).report, newer);
});

test("replacement preserves following sections and CRLF claim fields", () => {
  const prefix = "- Worker: 55.1\r\n- State: working\r\n\r\n";
  const suffix = "\r\n## Other notes\r\n\r\nDo not lose these.\r\n";
  const text = prefix + renderExperimentReport(report()).replace(/\n/g, "\r\n") + suffix;
  const result = replaceExperimentReport(text, report());
  assert.ok(result.startsWith(prefix));
  assert.ok(result.endsWith(suffix));
  assert.ok(!/(?<!\r)\n/.test(result));
  assert.equal(readExperimentReport(result).ok, true);
});

test("every required experiment field is mandatory", () => {
  for (const field of Object.keys(report().experiments[0])) {
    const missing = report(); delete missing.experiments[0][field];
    assert.equal(validateExperimentReport(missing).ok, false, field);
    assert.throws(() => renderExperimentReport(missing));
  }
});

test("identity, evidence, size, identifiers and verdict fields cannot masquerade as complete", () => {
  const invalid = [
    (r) => { r.head_sha = "abc123"; }, (r) => { r.pr = "7"; }, (r) => { r.ticket = "55"; },
    (r) => { r.experiments = []; }, (r) => { r.experiments.push({ ...r.experiments[0] }); },
    (r) => { r.experiments[0].experiment_id = "finding 1"; },
    (r) => { r.experiments[0].evidence = ["madeup:log"]; },
    (r) => { r.experiments[0].evidence = ["file:README.md#L5-L1"]; },
    (r) => { r.experiments[0].observed_result = "FAIL: the implementation is wrong"; },
    (r) => { r.experiments[0].potential_impact = "A confirmed defect"; },
    (r) => { r.experiments[0].finding_id = "f1"; }, (r) => { r.verdict = "PASS"; },
    (r) => { r.experiments[0].hypothesis = "x".repeat(2049); },
    (r) => { r.experiments[0].steps = Array(20).fill("x".repeat(2048)); },
  ];
  for (const mutate of invalid) { const r = report(); mutate(r); assert.equal(validateExperimentReport(r).ok, false); }
});

test("interrupted, duplicate and ambiguous checkpoints are incomplete", () => {
  const good = renderExperimentReport(report());
  for (const text of ["", good.slice(0, -4), good + good, good + "Extra prose\n", good.replace("```json", "```yaml")]) {
    assert.equal(readExperimentReport(text).ok, false, text.slice(0, 80));
  }
  assert.throws(() => replaceExperimentReport(good + good, report()), /duplicate/);
});
