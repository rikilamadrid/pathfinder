#!/usr/bin/env node
/**
 * Supported manual packaging/publishing boundary: an explicit Git commit.
 * Nothing is staged in the source checkout; npm and its lifecycle scripts run
 * in a private repository containing only committed files. No dependencies.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const [action, revision, destination, ...extra] = process.argv.slice(2);

// Git environment overrides must not redirect commands back into the caller's
// index/worktree. Local checkout configuration and attributes are not copied.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
env.GIT_CONFIG_NOSYSTEM = "1";
env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

let scratch;
function clean() {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
// Also clean on ordinary terminal interruption. SIGKILL/power loss cannot run
// cleanup; any remnants are private OS-temp directories, never source staging.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clean();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  if (!["pack", "publish"].includes(action) || !revision || extra.length ||
      (action === "pack" ? !destination : destination !== undefined)) {
    throw new Error("usage: node packages/create-pathfinder/scripts/package-snapshot.mjs " +
      "pack <commit> <output-directory> | publish <commit>");
  }
  if (action === "publish" && process.env.PATHFINDER_PUBLISH !== "yes") {
    throw new Error("publishing requires explicit PATHFINDER_PUBLISH=yes intent");
  }
  const commit = git(REPO_ROOT, "rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`);
  // Preserve the guard's existing preference for origin/main over local main.
  let mainline;
  for (const ref of ["refs/remotes/origin/main", "refs/heads/main"]) {
    try {
      mainline = { ref, commit: git(REPO_ROOT, "rev-parse", "--verify", `${ref}^{commit}`) };
      break;
    } catch { /* A source without either ref remains subject to the guard. */ }
  }
  console.log(`package-snapshot: ${action} commit ${commit}`);
  const output = destination && resolve(destination);
  scratch = mkdtempSync(join(tmpdir(), "pathfinder-package-"));
  const snapshot = join(scratch, "checkout");
  mkdirSync(snapshot);
  git(snapshot, "init", "--quiet", "--initial-branch=snapshot");
  // Fetch objects and the real tags, never files or configuration from the
  // maintainer's checkout. Fetch the pinned mainline as well for guard ancestry.
  git(snapshot, "fetch", "--quiet", "--no-tags", REPO_ROOT, commit,
    ...(mainline ? [mainline.commit] : []), "refs/tags/*:refs/tags/*");
  if (mainline) git(snapshot, "update-ref", mainline.ref, mainline.commit);
  git(snapshot, "checkout", "--quiet", "--detach", commit);
  const packageRoot = join(snapshot, "packages", "create-pathfinder");
  if (output) mkdirSync(output, { recursive: true });
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm",
    [action, "--ignore-scripts=false", ...(output ? ["--pack-destination", output] : [])],
    { cwd: packageRoot, env, stdio: "inherit" });
} catch (error) {
  console.error(`package-snapshot: ${error.message}`);
  process.exitCode = 1;
} finally {
  clean();
}
