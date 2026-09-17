/**
 * Writes to the ticket store: notes and the gate label. Nothing else.
 *
 * Status is never written here. `ticket load`, `start`, and `complete` own the
 * lifecycle, and a note that also moved a status would be a second writer of
 * the one field that must have exactly one.
 *
 * Every note is idempotent by its marker (see `comments.mjs`): the store is
 * read for the marker first, and a note already present is reported as such
 * rather than posted again.
 *
 * GitHub Issues: an issue comment, and `gh issue edit --add-label` /
 * `--remove-label`. Local Markdown: the note is appended under the ticket
 * file's `## Notes / Decisions`, and there is no label — a local gate is the
 * worker's state file plus its note.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GATE_LABEL } from "./comments.mjs";

/**
 * Post a note unless one with the same marker is already there.
 *
 * @returns {{ok: true, posted: boolean} | {ok: false, message: string}}
 */
export function postNote({ root, store, ticket, note, gh = "gh" }) {
  if (store.kind === "github-issues") {
    const existing = run(gh, ["issue", "view", String(ticket.number), "--repo", store.repo, "--json", "comments"]);
    if (!existing.ok) return existing;
    let comments;
    try {
      comments = JSON.parse(existing.stdout).comments ?? [];
    } catch (error) {
      return { ok: false, message: `\`${gh} issue view\` did not return JSON: ${error.message}` };
    }
    if (comments.some((comment) => String(comment.body ?? "").split(/\r?\n/, 1)[0].trim() === note.marker)) {
      return { ok: true, posted: false };
    }
    const posted = run(gh, ["issue", "comment", String(ticket.number), "--repo", store.repo, "--body", note.body]);
    return posted.ok ? { ok: true, posted: true } : posted;
  }

  if (store.kind === "local") {
    const path = join(root, ...ticket.ref.split("/"));
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      return { ok: false, message: `cannot read ${ticket.ref}: ${error.message}` };
    }
    if (text.split(/\r?\n/).some((line) => line.trim() === note.marker)) return { ok: true, posted: false };
    writeFileSync(path, appendUnderNotes(text, note.body), "utf8");
    return { ok: true, posted: true };
  }

  return { ok: false, message: store.message ?? "the ticket store cannot be written" };
}

/**
 * Add or remove the gate label. A local store has no labels and reports
 * `changed: false` without failing.
 *
 * @returns {{ok: true, changed: boolean} | {ok: false, message: string}}
 */
export function setGateLabel({ store, ticket, present, gh = "gh" }) {
  if (store.kind !== "github-issues") return { ok: true, changed: false };
  const flag = present ? "--add-label" : "--remove-label";
  const result = run(gh, ["issue", "edit", String(ticket.number), "--repo", store.repo, flag, GATE_LABEL]);
  return result.ok ? { ok: true, changed: true } : result;
}

/**
 * Append a note block at the end of `## Notes / Decisions`, creating the
 * section at the end of the file when the ticket has none.
 */
export function appendUnderNotes(text, block) {
  const normalized = text.endsWith("\n") ? text : `${text}\n`;
  const heading = /^## Notes \/ Decisions[ \t]*$/im.exec(normalized);
  if (!heading) return `${normalized}\n## Notes / Decisions\n\n${block}\n`;

  const after = heading.index + heading[0].length;
  const next = /^## /m.exec(normalized.slice(after + 1));
  const end = next ? after + 1 + next.index : normalized.length;
  const before = normalized.slice(0, end).replace(/\n+$/, "\n");
  const rest = normalized.slice(end);
  return `${before}\n${block}\n${rest ? `\n${rest}` : ""}`;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) return { ok: false, message: `could not run \`${command}\`: ${result.error.message}` };
  if (result.status !== 0) {
    return { ok: false, message: `\`${command} ${args.slice(0, 2).join(" ")}\` failed: ${(result.stderr ?? "").trim() || `exit ${result.status}`}` };
  }
  return { ok: true, stdout: result.stdout ?? "" };
}
