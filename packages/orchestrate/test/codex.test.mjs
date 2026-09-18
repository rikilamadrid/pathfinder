/** The native Codex adapter contract; scheduling and claims stay harness-neutral. */
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { HARNESS_TRANSLATIONS, PROTOCOLS, buildBrief, formatBrief, translateBrief } from "../../../skills/orchestrate/engine/brief.mjs";
import { cleanUpTemporaryDirectories, json, makeProject, orchestrate, runGit } from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

function brief(selection = {}, overrides = {}) {
  const built = buildBrief({
    ticket: "53.4",
    title: "Integration and recovery",
    ref: "#109",
    worktree: "/work/project with spaces/.pathfinder/worktrees/53.4",
    main: "/work/project with spaces",
    branch: "ticket/53.4-integration-and-recovery",
    approval: "Feature 53 execution; no merges",
    selection: { role: "developer", model: "inherited", effort: "inherited", ...selection },
    ...overrides,
  });
  assert.equal(built.ok, true, built.message);
  return built.brief;
}

describe("Codex harness translation", () => {
  it("recognizes Codex and emits native spawn arguments preserving inherited settings and the whole brief", () => {
    assert.ok(Object.hasOwn(HARNESS_TRANSLATIONS, "codex"));
    const input = brief();
    const before = structuredClone(input);
    const translated = translateBrief(input, "codex");
    assert.equal(translated.ok, true, translated.message);
    assert.equal(translated.invocation.tool, "collaboration.spawn_agent");
    const args = translated.invocation.arguments;
    assert.deepEqual(Object.keys(args).sort(), ["fork_turns", "message", "task_name"]);
    assert.equal(args.task_name, "pathfinder_53_4_implementation");
    assert.equal(args.fork_turns, "all", "full-history fork inherits model and effort without overrides");
    assert.ok(args.message.includes(JSON.stringify(input.worktree)));
    assert.match(args.message, /Set workdir to this absolute path on EVERY shell call/);
    assert.match(args.message, /read roles\/developer\.md/);
    assert.ok(args.message.endsWith(formatBrief(input)), "ticket, worktree, branch, approval and protocol survive intact");
    assert.deepEqual(input, before, "translation does not rewrite the brief");
  });

  it("emits deterministic valid, distinct names for every supported session", () => {
    const expected = {
      implementation: "implementation",
      resume: "resume",
      review: "review",
      "rebase-and-reverify": "rebase_and_reverify",
      "resolve-conflict": "resolve_conflict",
    };
    assert.deepEqual(Object.keys(expected).sort(), Object.keys(PROTOCOLS).sort());
    const names = new Set();
    for (const session of Object.keys(PROTOCOLS)) {
      const input = brief({}, { ticket: "53.6", session });
      const result = translateBrief(input, "codex");
      assert.equal(result.ok, true, result.message);
      const name = result.invocation.arguments.task_name;
      assert.match(name, /^[a-z0-9_]+$/);
      assert.equal(name, `pathfinder_53_6_${expected[session]}`);
      assert.deepEqual(translateBrief(input, "codex"), result);
      names.add(name);
      for (const harness of ["claude-code", "manual"]) {
        assert.deepEqual(translateBrief(input, harness), {
          ok: true, harness, invocation: { role: "developer", prompt: formatBrief(input) },
        });
      }
    }
    assert.equal(names.size, Object.keys(PROTOCOLS).length);
  });

  it("preserves the entire numeric key domain without truncation or collisions", () => {
    const tickets = ["53.6", "053.6", "53.06", "5.36", "53.60", `${"9".repeat(300)}.6`];
    const names = tickets.map((ticket) => {
      const result = translateBrief(brief({}, { ticket }), "codex");
      assert.equal(result.ok, true, result.message);
      const name = result.invocation.arguments.task_name;
      assert.equal(name, `pathfinder_${ticket.replace(".", "_")}_implementation`);
      assert.match(name, /^[a-z0-9_]+$/);
      return name;
    });
    assert.equal(new Set(names).size, tickets.length);
  });

  it("refuses identities outside the accepted domain rather than normalizing collisions", () => {
    for (const ticket of ["53_6", "53-6", "53.6.1", " 53.6", "53.6\n", "53.6\r", "５３.６", "ABC.6", "53/6", "", null]) {
      const result = translateBrief({ ...brief(), ticket }, "codex");
      assert.equal(result.ok, false, String(ticket));
      assert.match(result.message, /ticket key/);
      assert.equal(Object.hasOwn(result, "invocation"), false);
    }
    for (const session of ["rebase_and_reverify", "REBASE-AND-REVERIFY", "resolve_conflict", "resolve/conflict", "réview", "", null]) {
      const result = translateBrief({ ...brief(), session }, "codex");
      assert.equal(result.ok, false, String(session));
      assert.match(result.message, /supported session/);
      assert.equal(Object.hasOwn(result, "invocation"), false);
    }
  });

  it("passes supported explicit model and effort values exactly without a full-history fork", () => {
    for (const [model, efforts] of [
      ["gpt-6-astra", ["low", "medium", "high", "xhigh", "max", "ultra"]],
      ["gpt-5.6-sol", ["low", "medium", "high", "xhigh", "max", "ultra"]],
      ["gpt-5.6-terra", ["low", "medium", "high", "xhigh", "max", "ultra"]],
      ["gpt-5.6-luna", ["low", "medium", "high", "xhigh", "max"]],
      ["gpt-5.5", ["low", "medium", "high", "xhigh"]],
      ["gpt-5.2", ["low", "medium", "high", "xhigh"]],
    ]) {
      for (const effort of efforts) {
        const input = brief({ model, effort });
        const translated = translateBrief(input, "codex");
        assert.equal(translated.ok, true, translated.message);
        const args = translated.invocation.arguments;
        assert.deepEqual(Object.keys(args).sort(), ["fork_turns", "message", "model", "reasoning_effort", "task_name"]);
        assert.equal(args.model, model);
        assert.equal(args.reasoning_effort, effort);
        assert.equal(args.fork_turns, "none");
        assert.ok(args.message.endsWith(formatBrief(input)));
      }
    }
  });

  it("inherits a model with an explicit effort only from the common supported set", () => {
    for (const effort of ["low", "medium", "high", "xhigh"]) {
      const translated = translateBrief(brief({ effort }), "codex");
      assert.equal(translated.ok, true, translated.message);
      assert.equal(translated.invocation.arguments.reasoning_effort, effort);
      assert.equal(translated.invocation.arguments.fork_turns, "none");
      assert.equal(Object.hasOwn(translated.invocation.arguments, "model"), false);
    }
  });

  it("refuses unsupported values and combinations without falling back to another execution profile", () => {
    for (const [selection, reason] of [
      [{ model: "opus", effort: "high" }, /cannot honour model `opus`/],
      [{ model: "gpt-unknown", effort: "high" }, /cannot honour model `gpt-unknown`/],
      [{ model: "gpt-6-astra", effort: "inherited" }, /cannot honour model `gpt-6-astra` with effort `inherited`: an omitted reasoning_effort inherits the parent's effort/],
      [{ model: "gpt-5.2", effort: "inherited" }, /cannot honour model `gpt-5.2` with effort `inherited`/],
      [{ model: "gpt-6-astra", effort: "extreme" }, /cannot honour effort `extreme`/],
      [{ model: "gpt-5.6-luna", effort: "ultra" }, /cannot honour effort `ultra`/],
      [{ model: "gpt-5.5", effort: "max" }, /cannot honour effort `max`/],
      [{ model: "gpt-5.2", effort: "max" }, /cannot honour effort `max`/],
      [{ model: "gpt-5.2", effort: "ultra" }, /cannot honour effort `ultra`/],
      [{ model: "inherited", effort: "max" }, /cannot honour effort `max`/],
      [{ model: "inherited", effort: "ultra" }, /cannot honour effort `ultra`/],
    ]) {
      const input = brief(selection);
      const translated = translateBrief(input, "codex");
      assert.equal(translated.ok, false, JSON.stringify(selection));
      assert.match(translated.message, reason);
      assert.equal(Object.hasOwn(translated, "invocation"), false);
      assert.deepEqual([input.model, input.effort], [selection.model, selection.effort]);
    }
    assert.match(translateBrief(brief({}, { worktree: ".pathfinder/worktrees/53.4" }), "codex").message, /absolute worktree path/);
  });

  it("carries the tester role and review protocol without implementation instructions", () => {
    const translated = translateBrief(brief({ role: "tester" }, { session: "review" }), "codex");
    assert.equal(translated.ok, true, translated.message);
    assert.equal(translated.invocation.arguments.task_name, "pathfinder_53_4_review");
    assert.match(translated.invocation.arguments.message, /read roles\/tester\.md/);
    assert.match(translated.invocation.arguments.message, /Change no implementation, commit nothing/);
    assert.doesNotMatch(translated.invocation.arguments.message, /Run \/ticket load/);
  });

  it("leaves the Claude Code and manual invocation contracts unchanged", () => {
    for (const harness of ["claude-code", "manual"]) {
      const inherited = brief();
      assert.deepEqual(translateBrief(inherited, harness), {
        ok: true, harness, invocation: { role: "developer", prompt: formatBrief(inherited) },
      });
    }
    const claude = brief({ model: "opus" });
    assert.deepEqual(translateBrief(claude, "claude-code"), {
      ok: true, harness: "claude-code", invocation: { role: "developer", prompt: formatBrief(claude), model: "opus" },
    });
    const manual = brief({ model: "custom-model", effort: "custom-effort" });
    assert.deepEqual(translateBrief(manual, "manual"), {
      ok: true, harness: "manual", invocation: { role: "developer", prompt: formatBrief(manual), model: "custom-model", effort: "custom-effort" },
    });
    assert.equal(translateBrief(brief({ effort: "high" }), "claude-code").ok, false);
  });

  it("emits valid recovery-session names through the real CLI for an existing claim", () => {
    const root = makeProject({ tickets: { "53.6": { title: "Product and documentation migration" } } });
    const run = (...args) => orchestrate(args, { root });
    assert.equal(run("claim", "53.6").status, 0);
    for (const [session, expected] of [
      ["rebase-and-reverify", "pathfinder_53_6_rebase_and_reverify"],
      ["resolve-conflict", "pathfinder_53_6_resolve_conflict"],
    ]) {
      const result = run("brief", "53.6", "--harness", "codex", "--session", session, "--json");
      assert.equal(result.status, 0, result.stderr);
      const output = json(result);
      assert.equal(output.brief.session, session);
      assert.equal(output.translation.invocation.arguments.task_name, expected);
      assert.match(output.translation.invocation.arguments.task_name, /^[a-z0-9_]+$/);
    }
  });

  it("resumes a stale Claude claim through Codex, preserving identity, work and profile without harness-aware scheduling", () => {
    const root = makeProject({ tickets: {
      "1.1": { title: "A" }, "1.2": { title: "B" }, "1.3": { title: "C", blockers: ["1.1", "1.2"] },
    } });
    const run = (...args) => orchestrate(args, { root });
    const plan = json(run("plan", "--workers", "2", "--json"));
    assert.deepEqual(plan.dispatch.map((item) => item.key), ["1.1", "1.2"]);
    assert.deepEqual(plan.blocked[0].waiting, ["1.1", "1.2"]);
    for (const key of ["1.1", "1.2"]) assert.equal(run("claim", key).status, 0);
    const original = json(run("brief", "1.1", "--harness", "claude-code", "--json"));
    const other = json(run("brief", "1.2", "--harness", "codex", "--json"));
    assert.notEqual(original.brief.worktree, other.brief.worktree);
    const owner = run("owner", "1.1", "--json").stdout;
    const statePath = join(original.brief.worktree, "context", "current-ticket.md");
    const state = readFileSync(statePath, "utf8");
    const head = runGit(["rev-parse", "HEAD"], original.brief.worktree);
    writeFileSync(join(original.brief.worktree, "partial-work.txt"), "preserve unfinished work\n");
    const status = json(run("status", "--json"));
    assert.equal(status.rows.find((row) => row.key === "1.1").state, "stale");

    const resumed = json(run("brief", "1.1", "--harness", "codex", "--session", "resume", "--json"));
    for (const field of ["ticket", "branch", "worktree", "role", "model", "effort"]) {
      assert.equal(resumed.brief[field], original.brief[field], field);
    }
    assert.equal(resumed.translation.invocation.arguments.task_name, "pathfinder_1_1_resume");
    assert.match(resumed.translation.invocation.arguments.message, /Continue from its Next line and the commits already on the branch/);
    assert.equal(run("owner", "1.1", "--json").stdout, owner, "same claim and persisted execution profile");
    assert.equal(readFileSync(statePath, "utf8"), state);
    assert.equal(readFileSync(join(original.brief.worktree, "partial-work.txt"), "utf8"), "preserve unfinished work\n");
    assert.equal(runGit(["rev-parse", "HEAD"], original.brief.worktree), head);
    assert.equal(run("claim", "1.1").status, 1, "harness substitution cannot create a duplicate claim");
    const after = json(run("plan", "--workers", "2", "--json"));
    assert.deepEqual(after.dispatch, []);
    assert.deepEqual(after.blocked[0].waiting, ["1.1", "1.2"]);
  });
});
