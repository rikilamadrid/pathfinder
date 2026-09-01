/**
 * Hook ownership, without a filesystem.
 *
 * The same discipline `adapter.test.mjs` applies to adapters, and the same
 * reason for it: the ownership decision is what stands between the installer
 * and somebody else's file, so it is proven exhaustively as a pure function
 * rather than incidentally through an install.
 *
 * What differs from an adapter is only the marker's syntax and its version
 * line. The state table itself is shared, which is why the states below are
 * the adapter states.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { ADAPTER_STATE } from "../src/harnesses/adapter.mjs";
import {
  HOOK_MARKER_VERSION,
  classifyHook,
  hookPath,
  hooksFor,
  isPathfinderHook,
  readHookMarker,
  shippedHookFiles,
} from "../src/harnesses/hook.mjs";
import { findHarness } from "../src/harnesses/index.mjs";

const MARKED = "#!/usr/bin/env node\n// pathfinder:hook v1 name=session-orientation\nmain();\n";

describe("the hook marker", () => {
  it("is read from a line comment, carrying its version and name", () => {
    assert.deepEqual(readHookMarker(MARKED), { version: 1, name: "session-orientation" });
  });

  it("is recognized but not claimed when a future format wrote it", () => {
    const future = MARKED.replace("v1", "v2");

    assert.equal(readHookMarker(future).version, 2);
    assert.equal(isPathfinderHook(future), false);
  });

  it("is not found inside a longer line, so a quoted one cannot be mistaken for it", () => {
    const quoted = 'const example = "// pathfinder:hook v1 name=session-orientation";\n';

    assert.equal(readHookMarker(quoted), null);
  });

  it("is absent from a file that has none, and from nothing at all", () => {
    assert.equal(readHookMarker("#!/usr/bin/env node\n"), null);
    assert.equal(readHookMarker(null), null);
    assert.equal(HOOK_MARKER_VERSION, 1);
  });
});

describe("classifying one path a handler would occupy", () => {
  const expected = MARKED;

  it("is absent when nothing is there", () => {
    const { state, owned } = classifyHook({ name: "session-orientation", existing: null, expected });

    assert.equal(state, ADAPTER_STATE.ABSENT);
    assert.equal(owned, true);
  });

  it("is current when our marker and the bytes both agree", () => {
    const { state } = classifyHook({ name: "session-orientation", existing: expected, expected });

    assert.equal(state, ADAPTER_STATE.CURRENT);
  });

  it("is stale when our marker is there and the bytes are not", () => {
    const { state, owned } = classifyHook({
      name: "session-orientation",
      existing: `${expected}// left over from an older version\n`,
      expected,
    });

    assert.equal(state, ADAPTER_STATE.STALE);
    assert.equal(owned, true);
  });

  it("is a conflict when the file carries no marker we own", () => {
    for (const existing of ["#!/usr/bin/env node\n// mine\n", MARKED.replace("v1", "v9")]) {
      const { state, owned } = classifyHook({ name: "session-orientation", existing, expected });

      assert.equal(state, ADAPTER_STATE.CONFLICT, existing);
      assert.equal(owned, false, existing);
    }
  });

  it("is an orphan when we wrote it and this version no longer ships it", () => {
    const { state, owned } = classifyHook({
      name: "retired",
      isShippedHook: false,
      existing: MARKED.replace("session-orientation", "retired"),
    });

    assert.equal(state, ADAPTER_STATE.ORPHAN);
    assert.equal(owned, false);
  });

  it("is unmanaged when it is neither ours nor ours to ship", () => {
    const { state } = classifyHook({
      name: "stranger",
      isShippedHook: false,
      existing: "// nothing to do with Pathfinder\n",
    });

    assert.equal(state, ADAPTER_STATE.UNMANAGED);
  });
});

describe("what the registry says a harness receives", () => {
  it("gives Claude Code one handler, at a path built from the registry", () => {
    const claude = findHarness("claude-code");
    const [hook] = hooksFor(claude);

    assert.equal(hooksFor(claude).length, 1);
    assert.equal(hookPath(claude, hook), ".claude/hooks/pathfinder-session-orientation.mjs");
    assert.deepEqual([...shippedHookFiles(claude)], ["pathfinder-session-orientation.mjs"]);
  });

  it("gives a harness with no lifecycle event none, rather than a substitute", () => {
    const codex = findHarness("codex");

    assert.deepEqual(hooksFor(codex), []);
    assert.deepEqual([...shippedHookFiles(codex)], []);
    assert.equal(codex.hooksDir, undefined);
  });
});
