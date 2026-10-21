/**
 * What a worker actually ran on, against its brief (61.2), and the recorded
 * human override on `brief`.
 *
 * Fixture transcripts follow the Claude Code 2.1.304 subagent transcript:
 * `api-request` entries carry `params.model` and `params.output_config.effort`;
 * one API response is written as one `assistant` entry per content block, all
 * sharing `message.id`. Every entry carries the streaming-start usage: final
 * input and cache counts, but a small placeholder `output_tokens` with
 * `stop_reason: null`. Only some responses also get an entry whose
 * `stop_reason` is set, and only that entry carries the final output count;
 * `turn({ stopped: false })` is the common real shape with none.
 */

import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  appendDispatchText,
  compare,
  formatDispatch,
  modelMatches,
  parseClaudeCodeTranscript,
} from "../../../skills/orchestrate/engine/dispatch.mjs";
import { cleanUpTemporaryDirectories, json, makeProject, orchestrate, runGit, temporaryDirectory } from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

const APPROVAL = "execution of this Feature's tickets in this round; no merges";
const NOW = "2026-10-20T12:00:00.000Z";
const OVERRIDE = "use sonnet at high for this one — Ricardo";

/** One request and its response, in transcript lines. */
function turn({ id, model, effort, at, usage = { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }, blocks = 1, answered = model, stopped = true, start = 3 }) {
  const params = { model, max_tokens: 1000 };
  if (effort !== undefined) params.output_config = { effort };
  const lines = [{ type: "api-request", id, timestamp: at, version: "2.1.304", querySource: "agent:builtin:general-purpose", params }];
  for (let block = 0; block < blocks; block += 1) {
    lines.push({
      type: "assistant",
      requestRef: id,
      timestamp: at,
      ...(effort !== undefined ? { effort } : {}),
      message: stopped && block === blocks - 1
        ? { id: `msg_${id}`, model: answered, stop_reason: "end_turn", usage }
        : { id: `msg_${id}`, model: answered, stop_reason: null, usage: { ...usage, output_tokens: start } },
    });
  }
  return lines;
}

function transcript(...turns) {
  const dir = temporaryDirectory("dispatch-transcript-");
  const path = join(dir, "agent-a1.jsonl");
  writeFileSync(path, turns.flat().map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") + "\n");
  return path;
}

function claimed() {
  const root = makeProject({ tickets: { "1.1": { title: "A" } } });
  assert.equal(orchestrate(["claim", "1.1", "--now", NOW], { root }).status, 0);
  return root;
}

function statePath(root) {
  return join(root, ".pathfinder", "worktrees", "1.1", "context", "current-ticket.md");
}

/** The real `brief --json` output, saved as the orchestrator would. */
function saveBrief(root, extra = []) {
  const result = orchestrate(["brief", "1.1", "--harness", "claude-code", "--approval", APPROVAL, "--json", ...extra], { root });
  assert.equal(result.status, 0, result.stderr);
  const path = join(temporaryDirectory("dispatch-brief-"), "brief.json");
  writeFileSync(path, result.stdout);
  return { path, output: json(result) };
}

function check(root, brief, args) {
  return orchestrate(["dispatch-check", "1.1", "--session", "implementation", "--harness", "claude-code", "--brief", brief, ...args], { root });
}

const SONNET_HIGH = ["--model", "sonnet", "--effort", "high", "--override", OVERRIDE];

describe("brief with a recorded human override", () => {
  it("reports routing with no override by default", () => {
    const { output } = saveBrief(claimed());
    assert.deepEqual(output.routing, { selected: { model: "inherited", effort: "inherited" }, override: null });
  });

  it("replaces the selection for that one brief, translates it, and records the human's words", () => {
    const root = claimed();
    const before = readFileSync(statePath(root), "utf8");
    const { output } = saveBrief(root, SONNET_HIGH);
    assert.deepEqual(output.routing, {
      selected: { model: "inherited", effort: "inherited" },
      override: { model: "sonnet", effort: "high", by: OVERRIDE },
    });
    assert.deepEqual([output.brief.model, output.brief.effort], ["sonnet", "high"]);
    assert.deepEqual([output.translation.invocation.model, output.translation.invocation.effort], ["sonnet", "high"]);
    assert.equal(readFileSync(statePath(root), "utf8"), before, "the recorded profile is unchanged");
  });

  it("translates an override tier and refuses one the harness cannot honour", () => {
    const root = claimed();
    const tier = saveBrief(root, ["--model", "strong", "--effort", "xhigh", "--override", OVERRIDE]).output;
    assert.equal(tier.brief.model, "strong");
    assert.equal(tier.translation.invocation.model, "opus");
    const refused = orchestrate(["brief", "1.1", "--harness", "claude-code", "--approval", APPROVAL, "--json", "--model", "claude-opus-5", "--effort", "high", "--override", OVERRIDE], { root });
    assert.equal(refused.status, 1);
    assert.equal(refused.stdout, "");
    assert.match(refused.stderr, /cannot honour model `claude-opus-5`/);
  });

  it("is a usage error without --override, or with --override missing a value", () => {
    const root = claimed();
    for (const extra of [
      ["--model", "sonnet"],
      ["--effort", "high"],
      ["--model", "sonnet", "--effort", "high"],
      ["--model", "sonnet", "--effort", "high", "--override", "  "],
      ["--override", OVERRIDE],
      ["--model", "sonnet", "--override", OVERRIDE],
      ["--effort", "high", "--override", OVERRIDE],
    ]) {
      const result = orchestrate(["brief", "1.1", "--harness", "claude-code", "--approval", APPROVAL, "--json", ...extra], { root });
      assert.equal(result.status, 2, `${extra.join(" ")}: ${result.stderr}`);
      assert.equal(result.stdout, "");
    }
  });
});

describe("reading a Claude Code transcript", () => {
  it("takes distinct models and efforts from api-requests, and sums usage once per message", () => {
    const raw = readFileSync(transcript(
      turn({ id: "r1", model: "claude-sonnet-5-5", effort: "high", at: "2026-10-20T12:00:00.000Z", blocks: 3 }),
      turn({ id: "r2", model: "claude-sonnet-5-5", effort: "high", at: "2026-10-20T12:01:30.400Z", usage: { input_tokens: 5, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } }),
    ), "utf8");
    const parsed = parseClaudeCodeTranscript(raw);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.observed, {
      models: ["claude-sonnet-5-5"],
      efforts: ["high"],
      requests: 2,
      tokens: { input: 7, output: 30, cache: 1150, outputLowerBound: false },
      seconds: 90,
      disagreements: [],
    });
  });

  it("never reads a streaming-start output count as final: without a stop_reason the output is a lower bound", () => {
    // The real shape: every block of a response repeats the same placeholder
    // output_tokens with stop_reason null.
    const open = parseClaudeCodeTranscript(readFileSync(transcript(
      turn({ id: "r1", model: "claude-opus-5-5", effort: "high", at: "2026-10-20T12:00:00Z", blocks: 2, stopped: false, start: 8 }),
      turn({ id: "r2", model: "claude-opus-5-5", effort: "high", at: "2026-10-20T12:00:09Z", stopped: false, start: 16 }),
    ), "utf8"));
    assert.deepEqual(open.observed.tokens, { input: 4, output: 24, cache: 300, outputLowerBound: true });
    // One response that did stop contributes its final count; the total stays a bound.
    const mixed = parseClaudeCodeTranscript(readFileSync(transcript(
      turn({ id: "r1", model: "claude-opus-5-5", effort: "high", at: "2026-10-20T12:00:00Z", blocks: 2, stopped: false, start: 8 }),
      turn({ id: "r2", model: "claude-opus-5-5", effort: "high", at: "2026-10-20T12:00:09Z", blocks: 2, usage: { input_tokens: 1, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }),
    ), "utf8"));
    assert.deepEqual(mixed.observed.tokens, { input: 3, output: 408, cache: 150, outputLowerBound: true });
    assert.match(formatDispatch({ ...LINE_RECORD, tokens: mixed.observed.tokens }), /\| in 3 out >=408 cache 150 \|/);
  });

  it("records a response with no usage, or a usage field it left out, as unrecorded, never as zero", () => {
    const request = { type: "api-request", id: "r1", timestamp: "2026-10-20T12:00:00Z", params: { model: "claude-opus-5-5", output_config: { effort: "high" } } };
    const answer = (message) => ({ type: "assistant", requestRef: "r1", timestamp: "2026-10-20T12:00:30Z", effort: "high", message: { id: "m1", model: "claude-opus-5-5", stop_reason: null, ...message } });
    const parse = (...lines) => parseClaudeCodeTranscript([request, ...lines].map((line) => JSON.stringify(line)).join("\n"));

    const none = parse(answer({}));
    assert.equal(none.ok, true);
    assert.deepEqual(none.observed.tokens, { input: null, output: null, cache: null, outputLowerBound: false });
    assert.deepEqual([none.observed.models, none.observed.efforts], [["claude-opus-5-5"], ["high"]], "the model/effort evidence is unchanged");
    assert.match(formatDispatch({ ...LINE_RECORD, tokens: none.observed.tokens }), /\| in unrecorded out unrecorded cache unrecorded \|/);

    // A field left out, or not a non-negative integer, is not known for that total only.
    const partial = parse(answer({ stop_reason: "end_turn", usage: { output_tokens: 12, cache_read_input_tokens: -1, cache_creation_input_tokens: 0 } }));
    assert.deepEqual(partial.observed.tokens, { input: null, output: 12, cache: null, outputLowerBound: false });

    // One message without usage leaves the session's totals unrecorded, not a sum of the others.
    const mixed = parseClaudeCodeTranscript([
      ...turn({ id: "r1", model: "claude-opus-5-5", effort: "high", at: "2026-10-20T12:00:00Z" }),
      ...turn({ id: "r2", model: "claude-opus-5-5", effort: "high", at: "2026-10-20T12:00:05Z" }).map((line) => (line.type === "assistant" ? { ...line, message: { id: "msg_r2", model: "claude-opus-5-5", stop_reason: null } } : line)),
    ].map((line) => JSON.stringify(line)).join("\n"));
    assert.deepEqual(mixed.observed.tokens, { input: null, output: null, cache: null, outputLowerBound: false });

    // A message is known once any of its entries recorded usage.
    const blocks = parse(answer({}), answer({ usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 5, cache_creation_input_tokens: 6 } }));
    assert.deepEqual(blocks.observed.tokens, { input: 3, output: 4, cache: 11, outputLowerBound: true });
  });

  it("refuses a requested model or effort that would break the one-line record", () => {
    for (const params of [{ model: "claude-opus-5-5 | mismatch | x", output_config: { effort: "high" } }, { model: "claude-opus-5-5", output_config: { effort: "high\nState: complete" } }]) {
      const parsed = parseClaudeCodeTranscript([
        { type: "api-request", id: "r1", timestamp: "2026-10-20T12:00:00Z", params },
        { type: "assistant", requestRef: "r1", timestamp: "2026-10-20T12:00:01Z", message: { id: "m1", model: params.model, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      ].map((line) => JSON.stringify(line)).join("\n"));
      assert.equal(parsed.ok, false);
      assert.match(parsed.message, /containing \| or a line break: unsupported evidence/);
    }
  });

  it("refuses a session whose requests produced no model response", () => {
    // A failed API call: one request, one harness-written error entry.
    const parsed = parseClaudeCodeTranscript([
      { type: "api-request", id: "r1", timestamp: "2026-10-20T12:00:00Z", params: { model: "claude-opus-5-5", output_config: { effort: "high" } } },
      { type: "assistant", timestamp: "2026-10-20T12:00:01Z", isApiErrorMessage: true, message: { id: "x", model: "<synthetic>", usage: { input_tokens: 0, output_tokens: 0 } } },
    ].map((line) => JSON.stringify(line)).join("\n"));
    assert.equal(parsed.ok, false);
    assert.match(parsed.message, /1 api-request entry but no model response/);
  });

  it("records a request with no effort as unrecorded, and ignores synthetic messages", () => {
    const parsed = parseClaudeCodeTranscript([
      ...turn({ id: "r1", model: "claude-haiku-5-5", effort: undefined, at: "2026-10-20T12:00:00Z" }),
      { type: "assistant", timestamp: "2026-10-20T12:00:01Z", message: { model: "<synthetic>", usage: { input_tokens: 0, output_tokens: 0 } } },
    ].map((line) => JSON.stringify(line)).join("\n"));
    assert.deepEqual([parsed.observed.models, parsed.observed.efforts, parsed.observed.disagreements], [["claude-haiku-5-5"], ["unrecorded"], []]);
  });

  it("flags an assistant model that disagrees with its request", () => {
    const parsed = parseClaudeCodeTranscript(turn({ id: "r1", model: "claude-sonnet-5-5", effort: "low", at: "2026-10-20T12:00:00Z", answered: "claude-opus-5-5" }).map((line) => JSON.stringify(line)).join("\n"));
    assert.deepEqual(parsed.observed.disagreements, ["assistant model claude-opus-5-5 differs from requested claude-sonnet-5-5"]);
    assert.equal(compare({ model: "sonnet", effort: "low" }, parsed.observed).result, "mismatch");
  });

  it("refuses evidence it cannot read rather than recording a guess", () => {
    assert.match(parseClaudeCodeTranscript("{\"type\":\"user\"}\n").message, /no api-request entries/);
    assert.match(parseClaudeCodeTranscript(JSON.stringify(turn({ id: "r1", model: "m", effort: "low", at: "x" })[0]) + "\n{\"type\":").message, /line 2 is not JSON/);
    const untimed = { type: "api-request", id: "r1", params: { model: "claude-haiku-5-5", output_config: { effort: "low" } } };
    const answer = { type: "assistant", requestRef: "r1", message: { id: "m1", model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { output_tokens: 1 } } };
    assert.match(parseClaudeCodeTranscript([untimed, answer].map((line) => JSON.stringify(line)).join("\n")).message, /no timestamps/);
  });
});

const LINE_RECORD = {
  session: "implementation",
  harness: "claude-code",
  planned: { model: "standard", effort: "medium" },
  invoked: { model: "sonnet", effort: "medium" },
  observed: { models: ["claude-sonnet-5-5"], efforts: ["medium"] },
  result: "match",
  tokens: { input: 7, output: 30, cache: 1150, outputLowerBound: false },
  seconds: 90,
  source: "transcript agent-a1.jsonl",
};

describe("comparing", () => {
  const observed = (models, efforts) => ({ models, efforts, disagreements: [] });

  it("matches a family alias to a model ID of that family, and anything else exactly", () => {
    assert.equal(modelMatches("sonnet", "claude-sonnet-5-5"), true);
    assert.equal(modelMatches("sonnet", "claude-opus-5-5"), false);
    assert.equal(modelMatches("haiku", "claude-haiku"), false, "a family alias needs a versioned model ID");
    assert.equal(modelMatches("gpt-5.5", "gpt-5.5"), true);
    assert.equal(modelMatches("gpt-5.5", "gpt-5.5-mini"), false);
  });

  it("never mismatches an inherited invocation, whatever was observed", () => {
    assert.deepEqual(compare({ model: "inherited", effort: "inherited" }, observed(["a", "b"], ["unrecorded"])), { result: "inherited", reasons: [] });
  });

  it("mismatches two distinct models, an unrecorded effort, and a different effort", () => {
    assert.equal(compare({ model: "sonnet", effort: "high" }, observed(["claude-sonnet-5-5"], ["high"])).result, "match");
    assert.equal(compare({ model: "sonnet", effort: "high" }, observed(["claude-haiku-5-5", "claude-sonnet-5-5"], ["high"])).result, "mismatch");
    assert.equal(compare({ model: "sonnet", effort: "high" }, observed(["claude-sonnet-5-5"], ["unrecorded"])).result, "mismatch");
    assert.equal(compare({ model: "sonnet", effort: "high" }, observed(["claude-sonnet-5-5"], ["low"])).result, "mismatch");
    assert.equal(compare({ model: "sonnet", effort: "inherited" }, observed(["claude-sonnet-5-5"], ["low"])).result, "match", "an inherited effort is not checked");
  });
});

describe("the ## Dispatches section", () => {
  const record = LINE_RECORD;

  it("is one line in the documented format", () => {
    assert.equal(
      formatDispatch(record),
      "- implementation | claude-code | planned standard/medium | invoked sonnet/medium | observed claude-sonnet-5-5/medium | match | in 7 out 30 cache 1150 | 90s | transcript agent-a1.jsonl",
    );
    assert.match(formatDispatch({ ...record, tokens: { ...record.tokens, outputLowerBound: true } }), /\| in 7 out >=30 cache 1150 \|/);
    for (const source of ["a\nb", "a\rb", "a\u2028b", "a\u2029b", "a | b"]) {
      assert.throws(() => formatDispatch({ ...record, source }), /one line without \|/);
    }
    // Every interpolated value, not only the source.
    for (const changed of [
      { session: "a|b" },
      { harness: "a|b" },
      { planned: { model: "opus | mismatch", effort: "high" } },
      { invoked: { model: "opus", effort: "high|x" } },
      { observed: { models: ["claude-opus-5-5 | mismatch | x"], efforts: ["high"] } },
      { observed: { models: ["claude-opus-5-5"], efforts: ["high\nx"] } },
    ]) {
      assert.throws(() => formatDispatch({ ...record, ...changed }), /one line without \|/, JSON.stringify(changed));
    }
  });

  it("is created at the end, appended to in place, and leaves every other byte alone", () => {
    const original = "# Current Ticket\n\n- State: working\n\n## Execution\n\n```yaml\nx: 1\n```\n\n## Tester findings\n\n```json\n{}\n```\n";
    const once = appendDispatchText(original, "- one");
    assert.equal(once, original + "\n## Dispatches\n\n- one\n");
    const twice = appendDispatchText(once, "- two");
    assert.equal(twice, original + "\n## Dispatches\n\n- one\n- two\n");

    const middle = "# T\n\n## Dispatches\n\n- one\n\n## Later\n\nkeep\n";
    assert.equal(appendDispatchText(middle, "- two"), "# T\n\n## Dispatches\n\n- one\n- two\n\n## Later\n\nkeep\n");
    const crlf = "# T\r\n\r\n## Dispatches\r\n";
    assert.equal(appendDispatchText(crlf, "- one"), "# T\r\n\r\n## Dispatches\r\n\r\n- one\r\n");
    assert.throws(() => appendDispatchText("## Dispatches\n\n## Dispatches\n", "- x"), /duplicate/);
  });
});

describe("orchestrate dispatch-check", () => {
  it("records a match against a real override brief, with tokens and time, and preserves the rest of the state file", () => {
    const root = claimed();
    const { path: brief } = saveBrief(root, SONNET_HIGH);
    const before = readFileSync(statePath(root), "utf8");
    const file = transcript(
      turn({ id: "r1", model: "claude-sonnet-5-5", effort: "high", at: "2026-10-20T12:00:00.000Z", blocks: 2 }),
      turn({ id: "r2", model: "claude-sonnet-5-5", effort: "high", at: "2026-10-20T12:00:42.000Z" }),
    );
    const result = check(root, brief, ["--transcript", file]);
    assert.equal(result.status, 0, result.stderr);
    const line = "- implementation | claude-code | planned sonnet/high | invoked sonnet/high | observed claude-sonnet-5-5/high | match | in 4 out 20 cache 300 | 42s | transcript agent-a1.jsonl";
    assert.equal(result.stdout, line + "\n");
    const after = readFileSync(statePath(root), "utf8");
    assert.ok(after.startsWith(before.replace(/\n+$/, "")), "everything before the new section is unchanged");
    assert.equal(after, before.replace(/\n*$/, "\n") + "\n## Dispatches\n\n" + line + "\n");
    assert.equal(json(orchestrate(["owner", "1.1", "--json"], { root })).claim.profileError, null, "the profile still parses");
  });

  it("records a match for a transcript longer than a spread call can take (over 125,000 timestamped entries)", () => {
    const root = claimed();
    const { path: brief } = saveBrief(root, SONNET_HIGH);
    // 70,000 request/response pairs: 140,000 timestamped entries, one second
    // apart per turn, past the ~124k-argument limit of Math.max(...array).
    const start = Date.parse("2026-10-20T12:00:00.000Z");
    const turns = [];
    for (let index = 0; index < 70000; index += 1) {
      turns.push(turn({ id: `r${index}`, model: "claude-sonnet-5-5", effort: "high", at: new Date(start + index * 1000).toISOString(), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
    }
    const file = transcript(...turns);
    const result = check(root, brief, ["--transcript", file]);
    assert.equal(result.status, 0, result.stderr);
    const line = "- implementation | claude-code | planned sonnet/high | invoked sonnet/high | observed claude-sonnet-5-5/high | match | in 70000 out 70000 cache 0 | 69999s | transcript agent-a1.jsonl";
    assert.equal(result.stdout, line + "\n");
    assert.ok(readFileSync(statePath(root), "utf8").includes(line));
  });

  it("exits 1 on a mismatch, still recording the line, and prints the record with --json", () => {
    const root = claimed();
    const { path: brief } = saveBrief(root, SONNET_HIGH);
    const file = transcript(turn({ id: "r1", model: "claude-haiku-5-5", effort: "low", at: "2026-10-20T12:00:00Z" }));
    const result = check(root, brief, ["--transcript", file, "--json"]);
    assert.equal(result.status, 1);
    const record = json(result);
    assert.equal(record.result, "mismatch");
    assert.deepEqual(record.reasons, ["observed model claude-haiku-5-5, invoked sonnet", "observed effort low, invoked high"]);
    assert.match(result.stderr, /dispatch mismatch/);
    assert.ok(readFileSync(statePath(root), "utf8").includes(record.line));
  });

  it("mismatches a session that ran on two models, and one whose effort was not recorded", () => {
    const root = claimed();
    const { path: brief } = saveBrief(root, SONNET_HIGH);
    const two = transcript(
      turn({ id: "r1", model: "claude-sonnet-5-5", effort: "high", at: "2026-10-20T12:00:00Z" }),
      turn({ id: "r2", model: "claude-opus-5-5", effort: "high", at: "2026-10-20T12:00:05Z" }),
    );
    const twoResult = check(root, brief, ["--transcript", two]);
    assert.equal(twoResult.status, 1);
    assert.match(twoResult.stdout, /observed claude-opus-5-5\+claude-sonnet-5-5\/high \| mismatch/);
    const unrecorded = transcript(turn({ id: "r1", model: "claude-sonnet-5-5", effort: undefined, at: "2026-10-20T12:00:00Z" }));
    const unrecordedResult = check(root, brief, ["--transcript", unrecorded]);
    assert.equal(unrecordedResult.status, 1);
    assert.match(unrecordedResult.stdout, /observed claude-sonnet-5-5\/unrecorded \| mismatch/);
  });

  it("records a real-shaped session's output as a lower bound", () => {
    const root = claimed();
    const { path: brief } = saveBrief(root, SONNET_HIGH);
    const file = transcript(
      turn({ id: "r1", model: "claude-sonnet-5-5", effort: "high", at: "2026-10-20T12:00:00Z", blocks: 3, stopped: false, start: 8 }),
      turn({ id: "r2", model: "claude-sonnet-5-5", effort: "high", at: "2026-10-20T12:00:07Z", stopped: false, start: 16 }),
    );
    const result = check(root, brief, ["--transcript", file, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const record = json(result);
    assert.deepEqual(record.tokens, { input: 4, output: 24, cache: 300, outputLowerBound: true });
    assert.equal(record.line, "- implementation | claude-code | planned sonnet/high | invoked sonnet/high | observed claude-sonnet-5-5/high | match | in 4 out >=24 cache 300 | 7s | transcript agent-a1.jsonl");
  });

  it("refuses an API-error-only session and a transcript name that would break the line, recording nothing", () => {
    const root = claimed();
    const { path: brief } = saveBrief(root, SONNET_HIGH);
    const before = readFileSync(statePath(root), "utf8");
    const failed = transcript([
      { type: "api-request", id: "r1", timestamp: NOW, params: { model: "claude-sonnet-5-5", output_config: { effort: "high" } } },
      { type: "assistant", timestamp: NOW, isApiErrorMessage: true, message: { id: "x", model: "<synthetic>", usage: { input_tokens: 0, output_tokens: 0 } } },
    ]);
    const error = check(root, brief, ["--transcript", failed]);
    assert.equal(error.status, 1);
    assert.equal(error.stdout, "");
    assert.match(error.stderr, /no model response/);

    const good = readFileSync(transcript(turn({ id: "r1", model: "claude-sonnet-5-5", effort: "high", at: NOW })), "utf8");
    const dir = temporaryDirectory("dispatch-name-");
    for (const name of ["agent-x | mismatch.jsonl", "agent-x\n## State\n\n- State: complete.jsonl", "agent-x\rb.jsonl", "agent-x\u2028b.jsonl"]) {
      const path = join(dir, name);
      writeFileSync(path, good);
      const result = check(root, brief, ["--transcript", path]);
      assert.equal(result.status, 2, `${JSON.stringify(name)}: ${result.stderr}`);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /one line without \|/);
    }
    assert.equal(readFileSync(statePath(root), "utf8"), before);
    assert.equal(json(orchestrate(["owner", "1.1", "--json"], { root })).claim.state, "working");
  });

  it("records a session whose response carried no usage with unrecorded tokens, still comparing model and effort", () => {
    const root = claimed();
    const { path: brief } = saveBrief(root, SONNET_HIGH);
    const file = transcript([
      { type: "api-request", id: "r1", timestamp: "2026-10-20T12:00:00Z", params: { model: "claude-sonnet-5-5", output_config: { effort: "high" } } },
      { type: "assistant", requestRef: "r1", timestamp: "2026-10-20T12:00:30Z", effort: "high", message: { id: "m1", model: "claude-sonnet-5-5", stop_reason: null } },
    ]);
    const result = check(root, brief, ["--transcript", file, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const record = json(result);
    assert.deepEqual(record.tokens, { input: null, output: null, cache: null, outputLowerBound: false });
    assert.equal(record.line, "- implementation | claude-code | planned sonnet/high | invoked sonnet/high | observed claude-sonnet-5-5/high | match | in unrecorded out unrecorded cache unrecorded | 30s | transcript agent-a1.jsonl");
    assert.ok(readFileSync(statePath(root), "utf8").includes(record.line));
  });

  it("refuses a transcript model or a brief value containing |, exit 1, recording nothing", () => {
    const root = claimed();
    const saved = saveBrief(root, SONNET_HIGH);
    const before = readFileSync(statePath(root), "utf8");
    const piped = "claude-sonnet-5-5 | mismatch | x";
    const file = transcript(turn({ id: "r1", model: piped, effort: "high", at: NOW }));
    const result = check(root, saved.path, ["--transcript", file]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /unsupported evidence/);

    const tampered = join(temporaryDirectory("dispatch-brief-"), "brief.json");
    writeFileSync(tampered, JSON.stringify({ ...saved.output, brief: { ...saved.output.brief, model: "sonnet | mismatch" } }));
    const good = transcript(turn({ id: "r1", model: "claude-sonnet-5-5", effort: "high", at: NOW }));
    const planned = check(root, tampered, ["--transcript", good]);
    assert.equal(planned.status, 1, planned.stderr);
    assert.equal(planned.stdout, "");
    assert.match(planned.stderr, /dispatch not recorded: every value on a dispatch line must be one line without \|/);
    assert.equal(readFileSync(statePath(root), "utf8"), before);
  });

  it("records an inherited session as observed, never a mismatch", () => {
    const root = claimed();
    const { path: brief } = saveBrief(root);
    const file = transcript(turn({ id: "r1", model: "claude-opus-5-5", effort: undefined, at: "2026-10-20T12:00:00Z" }));
    const result = check(root, brief, ["--transcript", file]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /planned inherited\/inherited \| invoked inherited\/inherited \| observed claude-opus-5-5\/unrecorded \| inherited \|/);
  });

  it("accepts a declared observation with its source, for a harness without a parser", () => {
    const root = claimed();
    const result = orchestrate(["brief", "1.1", "--harness", "codex", "--approval", APPROVAL, "--json", "--model", "gpt-5.5", "--effort", "high", "--override", OVERRIDE], { root });
    assert.equal(result.status, 0, result.stderr);
    const brief = join(temporaryDirectory("dispatch-brief-"), "brief.json");
    writeFileSync(brief, result.stdout);
    const args = ["dispatch-check", "1.1", "--session", "implementation", "--harness", "codex", "--brief", brief];
    const declared = orchestrate([...args, "--observed-model", "gpt-5.5", "--observed-effort", "high", "--source", "codex session log 019a"], { root });
    assert.equal(declared.status, 0, declared.stderr);
    assert.equal(declared.stdout, "- implementation | codex | planned gpt-5.5/high | invoked gpt-5.5/high | observed gpt-5.5/high | match | in unrecorded out unrecorded cache unrecorded | unrecorded | declared codex session log 019a\n");
    const parser = orchestrate([...args, "--transcript", transcript(turn({ id: "r1", model: "gpt-5.5", effort: "high", at: "2026-10-20T12:00:00Z" }))], { root });
    assert.equal(parser.status, 2);
    assert.match(parser.stderr, /no transcript parser for codex/);
  });

  it("refuses a brief for another session, harness, or ticket, and unreadable evidence, recording nothing", () => {
    const root = claimed();
    const { path: brief } = saveBrief(root, SONNET_HIGH);
    const before = readFileSync(statePath(root), "utf8");
    const file = transcript(turn({ id: "r1", model: "claude-sonnet-5-5", effort: "high", at: "2026-10-20T12:00:00Z" }));
    const review = orchestrate(["dispatch-check", "1.1", "--session", "review", "--harness", "claude-code", "--brief", brief, "--transcript", file], { root });
    assert.equal(review.status, 1);
    assert.match(review.stderr, /session implementation, not review/);
    const manual = orchestrate(["dispatch-check", "1.1", "--session", "implementation", "--harness", "manual", "--brief", brief, "--transcript", file], { root });
    assert.equal(manual.status, 1);
    assert.match(manual.stderr, /translated for claude-code, not manual/);
    const empty = check(root, brief, ["--transcript", transcript([{ type: "user", timestamp: NOW }])]);
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /no api-request entries/);
    const missing = check(root, brief, ["--transcript", join(root, "nope.jsonl")]);
    assert.equal(missing.status, 1);
    assert.equal(readFileSync(statePath(root), "utf8"), before);
    assert.equal(runGit(["status", "--porcelain"], root), "", "the main checkout stays clean");
  });

  it("is a usage error without its flags, or with both evidence forms", () => {
    const root = claimed();
    const { path: brief } = saveBrief(root);
    const file = transcript(turn({ id: "r1", model: "claude-sonnet-5-5", effort: "high", at: NOW }));
    for (const args of [
      ["dispatch-check", "1.1", "--harness", "claude-code", "--brief", brief, "--transcript", file],
      ["dispatch-check", "1.1", "--session", "implementation", "--brief", brief, "--transcript", file],
      ["dispatch-check", "1.1", "--session", "implementation", "--harness", "claude-code", "--transcript", file],
      ["dispatch-check", "1.1", "--session", "implementation", "--harness", "claude-code", "--brief", brief],
      ["dispatch-check", "1.1", "--session", "implementation", "--harness", "claude-code", "--brief", brief, "--transcript", file, "--observed-model", "x", "--observed-effort", "y", "--source", "z"],
      ["dispatch-check", "1.1", "--session", "implementation", "--harness", "claude-code", "--brief", brief, "--observed-model", "x", "--observed-effort", "y"],
      ["dispatch-check", "1.1", "--session", "implementation", "--harness", "claude-code", "--brief", brief, "--observed-model", "x", "--observed-effort", "y", "--source", "a | b"],
    ]) {
      const result = orchestrate(args, { root });
      assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    }
  });
});
