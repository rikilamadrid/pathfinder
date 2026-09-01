/**
 * The derived facts both renderings print.
 *
 * Every case here is built from plain objects — no temporary repository, no
 * fake terminal, no `process`. That is the point of the module existing: the
 * six situations the summary has to get right used to be reachable only
 * through a full install, and the ones involving a failed write were reachable
 * only by making a directory unwritable.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { summarize } from "../src/outcome.mjs";

const CLAUDE = { id: "claude-code", label: "Claude Code" };
const CODEX = { id: "codex", label: "Codex" };

/** A kit copy plan item, named by its path and its fate. */
function file(relativePath, status) {
  return { relativePath, status, source: `/kit/${relativePath}`, destination: `/target/${relativePath}` };
}

/** An adapter plan item for one harness. */
function adapter(harness, relativePath, action) {
  return { harness, relativePath, action, name: relativePath, destination: `/target/${relativePath}` };
}

function copyResult({ written = 0, skipped = 0, overwritten = 0, errors = [] } = {}) {
  return { written, skipped, overwritten, errors };
}

function adapterResult({ generated = 0, replaced = 0, unchanged = 0, conflicts = [], orphans = [], errors = [] } = {}) {
  return { generated, replaced, unchanged, conflicts, orphans, errors };
}

/** No harness was chosen: the default, and what `generateAdapters` returns for it. */
const NO_ADAPTERS = { plan: [], result: adapterResult(), blocked: false };

function run({ plan = [], result = copyResult(), adapters = NO_ADAPTERS, harnesses = [], options = {} } = {}) {
  return summarize({ plan, result, adapters, harnesses, options });
}

describe("summarize — a dry run", () => {
  const plan = [file("AGENTS.md", "write"), file("context/ai-interaction.md", "write"), file("README.md", "skip")];

  it("counts what would be written from the plan, because nothing was", () => {
    const outcome = run({ plan, result: copyResult(), options: { dryRun: true } });

    assert.equal(outcome.written, 2);
  });

  it("still lists the files it would leave alone", () => {
    const outcome = run({ plan, options: { dryRun: true } });

    assert.deepEqual(outcome.skipped, ["README.md"]);
  });

  it("is not an already-installed run just because nothing was written", () => {
    const outcome = run({ plan, options: { dryRun: true } });

    assert.equal(outcome.alreadyInstalled, false);
  });
});

describe("summarize — a re-run that writes nothing", () => {
  const plan = [file("AGENTS.md", "skip"), file("README.md", "skip")];

  it("reports the kit as already installed", () => {
    const outcome = run({ plan, result: copyResult({ skipped: 2 }) });

    assert.equal(outcome.written, 0);
    assert.equal(outcome.alreadyInstalled, true);
  });

  it("keeps the skipped list in the plan's order", () => {
    const outcome = run({ plan, result: copyResult({ skipped: 2 }) });

    assert.deepEqual(outcome.skipped, ["AGENTS.md", "README.md"]);
  });

  it("has nothing wanting a human", () => {
    const outcome = run({ plan, result: copyResult({ skipped: 2 }) });

    assert.equal(outcome.attention, 0);
    assert.deepEqual(outcome.failures, []);
  });
});

describe("summarize — --force overwrites", () => {
  const plan = [file("AGENTS.md", "overwrite"), file("README.md", "write")];

  it("keeps overwritten separate from written", () => {
    const outcome = run({
      plan,
      result: copyResult({ written: 1, overwritten: 1 }),
      options: { force: true },
    });

    assert.equal(outcome.written, 1);
    assert.equal(outcome.overwritten, 1);
  });

  it("is not already installed, because it replaced something", () => {
    const outcome = run({ plan, result: copyResult({ written: 1, overwritten: 1 }) });

    assert.equal(outcome.alreadyInstalled, false);
    assert.deepEqual(outcome.skipped, []);
  });
});

describe("summarize — a partly failed copy", () => {
  const plan = [file("AGENTS.md", "write"), file("skills/role/SKILL.md", "write")];
  const result = copyResult({
    written: 1,
    errors: [{ relativePath: "skills/role/SKILL.md", message: "EACCES: permission denied" }],
  });

  it("reports what did get written alongside the failure", () => {
    const outcome = run({ plan, result });

    assert.equal(outcome.written, 1);
    assert.equal(outcome.failures.length, 1);
  });

  it("puts copy failures before adapter failures", () => {
    const adapters = {
      plan: [adapter(CLAUDE, ".claude/skills/role/SKILL.md", "write")],
      result: adapterResult({ errors: [{ relativePath: ".claude/skills/role/SKILL.md", message: "ENOSPC" }] }),
      blocked: false,
    };

    const outcome = run({ plan, result, adapters, harnesses: [CLAUDE] });

    assert.deepEqual(
      outcome.failures.map((failure) => failure.relativePath),
      ["skills/role/SKILL.md", ".claude/skills/role/SKILL.md"],
    );
  });

  it("is not already installed even though nothing was skipped", () => {
    const outcome = run({ plan, result });

    assert.equal(outcome.alreadyInstalled, false);
  });
});

describe("summarize — a blocked adapter phase", () => {
  // What `generateAdapters` returns when the copy failed: a harness was chosen,
  // and its adapters were never planned or attempted.
  const adapters = { plan: [], result: adapterResult(), blocked: true };
  const result = copyResult({ written: 1, errors: [{ relativePath: "skills/role/SKILL.md", message: "EACCES" }] });

  it("says so, and produces no rows to speak for the harness", () => {
    const outcome = run({ plan: [file("AGENTS.md", "write")], result, adapters, harnesses: [CLAUDE] });

    assert.equal(outcome.blocked, true);
    assert.deepEqual(outcome.harnessRows, []);
  });

  it("asks for no attention, because nothing was looked at", () => {
    const outcome = run({ plan: [], result, adapters, harnesses: [CLAUDE] });

    assert.equal(outcome.attention, 0);
    assert.equal(outcome.built, 0);
  });

  it("is a different answer from no harness having been chosen", () => {
    const chosen = run({ plan: [], result, adapters, harnesses: [CLAUDE] });
    const none = run({ plan: [], result, adapters: NO_ADAPTERS, harnesses: [] });

    assert.deepEqual(chosen.harnessRows, none.harnessRows);
    assert.notEqual(chosen.blocked, none.blocked);
  });

  it("distinguishes a harness that produced nothing with a row of zeroes", () => {
    const outcome = run({ harnesses: [CLAUDE], adapters: NO_ADAPTERS });

    assert.equal(outcome.blocked, false);
    assert.deepEqual(outcome.harnessRows, [
      {
        harness: CLAUDE,
        generated: 0,
        replaced: 0,
        unchanged: 0,
        conflicts: [],
        orphans: [],
        handlers: { generated: 0, replaced: 0, unchanged: 0, conflicts: [], orphans: [] },
      },
    ]);
  });
});

describe("summarize — a harness with a conflict and an orphan", () => {
  const adapters = {
    plan: [
      adapter(CLAUDE, ".claude/skills/role/SKILL.md", "write"),
      adapter(CLAUDE, ".claude/skills/handoff/SKILL.md", "conflict"),
      adapter(CLAUDE, ".claude/skills/retired/SKILL.md", "orphan"),
      adapter(CLAUDE, ".claude/skills/whereami/SKILL.md", "up-to-date"),
    ],
    result: adapterResult({ generated: 1, unchanged: 1, conflicts: [".claude/skills/handoff/SKILL.md"], orphans: [".claude/skills/retired/SKILL.md"] }),
    blocked: false,
  };

  it("tallies the row by action", () => {
    const [row] = run({ adapters, harnesses: [CLAUDE] }).harnessRows;

    assert.equal(row.generated, 1);
    assert.equal(row.replaced, 0);
    assert.equal(row.unchanged, 1);
  });

  it("names the conflicted and orphaned paths, in plan order", () => {
    const [row] = run({ adapters, harnesses: [CLAUDE] }).harnessRows;

    assert.deepEqual(row.conflicts, [".claude/skills/handoff/SKILL.md"]);
    assert.deepEqual(row.orphans, [".claude/skills/retired/SKILL.md"]);
  });

  it("counts both as wanting a human", () => {
    assert.equal(run({ adapters, harnesses: [CLAUDE] }).attention, 2);
  });

  it("keeps rows in the order the harnesses were given", () => {
    const two = {
      plan: [...adapters.plan, adapter(CODEX, ".agents/skills/role/SKILL.md", "write")],
      result: adapters.result,
      blocked: false,
    };

    const rows = run({ adapters: two, harnesses: [CODEX, CLAUDE] }).harnessRows;

    assert.deepEqual(rows.map((row) => row.harness.id), ["codex", "claude-code"]);
    assert.equal(rows[0].generated, 1);
  });
});

describe("summarize — built and the rows disagree when a write fails", () => {
  // Pinned deliberately. `built` is what the closing headline speaks for and
  // comes from the result; the rows exclude paths that errored, because an
  // adapter that could not be written was not generated. Summing the rows into
  // `built` would look like a tidy-up and would quietly under-report a run
  // whose failure is already on screen.
  const adapters = {
    plan: [
      adapter(CLAUDE, ".claude/skills/role/SKILL.md", "write"),
      adapter(CLAUDE, ".claude/skills/handoff/SKILL.md", "write"),
    ],
    result: adapterResult({
      generated: 2,
      errors: [{ relativePath: ".claude/skills/handoff/SKILL.md", message: "ENOSPC: no space left on device" }],
    }),
    blocked: false,
  };

  it("keeps built at generated + replaced", () => {
    assert.equal(run({ adapters, harnesses: [CLAUDE] }).built, 2);
  });

  it("leaves the errored path out of the row", () => {
    const [row] = run({ adapters, harnesses: [CLAUDE] }).harnessRows;

    assert.equal(row.generated, 1);
  });

  it("does not sum built from the rows", () => {
    const outcome = run({ adapters, harnesses: [CLAUDE] });
    const summed = outcome.harnessRows.reduce((total, row) => total + row.generated + row.replaced, 0);

    assert.notEqual(outcome.built, summed);
  });
});

describe("summarize — the shape it returns", () => {
  it("is frozen, rows and lists with it", () => {
    const outcome = run({
      plan: [file("README.md", "skip")],
      adapters: {
        plan: [adapter(CLAUDE, ".claude/skills/handoff/SKILL.md", "conflict")],
        result: adapterResult({ conflicts: [".claude/skills/handoff/SKILL.md"] }),
        blocked: false,
      },
      harnesses: [CLAUDE],
    });

    assert.equal(Object.isFrozen(outcome), true);
    assert.equal(Object.isFrozen(outcome.skipped), true);
    assert.equal(Object.isFrozen(outcome.failures), true);
    assert.equal(Object.isFrozen(outcome.harnessRows), true);
    assert.equal(Object.isFrozen(outcome.harnessRows[0]), true);
    assert.equal(Object.isFrozen(outcome.harnessRows[0].conflicts), true);
  });

  it("carries exactly these keys and no others", () => {
    const outcome = run({ plan: [file("README.md", "write")], result: copyResult({ written: 1 }) });

    assert.deepEqual(Object.keys(outcome).sort(), [
      "alreadyInstalled",
      "attention",
      "blocked",
      "built",
      "failures",
      "handlers",
      "harnessRows",
      "overwritten",
      "skipped",
      "written",
    ]);
  });
});
