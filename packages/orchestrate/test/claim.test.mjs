/**
 * Claims: one worktree, one branch, one worker per ticket, and nothing else.
 *
 * Every test here runs the real engine against a real repository, because the
 * guarantee is Git's: a branch cannot be checked out in two worktrees. What
 * the engine adds is refusing earlier, refusing legibly, and never letting a
 * blocked, unknown, or already-owned ticket reach `git worktree add` at all.
 */

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

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

function threeTickets(options = {}) {
  return makeProject({
    tickets: {
      "1.1": { title: "Alpha work" },
      "1.2": { title: "Beta work", status: "Ready" },
      "1.3": { title: "Gamma work", blockers: ["1.1"] },
    },
    ...options,
  });
}

describe("claiming an eligible ticket", () => {
  it("creates the worktree and branch from main, and seeds the worker's state file", () => {
    const root = threeTickets();

    const result = orchestrate(["claim", "1.1", "--now", NOW, "--json"], { root });

    assert.equal(result.status, 0, result.stderr);
    const claim = json(result);
    assert.equal(claim.worktree, ".pathfinder/worktrees/1.1");
    assert.equal(claim.branch, "ticket/1.1-alpha-work");
    assert.equal(claim.base, "main");

    const worktree = join(root, ".pathfinder", "worktrees", "1.1");
    assert.ok(existsSync(join(worktree, "README.md")), "the worktree is a checkout");
    assert.equal(runGit(["rev-parse", "--abbrev-ref", "HEAD"], worktree).trim(), "ticket/1.1-alpha-work");
    assert.equal(
      runGit(["rev-parse", "ticket/1.1-alpha-work"], root).trim(),
      runGit(["rev-parse", "main"], root).trim(),
      "the branch starts at main",
    );

    const state = readFileSync(join(worktree, "context", "current-ticket.md"), "utf8");
    assert.match(state, /^- Ticket: 1\.1 — Alpha work$/m);
    assert.match(state, /^- Worker: 1\.1$/m);
    assert.match(state, /^- Worktree: \.pathfinder\/worktrees\/1\.1$/m);
    assert.match(state, /^- Branch: ticket\/1\.1-alpha-work$/m);
    assert.match(state, /^- State: working$/m);
    assert.match(state, new RegExp(`^- Updated: ${NOW.replaceAll(".", "\\.")}$`, "m"));
    assert.doesNotMatch(state, /^## Status/m, "the state file records no lifecycle status");
  });

  it("honours an explicit slug", () => {
    const root = threeTickets();
    const claim = json(orchestrate(["claim", "1.2", "--slug", "beta", "--json"], { root }));
    assert.equal(claim.branch, "ticket/1.2-beta");
  });

  it("leaves the main checkout's status clean", () => {
    const root = threeTickets();
    orchestrate(["claim", "1.1"], { root });
    orchestrate(["claim", "1.2"], { root });
    assert.equal(runGit(["status", "--porcelain"], root), "");
  });

  it("keeps two workers' state files apart", () => {
    const root = threeTickets();
    orchestrate(["claim", "1.1"], { root });
    orchestrate(["claim", "1.2"], { root });

    const a = join(root, ".pathfinder", "worktrees", "1.1", "context", "current-ticket.md");
    const b = join(root, ".pathfinder", "worktrees", "1.2", "context", "current-ticket.md");
    writeFileSync(a, readFileSync(a, "utf8").replace("- State: working", "- State: human-gate"));

    assert.match(readFileSync(b, "utf8"), /^- State: working$/m, "worker B's state did not move");
    assert.equal(existsSync(join(root, "context", "current-ticket.md")), false, "the main checkout has none");
  });
});

describe("refusing a claim", () => {
  it("refuses a second claim of the same ticket, naming the owner", () => {
    const root = threeTickets();
    assert.equal(orchestrate(["claim", "1.1"], { root }).status, 0);

    const second = orchestrate(["claim", "1.1"], { root });

    assert.equal(second.status, 1);
    assert.match(second.stderr, /refusing to claim 1\.1: it is claimed by worker 1\.1 at \.pathfinder\/worktrees\/1\.1 on ticket\/1\.1-alpha-work/);
  });

  it("still names the owner after the worker moved the ticket to In Progress", () => {
    const root = threeTickets();
    orchestrate(["claim", "1.1"], { root });
    setTicketStatus(root, "1.1", { title: "Alpha work", status: "In Progress" });

    const second = orchestrate(["claim", "1.1"], { root });

    assert.equal(second.status, 1);
    assert.match(second.stderr, /claimed by worker 1\.1/);
  });

  it("refuses a claim from inside another worker's worktree too", () => {
    const root = threeTickets();
    orchestrate(["claim", "1.1"], { root });
    const inside = join(root, ".pathfinder", "worktrees", "1.1");

    const second = orchestrate(["claim", "1.1"], { root: inside, cwd: inside });

    assert.equal(second.status, 1);
    assert.match(second.stderr, /claimed by worker 1\.1/);
  });

  it("refuses a branch left behind with no worktree, rather than duplicating its work", () => {
    const root = threeTickets();
    runGit(["branch", "ticket/1.1-earlier-attempt", "main"], root);

    const result = orchestrate(["claim", "1.1"], { root });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /branch ticket\/1\.1-earlier-attempt exists with no worktree/);
    assert.equal(existsSync(join(root, ".pathfinder", "worktrees", "1.1")), false);
  });

  it("refuses a blocked ticket, naming what it waits for", () => {
    const root = threeTickets();

    const result = orchestrate(["claim", "1.3"], { root });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing to claim 1\.3: blocked by 1\.1/);
    assert.equal(runGit(["branch", "--list", "ticket/*"], root), "");
  });

  it("refuses an unknown ticket", () => {
    const root = threeTickets();
    const result = orchestrate(["claim", "9.9"], { root });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no ticket 9\.9 in local Markdown/);
  });

  it("refuses a project in human-in-the-loop mode, and one with no mode file", () => {
    for (const mode of ["human-in-the-loop", null]) {
      const root = threeTickets({ mode });
      const result = orchestrate(["claim", "1.1"], { root });
      assert.equal(result.status, 1, String(mode));
      assert.match(result.stderr, /Orchestration runs only when context\/execution-mode\.md says/);
      assert.equal(existsSync(join(root, ".pathfinder")), false);
    }
  });

  it("refuses an invalid mode file, naming both values", () => {
    const root = threeTickets({ modeFile: "# Execution Mode\n\n<!-- pathfinder:execution-mode autopilot -->\n" });
    const result = orchestrate(["claim", "1.1"], { root });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /carries no valid marker/);
    assert.match(result.stderr, /human-in-the-loop and orchestrator/);
  });

  it("refuses when .pathfinder/ is not ignored, and says exactly what to add", () => {
    const root = threeTickets({ ignorePathfinder: false });

    const result = orchestrate(["claim", "1.1"], { root });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /`\.pathfinder\/` is not ignored/);
    assert.match(result.stderr, /\/\.pathfinder\//);
    assert.equal(existsSync(join(root, ".pathfinder")), false, "nothing was created");
  });

  it("claims the newly eligible ticket once its blocker is complete", () => {
    const root = threeTickets();
    assert.equal(orchestrate(["claim", "1.3"], { root }).status, 1);

    setTicketStatus(root, "1.1", { title: "Alpha work", status: "Complete" });

    assert.equal(orchestrate(["claim", "1.3"], { root }).status, 0);
  });
});

describe("owner", () => {
  it("reports an unclaimed ticket, a claim, and whether the caller is the owner", () => {
    const root = threeTickets();
    assert.equal(json(orchestrate(["owner", "1.1", "--json"], { root })).claim, null);

    orchestrate(["claim", "1.1"], { root });
    orchestrate(["claim", "1.2"], { root });
    const a = join(root, ".pathfinder", "worktrees", "1.1");
    const b = join(root, ".pathfinder", "worktrees", "1.2");

    const fromMain = json(orchestrate(["owner", "1.1", "--json"], { root }));
    assert.equal(fromMain.claim.worktree, ".pathfinder/worktrees/1.1");
    assert.equal(fromMain.here, false, "the main checkout does not own it");

    const fromOwner = json(orchestrate(["owner", "1.1", "--json"], { root: undefined, cwd: a }));
    assert.equal(fromOwner.here, true, "worker A's own checkout owns 1.1");

    const fromOther = json(orchestrate(["owner", "1.1", "--json"], { root: undefined, cwd: b }));
    assert.equal(fromOther.here, false, "worker B does not own 1.1");
    assert.equal(fromOther.claim.worktree, ".pathfinder/worktrees/1.1", "found from inside another worktree");
  });
});
