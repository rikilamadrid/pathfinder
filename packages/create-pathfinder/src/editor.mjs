/**
 * Finding the editors this machine can actually launch, and launching one.
 *
 * The same three rules the clipboard follows, for the same reasons.
 *
 * **It is a convenience, so it may not fail.** No editor installed, a binary
 * that cannot be executed, a launch that dies on the spot — all of it degrades
 * to "not opened" and one printed line. The project is installed either way,
 * and nothing here can change an install's exit code.
 *
 * **Only what was detected.** There is no way to name an editor, pass a path,
 * or configure one. An editor Pathfinder did not find on PATH is an editor it
 * does not offer, which is what keeps this from growing into a launcher.
 *
 * **Detached.** The CLI hands the project to the editor and forgets it. It does
 * not wait for the editor to exit, does not hold its streams, and does not
 * print its output as Pathfinder's — an installer that stays alive until you
 * close your editor would be a bug that looks like a hang.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";

import { onPath } from "./detect.mjs";

/**
 * The editors that can be offered, in the order they are offered.
 *
 * Alphabetical by label, deliberately. Some order has to exist, and every
 * ordering that means something — most popular, best supported, the one we use
 * — would make this table an endorsement. The alphabet endorses nothing, and
 * it puts Cursor above VS Code, which is a useful reminder that neither is a
 * Pathfinder requirement.
 *
 * Detection is by command on PATH and nothing else. `src/detect.mjs` reports
 * these two tools more generously — a `.cursor` directory counts there — and
 * that is right for a finding and wrong for a launch: a marker directory does
 * not give you a binary to run.
 */
const EDITORS = Object.freeze([
  Object.freeze({ id: "cursor", label: "Cursor", command: "cursor" }),
  Object.freeze({ id: "vscode", label: "VS Code", command: "code" }),
]);

/**
 * The editors this machine can launch. Possibly none, which is an ordinary
 * answer: a server with no editor installed simply is not asked the question.
 *
 * @returns {ReadonlyArray<{id: string, label: string, command: string}>}
 */
export function detectEditors({ env = {}, platform = process.platform } = {}) {
  return EDITORS.filter((editor) => onPath(editor.command, env, platform));
}

/**
 * Ask `editor` to open `directory`, and say whether the launch got off the
 * ground. Never throws.
 *
 * "Got off the ground" is the honest limit of what this can report. It resolves
 * as soon as the child process exists — Node's `spawn` event — and deliberately
 * not on its exit, because waiting for an editor to exit is waiting for the
 * user to close their editor. An editor that starts and then fails on its own
 * has its own way of saying so, on its own screen.
 *
 * @param {{label: string, command: string}} editor
 * @param {string} directory
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
export async function openInEditor(
  editor,
  directory,
  { env = {}, platform = process.platform } = {},
) {
  const windows = platform === "win32";

  // `code` and `cursor` are `.cmd` shims on Windows, which Node refuses to
  // execute directly, so there it goes through the command processor. The
  // quoting is ours rather than the shell's, because `windowsVerbatimArguments`
  // hands this line through untouched — and it needs one more pair of quotes
  // than looks right.
  //
  // `cmd /s /c` strips the first and last quote of everything after `/c`,
  // unconditionally. Passing `"code" "C:\my project"` therefore loses the quote
  // before `code` and the one after the path, leaving `code" "C:\my project` —
  // a broken command line, and a silently unopened editor. Wrapping the whole
  // thing in an outer pair spends those two quotes on the wrapper, so what
  // survives the strip is the command line actually meant: the executable
  // quoted, and a project path with spaces in it still a single argument.
  //
  // Everywhere else it is an argument array with no shell at all.
  const command = windows ? env.ComSpec || env.COMSPEC || "cmd.exe" : editor.command;
  const args = windows
    ? ["/d", "/s", "/c", `""${editor.command}" "${directory}""`]
    : [directory];

  let child;
  try {
    child = spawn(command, args, {
      shell: false,
      // The environment the command was *found* in, for the same reason the
      // clipboard does it: resolving `code` against one PATH and running it
      // against another is how a probe disagrees with the thing it probed for.
      env,
      // Detached and ignored together. Its own process group so it outlives
      // this one, and no inherited streams so the editor's startup chatter is
      // never mistaken for something Pathfinder said.
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: windows,
      windowsHide: true,
    });
  } catch (error) {
    return { ok: false, reason: describe(editor.command, error?.message) };
  }

  try {
    // Resolves on `spawn`, rejects on `error` — a missing or unexecutable
    // binary reports ENOENT or EACCES here, before anything is unreferenced.
    await once(child, "spawn");
  } catch (error) {
    return { ok: false, reason: describe(editor.command, error?.message) };
  }

  // Anything that goes wrong after a successful spawn belongs to the editor,
  // not to the install — but an unhandled `error` event would still take this
  // process down on its way out, so it is absorbed.
  child.on("error", () => {});
  child.unref();

  return { ok: true };
}

function describe(command, message) {
  const detail = String(message ?? "").split("\n")[0].trim();
  return detail === "" ? `${command} could not be run` : `${command} could not be run: ${detail}`;
}
