/**
 * Two readers of one marker, kept in step.
 *
 * The installer and the orchestrate engine each read
 * `<!-- pathfinder:execution-mode <value> -->`, and neither can import the
 * other: the engine ships under `skills/` into every project, and the installer
 * is not part of the kit. So the agreement is asserted instead. Every case
 * below goes through both readers and must come back identical on the three
 * fields the lifecycle acts on.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import * as installer from "../../create-pathfinder/src/execution-mode.mjs";
import * as engine from "../../../skills/orchestrate/engine/mode.mjs";

const CASES = [
  ["no file", null],
  ["human-in-the-loop", "# Execution Mode\n\n<!-- pathfinder:execution-mode human-in-the-loop -->\n"],
  ["orchestrator", "<!-- pathfinder:execution-mode orchestrator -->\n"],
  ["unknown value", "<!-- pathfinder:execution-mode autopilot -->\n"],
  ["no marker", "# Execution Mode\n\nprose only\n"],
  ["quoted inline", "It looks like `<!-- pathfinder:execution-mode orchestrator -->` here.\n"],
  ["CRLF and padding", "# M\r\n\r\n  <!--  pathfinder:execution-mode   orchestrator  -->  \r\n"],
  ["first marker wins", "<!-- pathfinder:execution-mode orchestrator -->\n<!-- pathfinder:execution-mode human-in-the-loop -->\n"],
  ["empty file", ""],
];

describe("the installer and the engine read the mode identically", () => {
  it("agree on the constants", () => {
    assert.deepEqual([...engine.EXECUTION_MODES], [...installer.EXECUTION_MODES]);
    assert.equal(engine.DEFAULT_EXECUTION_MODE, installer.DEFAULT_EXECUTION_MODE);
    assert.equal(engine.EXECUTION_MODE_PATH, installer.EXECUTION_MODE_PATH);
  });

  for (const [name, content] of CASES) {
    it(name, () => {
      const a = installer.readExecutionMode(content);
      const b = engine.readExecutionMode(content);
      assert.deepEqual(
        { present: b.present, mode: b.mode, valid: b.valid },
        { present: a.present, mode: a.mode, valid: a.valid },
      );
      assert.equal(engine.effectiveExecutionMode(b), installer.effectiveExecutionMode(a));
    });
  }

  it("agree on what the installer writes", () => {
    for (const mode of installer.EXECUTION_MODES) {
      const reading = engine.readExecutionMode(installer.renderExecutionMode(mode));
      assert.deepEqual(reading, { present: true, mode, valid: true });
    }
  });
});

describe("the installer and the engine agree on the Evidence Judge", () => {
  it("offers only providers the engine ships, and both read none as no judge", async () => {
    const { shippedJudges } = await import("../../../skills/orchestrate/engine/judges/registry.mjs");
    const offered = installer.EVIDENCE_JUDGE_CHOICES.filter((choice) => choice !== engine.NO_EVIDENCE_JUDGE);
    assert.ok(offered.every((name) => shippedJudges().includes(name)), "every offered judge exists");
    assert.deepEqual(Object.keys(installer.EVIDENCE_JUDGE_PROVIDERS), offered);
    for (const [content, expected] of [
      [null, { name: null, explicit: false }],
      ["<!-- pathfinder:execution-mode orchestrator -->\n", { name: null, explicit: false }],
      ["<!-- pathfinder:evidence-judge none -->\n", { name: null, explicit: false }],
      ["<!-- pathfinder:evidence-judge jev -->\n", { name: "jev", explicit: true }],
      ["It says `<!-- pathfinder:evidence-judge jev -->` inline.\n", { name: null, explicit: false }],
    ]) {
      assert.deepEqual(engine.readEvidenceJudgeMarker(content), expected);
      const raw = installer.readEvidenceJudgeMarker(content);
      assert.equal(raw === null || raw === engine.NO_EVIDENCE_JUDGE ? null : raw, expected.name);
    }
  });
});

describe("the installer and the engine read the execution environment identically", () => {
  it("agree on the values and the default", () => {
    assert.deepEqual([...engine.EXECUTION_ENVIRONMENTS], [...installer.EXECUTION_ENVIRONMENTS]);
    assert.equal(engine.DEFAULT_EXECUTION_ENVIRONMENT, installer.DEFAULT_EXECUTION_ENVIRONMENT);
  });

  const cases = [
    ["no file", null],
    ["no line", "<!-- pathfinder:execution-mode orchestrator -->\n"],
    ["local", "<!-- pathfinder:execution-environment local -->\n"],
    ["sandbox", "<!-- pathfinder:execution-environment sandbox -->\n"],
    ["invalid", "<!-- pathfinder:execution-environment cloud -->\n"],
    ["CRLF and padding", "# M\r\n\r\n  <!--  pathfinder:execution-environment   sandbox  -->  \r\n"],
    ["quoted inline", "It says `<!-- pathfinder:execution-environment sandbox -->` here.\n"],
    ["first marker wins", "<!-- pathfinder:execution-environment sandbox -->\n<!-- pathfinder:execution-environment local -->\n"],
    ["list item quoting it", "- <!-- pathfinder:execution-environment sandbox -->\n"],
    ["colon after the name", "<!-- pathfinder:execution-mode orchestrator -->\n<!-- pathfinder:execution-environment: sandbox -->\n"],
    ["equals sign", "<!-- pathfinder:execution-environment=sandbox -->\n"],
    ["extra word", "<!-- pathfinder:execution-environment sandbox (pinned) -->\n"],
    ["text after -->", "  <!-- pathfinder:execution-environment sandbox --> <!-- chosen 2026-11 -->\r\n"],
    ["capitalised prefix", "<!-- Pathfinder:execution-environment sandbox -->\n"],
    ["malformed after a valid line", "<!-- pathfinder:execution-environment local -->\n<!-- pathfinder:execution-environment: sandbox -->\n"],
  ];
  for (const [name, content] of cases) {
    it(name, () => {
      const raw = installer.readExecutionEnvironmentMarker(content);
      const read = engine.readExecutionEnvironmentMarker(content);
      assert.equal(read.explicit, raw !== null);
      assert.equal(read.environment, raw ?? installer.DEFAULT_EXECUTION_ENVIRONMENT);
      assert.equal(read.valid, installer.EXECUTION_ENVIRONMENTS.includes(raw ?? installer.DEFAULT_EXECUTION_ENVIRONMENT));
      if (raw !== null) assert.deepEqual(installer.parseExecutionEnvironmentFlag(raw).error === undefined, read.valid);
      // What the installer would re-render from this file, the engine reads the same way.
      const rendered = installer.renderExecutionMode("orchestrator", { executionEnvironment: raw });
      assert.deepEqual(engine.readExecutionEnvironmentMarker(rendered), read);
    });
  }

  it("agree on what the installer writes, under either mode", () => {
    for (const mode of installer.EXECUTION_MODES) {
      assert.deepEqual(engine.readExecutionEnvironmentMarker(installer.renderExecutionMode(mode)), { environment: "local", explicit: false, valid: true });
      for (const environment of installer.EXECUTION_ENVIRONMENTS) {
        const rendered = installer.renderExecutionMode(mode, { executionEnvironment: environment });
        assert.deepEqual(engine.readExecutionEnvironmentMarker(rendered), { environment, explicit: true, valid: true });
        assert.deepEqual(engine.readExecutionMode(rendered), { present: true, mode, valid: true });
      }
    }
  });
});

describe("the installer keeps the sandbox lines the engine reads", () => {
  it("re-renders the permission mode and agent-auth declaration as the engine reads them", () => {
    for (const [content, permission, auth] of [
      ["<!-- pathfinder:sandbox-permission-mode acceptEdits -->\n<!-- pathfinder:sandbox-agent-auth subscription -->\n", "acceptEdits", "subscription"],
      ["  <!--  pathfinder:sandbox-permission-mode   bypassPermissions -->  \r\n", "bypassPermissions", null],
      ["<!-- pathfinder:sandbox-permission-mode plan -->\n", "plan", null],
      ["says `<!-- pathfinder:sandbox-permission-mode acceptEdits -->` inline\n", null, null],
    ]) {
      const rendered = installer.renderExecutionMode("orchestrator", { executionEnvironment: "sandbox", sandboxMarkers: installer.readSandboxMarkerLines(content) });
      assert.deepEqual(engine.readSandboxPermissionModeMarker(rendered), engine.readSandboxPermissionModeMarker(content));
      assert.deepEqual(engine.readSandboxAgentAuthMarker(rendered), engine.readSandboxAgentAuthMarker(content));
      assert.equal(engine.readSandboxPermissionModeMarker(rendered).mode, permission);
      assert.equal(engine.readSandboxAgentAuthMarker(rendered).value, auth);
    }
  });
});
