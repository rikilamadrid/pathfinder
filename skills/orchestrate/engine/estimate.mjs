/**
 * `estimate(ticket, in-flight claims)` — the first of the three steps between
 * eligibility and dispatch.
 *
 * Every derived field is a count over the ticket's own body, compared with a
 * threshold `skills/orchestrate/profile.md` documents, so the same ticket and
 * the same board give the same bytes. Nothing here reads the clock, the model,
 * or any history of past tickets. Only `risk` may be assessed instead, and an
 * assessment carries its reason and is marked as one.
 *
 * The thresholds are deliberately coarse. They exist to give a routing policy
 * a stable, inspectable input — not to be right about any single ticket — and
 * v1's `static` policy ignores them entirely.
 */

import { section } from "./store.mjs";

export const THRESHOLDS = Object.freeze({
  complexity: Object.freeze({ low: 3, medium: 7 }), // bullets: ≤3 low, ≤7 medium, else high
  context: Object.freeze({ small: 3, medium: 8 }), //  paths:   ≤3 small, ≤8 medium, else large
});

/**
 * @param {{key: string, body: string}} ticket
 * @param {{key: string, body: string}[]} inFlight tickets other workers hold
 * @param {{risk?: string|null, reason?: string|null}} [assessment]
 * @returns {{ok: true, estimate: object} | {ok: false, message: string}}
 */
export function estimateTicket(ticket, inFlight = [], { risk = null, reason = null } = {}) {
  const changes = countChanges(ticket.body);
  const paths = contextPaths(ticket.body);

  const complexity = {
    value: changes <= THRESHOLDS.complexity.low ? "low" : changes <= THRESHOLDS.complexity.medium ? "medium" : "high",
    source: "derived",
    reason: `${changes} bullet${changes === 1 ? "" : "s"} under ## Changes`,
  };

  const context = {
    value: paths.length <= THRESHOLDS.context.small ? "small" : paths.length <= THRESHOLDS.context.medium ? "medium" : "large",
    source: "derived",
    reason: `${paths.length} path${paths.length === 1 ? "" : "s"} named under ## Context`,
  };

  const parallel = parallelSafety(ticket, inFlight);

  let riskEntry;
  if (risk !== null || reason !== null) {
    if (risk === null || reason === null || String(reason).trim() === "") {
      return { ok: false, message: "an assessed risk needs both --risk and a non-empty --reason" };
    }
    if (!["low", "medium", "high"].includes(risk)) {
      return { ok: false, message: `risk \`${risk}\` must be low, medium, or high when assessed` };
    }
    riskEntry = { value: risk, source: "assessed", reason: String(reason).trim() };
  } else {
    riskEntry = deriveRisk(complexity.value, context.value, parallel.value);
  }

  return {
    ok: true,
    estimate: { complexity, context, "parallel-safety": parallel, risk: riskEntry },
  };
}

/**
 * The documented risk rule, and the only one:
 *
 *   low   — complexity low, context small, and isolated
 *   high  — complexity high and context large
 *
 * Anything else is `unassessed`: the engine does not guess a middle.
 */
export function deriveRisk(complexity, context, parallel) {
  if (complexity === "low" && context === "small" && parallel === "isolated") {
    return { value: "low", source: "derived", reason: "low complexity, small context, isolated" };
  }
  if (complexity === "high" && context === "large") {
    return { value: "high", source: "derived", reason: "high complexity and large context" };
  }
  return { value: "unassessed", source: "derived", reason: "no risk rule applies" };
}

/** Top-level list items under `## Changes`. Indented sub-bullets are part of their parent. */
export function countChanges(body) {
  const text = section(body, "Changes");
  if (text === null) return 0;
  return text.split(/\r?\n/).filter((line) => /^[-*]\s+\S/.test(line)).length;
}

/**
 * Distinct paths named under `## Context`: backticked tokens that look like a
 * path — they contain a `/`, or end in a file extension. Globs and trailing
 * slashes are normalised so `site/` and `site` count once.
 */
export function contextPaths(body) {
  const text = section(body, "Context");
  if (text === null) return [];
  return uniquePaths(backticked(text));
}

/**
 * The `Relevant area` paths of a ticket: backticked tokens on the lines of
 * `## Context` that begin `- Relevant area:`.
 */
export function relevantAreas(body) {
  const text = section(body, "Context");
  if (text === null) return [];
  const lines = text.split(/\r?\n/).filter((line) => /^\s*[-*]\s+Relevant area\s*:/i.test(line));
  return uniquePaths(lines.flatMap((line) => backticked(line)));
}

/**
 * How safely this ticket runs beside the tickets other workers already hold:
 *
 *   serialize       it names a file another in-flight ticket also names
 *   shared-surface  it names a directory that contains, or is contained by, one
 *                   another in-flight ticket names
 *   isolated        no overlap, or nothing in flight
 *
 * Overlap is between `Relevant area` paths only. A ticket with no Relevant
 * area overlaps nothing and is isolated, which is a statement about what the
 * ticket declares, and is reported as such.
 */
export function parallelSafety(ticket, inFlight) {
  const mine = relevantAreas(ticket.body);
  const others = inFlight.filter((other) => other.key !== ticket.key);

  if (others.length === 0) return { value: "isolated", source: "derived", reason: "no other ticket is in flight" };
  if (mine.length === 0) return { value: "isolated", source: "derived", reason: "the ticket names no Relevant area" };

  let shared = null;
  for (const other of [...others].sort((a, b) => a.key.localeCompare(b.key, "en"))) {
    for (const theirs of relevantAreas(other.body)) {
      for (const path of mine) {
        if (path === theirs && isFile(path)) {
          return { value: "serialize", source: "derived", reason: `names ${path}, which ${other.key} also names` };
        }
        if (shared === null && (path === theirs || contains(path, theirs) || contains(theirs, path))) {
          shared = { value: "shared-surface", source: "derived", reason: `${path} overlaps ${theirs} in ${other.key}` };
        }
      }
    }
  }
  return shared ?? { value: "isolated", source: "derived", reason: "no Relevant area overlaps an in-flight ticket" };
}

function backticked(text) {
  return [...text.matchAll(/`([^`\s]+)`/g)].map((match) => match[1]);
}

function uniquePaths(tokens) {
  const paths = new Set();
  for (const token of tokens) {
    if (!looksLikePath(token)) continue;
    paths.add(normalise(token));
  }
  return [...paths].sort();
}

function looksLikePath(token) {
  return token.includes("/") || /\.[a-z0-9]+$/i.test(token);
}

function normalise(token) {
  return token
    .replace(/\{[^}]*\}/g, "")
    .replace(/\/\*\*?$/, "")
    .replace(/\*.*$/, "")
    .replace(/\/+$/, "");
}

function isFile(path) {
  return /\.[a-z0-9]+$/i.test(path.split("/").pop() ?? "");
}

function contains(directory, path) {
  return !isFile(directory) && path.startsWith(`${directory}/`);
}
