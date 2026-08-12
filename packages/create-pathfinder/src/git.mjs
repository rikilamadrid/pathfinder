/**
 * The one Git command this tool is allowed to run.
 *
 * `git init`, in the directory it was given, and nothing else. No `add`, no
 * `commit`, no `config`, no branch manipulation, no `init` in a parent. The
 * narrowness is the design: this module has no way to express a destructive
 * operation, so no future edit to a caller can turn one on by passing a
 * different argument.
 *
 * Invoked with an argument array, never a shell string, so a directory whose
 * name contains a space, a quote, or a `;` is data rather than syntax.
 *
 * Output is captured rather than inherited. `git init` prints a `hint:` block
 * about default branch names on many installations, and inheriting stdio would
 * make that paragraph appear to be Pathfinder's own voice, in the middle of
 * Pathfinder's own report. Success is reported in our words; failure hands back
 * git's stderr, because there the detail is the actionable part.
 */

import { spawnSync } from "node:child_process";

/**
 * Initialize a repository in `cwd`.
 *
 * Never throws. A missing binary, a read-only path, and a permissions error are
 * all outcomes to report, not exceptions to escape into a stack trace over the
 * top of a half-finished install.
 *
 * @param {string} cwd
 * @param {{spawn?: typeof spawnSync}} [options] - seam for tests; production
 *   passes nothing.
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function initRepository(cwd, { spawn = spawnSync } = {}) {
  let result;

  try {
    result = spawn("git", ["init"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    return { ok: false, message: error.message };
  }

  // ENOENT arrives here rather than as a throw: the binary vanished between
  // detection and use, or PATH said something that was not true.
  if (result.error) return { ok: false, message: result.error.message };

  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    return { ok: false, message: stderr || `\`git init\` exited with status ${result.status}` };
  }

  return { ok: true };
}
