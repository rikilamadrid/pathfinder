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

/** The harness-neutral model tiers a routing policy may select. */
export const MODEL_TIERS = Object.freeze(["light", "standard", "strong"]);

const TIERS_MARKER = /^<!--\s*pathfinder:model-tiers\b/;
const TIERS_LINE = /^<!--\s*pathfinder:model-tiers\s+(.*?)\s*-->$/;
const NAME = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * The model-tier maps a mode file's contents set, one optional line per
 * harness:
 *
 *     <!-- pathfinder:model-tiers <harness> light=<m> standard=<m> strong=<m> -->
 *
 * Every tier appears exactly once, and nothing else does. A line that opens
 * the marker and is not exactly that shape, or a second line for the same
 * harness, makes the whole reading malformed: a map that is half-understood is
 * how a session gets dispatched on a model nobody chose. Whether the harness
 * exists and each model passes its check is the translation's question, not
 * this reader's.
 *
 * @returns {{ok: true, maps: Record<string, {light: string, standard: string, strong: string}>}
 *         | {ok: false, message: string}}
 */
export function readModelTiersMarker(content) {
  const maps = {};
  for (const raw of String(content ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!TIERS_MARKER.test(line)) continue;
    const bad = (why) => ({ ok: false, message: `malformed model-tiers marker in ${EXECUTION_MODE_PATH} (\`${line}\`): ${why}. Expected \`<!-- pathfinder:model-tiers <harness> light=<model> standard=<model> strong=<model> -->\`` });
    const match = TIERS_LINE.exec(line);
    if (!match) return bad("it is not one complete marker line");
    const [harness, ...pairs] = match[1].split(/\s+/);
    if (!NAME.test(harness ?? "") || harness.includes("=")) return bad("it names no harness");
    if (Object.hasOwn(maps, harness)) return bad(`harness \`${harness}\` is mapped twice`);
    const map = {};
    for (const pair of pairs) {
      const [tier, model, ...rest] = pair.split("=");
      if (rest.length > 0 || model === undefined) return bad(`\`${pair}\` is not tier=model`);
      if (!MODEL_TIERS.includes(tier)) return bad(`\`${tier}\` is not a tier; the tiers are ${MODEL_TIERS.join(", ")}`);
      if (Object.hasOwn(map, tier)) return bad(`tier \`${tier}\` is mapped twice`);
      if (!NAME.test(model)) return bad(`model \`${model}\` is not a lower-case name`);
      map[tier] = model;
    }
    const missing = MODEL_TIERS.filter((tier) => !Object.hasOwn(map, tier));
    if (missing.length > 0) return bad(`it does not map ${missing.join(", ")}`);
    maps[harness] = Object.freeze(map);
  }
  return { ok: true, maps: Object.freeze(maps) };
}

/** The project's model-tier maps, read from its mode file. No file is no maps. */
export function readModelTiers(root) {
  const path = join(root, ...EXECUTION_MODE_PATH.split("/"));
  let content = null;
  try {
    if (existsSync(path)) content = readFileSync(path, "utf8");
  } catch {
    return { ok: false, message: `${EXECUTION_MODE_PATH} could not be read for its model-tiers marker` };
  }
  return readModelTiersMarker(content);
}

const JUDGE_MARKER = /^<!--\s*pathfinder:evidence-judge\s+(\S+)\s*-->$/;

/** The value that records an explicit choice of no judge. */
export const NO_EVIDENCE_JUDGE = "none";

/**
 * The Evidence Judge provider a mode file's contents name, on its own
 * optional line:
 *
 *     <!-- pathfinder:evidence-judge <provider> -->
 *
 * No line, or `none` (the installer's record of a project that declined), is
 * no judge: integration behaves exactly as it did before the judge existed. A
 * credential in the environment never enables one; only this line does.
 * Whether the name is a provider this engine ships is the judge registry's
 * question, not this reader's.
 *
 * @returns {{name: string|null, explicit: boolean}}
 */
export function readEvidenceJudgeMarker(content) {
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const match = JUDGE_MARKER.exec(line.trim());
    if (match) return match[1] === NO_EVIDENCE_JUDGE ? { name: null, explicit: false } : { name: match[1], explicit: true };
  }
  return { name: null, explicit: false };
}

/** The project's Evidence Judge, read from its mode file. */
export function readEvidenceJudge(root) {
  const path = join(root, ...EXECUTION_MODE_PATH.split("/"));
  let content = null;
  try {
    if (existsSync(path)) content = readFileSync(path, "utf8");
  } catch {
    content = null;
  }
  return readEvidenceJudgeMarker(content);
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
