/**
 * The operator's view.
 *
 * Three properties: the closed state vocabulary is what the rows say, the same
 * inputs give the same bytes, and a claim nobody declared live is stale — the
 * property that turns a crashed worker into something resumable rather than
 * something a second worker silently redoes.
 */

import { strict as assert } from "node:assert";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { STATES } from "../../../skills/orchestrate/engine/status.mjs";
import {
  cleanUpTemporaryDirectories,
  json,
  makeProject,
  orchestrate,
  runGit,
  setTicketStatus,
} from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

const NOW = "2026-09-17T12:00:00.000Z";

function project() {
  return makeProject({
    tickets: {
      "1.1": { title: "Alpha" },
      "1.2": { title: "Beta", status: "Ready" },
      "1.3": { title: "Gamma", blockers: ["1.1"] },
      "1.4": { title: "Delta", status: "Complete" },
      "1.5": { title: "Epsilon", blockers: ["1.4"] },
    },
  });
}

function rowsOf(root, args = []) {
  const result = orchestrate(["status", "--json", ...args], { root });
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(json(result).rows.map((row) => [row.key, row]));
}

function setState(root, key, state, extra = "") {
  const path = join(root, ".pathfinder", "worktrees", key, "context", "current-ticket.md");
  let text = readFileSync(path, "utf8").replace(/^- State: .*$/m, `- State: ${state}`);
  if (extra) text += extra;
  writeFileSync(path, text);
}

describe("the state vocabulary", () => {
  it("shows ready, blocked, and integrated before anything is claimed", () => {
    const rows = rowsOf(project());
    assert.equal(rows["1.1"].state, "ready");
    assert.equal(rows["1.2"].state, "ready");
    assert.equal(rows["1.3"].state, "blocked");
    assert.equal(rows["1.3"].gate, "blocked by 1.1");
    assert.equal(rows["1.4"].state, "integrated");
    assert.equal(rows["1.5"].state, "ready", "a blocker that is Complete does not block");
  });

  it("shows a live claim as working, with its branch, worktree, and worker", () => {
    const root = project();
    orchestrate(["claim", "1.1", "--now", NOW], { root });
    orchestrate(["claim", "1.2", "--now", NOW], { root });

    const rows = rowsOf(root, ["--live", "1.1,1.2"]);

    assert.equal(rows["1.1"].state, "working");
    assert.equal(rows["1.1"].worker, "1.1");
    assert.equal(rows["1.1"].where, "ticket/1.1-alpha @ .pathfinder/worktrees/1.1");
    assert.match(rows["1.1"].last, new RegExp(NOW.replaceAll(".", "\\.")));
    assert.equal(rows["1.2"].state, "working");
    assert.equal(rows["1.3"].state, "blocked", "C does not become ready while A is only claimed");
  });

  it("marks every claim this run did not declare live as stale", () => {
    const root = project();
    orchestrate(["claim", "1.1"], { root });
    orchestrate(["claim", "1.2"], { root });

    const rows = rowsOf(root, ["--live", "1.2"]);

    assert.equal(rows["1.1"].state, "stale", "the worker nobody declared live");
    assert.equal(rows["1.2"].state, "working");
  });

  it("keeps done and failed as they are whether or not a session is live", () => {
    const root = project();
    orchestrate(["claim", "1.1"], { root });
    orchestrate(["claim", "1.2"], { root });
    setState(root, "1.1", "done");
    setState(root, "1.2", "failed");

    const rows = rowsOf(root);

    assert.equal(rows["1.1"].state, "done");
    assert.equal(rows["1.2"].state, "failed");
  });

  it("shows a human gate with its question, and review as review", () => {
    const root = project();
    orchestrate(["claim", "1.1"], { root });
    orchestrate(["claim", "1.2"], { root });
    setState(root, "1.1", "human-gate", "- Gate: which schema version should ship?\n");
    setState(root, "1.2", "review");

    const rows = rowsOf(root, ["--live", "1.1,1.2"]);

    assert.equal(rows["1.1"].state, "human-gate");
    assert.equal(rows["1.1"].gate, "which schema version should ship?");
    assert.equal(rows["1.2"].state, "review");
  });

  it("shows a store ticket In Progress with no claim as working with no claim", () => {
    const root = project();
    setTicketStatus(root, "1.2", { title: "Beta", status: "In Progress" });

    const rows = rowsOf(root);

    assert.equal(rows["1.2"].state, "working");
    assert.equal(rows["1.2"].where, "no claim");
  });

  it("reports an orphan branch and a state file it does not understand as stale", () => {
    const root = project();
    runGit(["branch", "ticket/1.1-abandoned", "main"], root);
    orchestrate(["claim", "1.2"], { root });
    setState(root, "1.2", "confused");

    const rows = rowsOf(root, ["--live", "1.2"]);

    assert.equal(rows["1.1"].state, "stale");
    assert.equal(rows["1.1"].where, "ticket/1.1-abandoned (branch only)");
    assert.match(rows["1.1"].gate, /worktree missing/);
    assert.equal(rows["1.2"].state, "stale");
    assert.equal(rows["1.2"].gate, "state file says confused");
  });

  it("shows a claim whose state file is gone as claimed but not loaded", () => {
    const root = project();
    orchestrate(["claim", "1.1"], { root });
    rmSync(join(root, ".pathfinder", "worktrees", "1.1", "context", "current-ticket.md"));

    assert.equal(rowsOf(root)["1.1"].state, "stale");
    const live = rowsOf(root, ["--live", "1.1"])["1.1"];
    assert.equal(live.state, "working");
    assert.equal(live.last, "claimed, not yet loaded");
  });

  it("never emits a state outside the closed vocabulary", () => {
    const root = project();
    orchestrate(["claim", "1.1"], { root });
    orchestrate(["claim", "1.2"], { root });
    setState(root, "1.2", "done");
    runGit(["branch", "ticket/1.5-left-over", "main"], root);

    for (const row of Object.values(rowsOf(root, ["--live", "1.1"]))) {
      assert.ok(STATES.includes(row.state), `${row.key}: ${row.state}`);
    }
  });
});

describe("the table", () => {
  it("prints the same bytes for the same inputs, from any working directory", () => {
    const root = project();
    orchestrate(["claim", "1.1", "--now", NOW], { root });
    orchestrate(["claim", "1.2", "--now", NOW], { root });
    const inside = join(root, ".pathfinder", "worktrees", "1.2");

    const first = orchestrate(["status", "--live", "1.1"], { root });
    const second = orchestrate(["status", "--live", "1.1"], { root, env: { TZ: "Pacific/Kiritimati", LANG: "tr_TR.UTF-8" } });
    const fromWorker = orchestrate(["status", "--live", "1.1"], { root: undefined, cwd: inside });

    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, second.stdout);
    assert.equal(first.stdout, fromWorker.stdout, "a worker sees the same board as the orchestrator");
  });

  it("names the mode and store, then one aligned row per ticket", () => {
    const root = project();
    orchestrate(["claim", "1.1", "--now", NOW], { root });

    const lines = orchestrate(["status", "--live", "1.1"], { root }).stdout.split("\n");

    assert.equal(lines[0], "Pathfinder orchestration — mode: orchestrator — store: local Markdown (context/tickets/)");
    assert.equal(lines[1], "");
    assert.match(lines[2], /^WORKER +TICKET +LIFECYCLE +STATE +BRANCH \/ WORKTREE +GATE \/ BLOCKER +LAST$/);
    assert.match(lines[3], /^1\.1 +1\.1 +Proposed +working +ticket\/1\.1-alpha @ \.pathfinder\/worktrees\/1\.1 /);
    assert.match(lines[5], /^— +1\.3 +Proposed +blocked +— +blocked by 1\.1/);
    const stateColumn = lines[2].indexOf("STATE");
    for (const line of lines.slice(3, 8)) assert.notEqual(line[stateColumn - 1], undefined);
  });

  it("refuses outside orchestrator mode", () => {
    const root = makeProject({ mode: "human-in-the-loop", tickets: { "1.1": { title: "A" } } });
    const result = orchestrate(["status"], { root });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing to show orchestration status: this project runs human-in-the-loop/);
  });
});

describe("abandoned tickets", () => {
  it("have no row, so no state outside the vocabulary", () => {
    const root = makeProject({
      tickets: { "1.1": { title: "Dropped", status: "Cancelled" }, "1.2": { title: "Replaced", status: "Superseded" }, "1.3": { title: "Live" } },
    });
    const rows = rowsOf(root);
    assert.deepEqual(Object.keys(rows), ["1.3"]);
    for (const row of Object.values(rows)) assert.ok(STATES.includes(row.state));
  });

  it("show as stale when a claim still exists for one", () => {
    const root = makeProject({ tickets: { "1.1": { title: "Dropped" } } });
    orchestrate(["claim", "1.1"], { root });
    setTicketStatus(root, "1.1", { title: "Dropped", status: "Cancelled" });

    const row = rowsOf(root)["1.1"];
    assert.equal(row.state, "stale");
    assert.equal(row.gate, "ticket is Cancelled but still claimed; release it");
  });

  it("an unreadable status is blocked, with the problem named", () => {
    const root = makeProject({ tickets: { "1.1": { title: "Odd", status: "Done" } } });
    const row = rowsOf(root)["1.1"];
    assert.equal(row.state, "blocked");
    assert.match(row.gate, /unrecognised status `Done`/);
  });
});
