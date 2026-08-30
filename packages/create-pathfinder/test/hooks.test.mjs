/**
 * The session hook handler, from the outside: what a real run leaves on disk,
 * and what the file it leaves actually does.
 *
 * Two claims are being defended here, and they are not the same claim.
 *
 * The first is that installing puts one handler in a Claude Code destination,
 * nothing in any other destination, and — the load-bearing negative — no
 * settings file anywhere, ever. A generated handler is inert precisely because
 * nothing references it, so every "no settings file" assertion below is a byte
 * comparison of the whole fixture rather than a reading of the installer.
 *
 * The second is that the shipped handler behaves: it orients a session, quotes
 * `context/current-ticket.md` rather than interpreting it, and fails open and
 * silent on everything else. That half is checked by running the file, because
 * inspection is what missed `source` versus `session_start_reason` once
 * already.
 */

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import { run } from "../src/cli.mjs";
import { findHarness } from "../src/harnesses/index.mjs";
import { hookPath, hookSourcePath, hooksFor, isPathfinderHook } from "../src/harnesses/hook.mjs";

const CLAUDE = findHarness("claude-code");
const [ORIENTATION] = hooksFor(CLAUDE);
const HANDLER_RELATIVE = hookPath(CLAUDE, ORIENTATION);
const CANONICAL = readFileSync(hookSourcePath(ORIENTATION), "utf8");

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function makeRepository() {
  const cwd = mkdtempSync(join(tmpdir(), "pathfinder-hooks-"));
  temporaryRoots.push(cwd);
  mkdirSync(join(cwd, ".git"));
  return cwd;
}

function handler(cwd) {
  return join(cwd, ...HANDLER_RELATIVE.split("/"));
}

async function invoke(argv, { cwd } = {}) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    cwd,
    out: (text) => (out += text),
    err: (text) => (err += text),
    env: { LANG: "en_US.UTF-8" },
    platform: "linux",
    prompter: { interactive: false, confirm: async () => false, close: () => {} },
  });
  return { code, out, err };
}

/** Every file in the tree, path and bytes. The "nothing moved" comparison. */
function snapshot(root) {
  const entries = [];

  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      entries.push([
        relative(root, path).split(sep).join("/"),
        createHash("md5").update(readFileSync(path)).digest("hex"),
      ]);
    }
  };

  walk(root);
  return new Map(entries);
}

/** The paths whose bytes differ between two snapshots, added and removed too. */
function changedPaths(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
}

/** Every settings file in the fixture, by path. There must never be one. */
function settingsFiles(root) {
  return [...snapshot(root).keys()].filter((path) => /(^|\/)settings(\.[^/]+)?\.json$/.test(path));
}

/** Run the shipped handler the way a harness would. */
function runHandler(path, { cwd, payload = { source: "startup", cwd } } = {}) {
  return spawnSync(process.execPath, [path], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
}

describe("the handler a Claude Code destination receives", () => {
  it("is generated at the stable path, byte-identical to the canonical file", async () => {
    const cwd = makeRepository();

    const { code } = await invoke(["--agents", "claude-code"], { cwd });

    assert.equal(code, 0);
    assert.equal(existsSync(handler(cwd)), true);
    assert.equal(readFileSync(handler(cwd), "utf8"), CANONICAL);
    assert.equal(isPathfinderHook(readFileSync(handler(cwd), "utf8")), true);
  });

  it("is the only thing in the hooks directory, and is reported as inert", async () => {
    const cwd = makeRepository();

    const { out } = await invoke(["--agents", "claude-code"], { cwd });

    assert.deepEqual(readdirSync(join(cwd, ".claude", "hooks")), [ORIENTATION.file]);
    assert.equal(out.includes("session hook handler"), true);
    assert.equal(out.includes("inert; nothing runs it yet"), true);
  });

  it("creates no settings file, and changes none that was already there", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(join(cwd, ".claude", "settings.json"), '{"hooks":{"SessionStart":[]}}\n');
    writeFileSync(join(cwd, ".claude", "settings.local.json"), '{"permissions":{}}\n');

    const before = snapshot(cwd);
    await invoke(["--agents", "claude-code"], { cwd });
    const after = snapshot(cwd);

    assert.deepEqual(settingsFiles(cwd), [".claude/settings.json", ".claude/settings.local.json"]);
    assert.equal(
      changedPaths(before, after).includes(".claude/settings.json"),
      false,
    );
    assert.equal(
      changedPaths(before, after).includes(".claude/settings.local.json"),
      false,
    );
  });

  it("is reported by --dry-run without writing anything", async () => {
    const cwd = makeRepository();

    const before = snapshot(cwd);
    const { out } = await invoke(["--agents", "claude-code", "--dry-run"], { cwd });

    assert.deepEqual(changedPaths(before, snapshot(cwd)), []);
    assert.equal(out.includes("session hook handler to generate"), true);
  });
});

describe("a destination whose harness has no lifecycle event", () => {
  it("receives no handler and no .claude artifact of any kind", async () => {
    const cwd = makeRepository();

    const { code } = await invoke(["--agents", "codex"], { cwd });

    assert.equal(code, 0);
    assert.equal(existsSync(join(cwd, ".claude")), false);
    assert.deepEqual(settingsFiles(cwd), []);
    assert.equal(existsSync(join(cwd, ".agents", "skills")), true);
  });
});

describe("installing again", () => {
  it("replaces a handler Pathfinder generated", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });
    writeFileSync(handler(cwd), `${CANONICAL}\n// edited by a previous version\n`);

    const { out } = await invoke(["--agents", "claude-code"], { cwd });

    assert.equal(readFileSync(handler(cwd), "utf8"), CANONICAL);
    assert.equal(out.includes("1 Claude Code session hook handler generated"), true);
  });

  it("reports an unchanged handler as up to date rather than rewriting it", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });

    const before = snapshot(cwd);
    const { out } = await invoke(["--agents", "claude-code"], { cwd });

    assert.deepEqual(changedPaths(before, snapshot(cwd)), []);
    assert.equal(out.includes("session hook handler already up to date"), true);
  });

  it("leaves a user's own file at that path alone, and still touches no settings", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude", "hooks"), { recursive: true });
    writeFileSync(handler(cwd), "#!/usr/bin/env node\n// mine\n");
    writeFileSync(join(cwd, ".claude", "settings.json"), '{"hooks":{}}\n');

    const before = snapshot(cwd);
    const { out } = await invoke(["--agents", "claude-code"], { cwd });

    assert.equal(readFileSync(handler(cwd), "utf8"), "#!/usr/bin/env node\n// mine\n");
    assert.equal(changedPaths(before, snapshot(cwd)).includes(".claude/settings.json"), false);
    assert.equal(out.includes(HANDLER_RELATIVE), true);
  });

  it("replaces that file only when --force says so", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude", "hooks"), { recursive: true });
    writeFileSync(handler(cwd), "#!/usr/bin/env node\n// mine\n");

    await invoke(["--agents", "claude-code", "--force"], { cwd });

    assert.equal(readFileSync(handler(cwd), "utf8"), CANONICAL);
  });
});

describe("a handler this version no longer ships", () => {
  it("is reported as an orphan and left exactly where it is", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude", "hooks"), { recursive: true });
    const retired = join(cwd, ".claude", "hooks", "pathfinder-retired.mjs");
    writeFileSync(retired, "#!/usr/bin/env node\n// pathfinder:hook v1 name=retired\n");

    const { out } = await invoke(["--agents", "claude-code"], { cwd });

    assert.equal(existsSync(retired), true);
    assert.equal(readFileSync(retired, "utf8").includes("pathfinder:hook v1 name=retired"), true);
    assert.equal(out.includes(".claude/hooks/pathfinder-retired.mjs"), true);
  });

  it("leaves an unmarked stranger in that directory entirely unmentioned", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude", "hooks"), { recursive: true });
    writeFileSync(join(cwd, ".claude", "hooks", "mine.mjs"), "// nothing to do with Pathfinder\n");

    const { out } = await invoke(["--agents", "claude-code"], { cwd });

    assert.equal(existsSync(join(cwd, ".claude", "hooks", "mine.mjs")), true);
    assert.equal(out.includes("mine.mjs"), false);
  });
});

describe("the shipped handler, run", () => {
  it("quotes context/current-ticket.md verbatim and names the lifecycle source", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });
    writeFileSync(join(cwd, "context", "current-ticket.md"), "# Current Ticket\n\n48.1 — a ticket\n");

    const result = runHandler(handler(cwd), { cwd });

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes("Session: startup"), true);
    assert.equal(result.stdout.includes("48.1 — a ticket"), true);
    assert.equal(result.stdout.includes("run /whereami"), true);
  });

  it("prefers the payload's `source` over the published field name", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });

    const result = runHandler(handler(cwd), {
      cwd,
      payload: { cwd, source: "resume", session_start_reason: "startup" },
    });

    assert.equal(result.stdout.includes("Session: resume"), true);
  });

  it("says no ticket is loaded rather than inventing one", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });

    const result = runHandler(handler(cwd), { cwd });

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes("No ticket is loaded"), true);
    assert.equal(result.stdout.includes("Role:    none"), true);
  });

  it("produces nothing at all outside a Pathfinder project", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });
    const elsewhere = makeRepository();

    const result = runHandler(handler(cwd), { cwd: elsewhere, payload: { cwd: elsewhere } });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });

  it("fails open and silent on state it cannot read", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });
    writeFileSync(join(cwd, "context", "current-ticket.md"), "");

    const empty = runHandler(handler(cwd), { cwd });
    const garbage = spawnSync(process.execPath, [handler(cwd)], {
      cwd,
      input: "not json at all",
      encoding: "utf8",
      env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: cwd },
    });

    assert.equal(empty.status, 0);
    assert.equal(empty.stdout.includes("empty or unreadable"), true);
    assert.equal(empty.stderr, "");
    assert.equal(garbage.status, 0);
    assert.equal(garbage.stderr, "");
  });

  it("leaves the project byte-identical, repeatedly", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });
    writeFileSync(join(cwd, "context", "current-ticket.md"), "# Current Ticket\n\n48.1\n");

    const before = snapshot(cwd);
    for (let attempt = 0; attempt < 3; attempt += 1) runHandler(handler(cwd), { cwd });

    assert.deepEqual(changedPaths(before, snapshot(cwd)), []);
  });
});

describe("the excerpt's bound", () => {
  /**
   * The bound is the whole reason this handler can quote a file it refuses to
   * parse. `context/current-ticket.md` is free-form and unvalidated, so its
   * size is not guaranteed either, and an unbounded excerpt would page a
   * project file into every session — the opposite of orientation.
   *
   * Asserted on the quoted lines and on the size of the whole block, rather
   * than on the frame around them: the bound is the promise, and the wording
   * is not.
   */

  /** Install, and write a ticket file of exactly these lines. */
  async function withTicket(lines) {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });
    writeFileSync(join(cwd, "context", "current-ticket.md"), `${lines.join("\n")}\n`);
    return runHandler(handler(cwd), { cwd });
  }

  it("stops at the line bound, says so, and leaves the tail out", async () => {
    const lines = Array.from({ length: 400 }, (_, index) => `line ${index + 1}`);

    const result = await withTicket(lines);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes("truncated"), true, "no truncation notice");
    assert.equal(result.stdout.includes("line 1\n"), true, "the excerpt does not start at the top");
    assert.equal(result.stdout.includes("line 400"), false, "the tail of the file reached the session");

    // The bound itself, counted on the quoted lines so the frame around them
    // is free to change.
    const quoted = result.stdout.split("\n").filter((line) => /^line \d+$/.test(line));
    assert.ok(quoted.length > 0, "nothing was quoted at all");
    assert.ok(quoted.length <= 40, `${quoted.length} lines quoted, past the 40-line bound`);
  });

  it("stops at the character bound when the lines are few and long", async () => {
    // Eight lines — well inside the line bound — and 4,800 characters, well
    // past the character one. Only the second bound can catch this.
    const lines = Array.from({ length: 8 }, () => "x".repeat(600));
    lines.push("SENTINEL-AT-THE-END");

    const result = await withTicket(lines);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes("truncated"), true, "no truncation notice");
    assert.equal(result.stdout.includes("SENTINEL-AT-THE-END"), false, "the end of the file reached the session");
    assert.ok(
      result.stdout.length < 3000,
      `${result.stdout.length} bytes emitted; the excerpt is bounded at 2,000`,
    );
  });
});

describe("what the capability deliberately is not", () => {
  it("interprets nothing: a shapeless ticket file comes back verbatim", async () => {
    // Bounded verbatim transport is the design constraint, not a shortcut.
    // `/ticket load` writes this file with no schema and nothing validates its
    // shape, so the handler is proven against a file that has none — if it
    // were parsing, this is where it would either fail or invent.
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });
    const shapeless = "Status: whatever\n:::\n- [ ] Feature: not a heading\n\tnext action?? none\n";
    writeFileSync(join(cwd, "context", "current-ticket.md"), shapeless);

    const result = runHandler(handler(cwd), { cwd });

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes(shapeless.trimEnd()), true);
    assert.equal(result.stdout.includes("Role:    none"), true);
  });

  it("reads that file with no matcher of any kind", () => {
    // The cheap backstop for the behavioral test above: a parser has to match
    // something, and the handler matches nothing.
    assert.equal(/\.(match|matchAll|exec)\(|new RegExp/.test(CANONICAL), false);
  });

  it("writes no settings file from anywhere in the installer", () => {
    const source = fileURLToPath(new URL("../src", import.meta.url));
    const offenders = [];

    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/settings(\.[^/]+)?\.json/.test(readFileSync(path, "utf8"))) offenders.push(path);
      }
    };

    walk(source);
    assert.deepEqual(offenders, []);
  });
});
