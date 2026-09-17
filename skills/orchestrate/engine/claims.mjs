/**
 * Claims, read from git and from the workers' own state files.
 *
 * A claim is a linked worktree at `.pathfinder/worktrees/<key>` on a branch
 * `ticket/<key>-<slug>`. The worktree path is the worker's identity and the
 * claim; the worktree's `context/current-ticket.md` is its transient state.
 * Nothing about a worker lives anywhere else, so this module reads exactly
 * those two things and writes nothing.
 *
 * A branch `ticket/<key>-*` with no worktree under `.pathfinder/worktrees` is
 * an orphan: a claim whose worktree was removed, a claim that failed half way,
 * or a branch a person checked out somewhere else. So is a claim ref
 * (`refs/pathfinder/claims/<key>`) with neither. Each is reported as a claim,
 * so a ticket with any trace of earlier work is refused rather than redone,
 * and the human decides what the trace is.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { listBranches, listClaimRefs, listWorktrees, relativeTo } from "./git.mjs";
import { compareKeys, isKey } from "./keys.mjs";

export const WORKTREES_DIR = ".pathfinder/worktrees";
export const BRANCH_PREFIX = "ticket/";

/** The execution states a claim's state file may record. */
export const CLAIM_STATES = Object.freeze(["working", "review", "human-gate", "done", "failed"]);

/**
 * @returns {Claim[]}
 * @typedef {{key: string, worktree: string|null, branch: string|null,
 *            orphan: boolean, state: string|null, gate: string|null,
 *            updated: string|null, next: string|null, last: string|null,
 *            worker: string|null, stateFile: boolean}} Claim
 */
export function readClaims(root) {
  const claims = new Map();

  const worktrees = listWorktrees(root);
  const checkedOut = new Map(worktrees.filter((w) => w.branch).map((w) => [w.branch, w.path]));

  for (const worktree of worktrees) {
    const rel = relativeTo(root, worktree.path);
    if (!rel.startsWith(`${WORKTREES_DIR}/`)) continue;
    const key = basename(worktree.path);
    if (!isKey(key)) continue;

    const state = readStateFile(join(worktree.path, "context", "current-ticket.md"));
    claims.set(key, {
      key,
      worktree: rel,
      branch: worktree.branch,
      orphan: false,
      worker: state.worker ?? key,
      state: state.state,
      gate: state.gate,
      updated: state.updated,
      next: state.next,
      last: state.last,
      stateFile: state.present,
      elsewhere: null,
    });
  }

  for (const branch of listBranches(root, BRANCH_PREFIX)) {
    const key = keyOfBranch(branch);
    if (!key || claims.has(key)) continue;
    claims.set(key, {
      key,
      worktree: null,
      branch,
      orphan: true,
      elsewhere: checkedOut.get(branch) ?? null,
      worker: null,
      state: null,
      gate: null,
      updated: null,
      next: null,
      last: null,
      stateFile: false,
    });
  }

  for (const key of listClaimRefs(root)) {
    if (!isKey(key) || claims.has(key)) continue;
    claims.set(key, {
      key,
      worktree: null,
      branch: null,
      orphan: true,
      elsewhere: null,
      worker: null,
      state: null,
      gate: null,
      updated: null,
      next: null,
      last: null,
      stateFile: false,
    });
  }

  return [...claims.values()].sort((a, b) => compareKeys(a.key, b.key));
}

/** The claim owning a key, or null. */
export function claimFor(root, key) {
  return readClaims(root).find((claim) => claim.key === key) ?? null;
}

/** `ticket/53.2-anything` → `53.2`; anything else → null. */
export function keyOfBranch(branch) {
  const match = /^ticket\/(\d+\.\d+)(?:-|$)/.exec(branch);
  return match && isKey(match[1]) ? match[1] : null;
}

/**
 * The worker fields of a `context/current-ticket.md`.
 *
 * The file has no schema beyond `- Field: value` lines, and only the fields
 * this engine wrote or the worker updated are read. An absent or unreadable
 * file is `present: false`, which a status view shows as a claim not yet
 * loaded rather than as an error.
 */
export function readStateFile(path) {
  const empty = { present: false, worker: null, state: null, gate: null, updated: null, next: null, last: null };
  if (!existsSync(path)) return empty;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return empty;
  }
  const field = (name) => {
    const match = new RegExp(`^-\\s*${name}:\\s*(.*)$`, "m").exec(text);
    return match ? match[1].trim() || null : null;
  };
  const state = field("State");
  return {
    present: true,
    worker: field("Worker"),
    state: state && CLAIM_STATES.includes(state) ? state : state ? `invalid:${state}` : null,
    gate: field("Gate"),
    updated: field("Updated"),
    next: field("Next"),
    last: field("Last"),
  };
}
