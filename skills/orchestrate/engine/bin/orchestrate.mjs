#!/usr/bin/env node
/**
 * `orchestrate` — read the board, claim a ticket, show the operator's view.
 *
 *   node bin/orchestrate.mjs board  [--feature NN] [--json]
 *   node bin/orchestrate.mjs claim  <key> [--slug <slug>] [--now <iso>] [--json]
 *   node bin/orchestrate.mjs owner  <key> [--json]
 *   node bin/orchestrate.mjs status [--feature NN] [--live a,b] [--json]
 *
 * Every command takes `--root <dir>` (default: the repository containing the
 * working directory), `--store <spec>` to override `context/tracker.md`
 * (`local`, or `github-issues:owner/repo`), and `--gh <path>` to name the
 * GitHub CLI.
 *
 * Exit codes are the contract:
 *
 *   0  the command did what it says
 *   1  a refusal, stated on stderr — a claim that cannot be made, a store the
 *      engine cannot read, a project not in orchestrator mode
 *   2  the command line was wrong
 *
 * The engine holds no state of its own. Everything it prints is re-derived
 * from git, the worktrees' state files, and the ticket store on every call.
 */

import { realpathSync } from "node:fs";
import { join } from "node:path";

import { computeBoard, formatBoard } from "../board.mjs";
import { claim } from "../claim.mjs";
import { claimFor } from "../claims.mjs";
import { checkoutRoot, repositoryRoot } from "../git.mjs";
import { isKey } from "../keys.mjs";
import { orchestratorRefusal } from "../mode.mjs";
import { computeStatus, formatStatus } from "../status.mjs";
import { describeStore, readTickets, resolveStore } from "../store.mjs";

const USAGE = `orchestrate

  board  [--feature NN] [--json]
      Every ticket in the store with its status, blockers, and whether it is
      eligible to run now. Reads only.

  claim  <key> [--slug <slug>] [--now <iso>] [--json]
      Claim one eligible ticket: a worktree at .pathfinder/worktrees/<key> on a
      new branch ticket/<key>-<slug>, seeded with the worker's state file.
      Refuses a blocked, claimed, or unknown ticket, a project not in
      orchestrator mode, and an unignored .pathfinder/.

  owner  <key> [--json]
      Which worktree, if any, owns this ticket, and whether it is the checkout
      this command runs in. The ticket lifecycle uses it to refuse a ticket
      another worker owns.

  status [--feature NN] [--live a,b] [--json]
      The operator's view: one row per ticket. Claims not named in --live are
      stale unless their state file says done or failed.

  Common: --root <dir>  --store local|github-issues:owner/repo  --gh <path>
`;

function main(argv) {
  const { command, positional, flags, error } = parse(argv);
  if (error) return fail(2, `${error}\n\n${USAGE}`);
  if (!command || flags.help) {
    process.stdout.write(USAGE);
    return command ? 0 : 2;
  }

  const root = flags.root ?? repositoryRoot(process.cwd());
  if (!root) return fail(1, "not inside a Git repository, and no --root given");
  const common = { root, store: flags.store ?? null, gh: flags.gh ?? "gh" };

  switch (command) {
    case "board":
      return board({ ...common, feature: flags.feature ?? null, json: Boolean(flags.json) });
    case "claim":
      if (!isKey(positional[0])) return fail(2, `claim needs a ticket key such as 53.2\n\n${USAGE}`);
      return doClaim({ ...common, key: positional[0], slug: flags.slug ?? null, now: flags.now, json: Boolean(flags.json) });
    case "owner":
      if (!isKey(positional[0])) return fail(2, `owner needs a ticket key such as 53.2\n\n${USAGE}`);
      return owner({ root, key: positional[0], json: Boolean(flags.json) });
    case "status":
      return status({
        ...common,
        feature: flags.feature ?? null,
        live: flags.live ? String(flags.live).split(",").map((key) => key.trim()).filter(Boolean) : [],
        json: Boolean(flags.json),
      });
    default:
      return fail(2, `unknown command \`${command}\`\n\n${USAGE}`);
  }
}

function board({ root, store: storeOverride, gh, feature, json }) {
  const store = resolveStore(root, { override: storeOverride });
  const read = readTickets(root, store, { gh });
  if (!read.ok) return fail(1, read.message);
  const rows = computeBoard(read.tickets, { feature });
  if (json) {
    process.stdout.write(JSON.stringify({ store: describeStore(store), tickets: rows }, null, 2) + "\n");
  } else {
    process.stdout.write(`Store: ${describeStore(store)}\n\n${formatBoard(rows)}`);
  }
  return 0;
}

function doClaim({ root, store, gh, key, slug, now, json }) {
  const result = claim({ root, key, slug, store, gh, ...(now ? { now } : {}) });
  if (!result.ok) return fail(1, result.message);
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(`claimed ${key}: worktree ${result.worktree} on branch ${result.branch} from ${result.base}\n`);
  }
  return 0;
}

function owner({ root, key, json }) {
  const found = claimFor(root, key);
  const here = checkoutRoot(process.cwd());
  const ownedHere =
    found !== null && !found.orphan && here !== null && samePath(join(root, ...found.worktree.split("/")), here);
  if (json) {
    process.stdout.write(JSON.stringify({ key, claim: found, here: ownedHere }, null, 2) + "\n");
    return 0;
  }
  if (!found) {
    process.stdout.write(`${key} is unclaimed\n`);
  } else if (found.orphan) {
    process.stdout.write(`${key} has branch ${found.branch} and no worktree (orphan claim)\n`);
  } else {
    process.stdout.write(`${key} is claimed by worker ${found.worker ?? key} at ${found.worktree} on ${found.branch}\n`);
  }
  return 0;
}

function status({ root, store, gh, feature, live, json }) {
  const refusal = orchestratorRefusal(root);
  if (refusal) return fail(1, `refusing to show orchestration status: ${refusal}`);
  const result = computeStatus({ root, live, feature, store, gh });
  if (!result.ok) return fail(1, result.message);
  process.stdout.write(json ? JSON.stringify(result, null, 2) + "\n" : formatStatus(result));
  return 0;
}

/** Two paths name the same directory, symlinks (macOS /var → /private/var) included. */
function samePath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

function fail(code, message) {
  process.stderr.write(`orchestrate: ${message.trimEnd()}\n`);
  return code;
}

/** `command [positional...] [--flag value | --flag]`. */
function parse(argv) {
  const flags = {};
  const positional = [];
  let command = null;
  const valued = new Set(["root", "store", "gh", "feature", "slug", "now", "live"]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = equals === -1 ? argument.slice(2) : argument.slice(2, equals);
      if (valued.has(name)) {
        const value = equals === -1 ? argv[++index] : argument.slice(equals + 1);
        if (value === undefined || value.startsWith("--")) return { error: `--${name} needs a value` };
        flags[name] = value;
      } else if (name === "json" || name === "help") {
        flags[name] = true;
      } else {
        return { error: `unknown option \`${argument}\`` };
      }
    } else if (command === null) {
      command = argument;
    } else {
      positional.push(argument);
    }
  }

  return { command, positional, flags, error: null };
}

process.exitCode = main(process.argv.slice(2));
