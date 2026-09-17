/**
 * Claiming a ticket: one worktree, one branch, one worker.
 *
 * The claim is `git worktree add .pathfinder/worktrees/<key> -b ticket/<key>-<slug>`
 * from the default branch. It is atomic because git refuses an existing
 * branch and refuses a branch checked out elsewhere; this module refuses
 * earlier and more legibly — a worktree or a `ticket/<key>-*` branch already
 * there, a ticket that is not eligible, a project not in orchestrator mode, a
 * `.pathfinder/` the project does not ignore — so two workers can never own
 * one ticket and a refusal always names its reason.
 *
 * Nothing here deletes, and nothing here dispatches. A claim is a place to
 * work, and the worker's `context/current-ticket.md` is seeded so `status`
 * can show the claim before a session has loaded the ticket.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { computeBoard } from "./board.mjs";
import { BRANCH_PREFIX, WORKTREES_DIR, claimFor } from "./claims.mjs";
import { defaultBranch, git, isIgnored } from "./git.mjs";
import { orchestratorRefusal } from "./mode.mjs";
import { slugify } from "./keys.mjs";
import { describeStore, readTickets, resolveStore } from "./store.mjs";

/**
 * @param {object} args
 * @param {string} args.root repository root
 * @param {string} args.key ticket key
 * @param {string} [args.slug] branch slug; derived from the title when omitted
 * @param {string} [args.now] ISO timestamp recorded as `Updated`; supplied by
 *   tests so a claim's bytes are reproducible, and by the caller otherwise
 * @param {string|null} [args.store] `--store` override
 * @param {string} [args.gh]
 * @returns {{ok: true, key: string, worktree: string, branch: string, path: string}
 *         | {ok: false, message: string}}
 */
export function claim({ root, key, slug = null, now = new Date().toISOString(), store: storeOverride = null, gh = "gh" }) {
  const refusal = orchestratorRefusal(root);
  if (refusal) return { ok: false, message: `refusing to claim: ${refusal}` };

  // Probed beneath the directory, not at it. Before the first claim the
  // directory does not exist, and a directory-only rule such as `/.pathfinder/`
  // does not match a bare `.pathfinder` git cannot yet see is a directory.
  // Every spelling of the rule matches a path under it.
  if (!isIgnored(root, `${WORKTREES_DIR}/probe`)) {
    return {
      ok: false,
      message:
        "refusing to claim: `.pathfinder/` is not ignored by this repository. " +
        "Add this line to .gitignore and try again:\n\n    /.pathfinder/\n",
    };
  }

  const store = resolveStore(root, { override: storeOverride });
  const read = readTickets(root, store, { gh });
  if (!read.ok) return { ok: false, message: `refusing to claim: ${read.message}` };

  const row = computeBoard(read.tickets).find((ticket) => ticket.key === key);
  if (!row) return { ok: false, message: `refusing to claim: no ticket ${key} in ${describeStore(store)}` };

  // Ownership before eligibility. A claimed ticket's worker moves it to
  // In Progress, which makes it ineligible too, and "in progress" is the less
  // useful of the two refusals: the reader needs to know who owns it.
  const existing = claimFor(root, key);
  if (existing) {
    const where = existing.orphan
      ? `branch ${existing.branch} exists with no worktree; resume or release it deliberately`
      : `it is claimed by worker ${existing.worker ?? key} at ${existing.worktree} on ${existing.branch}`;
    return { ok: false, message: `refusing to claim ${key}: ${where}` };
  }

  if (!row.eligible) return { ok: false, message: `refusing to claim ${key}: ${row.reason}` };

  const base = defaultBranch(root);
  if (!base) return { ok: false, message: "refusing to claim: no default branch (main or master) to start from" };

  const branch = `${BRANCH_PREFIX}${key}-${slug ?? slugify(row.title)}`;
  const worktree = `${WORKTREES_DIR}/${key}`;
  const path = join(root, ...worktree.split("/"));

  mkdirSync(join(root, ...WORKTREES_DIR.split("/")), { recursive: true });
  const added = git(["worktree", "add", "--quiet", path, "-b", branch, base], { cwd: root });
  if (!added.ok) return { ok: false, message: `git worktree add failed: ${added.message}` };

  const state = seedStateFile({ key, title: row.title, ref: row.ref, store: describeStore(store), worktree, branch, now });
  mkdirSync(join(path, "context"), { recursive: true });
  writeFileSync(join(path, "context", "current-ticket.md"), state, "utf8");

  return { ok: true, key, worktree, branch, path, base };
}

/**
 * The worker's first `context/current-ticket.md`.
 *
 * The same `- Field: value` lines `ticket load` writes, plus the worker fields
 * this Feature adds. No lifecycle status: the store carries that. `Updated`
 * is the one timestamp, and it is data the claim writes, not something a
 * later `status` run reads from the clock.
 */
export function seedStateFile({ key, title, ref, store, worktree, branch, now }) {
  return [
    "# Current Ticket",
    "",
    `- Ticket: ${key} — ${title}`,
    `- Store: ${store}, ${ref}`,
    `- Feature: ${key.split(".")[0]}`,
    "- Mode: orchestrator",
    `- Worker: ${key}`,
    `- Worktree: ${worktree}`,
    `- Branch: ${branch}`,
    "- State: working",
    `- Updated: ${now}`,
    `- Git: branch ${branch}, clean`,
    "- Blocker: none",
    `- Next: /ticket load ${key}, then /ticket start`,
    "",
  ].join("\n");
}
