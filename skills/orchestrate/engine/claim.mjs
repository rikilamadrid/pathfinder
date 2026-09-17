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
 * Atomic in Git, not in this process. The first write is the claim ref
 * `refs/pathfinder/claims/<key>`, created only if absent under Git's own ref
 * lock, so of any number of concurrent claims exactly one proceeds. The loser
 * has created nothing. If the winner then fails to add its worktree, it
 * removes exactly what it created — the branch and the ref, and only while
 * they still point where it put them — so a failed claim leaves no trace that
 * would block the next one.
 *
 * Nothing here deletes anything it did not create in this call, and nothing
 * here dispatches. A claim is a place to
 * work, and the worker's `context/current-ticket.md` is seeded so `status`
 * can show the claim before a session has loaded the ticket.
 */

import { existsSync, mkdirSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { computeBoard } from "./board.mjs";
import { BRANCH_PREFIX, WORKTREES_DIR, claimFor } from "./claims.mjs";
import { createClaimRef, defaultBranch, deleteClaimRef, git, isIgnored, resolveRef } from "./git.mjs";
import { orchestratorRefusal } from "./mode.mjs";
import { renderProfile } from "./profile.mjs";
import { profileFor } from "./route.mjs";
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
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export async function claim({
  root,
  key,
  slug = null,
  now = new Date().toISOString(),
  store: storeOverride = null,
  gh = "gh",
  assessment = {},
}) {
  if (slug !== null && !SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      usage: true,
      message: `slug \`${slug}\` must be lower-case letters, digits, and inner hyphens, at most 40 characters`,
    };
  }

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
  if (existing) return { ok: false, message: `refusing to claim ${key}: ${describeOwner(existing)}` };

  const worktree = `${WORKTREES_DIR}/${key}`;
  const path = join(root, ...worktree.split("/"));
  if (existsSync(path)) {
    return {
      ok: false,
      message: `refusing to claim ${key}: ${worktree} already exists and is not a registered worktree; a person decides what it is`,
    };
  }

  if (!row.eligible) return { ok: false, message: `refusing to claim ${key}: ${row.reason}` };

  // The profile before any write. A policy that cannot be loaded or makes a
  // choice nothing could act on refuses the claim with nothing to undo.
  const routed = await profileFor({ root, ticket: row, tickets: read.tickets, assessment });
  if (!routed.ok) return { ok: false, message: `refusing to claim ${key}: ${routed.message}` };

  const base = defaultBranch(root);
  if (!base) return { ok: false, message: "refusing to claim: no default branch (main or master) to start from" };

  const baseOid = resolveRef(root, `refs/heads/${base}`);
  if (!baseOid) return { ok: false, message: `refusing to claim: ${base} does not resolve to a commit` };

  const branch = `${BRANCH_PREFIX}${key}-${slug ?? slugify(row.title)}`;

  // The parent directory first, before anything in Git is written: a path
  // that cannot be created — `.pathfinder` is a file, or not writable — must
  // refuse with nothing to undo, not throw with a claim ref already made.
  const parent = join(root, ...WORKTREES_DIR.split("/"));
  const parentExisted = existsSync(parent);
  try {
    mkdirSync(parent, { recursive: true });
  } catch (error) {
    return { ok: false, message: `refusing to claim ${key}: cannot create ${WORKTREES_DIR}: ${error.message}` };
  }

  const locked = createClaimRef(root, key, baseOid);
  if (!locked.ok) {
    const now = claimFor(root, key);
    return {
      ok: false,
      message: `refusing to claim ${key}: ${now ? describeOwner(now) : "another claim of it is in progress"}`,
    };
  }

  const added = git(["worktree", "add", "--quiet", path, "-b", branch, baseOid], { cwd: root });
  if (!added.ok) {
    // Undo exactly what this call created. Both deletes carry the expected old
    // value, so Git refuses either one if anything moved the ref since.
    git(["update-ref", "-d", `refs/heads/${branch}`, baseOid], { cwd: root });
    deleteClaimRef(root, key, baseOid);
    if (!parentExisted) {
      try {
        rmdirSync(parent);
        rmdirSync(join(root, ".pathfinder"));
      } catch {
        // Not empty, or not ours to remove: leave it.
      }
    }
    return { ok: false, message: `refusing to claim ${key}: git worktree add failed: ${added.message}` };
  }

  const state = seedStateFile({
    key,
    title: row.title,
    ref: row.ref,
    store: describeStore(store),
    worktree,
    branch,
    now,
    profile: routed.profile,
  });
  mkdirSync(join(path, "context"), { recursive: true });
  writeFileSync(join(path, "context", "current-ticket.md"), state, "utf8");

  return { ok: true, key, worktree, branch, path, base, profile: routed.profile };
}

/** One sentence naming who or what already holds a ticket. */
export function describeOwner(existing) {
  if (!existing.orphan) {
    return `it is claimed by worker ${existing.worker ?? existing.key} at ${existing.worktree} on ${existing.branch}`;
  }
  if (existing.elsewhere) {
    return `branch ${existing.branch} is checked out at ${existing.elsewhere}, outside .pathfinder/worktrees; a person decides what that work is`;
  }
  if (existing.branch) {
    return `branch ${existing.branch} exists with no worktree; resume or release it deliberately`;
  }
  return `a claim ref refs/pathfinder/claims/${existing.key} exists with no branch or worktree; a claim was interrupted, and a person releases it`;
}

/**
 * The worker's first `context/current-ticket.md`.
 *
 * The same `- Field: value` lines `ticket load` writes, plus the worker fields
 * this Feature adds. No lifecycle status: the store carries that. `Updated`
 * is the one timestamp, and it is data the claim writes, not something a
 * later `status` run reads from the clock.
 */
export function seedStateFile({ key, title, ref, store, worktree, branch, now, profile }) {
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
    "## Execution",
    "",
    "```yaml",
    renderProfile(profile).trimEnd(),
    "```",
    "",
  ].join("\n");
}
