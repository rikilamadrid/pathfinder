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
 * The claim worktree's own configuration is the host's, but it can name
 * programs inside the tracked tree, which an import rewrites. So every Git
 * command collect runs there goes through `hostGit`, and during collect no
 * hook runs — not from the hooks directory, a `core.hooksPath`, or a
 * `hook.<name>` the configuration declares, each switched off by name — and
 * no fsmonitor, the host's own versions included; nor a pager, automatic gc
 * or maintenance, or submodule recursion. No filter driver runs on a path
 * the import writes: such a path is refused before checkout. The host's own
 * filter may still run on the host's own files — the clean
 * filter `git status` applies before checkout, or the smudge that restores a
 * filtered file the import deletes after a failed checkout, once every other
 * file is the host's again. And a file the host's configuration reads from
 * the claim worktree — an `include.path` or `includeIf` target,
 * `core.attributesFile`, `core.excludesFile` — is host-owned, so every
 * command collect runs reads the configuration the host had before the
 * import. So is a file the host's Git runs or reads to verify a signature
 * (`gpg.program` and each format's program, when it names a path, and the SSH
 * format's allowed-signers and revocation files): when the host sets
 * `merge.verifySignatures`, the fast-forward runs the host's verifier for the
 * format the tip's signature declares — once, twice for SSH — on the
 * sandbox's commit before it checks anything out, a host program reading
 * untrusted input, and no import can change a verifier or signers file the
 * configuration names in the claim worktree (a bare program name is found on
 * the host's `PATH`, which collect does not inspect). What this does not
 * cover: the host's own later Git commands in the claim worktree read that
 * configuration as it is, and run the imported version of any other program
 * it names in the tracked tree — a hooks path, an fsmonitor, a configured
 * hook, a filter's script.
 *
 * Everything the sandbox produces is untrusted input, and ancestry alone is
 * not authorization: before the fast-forward, every imported commit is read
 * from the claim worktree (the trusted repository) and refused if it merges,
 * adds a gitlink, a symlink that could lead out of the repository, a `.git` or
 * `..` path component, or touches a host-owned path — compared as a case- and
 * normalization-insensitive filesystem would check it out; a tip whose paths
 * such a filesystem would fold onto each other is refused too, when the import
 * brings that pair. The import never replaces a file Git does not track in the
 * claim worktree — an ignored state file, `.env` or `.pathfinder/` evidence —
 * and its state may move only toward the next host-checked stage. Imported
 * commits are unverified work: collecting never marks a ticket reviewed or
 * done.
 *
 * Ignore rules and attributes are host-owned at every depth. An ignore file
 * (`.gitignore`, root or nested) decides which host files Git leaves alone —
 * the claim's state file, a `.env` — and an attribute file (`.gitattributes`)
 * decides how the host checks files out: through which filter program, with
 * which conversions. So an import that adds, changes or deletes either is
 * refused, whatever it contains. A ticket that needs such a change gets it
 * from the host: the coordinator or the human commits it on the claim branch
 * outside the sandbox, before or after the sandboxed session.
 *
 * The import is bounded before anything reaches the claim worktree, by
 * separate limits, each refused by name with the measured value: the
 * compressed bundle (`OUTPUT_LIMITS["branch.bundle"]`), the commit count
 * (`MAX_IMPORT_COMMITS`), the expanded object data the commits bring
 * (`MAX_IMPORT_OBJECT_BYTES`), and what the fast-forward would write into the
 * worktree (`MAX_IMPORT_WRITTEN_PATHS`, `MAX_IMPORT_WRITTEN_BYTES`). A small
 * bundle can expand far: zlib packs a run of zeros a thousandfold, one blob
 * can be checked out at many paths, and the host's own checkout attributes
 * grow a file as it is written — `ident` almost twelvefold, a
 * `working-tree-encoding` of UTF-32 fourfold. So written bytes are bounded
 * after the worst-case growth of the attributes that apply to each path, and a
 * path the host would check out through a configured filter driver, an
 * external program, is refused. Fetching the bundle already inflates
 * each object once to verify it, bounded only by the compressed limit and the
 * runner's timeout; a refused import leaves its objects unreachable in the
 * object store until Git's garbage collection, and so does an accepted one for
 * any object its pack carries that no imported commit reaches. Every listing
 * is read whole, up to `MAX_COMMAND_OUTPUT`: a larger one is refused, never
 * truncated, which makes a repository of roughly 140,000 tracked paths (at
 * about 70 bytes a path) too large to import into.
 *
 * A name no supported filesystem can hold — not valid UTF-8, a component over
 * `MAX_NAME_BYTES`, a path over `MAX_PATH_BYTES` — and a symlink target over
 * `MAX_PATH_BYTES`, which no supported host can create, are refused before
 * checkout too. When the fast-forward still fails partway (a full disk, a
 * directory it may not write), Git leaves the branch and the index where they
 * were but not the files it already wrote, and on a case- or
 * normalization-insensitive filesystem not always the spelling of a directory
 * it removed and created again. So collect puts the claim worktree back
 * exactly as it was and proves it, name by name in every directory the import
 * touches (`restoreClaim`), before it says nothing was imported; or it says by
 * name what is not as it was, and never then that nothing was imported.
 *
 * Collect only once the sandbox has stopped and nothing can write the
 * workspace any more. Reads never follow a link and recheck the directories
 * they pass through, which narrows but cannot close the window a writer still
 * running could use to swap a directory for a link between a check and a read.
 *
 * Every command goes through an injected runner,
 * `run(argv, {cwd, input}) → {status, signal, stdout, stderr, error}`, with
 * `argv[0]` the executable, no shell, and `input`, when given, as its stdin.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readlinkSync, readSync, realpathSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
/**
 * What every Git command collect runs in the claim worktree is given, before
 * `hostGit` adds each configured hook by name: no hook from a hooks directory
 * (a hooks path inside the tracked tree, as husky sets one, would run the
 * imported `post-merge` the moment the fast-forward checks it out), no
 * fsmonitor (`status`, `ls-files` and the fast-forward itself query one
 * whenever they read the index), no pager, no automatic gc or maintenance
 * after the fetch or the fast-forward, and no recursion into submodules.
 */
const HOST_GIT = Object.freeze([
  "--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
  "-c", "gc.auto=0", "-c", "maintenance.auto=false", "-c", "submodule.recurse=false",
]);
/** The most commits one session may bring back. */
export const MAX_IMPORT_COMMITS = 100;
/**
 * The most bytes the objects an import brings may expand to: every commit,
 * tree and blob reachable from the bundle's tip and not from the dispatched
 * head, at full size. Four times the compressed bundle limit, so a full-size
 * bundle of ordinary source, which zlib packs a few times over, still fits,
 * and the bound holds however far a bundle was packed.
 */
export const MAX_IMPORT_OBJECT_BYTES = 256 * 1024 * 1024;
/**
 * The most files and links one fast-forward may write into the claim
 * worktree: the paths the tip adds or changes against the dispatched head,
 * which the claim already holds checked out.
 */
export const MAX_IMPORT_WRITTEN_PATHS = 20_000;
/**
 * The most bytes of file contents those writes may hold, as an upper bound of
 * what the checkout writes: a blob counts once for every path that uses it,
 * so one blob checked out at many paths counts each time, and a file counts
 * at the most the host's checkout attributes for its path can grow it —
 * `ident`, CRLF line endings, a UTF-16 or UTF-32 `working-tree-encoding`
 * (`checkoutGrowth`). A path whose growth cannot be bounded, or that the host
 * would check out through a configured filter driver, is refused outright, so
 * the bound holds for every file the fast-forward writes. An import cannot
 * change those attributes: attribute files are host-owned.
 */
export const MAX_IMPORT_WRITTEN_BYTES = 256 * 1024 * 1024;
/** The most output the default runner reads from one command; a larger listing is refused, never truncated. */
export const MAX_COMMAND_OUTPUT = 16 * 1024 * 1024;
/**
 * The longest name component, in UTF-8 bytes, an import may write: `NAME_MAX`
 * on APFS, ext4 and most other filesystems. A longer one fails the checkout
 * partway (`File name too long`), so it is refused before.
 */
export const MAX_NAME_BYTES = 255;
/**
 * The longest absolute path, in UTF-8 bytes, an import may write in the claim
 * worktree: one under macOS's `PATH_MAX` of 1,024, the smallest of the
 * supported hosts, so the checkout and every later tool can name it. Also the
 * longest target an imported symlink may hold: macOS's `symlink(2)` refuses a
 * longer one (`File name too long`), which would fail the checkout partway.
 */
export const MAX_PATH_BYTES = 1023;
/**
 * Host-owned paths an imported commit may not add, change, or delete. A
 * trailing `/` names a directory. Each entry is refused as itself, as
 * anything under it, and as a file or link standing where one of its leading
 * directories belongs: `.claude` as a link is `.claude/`, and `context` as a
 * link would hold `context/tracker.md`. Matched through `foldName`, as a case-
 * and normalization-insensitive filesystem would check them out. The claim's
 * own state files are here so a sandbox can never track them, even where the
 * host has none yet. Beyond this list, an ignore file and an attribute file
 * are host-owned at any depth: see `importPathProblem`.
 */
export const PROTECTED_PATHS = Object.freeze([
  ".gitignore",
  "context/execution-mode.md",
  "context/tracker.md",
  "context/current-ticket.md",
  "context/handoff.md",
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
/** Code points HFS+ ignores in names — the set Git's `core.protectHFS` skips. */
const HFS_IGNORABLE = /[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g;
/** Git's exact refusal of an empty bundle, as a whole line of its output. */
const EMPTY_BUNDLE = /^(?:fatal|error): Refusing to create empty bundle\.?$/m;

/**
 * A name as a case- and normalization-insensitive filesystem may check it
 * out: compatibility-normalized, HFS-ignorable code points dropped, and fully
 * case-folded. APFS folds `ſ` to `s`, `ﬁ` to `fi` and the Kelvin sign to `k`;
 * this folds at least that much, so a comparison through it refuses more
 * spellings than such a filesystem would merge, never fewer.
 */
export function foldName(text) {
  return String(text).normalize("NFKC").replace(HFS_IGNORABLE, "").toLowerCase().toUpperCase().toLowerCase().normalize("NFKC");
}

/** A path component that is, or that a filesystem could check out as, `.git`. */
function dotGit(segment) {
  const folded = foldName(segment);
  return /^\.git[. ]*$/.test(folded) || /^git~\d+$/.test(folded);
}

/**
 * A path component that is, or that a filesystem could check out as, an
 * ignore file: `.gitignore` in any spelling `foldName` merges, with the
 * trailing dots and spaces Windows drops, or one of its NTFS short names, as
 * Git's own `is_ntfs_dotgitignore` reads them.
 */
function ignoreFile(segment) {
  return /^(?:\.gitignore[. ]*|gitign~\d+|gi250a~\d+)$/.test(foldName(segment));
}

/**
 * A path component that is, or that a filesystem could check out as, an
 * attribute file: `.gitattributes` in the same spellings `ignoreFile` folds,
 * with the NTFS short names Git's own `is_ntfs_dotgitattributes` reads.
 */
function attributeFile(segment) {
  return /^(?:\.gitattributes[. ]*|gitatt~\d+|gi7d29~\d+)$/.test(foldName(segment));
}

/** Spawn `argv` with no shell and a timeout, `input` as its stdin when given. Never throws. */
export function defaultRun(argv, { cwd, env, input, timeout = 300_000 } = {}) {
  let result;
  try {
    result = spawnSync(argv[0], argv.slice(1), { cwd, env, input, encoding: "utf8", shell: false, timeout, windowsHide: true, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], maxBuffer: MAX_COMMAND_OUTPUT });
  } catch (error) {
    return { status: null, signal: null, stdout: "", stderr: "", error };
  }
  return { status: result.status, signal: result.signal ?? null, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error ?? null };
}

/** The Git subcommand in `args`, past the global options and each `-c` setting before it. */
function subcommand(args) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-c") index += 1;
    else if (!args[index].startsWith("-")) return args[index];
  }
  return "";
}

function gitIn(run, cwd, args, input) {
  const result = run(["git", ...args], input === undefined ? { cwd } : { cwd, input });
  const stderr = String(result.stderr ?? "").trim();
  const ok = result.status === 0 && !result.error;
  const name = subcommand(args);
  const overflow = result.error?.code === "ENOBUFS" ? `git ${name} printed more than the runner reads (${MAX_COMMAND_OUTPUT} bytes by default); the listing is refused, not truncated` : "";
  const message = overflow || result.error?.message || stderr || (result.signal ? `git ${name} was stopped by ${result.signal}` : `git ${name} exited with status ${result.status}`);
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
 * The claim worktree on `branch`, clean, and its head, through `git(args)` —
 * Git in the host's own worktree, never in a workspace.
 */
function worktreeAt(git, worktree, branch) {
  const on = git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const current = on.ok ? on.stdout.trim() : "a detached HEAD";
  if (current !== branch) return refuse(`claim worktree ${worktree} is on ${current}, not ${branch}`);
  const status = git(["status", "--porcelain", "--untracked-files=all"]);
  if (!status.ok) return refuse(`cannot read the status of ${worktree}: ${status.message}`);
  if (status.stdout.trim() !== "") return refuse(`claim worktree ${worktree} has uncommitted changes; commit or remove them first`);
  const head = git(["rev-parse", "--verify", "HEAD^{commit}"]);
  if (!head.ok) return refuse(`cannot read the head of ${worktree}: ${head.message}`);
  return { ok: true, head: head.stdout.trim() };
}

/**
 * Git in the claim worktree with nothing run that its configuration names:
 * `HOST_GIT`, and every hook the configuration declares at any scope
 * (`hook.<name>.command`, `.event`, `.enabled`) switched off by name, with
 * `hook.<name>.enabled=false` and its events cleared — a hooks path of
 * `/dev/null` does not reach those, and Git 2.54 runs them on `post-merge`,
 * `reference-transaction` and `post-index-change` like any hook. Reading the
 * configuration runs nothing. A name holding `=` cannot be given to `-c`,
 * which splits there, so it is refused, as is a configuration Git cannot read.
 *
 * Returns `git(args, input)`, the runner every import command goes through.
 */
function hostGit(run, worktree) {
  const listed = gitIn(run, worktree, [...HOST_GIT, "config", "-z", "--get-regexp", "^hook\\..+\\.[^.]+$"]);
  if (!listed.ok && listed.status !== 1) return refuse(`cannot read the host's hook configuration in the claim worktree: ${listed.message}`);
  const names = new Set();
  for (const record of listed.ok ? listed.stdout.split("\0") : []) {
    const newline = record.indexOf("\n");
    const key = newline === -1 ? record : record.slice(0, newline);
    const last = key.lastIndexOf(".");
    if (key.startsWith("hook.") && last > "hook.".length) names.add(key.slice("hook.".length, last));
  }
  const unsafe = [...names].find((name) => name.includes("="));
  if (unsafe !== undefined) return refuse(`the host's configuration declares hook ${JSON.stringify(unsafe)}, whose name holds "=", so it cannot be switched off on Git's command line for the import; rename that hook on the host`);
  const prefix = [...HOST_GIT, ...[...names].flatMap((name) => ["-c", `hook.${name}.enabled=false`, "-c", `hook.${name}.event=`])];
  return { ok: true, git: (args, input) => gitIn(run, worktree, [...prefix, ...args], input) };
}

/**
 * The keys whose values name a file Git reads as more configuration, or as
 * attribute or ignore rules, or runs or reads to verify a signature: the
 * program of each signature format and the SSH format's allowed-signers and
 * revocation files.
 */
const CONFIG_FILE_KEYS = "^(include\\.path|includeif\\..+\\.path|core\\.attributesfile|core\\.excludesfile|gpg\\.program|gpg\\.(openpgp|x509|ssh)\\.program|gpg\\.ssh\\.allowedsignersfile|gpg\\.ssh\\.revocationfile)$";
/** A signature program's key: Git runs its value, looked up on `PATH` when it is a bare name. */
const SIGNATURE_PROGRAM = /^gpg\.(?:(?:openpgp|x509|ssh)\.)?program$/;
/** Whether a program's value names a path, which Git runs as it resolves from the worktree's top, rather than a name it finds on `PATH`. */
const namesPath = (value) => (process.platform === "win32" ? /[\\/]/ : /\//).test(value);

/**
 * The claim-worktree paths standing for `target`: as it is spelled, once a
 * leading directory of it is the claim worktree, and as it resolves on disk
 * through its deepest existing directory. Both, so neither a link on its way
 * nor the file it reaches can change unseen.
 */
function claimSpellings(worktree, target) {
  const resolved = resolve(target);
  const { root: top } = path.parse(resolved);
  const parts = resolved.slice(top.length).split(path.sep).filter(Boolean);
  const found = new Set();
  for (let index = 0; index < parts.length; index += 1) {
    let real;
    try { real = canonical(join(top, ...parts.slice(0, index + 1))); } catch { break; }
    if (real === worktree) {
      if (index + 1 < parts.length) found.add(parts.slice(index + 1).join("/"));
      break;
    }
  }
  for (let index = parts.length; index >= 0; index -= 1) {
    let real;
    try { real = canonical(join(top, ...parts.slice(0, index))); } catch { continue; }
    const rel = within(worktree, join(real, ...parts.slice(index)));
    if (rel !== null) found.add(rel.split(path.sep).join("/"));
    break;
  }
  return [...found];
}

/**
 * Every file in the claim worktree the host's configuration reads as more
 * configuration — an `include.path` or `includeIf.<condition>.path` target,
 * every condition taken as met, nested includes too — or as attribute or
 * ignore rules (`core.attributesFile`, `core.excludesFile`), as
 * `{file, key}`. An import that wrote one would hand the next Git process
 * agent-written configuration: a hook, an fsmonitor, a filter. Git expands
 * `~` itself (`--type=path`); a relative include is relative to the file
 * holding it, a relative attribute or ignore file to the worktree's top.
 *
 * So is every file the host's Git runs or reads to verify a signature: the
 * program of each format (`gpg.program`, `gpg.openpgp.program`,
 * `gpg.x509.program`, `gpg.ssh.program`) when its value is a path, and
 * `gpg.ssh.allowedSignersFile` and `gpg.ssh.revocationFile`, each relative to
 * the worktree's top. Collect's own verification, when the host sets
 * `merge.verifySignatures`, runs before the checkout and so the host's
 * version; an import that rewrote one would make the host's next verification
 * run the sandbox's program, or trust its signers. A bare program name is
 * looked up on the host's `PATH`, which this does not inspect.
 */
function configFiles(host, worktree) {
  const listed = host(["config", "-z", "--show-origin", "--type=path", "--get-regexp", CONFIG_FILE_KEYS]);
  if (!listed.ok && listed.status !== 1) return refuse(`cannot read the host's configuration in the claim worktree: ${listed.message}`);
  const records = listed.ok ? listed.stdout.split("\0") : [];
  const files = [];
  for (let index = 0; index + 1 < records.length; index += 2) {
    const [origin, entry] = [records[index], records[index + 1]];
    const newline = entry.indexOf("\n");
    if (newline === -1 || newline === entry.length - 1) continue;
    const key = entry.slice(0, newline);
    const value = entry.slice(newline + 1);
    if (SIGNATURE_PROGRAM.test(key) && !namesPath(value)) continue; // A bare name: found on the host's PATH.
    let target;
    if (path.isAbsolute(value)) target = value;
    else if (!key.endsWith(".path")) target = resolve(worktree, value);
    else if (origin.startsWith("file:")) target = resolve(worktree, dirname(origin.slice("file:".length)), value);
    else continue; // Git refuses a relative include that no file holds.
    for (const file of claimSpellings(worktree, target)) files.push({ file, key });
  }
  return { ok: true, files };
}

/** Why `file`, an imported entry, would change what `owned` names, or null: it is that path, lies under it, or stands where a directory holding it belongs. */
function ownedPath(file, owned) {
  const folded = foldName(file);
  const base = foldName(owned.replace(/\/$/, ""));
  if (folded === base || folded.startsWith(`${base}/`)) return "is";
  if (base.startsWith(`${folded}/`)) return "holds";
  return null;
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

  const at = worktreeAt((args) => gitIn(run, worktreePath, args), worktreePath, branch);
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
 * after the dispatched head. Interpret its result with `bundleOutcome`. It
 * runs Git under `LC_ALL=C`, so Git's refusal of an empty bundle keeps the one
 * untranslated wording `bundleOutcome` recognizes.
 */
export function bundleCommand({ workspace, branch, dispatchedHead }) {
  const unsafe = workspacePathProblem(workspace);
  if (unsafe) return refuse(unsafe);
  if (!path.isAbsolute(workspace)) return refuse(`workspace ${workspace} must be an absolute path`);
  const badBranch = branchProblem(branch);
  if (badBranch) return refuse(badBranch);
  if (typeof dispatchedHead !== "string" || !OBJECT_ID.test(dispatchedHead)) return refuse("dispatchedHead must be a full commit id");
  const bundle = join(workspace, SANDBOX_IO_DIR, "out", "branch.bundle");
  return { ok: true, bundle, argv: ["env", "LC_ALL=C", "git", "-C", workspace, "bundle", "create", "--quiet", bundle, `${dispatchedHead}..refs/heads/${branch}`] };
}

/**
 * What a `bundleCommand` run produced. A session with no new commits gets no
 * bundle — Git refuses an empty one — and that is reported as "no commits",
 * not as a failure. Only Git's own refusal line counts: the words appearing
 * anywhere else, such as in a path inside another error, do not. Anything else
 * unexpected is a failure.
 */
export function bundleOutcome(result) {
  if (result?.status === 0 && !result.error) return { ok: true, bundle: true, message: "bundle written" };
  const stderr = String(result?.stderr ?? "").trim();
  if (result?.status !== null && !result?.error && EMPTY_BUNDLE.test(stderr)) return { ok: true, bundle: false, message: "no commits" };
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

/**
 * Why an imported entry is refused, or null: a `.git` or `..` component, or a
 * host-owned path. Both are compared through `foldName`, so `.agentſ/` is
 * `.agents/` and `.pathﬁnder/` is `.pathfinder/`, as APFS would check them out.
 *
 * `file` is a file, link or gitlink, as `diff-tree -r` lists them — never a
 * directory. So an entry named exactly a protected directory, `.claude` or
 * `.Claude`, is refused like anything under it, and so is one named for a
 * protected path's leading directory, such as a link `context`.
 *
 * An ignore file is host-owned at any depth, root or nested, whether it is
 * added, changed or deleted: a nested `context/.gitignore` reading
 * `!current-ticket.md` would un-ignore the claim's state file. So is an
 * attribute file: a `.gitattributes` reading `* ident` or `filter=lfs` would
 * change what the host's checkout writes, or run a program as it does. The
 * refusal says how a ticket that needs one gets it: from the host, outside
 * the sandbox.
 *
 * A name no supported filesystem can hold fails the checkout partway, so it
 * is refused before: one that is not valid UTF-8 (Git's bytes reach this
 * module decoded, with U+FFFD for what was not UTF-8, so U+FFFD itself is
 * refused too), and a component longer than `MAX_NAME_BYTES`.
 */
export function importPathProblem(file) {
  const segments = String(file).split("/");
  if (String(file).includes("\uFFFD")) return `${JSON.stringify(file)} is not a valid UTF-8 name (or holds U+FFFD); the host could not check it out on every filesystem it supports, or name it to clean up`;
  const long = segments.find((segment) => Buffer.byteLength(segment, "utf8") > MAX_NAME_BYTES);
  if (long !== undefined) return `${JSON.stringify(file)} has a component of ${Buffer.byteLength(long, "utf8")} bytes, over the ${MAX_NAME_BYTES}-byte name limit of the filesystems the host supports`;
  if (segments.some(dotGit)) return `${JSON.stringify(file)} has a .git component`;
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) return `${JSON.stringify(file)} has a "..", "." or empty component`;
  if (segments.some(ignoreFile)) return `${JSON.stringify(file)} is host-owned (ignore files, at any depth): a sandbox may not add, change or delete ignore rules; if the ticket needs this change, the host commits it on the claim branch outside the sandbox`;
  if (segments.some(attributeFile)) return `${JSON.stringify(file)} is host-owned (attribute files, at any depth): a sandbox may not add, change or delete Git attributes, which decide how the host checks files out; if the ticket needs this change, the host commits it on the claim branch outside the sandbox`;
  for (const entry of PROTECTED_PATHS) {
    const owned = ownedPath(file, entry);
    if (owned === "is") return `${JSON.stringify(file)} is host-owned (${entry})`;
    if (owned === "holds") return `${JSON.stringify(file)} stands where the directory holding host-owned ${entry} belongs`;
  }
  return null;
}

/**
 * Why an imported entry would change a file the host's configuration reads or
 * runs (`configFiles`), or null. Such a file is host-owned like an ignore file: as
 * itself, as anything under it, and as a file or link standing for one of its
 * leading directories.
 */
function configFileProblem(file, owned) {
  for (const { file: read, key } of owned) {
    const match = ownedPath(file, read);
    if (match === null) continue;
    const where = match === "is" ? "is host-owned:" : `stands where the directory holding ${JSON.stringify(read)} belongs, and`;
    const signature = key.startsWith("gpg.");
    const how = signature ? "runs or reads to verify signatures" : "reads as configuration, attributes or ignore rules";
    return `${JSON.stringify(file)} ${where} the host's Git configuration ${signature ? "names" : "reads"} ${JSON.stringify(read)} (${key}); a sandbox may not add, change or delete what the host's Git ${how}; if the ticket needs this change, the host commits it on the claim branch outside the sandbox`;
  }
  return null;
}

/** A link target's components, split on either slash as Windows would, with `.` and empty ones dropped. */
const targetParts = (target) => String(target).replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");
/** A link target's components as POSIX resolves it, split on `/` alone: there a backslash is part of a name. */
const posixParts = (target) => String(target).split("/").filter((part) => part !== "" && part !== ".");
/** The directories a link at `file` sits in, outermost first. */
const linkDirectory = (file) => (posix.dirname(file) === "." ? [] : posix.dirname(file).split("/"));

/**
 * Whether `target` has a `..` after a name. A name can be, or be made, a link
 * that lands anywhere — `a/s -> ..` lands on the repository root — and `..`
 * from there climbs out: `x -> a/s/..`. This is the shape that lets links
 * that each look contained compose into one that is not.
 */
function climbsAfterName(target) {
  const parts = targetParts(target);
  const firstName = parts.findIndex((part) => part !== "..");
  return firstName !== -1 && parts.indexOf("..", firstName) !== -1;
}

/**
 * Why a symlink at `file` pointing at `target` is refused, or null.
 *
 * Judged by shape, never by normalizing the target away: it may climb only
 * with leading `..` components, no higher than the link's own directory, and
 * then descend by names, none of them `.git`. Its climb starts from the real
 * directory the link is checked out in, so it stays in the repository.
 * `rangeProblems` adds what one link cannot show: no name on the way down may
 * be another symlink, so no chain of links leads anywhere one link could not.
 * A target longer than `MAX_PATH_BYTES` is refused too: no supported host can
 * create the link, so the checkout would fail partway.
 */
export function symlinkProblem(file, target) {
  if (target === "" || target.includes("\0")) return `symlink ${JSON.stringify(file)} has an empty or binary target`;
  const bytes = Buffer.byteLength(target, "utf8");
  if (bytes > MAX_PATH_BYTES) return `symlink ${JSON.stringify(file)} has a target of ${bytes} bytes, over the ${MAX_PATH_BYTES}-byte limit macOS's symlink(2) accepts; the checkout would fail partway`;
  const forward = target.replace(/\\/g, "/");
  if (forward.startsWith("/") || /^[A-Za-z]:/.test(forward)) return `symlink ${JSON.stringify(file)} points at absolute ${JSON.stringify(target)}`;
  if (climbsAfterName(target)) return `symlink ${JSON.stringify(file)} climbs ".." after a name in ${JSON.stringify(target)}; a link may climb only with leading ".." components`;
  const parts = targetParts(target);
  if (parts.filter((part) => part === "..").length > linkDirectory(file).length) return `symlink ${JSON.stringify(file)} escapes the repository through ${JSON.stringify(target)}`;
  if (parts.some(dotGit)) return `symlink ${JSON.stringify(file)} points into .git`;
  return null;
}

/**
 * Every repository path a contained link's target passes through on its way
 * down, ending with the path it names: `a/b -> ../c/d` passes `c`, then `c/d`.
 */
function walkedPaths(file, target) {
  const parts = targetParts(target);
  const names = parts.filter((part) => part !== "..");
  const directory = linkDirectory(file);
  const base = directory.slice(0, directory.length - (parts.length - names.length));
  return names.map((_, index) => [...base, ...names.slice(0, index + 1)].join("/"));
}

/**
 * Every repository path a link's target `parts` name on its way, read
 * lexically from the link's own directory, `..` included: `x -> a/s/..` names
 * `a`, then `a/s`, and lands back on `a`. Where every one of them is a real
 * directory, the link lands where this reading says; a link at any of them
 * can send it elsewhere. A reading that climbs above the repository root
 * stops there and says so: past that point the way runs through directories
 * outside the repository, and this reading no longer says where it lands.
 */
function lexicalWalk(file, parts) {
  const at = linkDirectory(file);
  const walked = [];
  for (const part of parts) {
    if (part !== "..") {
      at.push(part);
      walked.push(at.join("/"));
    } else if (at.length === 0) {
      return { walked, aboveRoot: true };
    } else {
      at.pop();
    }
  }
  return { walked, aboveRoot: false };
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
  return { ok: true, dev: stats.dev, ino: stats.ino };
}

/**
 * Bring one sandboxed session's results back to the host.
 *
 * Call it only once the sandbox has stopped and nothing can write the
 * workspace any more; the caller guarantees that. Each directory on the way to
 * `out/` is checked to be a real directory and rechecked, by device and inode,
 * after the listing and after every file read, refusing on any change — which
 * narrows, but cannot close, the window a writer still running would have.
 *
 * Reads and validates every output first; only then, and only when
 * `allowCommits`, imports `branch.bundle` as a fast-forward of the claim
 * branch. A bundle from a session that may not commit is refused. No Git
 * command ever runs with the workspace as its repository or directory. Every
 * problem, an unreadable `out/` included, is a refusal; it never throws.
 *
 * `limits` bounds each output file's bytes, `branch.bundle`'s compressed;
 * `maxCommits`, `maxObjectBytes`, `maxWrittenPaths` and `maxWrittenBytes`
 * bound the import, defaulting to the exported `MAX_IMPORT_*` constants.
 *
 * @returns {{ok: true, result: object, state: object|null, experiments: object|null, findings: object|null,
 *            commits: {imported: boolean, from?: string, to?: string, reason?: string}, ignored: string[]} | {ok: false, message: string}}
 */
export function collectWorkspace({
  root, key, runDir, worktree, branch, dispatchedHead, allowCommits, limits = OUTPUT_LIMITS, maxCommits = MAX_IMPORT_COMMITS,
  maxObjectBytes = MAX_IMPORT_OBJECT_BYTES, maxWrittenPaths = MAX_IMPORT_WRITTEN_PATHS, maxWrittenBytes = MAX_IMPORT_WRITTEN_BYTES, run = defaultRun,
}) {
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
  const chain = [[workspace, "the workspace"], [join(workspace, SANDBOX_IO_DIR), SANDBOX_IO_DIR], [outDir, `${SANDBOX_IO_DIR}/out`]];
  const identities = [];
  for (const [dir, label] of chain) {
    const checked = realDirectory(dir, label);
    if (!checked.ok) return checked;
    identities.push(checked);
  }
  // The same real directories as at the first check, or a refusal.
  const unchanged = () => {
    for (const [index, [dir, label]] of chain.entries()) {
      const again = realDirectory(dir, label);
      if (!again.ok) return again;
      if (again.dev !== identities[index].dev || again.ino !== identities[index].ino) return refuse(`${label} was replaced while it was collected; collect only once the sandbox has stopped`);
    }
    return { ok: true };
  };

  let names;
  try {
    names = readdirSync(outDir).sort();
  } catch (error) {
    return refuse(`cannot read ${SANDBOX_IO_DIR}/out: ${error.message}`);
  }
  const listed = unchanged();
  if (!listed.ok) return listed;
  const files = {};
  const ignored = [];
  for (const name of names) {
    if (!Object.hasOwn(limits, name)) { ignored.push(name); continue; }
    const read = readBounded(join(outDir, name), name, limits[name]);
    if (!read.ok) return read;
    const same = unchanged();
    if (!same.ok) return same;
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

  const importLimits = { commits: maxCommits, objectBytes: maxObjectBytes, writtenPaths: maxWrittenPaths, writtenBytes: maxWrittenBytes };
  const imported = importBundle({ run, runPath: found.path, runId: found.runId, key, worktree: worktreePath, branch, dispatchedHead, bundle, claimedHead: result.head, importLimits });
  if (!imported.ok) return imported;
  return { ok: true, ...outputs, commits: imported.commits };
}

/**
 * The symlinks already at the dispatched head, read once from the host's own
 * commit, each with its target. They are the host's: an import is judged by
 * what it changes about them, never refused for their existence alone.
 */
function standingLinks(host, dispatchedHead) {
  const listed = host(["ls-tree", "-r", "-z", "--full-tree", dispatchedHead]);
  if (!listed.ok) return refuse(`cannot list the symlinks at the dispatched head: ${listed.message}`);
  const links = [];
  const problems = [];
  for (const entry of listed.stdout.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab === -1) continue;
    const [mode, , id] = entry.slice(0, tab).split(" ");
    if (mode !== "120000") continue;
    const file = entry.slice(tab + 1);
    const target = host(["cat-file", "blob", id]);
    if (!target.ok) problems.push(`cannot read symlink ${JSON.stringify(file)} at the dispatched head`);
    links.push({ file, target: target.ok ? target.stdout : null });
  }
  return { ok: true, links, problems };
}

/**
 * The host's own links an import could redirect out of the repository. A
 * link whose target climbs `..` after a name lands where it does only while
 * the paths it names stay what they are: the agent turning `a/s` into a link
 * to the root sends `x -> a/s/..` out of it. So such a link is refused when
 * the imported commits add, change or remove a symlink at any path its target
 * names on the way (`lexicalWalk`, read as POSIX does and, for a target
 * holding a backslash, as Windows does too). One the import leaves alone keeps
 * landing where it did at the dispatched head, and the import goes ahead; one
 * the import changes or removes is judged as an imported link, or is gone.
 *
 * Where that way cannot be read exactly, the rule is conservative. A target
 * holding a backslash names one path on POSIX and another on Windows; a
 * reading that climbs above the repository root runs through directories
 * outside it; a way through another of the host's links continues wherever
 * that link points, which is not resolved here. Such a link is refused when
 * the imported commits touch any symlink at all. And when it does not resolve
 * at the dispatched head (`resolves`), new directories alone could complete
 * its way anywhere, so every import is refused until the host fixes it. A
 * link that resolves keeps resolving where it did while no symlink changes:
 * an import without links can only take directories away from its way.
 */
function standingRedirects(links, headLinks, touched, touchedLinks, resolves) {
  const problems = [];
  for (const { file, target } of links) {
    if (target === null || !climbsAfterName(target) || touched.has(foldName(file))) continue;
    const backslash = target.includes("\\");
    const readings = backslash ? [lexicalWalk(file, posixParts(target)), lexicalWalk(file, targetParts(target))] : [lexicalWalk(file, posixParts(target))];
    const walked = readings.flatMap(({ walked: steps }) => steps);
    const opening = `symlink ${JSON.stringify(file)}, already at the dispatched head, climbs ".." after a name in ${JSON.stringify(target)}; imported changes could redirect it out of the repository`;
    const changed = walked.find((step) => touchedLinks.has(foldName(step)));
    if (changed !== undefined) {
      problems.push(`${opening}: they add, change or remove a symlink at ${JSON.stringify(changed)} on its way. Fix the link on the host first`);
      continue;
    }
    const through = walked.find((step) => headLinks.has(foldName(step)));
    const unread = readings.some(({ aboveRoot }) => aboveRoot) ? "its way climbs above the repository root"
      : backslash ? "its target holds a backslash, part of a name on POSIX and a separator on Windows"
      : through !== undefined ? `it passes through the host's symlink ${JSON.stringify(through)}`
      : null;
    if (unread === null) continue;
    if (!resolves(file)) {
      problems.push(`${opening}: ${unread}, so its way cannot be read exactly, and it does not resolve at the dispatched head, where new directories alone could complete it anywhere; every import is refused until the link is fixed on the host`);
    } else if (touchedLinks.size > 0) {
      problems.push(`${opening}: ${unread}, so its way cannot be read exactly, and the imported commits add, change or remove symlinks. Fix the link on the host first`);
    }
  }
  return problems;
}

/** What a tree entry's mode makes it: nothing, a directory, a link, a gitlink, or a file. */
function kind(mode) {
  if (mode === "000000") return null;
  if (mode === "040000") return "tree";
  if (mode === "120000") return "link";
  if (mode === "160000") return "gitlink";
  return "file";
}

/**
 * Every path the tip adds, changes or removes against the dispatched head,
 * directories included — the net change the fast-forward makes to the claim
 * worktree, which already holds the dispatched head checked out.
 */
function netChanges(host, dispatchedHead, tip) {
  const diff = host(["diff-tree", "-r", "-t", "-z", "--raw", "--no-renames", "--no-abbrev", dispatchedHead, tip]);
  if (!diff.ok) return refuse(`cannot list what the imported commits change: ${diff.message}`);
  const fields = diff.stdout.split("\0");
  const changes = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [oldMode, newMode, , newId] = fields[index].replace(/^:/, "").split(" ");
    changes.push({ path: fields[index + 1], oldMode, newMode, newId });
  }
  return { ok: true, changes };
}

/** The expanded size of each of these objects, in order, one `cat-file` for all of them. */
function objectSizes(host, ids) {
  if (ids.length === 0) return { ok: true, sizes: [] };
  const sized = host(["cat-file", "--batch-check=%(objectsize)"], `${ids.join("\n")}\n`);
  if (!sized.ok) return refuse(`cannot read the size of the imported objects: ${sized.message}`);
  const lines = sized.stdout.split("\n").filter((line) => line !== "");
  if (lines.length !== ids.length) return refuse("cannot read the size of every imported object");
  const sizes = [];
  for (const [index, line] of lines.entries()) {
    if (!/^\d+$/.test(line)) return refuse(`cannot read the size of imported object ${ids[index]}: ${line}`);
    sizes.push(Number(line));
  }
  return { ok: true, sizes };
}

const total = (sizes) => sizes.reduce((sum, size) => sum + size, 0);

/** Every attribute Git's `convert_attrs` reads to decide how it checks a file out. */
const CHECKOUT_ATTRIBUTES = Object.freeze(["crlf", "ident", "filter", "eol", "text", "working-tree-encoding"]);
/** How many paths one `check-attr` is asked about, so its listing stays far below `MAX_COMMAND_OUTPUT`. */
const ATTRIBUTE_BATCH = 1000;

/**
 * Each file's checkout attributes, read in the claim worktree as its checkout
 * reads them: the `.gitattributes` files of the dispatched head, which no
 * import may change, then `.git/info/attributes`, `core.attributesFile` and
 * the system file. `check-attr` only reads attributes; it runs no filter.
 */
function checkoutAttributes(host, files) {
  const byPath = new Map();
  for (let start = 0; start < files.length; start += ATTRIBUTE_BATCH) {
    const batch = files.slice(start, start + ATTRIBUTE_BATCH);
    const listed = host(["check-attr", "-z", "--stdin", ...CHECKOUT_ATTRIBUTES], batch.map((file) => `${file}\0`).join(""));
    if (!listed.ok) return refuse(`cannot read the host's checkout attributes: ${listed.message}`);
    const fields = listed.stdout.split("\0");
    for (let index = 0; index + 2 < fields.length; index += 3) {
      const [file, name, value] = fields.slice(index, index + 3);
      if (!byPath.has(file)) byPath.set(file, {});
      byPath.get(file)[name] = value;
    }
  }
  for (const file of files) {
    const read = byPath.get(file);
    if (!read || CHECKOUT_ATTRIBUTES.some((name) => typeof read[name] !== "string")) return refuse(`cannot read the host's checkout attributes of ${JSON.stringify(file)}`);
  }
  return { ok: true, byPath };
}

/**
 * The host's configuration a checkout's growth depends on, read in the claim
 * worktree as its checkout reads it: every filter driver configured there
 * (any `filter.<driver>.*` key, as Git's `read_convert_config` collects them),
 * and whether text gets CRLF line endings (`core.autocrlf`, `core.eol`). A
 * value Git might read as true is taken as true.
 */
function checkoutConfig(host) {
  const listed = host(["config", "-z", "--get-regexp", "^(filter\\..+|core\\.autocrlf|core\\.eol)$"]);
  if (!listed.ok && listed.status !== 1) return refuse(`cannot read the host's checkout configuration: ${listed.message}`);
  const drivers = new Set();
  let autocrlf;
  let eol;
  for (const record of listed.ok ? listed.stdout.split("\0") : []) {
    if (record === "") continue;
    const newline = record.indexOf("\n");
    const key = newline === -1 ? record : record.slice(0, newline);
    const value = newline === -1 ? null : record.slice(newline + 1);
    const driver = /^filter\.(.+)\.[^.]+$/s.exec(key);
    if (driver) drivers.add(driver[1]);
    else if (key === "core.autocrlf") autocrlf = value;
    else if (key === "core.eol") eol = value;
  }
  // `autocrlf` with no value is true; `input` is its own setting; anything Git does not read as false may be true.
  const word = autocrlf === undefined ? "false" : autocrlf === null ? "true" : autocrlf.trim().toLowerCase();
  const crlfSetting = word === "input" ? "input" : /^(?:false|no|off|[-+]?0+|)$/.test(word) ? "false" : "true";
  const eolWord = (eol ?? "").trim().toLowerCase();
  // Git's `text_eol_is_crlf`: autocrlf first, then core.eol, then the platform's native ending.
  const textCrlf = crlfSetting === "true" || (crlfSetting === "false" && (eolWord === "crlf" || (process.platform === "win32" && eolWord !== "lf")));
  return { ok: true, drivers, autocrlf: crlfSetting, textCrlf };
}

/** The `text` or `crlf` attribute as Git's `git_path_check_crlf` reads it, or null when it leaves the decision open. */
function crlfAction(value) {
  if (value === "set") return "text";
  if (value === "unset") return "binary";
  if (value === "input" || value === "auto") return value;
  return null;
}

/**
 * Whether a checkout may give this file CRLF line endings, as Git's
 * `convert_attrs` and `output_eol` decide it: never for a binary file or one
 * checked out with `eol=lf`; always with `eol=crlf`; for `text` or
 * `text=auto` when the configuration ends text with CRLF; and otherwise when
 * `core.autocrlf` is true.
 */
function crlfPossible(attributes, config) {
  if (attributes.eol === "lf") return false;
  const action = crlfAction(attributes.text) ?? crlfAction(attributes.crlf);
  if (action === "binary") return false;
  if (attributes.eol === "crlf") return true;
  if (action === "input") return false;
  if (action === "text" || action === "auto") return config.textCrlf;
  return config.autocrlf === "true";
}

/**
 * The most the host's checkout can grow one file, in the order Git's
 * `convert_to_working_tree` converts it — `ident`, then line endings, then
 * `working-tree-encoding` — as `{factor, extra}`: it writes at most
 * `size * factor + extra` bytes. `ident` turns each `$Id$`, four bytes, into
 * `$Id: <object id> $`; CRLF at most doubles the bytes; UTF-16 at most doubles
 * UTF-8 and UTF-32 at most quadruples it, each with a byte-order mark. Or
 * `{problem}` where the checkout would run a configured filter driver — an
 * external program, which may also fail the checkout midway — or where its
 * growth cannot be bounded: any other encoding, or an encoding attribute
 * without a name, which Git refuses.
 */
function checkoutGrowth(attributes, config, hexLength) {
  if (config.drivers.has(attributes.filter)) {
    return { problem: `would be checked out through the host's filter driver ${JSON.stringify(attributes.filter)} (filter.${attributes.filter}.*), which can run an external program` };
  }
  let factor = 1;
  let extra = 0;
  if (attributes.ident === "set") factor *= (hexLength + 7) / 4;
  if (crlfPossible(attributes, config)) factor *= 2;
  const encoding = attributes["working-tree-encoding"];
  if (encoding === "set" || encoding === "unset") return { problem: `has working-tree-encoding ${encoding} with no encoding named, which Git refuses at checkout` };
  if (encoding !== "unspecified" && encoding !== "" && !/^utf-?8$/i.test(encoding)) {
    if (/^(?:utf-?16|ucs-?2)/i.test(encoding)) factor *= 2;
    else if (/^(?:utf-?32|ucs-?4)/i.test(encoding)) factor *= 4;
    else return { problem: `would be checked out re-encoded as working-tree-encoding ${JSON.stringify(encoding)}, whose growth the import cannot bound` };
    extra += 4;
  }
  return { factor, extra };
}

/**
 * The import's size, against limits separate from the compressed bundle's
 * and the commit count: the expanded object data the commits bring — every
 * object reachable from the tip and not from the dispatched head, at full
 * size — and what the fast-forward would write into the claim worktree, the
 * files and links the tip adds or changes, each blob counted once per path
 * and each file at the most the host's checkout attributes for its path can
 * grow it (`checkoutGrowth`). A file the host would check out through a
 * filter driver, or whose growth cannot be bounded, is refused by name.
 * Measured from the claim worktree after the fetch and before anything is
 * checked out.
 *
 * Also returns `filtered`: the files the import changes or deletes that the
 * host checks out through a configured filter driver — the ones a
 * restoration after a failed checkout checks out last (`restoreClaim`).
 */
function sizeProblems(host, dispatchedHead, tip, changes, limits) {
  const none = new Set();
  const listed = host(["rev-list", "--objects", "--no-object-names", `${dispatchedHead}..${tip}`]);
  if (!listed.ok) return { problems: [`cannot list the imported objects: ${listed.message}`], filtered: none };
  const ids = listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  const expanded = objectSizes(host, ids);
  if (!expanded.ok) return { problems: [expanded.message], filtered: none };
  const problems = [];
  const expandedBytes = total(expanded.sizes);
  if (expandedBytes > limits.objectBytes) problems.push(`the imported objects expand to ${expandedBytes} bytes (${ids.length} objects), over the ${limits.objectBytes}-byte limit on expanded object data`);
  const written = changes.filter(({ newMode }) => kind(newMode) === "file" || kind(newMode) === "link");
  const sized = objectSizes(host, written.map(({ newId }) => newId));
  if (!sized.ok) return { problems: [...problems, sized.message], filtered: none };
  const blobBytes = total(sized.sizes);
  const overBytes = (bytes) => `the fast-forward would write ${bytes} bytes into the claim worktree, over the ${limits.writtenBytes}-byte limit`;
  if (written.length > limits.writtenPaths) {
    // Too many paths to ask about each: their blobs alone are judged.
    problems.push(`the fast-forward would write ${written.length} files and links into the claim worktree, over the ${limits.writtenPaths}-path limit`);
    if (blobBytes > limits.writtenBytes) problems.push(overBytes(blobBytes));
    return { problems, filtered: none };
  }
  const files = written.filter(({ newMode }) => kind(newMode) === "file").map(({ path: file }) => file);
  const replaced = changes.filter(({ oldMode }) => kind(oldMode) === "file").map(({ path: file }) => file);
  const attributes = checkoutAttributes(host, [...new Set([...files, ...replaced])]);
  if (!attributes.ok) return { problems: [...problems, attributes.message], filtered: none };
  const config = checkoutConfig(host);
  if (!config.ok) return { problems: [...problems, config.message], filtered: none };
  const filtered = new Set(replaced.filter((file) => config.drivers.has(attributes.byPath.get(file).filter)));
  let bound = 0;
  let grown = 0;
  for (const [index, { path: file, newMode }] of written.entries()) {
    const size = sized.sizes[index];
    // A link is written as its target, never converted.
    if (kind(newMode) !== "file") { bound += size; continue; }
    const growth = checkoutGrowth(attributes.byPath.get(file), config, dispatchedHead.length);
    if (growth.problem) { problems.push(`${JSON.stringify(file)} ${growth.problem}; the host checks it out outside the sandbox`); continue; }
    const most = Math.ceil(size * growth.factor) + growth.extra;
    if (most > size) grown += 1;
    bound += most;
  }
  if (bound > limits.writtenBytes) {
    problems.push(grown === 0 ? overBytes(bound)
      : `the fast-forward could write up to ${bound} bytes into the claim worktree (${blobBytes} bytes of blobs, ${grown} ${grown === 1 ? "file" : "files"} grown by the host's checkout attributes: ident, line endings or working-tree-encoding), over the ${limits.writtenBytes}-byte limit`);
  }
  return { problems, filtered };
}

/**
 * Every problem with the commits `dispatchedHead..tip`, read from the claim
 * worktree after the fetch and before the fast-forward, with the net change
 * they make. The commit count and the import's size, the host's checkout
 * attributes included, come first: past either limit nothing else is read.
 *
 * Symlinks are judged against each other, not one at a time: a link added or
 * changed anywhere in the range must pass `symlinkProblem`, and may not pass
 * through, or name, any path that is a symlink at the dispatched head or
 * becomes one anywhere in the range — compared through `foldName`. With every
 * such link descending only through real directories from a contained climb,
 * no imported link leads out of the repository or into `.git`; and the
 * host's own links are refused only where the import could redirect them
 * (`standingRedirects`; `resolves` says whether one resolves in the claim
 * worktree at the dispatched head). The tip's tree must also be one a case-insensitive
 * filesystem can check out whole, as far as the import changes it, within
 * `MAX_PATH_BYTES` once it stands in the claim worktree. No imported entry
 * may change a file the host's configuration reads (`configFiles`, as
 * `owned`).
 */
function rangeProblems({ host, worktree, dispatchedHead, tip, limits, resolves, owned }) {
  const listed = host(["rev-list", "--parents", "--reverse", `${dispatchedHead}..${tip}`]);
  if (!listed.ok) return { problems: [`cannot list the imported commits: ${listed.message}`] };
  const commits = listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => line.split(" "));
  if (commits.length > limits.commits) return { problems: [`${commits.length} commits, over the ${limits.commits}-commit limit`] };
  const net = netChanges(host, dispatchedHead, tip);
  if (!net.ok) return { problems: [net.message] };
  const sized = sizeProblems(host, dispatchedHead, tip, net.changes, limits);
  if (sized.problems.length) return { problems: sized.problems };
  const standing = standingLinks(host, dispatchedHead);
  if (!standing.ok) return { problems: [standing.message] };
  const problems = [...standing.problems];
  for (const { path: file, newMode } of net.changes) {
    const bytes = Buffer.byteLength(join(worktree, ...file.split("/")), "utf8");
    if (kind(newMode) !== null && bytes > MAX_PATH_BYTES) problems.push(`${JSON.stringify(file)} would stand at a path of ${bytes} bytes in the claim worktree, over the ${MAX_PATH_BYTES}-byte path limit of the filesystems the host supports`);
  }
  const headLinks = new Set(standing.links.map(({ file }) => foldName(file)));
  const linkPaths = new Set(headLinks);
  const touched = new Set();
  const touchedLinks = new Set();
  const contained = [];
  for (const [commit, ...parents] of commits) {
    if (parents.length !== 1) { problems.push(`commit ${commit} ${parents.length ? "is a merge commit" : "has no parent"}`); continue; }
    const diff = host(["diff-tree", "-r", "-z", "--raw", "--no-renames", "--no-abbrev", parents[0], commit]);
    if (!diff.ok) { problems.push(`cannot read commit ${commit}: ${diff.message}`); continue; }
    const fields = diff.stdout.split("\0");
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const [oldMode, newMode, , newId] = fields[index].replace(/^:/, "").split(" ");
      const file = fields[index + 1];
      touched.add(foldName(file));
      if (oldMode === "120000" || newMode === "120000") touchedLinks.add(foldName(file));
      if (oldMode === "160000" || newMode === "160000") problems.push(`commit ${commit}: ${JSON.stringify(file)} is a gitlink`);
      const pathProblem = importPathProblem(file) ?? configFileProblem(file, owned);
      if (pathProblem) problems.push(`commit ${commit}: ${pathProblem}`);
      if (newMode === "120000") {
        linkPaths.add(foldName(file));
        const target = host(["cat-file", "blob", newId]);
        const linkProblem = target.ok ? symlinkProblem(file, target.stdout) : `cannot read symlink ${JSON.stringify(file)}`;
        if (linkProblem) problems.push(`commit ${commit}: ${linkProblem}`);
        else contained.push({ commit, file, target: target.stdout });
      }
    }
  }
  for (const { commit, file, target } of contained) {
    const through = walkedPaths(file, target).find((walked) => linkPaths.has(foldName(walked)));
    if (through !== undefined) problems.push(`commit ${commit}: symlink ${JSON.stringify(file)} reaches ${JSON.stringify(target)} through the symlink ${JSON.stringify(through)}; a link may not lead through another`);
  }
  problems.push(...standingRedirects(standing.links, headLinks, touched, touchedLinks, resolves));
  problems.push(...foldCollisions(host, tip, net.changes));
  return { problems, changes: net.changes, filtered: sized.filtered };
}

/**
 * Every pair of distinct paths in `tip`'s tree, leading directories included,
 * that `foldName` makes one, where the import brings the pair: a case- or
 * normalization-insensitive filesystem checks only one of them out, so the
 * claim worktree would not hold the tree the branch commits — `A -> .` beside
 * `a/b/l`, or `readme.md` beside `README.md`. A pair the dispatched head
 * already held, each member the same kind of entry, is the host's: the claim
 * worktree was checked out clean with it, and an import that adds neither
 * member nor changes what either is goes ahead.
 */
function foldCollisions(host, tip, changes) {
  const brought = new Set(changes.filter(({ oldMode, newMode }) => kind(newMode) !== null && kind(newMode) !== kind(oldMode)).map(({ path: file }) => file));
  const listed = host(["ls-tree", "-r", "-t", "-z", "--full-tree", "--name-only", tip]);
  if (!listed.ok) return [`cannot list the imported tree: ${listed.message}`];
  const seen = new Map();
  const problems = [];
  for (const file of listed.stdout.split("\0")) {
    if (file === "") continue;
    const folded = foldName(file);
    const first = seen.get(folded);
    if (first === undefined) seen.set(folded, file);
    else if (brought.has(first) || brought.has(file)) problems.push(`${JSON.stringify(first)} and ${JSON.stringify(file)} are one path on a case- or normalization-insensitive filesystem; Git cannot check out both`);
  }
  return problems;
}

/**
 * What stands in the claim worktree at `parts`, looked up one component at a
 * time so no link is followed: nothing, a non-directory at one of its leading
 * components or at the path itself, or a directory at the path. On a case- or
 * normalization-insensitive filesystem the lookup folds as Git's checkout
 * would.
 */
function onDisk(worktree, parts) {
  for (let index = 1; index <= parts.length; index += 1) {
    const at = parts.slice(0, index).join("/");
    let stats;
    try {
      stats = lstatSync(join(worktree, ...parts.slice(0, index)));
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return { kind: "none" };
      return { kind: "unknown", at, message: error.message };
    }
    if (!stats.isDirectory()) return { kind: "other", at };
    if (index === parts.length) return { kind: "directory", at };
  }
  return { kind: "none" };
}

/** The first file or link anywhere under `directory`, relative to `worktree`, or null when it holds only directories. */
function fileUnder(worktree, directory) {
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = readdirSync(join(worktree, ...current.split("/")), { withFileTypes: true }); } catch { return current; }
    for (const entry of entries) {
      if (!entry.isDirectory()) return `${current}/${entry.name}`;
      pending.push(`${current}/${entry.name}`);
    }
  }
  return null;
}

/**
 * Every imported path that would replace or remove something Git does not
 * track in the claim worktree: an ignored or untracked file or link at the
 * path or at one of its leading directories, or untracked files inside a
 * directory the import turns into a file or link. Git's fast-forward replaces
 * ignored files silently; the claim's state file, `.env` and `.pathfinder/`
 * evidence are ignored files. Compared through `foldName`, as the filesystem
 * may.
 *
 * A directory Git does not track at all — empty, holding only ignored files,
 * or itself ignored — is listed whole, so inside it what stands on disk is
 * looked up directly: a new file whose own path is free there replaces
 * nothing, and imports. An empty directory is not listed, and Git removes it
 * itself when a file takes its place.
 */
function untrackedProblems(host, worktree, changes) {
  const others = host(["ls-files", "-z", "--others", "--directory", "--no-empty-directory"]);
  if (!others.ok) return [`cannot list the files Git does not track in the claim worktree: ${others.message}`];
  const untracked = new Map();
  const holders = new Map();
  for (const entry of others.stdout.split("\0")) {
    if (entry === "") continue;
    const file = entry.replace(/\/$/, "");
    const parts = foldName(file).split("/");
    if (!untracked.has(parts.join("/"))) untracked.set(parts.join("/"), { file, directory: entry.endsWith("/") });
    for (let index = 1; index < parts.length; index += 1) {
      const holder = parts.slice(0, index).join("/");
      if (!holders.has(holder)) holders.set(holder, file);
    }
  }
  const untrackedNote = "which the claim worktree holds but Git does not track (ignored or untracked)";
  const problems = [];
  for (const { path: file, oldMode, newMode } of changes) {
    if (kind(oldMode) !== null || (kind(newMode) !== "file" && kind(newMode) !== "link")) continue;
    const parts = file.split("/");
    const folded = foldName(file).split("/");
    let judged = false;
    for (let index = 1; index <= folded.length && !judged; index += 1) {
      const found = untracked.get(folded.slice(0, index).join("/"));
      if (found === undefined) continue;
      judged = true;
      if (!found.directory) problems.push(`${JSON.stringify(file)} would replace ${JSON.stringify(found.file)}, ${untrackedNote}`);
      else if (index === folded.length) problems.push(`${JSON.stringify(file)} would remove the files in ${JSON.stringify(found.file)}, ${untrackedNote}`);
      else {
        // Inside a directory Git does not track at all: look at what is there.
        const there = onDisk(worktree, parts);
        if (there.kind === "unknown") problems.push(`cannot see what stands at ${JSON.stringify(there.at)} in the claim worktree: ${there.message}`);
        else if (there.kind === "other") problems.push(`${JSON.stringify(file)} would replace ${JSON.stringify(there.at)}, inside ${JSON.stringify(found.file)}, ${untrackedNote}`);
        else if (there.kind === "directory") {
          const held = fileUnder(worktree, there.at);
          if (held !== null) problems.push(`${JSON.stringify(file)} would remove ${JSON.stringify(held)}, ${untrackedNote}`);
        }
      }
    }
    if (!judged && holders.has(folded.join("/"))) problems.push(`${JSON.stringify(file)} would remove ${JSON.stringify(holders.get(folded.join("/")))}, ${untrackedNote}`);
  }
  return problems;
}

/**
 * What stands at a claim-worktree path, never through a link: `none`, a
 * `directory`, a `file` (a file, link or anything else), or `unknown`. A name
 * the filesystem calls too long while the whole path is within
 * `MAX_PATH_BYTES` has a component no entry there can have, so nothing stands
 * at it. On a case- or normalization-insensitive filesystem this finds an
 * entry under any spelling the filesystem folds onto the one asked for, so it
 * says what kind of entry stands there, never how its name is spelled:
 * `listing` does.
 */
function standing(worktree, file) {
  const at = join(worktree, ...file.split("/"));
  try {
    return lstatSync(at).isDirectory() ? "directory" : "file";
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return "none";
    return error.code === "ENAMETOOLONG" && Buffer.byteLength(at, "utf8") <= MAX_PATH_BYTES ? "none" : "unknown";
  }
}

/** A claim-worktree directory path's components; the top is "". */
const partsOf = (directory) => (directory === "" ? [] : directory.split("/"));
/** A name in a claim-worktree directory, as a path to show. */
const shownIn = (directory, name) => (directory === "" ? name : `${directory}/${name}`);
/** The directory `parts` under `worktree` as raw bytes, with one name in it, as `readdir` returned its bytes, when given. */
function rawPath(worktree, parts, name) {
  const directory = Buffer.from(join(worktree, ...parts));
  return name === undefined ? directory : Buffer.concat([directory, Buffer.from(path.sep), name]);
}
/** The entry `lstat` read: the same device and inode is the same entry. */
const entryId = (stats) => `${stats.dev}:${stats.ino}`;
/** And the same size and modification time, to the nanosecond, is the same, untouched file. */
const fileId = (stats) => `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`;

/**
 * The exact listing of the claim-worktree directory at `parts`, read without
 * following a link, or `null` when anything but a real directory stands at it
 * or at one of its leading components. Each entry is keyed by the bytes
 * `readdir` returns for its name (as hex), so a name that differs only in
 * case or normalization is another name, and carries its kind, permission
 * bits, identity (`entryId`, `fileId`) and, for a link, its target's bytes.
 * Throws when the directory or an entry in it cannot be read.
 */
function listing(worktree, parts) {
  for (let index = 1; index <= parts.length; index += 1) {
    let stats;
    try {
      stats = lstatSync(join(worktree, ...parts.slice(0, index)));
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw error;
    }
    if (!stats.isDirectory()) return null;
  }
  const entries = new Map();
  for (const name of readdirSync(rawPath(worktree, parts), { encoding: "buffer" })) {
    const at = rawPath(worktree, parts, name);
    const stats = lstatSync(at, { bigint: true });
    const kind = stats.isDirectory() ? "directory" : stats.isSymbolicLink() ? "link" : stats.isFile() ? "file" : "other";
    entries.set(name.toString("hex"), {
      name: name.toString("utf8"), kind, mode: Number(stats.mode & 0o7777n), entry: entryId(stats), file: fileId(stats), size: stats.size,
      target: kind === "link" ? readlinkSync(at, { encoding: "buffer" }).toString("hex") : null,
    });
  }
  return entries;
}

/**
 * What stands, just before the fast-forward, where it writes: what
 * `restoreClaim` puts back, and then proves. `before` is the kind of entry at
 * every path the fast-forward adds, changes or removes and at each of their
 * leading directories, as the filesystem resolves each name. `listings` is
 * the exact listing (`listing`) of the claim worktree's top and of each of
 * those leading directories: every entry, tracked, untracked or ignored, of
 * every directory the fast-forward may write in, by the bytes of its name.
 * Refused when any of it cannot be read.
 */
function snapshot(worktree, changes) {
  const before = new Map();
  const directories = new Set([""]);
  for (const { path: file } of changes) {
    const parts = file.split("/");
    for (let index = 1; index <= parts.length; index += 1) {
      const at = parts.slice(0, index).join("/");
      if (index < parts.length) directories.add(at);
      if (before.has(at)) continue;
      const kindNow = standing(worktree, at);
      if (kindNow === "unknown") return refuse(`cannot see what stands at ${JSON.stringify(at)} in the claim worktree`);
      before.set(at, kindNow);
    }
  }
  const listings = new Map();
  for (const directory of directories) {
    try {
      listings.set(directory, listing(worktree, partsOf(directory)));
    } catch (error) {
      return refuse(`cannot list ${directory === "" ? "the top of the claim worktree" : JSON.stringify(directory)} exactly before the import: ${error.message}`);
    }
  }
  return { ok: true, before, listings };
}

const nameList = (paths) => `${paths.slice(0, 20).map((file) => JSON.stringify(file)).join(", ")}${paths.length > 20 ? ` and ${paths.length - 20} more` : ""}`;

/**
 * Put the claim worktree back exactly as it was after a fast-forward that
 * failed partway, and prove it. Git's checkout writes entry by entry and fails
 * only at the end, leaving the branch and the index at the dispatched head but
 * the files it already removed, changed or created on disk; on a case- or
 * normalization-insensitive filesystem it can also leave a directory it
 * removed and created again under the import's spelling of its name (`Docs/`
 * as `docs/`), which every lookup by name still finds.
 *
 * The branch, HEAD and index are confirmed first. Then, deepest first, what
 * stands where something else stood before (`snapshot`) is removed — a file or
 * link where nothing or a directory stood, a directory where nothing or a file
 * did — a directory only when empty, and a file never when it is one that
 * stood in the claim before the import (same device, inode, size and
 * modification time), so nothing the import did not create is removed. The
 * files the import changes or deletes are checked out again from the index,
 * those the host checks out through a filter driver last, once every other
 * file, a filter's own program among them, is the host's again. Empty
 * directories the checkout removed are recreated. A name the filesystem
 * resolves to the same entry under another spelling is renamed back to its
 * own bytes, and what was recreated or checked out again gets its permission
 * bits back.
 *
 * Then it is proved, in every directory `snapshot` listed: the same names, byte
 * for byte, each the same kind with the same permission bits; every file or
 * link not checked out again the very same one, untouched (so untracked and
 * ignored files are proved kept, not merely present); every tracked one
 * checked out again the size and link target it had, its contents Git's; and
 * the branch, HEAD and index still at the dispatched head, with Git reporting
 * the worktree clean. Every command runs through `host`, so no hook or
 * fsmonitor runs; the configuration it reads is the host's, since no import
 * may change a file it reads (`configFiles`).
 *
 * Returns `{ok: true, removed, rewritten, respelled}`, or `{ok: false, why,
 * leftover}` naming what is not as it was; it stops before checking anything
 * out when something it did not create stands in the way.
 */
function restoreClaim({ host, worktree, branch, dispatchedHead, changes, before, listings, filtered }) {
  const failed = (why, leftover = []) => ({ ok: false, why, leftover });
  const at = (file) => join(worktree, ...file.split("/"));
  const atHead = () => {
    const on = host(["symbolic-ref", "--quiet", "HEAD"]);
    if (!on.ok || on.stdout.trim() !== `refs/heads/${branch}`) return `the claim worktree is no longer on ${branch}`;
    const head = host(["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!head.ok) return `cannot read the claim's head: ${head.message}`;
    if (head.stdout.trim() !== dispatchedHead) return `${branch} is at ${head.stdout.trim()}, not the dispatched head ${dispatchedHead}`;
    const index = host(["diff-index", "--cached", "--quiet", dispatchedHead]);
    if (index.status === 1) return "the index no longer matches the dispatched head";
    if (!index.ok) return `cannot compare the index with the dispatched head: ${index.message}`;
    return null;
  };
  const moved = atHead();
  if (moved) return failed(moved);

  // Every file or link that stood, before the import, in a directory it writes in.
  const stood = new Set();
  for (const entries of listings.values()) for (const entry of entries?.values() ?? []) if (entry.kind !== "directory") stood.add(entry.file);
  const leftover = [];
  let removed = 0;
  const deepestFirst = [...before.keys()].sort((a, b) => b.split("/").length - a.split("/").length);
  for (const file of deepestFirst) {
    const was = before.get(file);
    const now = standing(worktree, file);
    if (now === "none" || now === was) continue;
    try {
      if (now === "directory") rmdirSync(at(file));
      else if (now === "file" && !stood.has(fileId(lstatSync(at(file), { bigint: true })))) unlinkSync(at(file));
      else throw new Error("not the import's");
      removed += 1;
    } catch {
      leftover.push(file);
    }
  }
  if (leftover.length) return failed("something the failed checkout left, or that it did not create, stands where the dispatched head has something else, and is not removed", leftover);

  const replaced = changes.filter(({ oldMode }) => kind(oldMode) === "file" || kind(oldMode) === "link").map(({ path: file }) => file);
  for (const group of [replaced.filter((file) => !filtered.has(file)), replaced.filter((file) => filtered.has(file))]) {
    if (group.length === 0) continue;
    const out = host(["checkout-index", "--quiet", "--force", "--index", "-z", "--stdin"], group.map((file) => `${file}\0`).join(""));
    if (!out.ok) return failed(`cannot check the dispatched head's files out again: ${out.message}`, group);
  }
  for (const file of [...deepestFirst].reverse()) {
    if (before.get(file) !== "directory" || standing(worktree, file) !== "none") continue;
    try { mkdirSync(at(file)); } catch { leftover.push(file); }
  }

  const directories = [...listings.keys()].sort((a, b) => partsOf(a).length - partsOf(b).length);
  const now = (directory) => { try { return listing(worktree, partsOf(directory)); } catch { return null; } };
  // The name in `current` that the filesystem resolves `hex`, a name `was` held and `current` does not, to: the same entry, spelled otherwise.
  const spelledAs = (directory, hex, was, current) => {
    let stats;
    try { stats = lstatSync(rawPath(worktree, partsOf(directory), Buffer.from(hex, "hex")), { bigint: true }); } catch { return null; }
    const found = [...current].find(([other, entry]) => !was.has(other) && entry.entry === entryId(stats));
    return found === undefined ? null : found[0];
  };
  let respelled = 0;
  for (const directory of directories) {
    const was = listings.get(directory);
    const current = was === null ? null : now(directory);
    if (current === null) continue;
    for (const hex of was.keys()) {
      if (current.has(hex)) continue;
      const alias = spelledAs(directory, hex, was, current);
      if (alias === null) continue;
      try {
        renameSync(rawPath(worktree, partsOf(directory), Buffer.from(alias, "hex")), rawPath(worktree, partsOf(directory), Buffer.from(hex, "hex")));
        respelled += 1;
      } catch { /* The proof below names it. */ }
    }
  }
  // What was checked out again: by the entry the filesystem resolves each tracked path to, however spelled.
  const rewritten = new Set();
  for (const file of replaced) {
    try { rewritten.add(entryId(lstatSync(at(file), { bigint: true }))); } catch { /* Missing: the proof below names it. */ }
  }
  for (const directory of directories) {
    const was = listings.get(directory);
    const current = was === null ? null : now(directory);
    if (current === null) continue;
    for (const [hex, entry] of was) {
      const there = current.get(hex);
      if (!there || there.kind !== entry.kind || there.kind === "link" || there.mode === entry.mode) continue;
      if (there.kind !== "directory" && !rewritten.has(there.entry)) continue;
      try { chmodSync(rawPath(worktree, partsOf(directory), Buffer.from(hex, "hex")), entry.mode); } catch { /* The proof below names it. */ }
    }
  }

  const differences = new Set();
  const octal = (mode) => mode.toString(8).padStart(4, "0");
  for (const directory of directories) {
    const was = listings.get(directory);
    let current;
    try {
      current = listing(worktree, partsOf(directory));
    } catch (error) {
      differences.add(`${directory === "" ? "the top of the claim worktree" : JSON.stringify(directory)} cannot be listed: ${error.message}`);
      continue;
    }
    if (was === null || current === null) {
      if (was === null && current !== null) differences.add(`${JSON.stringify(directory)} is a directory, and was not before the import`);
      if (was !== null && current === null) differences.add(`${JSON.stringify(directory)} is no longer the directory it was`);
      continue;
    }
    const aliases = new Set();
    for (const [hex, entry] of was) {
      const name = JSON.stringify(shownIn(directory, entry.name));
      const there = current.get(hex);
      if (there === undefined) {
        const alias = spelledAs(directory, hex, was, current);
        if (alias !== null) aliases.add(alias);
        differences.add(alias === null ? `${name} is missing` : `${name} is spelled ${JSON.stringify(shownIn(directory, current.get(alias).name))} on disk`);
      } else if (there.kind !== entry.kind) {
        differences.add(`${name} is a ${there.kind} where a ${entry.kind} stood`);
      } else if (entry.kind !== "link" && there.mode !== entry.mode) {
        differences.add(`${name} has permissions ${octal(there.mode)}, not ${octal(entry.mode)}`);
      } else if (entry.kind === "directory") {
        continue;
      } else if (rewritten.has(there.entry)) {
        if (there.size !== entry.size || there.target !== entry.target) differences.add(`${name}, checked out again, does not hold what it held`);
      } else if (there.file !== entry.file || there.target !== entry.target) {
        differences.add(`${name} is not the file it was: another inode, size or modification time`);
      }
    }
    for (const [hex, entry] of current) {
      if (!was.has(hex) && !aliases.has(hex)) differences.add(`${JSON.stringify(shownIn(directory, entry.name))} was not there before the import`);
    }
  }
  if (differences.size) {
    const listed = [...differences];
    return failed(`these do not stand exactly as before the import: ${listed.slice(0, 20).join("; ")}${listed.length > 20 ? `; and ${listed.length - 20} more` : ""}`);
  }
  const still = atHead();
  if (still) return failed(still);
  const status = host(["status", "--porcelain", "-z", "--untracked-files=all"]);
  if (!status.ok) return failed(`cannot read the claim's status: ${status.message}`);
  const dirty = status.stdout.split("\0").filter(Boolean).map((entry) => entry.slice(3));
  if (dirty.length) return failed("Git reports the claim worktree changed from the dispatched head", dirty);
  return { ok: true, removed, rewritten: replaced.length, respelled };
}

/**
 * Fast-forward the claim branch from a bundle's bytes. The bytes are copied
 * into the run directory, outside the agent-written workspace, and every Git
 * command runs in the claim worktree through `hostGit`, so no hook or
 * fsmonitor runs. The fast-forward never replaces a file Git does not track
 * there: such paths are refused by name first, and the merge runs with
 * `--no-overwrite-ignore` as well. Nothing is checked out until the import is
 * within `importLimits`, and the temporary ref is deleted before it is.
 *
 * A refusal leaves the branch where it was, deletes the temporary ref, and
 * keeps the copy for inspection. A fast-forward that fails partway is undone
 * (`restoreClaim`) and refused as importing nothing only once the claim is
 * proved exactly as it was — the branch, HEAD and index at the dispatched head,
 * and every directory the import touches holding the same names, byte for
 * byte, and the same files; otherwise the refusal says it was not restored and
 * names what is not as it was (`restored: false`).
 *
 * When the host sets `merge.verifySignatures`, the fast-forward verifies the
 * tip's signature before it checks anything out: Git runs the host's
 * verifier for the format the signature declares (once; twice for SSH) on the
 * sandbox's commit. The program and the files it reads are the host's, since
 * no import may change them (`configFiles`).
 */
function importBundle({ run, runPath, runId, key, worktree, branch, dispatchedHead, bundle, claimedHead, importLimits }) {
  const copy = join(runPath, `branch-${randomBytes(4).toString("hex")}.bundle`);
  const reject = (message) => existsSync(copy)
    ? { ok: false, message: `${message}; nothing was imported, and the bundle is kept at ${copy}`, preserved: copy }
    : refuse(`${message}; nothing was imported`);
  const unrestored = (message, leftover = []) => ({
    ok: false, restored: false, preserved: copy,
    message: `${message}${leftover.length ? ` (${nameList(leftover)})` : ""}; the claim worktree was NOT restored to the dispatched head ${dispatchedHead} and may hold the import's files: inspect ${worktree} and put it back on the host before the next session; the bundle is kept at ${copy}`,
  });
  const tempRef = `${IMPORT_REF_PREFIX}${key}/${runId}`;
  let host = null;
  let fetched = false;
  let imported = false;
  let attempted = false;
  try {
    writeFileSync(copy, bundle, { flag: "wx" });
    const hardened = hostGit(run, worktree);
    if (!hardened.ok) return reject(hardened.message);
    host = hardened.git;

    const before = worktreeAt(host, worktree, branch);
    if (!before.ok) return reject(before.message);
    if (before.head !== dispatchedHead) return reject(`claim worktree moved from the dispatched head ${dispatchedHead} to ${before.head}`);
    const owned = configFiles(host, worktree);
    if (!owned.ok) return reject(owned.message);

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
    const fetch = host(["-c", "fetch.fsckObjects=true", "-c", "transfer.fsckObjects=true",
      "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--no-recurse-submodules", "--no-auto-maintenance",
      copy, `${wanted}:${tempRef}`]);
    if (!fetch.ok) return reject(`cannot fetch branch.bundle into the claim worktree: ${fetch.message}`);
    const got = host(["rev-parse", "--verify", `${tempRef}^{commit}`]);
    if (!got.ok || got.stdout.trim() !== tip) return reject("the fetched tip is not the bundle's");

    const ancestor = host(["merge-base", "--is-ancestor", dispatchedHead, tip]);
    if (ancestor.status === 1) return reject(`the bundle's ${branch} (${tip}) does not descend from the dispatched head ${dispatchedHead}`);
    if (!ancestor.ok) return reject(`cannot check ancestry: ${ancestor.message}`);
    // Whether a host link resolves in the claim worktree, clean at the dispatched head: realpath reads no file.
    const resolves = (file) => {
      try { canonical(join(worktree, ...file.split("/"))); return true; } catch { return false; }
    };
    const { problems, changes, filtered } = rangeProblems({ host, worktree, dispatchedHead, tip, limits: importLimits, resolves, owned: owned.files });
    if (problems.length) return reject(`the imported commits are refused: ${problems.slice(0, 20).join("; ")}${problems.length > 20 ? `; and ${problems.length - 20} more` : ""}`);
    const count = Number(host(["rev-list", "--count", `${dispatchedHead}..${tip}`]).stdout.trim());

    const still = worktreeAt(host, worktree, branch);
    if (!still.ok || still.head !== dispatchedHead) return reject("claim worktree changed during the import");
    const untracked = untrackedProblems(host, worktree, changes);
    if (untracked.length) return reject(`the imported commits are refused: ${untracked.slice(0, 20).join("; ")}${untracked.length > 20 ? `; and ${untracked.length - 20} more` : ""}`);
    const taken = snapshot(worktree, changes);
    if (!taken.ok) return reject(taken.message);
    // The fetched objects stay; the ref goes before anything is checked out, so no command after the checkout starts updates a ref but the branch.
    const dropped = host(["update-ref", "-d", tempRef]);
    if (!dropped.ok) return reject(`cannot delete ${tempRef}: ${dropped.message}`);
    fetched = false;

    // Second layer: Git itself refuses to replace an ignored file, and moves nothing when it does.
    attempted = true;
    const merged = host(["merge", "--ff-only", "--no-overwrite-ignore", "--quiet", "--no-stat", tip]);
    if (!merged.ok) {
      const failure = `cannot fast-forward ${branch} to ${tip}: ${merged.message}`;
      const restored = restoreClaim({ host, worktree, branch, dispatchedHead, changes, before: taken.before, listings: taken.listings, filtered });
      if (!restored.ok) return unrestored(`${failure}; restoring the claim worktree failed: ${restored.why}`, restored.leftover);
      const counts = [
        `${restored.removed} ${restored.removed === 1 ? "path" : "paths"} the failed checkout created removed`,
        `${restored.rewritten} tracked ${restored.rewritten === 1 ? "path" : "paths"} it changes or deletes checked out again`,
        ...(restored.respelled ? [`${restored.respelled} ${restored.respelled === 1 ? "name" : "names"} it respelled given back ${restored.respelled === 1 ? "its" : "their"} own spelling`] : []),
      ];
      return { ...reject(`${failure}; the claim worktree is restored to the dispatched head and clean, every directory the import touches holding exactly the names and files it held (${counts.join(", ")})`), restored: true };
    }
    const after = host(["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!after.ok || after.stdout.trim() !== tip) return unrestored(`the fast-forward to ${tip} reported success, but ${branch} is ${after.ok ? `at ${after.stdout.trim()}` : "unreadable"}`);
    imported = true;
    // Unverified work: the host's own Adversary and Tester judge it next.
    return { ok: true, commits: { imported: true, from: dispatchedHead, to: tip, count, verified: false } };
  } catch (error) {
    return attempted ? unrestored(`cannot import branch.bundle: ${error.message}`) : reject(`cannot import branch.bundle: ${error.message}`);
  } finally {
    if (fetched && host) host(["update-ref", "-d", tempRef]);
    if (imported) rmSync(copy, { force: true });
  }
}
