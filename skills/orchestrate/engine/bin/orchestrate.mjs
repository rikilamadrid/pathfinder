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
 *   node bin/orchestrate.mjs plan [--feature NN] [--workers N] [--live a,b] [--json]
 *   node bin/orchestrate.mjs announce <key> [--now <iso>]
 *   node bin/orchestrate.mjs gate <key> open --question <text> | resolve [--answer <text>] [--now <iso>]
 *   node bin/orchestrate.mjs state <key> --set <state> [--gate <text>] [--last <text>] [--next <text>] [--now <iso>]
 *   node bin/orchestrate.mjs judge <key> [--timeout-ms N] [--json]
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

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { checkIntegration, formatCheck, releaseClaim } from "../integration.mjs";
import { computeBoard, formatBoard } from "../board.mjs";
import { buildBrief, formatBrief, translateBrief } from "../brief.mjs";
import { approvalScope, blockedNote, claimedNote, gateOpenedNote, gateResolvedNote, unblockedNote } from "../comments.mjs";
import { checkpointText, currentPr, selectStage } from "../stage.mjs";
import { readExperimentReport } from "../experiments.mjs";
import { readFindingsReport } from "../findings.mjs";
import { buildBundle, criteriaNeedingSummary, decide, summarizedOf, DEFAULT_TIMEOUT_MS, duplicateJudgment, evaluate, JUDGMENT_HEADING, judgmentRecord, replaceJudgment } from "../judgment.mjs";
import { loadJudge } from "../judges/registry.mjs";
import { computePlan, formatPlan } from "../plan.mjs";
import { updateStateFile } from "../statefile.mjs";
import { postNote, setGateLabel } from "../tracker.mjs";
import { renderProfile } from "../profile.mjs";
import { loadPolicy, runPolicy } from "../policies/registry.mjs";
import { profileFor } from "../route.mjs";
import { claim } from "../claim.mjs";
import { claimFor } from "../claims.mjs";
import { canonical, checkoutRoot, repositoryRoot, resolveRef } from "../git.mjs";
import { isKey } from "../keys.mjs";
import { orchestratorRefusal, readEvidenceJudge } from "../mode.mjs";
import { computeStatus, formatStatus } from "../status.mjs";
import { describeStore, readTickets, resolveStore } from "../store.mjs";

const USAGE = `orchestrate

  stage <key> [--live a,b] [--adopt | --advance | --begin-repair] [--guidance <human answer>] [--json]
      Select the recoverable session from the exact current PR and checkpoint.
      --adopt classifies an old claim once at a stopped session boundary.
      --advance checkpoints a pending phase; it never marks repair started.
      --begin-repair runs only in the owning Developer worktree before edits.
      --guidance with --advance restores a recorded failed phase after authorization.

  check <key> [--json]
      Check a done claim: candidate, behind, or conflict; overlap is advisory.

  judge <key> [--timeout-ms N] [--json]
      Ask the configured Evidence Judge whether a done claim's Tester and
      Adversary evidence supports its ticket's ## Verification items. Prints
      continue, require_evidence or escalate; exits 0 only for continue. With
      no judge configured, continue without any call. Never changes State.

  release <key> [--force --approval <human permission>] [--json]
      Remove a merged worktree, branch and claim ref. Unmerged work is refused
      unless the human explicitly authorises --force. No merge is performed.

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

  plan [--feature NN] [--workers N] [--live a,b] [--json]
      The dispatch plan: which eligible tickets one run would claim now, each
      with its execution profile; which wait, and why; stale claims, never
      re-dispatched; and the approval scope a run asks for. Reads only.

  claim  ... [--announce]
      With --announce, also post the ownership note to the ticket.

  announce <key> [--now <iso>]
      Post the ownership note for an existing claim. Idempotent.

  gate <key> open --question <text> [--now <iso>]
  gate <key> resolve [--answer <text>] [--now <iso>]
      Open: add the gate label and a note stating the question, and set the
      worker to human-gate. Resolve: remove the label, note the decision, and
      restore its pending phase. Idempotent notes.

  state <key> --set working|adversary|review|repair|human-gate|done|failed [--gate <text>]
        [--last <text>] [--next <text>] [--now <iso>]
      Update the claimed worker's state file lines, and nothing else in it.

  board ... [--comment-blocked <key>] [--comment-unblocked <key> --by <key>]
      Also post why a ticket waits, or that a completion unblocked it.

  brief <key> --harness claude-code|codex|manual [--session implementation|resume|adversary|review|repair|rebase-and-reverify|merge-and-reverify|resolve-conflict]
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
    case "stage": {
      if (!isKey(positional[0])) return fail(2, "stage needs a ticket key");
      return stage({ root, key: positional[0], gh: common.gh, live: listOf(flags.live), adopt: Boolean(flags.adopt), advance: Boolean(flags.advance), beginRepair: Boolean(flags["begin-repair"]), guidance: flags.guidance, json: Boolean(flags.json) });
    }
    case "check": {
      if (!isKey(positional[0])) return fail(2, "check needs a ticket key");
      const result = checkIntegration({ root, key: positional[0] });
      if (!result.ok) return fail(1, result.message);
      process.stdout.write(flags.json ? JSON.stringify(result, null, 2) + "\n" : formatCheck(result));
      return 0;
    }
    case "judge": {
      if (!isKey(positional[0])) return fail(2, "judge needs a ticket key");
      const timeoutMs = flags["timeout-ms"] === undefined ? DEFAULT_TIMEOUT_MS : Number(flags["timeout-ms"]);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) return fail(2, "--timeout-ms must be a whole number from 100 to 120000");
      return judge({ ...common, key: positional[0], timeoutMs, json: Boolean(flags.json) });
    }
    case "release": {
      if (!isKey(positional[0])) return fail(2, "release needs a ticket key");
      const result = releaseClaim({ root, key: positional[0], force: Boolean(flags.force), approval: flags.approval });
      if (!result.ok) return fail(1, result.message);
      process.stdout.write(flags.json ? JSON.stringify(result, null, 2) + "\n" : `released ${result.key}\n`);
      return 0;
    }
    case "board":
      return board({
        ...common,
        feature: flags.feature ?? null,
        json: Boolean(flags.json),
        commentBlocked: flags["comment-blocked"] ?? null,
        commentUnblocked: flags["comment-unblocked"] ?? null,
        by: flags.by ?? null,
        now: flags.now ?? new Date().toISOString(),
      });
    case "plan": {
      const workers = flags.workers === undefined ? 3 : Number(flags.workers);
      if (!Number.isInteger(workers) || workers < 1) return fail(2, "--workers must be a whole number of at least 1");
      return plan({ ...common, feature: flags.feature ?? null, workers, live: listOf(flags.live), json: Boolean(flags.json) });
    }
    case "announce":
      if (!isKey(positional[0])) return fail(2, `announce needs a ticket key such as 53.2\n\n${USAGE}`);
      return announce({ ...common, key: positional[0], now: flags.now ?? new Date().toISOString() });
    case "gate": {
      if (!isKey(positional[0])) return fail(2, `gate needs a ticket key such as 53.2\n\n${USAGE}`);
      const action = positional[1];
      if (action !== "open" && action !== "resolve") return fail(2, `gate needs open or resolve\n\n${USAGE}`);
      if (action === "open" && !flags.question) return fail(2, "gate open needs --question");
      return gate({
        ...common,
        key: positional[0],
        action,
        question: flags.question ?? null,
        answer: flags.answer ?? null,
        now: flags.now ?? new Date().toISOString(),
      });
    }
    case "state":
      if (!isKey(positional[0])) return fail(2, `state needs a ticket key such as 53.2\n\n${USAGE}`);
      if (!flags.set) return fail(2, "state needs --set");
      return state({
        root,
        key: positional[0],
        set: flags.set,
        gate: flags.gate ?? null,
        last: flags.last ?? null,
        next: flags.next ?? null,
        now: flags.now ?? new Date().toISOString(),
      });
    case "claim":
      if (!isKey(positional[0])) return fail(2, `claim needs a ticket key such as 53.2\n\n${USAGE}`);
      return doClaim({
        ...common,
        key: positional[0],
        slug: flags.slug ?? null,
        now: flags.now,
        announce: Boolean(flags.announce),
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
        gh: common.gh,
        store: common.store,
        live: listOf(flags.live),
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
        live: listOf(flags.live),
        json: Boolean(flags.json),
      });
    default:
      return fail(2, `unknown command \`${command}\`\n\n${USAGE}`);
  }
}

function board({ root, store: storeOverride, gh, feature, json, commentBlocked, commentUnblocked, by, now }) {
  const store = resolveStore(root, { override: storeOverride });
  const read = readTickets(root, store, { gh });
  if (!read.ok) return fail(1, read.message);
  const rows = computeBoard(read.tickets, { feature });

  if (commentBlocked) {
    const row = computeBoard(read.tickets).find((entry) => entry.key === commentBlocked);
    if (!row) return fail(1, `no ticket ${commentBlocked} in ${describeStore(store)}`);
    if (row.eligible) return fail(1, `${commentBlocked} is eligible, not blocked; no note posted`);
    const note = blockedNote({ key: row.key, waiting: row.waiting, reason: row.reason ?? "not eligible" });
    const posted = postNote({ root, store, ticket: row, note, gh });
    if (!posted.ok) return fail(1, posted.message);
    process.stderr.write(`orchestrate: ${posted.posted ? "posted the blocked note on" : posted.skipped ? "wrote no blocked note for" : "already posted the blocked note on"} ${row.key}\n`);
  }

  if (commentUnblocked) {
    if (!isKey(by ?? "")) return fail(2, "--comment-unblocked needs --by <key>, the ticket whose completion unblocked it");
    const all = computeBoard(read.tickets);
    const row = all.find((entry) => entry.key === commentUnblocked);
    const blocker = all.find((entry) => entry.key === by);
    if (!row) return fail(1, `no ticket ${commentUnblocked} in ${describeStore(store)}`);
    if (!row.eligible) return fail(1, `${commentUnblocked} is not eligible (${row.reason}); no note posted`);
    if (!blocker || blocker.status !== "Complete" || !row.blockers.includes(by)) {
      return fail(1, `${by} is not a Complete blocker of ${commentUnblocked}; no note posted`);
    }
    const posted = postNote({ root, store, ticket: row, note: unblockedNote({ key: row.key, by, now }), gh });
    if (!posted.ok) return fail(1, posted.message);
    process.stderr.write(`orchestrate: ${posted.posted ? "posted the unblocked note on" : posted.skipped ? "wrote no unblocked note for" : "already posted the unblocked note on"} ${row.key}\n`);
  }
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
  if (!routed.ok) return fail(routed.usage ? 2 : 1, routed.message);
  process.stdout.write(json ? JSON.stringify(routed.profile, null, 2) + "\n" : renderProfile(routed.profile));
  return 0;
}

function stage({ root, key, gh, live, adopt, advance, beginRepair, guidance, json }) {
  const refusal = orchestratorRefusal(root);
  if (refusal) return fail(1, refusal);
  let found = claimFor(root, key);
  if (!found || found.orphan) return fail(1, `${key} has no registered claim`);
  if (!found.stateFile) return fail(1, `${key} has no readable checkpoint`);
  if (live.includes(key) && !beginRepair) return fail(1, `${key} already has a live session`);
  const worktree = join(root, found.worktree);
  if ((adopt && (advance || beginRepair || guidance)) || (beginRepair && (advance || guidance))) return fail(2, "choose adoption, advancement or worker repair start separately");
  if (beginRepair && found.state !== "repair") return fail(1, "repair start requires the recorded pending repair phase");
  if (beginRepair && !samePath(checkoutRoot(process.cwd()) ?? "", worktree)) return fail(1, "repair start belongs to the Developer inside this claim's worktree");
  if (guidance) {
    if (!advance || !oneLine(guidance)) return fail(2, "guided failure recovery needs --advance and non-empty human guidance");
    if (found.state !== "failed" || !["working", "adversary", "review", "repair"].includes(found.failedStage)) return fail(1, "guided recovery requires failed claim with recorded Failed stage; never infer phase from Last");
    found = { ...found, state: found.failedStage };
  }
  if (adopt) {
    if (found.state === "done") return fail(1, "completed retained claim needs no adoption write");
    if (found.adversary) return fail(1, "claim already classified; missing or damaged marker is not implicit legacy");
    if (!found.stateFile) return fail(1, "cannot classify unreadable checkpoint");
    let marker = "required";
    if (found.state === "review") {
      const identity = currentPr(root, found.branch, gh);
      if (!identity.ok) return fail(1, identity.message);
      marker = `legacy-review:${identity.head}`;
    }
    const updated = updateStateFile(worktree, { set: { Adversary: marker } });
    if (!updated.ok) return fail(1, updated.message);
    process.stdout.write(`classified ${key}: ${marker}\n`);
    return 0;
  }
  const identity = found.state === "working" ? { ok: true } : currentPr(root, found.branch, gh);
  if (!identity.ok) return fail(1, identity.message);
  const result = selectStage({ claim: found, text: checkpointText(root, found), ...identity, live: beginRepair ? live.filter((entry) => entry !== key) : live });
  if (!result.ok) return fail(1, result.message);
  if (beginRepair) {
    if (result.session !== "repair") return fail(1, "repair start requires complete confirmed findings and recorded repair phase");
    if (!result.started && resolveRef(worktree, "HEAD") !== identity.head) return fail(1, "first repair worker checkout differs from current reviewed PR head");
    const updated = updateStateFile(worktree, { set: { Repair: `started:${result.repair}`, Updated: new Date().toISOString() } });
    if (!updated.ok) return fail(1, updated.message);
    result.started = true;
  }
  if (advance) {
    const set = { State: result.state, Updated: new Date().toISOString() };
    if (result.repair) {
      set.Repair = `${result.started ? "started" : "pending"}:${result.repair}`;
      if (result.legacy) set.Review = `legacy:${result.repair}`;
      set.Adversary = "required";
    }
    if (result.state === "adversary") { set.Adversary = "required"; set.Review = "ordinary"; }
    if (guidance) set.Last = `human failure-resume guidance: ${oneLine(guidance)}`;
    const updated = updateStateFile(worktree, { set, unset: guidance ? ["Failed stage"] : [] });
    if (!updated.ok) return fail(1, updated.message);
  }
  process.stdout.write(json ? JSON.stringify(result, null, 2) + "\n" : `${key}: ${result.session ?? "integration"} (${result.state})\n`);
  return 0;
}

/**
 * The Evidence Judge seam: after deterministic Tester evidence reaches done,
 * before the integrator presents the merge to the human. Deterministic checks
 * run first and a refusal there asks no provider. Writes only its own
 * checkpoint section, and nothing at all when no judge is configured.
 */
async function judge({ root, store: storeOverride, gh, key, timeoutMs, json }) {
  const refusal = orchestratorRefusal(root);
  if (refusal) return fail(1, refusal);
  const found = claimFor(root, key);
  if (!found || found.orphan || !found.stateFile) return fail(1, `${key} has no registered claim with a readable checkpoint`);
  if (found.state !== "done") return fail(1, `${key} is ${found.state ?? "unclaimed"}; the evidence judge reads only Tester-reviewed done claims`);
  const report = (result) => {
    const summarized = result.summarized_criteria?.length ? [`  judged from the Tester's summary, not the ticket's text: ${result.summarized_criteria.join(", ")}`] : [];
    process.stdout.write(json ? JSON.stringify(result, null, 2) + "\n" : [`${key}: evidence judgment ${result.decision}${result.provider ? ` (${result.provider}${result.from ? `, ${result.from}` : ""})` : ""}`, ...result.reasons.map((reason) => `  ${reason}`), ...summarized, ""].join("\n"));
    if (result.decision === "continue") return 0;
    return fail(1, `evidence judgment ${result.decision}: do not present ${key} for approval as ready; put this judgment before the human`);
  };
  const config = readEvidenceJudge(root);
  if (!config.explicit) return report({ ticket: key, provider: null, status: "not-configured", ...decide({ status: "not-configured" }) });
  const loaded = await loadJudge(config.name);
  if (!loaded.ok) return report({ ticket: key, provider: config.name, status: "failed", ...decide({ status: "failed", failure: { kind: "configuration", message: loaded.message } }) });
  const identity = currentPr(root, found.branch, gh);
  if (!identity.ok) return fail(1, identity.message);
  const checkpoint = checkpointText(root, found);
  // Before anything is asked or paid for: a result could not be written back.
  if (duplicateJudgment(checkpoint)) return fail(1, `${key}: duplicate ${JUDGMENT_HEADING} sections in ${found.worktree}/context/current-ticket.md; remove all but one. No judge was asked`);
  const stage = selectStage({ claim: found, text: checkpoint, ...identity });
  if (!stage.ok || stage.state !== "done") return fail(1, `deterministic evidence does not reach done (${stage.message ?? stage.state}); no judgment requested`);
  const store = resolveStore(root, { override: storeOverride });
  const read = readTickets(root, store, { gh });
  if (!read.ok) return fail(1, read.message);
  const ticket = read.tickets.find((entry) => entry.key === key);
  if (!ticket) return fail(1, `no ticket ${key} in ${describeStore(store)}`);

  const { judge: provider } = loaded;
  const env = Object.fromEntries(provider.environment.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
  const secrets = provider.secrets.map((name) => env[name]).filter(Boolean);
  const experiments = readExperimentReport(checkpoint);
  const built = buildBundle({
    ticket: key, body: ticket.body, pr: identity.pr, head: identity.head,
    findings: readFindingsReport(checkpoint).report, experiments: experiments.ok ? experiments.report : null, secrets,
  });
  const { record, from } = built.ok
    ? await evaluate({ bundle: built.bundle, judge: provider, checkpoint, env, timeoutMs, secrets })
    : { record: judgmentRecord({ ticket: key, pr: identity.pr, head: identity.head, judge: provider, outcome: { status: "refused", reason: built.reason } }), from: "policy" };
  if (from !== "checkpoint") {
    const path = join(root, ...found.worktree.split("/"), "context", "current-ticket.md");
    writeFileSync(path, replaceJudgment(readFileSync(path, "utf8"), record), "utf8");
  }
  // The human sees which criteria the judge read as the Tester's restatement.
  const summarized = built.ok ? summarizedOf(built.bundle) : [];
  return report({ ...record, from, summarized_criteria: summarized });
}

const JUDGE_PROSE_GUIDE = "written as judge prose (skills/orchestrate/evidence-judge.md: one plain line of at most 280 characters, letters, digits, spaces and . , ; ( ) ' % - only). Raw commands, output, logs and references stay in the raw fields and are never sent";
const JUDGE_PROJECTION = Object.freeze({
  review: `This project names an Evidence Judge. A PASS report also needs \`judge\`: one \`action_summary\` and \`observation_summary\` per \`verification\` item, in order, and a \`limits_summary\`, ${JUDGE_PROSE_GUIDE}.`,
  adversary: `This project names an Evidence Judge. Each experiment also needs \`judge\` with \`contract_attacked\`, \`action_summary\`, \`expected_result\` and \`observation_summary\`, ${JUDGE_PROSE_GUIDE}.`,
});

/** Which of the ticket's criteria the Tester must restate for the judge, read from the ticket itself. */
function criteriaGuidance(root, key, { store: storeOverride, gh }) {
  const read = readTickets(root, resolveStore(root, { override: storeOverride }), { gh });
  const ticket = read.ok ? read.tickets.find((entry) => entry.key === key) : null;
  if (!ticket) return "Any ## Verification item that is not judge prose as written also needs a `judge.criteria` entry: `criterion` (verification:N) and a judge-prose `summary` of what it requires; the raw criterion is never sent.";
  const needed = criteriaNeedingSummary(ticket.body);
  return needed.length
    ? `These ## Verification items cannot be sent to the judge as written: ${needed.join(", ")}. Add a \`judge.criteria\` entry for each, with \`criterion\` and a judge-prose \`summary\` that keeps everything it requires; the raw criterion stays local.`
    : "Every ## Verification item can be sent to the judge as written; `judge.criteria` is not needed.";
}

async function brief({ root, key, harness, session, approval, json, gh = "gh", store: storeOverride, live = [] }) {
  const found = claimFor(root, key);
  if (!found || found.orphan) return fail(1, `${key} has no registered claim to brief`);
  if (!found.profile) {
    return fail(1, `${key}'s state file carries no valid execution profile${found.profileError ? `: ${found.profileError}` : ""}`);
  }

  // The implementation selection is the one the claim recorded. A review
  // session asks the same policy again, from the same recorded estimate, so a
  // brief never depends on anything the claim did not write down.
  let selection = found.profile.selection;
  let handoff = null;
  if (["adversary", "review", "repair"].includes(session)) {
    const identity = currentPr(root, found.branch, gh);
    if (!identity.ok) return fail(1, identity.message);
    handoff = selectStage({ claim: found, text: checkpointText(root, found), ...identity, live });
    if (!handoff.ok) return fail(1, handoff.message);
    if (handoff.session !== session) return fail(1, `recorded checkpoint requires ${handoff.session ?? "integration"}, not ${session}`);
  }
  if (session === "review" || session === "adversary") {
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
    // Absolute: a worker session starts wherever its harness starts it, and
    // the brief is the only thing telling it where the work is.
    worktree: join(root, ...found.worktree.split("/")),
    main: root,
    branch: found.branch,
    selection,
    approval,
  });
  if (!built.ok) return fail(built.usage ? 2 : 1, built.message);

  if (handoff?.experiments) built.brief.protocol.push(`Adversary experiments to independently verify: ${JSON.stringify(handoff.experiments)}`);
  if (handoff?.report) built.brief.protocol.push(`Confirmed Tester findings at the original reviewed head; repair only these, not unverified experiments: ${JSON.stringify(handoff.report)}`);
  // Only a project that names a judge asks for the judge-facing projection.
  if (readEvidenceJudge(root).explicit && JUDGE_PROJECTION[session]) {
    built.brief.protocol.push(JUDGE_PROJECTION[session]);
    if (session === "review") built.brief.protocol.push(criteriaGuidance(root, key, { store: storeOverride, gh }));
  }
  const translated = translateBrief(built.brief, harness);
  if (!translated.ok) return fail(1, translated.message);

  process.stdout.write(
    json ? JSON.stringify({ brief: built.brief, translation: translated }, null, 2) + "\n" : formatBrief(built.brief),
  );
  return 0;
}

async function doClaim({ root, store, gh, key, slug, now, assessment, announce: shouldAnnounce, json }) {
  const result = await claim({ root, key, slug, store, gh, assessment, ...(now ? { now } : {}) });
  if (!result.ok) return fail(result.usage ? 2 : 1, result.message);
  if (shouldAnnounce) {
    // The claim stands whether or not the note lands. A failed announcement is
    // reported and retried with `announce`, never read as a failed claim.
    const code = announceClaim({ root, store, gh, key, now: now ?? new Date().toISOString(), profile: result.profile, branch: result.branch, worktree: result.worktree });
    result.announced = code === 0;
  }
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
    process.stdout.write(JSON.stringify({ key, claim: found, here: ownedHere, root }, null, 2) + "\n");
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

async function plan({ root, store: storeOverride, gh, feature, workers, live, json }) {
  const refusal = orchestratorRefusal(root);
  if (refusal) return fail(1, `refusing to plan: ${refusal}`);
  const store = resolveStore(root, { override: storeOverride });
  const read = readTickets(root, store, { gh });
  if (!read.ok) return fail(1, read.message);
  const planned = await computePlan({ root, tickets: read.tickets, feature, workers, live });
  if (!planned.ok) return fail(1, planned.message);
  const result = planned.plan;
  const scope = approvalScope({ scope: result.scope, keys: result.dispatch.map((entry) => entry.key), workers });
  if (json) {
    process.stdout.write(JSON.stringify({ ...result, store: describeStore(store), approval: scope }, null, 2) + "\n");
  } else {
    process.stdout.write(formatPlan(result) + (result.outcome === "dispatch" ? `\n${scope}\n` : ""));
  }
  return 0;
}

function announce({ root, store: storeOverride, gh, key, now }) {
  const found = claimFor(root, key);
  if (!found || found.orphan) return fail(1, `${key} has no registered claim to announce`);
  if (!found.profile) return fail(1, `${key}'s state file carries no valid execution profile`);
  return announceClaim({ root, store: storeOverride, gh, key, now, profile: found.profile, branch: found.branch, worktree: found.worktree });
}

function announceClaim({ root, store: storeOverride, gh, key, now, profile, branch, worktree }) {
  const store = resolveStore(root, { override: storeOverride });
  const read = readTickets(root, store, { gh });
  if (!read.ok) return fail(1, read.message);
  const ticket = read.tickets.find((entry) => entry.key === key);
  if (!ticket) return fail(1, `no ticket ${key} in ${describeStore(store)}`);
  const note = claimedNote({ key, worker: key, branch, worktree, now, profile });
  const posted = postNote({ root, store, ticket, note, gh, worktree: join(root, ...worktree.split("/")) });
  if (!posted.ok) return fail(1, `claimed ${key}, but the ownership note failed: ${posted.message}. Retry with: orchestrate announce ${key}`);
  process.stderr.write(`orchestrate: ${posted.posted ? "posted" : "already posted"} the ownership note on ${key}\n`);
  return 0;
}

function gate({ root, store: storeOverride, gh, key, action, question: rawQuestion, answer, now }) {
  let question = rawQuestion;
  const store = resolveStore(root, { override: storeOverride });
  const read = readTickets(root, store, { gh });
  if (!read.ok) return fail(1, read.message);
  const ticket = read.tickets.find((entry) => entry.key === key);
  if (!ticket) return fail(1, `no ticket ${key} in ${describeStore(store)}`);
  const found = claimFor(root, key);
  if (!found || found.orphan) {
    return fail(1, `${key} has no registered claim; a gate belongs to a worker, and there is none to stop or resume`);
  }
  const worktree = join(root, ...found.worktree.split("/"));

  if (action === "open") {
    question = oneLine(question);
    if (question === "") return fail(2, "gate open needs a non-empty --question");
    if (found.state === "human-gate" && found.gate && found.gate !== question) {
      return fail(1, `${key} is already at a human gate: ${found.gate}. Resolve it before opening another.`);
    }
    if (found.state === "done" || found.state === "failed") {
      return fail(1, `${key} is ${found.state}; a gate stops a worker that is working or in review, and this one is not`);
    }
    const updated = updateStateFile(worktree, { set: { State: "human-gate", "Gate stage": found.state === "human-gate" ? found.gateStage ?? "working" : found.state, Gate: question, Updated: now } });
    if (!updated.ok) return fail(updated.usage ? 2 : 1, updated.message);
    const label = setGateLabel({ store, ticket, present: true, gh });
    if (!label.ok) return fail(1, label.message);
    const posted = postNote({ root, store, ticket, note: gateOpenedNote({ key, question, now }), gh, worktree });
    if (!posted.ok) return fail(1, posted.message);
    process.stdout.write(`gate opened on ${key}: ${oneLine(question)}\n`);
    return 0;
  }

  // Resolve only an open gate. Its question, recorded when it opened, is what
  // the resolution note's marker names, so resolving twice cannot post twice:
  // the second call finds no open gate.
  if (found.state !== "human-gate" || !found.gate) {
    return fail(1, `${key} has no open human gate to resolve (state: ${found.state ?? "none"})`);
  }
  const recordedQuestion = found.gate;
  // Keep the local gate until both tracker writes succeed. If either fails,
  // the recorded question lets the same command retry the idempotent writes.
  const label = setGateLabel({ store, ticket, present: false, gh });
  if (!label.ok) return fail(1, label.message);
  const posted = postNote({ root, store, ticket, note: gateResolvedNote({ key, question: recordedQuestion, answer, now }), gh, worktree });
  if (!posted.ok) return fail(1, posted.message);
  {
    const set = { State: found.gateStage ?? "working", Updated: now };
    if (answer) set.Last = `gate resolved: ${oneLine(answer)}`;
    const updated = updateStateFile(worktree, { set, unset: ["Gate", "Gate stage"] });
    if (!updated.ok) return fail(updated.usage ? 2 : 1, updated.message);
  }
  process.stdout.write(`gate resolved on ${key}\n`);
  return 0;
}

function state({ root, key, set, gate: gateText, last, next, now }) {
  const found = claimFor(root, key);
  if (!found || found.orphan) return fail(1, `${key} has no registered claim whose state could be set`);
  const fields = { State: set, Updated: now };
  const unset = [];
  if (gateText && set !== "human-gate") return fail(2, "--gate is only for --set human-gate");
  if (set === "failed" && found.state !== "failed") fields["Failed stage"] = found.state === "human-gate" ? found.gateStage : found.state;
  if (set === "human-gate" && found.state !== "human-gate") fields["Gate stage"] = found.state;
  if (gateText) fields.Gate = oneLine(gateText);
  else if (set !== "human-gate") unset.push("Gate");
  if (last) fields.Last = last;
  if (next) fields.Next = next;
  if (set === "human-gate" && !gateText && !found.gate) return fail(2, "a human-gate state needs --gate <question>");
  const updated = updateStateFile(join(root, ...found.worktree.split("/")), { set: fields, unset });
  if (!updated.ok) return fail(updated.usage ? 2 : 1, updated.message);
  process.stdout.write(`${key}: state ${set}\n`);
  return 0;
}

function listOf(value) {
  return value ? String(value).split(",").map((key) => key.trim()).filter(Boolean) : [];
}

function oneLine(text) {
  return String(text ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").trim();
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
    "workers", "question", "answer", "set", "gate", "last", "next", "comment-blocked", "comment-unblocked", "by", "guidance", "timeout-ms",
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
      } else if (name === "json" || name === "help" || name === "announce" || name === "force" || name === "adopt" || name === "advance" || name === "begin-repair") {
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
