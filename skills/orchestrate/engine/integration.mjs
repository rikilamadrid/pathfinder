/** Read-only integration evidence, and deliberate cleanup after landing. */
import { join } from "node:path";
import { claimFor, keyOfBranch } from "./claims.mjs";
import { CLAIM_REF_PREFIX, defaultBranch, deleteClaimRef, git, listBranches, resolveRef } from "./git.mjs";
import { orchestratorRefusal } from "./mode.mjs";

const refuse = (message) => ({ ok: false, message });
const paths = (result) => result.stdout.split("\0").filter(Boolean);

/** Snapshot commit IDs before inspecting them. No checkout or index is changed. */
export function checkIntegration({ root, key }) {
  const refusal = orchestratorRefusal(root);
  if (refusal) return refuse(refusal);
  const claim = claimFor(root, key);
  if (!claim || claim.orphan || claim.state !== "done") return refuse(`${key} needs a registered done claim before integration`);
  if (!claim.branch || keyOfBranch(claim.branch) !== key) return refuse(`${key} is not on its ticket branch; preserve it for the human`);
  const base = defaultBranch(root);
  const baseHead = base && resolveRef(root, `refs/heads/${base}`);
  const head = claim.branch && resolveRef(root, `refs/heads/${claim.branch}`);
  if (!baseHead || !head) return refuse("cannot resolve the default branch or worker branch");
  const clean = git(["status", "--porcelain", "--untracked-files=all"], { cwd: join(root, claim.worktree) });
  if (!clean.ok || clean.stdout.trim()) return refuse(`${key}'s worktree is dirty or unreadable; verify and commit its work before integration`);
  const ancestor = git(["merge-base", baseHead, head], { cwd: root });
  if (!ancestor.ok) return refuse(`cannot find merge base: ${ancestor.message}`);
  const merge = git(["merge-tree", "--write-tree", "--name-only", "-z", baseHead, head], { cwd: root });
  if (merge.status !== 0 && merge.status !== 1) return refuse(`merge-tree failed: ${merge.message}`);
  const conflicts = [];
  if (!merge.ok) {
    // -z output starts with the tree, then conflict paths, then an empty record
    // before the informational messages. Path names are never line-split.
    const records = merge.stdout.split("\0");
    for (const path of records.slice(1)) { if (!path) break; conflicts.push(path); }
  }
  const changed = git(["diff", "--name-only", "-z", `${ancestor.stdout.trim()}...${head}`], { cwd: root });
  if (!changed.ok) return refuse(changed.message);
  const ownFiles = new Set(paths(changed));
  const overlaps = [];
  for (const branch of listBranches(root, "ticket/")) {
    if (branch === claim.branch) continue;
    const otherHead = resolveRef(root, `refs/heads/${branch}`);
    if (!otherHead) return refuse(`cannot resolve ${branch}`);
    if (included(root, baseHead, otherHead)) continue;
    const other = git(["diff", "--name-only", "-z", `${baseHead}...${otherHead}`], { cwd: root });
    if (!other.ok) return refuse(`cannot inspect overlap with ${branch}: ${other.message}`);
    const shared = paths(other).filter((path) => ownFiles.has(path));
    if (shared.length) overlaps.push({ branch, paths: shared, advisory: true });
  }
  const behind = ancestor.stdout.trim() !== baseHead;
  return {
    ok: true, key, branch: claim.branch, base, head, baseHead,
    mergeBase: ancestor.stdout.trim(),
    result: conflicts.length || !merge.ok ? "conflict" : behind ? "behind" : "candidate",
    behind, conflicts, overlaps,
  };
}

export function formatCheck(check) {
  return [
    `${check.key}: ${check.result} (${check.branch} against ${check.base})`,
    ...check.conflicts.map((path) => `  conflict: ${JSON.stringify(path)}`),
    ...check.overlaps.map((overlap) => `  advisory overlap with ${overlap.branch}: ${overlap.paths.map((path) => JSON.stringify(path)).join(", ")}`),
    `  evidence: base ${check.baseHead}, worker ${check.head}, merge-base ${check.mergeBase}`,
    "",
  ].join("\n");
}

/**
 * A squash merge has no ancestry edge. A merge-tree that adds nothing to the
 * default tree is evidence that the entire branch delta is already included.
 * If Git cannot prove inclusion (e.g. a later rewrite), preserve the claim.
 */
function included(root, baseHead, head) {
  if (git(["merge-base", "--is-ancestor", head, baseHead], { cwd: root }).ok) return true;
  const merge = git(["merge-tree", "--write-tree", baseHead, head], { cwd: root });
  const tree = git(["rev-parse", `${baseHead}^{tree}`], { cwd: root });
  return merge.ok && tree.ok && merge.stdout.trim() === tree.stdout.trim();
}

export function releaseClaim({ root, key, force = false, approval = null }) {
  const refusal = orchestratorRefusal(root);
  if (refusal) return refuse(refusal);
  const claim = claimFor(root, key);
  if (!claim) return refuse(`${key} has no claim to release`);
  if (claim.branch && keyOfBranch(claim.branch) !== key) return refuse(`${key} is not on its ticket branch; preserve it for the human`);
  if (claim.elsewhere) return refuse(`${key} is checked out outside .pathfinder at ${claim.elsewhere}; leave it to the human`);
  if (force && !approval?.trim()) return refuse("--force needs --approval naming the human's explicit permission to discard this claim");
  const base = defaultBranch(root);
  const baseHead = base && resolveRef(root, `refs/heads/${base}`);
  const head = claim.branch && resolveRef(root, `refs/heads/${claim.branch}`);
  const claimHead = resolveRef(root, `${CLAIM_REF_PREFIX}${key}`);
  if (!baseHead) return refuse("cannot resolve the default branch");
  const merged = head ? included(root, baseHead, head) : false;
  if (!merged && !force) return refuse(`${key}'s branch is not proven merged into ${base}; preserve it, or use --force with explicit human --approval`);
  if (claim.worktree) {
    const worktree = join(root, claim.worktree);
    const dirty = git(["status", "--porcelain", "--untracked-files=all"], { cwd: worktree });
    if (!dirty.ok) return refuse(dirty.message);
    if (dirty.stdout.trim() && !force) return refuse(`${key}'s worktree has uncommitted work; refusing to release it`);
    const remove = git(["worktree", "remove", ...(force ? ["--force"] : []), worktree], { cwd: root });
    if (!remove.ok) return refuse(`worktree removal failed; claim retained: ${remove.message}`);
  }
  if (claim.branch) {
    // -D is needed for a verified squash merge. Never used before the inclusion
    // check above, except when the human explicitly authorised discarding it.
    const remove = git(["branch", "-D", "--", claim.branch], { cwd: root });
    if (!remove.ok) return refuse(`branch removal failed; claim ref retained: ${remove.message}`);
  }
  if (claimHead) {
    const remove = deleteClaimRef(root, key, claimHead);
    if (!remove.ok) return refuse(`claim ref removal failed: ${remove.message}`);
  }
  return { ok: true, key, base, merged, forced: force, released: true };
}
