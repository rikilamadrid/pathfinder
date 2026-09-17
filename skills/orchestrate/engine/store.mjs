/**
 * The ticket store, read the way `skills/ticket/store.md` says.
 *
 * Two stores exist. No `context/tracker.md` means local Markdown under
 * `context/tickets/`. A `tracker.md` names another store, and for this engine
 * to read it the file has to carry one machine-readable line:
 *
 *     <!-- pathfinder:ticket-store github-issues owner/repo -->
 *
 * A `tracker.md` without that line is a store the engine cannot read, and it
 * says so with the exact line to add rather than guessing at the prose.
 *
 * Both readers produce the same ticket shape, so everything downstream — the
 * board, the claims, the status table — is written once. Status vocabulary is
 * Pathfinder's: `Proposed`, `Ready`, `In Progress`, `Complete`, `Cancelled`,
 * `Superseded`. The GitHub reader translates labels and the closed state into
 * it here, and nowhere else.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { compareKeys, isKey } from "./keys.mjs";

export const TRACKER_PATH = "context/tracker.md";
export const LOCAL_TICKETS_DIR = "context/tickets";
export const STORE_MARKER_EXAMPLE = "<!-- pathfinder:ticket-store github-issues owner/repo -->";

const STORE_MARKER = /^<!--\s*pathfinder:ticket-store\s+(\S+)(?:\s+(\S+))?\s*-->$/;
const TICKET_MARKER = /^<!--\s*pathfinder:ticket\s+(\d+\.\d+)\s*-->$/;

export const STATUSES = Object.freeze(["Proposed", "Ready", "In Progress", "Complete", "Cancelled", "Superseded"]);

/**
 * A status the engine cannot read. Never eligible, never complete: a ticket
 * whose state is unknown is not offered for work and does not unblock anyone.
 * The row's `problem` says what was found.
 */
export const UNRECOGNISED = "Unrecognised";

/** The most issues one `gh issue list` call asks for. Reaching it is a refusal, not a truncation. */
export const ISSUE_LIMIT = 1000;
export const TERMINAL = Object.freeze(["Complete", "Cancelled", "Superseded"]);

/**
 * Which store this project uses.
 *
 * @returns {{kind: "local"} | {kind: "github-issues", repo: string} |
 *           {kind: "unreadable", message: string}}
 */
export function resolveStore(root, { override = null } = {}) {
  if (override) return parseStoreSpec(override);

  const trackerPath = join(root, ...TRACKER_PATH.split("/"));
  if (!existsSync(trackerPath)) return { kind: "local" };

  let content;
  try {
    content = readFileSync(trackerPath, "utf8");
  } catch (error) {
    return { kind: "unreadable", message: `${TRACKER_PATH} could not be read: ${error.message}` };
  }

  for (const line of content.split(/\r?\n/)) {
    const match = STORE_MARKER.exec(line.trim());
    if (match) return parseStoreSpec(match[2] ? `${match[1]}:${match[2]}` : match[1]);
  }

  return {
    kind: "unreadable",
    message:
      `${TRACKER_PATH} names a ticket store but carries no machine-readable marker. ` +
      `Add one line to it, for example \`${STORE_MARKER_EXAMPLE}\`, ` +
      "so the engine knows which store to read.",
  };
}

/** `github-issues:owner/repo` or `local`, as the marker or `--store` spells it. */
function parseStoreSpec(spec) {
  const [kind, target] = String(spec).split(":");
  if (kind === "local") return { kind: "local" };
  if (kind === "github-issues") {
    if (!target || !/^[\w.-]+\/[\w.-]+$/.test(target)) {
      return { kind: "unreadable", message: `ticket store \`${spec}\` needs an owner/repo, as in \`github-issues owner/repo\`` };
    }
    return { kind: "github-issues", repo: target };
  }
  return { kind: "unreadable", message: `unknown ticket store \`${kind}\`. This engine reads \`local\` and \`github-issues\`.` };
}

/** One line describing the store, for the table header. */
export function describeStore(store) {
  if (store.kind === "local") return `local Markdown (${LOCAL_TICKETS_DIR}/)`;
  if (store.kind === "github-issues") return `GitHub Issues ${store.repo}`;
  return "unreadable";
}

/**
 * Every ticket in the store.
 *
 * @returns {{ok: true, tickets: Ticket[]} | {ok: false, message: string}}
 * @typedef {{key: string, title: string, status: string, problem: string|null,
 *            blockers: string[], ref: string, number: number|null, body: string}} Ticket
 */
export function readTickets(root, store, { gh = "gh" } = {}) {
  if (store.kind === "local") return readLocalTickets(root);
  if (store.kind === "github-issues") return readGitHubTickets(store.repo, { gh });
  return { ok: false, message: store.message };
}

function readLocalTickets(root) {
  const directory = join(root, ...LOCAL_TICKETS_DIR.split("/"));
  if (!existsSync(directory)) return { ok: true, tickets: [] };

  const tickets = [];
  for (const name of readdirSync(directory).sort()) {
    const match = /^(\d+\.\d+)-.*\.md$/.exec(name) ?? /^(\d+\.\d+)\.md$/.exec(name);
    if (!match) continue;
    const key = match[1];
    const text = readFileSync(join(directory, name), "utf8");
    const read = localStatus(text);
    tickets.push({
      key,
      title: firstHeading(text) ?? name,
      status: read.status,
      problem: read.problem,
      blockers: blockersOf(text),
      ref: `${LOCAL_TICKETS_DIR}/${name}`,
      number: null,
      body: text,
    });
  }
  return { ok: true, tickets: sortTickets(tickets) };
}

function readGitHubTickets(repo, { gh }) {
  const result = spawnSync(
    gh,
    ["issue", "list", "--repo", repo, "--state", "all", "--limit", String(ISSUE_LIMIT), "--json", "number,title,state,labels,body"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) return { ok: false, message: `could not run \`${gh}\`: ${result.error.message}` };
  if (result.status !== 0) {
    return { ok: false, message: `\`${gh} issue list\` failed: ${(result.stderr ?? "").trim() || `exit ${result.status}`}` };
  }

  let issues;
  try {
    issues = JSON.parse(result.stdout);
  } catch (error) {
    return { ok: false, message: `\`${gh} issue list\` did not return JSON: ${error.message}` };
  }

  if (!Array.isArray(issues)) return { ok: false, message: `\`${gh} issue list\` did not return a list` };
  if (issues.length >= ISSUE_LIMIT) {
    return {
      ok: false,
      message: `the store returned ${issues.length} issues, the most one read asks for; refusing rather than judging eligibility from a partial board`,
    };
  }

  const tickets = [];
  for (const issue of issues) {
    const body = String(issue.body ?? "");
    const firstLine = body.split(/\r?\n/, 1)[0].trim();
    const marker = TICKET_MARKER.exec(firstLine);
    if (!marker) continue;
    const key = marker[1];
    const labels = (issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name));
    const read = githubStatus(issue.state, labels);
    tickets.push({
      key,
      title: titleOf(issue.title, key),
      status: read.status,
      problem: read.problem,
      blockers: blockersOf(body),
      ref: `#${issue.number}`,
      number: issue.number,
      body,
    });
  }
  return { ok: true, tickets: sortTickets(tickets) };
}

/**
 * Pathfinder's status from GitHub's representation, as `context/tracker.md`
 * defines it: exactly one `status:` label while open; closed with no status
 * label is `Complete`; closed with `cancelled` or `superseded` is that.
 *
 * Anything else is inconsistent — two status labels, an open issue with none,
 * a closed issue still labelled `ready` or `in-progress`, a label word the
 * config does not define — and reads as unrecognised rather than as the
 * nearest guess. A guess of `Complete` would unblock dependents of work that
 * may not be done.
 */
export function githubStatus(state, labels) {
  const words = labels.filter((label) => label.startsWith("status: ")).map((label) => label.slice("status: ".length));
  const closed = String(state).toUpperCase() === "CLOSED";
  const unrecognised = (problem) => ({ status: UNRECOGNISED, problem });

  if (words.length > 1) return unrecognised(`carries ${words.length} status labels: ${words.join(", ")}`);
  const word = words[0] ?? null;

  if (closed) {
    if (word === null) return { status: "Complete", problem: null };
    if (word === "cancelled") return { status: "Cancelled", problem: null };
    if (word === "superseded") return { status: "Superseded", problem: null };
    return unrecognised(`is closed but still labelled status: ${word}`);
  }

  const open = { proposed: "Proposed", ready: "Ready", "in-progress": "In Progress" };
  if (word === null) return unrecognised("is open with no status label");
  if (word in open) return { status: open[word], problem: null };
  if (word === "cancelled" || word === "superseded") return unrecognised(`is open but labelled status: ${word}`);
  return unrecognised(`has an unknown label status: ${word}`);
}

/** The status alone, for callers that only need the word. */
export function statusFromGitHub(state, labels) {
  return githubStatus(state, labels).status;
}

/**
 * A local ticket's `## Status`: its first non-blank line, which must be one of
 * the six statuses exactly, ignoring case. A missing section or any other
 * value is unrecognised, and named.
 */
export function localStatus(text) {
  const body = section(text, "Status");
  if (body === null) return { status: UNRECOGNISED, problem: "has no ## Status section" };
  const line = body.split(/\r?\n/).map((value) => value.trim()).find((value) => value !== "") ?? "";
  const found = STATUSES.find((status) => status.toLowerCase() === line.toLowerCase());
  return found ? { status: found, problem: null } : { status: UNRECOGNISED, problem: `has an unrecognised status \`${line}\`` };
}

/** `NN.TT — Title` is written for humans; the key comes from the marker, never from here. */
function titleOf(title, key) {
  const text = String(title ?? "").trim();
  const prefix = new RegExp(`^${key.replace(".", "\\.")}\\s*[—–-]+\\s*`);
  return text.replace(prefix, "") || text;
}

function firstHeading(text) {
  const match = /^#\s+(.+?)\s*$/m.exec(text);
  return match ? match[1].trim() : null;
}

/** The body of a `## Heading` section, up to the next `## `, or null. */
export function section(text, heading) {
  // JavaScript has no `\\Z`; `(?![\\s\\S])` is end of input.
  // Headings match ignoring case: `## Blocked By` is the same section, and
  // missing it would silently drop every edge.
  const pattern = new RegExp(`^## ${heading}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "mi");
  const match = pattern.exec(text);
  return match ? match[1] : null;
}

/**
 * Blocker keys: backticked keys on list lines under `## Blocked by`.
 *
 * Only list lines count, and only the first backticked key on each, so a key
 * mentioned in a blocker's explanation is not read as a second edge. `None`
 * is no edge at all.
 */
export function blockersOf(text) {
  const body = section(text, "Blocked by");
  if (!body) return [];
  const keys = [];
  for (const line of body.split(/\r?\n/)) {
    const item = /^\s*[-*]\s+`(\d+\.\d+)`/.exec(line);
    if (item && isKey(item[1]) && !keys.includes(item[1])) keys.push(item[1]);
  }
  return keys;
}

function sortTickets(tickets) {
  return tickets.sort((a, b) => compareKeys(a.key, b.key));
}
