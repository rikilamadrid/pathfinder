/**
 * The Git the engine runs, and nothing else.
 *
 * Every command here is either a read or the one write a claim is: creating a
 * worktree on a new branch. Invoked with argument arrays, never a shell
 * string, so a path with a space in it is data rather than syntax. Output is
 * captured; a failure comes back as `{ok: false, message}` rather than as a
 * stack trace over the top of a status table.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

/** Run git in `cwd`. Never throws. */
export function git(args, { cwd }) {
  let result;
  try {
    result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  } catch (error) {
    return { ok: false, status: null, stdout: "", stderr: error.message, message: error.message };
  }
  if (result.error) {
    return { ok: false, status: null, stdout: "", stderr: result.error.message, message: result.error.message };
  }
  const stderr = (result.stderr ?? "").trim();
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr,
    message: stderr || (result.status === 0 ? "" : `git ${args[0]} exited with status ${result.status}`),
  };
}

/** The top-level directory of the checkout containing `cwd`, or null outside one. */
export function checkoutRoot(cwd) {
  const result = git(["rev-parse", "--show-toplevel"], { cwd });
  return result.ok ? result.stdout.trim() : null;
}

/**
 * The main working tree of the repository containing `cwd`, or null.
 *
 * Not `--show-toplevel`: run from inside a worker's worktree that answers with
 * the worktree, and every claim would then be looked for under
 * `<worktree>/.pathfinder/worktrees`, where there are none. The first entry of
 * `git worktree list` is always the main working tree, which is where claims,
 * the mode file the orchestrator reads, and the ignore rule all live.
 */
export function repositoryRoot(cwd) {
  const result = git(["worktree", "list", "--porcelain"], { cwd });
  if (!result.ok) return null;
  const first = result.stdout.split("\n").find((line) => line.startsWith("worktree "));
  return first ? first.slice("worktree ".length) : null;
}

/**
 * The branch a claim starts from.
 *
 * The remote's default when the remote says, otherwise `main` if it exists,
 * otherwise `master`. Named rather than guessed from `HEAD`, because the
 * orchestrator may itself be running on a branch.
 */
export function defaultBranch(root) {
  const remote = git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], { cwd: root });
  if (remote.ok) {
    const name = remote.stdout.trim().replace(/^refs\/remotes\/origin\//, "");
    if (name) return name;
  }
  for (const candidate of ["main", "master"]) {
    if (git(["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], { cwd: root }).ok) return candidate;
  }
  return null;
}

/**
 * Every worktree of the repository, from `git worktree list --porcelain`.
 *
 * @returns {{path: string, head: string|null, branch: string|null, bare: boolean, detached: boolean}[]}
 */
export function listWorktrees(root) {
  const result = git(["worktree", "list", "--porcelain"], { cwd: root });
  if (!result.ok) return [];

  const entries = [];
  let current = null;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), head: null, branch: null, bare: false, detached: false };
      entries.push(current);
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice(5);
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice(7).replace(/^refs\/heads\//, "");
    } else if (current && line === "bare") {
      current.bare = true;
    } else if (current && line === "detached") {
      current.detached = true;
    }
  }
  return entries;
}

/** Local branches matching a prefix, without the `refs/heads/` part. */
export function listBranches(root, prefix) {
  const result = git(["for-each-ref", "--format=%(refname:short)", `refs/heads/${prefix}`], { cwd: root });
  if (!result.ok) return [];
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean).sort();
}

export const CLAIM_REF_PREFIX = "refs/pathfinder/claims/";
const ZERO_OID = "0000000000000000000000000000000000000000";

/**
 * Create the claim ref for a key, atomically, or report that it exists.
 *
 * `git update-ref <ref> <new> <zero>` succeeds only when the ref does not
 * exist, under Git's own ref lock, so of any number of concurrent callers
 * exactly one wins. That is the claim. The ref lives under `refs/pathfinder/`,
 * which a normal push does not send: like the worktree it guards, it is
 * machine-local.
 */
export function createClaimRef(root, key, oid) {
  return git(["update-ref", `${CLAIM_REF_PREFIX}${key}`, oid, ZERO_OID], { cwd: root });
}

/** Delete a claim ref, but only if it still points where this claim left it. */
export function deleteClaimRef(root, key, oid) {
  return git(["update-ref", "-d", `${CLAIM_REF_PREFIX}${key}`, oid], { cwd: root });
}

/** Keys that hold a claim ref. */
export function listClaimRefs(root) {
  const result = git(["for-each-ref", "--format=%(refname)", CLAIM_REF_PREFIX], { cwd: root });
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(CLAIM_REF_PREFIX))
    .map((line) => line.slice(CLAIM_REF_PREFIX.length))
    .sort();
}

/** The commit a ref names, or null. */
export function resolveRef(root, ref) {
  const result = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: root });
  return result.ok ? result.stdout.trim() : null;
}

/** Is this path ignored by the repository's ignore rules? */
export function isIgnored(root, relativePath) {
  return git(["check-ignore", "-q", "--", relativePath], { cwd: root }).ok;
}

/** The canonical spelling of a path: symlinks resolved when it exists. */
export function canonical(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * A path relative to the root, forward-slashed, or the path itself when outside.
 *
 * Both sides are canonicalised first. Git reports worktree paths with symlinks
 * resolved, so a root given through one — macOS `/tmp` is `/private/tmp` —
 * would otherwise place every worktree outside the root and every claim would
 * read as an orphan.
 */
export function relativeTo(root, path) {
  const rel = relative(canonical(root), canonical(path));
  if (rel === "" || rel.startsWith("..")) return rel === "" ? "." : path;
  return rel.split(sep).join("/");
}
