/**
 * Eligibility, from both stores.
 *
 * The rule under test is `skills/ticket/actions/load.md` §Readiness, restated
 * nowhere else: a ticket runs when its own status is Proposed or Ready and
 * every blocker is Complete. A Cancelled or Superseded blocker is a planning
 * question, a missing blocker blocks, and key order is never a dependency.
 */

import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";

import { computeBoard } from "../../../skills/orchestrate/engine/board.mjs";
import { blockersOf, statusFromGitHub } from "../../../skills/orchestrate/engine/store.mjs";
import { compareKeys, slugify } from "../../../skills/orchestrate/engine/keys.mjs";
import {
  cleanUpTemporaryDirectories,
  fakeGh,
  issue,
  json,
  makeProject,
  orchestrate,
} from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

const byKey = (rows) => Object.fromEntries(rows.map((row) => [row.key, row]));

function ticket(key, status, blockers = []) {
  return { key, title: `ticket ${key}`, status, blockers, ref: key, number: null };
}

describe("eligibility", () => {
  it("runs A and B, and holds C until A completes", () => {
    const rows = byKey(
      computeBoard([ticket("1.1", "Proposed"), ticket("1.2", "Ready"), ticket("1.3", "Proposed", ["1.1"])]),
    );

    assert.equal(rows["1.1"].eligible, true);
    assert.equal(rows["1.2"].eligible, true);
    assert.equal(rows["1.3"].eligible, false);
    assert.equal(rows["1.3"].reason, "blocked by 1.1");
    assert.deepEqual(rows["1.3"].waiting, ["1.1"]);

    const after = byKey(
      computeBoard([ticket("1.1", "Complete"), ticket("1.2", "Ready"), ticket("1.3", "Proposed", ["1.1"])]),
    );
    assert.equal(after["1.3"].eligible, true);
  });

  it("never offers work that is in progress or terminal", () => {
    const rows = byKey(
      computeBoard([
        ticket("1.1", "In Progress"),
        ticket("1.2", "Complete"),
        ticket("1.3", "Cancelled"),
        ticket("1.4", "Superseded"),
      ]),
    );
    for (const key of ["1.1", "1.2", "1.3", "1.4"]) assert.equal(rows[key].eligible, false, key);
    assert.equal(rows["1.1"].reason, "in progress");
    assert.equal(rows["1.2"].reason, "complete");
  });

  it("treats an edge into abandoned work as a planning question, not a wait", () => {
    const rows = byKey(computeBoard([ticket("1.1", "Cancelled"), ticket("1.2", "Proposed", ["1.1"])]));
    assert.equal(rows["1.2"].eligible, false);
    assert.match(rows["1.2"].reason, /blocker 1\.1 is Cancelled — a planning question/);
  });

  it("blocks on a blocker that does not exist", () => {
    const rows = byKey(computeBoard([ticket("1.2", "Proposed", ["1.9"])]));
    assert.equal(rows["1.2"].eligible, false);
    assert.match(rows["1.2"].reason, /blocker 1\.9 does not exist/);
  });

  it("waits on every unfinished blocker, not just the first", () => {
    const rows = byKey(
      computeBoard([ticket("1.1", "Ready"), ticket("1.2", "In Progress"), ticket("1.3", "Proposed", ["1.1", "1.2"])]),
    );
    assert.equal(rows["1.3"].reason, "blocked by 1.1, 1.2");
  });

  it("filters to one Feature and orders keys numerically", () => {
    const rows = computeBoard(
      [ticket("2.1", "Ready"), ticket("1.10", "Ready"), ticket("1.2", "Ready"), ticket("1.9", "Ready")],
      { feature: "1" },
    );
    assert.deepEqual(rows.map((row) => row.key), ["1.2", "1.9", "1.10"]);
    assert.ok(compareKeys("53.2", "53.10") < 0);
  });
});

describe("reading a ticket body", () => {
  it("takes the first backticked key of each list line under Blocked by, and nothing else", () => {
    const body = [
      "## Blocked by",
      "",
      "- `53.7` — the profile; through it `53.2` arrives too",
      "* `53.1` — the mode",
      "",
      "Prose mentioning `53.9` is not an edge.",
      "",
      "## Goal",
      "",
      "- `53.8` under another heading is not an edge",
    ].join("\n");
    assert.deepEqual(blockersOf(body), ["53.7", "53.1"]);
  });

  it("reads None as no edge, and a body with no section as no edge", () => {
    assert.deepEqual(blockersOf("## Blocked by\n\nNone\n\n## Goal\n"), []);
    assert.deepEqual(blockersOf("## Goal\n\nnothing\n"), []);
  });

  it("reads a Blocked by section that ends the body, and CRLF", () => {
    assert.deepEqual(blockersOf("## Blocked by\r\n\r\n- `1.1` — x\r\n"), ["1.1"]);
  });

  it("does not stop a section at a capital Z", () => {
    // JavaScript has no `\Z`; a pattern that used it matched a literal Z.
    assert.deepEqual(blockersOf("## Blocked by\n\n- `1.1` — Zebra\n- `1.2` — y\n"), ["1.1", "1.2"]);
  });

  it("maps GitHub's representation to Pathfinder's status as the tracker config defines it", () => {
    assert.equal(statusFromGitHub("OPEN", ["feature: 53", "status: proposed"]), "Proposed");
    assert.equal(statusFromGitHub("OPEN", ["status: ready"]), "Ready");
    assert.equal(statusFromGitHub("OPEN", ["status: in-progress", "gate: human"]), "In Progress");
    assert.equal(statusFromGitHub("OPEN", []), "Proposed");
    assert.equal(statusFromGitHub("CLOSED", ["feature: 53"]), "Complete");
    assert.equal(statusFromGitHub("CLOSED", ["status: cancelled"]), "Cancelled");
    assert.equal(statusFromGitHub("CLOSED", ["status: superseded"]), "Superseded");
  });

  it("slugs titles deterministically for branch names", () => {
    assert.equal(slugify("Worker isolation and claiming through Git worktrees"), "worker-isolation-and-claiming-through-gi");
    assert.equal(slugify("  !!  "), "ticket");
    assert.equal(slugify("Émoji ✨ and — dashes"), "moji-and-dashes");
  });
});

describe("the board command", () => {
  it("reads the local Markdown store when there is no tracker config", () => {
    const root = makeProject({
      tickets: {
        "1.1": { title: "First" },
        "1.2": { title: "Second", status: "Ready" },
        "1.3": { title: "Third", blockers: ["1.1"] },
      },
    });

    const result = json(orchestrate(["board", "--json"], { root }));

    assert.equal(result.store, "local Markdown (context/tickets/)");
    const rows = byKey(result.tickets);
    assert.equal(rows["1.1"].eligible, true);
    assert.equal(rows["1.2"].eligible, true);
    assert.equal(rows["1.3"].reason, "blocked by 1.1");
    assert.equal(rows["1.1"].title, "First");
  });

  it("reads GitHub Issues through gh, matching tickets by the body marker only", () => {
    const gh = fakeGh([
      issue({ number: 10, key: "7.1", title: "Done", state: "CLOSED", labels: ["feature: 7"] }),
      issue({ number: 11, key: "7.2", title: "Next", labels: ["status: proposed"], blockers: ["7.1"] }),
      issue({ number: 12, key: "7.3", title: "Later", labels: ["status: proposed"], blockers: ["7.2"] }),
      // An issue that merely names a key in its title is not a ticket.
      { number: 13, title: "7.4 — not a ticket", state: "OPEN", labels: [], body: "no marker here" },
    ]);
    const root = makeProject({
      tracker: "# Ticket Store\n\n<!-- pathfinder:ticket-store github-issues acme/widgets -->\n",
    });

    const result = json(orchestrate(["board", "--json", "--gh", gh.path], { root }));

    assert.equal(result.store, "GitHub Issues acme/widgets");
    assert.deepEqual(result.tickets.map((row) => row.key), ["7.1", "7.2", "7.3"]);
    const rows = byKey(result.tickets);
    assert.equal(rows["7.1"].status, "Complete");
    assert.equal(rows["7.2"].eligible, true);
    assert.equal(rows["7.2"].ref, "#11");
    assert.equal(rows["7.2"].title, "Next");
    assert.equal(rows["7.3"].reason, "blocked by 7.2");
  });

  it("refuses a tracker config with no store marker, naming the line to add", () => {
    const root = makeProject({ tracker: "# Ticket Store\n\nGitHub Issues, reached with gh.\n" });

    const result = orchestrate(["board"], { root });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /carries no machine-readable marker/);
    assert.match(result.stderr, /<!-- pathfinder:ticket-store github-issues owner\/repo -->/);
  });

  it("reports a failing gh rather than an empty board", () => {
    const gh = fakeGh([], { status: 4, stderr: "authentication required" });
    const root = makeProject({ tracker: "<!-- pathfinder:ticket-store github-issues acme/widgets -->\n" });

    const result = orchestrate(["board", "--gh", gh.path], { root });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /authentication required/);
  });

  it("exits 2 on a malformed command line", () => {
    const root = makeProject();
    assert.equal(orchestrate(["board", "--bogus"], { root }).status, 2);
    assert.equal(orchestrate(["claim"], { root }).status, 2);
    assert.equal(orchestrate(["claim", "not-a-key"], { root }).status, 2);
    assert.equal(orchestrate(["nonsense"], { root }).status, 2);
  });
});
