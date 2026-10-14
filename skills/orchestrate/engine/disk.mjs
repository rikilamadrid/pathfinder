/**
 * Physical free space and the project's disk thresholds.
 *
 * Review runs materialize whole dependency trees, so a run started on a nearly
 * full disk can fill it. The thresholds live on one optional marker line in
 * the execution-mode file:
 *
 *     <!-- pathfinder:disk warn=25 floor=10 -->
 *
 * Values are gigabytes (10^9 bytes). `PATHFINDER_DISK_WARN_GB` and
 * `PATHFINDER_DISK_FLOOR_GB` override the marker for one invocation. Below
 * `warn` the engine says so; below `floor` it refuses to start new review runs
 * unless the human's explicit approval is passed.
 *
 * Free space is what the filesystem reports as available to this user
 * (`statfs` bavail × bsize), never a sum of file sizes: copy-on-write clones
 * make every per-file total overstate physical use.
 */

import { existsSync, readFileSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { EXECUTION_MODE_PATH } from "./mode.mjs";

export const DEFAULT_WARN_GB = 25;
export const DEFAULT_FLOOR_GB = 10;
const GB = 1e9;
const DISK_MARKER = /^<!--\s*pathfinder:disk\s+(.*?)\s*-->$/;

function number(text) {
  if (typeof text !== "string" || !/^\d+(?:\.\d+)?$/.test(text.trim())) return null;
  return Number(text.trim());
}

/**
 * The thresholds in force: environment, then marker, then defaults.
 *
 * @returns {{valid: true, warnGb: number, floorGb: number, source: string} | {valid: false, message: string}}
 */
export function readDiskPolicy(root, env = process.env) {
  let warnGb = DEFAULT_WARN_GB;
  let floorGb = DEFAULT_FLOOR_GB;
  let source = "default";
  const path = join(root, ...EXECUTION_MODE_PATH.split("/"));
  let content = "";
  try { if (existsSync(path)) content = readFileSync(path, "utf8"); } catch { content = ""; }
  for (const line of content.split(/\r?\n/)) {
    const match = DISK_MARKER.exec(line.trim());
    if (!match) continue;
    const fields = Object.fromEntries(match[1].split(/\s+/).map((pair) => pair.split("=")));
    const warn = number(fields.warn);
    const floor = number(fields.floor);
    if (warn === null || floor === null || Object.keys(fields).some((name) => !["warn", "floor"].includes(name))) {
      return { valid: false, message: `invalid disk marker \`${line.trim()}\`; expected <!-- pathfinder:disk warn=<GB> floor=<GB> -->` };
    }
    warnGb = warn; floorGb = floor; source = "marker";
    break;
  }
  for (const [name, assign] of [["PATHFINDER_DISK_WARN_GB", (v) => { warnGb = v; }], ["PATHFINDER_DISK_FLOOR_GB", (v) => { floorGb = v; }]]) {
    if (env[name] === undefined || env[name] === "") continue;
    const value = number(env[name]);
    if (value === null) return { valid: false, message: `${name} must be a non-negative number of gigabytes` };
    assign(value); source = "environment";
  }
  if (floorGb > warnGb) return { valid: false, message: `disk floor ${floorGb} GB is above the warning threshold ${warnGb} GB` };
  return { valid: true, warnGb, floorGb, source };
}

/** Bytes available to this user on the filesystem holding `path`. */
export function freeBytes(path) {
  const stats = statfsSync(path);
  return Number(stats.bavail) * Number(stats.bsize);
}

/**
 * The disk level for `path` under the project's policy.
 *
 * @returns {{ok: true, freeBytes: number, warnBytes: number, floorBytes: number,
 *            level: "ok"|"warn"|"below-floor", policy: object} | {ok: false, message: string}}
 */
export function diskCheck({ root, path = root, env = process.env }) {
  const policy = readDiskPolicy(root, env);
  if (!policy.valid) return { ok: false, message: policy.message };
  let free;
  try { free = freeBytes(path); } catch (error) { return { ok: false, message: `cannot read free space for ${path}: ${error.message}` }; }
  const warnBytes = policy.warnGb * GB;
  const floorBytes = policy.floorGb * GB;
  const level = free < floorBytes ? "below-floor" : free < warnBytes ? "warn" : "ok";
  return { ok: true, freeBytes: free, warnBytes, floorBytes, level, policy };
}

/**
 * Whether a new review run may start. Below the floor only an explicit,
 * non-empty human approval lets it proceed, and the approval is echoed back so
 * the caller records it.
 */
export function floorGate(check, approval = null) {
  if (!check.ok) return { ok: false, message: check.message };
  if (check.level !== "below-floor") return { ok: true, check, override: null };
  if (typeof approval === "string" && approval.trim()) return { ok: true, check, override: approval.trim() };
  return {
    ok: false,
    message: `only ${formatGb(check.freeBytes)} free, below the ${formatGb(check.floorBytes)} floor; ` +
      "free space or pass --allow-low-disk naming the human's explicit approval",
  };
}

export function formatGb(bytes) {
  return `${(bytes / GB).toFixed(1)} GB`;
}

export function formatDisk(check) {
  if (!check.ok) return `disk: ${check.message}`;
  const note = check.level === "ok" ? "" : check.level === "warn" ? " — WARNING: below the warning threshold" : " — BELOW FLOOR: new review runs refused";
  return `disk: ${formatGb(check.freeBytes)} free (warn ${formatGb(check.warnBytes)}, floor ${formatGb(check.floorBytes)}, ${check.policy.source})${note}`;
}
