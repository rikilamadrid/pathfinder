/**
 * Editor detection and launching, in isolation.
 *
 * No real editor is ever started. Detection is answered from a synthesized
 * PATH, and every launch runs a stub that records what it was given — so
 * "detached" is proved by the CLI returning while the stub is still asleep,
 * and "one argument" by the stub printing one line.
 */

import { strict as assert } from "node:assert";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { detectEditors, openInEditor } from "../src/editor.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function scratch(prefix = "pathfinder-editor-") {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

/** A directory holding empty files named after commands. Detection only. */
function pathWith(commands) {
  const directory = scratch();
  for (const command of commands) writeFileSync(join(directory, command), "");
  return directory;
}

/** A runnable stub that writes each argument on its own line. */
function stub(name, script) {
  const directory = scratch();
  const sink = join(directory, "arguments");
  writeFileSync(
    join(directory, name),
    script ?? `#!/bin/sh\nfor argument in "$@"; do echo "$argument"; done > ${JSON.stringify(sink)}\n`,
  );
  chmodSync(join(directory, name), 0o755);

  return {
    path: directory,
    async waitForArguments(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (existsSync(sink)) return readFileSync(sink, "utf8").trimEnd().split("\n");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return null;
    },
  };
}

describe("detecting editors", () => {
  it("finds nothing when neither command is on PATH", () => {
    const env = { PATH: pathWith([]) };
    assert.deepEqual(detectEditors({ env, platform: "linux" }), []);
  });

  it("finds VS Code by `code`", () => {
    const env = { PATH: pathWith(["code"]) };
    assert.deepEqual(
      detectEditors({ env, platform: "linux" }).map((editor) => editor.label),
      ["VS Code"],
    );
  });

  it("finds Cursor by `cursor`", () => {
    const env = { PATH: pathWith(["cursor"]) };
    assert.deepEqual(
      detectEditors({ env, platform: "linux" }).map((editor) => editor.label),
      ["Cursor"],
    );
  });

  it("lists both alphabetically, so the order endorses nothing", () => {
    const env = { PATH: pathWith(["code", "cursor"]) };
    assert.deepEqual(
      detectEditors({ env, platform: "linux" }).map((editor) => editor.label),
      ["Cursor", "VS Code"],
    );
  });

  it("reports an editor once, however many times PATH offers it", () => {
    const first = pathWith(["code"]);
    const second = pathWith(["code"]);
    const env = { PATH: `${first}:${second}` };
    assert.deepEqual(
      detectEditors({ env, platform: "linux" }).map((editor) => editor.id),
      ["vscode"],
    );
  });

  it("finds nothing with no PATH at all", () => {
    assert.deepEqual(detectEditors({ env: {}, platform: "linux" }), []);
    assert.deepEqual(detectEditors({ env: { PATH: "" }, platform: "linux" }), []);
  });

  it("honors PATHEXT on Windows", () => {
    const directory = scratch();
    writeFileSync(join(directory, "code.CMD"), "");
    const env = { PATH: directory, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    assert.deepEqual(
      detectEditors({ env, platform: "win32" }).map((editor) => editor.id),
      ["vscode"],
    );
  });
});

describe("launching an editor", () => {
  const vscode = { id: "vscode", label: "VS Code", command: "code" };

  it("passes the directory as a single argument", async () => {
    const editor = stub("code");
    const directory = scratch("pathfinder-editor-target-");

    const result = await openInEditor(vscode, directory, {
      env: { PATH: editor.path },
      platform: "linux",
    });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(await editor.waitForArguments(), [directory]);
  });

  it("keeps a path containing spaces in one piece", async () => {
    const editor = stub("code");
    const directory = join(scratch(), "a project");
    mkdirSync(directory);

    await openInEditor(vscode, directory, { env: { PATH: editor.path }, platform: "linux" });

    assert.deepEqual(await editor.waitForArguments(), [directory]);
  });

  it("returns before the editor exits", async () => {
    const editor = stub("code", "#!/bin/sh\nsleep 30\n");
    const started = Date.now();

    const result = await openInEditor(vscode, scratch(), {
      env: { PATH: editor.path },
      platform: "linux",
    });

    assert.deepEqual(result, { ok: true });
    assert.ok(Date.now() - started < 5000, "the launch did not wait for the editor");
  });

  it("reports a missing binary rather than throwing", async () => {
    const result = await openInEditor(vscode, scratch(), {
      env: { PATH: pathWith([]) },
      platform: "linux",
    });

    assert.equal(result.ok, false);
    assert.match(result.reason, /^code could not be run/);
  });

  it("reports a binary that cannot be executed", async () => {
    const directory = scratch();
    writeFileSync(join(directory, "code"), "not an executable\n");
    chmodSync(join(directory, "code"), 0o644);

    const result = await openInEditor(vscode, scratch(), {
      env: { PATH: directory },
      platform: "linux",
    });

    assert.equal(result.ok, false);
    assert.match(result.reason, /^code could not be run/);
  });

  it("does not report a launch that succeeds and then fails on its own", async () => {
    // An editor that starts and immediately exits non-zero has already left
    // Pathfinder's hands. Waiting for its exit code would mean waiting for
    // every editor's exit code, which is waiting for the user to close it.
    const editor = stub("code", "#!/bin/sh\nexit 3\n");

    const result = await openInEditor(vscode, scratch(), {
      env: { PATH: editor.path },
      platform: "linux",
    });

    assert.deepEqual(result, { ok: true });
  });
});
