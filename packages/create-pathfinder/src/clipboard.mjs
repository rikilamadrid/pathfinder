/**
 * Writing one string to the system clipboard, and never reading it back.
 *
 * Three rules shape this file.
 *
 * **It is a convenience, so it may not fail.** Every way this can go wrong — no
 * tool installed, no display to talk to, a tool that exits non-zero, a tool that
 * hangs — degrades to "not copied" and a printed prompt the user can select the
 * old way. Nothing here can change an install's exit code.
 *
 * **No dependency.** A clipboard package would be the first runtime dependency
 * in a project whose identity is "not a framework," bought for a feature that
 * has to be optional anyway. Platform-native commands cost a table.
 *
 * **Write only.** There is no read function, and there should never be one. The
 * clipboard is where people keep passwords for thirty seconds.
 */

import { spawnSync } from "node:child_process";

import { onPath } from "./detect.mjs";

/** Long enough for a real tool, short enough that a wedged one is not the install. */
const TIMEOUT_MS = 3000;

/**
 * The clipboard writers worth trying, in the order they are tried.
 *
 * Ordered per platform, but *selected* by availability, which is what makes WSL
 * work without a special case: it reports `linux`, has neither Wayland nor X,
 * and does have `clip.exe`, so it falls through the three Linux entries and
 * lands on the fourth. Probing the platform string alone would have told it to
 * give up after `xsel`.
 *
 * Every command takes its text on **stdin**. None of them takes it as an
 * argument, which is not a coincidence — it is the property that makes this
 * safe, because the prompt never becomes part of a command line.
 */
const WRITERS = Object.freeze({
  darwin: [{ command: "pbcopy", args: [] }],
  win32: [{ command: "clip", args: [] }],
  default: [
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] },
    // WSL, and any Linux that can reach a Windows host's clipboard.
    { command: "clip.exe", args: [] },
  ],
});

/**
 * The clipboard command this machine can actually run, or null.
 *
 * Null is an ordinary answer, not an error: a headless server has no clipboard,
 * and saying so is more useful than trying four commands and reporting the
 * fourth one's stderr.
 *
 * @returns {{command: string, args: string[]} | null}
 */
export function clipboardCommand({ env = {}, platform = process.platform } = {}) {
  const candidates = WRITERS[platform] ?? WRITERS.default;
  return candidates.find((writer) => onPath(writer.command, env, platform)) ?? null;
}

/**
 * Put `text` on the clipboard. Say whether it worked.
 *
 * Never throws. A spawn that fails, a tool that exits non-zero, a timeout, and
 * a machine with no clipboard tool at all are four different reasons and one
 * outcome, and the caller prints a single line about it either way.
 *
 * @param {string} text
 * @returns {{ok: true, command: string} | {ok: false, reason: string}}
 */
export function copyToClipboard(text, { env = {}, platform = process.platform } = {}) {
  const writer = clipboardCommand({ env, platform });
  if (writer === null) return { ok: false, reason: "no clipboard tool is available here" };

  let result;
  try {
    result = spawnSync(writer.command, writer.args, {
      // An array, never a shell string. The text goes down stdin and is never
      // interpolated into a command line, so a prompt containing a backtick, a
      // semicolon, or a newline is data on every platform.
      shell: false,
      // The same environment the command was *found* in. Resolving `pbcopy`
      // against one PATH and then running it against another is how a probe
      // ends up disagreeing with the thing it probed for.
      env,
      input: text,
      timeout: TIMEOUT_MS,
      // Captured, not inherited: xclip's complaint about a missing DISPLAY must
      // not appear to be something Pathfinder said.
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    });
  } catch (error) {
    // spawnSync generally reports rather than throws, but a bad argv or an
    // exhausted process table can still land here, and a convenience feature
    // is not allowed to take the install down with it.
    return { ok: false, reason: describe(writer.command, error?.message) };
  }

  if (result.error) {
    const timedOut = result.error.code === "ETIMEDOUT" || result.signal !== null;
    return {
      ok: false,
      reason: timedOut
        ? `${writer.command} did not finish`
        : describe(writer.command, result.error.message),
    };
  }

  if (result.status !== 0) {
    // The tool's own first line of stderr is the most useful thing available —
    // "Error: Can't open display" is the actual answer — but it is quoted, so
    // it reads as the tool's words rather than Pathfinder's.
    const detail = firstLine(result.stderr);
    return {
      ok: false,
      reason: detail === "" ? `${writer.command} failed` : `${writer.command} said: ${detail}`,
    };
  }

  return { ok: true, command: writer.command };
}

function describe(command, message) {
  return message ? `${command} could not be run: ${firstLine(message)}` : `${command} could not be run`;
}

function firstLine(text) {
  return String(text ?? "").split("\n")[0].trim();
}
