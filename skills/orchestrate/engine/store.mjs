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
 * @typedef {{key: string, title: string, status: string, blockers: string[],
 *            ref: string, number: number|null}} Ticket
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
    tickets.push({
      key,
      title: firstHeading(text) ?? name,
      status: normaliseStatus(section(text, "Status")?.trim() ?? "Proposed"),
      blockers: blockersOf(text),
      ref: `${LOCAL_TICKETS_DIR}/${name}`,
      number: null,
    });
  }
  return { ok: true, tickets: sortTickets(tickets) };
}

function readGitHubTickets(repo, { gh }) {
  const result = spawnSync(
    gh,
    ["issue", "list", "--repo", repo, "--state", "all", "--limit", "500", "--json", "number,title,state,labels,body"],
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

  const tickets = [];
  for (const issue of issues) {
    const body = String(issue.body ?? "");
    const firstLine = body.split(/\r?\n/, 1)[0].trim();
    const marker = TICKET_MARKER.exec(firstLine);
    if (!marker) continue;
    const key = marker[1];
    const labels = (issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name));
    tickets.push({
      key,
      title: titleOf(issue.title, key),
      status: statusFromGitHub(issue.state, labels),
      blockers: blockersOf(body),
      ref: `#${issue.number}`,
      number: issue.number,
    });
  }
  return { ok: true, tickets: sortTickets(tickets) };
}

/**
 * Pathfinder's status from GitHub's representation, as `context/tracker.md`
 * defines it: a `status:` label while open, the closed state when done, and a
 * closed issue with no status label is `Complete`.
 */
export function statusFromGitHub(state, labels) {
  const status = labels.find((label) => label.startsWith("status: "));
  const word = status ? status.slice("status: ".length) : null;
  if (String(state).toUpperCase() === "CLOSED") {
    if (word === "cancelled") return "Cancelled";
    if (word === "superseded") return "Superseded";
    return "Complete";
  }
  switch (word) {
    case "ready":
      return "Ready";
    case "in-progress":
      return "In Progress";
    case "cancelled":
      return "Cancelled";
    case "superseded":
      return "Superseded";
    default:
      return "Proposed";
  }
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

/** The body of a `## Heading` section, up to the next `## `. */
function section(text, heading) {
  // JavaScript has no `\\Z`; `(?![\\s\\S])` is end of input.
  const pattern = new RegExp(`^## ${heading}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m");
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

function normaliseStatus(value) {
  const found = STATUSES.find((status) => status.toLowerCase() === String(value).trim().toLowerCase());
  return found ?? "Proposed";
}

function sortTickets(tickets) {
  return tickets.sort((a, b) => compareKeys(a.key, b.key));
}
