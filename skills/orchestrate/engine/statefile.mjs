/**
 * Updating a worker's `context/current-ticket.md` without disturbing it.
 *
 * The file is `- Field: value` lines followed, after a claim, by an
 * `## Execution` profile. This module replaces the value of a named line,
 * inserts one that is missing just before `- Next:` (or before the first `##`
 * section, or at the end), and removes one — and touches nothing else, so the
 * worker's own notes and the recorded profile survive every update byte for
 * byte.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CLAIM_STATES } from "./claims.mjs";

/** The fields this module may write. Anything else in the file is the worker's. */
export const WRITABLE = Object.freeze(["State", "Gate", "Last", "Next", "Updated"]);

/**
 * Apply `set` (field → value) and `unset` (fields) to a state file's text.
 * Values are single-line; a newline is refused rather than written.
 */
export function updateStateText(text, { set = {}, unset = [] }) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let lines = text.replace(/\r\n/g, "\n").split("\n");

  for (const name of unset) {
    lines = lines.filter((line) => !new RegExp(`^-\\s*${name}:`).test(line));
  }

  for (const [name, value] of Object.entries(set)) {
    const line = `- ${name}: ${value}`;
    const at = lines.findIndex((existing) => new RegExp(`^-\\s*${name}:`).test(existing));
    if (at >= 0) {
      lines[at] = line;
      continue;
    }
    const next = lines.findIndex((existing) => /^-\s*Next:/.test(existing));
    const section = lines.findIndex((existing, index) => index > 0 && /^## /.test(existing));
    const insertAt = next >= 0 ? next : section >= 0 ? section - (lines[section - 1] === "" ? 1 : 0) : lines.length;
    lines.splice(insertAt, 0, line);
  }

  return lines.join(eol);
}

/**
 * Update a claimed worktree's state file.
 *
 * @returns {{ok: true, path: string} | {ok: false, usage?: boolean, message: string}}
 */
export function updateStateFile(worktreePath, { set = {}, unset = [] }) {
  for (const name of [...Object.keys(set), ...unset]) {
    if (!WRITABLE.includes(name)) return { ok: false, usage: true, message: `field \`${name}\` is not one the engine writes` };
  }
  for (const [name, value] of Object.entries(set)) {
    if (/[\r\n\u2028\u2029]/.test(String(value)) || String(value).trim() === "") {
      return { ok: false, usage: true, message: `${name} must be one non-empty line` };
    }
  }
  if (set.State !== undefined && !CLAIM_STATES.includes(set.State)) {
    return { ok: false, usage: true, message: `state must be one of ${CLAIM_STATES.join(", ")}, not \`${set.State}\`` };
  }

  const path = join(worktreePath, "context", "current-ticket.md");
  if (!existsSync(path)) return { ok: false, message: `${path} does not exist; the claim has no state file` };
  writeFileSync(path, updateStateText(readFileSync(path, "utf8"), { set, unset }), "utf8");
  return { ok: true, path };
}
