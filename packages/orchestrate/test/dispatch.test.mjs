/**
 * Scheduling, dispatch, gates, and the tracker, from the outside.
 *
 * The plan is what `orchestrate start` shows before it asks for approval, so
 * its outcomes are the scheduler: A and B claimed, C held behind A; a worker
 * limit respected; a ticket that would share a file with another held back;
 * and a Feature with nothing to run handed to planning with no claim made.
 *
 * Gates and notes run against a stateful fake `gh`, so a label a gate adds is
 * the label the next board reads, and every note's idempotency is checked by
 * running the same write twice.
 */

import { strict as assert } from "node:assert";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { approvalScope, blockedNote, claimedNote, gateOpenedNote, marker } from "../../../skills/orchestrate/engine/comments.mjs";
import { updateStateText } from "../../../skills/orchestrate/engine/statefile.mjs";
import { appendUnderNotes } from "../../../skills/orchestrate/engine/tracker.mjs";
import {
  cleanUpTemporaryDirectories,
  issue,
  json,
  makeProject,
  orchestrate,
  runGit,
  setTicketStatus,
  statefulGh,
} from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

const NOW = "2026-09-17T12:00:00.000Z";
const TRACKER = "# Ticket Store\n\n<!-- pathfinder:ticket-store github-issues acme/widgets -->\n";

function abc(options = {}) {
  return makeProject({
    tickets: {
      "1.1": { title: "A" },
      "1.2": { title: "B", status: "Ready" },
      "1.3": { title: "C", blockers: ["1.1"] },
    },
    ...options,
  });
}

function planOf(root, args = []) {
  const result = orchestrate(["plan", "--json", ...args], { root });
  assert.equal(result.status, 0, result.stderr);
  return json(result);
}

function areaTicket(title, area, blockers = []) {
  return [
    `# ${title}`,
    "",
    "## Status",
    "",
    "Proposed",
    "",
    "## Blocked by",
    "",
    blockers.length === 0 ? "None" : blockers.map((key) => `- \`${key}\` — x`).join("\n"),
    "",
    "## Context",
    "",
    `- Relevant area: ${area.map((path) => `\`${path}\``).join(", ")}`,
    "",
  ].join("\n");
}

describe("the dispatch plan", () => {
  it("claims A and B, and holds C behind A, with a profile per dispatched ticket", () => {
    const plan = planOf(abc(), ["--workers", "2"]);

    assert.equal(plan.outcome, "dispatch");
    assert.deepEqual(plan.dispatch.map((entry) => entry.key), ["1.1", "1.2"]);
    for (const entry of plan.dispatch) {
      assert.equal(entry.profile.schema, "pathfinder.execution-profile/1");
      assert.deepEqual(
        [entry.profile.selection.role, entry.profile.selection.model, entry.profile.selection.effort],
        ["developer", "inherited", "inherited"],
      );
    }
    assert.deepEqual(plan.blocked, [{ key: "1.3", title: "C", reason: "blocked by 1.1", waiting: ["1.1"] }]);
    assert.deepEqual(plan.deferred, []);
    assert.match(plan.approval, /It does not authorize merging/);
  });

  it("respects the worker limit", () => {
    const plan = planOf(abc(), ["--workers", "1"]);
    assert.deepEqual(plan.dispatch.map((entry) => entry.key), ["1.1"]);
    assert.deepEqual(plan.deferred.map((entry) => [entry.key, entry.reason]), [["1.2", "worker limit 1 reached"]]);
  });

  it("counts only live, active claims against the limit, and lists the rest as stale", () => {
    const root = abc();
    orchestrate(["claim", "1.1", "--now", NOW], { root });

    const live = planOf(root, ["--workers", "1", "--live", "1.1"]);
    assert.deepEqual(live.dispatch, [], "the one worker slot is taken by the live claim");
    assert.equal(live.deferred[0].reason, "worker limit 1 reached");
    assert.deepEqual(live.stale, []);

    const inherited = planOf(root, ["--workers", "1"]);
    assert.deepEqual(inherited.dispatch.map((entry) => entry.key), ["1.2"], "a stale claim holds no slot");
    assert.deepEqual(inherited.stale.map((entry) => entry.key), ["1.1"], "and is listed, never re-dispatched");
  });

  it("never puts two tickets that name the same file in one round", () => {
    const root = makeProject({ tickets: {} });
    writeFileSync(join(root, "context", "tickets", "1.1-one.md"), areaTicket("One", ["src/app.mjs"]));
    writeFileSync(join(root, "context", "tickets", "1.2-two.md"), areaTicket("Two", ["src/app.mjs", "lib"]));
    writeFileSync(join(root, "context", "tickets", "1.3-three.md"), areaTicket("Three", ["docs"]));
    runGit(["add", "-A"], root);
    runGit(["commit", "--quiet", "-m", "tickets"], root);

    const plan = planOf(root, ["--workers", "3"]);

    assert.deepEqual(plan.dispatch.map((entry) => entry.key), ["1.1", "1.3"]);
    assert.equal(plan.deferred.length, 1);
    assert.equal(plan.deferred[0].key, "1.2");
    assert.match(plan.deferred[0].reason, /^serialize: names src\/app\.mjs, which 1\.1 also names$/);
  });

  it("makes C eligible once A completes", () => {
    const root = abc();
    orchestrate(["claim", "1.1"], { root });
    orchestrate(["claim", "1.2"], { root });
    assert.deepEqual(planOf(root, ["--live", "1.1,1.2"]).blocked.map((entry) => entry.key), ["1.3"]);

    setTicketStatus(root, "1.1", { title: "A", status: "Complete" });

    const plan = planOf(root, ["--live", "1.2"]);
    assert.deepEqual(plan.dispatch.map((entry) => entry.key), ["1.3"]);
    assert.deepEqual(plan.blocked, []);
  });

  it("hands a Feature with no tickets to to-tickets, and an empty store to planning, claiming nothing", () => {
    const root = abc();
    const feature = planOf(root, ["--feature", "7"]);
    assert.equal(feature.outcome, "plan-tickets");
    assert.match(feature.message, /Feature 7 has no tickets in the store\. Nothing can be dispatched\. Offer to-tickets on Feature 7 under the planner role, and stop at its approval gate\./);
    assert.deepEqual(feature.dispatch, []);

    const empty = planOf(makeProject({ tickets: {} }));
    assert.equal(empty.outcome, "plan-features");
    assert.match(empty.message, /offer to-tickets on it; otherwise offer to-specs, or kickstart-pathfinder/);

    assert.equal(runGit(["branch", "--list", "ticket/*"], root), "", "no claim was made");
  });

  it("says nothing is eligible when everything is blocked or claimed", () => {
    const root = abc();
    orchestrate(["claim", "1.1"], { root });
    orchestrate(["claim", "1.2"], { root });
    const plan = planOf(root, ["--live", "1.1,1.2"]);
    assert.equal(plan.outcome, "nothing-eligible");
    assert.deepEqual(plan.blocked.map((entry) => entry.key), ["1.3"]);
  });

  it("prints a plan a person reads, with the approval scope, and refuses outside orchestrator mode", () => {
    const text = orchestrate(["plan", "--workers", "2"], { root: abc() }).stdout;
    assert.match(text, /^Dispatch plan — the whole board — up to 2 workers\n\n2 tickets can be claimed now\.\n\nClaim now:\n {2}1\.1 {2}A \(context\/tickets\/1\.1-1-1\.md\)\n {8}complexity low, context small, parallel isolated, risk /);
    assert.match(text, /Not eligible:\n {2}1\.3 {2}blocked by 1\.1/);
    assert.match(text, /Approving this orchestration run \(the whole board, at most 2 workers\) authorizes:/);

    const human = orchestrate(["plan"], { root: abc({ mode: "human-in-the-loop" }) });
    assert.equal(human.status, 1);
    assert.match(human.stderr, /refusing to plan: this project runs human-in-the-loop/);
    assert.equal(orchestrate(["plan", "--workers", "0"], { root: abc() }).status, 2);
  });
});

describe("tracker notes and gates on GitHub Issues", () => {
  function githubProject() {
    const gh = statefulGh([
      issue({ number: 11, key: "1.1", title: "A", labels: ["feature: 1", "status: proposed"] }),
      issue({ number: 12, key: "1.2", title: "B", labels: ["feature: 1", "status: ready"] }),
      issue({ number: 13, key: "1.3", title: "C", labels: ["feature: 1", "status: proposed"], blockers: ["1.1"] }),
    ]);
    return { root: makeProject({ tracker: TRACKER }), gh };
  }
  const labels = (gh, number) => gh.read().find((entry) => entry.number === number).labels.map((label) => label.name);
  const comments = (gh, number) => gh.read().find((entry) => entry.number === number).comments.map((comment) => comment.body);
  const statusLabels = (gh, number) => labels(gh, number).filter((name) => name.startsWith("status: "));

  it("announces a claim once, with the persisted profile, however often it is asked", () => {
    const { root, gh } = githubProject();
    const claimed = orchestrate(["claim", "1.1", "--now", NOW, "--announce", "--gh", gh.path], { root });
    assert.equal(claimed.status, 0, claimed.stderr);
    assert.equal(orchestrate(["announce", "1.1", "--now", NOW, "--gh", gh.path], { root }).status, 0);

    const notes = comments(gh, 11);
    assert.equal(notes.length, 1, "idempotent by its marker");
    assert.equal(notes[0].split("\n")[0], marker("claimed", "1.1", "ticket/1.1-a"));
    assert.match(notes[0], /\*\*Claimed\*\* by orchestrator worker `1\.1` on 2026-09-17\./);
    assert.match(notes[0], /\| `ticket\/1\.1-a` \| `\.pathfinder\/worktrees\/1\.1` \|/);
    assert.match(notes[0], /Selection by the `static` policy: role `developer`, model `inherited`, effort `inherited`\./);
    assert.deepEqual(statusLabels(gh, 11), ["status: proposed"], "announcing writes no status");
  });

  it("opens a gate with the label, the question, and the worker's state, and resolves it", () => {
    const { root, gh } = githubProject();
    orchestrate(["claim", "1.1", "--now", NOW, "--gh", gh.path], { root });
    const stateFile = join(root, ".pathfinder", "worktrees", "1.1", "context", "current-ticket.md");

    const opened = orchestrate(["gate", "1.1", "open", "--question", "Which schema version ships?", "--now", NOW, "--gh", gh.path], { root });
    assert.equal(opened.status, 0, opened.stderr);
    assert.ok(labels(gh, 11).includes("gate: human"));
    assert.deepEqual(statusLabels(gh, 11), ["status: proposed"], "exactly one status label, unchanged");
    assert.match(comments(gh, 11).at(-1), /\*\*Human gate opened\*\* on 2026-09-17\. Worker `1\.1` has stopped and is waiting for this decision:\n\n> Which schema version ships\?/);
    assert.match(readFileSync(stateFile, "utf8"), /^- State: human-gate$/m);
    assert.match(readFileSync(stateFile, "utf8"), /^- Gate: Which schema version ships\?$/m);

    const row = json(orchestrate(["status", "--json", "--live", "1.1", "--gh", gh.path], { root })).rows.find((entry) => entry.key === "1.1");
    assert.equal(row.state, "human-gate");
    assert.equal(row.gate, "Which schema version ships?");

    orchestrate(["gate", "1.1", "open", "--question", "Which schema version ships?", "--now", NOW, "--gh", gh.path], { root });
    assert.equal(comments(gh, 11).length, 1, "reopening the same gate posts no second note");

    const resolved = orchestrate(["gate", "1.1", "resolve", "--answer", "Version 2.", "--now", NOW, "--gh", gh.path], { root });
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.equal(labels(gh, 11).includes("gate: human"), false);
    assert.deepEqual(statusLabels(gh, 11), ["status: proposed"]);
    assert.match(comments(gh, 11).at(-1), /\*\*Human gate resolved\*\* on 2026-09-17\. Worker `1\.1` resumes\.\n\nDecision:\n\n> Version 2\./);
    const state = readFileSync(stateFile, "utf8");
    assert.match(state, /^- State: working$/m);
    assert.doesNotMatch(state, /^- Gate:/m);
    assert.match(state, /^- Last: gate resolved: Version 2\.$/m);
    assert.match(state, /^## Execution$/m, "the recorded profile survives");
  });

  it("keeps an unrelated worker untouched while another is gated", () => {
    const { root, gh } = githubProject();
    orchestrate(["claim", "1.1", "--now", NOW, "--gh", gh.path], { root });
    orchestrate(["claim", "1.2", "--now", NOW, "--gh", gh.path], { root });
    const other = join(root, ".pathfinder", "worktrees", "1.2", "context", "current-ticket.md");
    const before = readFileSync(other, "utf8");

    orchestrate(["gate", "1.1", "open", "--question", "Q?", "--now", NOW, "--gh", gh.path], { root });

    assert.equal(readFileSync(other, "utf8"), before);
    assert.equal(labels(gh, 12).includes("gate: human"), false);
    const rows = json(orchestrate(["status", "--json", "--live", "1.1,1.2", "--gh", gh.path], { root })).rows;
    assert.deepEqual(rows.filter((r) => r.key !== "1.3").map((r) => [r.key, r.state]), [["1.1", "human-gate"], ["1.2", "working"]]);
  });

  it("posts why a ticket waits, and that a completion unblocked it, each once", () => {
    const { root, gh } = githubProject();
    for (let i = 0; i < 2; i += 1) {
      assert.equal(orchestrate(["board", "--comment-blocked", "1.3", "--gh", gh.path], { root }).status, 0);
    }
    assert.equal(comments(gh, 13).length, 1);
    assert.match(comments(gh, 13)[0], /\*\*Not dispatched:\*\* 1\.3 is blocked by `1\.1`\. It becomes eligible when each is Complete\./);

    const early = orchestrate(["board", "--comment-unblocked", "1.3", "--by", "1.1", "--gh", gh.path], { root });
    assert.equal(early.status, 1, "not eligible yet");

    const state = gh.read();
    const a = state.find((entry) => entry.number === 11);
    a.state = "CLOSED";
    a.labels = a.labels.filter((label) => !label.name.startsWith("status: "));
    writeFileSync(join(gh.path, "..", "issues.json"), JSON.stringify(state));

    for (let i = 0; i < 2; i += 1) {
      assert.equal(orchestrate(["board", "--comment-unblocked", "1.3", "--by", "1.1", "--gh", gh.path], { root }).status, 0);
    }
    assert.equal(comments(gh, 13).length, 2);
    assert.match(comments(gh, 13)[1], /\*\*Now eligible:\*\* 1\.1 is Complete, which was the last blocker of 1\.3\./);

    assert.equal(orchestrate(["board", "--comment-unblocked", "1.3", "--by", "1.2", "--gh", gh.path], { root }).status, 1, "1.2 is not a blocker of 1.3");
  });
});

describe("notes on a local Markdown store", () => {
  it("appends under Notes / Decisions in the claim's worktree, once, and never dirties the main checkout", () => {
    const root = abc();
    orchestrate(["claim", "1.1", "--now", NOW, "--announce"], { root });
    orchestrate(["announce", "1.1", "--now", NOW], { root });
    orchestrate(["gate", "1.1", "open", "--question", "Q?", "--now", NOW], { root });

    const ticket = readFileSync(join(root, ".pathfinder", "worktrees", "1.1", "context", "tickets", "1.1-1-1.md"), "utf8");
    assert.equal(ticket.split(marker("claimed", "1.1", "ticket/1.1-a")).length - 1, 1);
    assert.match(ticket, /## Notes \/ Decisions\n\n<!-- pathfinder:orchestrate claimed 1\.1 ticket\/1\.1-a -->/);
    assert.match(ticket, /\*\*Human gate opened\*\*/);
    assert.match(ticket, /^## Status\n\nProposed$/m, "status untouched");

    assert.equal(runGit(["status", "--porcelain"], root), "", "the main checkout stays clean");
    assert.doesNotMatch(readFileSync(join(root, "context", "tickets", "1.1-1-1.md"), "utf8"), /pathfinder:orchestrate/);
  });

  it("writes no note for an unclaimed local ticket, and says so", () => {
    const root = abc();
    const result = orchestrate(["board", "--comment-blocked", "1.3"], { root });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /wrote no blocked note for 1\.3/);
    assert.equal(runGit(["status", "--porcelain"], root), "");
  });
});

describe("repairs from the 53.3 review", () => {
  it("names the main checkout in every brief, and tells workers to read untracked context from it", () => {
    const root = abc();
    orchestrate(["claim", "1.1", "--now", NOW], { root });
    for (const session of ["implementation", "resume", "review"]) {
      const text = orchestrate(["brief", "1.1", "--harness", "manual", "--session", session], { root }).stdout;
      assert.match(text, /^Main: {6}\/.+$/m, session);
      assert.equal(/^Main: {6}(.+)$/m.exec(text)[1].endsWith(/^Worktree: {2}(.+)$/m.exec(text)[1].replace(/\/\.pathfinder\/worktrees\/1\.1$/, "")), true, session);
      assert.match(text, /Read context\/tracker\.md and the Feature spec from the main checkout named above whenever the worktree has no copy/, session);
    }
    const owner = json(orchestrate(["owner", "1.1", "--json"], { root }));
    assert.equal(typeof owner.root, "string");
  });

  it("opens a gate only on a claimed worker that is working or in review", () => {
    const root = abc();
    const unclaimed = orchestrate(["gate", "1.3", "open", "--question", "Q?"], { root });
    assert.equal(unclaimed.status, 1);
    assert.match(unclaimed.stderr, /1\.3 has no registered claim/);

    orchestrate(["claim", "1.1", "--now", NOW], { root });
    orchestrate(["state", "1.1", "--set", "done", "--now", NOW], { root });
    const done = orchestrate(["gate", "1.1", "open", "--question", "Q?"], { root });
    assert.equal(done.status, 1);
    assert.match(done.stderr, /1\.1 is done; a gate stops a worker that is working or in review/);

    orchestrate(["claim", "1.2", "--now", NOW], { root });
    assert.equal(orchestrate(["gate", "1.2", "open", "--question", "First?"], { root }).status, 0);
    const second = orchestrate(["gate", "1.2", "open", "--question", "Different?"], { root });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /already at a human gate: First\?/);
  });

  it("resolves only an open gate, so resolving twice posts one note and never reopens finished work", () => {
    const gh = statefulGh([issue({ number: 11, key: "1.1", title: "A", labels: ["status: proposed"] })]);
    const root = makeProject({ tracker: TRACKER });
    orchestrate(["claim", "1.1", "--now", NOW, "--gh", gh.path], { root });
    orchestrate(["gate", "1.1", "open", "--question", "Ship v2?", "--now", NOW, "--gh", gh.path], { root });

    assert.equal(orchestrate(["gate", "1.1", "resolve", "--answer", "Yes.", "--now", NOW, "--gh", gh.path], { root }).status, 0);
    const again = orchestrate(["gate", "1.1", "resolve", "--answer", "Yes.", "--now", NOW, "--gh", gh.path], { root });
    assert.equal(again.status, 1);
    assert.match(again.stderr, /no open human gate to resolve \(state: working\)/);
    const notes = gh.read()[0].comments.map((comment) => comment.body.split("\n")[0]);
    assert.equal(notes.length, 2);
    assert.equal(notes[0].replace("gate-opened", "gate-resolved"), notes[1], "both markers digest the recorded question");

    orchestrate(["state", "1.1", "--set", "done", "--now", NOW, "--gh", gh.path], { root });
    const finished = orchestrate(["gate", "1.1", "resolve", "--gh", gh.path], { root });
    assert.equal(finished.status, 1);
    assert.equal(json(orchestrate(["status", "--json", "--gh", gh.path], { root })).rows[0].state, "done", "a finished worker stays done");
  });

  it("treats a question differing only in whitespace as the same gate", () => {
    const gh = statefulGh([issue({ number: 11, key: "1.1", title: "A", labels: ["status: proposed"] })]);
    const root = makeProject({ tracker: TRACKER });
    orchestrate(["claim", "1.1", "--now", NOW, "--gh", gh.path], { root });
    orchestrate(["gate", "1.1", "open", "--question", "Ship v2?", "--now", NOW, "--gh", gh.path], { root });
    assert.equal(orchestrate(["gate", "1.1", "open", "--question", "Ship v2?  ", "--now", NOW, "--gh", gh.path], { root }).status, 0);
    assert.equal(gh.read()[0].comments.length, 1);
  });

  it("shows a gated worker as human-gate without a live session, holding no slot and never stale", () => {
    const root = abc();
    orchestrate(["claim", "1.1", "--now", NOW], { root });
    orchestrate(["gate", "1.1", "open", "--question", "Q?", "--now", NOW], { root });

    const row = json(orchestrate(["status", "--json"], { root })).rows.find((entry) => entry.key === "1.1");
    assert.equal(row.state, "human-gate", "no --live, and still human-gate");
    assert.equal(row.gate, "Q?");

    const plan = planOf(root, ["--workers", "1"]);
    assert.deepEqual(plan.stale, [], "a gated worker is not stale");
    assert.deepEqual(plan.dispatch.map((entry) => entry.key), ["1.2"], "and holds no worker slot");
  });

  it("refuses --gate on any state but human-gate", () => {
    const root = abc();
    orchestrate(["claim", "1.1", "--now", NOW], { root });
    const result = orchestrate(["state", "1.1", "--set", "working", "--gate", "stray"], { root });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--gate is only for --set human-gate/);
  });

  it("keeps a claim whose announcement failed, exiting 0 and saying how to retry", () => {
    const gh = statefulGh([issue({ number: 11, key: "1.1", title: "A", labels: ["status: proposed"] })]);
    const root = makeProject({ tracker: TRACKER });
    // An issue list that works and a comment call that fails: remove the issue
    // from the fake's state after listing by pointing view at a missing number.
    const broken = join(gh.path, "..", "gh-broken");
    writeFileSync(broken, readFileSync(gh.path, "utf8").replace("if (args[1] === 'view')", "if (args[1] === 'view') { process.stderr.write('rate limited'); process.exit(1); } if (false)"));
    chmodSync(broken, 0o755);

    const result = orchestrate(["claim", "1.1", "--announce", "--json", "--gh", broken], { root });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).announced, false);
    assert.match(result.stderr, /the ownership note failed: .*rate limited.*Retry with: orchestrate announce 1\.1/);
    assert.equal(json(orchestrate(["owner", "1.1", "--json"], { root })).claim.orphan, false, "the claim stands");
  });

  it("keeps CRLF line endings, and never treats a heading inside a fence as the next section", () => {
    const crlf = "# T\r\n\r\n## Notes / Decisions\r\n\r\n- earlier\r\n";
    assert.equal(appendUnderNotes(crlf, "<!-- m -->\nnew"), "# T\r\n\r\n## Notes / Decisions\r\n\r\n- earlier\r\n\r\n<!-- m -->\r\nnew\r\n");

    const fenced = "# T\n\n## Notes / Decisions\n\n```md\n## Not a heading\n```\n\n## Appendix\n\nx\n";
    assert.equal(
      appendUnderNotes(fenced, "<!-- m -->"),
      "# T\n\n## Notes / Decisions\n\n```md\n## Not a heading\n```\n\n<!-- m -->\n\n## Appendix\n\nx\n",
    );

    assert.equal(updateStateText("- State: working\r\n- Next: x\r\n", { set: { State: "review" } }), "- State: review\r\n- Next: x\r\n");
  });
});

describe("the state command", () => {
  it("sets a worker's state, requires a question for a gate, and refuses values it must not write", () => {
    const root = abc();
    orchestrate(["claim", "1.1", "--now", NOW], { root });
    const path = join(root, ".pathfinder", "worktrees", "1.1", "context", "current-ticket.md");

    assert.equal(orchestrate(["state", "1.1", "--set", "review", "--last", "developer reported DONE: PR #7", "--now", NOW], { root }).status, 0);
    assert.match(readFileSync(path, "utf8"), /^- State: review$/m);
    assert.match(readFileSync(path, "utf8"), /^- Last: developer reported DONE: PR #7$/m);
    assert.equal(json(orchestrate(["status", "--json", "--live", "1.1"], { root })).rows[0].state, "review");

    assert.equal(orchestrate(["state", "1.1", "--set", "human-gate"], { root }).status, 2);
    assert.equal(orchestrate(["state", "1.1", "--set", "confused"], { root }).status, 2);
    assert.equal(orchestrate(["state", "1.9", "--set", "done"], { root }).status, 1);

    assert.equal(orchestrate(["state", "1.1", "--set", "done", "--now", NOW], { root }).status, 0);
    assert.equal(json(orchestrate(["status", "--json"], { root })).rows[0].state, "done", "done needs no live session");
  });

  it("changes only the named lines", () => {
    const text = "# Current Ticket\n\n- Ticket: 1.1 — A\n- State: working\n- Next: x\n\n## Execution\n\n```yaml\nk: v\n```\n";
    const updated = updateStateText(text, { set: { State: "review", Gate: "Q?" }, unset: [] });
    assert.equal(updated, "# Current Ticket\n\n- Ticket: 1.1 — A\n- State: review\n- Gate: Q?\n- Next: x\n\n## Execution\n\n```yaml\nk: v\n```\n");
    assert.equal(updateStateText(updated, { unset: ["Gate"] }), text.replace("State: working", "State: review"));
  });
});

describe("briefs for dispatch", () => {
  it("prints two implementation briefs naming different absolute worktrees, and a resume brief", () => {
    const root = abc();
    orchestrate(["claim", "1.1", "--now", NOW], { root });
    orchestrate(["claim", "1.2", "--now", NOW], { root });

    const a = orchestrate(["brief", "1.1", "--harness", "claude-code"], { root }).stdout;
    const b = orchestrate(["brief", "1.2", "--harness", "claude-code"], { root }).stdout;
    for (const [text, key] of [[a, "1.1"], [b, "1.2"]]) {
      assert.match(text, /^Role: {6}developer$/m);
      assert.match(text, /^Model: {5}inherited$/m);
      assert.match(text, /^Effort: {4}inherited$/m);
      assert.match(text, new RegExp(`^Worktree: {2}/.*/\\.pathfinder/worktrees/${key.replace(".", "\\.")}$`, "m"));
      assert.match(text, /open a draft pull request against the default branch whose body says the ticket context\/tickets\//);
      assert.match(text, /Never merge/);
    }
    assert.notEqual(/^Worktree: .*$/m.exec(a)[0], /^Worktree: .*$/m.exec(b)[0]);

    const resume = orchestrate(["brief", "1.1", "--harness", "manual", "--session", "resume"], { root }).stdout;
    assert.match(resume, /Read context\/current-ticket\.md first\. Continue from its Next line/);
    assert.match(resume, /^Role: {6}developer$/m, "resume runs as the implementation role");
  });

  it("says Closes #N for a GitHub ticket", () => {
    const gh = statefulGh([issue({ number: 41, key: "1.1", title: "A", labels: ["status: proposed"] })]);
    const root = makeProject({ tracker: TRACKER });
    orchestrate(["claim", "1.1", "--gh", gh.path], { root });
    assert.match(orchestrate(["brief", "1.1", "--harness", "manual", "--gh", gh.path], { root }).stdout, /whose body says Closes #41\./);
  });
});

describe("note wording", () => {
  it("is one spelling, with a marker first", () => {
    const profile = {
      schema: "pathfinder.execution-profile/1",
      estimate: {
        complexity: { value: "low" },
        context: { value: "small" },
        "parallel-safety": { value: "isolated" },
        risk: { value: "low", source: "derived" },
      },
      selection: { policy: "static", role: "developer", model: "inherited", effort: "inherited" },
    };
    const note = claimedNote({ key: "1.1", worker: "1.1", branch: "ticket/1.1-a", worktree: ".pathfinder/worktrees/1.1", now: NOW, profile });
    assert.equal(note.body.split("\n")[0], note.marker);
    assert.equal(gateOpenedNote({ key: "1.1", question: "Q", now: NOW }).marker, gateOpenedNote({ key: "1.1", question: "Q", now: "2030-01-01" }).marker, "a gate's marker does not depend on the day");
    assert.notEqual(gateOpenedNote({ key: "1.1", question: "Q", now: NOW }).marker, gateOpenedNote({ key: "1.1", question: "R", now: NOW }).marker);
    assert.match(blockedNote({ key: "1.3", waiting: [], reason: "blocker 1.1 is Cancelled — a planning question" }).body, /\*\*Not dispatched:\*\* blocker 1\.1 is Cancelled/);
    assert.match(approvalScope({ scope: "Feature 53", keys: ["53.4", "53.6"], workers: 2 }), /now: 53\.4, 53\.6/);
  });

  it("appends under an existing Notes section, before any later section", () => {
    const text = "# T\n\n## Notes / Decisions\n\n- earlier\n\n## Appendix\n\nx\n";
    assert.equal(appendUnderNotes(text, "<!-- m -->\nnew"), "# T\n\n## Notes / Decisions\n\n- earlier\n\n<!-- m -->\nnew\n\n## Appendix\n\nx\n");
  });
});
