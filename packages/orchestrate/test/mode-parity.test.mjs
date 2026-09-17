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
