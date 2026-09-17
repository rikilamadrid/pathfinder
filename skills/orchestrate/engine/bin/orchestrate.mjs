#!/usr/bin/env node
/**
 * `orchestrate` — read the board, claim a ticket, show the operator's view.
 *
 *   node bin/orchestrate.mjs board  [--feature NN] [--json]
 *   node bin/orchestrate.mjs claim  <key> [--slug <slug>] [--now <iso>] [--json]
 *   node bin/orchestrate.mjs owner  <key> [--json]
 *   node bin/orchestrate.mjs status [--feature NN] [--live a,b] [--json]
 *   node bin/orchestrate.mjs estimate <key> [--risk <v> --reason <text>] [--json]
 *   node bin/orchestrate.mjs brief <key> --harness <id> [--session <s>] [--approval <text>] [--json]
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
import { buildBrief, formatBrief, translateBrief } from "../brief.mjs";
import { renderProfile } from "../profile.mjs";
import { loadPolicy, runPolicy } from "../policies/registry.mjs";
import { profileFor } from "../route.mjs";
import { claim } from "../claim.mjs";
import { claimFor } from "../claims.mjs";
import { canonical, checkoutRoot, repositoryRoot } from "../git.mjs";
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

  estimate <key> [--risk low|medium|high --reason <text>] [--json]
      The ticket's execution profile: derived complexity, context and
      parallel safety against the tickets other workers hold, risk derived or
      assessed with its reason, and the selection the routing policy makes.
      Reads only.

  brief <key> --harness claude-code|manual [--session implementation|review]
        [--approval <text>] [--json]
      The worker brief for a claimed ticket, from the profile its claim
      recorded, and how that harness would honour it. Refuses a model or
      effort the harness cannot honour, by name. Reads only.

  Common: --root <dir>  --store local|github-issues:owner/repo  --gh <path>
`;

async function main(argv) {
  const { command, positional, flags, error } = parse(argv);
  if (error) return fail(2, `${error}\n\n${USAGE}`);
  if (!command || flags.help) {
    process.stdout.write(USAGE);
    return command ? 0 : 2;
  }

  // Canonical: a root spelled through a symlink must name the same directory
  // Git reports worktrees in, or every claim reads as an orphan.
  const found = flags.root ?? repositoryRoot(process.cwd());
  const root = found ? canonical(found) : null;
  if (!root) return fail(1, "not inside a Git repository, and no --root given");
  const common = { root, store: flags.store ?? null, gh: flags.gh ?? "gh" };

  switch (command) {
    case "board":
      return board({ ...common, feature: flags.feature ?? null, json: Boolean(flags.json) });
    case "claim":
      if (!isKey(positional[0])) return fail(2, `claim needs a ticket key such as 53.2\n\n${USAGE}`);
      return doClaim({
        ...common,
        key: positional[0],
        slug: flags.slug ?? null,
        now: flags.now,
        assessment: { risk: flags.risk ?? null, reason: flags.reason ?? null },
        json: Boolean(flags.json),
      });
    case "estimate":
      if (!isKey(positional[0])) return fail(2, `estimate needs a ticket key such as 53.2\n\n${USAGE}`);
      return estimate({
        ...common,
        key: positional[0],
        assessment: { risk: flags.risk ?? null, reason: flags.reason ?? null },
        json: Boolean(flags.json),
      });
    case "brief":
      if (!isKey(positional[0])) return fail(2, `brief needs a ticket key such as 53.2\n\n${USAGE}`);
      if (!flags.harness) return fail(2, `brief needs --harness\n\n${USAGE}`);
      return brief({
        root,
        key: positional[0],
        harness: flags.harness,
        session: flags.session ?? "implementation",
        approval: flags.approval ?? "as granted by the orchestration run that dispatches this worker",
        json: Boolean(flags.json),
      });
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
    const tickets = rows.map(({ body, ...row }) => row);
    process.stdout.write(JSON.stringify({ store: describeStore(store), tickets }, null, 2) + "\n");
  } else {
    process.stdout.write(`Store: ${describeStore(store)}\n\n${formatBoard(rows)}`);
  }
  return 0;
}

async function estimate({ root, store: storeOverride, gh, key, assessment, json }) {
  const store = resolveStore(root, { override: storeOverride });
  const read = readTickets(root, store, { gh });
  if (!read.ok) return fail(1, read.message);
  const ticket = read.tickets.find((entry) => entry.key === key);
  if (!ticket) return fail(1, `no ticket ${key} in ${describeStore(store)}`);
  const routed = await profileFor({ root, ticket, tickets: read.tickets, assessment });
  if (!routed.ok) return fail(1, routed.message);
  process.stdout.write(json ? JSON.stringify(routed.profile, null, 2) + "\n" : renderProfile(routed.profile));
  return 0;
}

async function brief({ root, key, harness, session, approval, json }) {
  const found = claimFor(root, key);
  if (!found || found.orphan) return fail(1, `${key} has no registered claim to brief`);
  if (!found.profile) {
    return fail(1, `${key}'s state file carries no valid execution profile${found.profileError ? `: ${found.profileError}` : ""}`);
  }

  // The implementation selection is the one the claim recorded. A review
  // session asks the same policy again, from the same recorded estimate, so a
  // brief never depends on anything the claim did not write down.
  let selection = found.profile.selection;
  if (session !== "implementation") {
    const policy = await loadPolicy(selection.policy);
    if (!policy.ok) return fail(1, policy.message);
    const selected = runPolicy(policy, found.profile.estimate, { session, root });
    if (!selected.ok) return fail(selected.message.startsWith("session must") ? 2 : 1, selected.message);
    selection = selected.selection;
  }

  const built = buildBrief({
    ticket: key,
    title: found.title ?? key,
    ref: found.ref ?? key,
    session,
    worktree: found.worktree,
    branch: found.branch,
    selection,
    approval,
  });
  if (!built.ok) return fail(1, built.message);

  const translated = translateBrief(built.brief, harness);
  if (!translated.ok) return fail(1, translated.message);

  process.stdout.write(
    json ? JSON.stringify({ brief: built.brief, translation: translated }, null, 2) + "\n" : formatBrief(built.brief),
  );
  return 0;
}

async function doClaim({ root, store, gh, key, slug, now, assessment, json }) {
  const result = await claim({ root, key, slug, store, gh, assessment, ...(now ? { now } : {}) });
  if (!result.ok) return fail(result.usage ? 2 : 1, result.message);
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
  // Owned here only by a registered worktree under .pathfinder that is this
  // checkout. An orphan — a branch or claim ref with no such worktree — is
  // owned by nobody here, and the lifecycle stops on it too.
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
  const valued = new Set([
    "root", "store", "gh", "feature", "slug", "now", "live", "risk", "reason", "harness", "session", "approval",
  ]);

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

process.exitCode = await main(process.argv.slice(2));
