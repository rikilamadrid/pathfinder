/**
 * Clipboard-writer selection and failure handling.
 *
 * Selection is tested over a synthesized PATH — real directories holding real
 * files with the right names — rather than by stubbing the probe, because the
 * thing worth proving is that WSL picks `clip.exe` after falling through three
 * Linux tools, and that is a property of the ordering and the filesystem.
 *
 * The copy itself is driven against throwaway scripts that record their stdin,
 * so "did it get the exact bytes" is answered by reading a file rather than by
 * trusting an exit code.
 */

import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { clipboardCommand, copyToClipboard } from "../src/clipboard.mjs";

const temporaries = [];

function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "pathfinder-clipboard-"));
  temporaries.push(directory);
  return directory;
}

/** A PATH directory holding empty files with these names. Enough for detection. */
function pathWith(names) {
  const directory = scratch();
  for (const name of names) writeFileSync(join(directory, name), "");
  return directory;
}

/**
 * A PATH holding one executable script under `name`, ahead of the real PATH.
 *
 * The system directories are appended because the child is spawned with the
 * same environment the command was found in, so a script that runs `cat` needs
 * somewhere to find it. The scratch directory comes first, so the stub still
 * wins over any real tool of the same name.
 */
function pathWithScript(name, body) {
  const directory = scratch();
  const file = join(directory, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return `${directory}:${process.env.PATH ?? ""}`;
}

test.after(() => {
  for (const directory of temporaries) rmSync(directory, { recursive: true, force: true });
});

test("macOS uses pbcopy", () => {
  const env = { PATH: pathWith(["pbcopy"]) };
  assert.deepEqual(clipboardCommand({ env, platform: "darwin" }), { command: "pbcopy", args: [] });
});

test("macOS without pbcopy has no clipboard rather than a Linux fallback", () => {
  // pbcopy ships with macOS, so its absence means something is deeply wrong —
  // and reaching for xclip there would be a guess, not a fallback.
  const env = { PATH: pathWith(["wl-copy", "xclip", "xsel"]) };
  assert.equal(clipboardCommand({ env, platform: "darwin" }), null);
});

test("Windows uses clip, found through PATHEXT", () => {
  const env = { PATH: pathWith(["clip.EXE"]), PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  assert.deepEqual(clipboardCommand({ env, platform: "win32" }), { command: "clip", args: [] });
});

test("Linux prefers wl-copy, then xclip, then xsel", () => {
  const all = { PATH: pathWith(["wl-copy", "xclip", "xsel"]) };
  assert.equal(clipboardCommand({ env: all, platform: "linux" }).command, "wl-copy");

  const noWayland = { PATH: pathWith(["xclip", "xsel"]) };
  assert.deepEqual(clipboardCommand({ env: noWayland, platform: "linux" }), {
    command: "xclip",
    args: ["-selection", "clipboard"],
  });

  const onlyXsel = { PATH: pathWith(["xsel"]) };
  assert.deepEqual(clipboardCommand({ env: onlyXsel, platform: "linux" }), {
    command: "xsel",
    args: ["--clipboard", "--input"],
  });
});

test("WSL lands on clip.exe by availability, not by platform string", () => {
  // Reports `linux`, has no Wayland and no X, and can reach the Windows host.
  // Nothing in the code special-cases WSL; it falls through the three Linux
  // entries and finds the fourth.
  const env = { PATH: pathWith(["clip.exe"]) };
  assert.deepEqual(clipboardCommand({ env, platform: "linux" }), { command: "clip.exe", args: [] });
});

test("a real Linux desktop is not diverted to clip.exe", () => {
  const env = { PATH: pathWith(["wl-copy", "clip.exe"]) };
  assert.equal(clipboardCommand({ env, platform: "linux" }).command, "wl-copy");
});

test("an unknown platform gets the Linux candidate list", () => {
  const env = { PATH: pathWith(["xsel"]) };
  assert.equal(clipboardCommand({ env, platform: "freebsd" }).command, "xsel");
});

test("no clipboard tool anywhere is null, not an error", () => {
  assert.equal(clipboardCommand({ env: { PATH: pathWith([]) }, platform: "linux" }), null);
  assert.equal(clipboardCommand({ env: {}, platform: "darwin" }), null);
  assert.equal(clipboardCommand({ env: { PATH: "" }, platform: "linux" }), null);
});

test("a headless machine reports why, and does not throw", () => {
  const result = copyToClipboard("anything", { env: { PATH: pathWith([]) }, platform: "linux" });
  assert.deepEqual(result, { ok: false, reason: "no clipboard tool is available here" });
});

test("the text reaches the tool on stdin, byte for byte", (t) => {
  if (process.platform === "win32") return t.skip("POSIX shell scripts");

  const sink = join(scratch(), "captured");
  const env = { PATH: pathWithScript("pbcopy", `cat > ${JSON.stringify(sink)}`) };

  const prompt = "/kickstart-pathfinder";
  const result = copyToClipboard(prompt, { env, platform: "darwin" });

  assert.deepEqual(result, { ok: true, command: "pbcopy" });
  assert.equal(readFileSync(sink, "utf8"), prompt);
});

test("no trailing newline is added", (t) => {
  if (process.platform === "win32") return t.skip("POSIX shell scripts");

  // A pasted newline is Enter in both harnesses. Copying one would submit the
  // prompt the moment it lands, which is a surprise rather than a convenience.
  const sink = join(scratch(), "captured");
  const env = { PATH: pathWithScript("pbcopy", `cat > ${JSON.stringify(sink)}`) };

  copyToClipboard("/kickstart-pathfinder", { env, platform: "darwin" });
  assert.equal(readFileSync(sink, "utf8").endsWith("\n"), false);
});

test("shell metacharacters in the prompt are data, not commands", (t) => {
  if (process.platform === "win32") return t.skip("POSIX shell scripts");

  const sink = join(scratch(), "captured");
  const canary = join(scratch(), "canary");
  const env = { PATH: pathWithScript("pbcopy", `cat > ${JSON.stringify(sink)}`) };

  // If any of this were ever interpolated into a command line, the canary
  // would exist. It is spawned with an argument array and fed on stdin, so it
  // cannot be.
  const hostile = `; touch ${canary}\n$(touch ${canary})\n\`touch ${canary}\` && rm -rf /`;
  const result = copyToClipboard(hostile, { env, platform: "darwin" });

  assert.equal(result.ok, true);
  assert.equal(readFileSync(sink, "utf8"), hostile);
  assert.throws(() => readFileSync(canary), /ENOENT/);
});

test("a tool that exits non-zero is a reported failure, quoting the tool", (t) => {
  if (process.platform === "win32") return t.skip("POSIX shell scripts");

  // The stub drains stdin before it complains. A script that exits without
  // reading closes the pipe under the parent mid-write, and the parent then
  // reports EPIPE rather than the child's exit status — which is still a
  // correct "not copied", but it is the wrong failure for a test named after
  // the tool's own message. Whether the race is lost depends on the kernel and
  // the runner: this passed on macOS and failed on Linux CI.
  const env = {
    PATH: pathWithScript(
      "xclip",
      "cat > /dev/null\necho \"Error: Can't open display: (null)\" >&2\nexit 1",
    ),
  };

  const result = copyToClipboard("prompt", { env, platform: "linux" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "xclip said: Error: Can't open display: (null)");
});

test("a tool that fails silently still reports a reason", (t) => {
  if (process.platform === "win32") return t.skip("POSIX shell scripts");

  // Drained for the same reason as above: this test is about a tool that exits
  // non-zero saying nothing, not about a tool that hung up early.
  const env = { PATH: pathWithScript("xsel", "cat > /dev/null\nexit 3") };
  const result = copyToClipboard("prompt", { env, platform: "linux" });
  assert.deepEqual(result, { ok: false, reason: "xsel failed" });
});

test("a present but unrunnable command is a failure, not a crash", (t) => {
  if (process.platform === "win32") return t.skip("POSIX file modes");

  // Detection scans PATH with existsSync and cannot tell executable from not,
  // which is documented as the right direction to be wrong in. This is what
  // being wrong in that direction has to look like: a reported line, no throw.
  const directory = scratch();
  writeFileSync(join(directory, "pbcopy"), "not executable");
  chmodSync(join(directory, "pbcopy"), 0o644);

  const result = copyToClipboard("prompt", { env: { PATH: directory }, platform: "darwin" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /pbcopy could not be run/);
});

test("a tool that hangs is given up on rather than waited for", (t) => {
  if (process.platform === "win32") return t.skip("POSIX shell scripts");

  const env = { PATH: pathWithScript("wl-copy", "sleep 30") };

  const started = Date.now();
  const result = copyToClipboard("prompt", { env, platform: "linux" });
  const elapsed = Date.now() - started;

  assert.equal(result.ok, false);
  assert.equal(result.reason, "wl-copy did not finish");
  assert.ok(elapsed < 10_000, `gave up after ${elapsed}ms`);
});

test("a directory named like the tool does not become a copy that silently fails", (t) => {
  if (process.platform === "win32") return t.skip("POSIX shell scripts");

  const directory = scratch();
  mkdirSync(join(directory, "pbcopy"));

  const result = copyToClipboard("prompt", { env: { PATH: directory }, platform: "darwin" });
  assert.equal(result.ok, false);
});

test("a very long prompt survives the pipe", (t) => {
  if (process.platform === "win32") return t.skip("POSIX shell scripts");

  const sink = join(scratch(), "captured");
  const env = { PATH: pathWithScript("pbcopy", `cat > ${JSON.stringify(sink)}`) };

  const long = "x".repeat(200_000);
  assert.equal(copyToClipboard(long, { env, platform: "darwin" }).ok, true);
  assert.equal(readFileSync(sink, "utf8").length, 200_000);
});
