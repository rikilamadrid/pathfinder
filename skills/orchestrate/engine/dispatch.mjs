/**
 * `dispatch-check` — what a worker session actually ran on, against its brief.
 *
 * The brief says what the policy planned and what the harness was asked for.
 * The harness's own transcript says what was sent to the model API. This
 * module reads that evidence, compares it, and records one line under
 * `## Dispatches` in the claim's `context/current-ticket.md`, so a session
 * that ran on something other than its brief is caught before its report is
 * used.
 *
 * Evidence is harness-recorded, never the worker's own report. A transcript
 * that cannot be read as evidence is refused and nothing is recorded; a value
 * the transcript leaves out is recorded as `unrecorded`, and it never matches
 * an invoked value. Nothing here infers, defaults, or substitutes a value.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { mutateCheckpoint } from "./checkpoint-write.mjs";

export const DISPATCHES_HEADING = "## Dispatches";
export const UNRECORDED = "unrecorded";
export const RESULTS = Object.freeze(["match", "mismatch", "inherited"]);

/** A value that would break the one-line, `|`-separated record. */
export const UNSAFE_LINE_TEXT = /[|\r\n\u2028\u2029]/;

/** Claude Code family aliases: an alias matches a model ID of that family. */
export const CLAUDE_FAMILIES = Object.freeze(["haiku", "sonnet", "opus", "fable"]);

/** Harnesses whose transcript this engine parses. Others use --observed-*. */
export const TRANSCRIPT_PARSERS = Object.freeze({ "claude-code": parseClaudeCodeTranscript });

/** A token count the transcript recorded, or null when it left it out. */
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
/** A message's count across its entries: known once any entry recorded it. */
const larger = (seen, value) => (seen === undefined || seen === null ? value : value === null ? seen : Math.max(seen, value));
const text = (value) => typeof value === "string" && value.trim() !== "";

/**
 * Read a Claude Code subagent transcript (verified on Claude Code 2.1.304).
 *
 * Each line is one JSON object. Primary evidence is every `type: "api-request"`
 * entry's `params.model` and `params.output_config.effort`: what was sent to
 * the API. `type: "assistant"` entries carry `message.model` and a top-level
 * `effort`, cross-checked against the request their `requestRef` names (or
 * against the set of requested models when they name none), and
 * `message.usage`. One API response is written as one assistant entry per
 * content block, all sharing `message.id`, so usage is counted once per
 * message. Input and cache counts are known when the response starts, so the
 * largest value each reached is taken. Output is not: the entries carry the
 * streaming-start usage, a small placeholder `output_tokens` with
 * `stop_reason: null`, and only an entry whose `stop_reason` is set carries
 * the message's final output count. A message with such an entry contributes
 * that count; one without contributes its placeholder, and the total is then
 * only a lower bound (`outputLowerBound`, recorded as `out >=<n>`). A model
 * response with no usage, or a usage field that is absent or not a
 * non-negative integer, leaves that total not recorded (`null`, written
 * `unrecorded`): it is never counted as zero. A requested model or effort that
 * would break the one-line record (`|` or a line break) is refused as
 * unsupported evidence.
 * `<synthetic>` assistant entries are written by the harness, not the model,
 * and are not evidence; a transcript whose requests produced no other
 * assistant entry (an API error, say) is refused as partial evidence.
 *
 * @returns {{ok: true, observed: object} | {ok: false, message: string}}
 */
export function parseClaudeCodeTranscript(raw) {
  const lines = raw.split(/\r?\n/);
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === "") continue;
    try {
      entries.push(JSON.parse(lines[index]));
    } catch {
      return { ok: false, message: `transcript line ${index + 1} is not JSON: partial or unsupported evidence, nothing recorded` };
    }
  }

  const requests = entries.filter((entry) => entry?.type === "api-request");
  if (requests.length === 0) {
    return { ok: false, message: "transcript has no api-request entries: no evidence of what was sent to the model, nothing recorded" };
  }

  const models = new Set();
  const efforts = new Set();
  const byId = new Map();
  for (const request of requests) {
    const model = text(request.params?.model) ? request.params.model : UNRECORDED;
    const effort = text(request.params?.output_config?.effort) ? request.params.output_config.effort : UNRECORDED;
    if (UNSAFE_LINE_TEXT.test(model) || UNSAFE_LINE_TEXT.test(effort)) {
      return { ok: false, message: "transcript requests a model or effort containing | or a line break: unsupported evidence for the one-line record, nothing recorded" };
    }
    models.add(model);
    efforts.add(effort);
    if (text(request.id)) byId.set(request.id, { model, effort });
  }

  const disagreements = [];
  const usage = new Map();
  let responses = 0;
  for (const entry of entries) {
    if (entry?.type !== "assistant") continue;
    const message = entry.message ?? {};
    if (message.model === "<synthetic>") continue;
    responses += 1;
    const request = text(entry.requestRef) ? byId.get(entry.requestRef) : undefined;
    if (text(message.model)) {
      if (request ? request.model !== message.model : !models.has(message.model)) {
        disagreements.push(`assistant model ${message.model} differs from requested ${request ? request.model : [...models].join("+")}`);
      }
    }
    if (request && text(entry.effort) && request.effort !== UNRECORDED && entry.effort !== request.effort) {
      disagreements.push(`assistant effort ${entry.effort} differs from requested ${request.effort}`);
    }
    // Every counted response is a message, with or without usage: an absent
    // usage object or field is recorded as not known, never as zero.
    const id = text(message.id) ? message.id : `entry-${usage.size}`;
    const seen = usage.get(id) ?? { final: null };
    const recorded = message.usage && typeof message.usage === "object" ? message.usage : {};
    const output = count(recorded.output_tokens);
    const read = count(recorded.cache_read_input_tokens);
    const creation = count(recorded.cache_creation_input_tokens);
    const stopped = message.stop_reason !== null && message.stop_reason !== undefined;
    usage.set(id, {
      input: larger(seen.input, count(recorded.input_tokens)),
      output: larger(seen.output, output),
      cache: larger(seen.cache, read === null || creation === null ? null : read + creation),
      final: stopped && output !== null ? Math.max(seen.final ?? 0, output) : seen.final,
    });
  }

  if (responses === 0) {
    return { ok: false, message: `transcript has ${requests.length} api-request ${requests.length === 1 ? "entry" : "entries"} but no model response (only harness-written <synthetic> or no assistant entries, such as an API error): partial evidence, nothing recorded` };
  }

  const times = entries.map((entry) => Date.parse(entry?.timestamp)).filter(Number.isFinite);
  if (times.length === 0) {
    return { ok: false, message: "transcript carries no timestamps: partial evidence, nothing recorded" };
  }

  // A total is known only when every message recorded it; one gap leaves the
  // total null (`unrecorded`), not a sum presented as exact.
  const add = (total, value) => (total === null || value === null ? null : total + value);
  const tokens = { input: 0, output: 0, cache: 0, outputLowerBound: false };
  for (const value of usage.values()) {
    tokens.input = add(tokens.input, value.input);
    tokens.cache = add(tokens.cache, value.cache);
    if (value.final !== null) {
      tokens.output = add(tokens.output, value.final);
    } else {
      tokens.output = add(tokens.output, value.output);
      tokens.outputLowerBound = true;
    }
  }
  if (tokens.output === null) tokens.outputLowerBound = false;

  return {
    ok: true,
    observed: {
      models: [...models].sort(),
      efforts: [...efforts].sort(),
      requests: requests.length,
      tokens,
      seconds: Math.round((Math.max(...times) - Math.min(...times)) / 1000),
      disagreements: [...new Set(disagreements)],
    },
  };
}

/** The model and effort the harness was asked for, from a translation. */
export function invokedOf(translation) {
  const invocation = translation?.invocation ?? {};
  const args = invocation.arguments ?? {};
  return {
    model: invocation.model ?? args.model ?? "inherited",
    effort: invocation.effort ?? args.reasoning_effort ?? "inherited",
  };
}

/** Does an observed model ID honour an invoked model? An alias matches its family. */
export function modelMatches(invoked, observed) {
  if (CLAUDE_FAMILIES.includes(invoked)) return observed.startsWith(`claude-${invoked}-`);
  return invoked === observed;
}

/**
 * Compare. `inherited` for both is recorded as observed and never mismatches.
 * Otherwise every invoked value must be met by exactly one observed value, and
 * the transcript must agree with itself. An absent observation never matches.
 */
export function compare(invoked, observed) {
  if (invoked.model === "inherited" && invoked.effort === "inherited") return { result: "inherited", reasons: [] };
  const reasons = [...(observed.disagreements ?? [])];
  if (invoked.model !== "inherited") {
    if (observed.models.length !== 1) reasons.push(`observed ${observed.models.length} distinct models (${observed.models.join(", ")}), invoked ${invoked.model}`);
    else if (!modelMatches(invoked.model, observed.models[0])) reasons.push(`observed model ${observed.models[0]}, invoked ${invoked.model}`);
  }
  if (invoked.effort !== "inherited") {
    if (observed.efforts.length !== 1) reasons.push(`observed ${observed.efforts.length} distinct efforts (${observed.efforts.join(", ")}), invoked ${invoked.effort}`);
    else if (observed.efforts[0] !== invoked.effort) reasons.push(`observed effort ${observed.efforts[0]}, invoked ${invoked.effort}`);
  }
  return { result: reasons.length === 0 ? "match" : "mismatch", reasons };
}

/**
 * The one `## Dispatches` line. `out >=<n>` when the output count is only a
 * lower bound. Throws when any interpolated value carries `|` or a line
 * break, which would shift the columns or write past the line.
 */
export function formatDispatch(record) {
  const fields = [
    record.session,
    record.harness,
    record.planned.model,
    record.planned.effort,
    record.invoked.model,
    record.invoked.effort,
    ...record.observed.models,
    ...record.observed.efforts,
    record.result,
    record.source,
  ];
  if (fields.some((field) => typeof field !== "string" || UNSAFE_LINE_TEXT.test(field))) {
    throw new Error("every value on a dispatch line must be one line without |");
  }
  const tokens = record.tokens ?? {};
  const value = (n) => (Number.isSafeInteger(n) ? String(n) : UNRECORDED);
  const output = tokens.outputLowerBound === true && Number.isSafeInteger(tokens.output) ? `>=${tokens.output}` : value(tokens.output);
  const line = [
    `- ${record.session}`,
    record.harness,
    `planned ${record.planned.model}/${record.planned.effort}`,
    `invoked ${record.invoked.model}/${record.invoked.effort}`,
    `observed ${record.observed.models.join("+")}/${record.observed.efforts.join("+")}`,
    record.result,
    `in ${value(tokens.input)} out ${output} cache ${value(tokens.cache)}`,
    Number.isSafeInteger(record.seconds) ? `${record.seconds}s` : UNRECORDED,
    record.source,
  ].join(" | ");
  return line;
}

/**
 * Append `line` at the end of the one `## Dispatches` section, creating it at
 * the end of the file when absent. Nothing else in the text changes.
 */
export function appendDispatchText(original, line) {
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.replace(/\r\n/g, "\n").split("\n");
  const headings = lines.map((value, index) => (/^## Dispatches[ \t]*$/.test(value) ? index : -1)).filter((index) => index >= 0);
  if (headings.length > 1) throw new Error("duplicate ## Dispatches sections; resolve before appending");

  if (headings.length === 0) {
    while (lines.length > 0 && lines.at(-1) === "") lines.pop();
    lines.push("", DISPATCHES_HEADING, "", line, "");
    return lines.join(eol);
  }

  const heading = headings[0];
  let end = lines.findIndex((value, index) => index > heading && /^## /.test(value));
  if (end < 0) end = lines.length;
  // After the section's last non-blank line; a blank line under the heading
  // when the section is empty, and before the next section when one follows.
  let last = end - 1;
  while (last > heading && lines[last] === "") last -= 1;
  const insert = last === heading ? ["", line] : [line];
  lines.splice(last + 1, 0, ...insert);
  const after = last + 1 + insert.length;
  if (after === lines.length) lines.push("");
  else if (lines[after] !== "") lines.splice(after, 0, "");
  return lines.join(eol);
}

/**
 * Check one finished worker session and record it.
 *
 * @param {object} options
 * @param {string} options.key        the ticket key
 * @param {string} options.session    the session the brief was built for
 * @param {string} options.harness    the harness the session ran on
 * @param {object} options.brief      the `brief --json` output: `{ brief, translation }`
 * @param {string} [options.transcript]  a transcript path, for a harness with a parser
 * @param {object} [options.declared] `{ model, effort, source }` for a harness without one
 * @param {string} options.statePath  the claim's `context/current-ticket.md`
 * @returns {{ok: true, record: object, line: string} | {ok: false, usage?: boolean, message: string}}
 */
export function dispatchCheck({ key, session, harness, brief: briefJson, transcript = null, declared = null, statePath }) {
  const brief = briefJson?.brief;
  const translation = briefJson?.translation;
  if (!brief || typeof brief !== "object" || !translation || typeof translation !== "object") {
    return { ok: false, message: "the brief file is not `brief --json` output: it needs `brief` and `translation`" };
  }
  if (brief.ticket !== key) return { ok: false, message: `the brief is for ${brief.ticket}, not ${key}` };
  if (brief.session !== session) return { ok: false, message: `the brief is for session ${brief.session}, not ${session}` };
  if (translation.ok !== true || translation.harness !== harness) {
    return { ok: false, message: `the brief was translated for ${translation.harness ?? "no harness"}, not ${harness}` };
  }
  if (!text(brief.model) || !text(brief.effort)) return { ok: false, message: "the brief names no planned model and effort" };

  let observed;
  let source;
  if (transcript !== null) {
    const parse = TRANSCRIPT_PARSERS[harness];
    if (!parse) {
      return { ok: false, usage: true, message: `no transcript parser for ${harness}; declare what was observed with --observed-model, --observed-effort and --source` };
    }
    if (UNSAFE_LINE_TEXT.test(basename(transcript))) {
      return { ok: false, usage: true, message: "the transcript file name must be one line without |: it is recorded as the line's source" };
    }
    let raw;
    try {
      raw = readFileSync(transcript, "utf8");
    } catch (error) {
      return { ok: false, message: `cannot read transcript ${transcript}: ${error.code ?? error.message}` };
    }
    const parsed = parse(raw);
    if (!parsed.ok) return parsed;
    observed = parsed.observed;
    source = `transcript ${basename(transcript)}`;
  } else {
    observed = { models: [declared.model], efforts: [declared.effort], requests: null, tokens: null, seconds: null, disagreements: [] };
    source = `declared ${declared.source}`;
  }

  const invoked = invokedOf(translation);
  const { result, reasons } = compare(invoked, observed);
  const record = {
    ticket: key,
    session,
    harness,
    planned: { model: brief.model, effort: brief.effort },
    invoked,
    observed: { models: observed.models, efforts: observed.efforts, requests: observed.requests },
    result,
    reasons,
    tokens: observed.tokens,
    seconds: observed.seconds,
    source,
  };
  let line;
  try {
    line = formatDispatch(record);
  } catch (error) {
    return { ok: false, message: `dispatch not recorded: ${error.message}` };
  }

  try {
    mutateCheckpoint(statePath, (latest) => {
      if (latest === null) throw new Error("the claim has no state file");
      return { text: appendDispatchText(latest, line) };
    });
  } catch (error) {
    return { ok: false, message: `dispatch not recorded: ${error.message}` };
  }
  return { ok: true, record, line };
}
