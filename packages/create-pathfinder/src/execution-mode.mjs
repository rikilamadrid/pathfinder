/**
 * How Pathfinder runs a project, recorded in the project.
 *
 * One file, `context/execution-mode.md`, whose machine-readable value is one
 * marker line in the same family as the ticket marker:
 *
 *     <!-- pathfinder:execution-mode orchestrator -->
 *
 * Everything else in the file is prose for the person who opens it. The two
 * valid values are `human-in-the-loop` and `orchestrator`. A project with no
 * file at all is a human-in-the-loop project — that is the documented default
 * and the legacy fallback, so every project installed before this file existed
 * keeps behaving exactly as it did, with no migration step.
 *
 * This module owns three things and nothing else: reading the marker, rendering
 * the file, and deciding whether this run may write it. The decision reuses the
 * adapter ownership table rather than a second one — a file carrying our marker
 * is ours to replace when told to, a file at that path without it is somebody
 * else's and is left alone without `--force`, and nothing here deletes.
 *
 * Pure except for `readExecutionModeFile`, `planExecutionMode`, and
 * `applyExecutionModePlan`, which touch the filesystem in the plan/apply
 * discipline the rest of the installer uses: the plan reads and decides, the
 * apply carries out, and `--dry-run` reports by running the identical plan.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ADAPTER_STATE, classifyOwnership } from "./harnesses/adapter.mjs";

/** The two values, in the order they are offered. The first is the default. */
export const EXECUTION_MODES = Object.freeze(["human-in-the-loop", "orchestrator"]);

/** What a project with no file is. */
export const DEFAULT_EXECUTION_MODE = EXECUTION_MODES[0];

/** Where the file lives, relative to the project root, forward slashes. */
export const EXECUTION_MODE_PATH = "context/execution-mode.md";

/** The marker token. The value follows it on the same line. */
export const EXECUTION_MODE_MARKER = "pathfinder:execution-mode";

/**
 * The marker line, parsed strictly and line by line, so a marker quoted inside
 * a longer line or a fenced block cannot be mistaken for the real one.
 */
const MARKER_PATTERN = new RegExp(`^<!--\\s*${EXECUTION_MODE_MARKER}\\s+(\\S+)\\s*-->$`);

/** The optional routing-policy marker orchestration reads beside the mode. */
// Any name the orchestration engine would read, valid or not. The installer
// preserves a project's choice; judging it is the engine's, which refuses a
// policy it does not ship rather than silently falling back to `static`.
const ROUTING_POLICY_PATTERN = /^<!--\s*pathfinder:routing-policy\s+(\S+)\s*-->$/;

// The Evidence Judge provider, preserved the same way and judged by the engine.
const EVIDENCE_JUDGE_PATTERN = /^<!--\s*pathfinder:evidence-judge\s+(\S+)\s*-->$/;

/**
 * The Evidence Judge choices this installer offers, the first the default.
 * `none` records that the project declined; the engine reads it, like no line
 * at all, as no judge. A judge is enabled only by an explicit choice — never
 * by a credential happening to be in the environment.
 */
export const EVIDENCE_JUDGE_CHOICES = Object.freeze(["none", "jev"]);

/**
 * What onboarding needs to say about each provider. Only the credential's
 * name is ever read here, to report whether it is set; its value is never
 * printed, written, or sent anywhere by the installer.
 */
export const EVIDENCE_JUDGE_PROVIDERS = Object.freeze({
  jev: Object.freeze({
    label: "Jev (TypeSafe)",
    credential: "TYPESAFE_API_KEY",
    setup: "https://docs.typesafe.ai/introduction/quickstart",
  }),
});

/** The question, and the explanation printed before it. */
export const EVIDENCE_JUDGE_QUESTION = "Enable the Jev Evidence Judge?";
export const EVIDENCE_JUDGE_EXPLANATION = Object.freeze([
  "Evidence Judge (optional)",
  "",
  "Pathfinder can use Jev to independently check whether Tester evidence",
  "supports a ticket's verification criteria before you approve a merge.",
  "Jev is a separate TypeSafe API service with its own account, API key, and",
  "credits. Your coding tool's subscription does not include it, and",
  "Pathfinder works fully without it.",
]);

/** Is `TYPESAFE_API_KEY` (or the chosen provider's credential) set? Never its value. */
export function evidenceJudgeCredential(judge, env = {}) {
  const provider = EVIDENCE_JUDGE_PROVIDERS[judge];
  if (!provider) return null;
  const value = env[provider.credential];
  return { name: provider.credential, detected: typeof value === "string" && value.trim() !== "", setup: provider.setup };
}

/**
 * Read `--evidence-judge <none|jev>`. An unknown value is refused, as an
 * unknown mode is, rather than quietly recording no judge.
 *
 * @returns {{evidenceJudge: string} | {error: string}}
 */
export function parseEvidenceJudgeFlag(value) {
  if (value === undefined || value === "" || value.startsWith("-")) {
    return { error: `\`--evidence-judge\` needs a value: ${EVIDENCE_JUDGE_CHOICES.join(" or ")}` };
  }
  if (!EVIDENCE_JUDGE_CHOICES.includes(value)) {
    return { error: `unknown evidence judge \`${value}\`. Valid values: ${EVIDENCE_JUDGE_CHOICES.join(", ")}` };
  }
  return { evidenceJudge: value };
}

/** The Evidence Judge marker in the project's mode file, or null for none or unreadable. */
export function readEvidenceJudgeFile(root) {
  const existing = readExisting(join(root, ...EXECUTION_MODE_PATH.split("/")));
  return existing.content === null ? null : readEvidenceJudgeMarker(existing.content);
}

/** The prose under the markers, true to what the judge line says. */
function evidenceJudgeProse(evidenceJudge) {
  if (evidenceJudge === "jev") {
    return [
      "The evidence-judge line enables the optional Evidence Judge in orchestrator",
      "mode. Before integration presents done work for approval, Jev, a separate",
      "TypeSafe API service, checks whether the recorded Tester and Adversary",
      "evidence supports the ticket's verification items. It reads its own API key",
      "from `TYPESAFE_API_KEY`; your coding tool does not provide one. It never",
      "approves, and its absence or failure is never approval. Run",
      "`npx create-pathfinder --evidence-judge none` to turn it off.",
    ];
  }
  if (evidenceJudge === "none") {
    return [
      "The evidence-judge line records that this project uses no Evidence Judge.",
      "Run `npx create-pathfinder --evidence-judge jev` to enable the optional Jev",
      "Evidence Judge, which needs its own TypeSafe API key.",
    ];
  }
  return [
    "An optional `<!-- pathfinder:evidence-judge <provider> -->` line names the",
    "Evidence Judge that integration asks before presenting done work. Without it",
    "no judge is asked.",
  ];
}

/** The Evidence Judge provider a file names on its own marker line, or null. */
export function readEvidenceJudgeMarker(content) {
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const match = EVIDENCE_JUDGE_PATTERN.exec(line.trim());
    if (match) return match[1];
  }
  return null;
}

/** The routing policy a file names on its own marker line, or null. */
export function readRoutingPolicyMarker(content) {
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const match = ROUTING_POLICY_PATTERN.exec(line.trim());
    if (match) return match[1];
  }
  return null;
}

/** The question, as the user reads it. Exported so tests assert on it rather than paraphrase it. */
export const EXECUTION_MODE_QUESTION = "How should Pathfinder run this project?";

/** One row per mode: the label a person chooses and the hint beside it. */
export const EXECUTION_MODE_OPTIONS = Object.freeze([
  Object.freeze({
    value: "human-in-the-loop",
    label: "Human-in-the-loop",
    hint: "one ticket at a time, with explicit human control",
  }),
  Object.freeze({
    value: "orchestrator",
    label: "Orchestrator",
    hint: "several dependency-safe ticket workers at once, every human gate kept",
  }),
]);

/** Is this one of the two values? */
export function isExecutionMode(value) {
  return EXECUTION_MODES.includes(value);
}

/**
 * Read the mode a file's contents declare.
 *
 * Returns `present: false` for no file (`content === null`). For a file, the
 * first marker line decides: `valid` is whether its value is one of the two,
 * and `mode` is the value read, whatever it was, so a caller can name the bad
 * one. A file with no marker at all is present and invalid, with `mode: null`.
 * Nothing here guesses a mode from prose.
 *
 * @param {string|null} content
 * @returns {{present: boolean, mode: string|null, valid: boolean}}
 */
export function readExecutionMode(content) {
  if (content === null || content === undefined) return { present: false, mode: null, valid: false };
  if (typeof content !== "string") return { present: true, mode: null, valid: false };

  for (const line of content.split(/\r?\n/)) {
    const match = MARKER_PATTERN.exec(line.trim());
    if (match) return { present: true, mode: match[1], valid: isExecutionMode(match[1]) };
  }

  return { present: true, mode: null, valid: false };
}

/** Does this content carry our marker at all, whatever its value? */
export function isPathfinderExecutionMode(content) {
  return readExecutionMode(content).mode !== null;
}

/**
 * Read the project's mode file.
 *
 * A missing file is `present: false`. An unreadable file — permissions, a
 * directory at that path — is reported as `unreadable` rather than as absent,
 * because "absent" is the answer that would lead a planner to write there.
 *
 * @returns {{present: boolean, mode: string|null, valid: boolean,
 *            unreadable: boolean, message?: string}}
 */
export function readExecutionModeFile(root) {
  const existing = readExisting(join(root, ...EXECUTION_MODE_PATH.split("/")));
  if (existing.unreadable) {
    return { present: true, mode: null, valid: false, unreadable: true, message: existing.message };
  }
  return { ...readExecutionMode(existing.content), unreadable: false };
}

/**
 * The effective mode of a project: the value read when the file is valid, the
 * default when there is no file. An invalid file is *not* mapped to a mode
 * here — the caller decides what to say about it — so this returns null for
 * one, and a caller that wants the safe fallback asks for it by name.
 */
export function effectiveExecutionMode(reading) {
  if (!reading.present) return DEFAULT_EXECUTION_MODE;
  return reading.valid ? reading.mode : null;
}

/**
 * The file's contents for one mode.
 *
 * Deterministic: same mode, same bytes, LF line endings, one trailing newline.
 * The marker comes first after the heading so a person sees the value before
 * the prose, and the prose says how to change it, because the file is where
 * someone will be looking when they want to.
 *
 * @param {string} mode one of EXECUTION_MODES
 * @returns {string}
 */
export function renderExecutionMode(mode, { routingPolicy = null, evidenceJudge = null } = {}) {
  if (!isExecutionMode(mode)) {
    throw new Error(`renderExecutionMode: unknown execution mode \`${mode}\``);
  }

  const meaning =
    mode === "orchestrator"
      ? [
          "Pathfinder runs this project in **orchestrator** mode: an orchestrator",
          "coordinates several dependency-safe ticket workers at once, each in its own",
          "Git worktree on its own branch, and surfaces only the human gates that need",
          "a person. Approval, acceptance, merge, and release stay the human's.",
        ]
      : [
          "Pathfinder runs this project **human-in-the-loop**: one active ticket at a",
          "time, one session, and the human drives every transition and answers every",
          "gate. This is the default, and what a project with no file at all runs.",
        ];

  return [
    "# Execution Mode",
    "",
    `<!-- ${EXECUTION_MODE_MARKER} ${mode} -->`,
    ...(routingPolicy ? [`<!-- pathfinder:routing-policy ${routingPolicy} -->`] : []),
    ...(evidenceJudge ? [`<!-- pathfinder:evidence-judge ${evidenceJudge} -->`] : []),
    "",
    ...meaning,
    "",
    "The marker line above is the value Pathfinder reads; the rest of this file is",
    "for people. The two valid values are `human-in-the-loop` and `orchestrator`.",
    "A file with any other value, or none, is invalid: the ticket lifecycle says so",
    "once and proceeds human-in-the-loop, and orchestration refuses to run.",
    "",
    "To change mode, run `npx create-pathfinder --mode <value>` again, or edit the",
    "marker line by hand. Nothing else needs to change.",
    "",
    "In orchestrator mode an optional second line,",
    "`<!-- pathfinder:routing-policy <name> -->`, names the routing policy that",
    "chooses each worker's role, model, and effort. Without it the policy is",
    "`static`.",
    "",
    ...evidenceJudgeProse(evidenceJudge),
    "",
  ].join("\n");
}

/**
 * Decide what this run may do to the mode file. Reads only.
 *
 * The same six-state ownership table the adapters use, with our marker as the
 * ownership test: `absent` → write; ours and identical → up to date; ours and
 * different → replace; not ours → conflict, which `--force` alone turns into a
 * replace. Nothing is ever deleted, and a file this run cannot read is a
 * reported error rather than a path to write over.
 *
 * @param {{targetRoot: string, mode: string, force?: boolean}} input
 * @returns {{relativePath: string, destination: string, mode: string,
 *            state: string, action: "write"|"replace"|"up-to-date"|"conflict"|"unreadable",
 *            contents: string|null, message?: string}}
 */
export function planExecutionMode({ targetRoot, mode, force = false, evidenceJudge = undefined }) {
  const relativePath = EXECUTION_MODE_PATH;
  const destination = join(targetRoot, ...relativePath.split("/"));
  const existing = readExisting(destination);
  // A routing policy or evidence judge the project chose survives a mode
  // change: rewriting the mode is not a decision about either. Dropping the
  // judge silently would turn its checks off without anyone deciding to.
  // An explicit choice, `none` included, replaces it; no choice keeps it.
  const ours = isPathfinderExecutionMode(existing.content);
  const routingPolicy = ours ? readRoutingPolicyMarker(existing.content) : null;
  const previousEvidenceJudge = ours ? readEvidenceJudgeMarker(existing.content) : null;
  const judge = evidenceJudge === undefined ? previousEvidenceJudge : evidenceJudge;
  const previousMode = ours ? readExecutionMode(existing.content).mode : null;
  const contents = renderExecutionMode(mode, { routingPolicy, evidenceJudge: judge });
  const choice = { evidenceJudge: judge, previousEvidenceJudge, previousMode };

  if (existing.unreadable) {
    return {
      relativePath,
      destination,
      mode,
      state: ADAPTER_STATE.CONFLICT,
      action: "unreadable",
      contents: null,
      message: existing.message,
      ...choice,
    };
  }

  const state = classifyOwnership({
    existing: existing.content,
    expected: contents,
    ours: isPathfinderExecutionMode(existing.content),
    shipped: true,
  });

  return { relativePath, destination, mode, state, action: actionFor(state, force), contents, ...choice };
}

function actionFor(state, force) {
  switch (state) {
    case ADAPTER_STATE.ABSENT:
    case ADAPTER_STATE.STALE:
      return state === ADAPTER_STATE.ABSENT ? "write" : "replace";
    case ADAPTER_STATE.CURRENT:
      return "up-to-date";
    default:
      return force ? "replace" : "conflict";
  }
}

/**
 * Carry out a mode plan.
 *
 * Same outcome vocabulary as the adapter and hook plans, so the summary can
 * speak of it in the same voice: a conflict is an outcome, not an error — the
 * file it names is the one this tool successfully left alone — and only an
 * unreadable path or a failed write is a failure. `onProgress` fires once,
 * after the item resolves, exactly as the other apply functions do.
 *
 * A null plan — nothing was asked and nothing was flagged — applies to nothing
 * and returns the empty result, so callers need no guard.
 *
 * @returns {{action: string|null, mode: string|null, relativePath: string,
 *            errors: {relativePath: string, message: string}[]}}
 */
export function applyExecutionModePlan(item, { dryRun = false, onProgress } = {}) {
  const result = { action: null, mode: null, relativePath: EXECUTION_MODE_PATH, errors: [], evidenceJudge: null, previousMode: null };
  if (!item) return result;

  result.action = item.action;
  result.mode = item.mode;
  result.evidenceJudge = item.evidenceJudge ?? null;
  result.previousMode = item.previousMode ?? null;

  switch (item.action) {
    case "up-to-date":
    case "conflict":
      onProgress?.({ item, ok: true });
      return result;
    case "unreadable":
      result.errors.push({ relativePath: item.relativePath, message: item.message });
      onProgress?.({ item, ok: false });
      return result;
    default:
      break;
  }

  if (!dryRun) {
    try {
      mkdirSync(dirname(item.destination), { recursive: true });
      writeFileSync(item.destination, item.contents, "utf8");
    } catch (error) {
      result.errors.push({ relativePath: item.relativePath, message: error.message });
      onProgress?.({ item, ok: false });
      return result;
    }
  }

  onProgress?.({ item, ok: true });
  return result;
}

/**
 * Read `--mode <value>`.
 *
 * An unknown value is a refusal, not a warning that falls back to the default:
 * someone who typed `--mode orchestrater` wants orchestration, and quietly
 * recording human-in-the-loop while exiting 0 would tell them it worked. Both
 * valid values are named in the message, because the whole list is the answer.
 *
 * @returns {{mode: string} | {error: string}}
 */
export function parseExecutionModeFlag(value) {
  if (value === undefined || value === "" || value.startsWith("-")) {
    return { error: `\`--mode\` needs a value: ${EXECUTION_MODES.join(" or ")}` };
  }
  if (!isExecutionMode(value)) {
    return { error: `unknown execution mode \`${value}\`. Valid values: ${EXECUTION_MODES.join(", ")}` };
  }
  return { mode: value };
}

/**
 * Read a file that may not be there.
 *
 * Missing is `content: null`; unreadable is a separate answer, for the reason
 * `install.mjs` gives: treating a permissions error as absence would classify
 * somebody's file as "write here".
 */
function readExisting(path) {
  try {
    return { content: readFileSync(path, "utf8"), unreadable: false };
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      return { content: null, unreadable: false };
    }
    return { content: null, unreadable: true, message: error.message };
  }
}
