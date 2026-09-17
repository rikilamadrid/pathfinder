/**
 * The execution mode, read the way `skills/ticket/SKILL.md` §Execution mode
 * says and nowhere else.
 *
 * One marker line in `context/execution-mode.md`:
 *
 *     <!-- pathfinder:execution-mode orchestrator -->
 *
 * No file means `human-in-the-loop`. A file with no valid marker is invalid,
 * and this engine refuses to orchestrate on one rather than guessing.
 *
 * The installer carries a second implementation of this same reading at
 * `packages/create-pathfinder/src/execution-mode.mjs`. The two are kept in
 * step by a parity test in `packages/orchestrate/`, not by importing one from
 * the other: the installer is not part of the kit a project receives, and an
 * engine that shipped under `skills/` cannot reach it.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const EXECUTION_MODES = Object.freeze(["human-in-the-loop", "orchestrator"]);
export const DEFAULT_EXECUTION_MODE = "human-in-the-loop";
export const EXECUTION_MODE_PATH = "context/execution-mode.md";

const MARKER = /^<!--\s*pathfinder:execution-mode\s+(\S+)\s*-->$/;
const POLICY_MARKER = /^<!--\s*pathfinder:routing-policy\s+(\S+)\s*-->$/;

/** The routing policy a project runs when its mode file names none. */
export const DEFAULT_ROUTING_POLICY = "static";

/**
 * @param {string|null} content the file's contents, or null for no file
 * @returns {{present: boolean, mode: string|null, valid: boolean}}
 */
export function readExecutionMode(content) {
  if (content === null || content === undefined) return { present: false, mode: null, valid: false };
  for (const line of String(content).split(/\r?\n/)) {
    const match = MARKER.exec(line.trim());
    if (match) return { present: true, mode: match[1], valid: EXECUTION_MODES.includes(match[1]) };
  }
  return { present: true, mode: null, valid: false };
}

/** Read the project's mode file. Missing is absent; anything unreadable is invalid. */
export function readExecutionModeFile(root) {
  const path = join(root, ...EXECUTION_MODE_PATH.split("/"));
  if (!existsSync(path)) return { present: false, mode: null, valid: false };
  try {
    return readExecutionMode(readFileSync(path, "utf8"));
  } catch {
    return { present: true, mode: null, valid: false };
  }
}

/**
 * The routing policy the mode file names, on its own optional marker line:
 *
 *     <!-- pathfinder:routing-policy <name> -->
 *
 * No file, or no such line, is `static`. Whether the name is a policy this
 * engine ships is the registry's question, not this reader's.
 *
 * @returns {{name: string, explicit: boolean}}
 */
export function readRoutingPolicy(root) {
  const path = join(root, ...EXECUTION_MODE_PATH.split("/"));
  let content = null;
  try {
    if (existsSync(path)) content = readFileSync(path, "utf8");
  } catch {
    content = null;
  }
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const match = POLICY_MARKER.exec(line.trim());
    if (match) return { name: match[1], explicit: true };
  }
  return { name: DEFAULT_ROUTING_POLICY, explicit: false };
}

/**
 * The mode a project effectively runs in: the recorded value, the default for
 * no file, and `null` for an invalid file so the caller names the problem.
 */
export function effectiveExecutionMode(reading) {
  if (!reading.present) return DEFAULT_EXECUTION_MODE;
  return reading.valid ? reading.mode : null;
}

/**
 * Refuse unless the project runs in orchestrator mode.
 *
 * Returns null when it does. Otherwise the message the skill prints, which
 * names the file and both values, because that is the whole of what a reader
 * needs to fix it.
 */
export function orchestratorRefusal(root) {
  const reading = readExecutionModeFile(root);
  const mode = effectiveExecutionMode(reading);
  if (mode === "orchestrator") return null;

  if (mode === null) {
    return (
      `${EXECUTION_MODE_PATH} exists but carries no valid marker. ` +
      `Orchestration needs \`<!-- pathfinder:execution-mode orchestrator -->\`; ` +
      `the valid values are ${EXECUTION_MODES.join(" and ")}.`
    );
  }
  return (
    `this project runs ${mode}${reading.present ? "" : " (no " + EXECUTION_MODE_PATH + ")"}. ` +
    `Orchestration runs only when ${EXECUTION_MODE_PATH} says ` +
    `\`<!-- pathfinder:execution-mode orchestrator -->\`; run ` +
    "`npx create-pathfinder --mode orchestrator` or edit the marker line to switch."
  );
}
