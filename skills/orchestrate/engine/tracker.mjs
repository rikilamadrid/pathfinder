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
export function postNote({ root, store, ticket, note, gh = "gh", worktree = null }) {
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
    // Into the claim's own worktree, so the note travels with the ticket's
    // branch and pull request and the main checkout is never left dirty. An
    // unclaimed local ticket gets no note: its reasons are in the plan.
    if (!worktree) return { ok: true, posted: false, skipped: "a local ticket's notes are written only into its claim's worktree" };
    const path = join(worktree, ...ticket.ref.split("/"));
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
  // The file's own line ending, kept. A heading inside a fenced block is text.
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const blockLines = block.replace(/\r\n/g, "\n").split("\n");

  let fenced = false;
  let start = -1;
  let end = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*(```|~~~)/.test(lines[index])) fenced = !fenced;
    if (fenced) continue;
    if (start === -1 && /^## Notes \/ Decisions[ \t]*$/i.test(lines[index])) {
      start = index;
    } else if (start !== -1 && /^## /.test(lines[index])) {
      end = index;
      break;
    }
  }

  if (start === -1) return [...lines, "", "## Notes / Decisions", "", ...blockLines, ""].join(eol);

  let last = end;
  while (last > start + 1 && lines[last - 1] === "") last -= 1;
  const out = [...lines.slice(0, last), "", ...blockLines];
  if (end < lines.length) out.push("", ...lines.slice(end));
  return [...out, ""].join(eol);
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
