/**
 * A bounded Git workspace for one sandboxed session, and the only way back.
 *
 * A sandboxed worker never sees the host repository. It gets a standalone
 * clone of its claim's branch at the exact dispatched head, under
 * `.pathfinder/sandboxes/<key>/<runId>/workspace`: no remote, no hardlinks or
 * alternates into the host's object store, and its inputs staged under
 * `.pathfinder-sandbox/in/`. Everything it hands back is a file under
 * `.pathfinder-sandbox/out/`.
 *
 * Once the agent has run, the workspace is agent-written, and so is its
 * `.git`: its config can name an fsmonitor, a hooks path, a filter, a
 * pager — any of which the host would execute the moment it ran Git there.
 * So the host never does. `collectWorkspace` reads output files without
 * following links, bounded in size, validates each, and imports commits only
 * by fetching a copied Git bundle *from inside the claim worktree*: reading a
 * bundle reads only the bundle, never the repository it came from. The import
 * is a fast-forward of the dispatched head, for a session allowed to commit,
 * into the registered claim worktree still clean at that head — or it is
 * refused.
 *
 * Everything the sandbox produces is untrusted input, and ancestry alone is
 * not authorization: before the fast-forward, every imported commit is read
 * from the claim worktree (the trusted repository) and refused if it merges,
 * adds a gitlink, a symlink out of the repository, a `.git` or `..` path
 * component, or touches a host-owned path; its state may move only toward the
 * next host-checked stage. Imported commits are unverified work: collecting
 * never marks a ticket reviewed or done.
 *
 * Every command goes through an injected runner,
 * `run(argv, {cwd}) → {status, signal, stdout, stderr, error}`, with `argv[0]`
 * the executable and no shell.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path, { dirname, join, posix, resolve } from "node:path";

import { PROTOCOLS } from "./brief.mjs";
import { claimFor } from "./claims.mjs";
import { validateExperimentReport } from "./experiments.mjs";
import { validateFindingsReport } from "./findings.mjs";
import { isKey } from "./keys.mjs";
import { within } from "./scratch.mjs";
import { WRITABLE } from "./statefile.mjs";

export const SANDBOXES_DIR = ".pathfinder/sandboxes";
/** The workspace's I/O directory: `in/` host → sandbox, `out/` sandbox → host. */
export const SANDBOX_IO_DIR = ".pathfinder-sandbox";
export const RESULT_SCHEMA = "pathfinder.sandbox-result/1";
export const OUTCOMES = Object.freeze(["DONE", "GATE", "FAILED", "EXPERIMENTS", "PASS", "FINDINGS"]);
/** The files collect reads from `out/`, and the most bytes each may hold. */
export const OUTPUT_LIMITS = Object.freeze({
  "result.json": 16 * 1024,
  "state.json": 16 * 1024,
  "experiments.json": 32 * 1024,
  "findings.json": 32 * 1024,
  "branch.bundle": 64 * 1024 * 1024,
});
/** Where an import holds the fetched tip until the fast-forward; deleted on every path. */
export const IMPORT_REF_PREFIX = "refs/pathfinder/sandbox-import/";
/** The most commits one session may bring back. */
export const MAX_IMPORT_COMMITS = 100;
/**
 * Host-owned paths an imported commit may not add, change, or delete. A
 * trailing `/` names a directory and everything under it. Matched without
 * regard to case, as a case-insensitive filesystem would check them out.
 */
export const PROTECTED_PATHS = Object.freeze([
  ".gitignore",
  "context/execution-mode.md",
  "context/tracker.md",
  ".pathfinder/",
  ".github/",
  ".claude/",
  ".codex/",
  ".agents/",
]);
/** The state-file fields a sandboxed session may propose; every other one is the host's. */
export const SANDBOX_STATE_FIELDS = Object.freeze(["State", "Gate", "Gate stage", "Failed stage", "Last", "Next"]);
/** The states it may propose: never review or done, because its work is unverified. */
export const SANDBOX_STATES = Object.freeze({ commits: Object.freeze(["adversary", "human-gate", "failed"]), noCommits: Object.freeze(["human-gate", "failed"]) });

const RUN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const LINE_BREAK = /[\r\n\u2028\u2029]/;
const MAX_TEXT = 2048;
const refuse = (message) => ({ ok: false, message });
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const singleLine = (value) => typeof value === "string" && value.trim() !== "" && value.length <= MAX_TEXT && !LINE_BREAK.test(value) && !value.includes("\0");

/** Spawn `argv` with no shell and a timeout. Never throws. */
export function defaultRun(argv, { cwd, env, timeout = 300_000 } = {}) {
  let result;
  try {
    result = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: "utf8", shell: false, timeout, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    return { status: null, signal: null, stdout: "", stderr: "", error };
  }
  return { status: result.status, signal: result.signal ?? null, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error ?? null };
}

function gitIn(run, cwd, args) {
  const result = run(["git", ...args], { cwd });
  const stderr = String(result.stderr ?? "").trim();
  const ok = result.status === 0 && !result.error;
  const message = result.error?.message || stderr || (result.signal ? `git ${args[0]} was stopped by ${result.signal}` : `git ${args[0]} exited with status ${result.status}`);
  return { ok, status: result.status, stdout: String(result.stdout ?? ""), message: ok ? "" : message };
}

const canonical = (target) => realpathSync.native(target);

/**
 * Why a workspace path cannot be handed to `sbx`, or null. `sbx` reads
 * `PATH:TARGET[:ro]`, so a `:` makes the mount ambiguous; a line break would
 * split any record or prompt that names the path.
 */
export function workspacePathProblem(workspace) {
  if (typeof workspace !== "string" || workspace === "") return "the workspace path is empty";
  if (workspace.includes(":")) return `workspace path ${JSON.stringify(workspace)} contains ":", which sbx reads as PATH:TARGET; move the repository to a path without ":"`;
  if (LINE_BREAK.test(workspace) || workspace.includes("\0")) return `workspace path ${JSON.stringify(workspace)} contains a line break; move the repository to a path without one`;
  return null;
}

function branchProblem(branch) {
  if (typeof branch !== "string" || branch === "" || branch.startsWith("-") || /[\s\0~^:?*[\\]|\.\.|@\{|\.lock$|\/$|^\//.test(branch)) {
    return `\`${branch}\` is not a branch name`;
  }
  return null;
}

/** Why an input's relative path could escape `in/`, or null. */
export function inputPathProblem(name) {
  if (typeof name !== "string" || name === "") return "an input path must be a non-empty string";
  if (name.includes("\0") || LINE_BREAK.test(name)) return `input path ${JSON.stringify(name)} contains a control character`;
  if (name.includes("\\")) return `input path ${JSON.stringify(name)} must use forward slashes`;
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || path.isAbsolute(name)) return `input path ${JSON.stringify(name)} is absolute; inputs live under ${SANDBOX_IO_DIR}/in/`;
  if (name.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return `input path ${JSON.stringify(name)} could escape ${SANDBOX_IO_DIR}/in/`;
  return null;
}

/**
 * The claim worktree on `branch`, clean, and its head. Runs Git in the host's
 * own worktree, never in a workspace.
 */
function worktreeAt(run, worktree, branch) {
  const on = gitIn(run, worktree, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const current = on.ok ? on.stdout.trim() : "a detached HEAD";
  if (current !== branch) return refuse(`claim worktree ${worktree} is on ${current}, not ${branch}`);
  const status = gitIn(run, worktree, ["status", "--porcelain", "--untracked-files=all"]);
  if (!status.ok) return refuse(`cannot read the status of ${worktree}: ${status.message}`);
  if (status.stdout.trim() !== "") return refuse(`claim worktree ${worktree} has uncommitted changes; commit or remove them first`);
  const head = gitIn(run, worktree, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (!head.ok) return refuse(`cannot read the head of ${worktree}: ${head.message}`);
  return { ok: true, head: head.stdout.trim() };
}

function sandboxesRefusal(run, root) {
  const ignored = gitIn(run, root, ["check-ignore", "-q", "--", `${SANDBOXES_DIR}/workspace`]);
  return ignored.ok ? null : "`.pathfinder/` is not ignored by Git; add `/.pathfinder/` to .gitignore before preparing a sandbox workspace";
}

/**
 * Prepare a fresh workspace for one sandboxed session.
 *
 * `inputs` maps a relative path under `.pathfinder-sandbox/in/` to its
 * content: the brief, the ticket, and the named context files.
 *
 * @returns {{ok: true, runDir: string, workspace: string, dispatchedHead: string, session: string} | {ok: false, message: string}}
 */
export function prepareWorkspace({ root, key, worktree, branch, session, runId, inputs = {}, run = defaultRun }) {
  if (!isKey(key)) return refuse(`\`${key}\` is not a ticket key`);
  if (typeof session !== "string" || !Object.hasOwn(PROTOCOLS, session)) return refuse(`session must be one of ${Object.keys(PROTOCOLS).join(", ")}, not \`${session}\``);
  if (typeof runId !== "string" || !RUN_ID.test(runId)) return refuse(`run id \`${runId}\` is not YYYYMMDDTHHMMSSZ-<8 hex>`);
  const badBranch = branchProblem(branch);
  if (badBranch) return refuse(badBranch);
  if (!plainObject(inputs)) return refuse("inputs must map relative paths to file contents");
  for (const [name, content] of Object.entries(inputs)) {
    const problem = inputPathProblem(name);
    if (problem) return refuse(problem);
    if (typeof content !== "string" && !(content instanceof Uint8Array)) return refuse(`input ${JSON.stringify(name)} must be text or bytes`);
  }

  let hostRoot;
  let worktreePath;
  try {
    hostRoot = canonical(root);
    worktreePath = canonical(resolve(hostRoot, worktree));
  } catch {
    return refuse(`claim worktree ${worktree} does not exist`);
  }
  const ignored = sandboxesRefusal(run, hostRoot);
  if (ignored) return refuse(ignored);

  const runDir = join(hostRoot, ...SANDBOXES_DIR.split("/"), key, runId);
  const workspace = join(runDir, "workspace");
  const unsafe = workspacePathProblem(workspace);
  if (unsafe) return refuse(unsafe);
  if (existsSync(runDir)) return refuse(`${runDir} already exists; every session gets a fresh workspace`);

  const at = worktreeAt(run, worktreePath, branch);
  if (!at.ok) return at;
  const dispatchedHead = at.head;
  const identity = {};
  for (const name of ["user.name", "user.email"]) {
    const value = gitIn(run, worktreePath, ["config", "--get", name]);
    if (value.ok && value.stdout.trim()) identity[name] = value.stdout.trim();
  }

  mkdirSync(runDir, { recursive: true });
  const failed = (message) => {
    rmSync(runDir, { recursive: true, force: true });
    return refuse(message);
  };
  try {
    // Before the agent runs, the workspace is still ours to run Git in.
    const clone = gitIn(run, hostRoot, ["clone", "--quiet", "--no-local", "--no-hardlinks", "--single-branch", "--no-tags", "--branch", branch, "--", worktreePath, workspace]);
    if (!clone.ok) return failed(`cannot clone ${branch} into ${workspace}: ${clone.message}`);
    if (existsSync(join(workspace, ".git", "objects", "info", "alternates"))) return failed(`the clone at ${workspace} borrows objects through alternates; refusing it`);
    const head = gitIn(run, workspace, ["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!head.ok || head.stdout.trim() !== dispatchedHead) return failed(`${branch} moved from ${dispatchedHead} while it was cloned; prepare again`);
    const remotes = gitIn(run, workspace, ["remote"]);
    if (!remotes.ok) return failed(`cannot list the clone's remotes: ${remotes.message}`);
    for (const remote of remotes.stdout.split("\n").map((line) => line.trim()).filter(Boolean)) {
      const removed = gitIn(run, workspace, ["remote", "remove", remote]);
      if (!removed.ok) return failed(`cannot remove remote ${remote} from the clone: ${removed.message}`);
    }
    for (const [name, value] of Object.entries(identity)) {
      const set = gitIn(run, workspace, ["config", "--local", name, value]);
      if (!set.ok) return failed(`cannot set ${name} in the clone: ${set.message}`);
    }
    mkdirSync(join(workspace, ".git", "info"), { recursive: true });
    appendFileSync(join(workspace, ".git", "info", "exclude"), `\n/${SANDBOX_IO_DIR}/\n`);

    const inDir = join(workspace, SANDBOX_IO_DIR, "in");
    mkdirSync(inDir, { recursive: true });
    mkdirSync(join(workspace, SANDBOX_IO_DIR, "out"), { recursive: true });
    for (const [name, content] of Object.entries(inputs)) {
      const target = join(inDir, ...name.split("/"));
      if (within(inDir, target) === null) return failed(`input path ${JSON.stringify(name)} could escape ${SANDBOX_IO_DIR}/in/`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, { flag: "wx" });
    }
  } catch (error) {
    return failed(`cannot prepare ${workspace}: ${error.message}`);
  }
  return { ok: true, runDir, workspace, dispatchedHead, session };
}

/**
 * The argv that writes the session's commits to `out/branch.bundle`, run
 * inside the sandbox (or by a recovery `sbx exec`): every commit on `branch`
 * after the dispatched head. Interpret its result with `bundleOutcome`.
 */
export function bundleCommand({ workspace, branch, dispatchedHead }) {
  const unsafe = workspacePathProblem(workspace);
  if (unsafe) return refuse(unsafe);
  if (!path.isAbsolute(workspace)) return refuse(`workspace ${workspace} must be an absolute path`);
  const badBranch = branchProblem(branch);
  if (badBranch) return refuse(badBranch);
  if (typeof dispatchedHead !== "string" || !OBJECT_ID.test(dispatchedHead)) return refuse("dispatchedHead must be a full commit id");
  const bundle = join(workspace, SANDBOX_IO_DIR, "out", "branch.bundle");
  return { ok: true, bundle, argv: ["git", "-C", workspace, "bundle", "create", "--quiet", bundle, `${dispatchedHead}..refs/heads/${branch}`] };
}

/**
 * What a `bundleCommand` run produced. A session with no new commits gets no
 * bundle — Git refuses an empty one — and that is reported as "no commits",
 * not as a failure. Anything else unexpected is a failure.
 */
export function bundleOutcome(result) {
  if (result?.status === 0 && !result.error) return { ok: true, bundle: true, message: "bundle written" };
  const stderr = String(result?.stderr ?? "").trim();
  if (result?.status !== null && !result?.error && /empty bundle/i.test(stderr)) return { ok: true, bundle: false, message: "no commits" };
  return refuse(`the bundle was not written: ${result?.error?.message || stderr || `exit status ${result?.status}`}`);
}

/**
 * Read one output file: a regular file, never through a link, with no other
 * hard link, and at most `limit` bytes.
 */
function readBounded(file, name, limit) {
  let stats;
  try { stats = lstatSync(file); } catch (error) { return refuse(`cannot read ${name}: ${error.message}`); }
  if (stats.isSymbolicLink()) return refuse(`${name} is a symlink; outputs must be regular files`);
  if (!stats.isFile()) return refuse(`${name} is not a regular file`);
  if (stats.nlink > 1) return refuse(`${name} has another hard link; outputs must be their own files`);
  if (stats.size > limit) return refuse(`${name} is ${stats.size} bytes, over its ${limit}-byte limit`);
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.ino !== stats.ino || opened.dev !== stats.dev) return refuse(`${name} changed while it was read`);
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length <= limit) {
      const read = readSync(fd, buffer, length, limit + 1 - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > limit) return refuse(`${name} is over its ${limit}-byte limit`);
    return { ok: true, bytes: buffer.subarray(0, length) };
  } catch (error) {
    return refuse(`cannot read ${name}: ${error.code === "ELOOP" ? "it is a symlink" : error.message}`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function parseJson(name, bytes) {
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return refuse(`${name} is not valid UTF-8 JSON`); }
  return plainObject(value) ? { ok: true, value } : refuse(`${name} must be a JSON object`);
}

/** Problems with a `pathfinder.sandbox-result/1` document. */
export function resultErrors(result) {
  if (!plainObject(result)) return ["result.json must be an object"];
  const errors = [];
  for (const field of Object.keys(result)) if (!["schema", "outcome", "message", "head"].includes(field)) errors.push(/^[a-z_]{1,32}$/.test(field) ? `unknown result field: ${field}` : "an unknown result field");
  if (result.schema !== RESULT_SCHEMA) errors.push(`schema must be ${RESULT_SCHEMA}`);
  if (!OUTCOMES.includes(result.outcome)) errors.push(`outcome must be one of ${OUTCOMES.join(", ")}`);
  if (!singleLine(result.message)) errors.push(`message must be one non-empty line of at most ${MAX_TEXT} characters`);
  if (result.head !== undefined && (typeof result.head !== "string" || !OBJECT_ID.test(result.head))) errors.push("head must be a full commit id");
  return errors;
}

/**
 * Problems with a `state.json`: only `SANDBOX_STATE_FIELDS`, each one line,
 * and a State the session may propose. The review, repair and adversary
 * fields are host-owned and refused.
 */
export function stateErrors(state, { allowCommits = false } = {}) {
  if (!plainObject(state)) return ["state.json must be an object"];
  const errors = [];
  const states = allowCommits ? SANDBOX_STATES.commits : SANDBOX_STATES.noCommits;
  for (const [field, value] of Object.entries(state)) {
    const named = field.length <= 32 && /^[A-Za-z ]+$/.test(field);
    if (WRITABLE.includes(field) && !SANDBOX_STATE_FIELDS.includes(field)) { errors.push(`state field \`${field}\` is host-owned; a sandboxed session may not set it`); continue; }
    if (!SANDBOX_STATE_FIELDS.includes(field)) { errors.push(named ? `state field \`${field}\` is not one the engine writes` : "a state field the engine does not write"); continue; }
    if (!singleLine(value)) errors.push(`state field \`${field}\` must be one non-empty line of at most ${MAX_TEXT} characters`);
    else if (field === "State" && !states.includes(value)) errors.push(`State from this session must be one of ${states.join(", ")}, not \`${value}\``);
  }
  return errors;
}

/** Why an imported path is refused, or null: a `.git` or `..` component, or a host-owned path. */
export function importPathProblem(file) {
  const segments = String(file).split("/");
  if (segments.some((segment) => /^\.git[. ]*$/i.test(segment) || /^git~\d+$/i.test(segment))) return `${JSON.stringify(file)} has a .git component`;
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) return `${JSON.stringify(file)} has a "..", "." or empty component`;
  const lower = file.toLowerCase();
  const owned = PROTECTED_PATHS.find((entry) => (entry.endsWith("/") ? lower.startsWith(entry) : lower === entry));
  return owned ? `${JSON.stringify(file)} is host-owned (${owned})` : null;
}

/** Why a symlink at `file` pointing at `target` is refused, or null. */
export function symlinkProblem(file, target) {
  if (target === "" || target.includes("\0")) return `symlink ${JSON.stringify(file)} has an empty or binary target`;
  const forward = target.replace(/\\/g, "/");
  if (forward.startsWith("/") || /^[A-Za-z]:/.test(forward)) return `symlink ${JSON.stringify(file)} points at absolute ${JSON.stringify(target)}`;
  const landed = posix.normalize(posix.join(posix.dirname(file), forward));
  if (landed === ".." || landed.startsWith("../")) return `symlink ${JSON.stringify(file)} escapes the repository through ${JSON.stringify(target)}`;
  if (landed.split("/").some((segment) => /^\.git[. ]*$/i.test(segment))) return `symlink ${JSON.stringify(file)} points into .git`;
  return null;
}

function reportFits(name, report, validate, key, dispatchedHead) {
  const checked = validate(report);
  if (!checked.ok) return refuse(`${name} is invalid: ${checked.errors.join("; ")}`);
  if (report.ticket !== key) return refuse(`${name} is for ${report.ticket}, not ${key}`);
  if (report.head_sha.toLowerCase() !== dispatchedHead) return refuse(`${name} reviews ${report.head_sha}, not the dispatched head ${dispatchedHead}`);
  return { ok: true };
}

/** The canonical run directory, refused unless it is `.pathfinder/sandboxes/<key>/<runId>` under `root`. */
function resolveRunDir(hostRoot, key, runDir) {
  let canonicalRun;
  let base;
  try {
    if (lstatSync(runDir).isSymbolicLink()) return refuse(`${runDir} is a symlink; name the run directory itself`);
    canonicalRun = canonical(runDir);
    base = canonical(join(hostRoot, ...SANDBOXES_DIR.split("/")));
  } catch {
    return refuse(`${runDir} is not a sandbox run directory`);
  }
  const rel = within(base, canonicalRun);
  const parts = rel === null ? [] : rel.split(/[\\/]/);
  if (parts.length !== 2 || parts[0] !== key || !RUN_ID.test(parts[1])) return refuse(`${runDir} is not a run directory under ${SANDBOXES_DIR}/${key}/`);
  return { ok: true, path: canonicalRun, runId: parts[1] };
}

/** A directory inside the workspace, refused if it is a link or anything but a directory. */
function realDirectory(dir, label) {
  let stats;
  try { stats = lstatSync(dir); } catch { return refuse(`${label} does not exist`); }
  if (stats.isSymbolicLink()) return refuse(`${label} is a symlink; refusing to follow it`);
  if (!stats.isDirectory()) return refuse(`${label} is not a directory`);
  return { ok: true };
}

/**
 * Bring one sandboxed session's results back to the host.
 *
 * Reads and validates every output first; only then, and only when
 * `allowCommits`, imports `branch.bundle` as a fast-forward of the claim
 * branch. A bundle from a session that may not commit is refused. No Git
 * command ever runs with the workspace as its repository or directory.
 *
 * @returns {{ok: true, result: object, state: object|null, experiments: object|null, findings: object|null,
 *            commits: {imported: boolean, from?: string, to?: string, reason?: string}, ignored: string[]} | {ok: false, message: string}}
 */
export function collectWorkspace({ root, key, runDir, worktree, branch, dispatchedHead, allowCommits, limits = OUTPUT_LIMITS, maxCommits = MAX_IMPORT_COMMITS, run = defaultRun }) {
  if (!isKey(key)) return refuse(`\`${key}\` is not a ticket key`);
  const badBranch = branchProblem(branch);
  if (badBranch) return refuse(badBranch);
  if (typeof dispatchedHead !== "string" || !OBJECT_ID.test(dispatchedHead)) return refuse("dispatchedHead must be the full commit id the session was dispatched at");
  if (typeof allowCommits !== "boolean") return refuse("allowCommits must be stated: true only for a session that may commit");

  let hostRoot;
  let worktreePath;
  try {
    hostRoot = canonical(root);
    worktreePath = canonical(resolve(hostRoot, worktree));
  } catch {
    return refuse(`claim worktree ${worktree} does not exist`);
  }
  // The worktree must be the one the engine records as this key's claim, on
  // this branch: a caller cannot point the import at any other checkout.
  const claim = claimFor(hostRoot, key);
  if (!claim || claim.orphan || !claim.worktree) return refuse(`${key} has no registered claim worktree; nothing was collected`);
  let claimed;
  try { claimed = canonical(resolve(hostRoot, claim.worktree)); } catch { claimed = null; }
  if (claimed !== worktreePath) return refuse(`${worktreePath} is not the registered claim worktree for ${key} (${claim.worktree}); nothing was collected`);
  if (claim.branch !== branch) return refuse(`the claim worktree for ${key} is on ${claim.branch ?? "no branch"}, not ${branch}; nothing was collected`);

  const found = resolveRunDir(hostRoot, key, runDir);
  if (!found.ok) return found;
  // Every Git command below runs in the claim worktree. It must not be, or
  // be inside, the agent-written run.
  if (worktreePath === found.path || within(found.path, worktreePath) !== null) return refuse(`claim worktree ${worktreePath} lies inside the sandbox run; refusing to run Git there`);

  const workspace = join(found.path, "workspace");
  const outDir = join(workspace, SANDBOX_IO_DIR, "out");
  for (const [dir, label] of [[workspace, "the workspace"], [join(workspace, SANDBOX_IO_DIR), SANDBOX_IO_DIR], [outDir, `${SANDBOX_IO_DIR}/out`]]) {
    const checked = realDirectory(dir, label);
    if (!checked.ok) return checked;
  }

  const files = {};
  const ignored = [];
  for (const name of readdirSync(outDir).sort()) {
    if (!Object.hasOwn(limits, name)) { ignored.push(name); continue; }
    const read = readBounded(join(outDir, name), name, limits[name]);
    if (!read.ok) return read;
    files[name] = read.bytes;
  }

  if (!files["result.json"]) return refuse(`${SANDBOX_IO_DIR}/out/result.json is missing; the session reported no result`);
  const parsed = {};
  for (const name of ["result.json", "state.json", "experiments.json", "findings.json"]) {
    if (!files[name]) continue;
    const json = parseJson(name, files[name]);
    if (!json.ok) return json;
    parsed[name] = json.value;
  }
  const resultProblems = resultErrors(parsed["result.json"]);
  if (resultProblems.length) return refuse(`result.json is invalid: ${resultProblems.join("; ")}`);
  if (parsed["state.json"]) {
    const problems = stateErrors(parsed["state.json"], { allowCommits });
    if (problems.length) return refuse(`state.json is invalid: ${problems.join("; ")}`);
  }
  if (parsed["experiments.json"]) {
    const fits = reportFits("experiments.json", parsed["experiments.json"], validateExperimentReport, key, dispatchedHead);
    if (!fits.ok) return fits;
  }
  if (parsed["findings.json"]) {
    const fits = reportFits("findings.json", parsed["findings.json"], validateFindingsReport, key, dispatchedHead);
    if (!fits.ok) return fits;
  }

  const result = parsed["result.json"];
  const outputs = { result, state: parsed["state.json"] ?? null, experiments: parsed["experiments.json"] ?? null, findings: parsed["findings.json"] ?? null, ignored };
  const bundle = files["branch.bundle"];
  if (bundle && !allowCommits) return refuse("branch.bundle came from a session that may not commit; it is refused, not ignored, and nothing was imported");
  if (!bundle) {
    if (result.head !== undefined && result.head !== dispatchedHead) return refuse(`result.json names head ${result.head}, but there is no bundle and the dispatched head is ${dispatchedHead}`);
    return { ok: true, ...outputs, commits: { imported: false, reason: allowCommits ? "no commits" : "this session may not commit" } };
  }

  const imported = importBundle({ run, runPath: found.path, runId: found.runId, key, worktree: worktreePath, branch, dispatchedHead, bundle, claimedHead: result.head, maxCommits });
  if (!imported.ok) return imported;
  return { ok: true, ...outputs, commits: imported.commits };
}

/**
 * Every problem with the commits `dispatchedHead..tip`, read from the claim
 * worktree after the fetch and before the fast-forward.
 */
function rangeProblems(host, dispatchedHead, tip, maxCommits) {
  const listed = host(["rev-list", "--parents", "--reverse", `${dispatchedHead}..${tip}`]);
  if (!listed.ok) return [`cannot list the imported commits: ${listed.message}`];
  const commits = listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => line.split(" "));
  if (commits.length > maxCommits) return [`${commits.length} commits, over the ${maxCommits}-commit limit`];
  const problems = [];
  for (const [commit, ...parents] of commits) {
    if (parents.length !== 1) { problems.push(`commit ${commit} ${parents.length ? "is a merge commit" : "has no parent"}`); continue; }
    const diff = host(["diff-tree", "-r", "-z", "--raw", "--no-renames", "--no-abbrev", parents[0], commit]);
    if (!diff.ok) { problems.push(`cannot read commit ${commit}: ${diff.message}`); continue; }
    const fields = diff.stdout.split("\0");
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const [oldMode, newMode, , newId] = fields[index].replace(/^:/, "").split(" ");
      const file = fields[index + 1];
      if (oldMode === "160000" || newMode === "160000") problems.push(`commit ${commit}: ${JSON.stringify(file)} is a gitlink`);
      const pathProblem = importPathProblem(file);
      if (pathProblem) problems.push(`commit ${commit}: ${pathProblem}`);
      if (newMode === "120000") {
        const target = host(["cat-file", "blob", newId]);
        const linkProblem = target.ok ? symlinkProblem(file, target.stdout) : `cannot read symlink ${JSON.stringify(file)}`;
        if (linkProblem) problems.push(`commit ${commit}: ${linkProblem}`);
      }
    }
  }
  return problems;
}

/**
 * Fast-forward the claim branch from a bundle's bytes. The bytes are copied
 * into the run directory, outside the agent-written workspace, and every Git
 * command runs in the claim worktree. A refusal leaves the branch where it
 * was, deletes the temporary ref, and keeps the copy for inspection.
 */
function importBundle({ run, runPath, runId, key, worktree, branch, dispatchedHead, bundle, claimedHead, maxCommits }) {
  const host = (args) => gitIn(run, worktree, args);
  const copy = join(runPath, `branch-${randomBytes(4).toString("hex")}.bundle`);
  const reject = (message) => existsSync(copy)
    ? { ok: false, message: `${message}; nothing was imported, and the bundle is kept at ${copy}`, preserved: copy }
    : refuse(`${message}; nothing was imported`);
  const tempRef = `${IMPORT_REF_PREFIX}${key}/${runId}`;
  let fetched = false;
  let imported = false;
  try {
    writeFileSync(copy, bundle, { flag: "wx" });

    const before = worktreeAt(run, worktree, branch);
    if (!before.ok) return reject(before.message);
    if (before.head !== dispatchedHead) return reject(`claim worktree moved from the dispatched head ${dispatchedHead} to ${before.head}`);

    const verified = host(["bundle", "verify", "--quiet", copy]);
    if (!verified.ok) return reject(`branch.bundle does not verify against the claim worktree: ${verified.message}`);
    const heads = host(["bundle", "list-heads", copy]);
    if (!heads.ok) return reject(`cannot list branch.bundle's heads: ${heads.message}`);
    const wanted = `refs/heads/${branch}`;
    const refs = heads.stdout.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => line.split(/\s+/));
    if (refs.length !== 1 || refs[0].length !== 2 || refs[0][1] !== wanted || !OBJECT_ID.test(refs[0][0])) {
      return reject(`branch.bundle must carry exactly one ref, ${wanted}; it carries ${refs.map((ref) => ref.slice(1).join(" ") || "an unnamed head").join(", ") || "none"}`);
    }
    const tip = refs[0][0];
    if (tip === dispatchedHead) {
      if (claimedHead !== undefined && claimedHead !== dispatchedHead) return reject(`result.json names head ${claimedHead}, but the bundle's ${branch} is the dispatched head`);
      imported = true;
      return { ok: true, commits: { imported: false, reason: "no commits" } };
    }
    if (claimedHead !== undefined && claimedHead !== tip) return reject(`result.json names head ${claimedHead}, but the bundle's ${branch} is ${tip}`);
    if (host(["rev-parse", "--verify", "--quiet", tempRef]).ok) return reject(`${tempRef} already exists; an earlier import of this run was interrupted`);

    fetched = true;
    const fetch = host(["-c", "fetch.fsckObjects=true", "-c", "transfer.fsckObjects=true", "-c", "gc.auto=0",
      "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--no-recurse-submodules", "--no-auto-maintenance",
      copy, `${wanted}:${tempRef}`]);
    if (!fetch.ok) return reject(`cannot fetch branch.bundle into the claim worktree: ${fetch.message}`);
    const got = host(["rev-parse", "--verify", `${tempRef}^{commit}`]);
    if (!got.ok || got.stdout.trim() !== tip) return reject("the fetched tip is not the bundle's");

    const ancestor = host(["merge-base", "--is-ancestor", dispatchedHead, tip]);
    if (ancestor.status === 1) return reject(`the bundle's ${branch} (${tip}) does not descend from the dispatched head ${dispatchedHead}`);
    if (!ancestor.ok) return reject(`cannot check ancestry: ${ancestor.message}`);
    const problems = rangeProblems(host, dispatchedHead, tip, maxCommits);
    if (problems.length) return reject(`the imported commits are refused: ${problems.slice(0, 20).join("; ")}${problems.length > 20 ? `; and ${problems.length - 20} more` : ""}`);
    const count = Number(host(["rev-list", "--count", `${dispatchedHead}..${tip}`]).stdout.trim());

    const still = worktreeAt(run, worktree, branch);
    if (!still.ok || still.head !== dispatchedHead) return reject("claim worktree changed during the import");
    const merged = host(["merge", "--ff-only", "--quiet", "--no-stat", tip]);
    if (!merged.ok) return reject(`cannot fast-forward ${branch} to ${tip}: ${merged.message}`);
    const after = host(["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!after.ok || after.stdout.trim() !== tip) return reject(`${branch} did not reach ${tip} after the fast-forward`);
    imported = true;
    // Unverified work: the host's own Adversary and Tester judge it next.
    return { ok: true, commits: { imported: true, from: dispatchedHead, to: tip, count, verified: false } };
  } catch (error) {
    return reject(`cannot import branch.bundle: ${error.message}`);
  } finally {
    if (fetched) host(["update-ref", "-d", tempRef]);
    if (imported) rmSync(copy, { force: true });
  }
}
