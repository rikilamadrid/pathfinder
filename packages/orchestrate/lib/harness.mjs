/**
 * Shared machinery for the orchestrate engine's tests. Deliberately not under
 * `test/`: `node --test` runs every file it finds there, and a helper module
 * would be executed as a suite with no tests in it.
 *
 * Everything here builds a *real* Git repository and runs the *real* engine
 * CLI in a fresh process. The claim primitive is Git's own refusal to check a
 * branch out twice, so a test that stubbed Git would prove nothing about the
 * one property this engine exists to guarantee.
 *
 * The one stand-in is `gh`: a small Node script on disk that answers
 * `issue list --json` from a fixture file, so the GitHub store reader is
 * exercised through the same `spawnSync` path it uses against the real CLI.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
export const ENGINE_ROOT = join(REPO_ROOT, "skills", "orchestrate", "engine");
export const ENGINE_BIN = join(ENGINE_ROOT, "bin", "orchestrate.mjs");

const temporaryRoots = [];

export function temporaryDirectory(prefix = "orchestrate-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

export function cleanUpTemporaryDirectories() {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
}

/** A deterministic Git environment: no user config, fixed identity and dates. */
export function gitEnv(extra = {}) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: tmpdir(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

export function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, env: gitEnv(), encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * A local-Markdown ticket file in the shape `templates/ticket.template.md`
 * produces.
 */
export function ticketFile({ title, status = "Proposed", blockers = [] }) {
  const blockedBy = blockers.length === 0 ? "None" : blockers.map((key) => `- \`${key}\` — needs it`).join("\n");
  return [
    `# ${title}`,
    "",
    "## Status",
    "",
    status,
    "",
    "## Parent Feature",
    "",
    "`1-example.md`",
    "",
    "## Blocked by",
    "",
    blockedBy,
    "",
    "## Goal",
    "",
    "Something observable.",
    "",
  ].join("\n");
}

/**
 * A committed repository ready for orchestration, unless told otherwise.
 *
 * @param {object} [options]
 * @param {string|null} [options.mode] `orchestrator`, `human-in-the-loop`, raw
 *   file contents via `modeFile`, or null for no mode file
 * @param {boolean} [options.ignorePathfinder] add `/.pathfinder/` to .gitignore
 * @param {Record<string, {title: string, status?: string, blockers?: string[]}>} [options.tickets]
 * @param {string} [options.tracker] contents of `context/tracker.md`, if any
 */
export function makeProject({
  mode = "orchestrator",
  modeFile = null,
  ignorePathfinder = true,
  tickets = {},
  tracker = null,
} = {}) {
  const root = temporaryDirectory("orchestrate-project-");
  runGit(["init", "--quiet", "--initial-branch=main"], root);

  mkdirSync(join(root, "context", "tickets"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# project\n");

  const ignore = ["/context/current-ticket.md"];
  if (ignorePathfinder) ignore.push("/.pathfinder/");
  writeFileSync(join(root, ".gitignore"), ignore.join("\n") + "\n");

  if (modeFile !== null) {
    writeFileSync(join(root, "context", "execution-mode.md"), modeFile);
  } else if (mode !== null) {
    writeFileSync(
      join(root, "context", "execution-mode.md"),
      `# Execution Mode\n\n<!-- pathfinder:execution-mode ${mode} -->\n`,
    );
  }

  for (const [key, ticket] of Object.entries(tickets)) {
    writeFileSync(join(root, "context", "tickets", `${key}-${key.replace(".", "-")}.md`), ticketFile(ticket));
  }

  if (tracker !== null) writeFileSync(join(root, "context", "tracker.md"), tracker);

  runGit(["add", "-A"], root);
  runGit(["commit", "--quiet", "-m", "initial"], root);
  return root;
}

/** Rewrite one local ticket's status and commit it, as `ticket complete` would. */
export function setTicketStatus(root, key, ticket) {
  writeFileSync(join(root, "context", "tickets", `${key}-${key.replace(".", "-")}.md`), ticketFile(ticket));
  runGit(["commit", "--quiet", "-am", `ticket ${key}: ${ticket.status}`], root);
}

/**
 * Run the engine CLI in a fresh process.
 *
 * `cwd` defaults to the project root; pass a worktree to run it the way a
 * worker session would.
 */
export function orchestrate(args, { root, cwd = root, env = {} } = {}) {
  const result = spawnSync(process.execPath, [ENGINE_BIN, ...args], {
    cwd,
    env: gitEnv(env),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Parse the engine's `--json` output, failing loudly when it is not JSON. */
export function json(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`expected JSON (exit ${result.status})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}

/**
 * A fake `gh` that answers `issue list` from `issues`, and records its argv.
 *
 * @param {object[]} issues the JSON `gh issue list --json ...` would print
 * @returns {{path: string, calls: string}} the executable, and the file its
 *   invocations are appended to
 */
export function fakeGh(issues, { status = 0, stderr = "" } = {}) {
  const directory = temporaryDirectory("orchestrate-gh-");
  const fixture = join(directory, "issues.json");
  const calls = join(directory, "calls.log");
  writeFileSync(fixture, JSON.stringify(issues));
  const script = join(directory, "gh");
  writeFileSync(
    script,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs");',
      `fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
      `if (${status} !== 0) { process.stderr.write(${JSON.stringify(stderr)}); process.exit(${status}); }`,
      `process.stdout.write(fs.readFileSync(${JSON.stringify(fixture)}, "utf8"));`,
      "",
    ].join("\n"),
  );
  chmodSync(script, 0o755);
  return { path: script, calls };
}

/** An issue in the shape `gh issue list --json number,title,state,labels,body` prints. */
export function issue({ number, key, title, state = "OPEN", labels = [], blockers = [] }) {
  const blockedBy = blockers.length === 0 ? "None" : blockers.map((b) => `- \`${b}\` — needs it`).join("\n");
  return {
    number,
    title: `${key} — ${title}`,
    state,
    labels: labels.map((name) => ({ name })),
    body: `<!-- pathfinder:ticket ${key} -->\n\n## Blocked by\n\n${blockedBy}\n\n## Goal\n\nSomething.\n`,
  };
}
