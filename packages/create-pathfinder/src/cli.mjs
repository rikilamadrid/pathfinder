/**
 * Command-line surface: parse arguments, refuse unsafe situations, report.
 *
 * No CLI framework. The flag set is a handful of booleans and the whole parser
 * is a loop; a dependency tree for that would be indefensible in a project
 * whose identity is "not a framework."
 */

import { findKitRoot, COPY_LIST, VERSION } from "./kit.mjs";
import { applyAdapterPlan, applyPlan, planAdapters, planInstall } from "./install.mjs";
import { detect, detectedToolLabels } from "./detect.mjs";
import { initRepository } from "./git.mjs";
import { nonInteractivePrompter } from "./prompt.mjs";
import { copyToClipboard } from "./clipboard.mjs";
import { detectEditors, openInEditor } from "./editor.mjs";
import { kickstartPrompt, kickstartPromptLines } from "./kickstart-prompt.mjs";
import { createTheme } from "./theme.mjs";
import { createProgress } from "./progress.mjs";
import { summarize } from "./outcome.mjs";
import {
  HARNESSES,
  HARNESS_IDS,
  detectedHarnesses,
  findHarness,
  harnessNamed,
} from "./harnesses/index.mjs";

const USAGE = `Usage: npx create-pathfinder [options]

Installs the Pathfinder workflow kit into the current Git repository.

Copies: ${COPY_LIST.join(", ")}

Options:
  --agents <ids>  Generate skill adapters for these tools, comma-separated.
                  Valid ids: ${HARNESS_IDS.join(", ")}. Alias: --agent.
                  Without it, nothing is configured unless you are asked and
                  say so.
  --dry-run       Report what would be written, and any \`git init\` that would
                  run first; change nothing and ask nothing.
  --force         Overwrite files that already exist, and replace a file you
                  wrote at a path an adapter would occupy. Off by default.
  --git-init      Run \`git init\` here if this is not a repository yet.
  --no-git-init   Never run \`git init\`; refuse instead.
  --no-clipboard  Never offer to copy the Kickstart prompt. The prompt is
                  printed either way.
  --no-open       Never offer to open the project in an editor.
  --yes           Take the defaults and ask nothing. Alias: --no-input.
                  It does not authorize \`git init\` or configure any tool;
                  pass --git-init and --agents for those.
  -h, --help      Show this message.

Adapters are generated files Pathfinder owns and regenerates without --force.
A file it did not generate is never replaced, at any path, without --force.

Environment:
  PATHFINDER_PROMPT=classic
                  Ask every question as a numbered list and y/n instead of an
                  arrow-key selector. Both are supported; use this for screen
                  readers, for scripts, or simply if you prefer typing. It is
                  also what a terminal narrower than 49 columns and TERM=dumb
                  select on their own.
  NO_COLOR        Print no colour. It does not disable the selector.

Without a terminal on both stdin and stdout, nothing is ever asked. In that
case a directory that is not a Git repository needs --git-init, or the install
is refused, and neither your clipboard nor an editor is touched — --yes does
not authorize either one.
`;

export async function run(
  argv,
  {
    cwd,
    out,
    err,
    env = {},
    platform = process.platform,
    stdoutIsTTY = false,
    theme: injectedTheme = null,
    prompter = nonInteractivePrompter(),
  },
) {
  const options = parseArguments(argv);

  if (options.error) {
    err(`create-pathfinder: ${options.error}\n\n${USAGE}`);
    return 2;
  }

  if (options.help) {
    out(USAGE);
    return 0;
  }

  // Detection runs before anything is decided and before anything is asked, so
  // the user reads what the tool found before reading what it wants to do.
  const findings = detect({ cwd, env, platform });

  // Every capability question this run will ask is answered once and threaded
  // downward as an argument rather than reached for: a module-level theme would
  // be a second opinion about the terminal that no test could disagree with.
  //
  // Built here when nobody supplied one, which is every test and every caller
  // that has nothing to say about stdin. `bin/` supplies one because it knows
  // things this function is never handed — whether stdin is a terminal, whether
  // it can be put into raw mode, how wide the window is — and those are exactly
  // the three the selection capability is decided from. Accepting it keeps the
  // property this comment has always claimed: one theme per run, not one per
  // module that wants an opinion.
  const theme = injectedTheme ?? createTheme({ env, platform, isTTY: stdoutIsTTY });
  const mark = theme.glyph;

  // The one branch in this file that chooses between whole presentations, and
  // the reason the theme exposes `tier` at all.
  //
  // `contract` is a promise, not a fallback: a piped run, a CI log, and
  // `> install.txt` get the bytes 1.4.1 produced, and no amount of ambition in
  // this feature reaches them. Written as a tier test rather than as
  // `if (stdoutIsTTY)` — the two are the same value by construction, but only
  // one of them says why, and the next person to add a decorated block here
  // needs to read the reason and not rediscover it.
  //
  // The identity block rides on the same test. `--help` never reaches this line
  // (it returns above), which is how it keeps its plain reference form.
  if (theme.tier !== "contract") {
    out(formatIdentity({ theme }));
    out(formatFindings(findings, { theme }));
  }

  // Refused rather than allowed with a warning: this tool writes several
  // hundred files, and without version control the user has no way to inspect
  // or undo what it did. What is new in this chunk is that the refusal is no
  // longer the only outcome — the tool may offer to satisfy the requirement.
  let gitRoot = findings.git.repositoryRoot;
  let initializeGit = false;

  if (gitRoot === null) {
    const decision = await decideGitInit({ findings, options, prompter, cwd, out });
    if (!decision.approved) {
      err(decision.message);
      return 1;
    }
    initializeGit = true;
    // The repository we are about to create is this directory, so every check
    // and every message downstream reads the same as if it had always been one.
    gitRoot = cwd;
  }

  const kitRoot = findKitRoot();
  if (kitRoot === null) {
    err(
      "create-pathfinder: this package is missing the kit files it should copy.\n" +
        "That is a packaging bug, not something you did. Please report it at\n" +
        "https://github.com/rikilamadrid/pathfinder/issues\n",
    );
    return 1;
  }

  if (kitRoot === gitRoot) {
    err(
      "create-pathfinder: this is the Pathfinder kit repository itself.\n" +
        "There is nothing to install here. Run it in the project you want the\n" +
        "kit copied into.\n",
    );
    return 1;
  }

  // Deliberately after both kit checks. Approval to initialize is not approval
  // to leave a `.git` behind for an install that was never going to happen:
  // a broken package and the kit repository itself both bail out above, with
  // the directory exactly as they found it.
  if (initializeGit) {
    if (options.dryRun) {
      out(`  ${mark.info} Would run \`git init\` in ${cwd}\n\n`);
    } else {
      const initialized = initRepository(cwd);
      if (!initialized.ok) {
        err(
          "create-pathfinder: `git init` failed, so nothing was installed.\n\n" +
            `${indent(initialized.message)}\n\n` +
            "Fix that, or run `git init` yourself, then run this again.\n",
        );
        return 1;
      }
      out(`  ${mark.ok} git init ${mark.dash} initialized an empty repository in ${cwd}\n\n`);
    }
  }

  // Asked before anything is written, so every question this run has is behind
  // the user before the first file moves. Detection supplies the default and
  // nothing more: a tool being installed on this machine is not permission to
  // write into the project on its behalf.
  const { harnesses, customTools } = await selectHarnesses({
    findings,
    options,
    prompter,
    out,
    theme,
  });

  const plan = planInstall(kitRoot, cwd, { force: options.force });

  // Both plans are computed before anything is written, which is what lets the
  // progress bar state a real denominator instead of discovering its own total
  // as it goes.
  //
  // Planning adapters this early is safe, and specifically because of what the
  // copy list contains: AGENTS.md, CLAUDE.md, context, roles, skills, and
  // templates.
  // No entry writes into `.claude/` or `.agents/`, so the copy cannot change
  // the answer `planAdapters` gives about an adapter path, and the canonical
  // skills it reads come from the kit rather than from the destination. If a
  // future entry ever does write to an adapter path, this has to move back.
  //
  // Applying them stays where it was, after the copy: an adapter delegates to a
  // canonical file, so generating one beside a copy that failed would point the
  // user's tool at a file that is not there.
  const adapterPlan =
    harnesses.length > 0
      ? planAdapters(harnesses, { kitRoot, targetRoot: cwd, force: options.force })
      : [];

  // Zero on a dry run, which disables the bar. A dry run carries nothing out,
  // and a bar filling for work that is not happening would be the exact species
  // of theatre this treatment was designed to avoid.
  const progress = createProgress({
    theme,
    total: options.dryRun ? 0 : plan.length + adapterPlan.length,
    out,
  });

  if (!options.dryRun && theme.tier !== "contract") {
    out(`  ${mark.box}  ${theme.bold("INSTALLING")}\n`);
  }

  const result = applyPlan(plan, {
    dryRun: options.dryRun,
    onProgress: (unit) => progress.advance(unit),
  });

  progress.milestone(
    result.errors.length > 0
      ? railed(theme, theme.warn(`${mark.warn} Kit files`) + ` ${mark.dash} ${result.errors.length} could not be written`)
      : railed(
          theme,
          countWritten(result, plan, options) > 0
            ? theme.ok(`${mark.ok} Kit files`) + ` ${mark.dash} ${theme.bold(countWritten(result, plan, options))} copied`
            : theme.info(`${mark.info} Kit files`) + ` ${mark.dash} already in place`,
        ),
  );

  const adapters = generateAdapters({
    plan: adapterPlan,
    harnesses,
    options,
    result,
    onProgress: (unit) => progress.advance(unit),
    onHarnessDone: (harness, counts) =>
      progress.milestone(
        railed(
          theme,
          counts.conflicts > 0
            ? theme.warn(`${mark.warn} ${harness.label}`) +
                ` ${mark.dash} ${counts.done} adapters, ${counts.conflicts} left alone`
            : theme.ok(`${mark.ok} ${harness.label}`) + ` ${mark.dash} ${theme.bold(counts.done)} adapters`,
        ),
      ),
  });

  progress.finish();
  if (!options.dryRun && theme.tier !== "contract") out("\n");

  // Derived here, once, and handed down. Below this line nothing re-reads a
  // plan or a result: the two renderings disagree about everything except the
  // facts, and this is what makes "except the facts" true rather than a hope
  // about two functions being edited together.
  const outcome = summarize({ plan, result, adapters, harnesses, options });

  report({ outcome, harnesses, customTools, cwd, gitRoot, options, out, err, theme });

  // After the report, because the first offer is about the prompt the report
  // just printed — and because a question above the summary would make the user
  // answer before seeing what happened. Every run that gets this far printed a
  // prompt, including one that wrote no files, so there is nothing to guard on.
  await offerOnboardingActions({ harnesses, cwd, options, prompter, out, env, platform, theme });

  // The last line of the run, and the reason it is here rather than in the
  // report: the report is followed by two questions, so anything printed there
  // would not be last. Before this, a successful first run ended on
  // "Opening VS Code." — the tool installed several hundred files and then
  // signed off with a subordinate clause about somebody else's editor.
  //
  // Not printed when anything failed. A sign-off over an error is a tool that
  // did not read its own output.
  const failed = outcome.failures.length > 0;
  if (theme.tier !== "contract" && !failed) {
    out(`\n  ${theme.dim(SIGN_OFF)}\n`);
  }

  // Neither offer can change this. An install that wrote every file succeeded
  // whether or not the machine has `pbcopy` or an editor on it.
  return failed ? 1 : 0;
}

/**
 * The list's last entry, which is not a harness and never becomes one.
 *
 * A sentinel rather than a registry row, because everything about a harness —
 * a path, a detection, a rendered file — is exactly what this option does not
 * have. Putting it in `HARNESSES` would mean every loop that writes files
 * needing to remember to skip it, and one that forgot would generate adapters
 * into a directory named after a tool that cannot read them.
 */
const SOMETHING_ELSE = Object.freeze({ label: "Something else" });

/** How many custom names one run will take before it stops asking. */
const CUSTOM_TOOL_LIMIT = 10;

/** What a tool may be called here: letters, digits, and the punctuation names use. */
const CUSTOM_TOOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,39}$/;

/**
 * Which harnesses this run configures, and which tools it was told about but
 * cannot configure. Possibly neither, which is the default.
 *
 * Three ways to answer, in precedence order: `--agents` says it outright, an
 * interactive terminal is asked, and everything else configures nothing. That
 * last one is what keeps a scripted run byte-identical to 1.4.1 — a CI job that
 * has always piped this command sees no new files and no new output.
 *
 * `--agents` cannot name an unsupported tool: an id the registry does not know
 * exits 2 rather than being recorded, because a flag is how a script asks for
 * files and there is no honest way to half-satisfy that. "Something else…"
 * exists in the question, where a person is there to read the answer.
 *
 * An unanswered prompt is read as "none", the same conservative reading the
 * Git question gives it.
 *
 * @returns {Promise<{harnesses: object[], customTools: string[]}>}
 */
async function selectHarnesses({ findings, options, prompter, out, theme }) {
  if (options.agents !== null) {
    return { harnesses: options.agents.map((id) => findHarness(id)), customTools: [] };
  }
  if (!prompter.interactive || options.yes) return { harnesses: [], customTools: [] };

  const detected = detectedHarnesses(findings);
  const entries = [...HARNESSES, SOMETHING_ELSE];

  // The sentinel's trailing ellipsis is the theme's, not a character baked into
  // the label: an ASCII terminal spends three characters on `...` where a UTF-8
  // one spends one.
  const labelOf = (entry) =>
    entry === SOMETHING_ELSE ? `${entry.label}${theme.glyph.ellipsis}` : entry.label;

  // Three fields instead of one hand-built string.
  //
  // This used to compute the longest label and `padEnd` every other one to it,
  // so that the `->` arrows lined up — a column of layout, measured in UTF-16
  // units, inside a file whose job is deciding which tools to configure. It was
  // wrong in the way `.length` is always wrong about a terminal, and it was
  // wrong twice over: it produced a *rendering* that only one of the two
  // question implementations could use.
  //
  // Now the call site says what each part *is* and the renderer decides where it
  // goes. Both implementations get the same three fields and lay them out their
  // own way, and neither this function nor any other in this file measures a
  // string in cells.
  const answer = await prompter.chooseMany("Configure Pathfinder for which tools?", {
    options: entries.map((entry) => ({
      value: entry,
      label: labelOf(entry),
      // The path is shown so nobody has to check a box to find out what it
      // writes. The last entry earns the same courtesy by admitting it writes
      // nothing, in the column where every other row names a file.
      hint: entry === SOMETHING_ELSE ? "nothing is generated" : `${entry.skillsDir}/`,
      // Detection decides the default; this only says so out loud. It is the
      // one part of a row a narrow terminal may drop, because the ENVIRONMENT
      // block above has already reported it.
      note: entry !== SOMETHING_ELSE && detected.includes(entry) ? "(detected)" : undefined,
    })),
    defaultSelection: detected,
  });

  out("\n");

  const chosen = answer ?? [];
  const harnesses = chosen.filter((entry) => entry !== SOMETHING_ELSE);
  const customTools = chosen.includes(SOMETHING_ELSE)
    ? await askCustomTools({ prompter, out, theme })
    : [];

  return { harnesses, customTools };
}

/**
 * Collect the names of tools Pathfinder does not support.
 *
 * Nothing is generated from these and nothing is stored — they exist only so
 * the summary can name what it is declining to do. That is the whole feature:
 * an answer a person can act on beats a directory full of files their tool
 * will never read.
 *
 * The loop is bounded three ways: an empty line, an ended stream, and a hard
 * ceiling. The ceiling is not a guess about how many tools anyone uses; it is
 * there because a question that repeats itself is a question that can repeat
 * itself forever on a stream that never closes.
 */
async function askCustomTools({ prompter, out, theme }) {
  out(
    "Pathfinder generates adapters only for tools it can generate them for.\n" +
      "Name the others and the summary will say what does work for them.\n\n",
  );

  const names = [];

  while (names.length < CUSTOM_TOOL_LIMIT) {
    const answer = await prompter.text("Which tool? (Enter when done)");

    // "" is done and null is nobody there. Both stop, and neither is an error.
    if (answer === null || answer === "") break;

    const supported = harnessNamed(answer);
    if (supported !== null) {
      out(
        `  ${supported.label} is supported ${theme.glyph.dash} it is in the list above, and writes to\n` +
          `  ${supported.skillsDir}/. Choose it there, or pass --agents ${supported.id}.\n\n`,
      );
      continue;
    }

    if (!CUSTOM_TOOL_PATTERN.test(answer)) {
      // Nothing is built from this name, so the risk is not injection but a
      // summary that says something other than what was typed. A name this
      // tool cannot print back faithfully is one it should not accept.
      out("  Letters, digits, spaces, and . _ + - only, up to 40 characters.\n\n");
      continue;
    }

    if (names.some((name) => name.toLowerCase() === answer.toLowerCase())) continue;
    names.push(answer);
  }

  if (names.length > 0) out("\n");
  return names;
}

/**
 * Generate the adapters for the selected harnesses, or explain why not.
 *
 * Returns the plan and the result together so the report can distinguish "no
 * harness was chosen" from "a harness was chosen and produced nothing", which
 * are the same zero and mean opposite things.
 */
function generateAdapters({ plan, harnesses, options, result, onProgress, onHarnessDone }) {
  const none = { plan: [], result: applyAdapterPlan([]), blocked: false };

  if (harnesses.length === 0) return none;

  // The copy failed part-way. Reporting adapters as generated on top of that
  // would be a success message about a broken install.
  //
  // The progress bar is deliberately left short here rather than topped up.
  // These units were planned and never carried out, and a bar that reached 100%
  // anyway would be the one thing it must never do — agree with itself while
  // disagreeing with the error the user is about to read.
  if (result.errors.length > 0) return { ...none, blocked: true };

  // A milestone per harness, emitted when that harness's last unit resolves
  // rather than after the whole phase, so the lines appear as the work happens.
  // The plan is grouped by harness because `planAdapters` walks the harnesses in
  // order, so a change of harness is the boundary — no second pass needed.
  let current = null;
  let counts = { done: 0, conflicts: 0 };

  const flush = () => {
    if (current) onHarnessDone?.(current, counts);
  };

  const applied = applyAdapterPlan(plan, {
    dryRun: options.dryRun,
    onProgress: (unit) => {
      if (current && unit.item.harness !== current) {
        flush();
        counts = { done: 0, conflicts: 0 };
      }
      current = unit.item.harness;
      if (unit.item.action === "conflict") counts.conflicts += 1;
      else if (unit.ok) counts.done += 1;
      onProgress?.(unit);
    },
  });

  flush();

  return { plan, result: applied, blocked: false };
}

/**
 * The one line under the closing headline: what this run actually did.
 *
 * Counts rather than adjectives, because "success" is not information and the
 * person reading has just watched a bar fill. A re-run that wrote nothing says
 * so plainly instead of inventing an achievement.
 */
function endingHeadline({ theme, outcome, options }) {
  const mark = theme.glyph;
  const { written, built, attention } = outcome;

  // Something wants a human. Still ready — it is — but this is not the moment
  // for confetti over somebody's conflicted file.
  if (attention > 0) return theme.ok(`${mark.ok} READY`);

  // Nothing to do, and nothing wrong. A tool that throws a party for doing no
  // work is a tool whose party means nothing.
  if (written === 0 && built === 0 && !options.dryRun) {
    return theme.ok(`${mark.ok} ALREADY UP TO DATE`);
  }

  // The emotional peak, and the only place it is earned.
  return `${mark.party}  ${theme.brand(options.dryRun ? "READY WHEN YOU ARE" : "YOU'RE ALL SET")}`;
}

/**
 * The one line under the closing headline: what this run actually did.
 *
 * Counts rather than adjectives, because "success" is not information and the
 * person reading has just watched a bar fill. A run that changed nothing says
 * so plainly instead of inventing an achievement out of the harnesses it did
 * not have to configure.
 */
function endingDetail({ outcome, harnesses, options }) {
  const parts = [];
  const { written, built, attention } = outcome;

  if (written > 0) parts.push(`${written} file${plural(written)}`);
  if (built > 0) parts.push(`${built} adapter${plural(built)}`);
  if (built > 0 && harnesses.length > 0) {
    parts.push(joinNames(harnesses.map((harness) => harness.label)));
  }

  if (parts.length === 0) {
    parts.push(options.dryRun ? "nothing to write" : "everything was already in place");
  }

  if (attention > 0) parts.push(`${attention} thing${plural(attention)} to look at above`);

  return parts.join(", ");
}

/** `ok` for a count that did something, `info` for one that did not. */
function tally(theme, count) {
  return count > 0 ? theme.ok : theme.info;
}

/** One line inside a phase block, hung off the gutter. */
function railed(theme, text) {
  return `  ${theme.dim(theme.glyph.gutter)}  ${text}`;
}

/**
 * How many files the copy put down, phrased for whichever mode this is.
 *
 * A dry run has no `result.written` worth reporting, so the plan is counted
 * instead — the same number the summary underneath will state.
 */
function countWritten(result, plan, options) {
  if (options.dryRun) return plan.filter((item) => item.status === "write").length;
  return result.written + result.overwritten;
}

function parseArguments(argv) {
  const options = {
    dryRun: false,
    force: false,
    help: false,
    gitInit: false,
    noGitInit: false,
    noClipboard: false,
    noOpen: false,
    yes: false,
    // null means "not said", which is not the same as "none". Only the first
    // suppresses the question.
    agents: null,
    error: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    const isAgents =
      argument === "--agents" ||
      argument === "--agent" ||
      argument.startsWith("--agents=") ||
      argument.startsWith("--agent=");

    if (isAgents) {
      const equals = argument.indexOf("=");
      const value = equals === -1 ? argv[++index] : argument.slice(equals + 1);
      const parsed = parseAgents(value);

      if (parsed.error) {
        options.error = parsed.error;
        return options;
      }

      options.agents = [...new Set([...(options.agents ?? []), ...parsed.ids])];
      continue;
    }

    switch (argument) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--git-init":
        options.gitInit = true;
        break;
      case "--no-git-init":
        options.noGitInit = true;
        break;
      case "--no-clipboard":
        options.noClipboard = true;
        break;
      case "--no-open":
        options.noOpen = true;
        break;
      // `--yes` silences questions. It does not answer the Git one: authorizing
      // the creation of a repository is the single thing in this tool that has
      // to be said out loud, and "assume yes to everything" is exactly the kind
      // of blanket that should not cover it.
      case "--yes":
      case "--no-input":
        options.yes = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        options.error = `unknown option \`${argument}\``;
        return options;
    }
  }

  if (options.gitInit && options.noGitInit) {
    options.error = "`--git-init` and `--no-git-init` contradict each other";
  }

  return options;
}

/**
 * Read `--agents claude-code,codex`.
 *
 * An unknown id is a refusal, not a warning that drops it: someone who typed
 * `--agents claud-code` wants adapters, and quietly installing none while
 * exiting 0 would tell them it worked. The valid ids are named in the message,
 * because the whole list is short enough to be the answer.
 */
function parseAgents(value) {
  if (value === undefined || value.startsWith("-")) {
    return { error: "`--agents` needs a value, such as `--agents " + HARNESS_IDS[0] + "`" };
  }

  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");

  if (ids.length === 0) {
    return { error: "`--agents` needs a value, such as `--agents " + HARNESS_IDS[0] + "`" };
  }

  const unknown = ids.find((id) => findHarness(id) === null);
  if (unknown !== undefined) {
    return { error: `unknown agent \`${unknown}\`. Valid ids: ${HARNESS_IDS.join(", ")}` };
  }

  return { ids };
}

/**
 * May this directory become a repository?
 *
 * The four ways to reach "no" are kept apart because they are four different
 * situations for the person reading the message: they said no, they said never,
 * nobody was there to ask, or the machine cannot do it at all. Only the last of
 * those makes `--git-init` bad advice, which is why it is checked before the
 * flags — offering a flag that cannot work would be worse than the refusal it
 * replaced.
 *
 * Asks nothing unless the answer is genuinely unknown *and* someone is there to
 * answer. Returns rather than exits: the caller owns the exit code.
 *
 * @returns {{approved: true} | {approved: false, message: string}}
 */
async function decideGitInit({ findings, options, prompter, cwd, out }) {
  if (!findings.git.binary) {
    return {
      approved: false,
      message:
        `create-pathfinder: ${cwd} is not inside a Git repository, and \`git\`\n` +
        "is not available to create one.\n\n" +
        "The kit is installed into version control so you can review the files\n" +
        "it adds and undo them if you change your mind. Install Git\n" +
        "(https://git-scm.com/downloads), or cd into an existing repository,\n" +
        "then run this again.\n",
    };
  }

  if (options.noGitInit) return { approved: false, message: refusal(cwd) };
  if (options.gitInit) return { approved: true };

  // `--dry-run` needs no permission, because there is nothing to permit. The
  // spec forbids asking a question whose only purpose is to authorize an action
  // that will not be taken, and this is that question: the file plan is the
  // same whatever the answer, so the prompt would buy a report the tool could
  // have written anyway. Reporting the `git init` it *would* run is the whole
  // point of the mode — telling someone "no" about work nobody was going to do
  // withholds the one thing they asked for.
  if (options.dryRun) return { approved: true };

  // The TTY guard. Both ends must be a terminal, and `--yes` opts out on the
  // user's behalf. Below this line the tool is scriptable: it asks nothing,
  // prints no question, and refuses the way 1.4.1 did.
  if (!prompter.interactive || options.yes) return { approved: false, message: refusal(cwd) };

  out(
    "Pathfinder installs into version control so you can review what it wrote\n" +
      "and undo it. It will not touch an existing history.\n\n",
  );

  const answer = await prompter.confirm("Initialize a Git repository here?", {
    defaultAnswer: true,
  });

  if (answer === true) return { approved: true };

  // `false` is a decision and `null` is an unanswerable prompt — a closed
  // stdin, or input that never resolved to a yes or a no. Both land here,
  // because the only safe reading of "no usable approval" is that there is no
  // approval. Declining is not an error, but it is still a refusal to install.
  return {
    approved: false,
    message:
      "\nNothing was installed.\n\n" +
      "Pathfinder writes the whole kit into your project. Without version\n" +
      "control there is no way to review or undo that, so it will not run\n" +
      "outside a repository.\n\n" +
      "Run `git init` here yourself and try again, or cd into an existing\n" +
      "repository.\n",
  };
}

/**
 * The 1.4.1 refusal, plus the one sentence this feature earns the right to add.
 *
 * Byte-identical to what `1.4.1` printed through the final line, so every
 * non-interactive scenario that existed before this feature still reads the
 * same; the flag is named after it rather than woven into it.
 */
function refusal(cwd) {
  return (
    `create-pathfinder: ${cwd} is not inside a Git repository.\n\n` +
    "The kit is installed into version control so you can review the\n" +
    "files it adds and undo them if you change your mind. Run `git init`\n" +
    "here first, or cd into an existing repository, then run this again.\n" +
    "\nTo have this command run `git init` for you, pass --git-init.\n"
  );
}

/** Prefix every line, so borrowed output is visibly not ours. */
function indent(text) {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

/**
 * The Pathfinder mark, transcribed from `assets/logo.svg` into cells.
 *
 * The real mark is four rounded horizontal strokes, centred on one axis and
 * tapering upward — a trail blaze, the paint splash on a rock that tells you
 * you are still on the path. Its widths in the 32-unit grid are 24, 18, 12.8,
 * and 7.2 from the bottom up, all centred on x=16.
 *
 * Those proportions are what is preserved here, not the pixels: scaled to a
 * nine-cell base and rounded, 24:18:12.8:7.2 becomes 9:7:5:3, and centring each
 * row on the base gives the indents 0, 1, 2, 3. The slight rotation on each
 * stroke in the SVG is the one feature that does not survive — a terminal cell
 * grid has no way to express three degrees, and faking it by stepping a row
 * sideways would read as a mistake rather than as a tilt.
 *
 * Every number here is authored, not measured. Nothing in this file asks how
 * wide a rendered string is; these are the constants a designer would hand you,
 * and they are the reason the block is stable under any terminal width.
 */
const MARK_ROWS = Object.freeze([
  Object.freeze({ indent: 3, width: 3 }),
  Object.freeze({ indent: 2, width: 5 }),
  Object.freeze({ indent: 1, width: 7 }),
  Object.freeze({ indent: 0, width: 9 }),
]);

/** Where the text column starts, counted in the mark's own authored cells. */
const TEXT_COLUMN = 13;

/**
 * What the tool is, in five words.
 *
 * Reviewed against the finished run and kept. It earns its place by being the
 * only line that says what Pathfinder *is* rather than what it just did, and
 * "markers" is load-bearing: this project's whole argument is that it is not a
 * framework, and a marker is the least presumptuous thing you can leave on a
 * trail. Somebody still has to walk it.
 */
const TAGLINE = "trail markers for AI-assisted work";

/**
 * The last thing the run says.
 *
 * Warm, and stops. No exhortation, no link, and specifically no request to star
 * anything — a tool that has just written several hundred files into somebody's
 * repository has taken enough of their attention, and asking for a favour on the
 * way out would spend the goodwill this whole feature exists to build.
 */
const SIGN_OFF = "Trail's marked. The rest is yours.";

/**
 * Who is running, said once, at the top.
 *
 * The requirement is that a reader recognises this tool before parsing the word
 * "Pathfinder", so recognition is carried by form and colour: the actual mark,
 * drawn, in the actual brand orange when the terminal can render it, beside
 * letterspacing no other scaffolder's output has. Someone who ran three
 * installers this afternoon can tell which one this was from the shape alone —
 * which is the test, and it is why the mark is a transcription of the logo
 * rather than an emoji that merely gestures at the same idea.
 *
 * The colour degrades and the mark does not. At 24-bit the strokes are
 * `#E0611F` exactly; at 256 they are its nearest cube neighbour; at 16 they are
 * the one warm accent ANSI offers; with colour off they are still unmistakably
 * four tapering strokes. That ordering is deliberate — form is the part that
 * survives every terminal, so form is what the identity rests on.
 *
 * Every device here is anchored on the left. There is no border and nothing
 * closes on the right, because that would require knowing the printed width of
 * a decorated string. The prototype that inspired this block had a box, and its
 * right edge did not line up — not a bug in the prototype, just what happens.
 *
 * Not printed for `--help`, which is reference output someone pipes to `less`,
 * and not printed for the `contract` tier, which has a byte promise to keep.
 * Both of those decisions live at the call site, where the tier is known.
 */
function markBlock(theme, beside = []) {
  const stroke = theme.glyph.rule;

  return MARK_ROWS.map((row, index) => {
    const drawn = " ".repeat(row.indent) + stroke.repeat(row.width);
    const text = beside[index] ?? "";

    // Padding to a constant from two constants. The decorated text is appended
    // after the padding is already decided, so no escape sequence is ever part
    // of a length this function computes.
    const pad = " ".repeat(TEXT_COLUMN - row.indent - row.width);
    return `  ${theme.brand(drawn)}${text ? pad + text : ""}`;
  });
}

export function formatIdentity({ theme = createTheme(), version = VERSION } = {}) {
  // The two text lines sit beside the mark's middle rows, so the wordmark lands
  // level with the widest part of the blaze rather than floating above it.
  return (
    [
      "",
      ...markBlock(theme, [
        "",
        `${theme.brand("P A T H F I N D E R")}  ${theme.dim(`v${version}`)}`,
        theme.dim(TAGLINE),
        "",
      ]),
    ].join("\n") + "\n"
  );
}

/**
 * The end of a successful run, and the one place the mark appears twice.
 *
 * The requirement is that this reads as an arrival rather than a receipt, and
 * the device that does the work is the bookend: the run opens with the blaze
 * and closes with it, and no phase in between draws the mark at all. A reader
 * who sees it a second time knows the run is over before reading a word — the
 * same recognition-before-reading test the startup block has to pass.
 *
 * Three endings, because claiming one of them for another would be a lie:
 *
 * - **Clean.** Nothing was skipped, nothing conflicted, nothing failed. This is
 *   the emotional peak of the tool and is allowed to behave like it.
 * - **Ready, with notes.** The install did its job and something above wants a
 *   look. It still says you are ready, because you are, and it does not throw
 *   confetti over a conflict.
 * - **Nothing at all.** A run with write failures gets no ending block. The
 *   error is the ending, and a celebration above it would be the output
 *   disagreeing with itself.
 */
function readyBlock({ theme, headline, detail }) {
  return markBlock(theme, ["", headline, theme.dim(detail), ""]);
}

/**
 * Say what was found, before saying what will be done.
 *
 * Deliberately short, and deliberately passive. Every line states a fact about
 * the machine; none of them implies an intention. The parenthetical on the
 * tools line is load-bearing — a bare list of everything installed on someone's
 * laptop reads like an announcement that all of it is about to be configured,
 * which is not true here, and configuring anything requires an answer to a
 * question.
 *
 * This is also the run's first phase, and it is rendered as one: a heading that
 * names it, and a gutter down the left of everything that belongs to it. The
 * gutter is what makes the phase a block rather than a paragraph — it survives
 * with colour off, it survives in ASCII, and it costs no width maths, which is
 * the whole reason it was chosen over a box.
 */
export function formatFindings(findings, { theme = createTheme() } = {}) {
  // The default is the theme an empty environment produces: ASCII, no colour.
  // Not a convenience — it is the same answer this function gave before it took
  // a theme at all, so a caller that forgets one gets the readable alphabet
  // rather than a guess about a terminal it never described.
  const mark = theme.glyph;

  // Every finding line hangs off the same gutter, so the block reads as one
  // thing rather than as three sentences that happen to be adjacent.
  const rail = railed(theme, "");

  // A severity span covers the glyph *and* the words it qualifies, never the
  // glyph alone. Two reasons, and the second is the one that bites: a coloured
  // glyph beside plain text reads as a bullet with a tint rather than as a
  // statement with a level, and painting only the glyph puts a reset in the
  // middle of the sentence — so `✓ Git repository detected` stops existing as
  // contiguous bytes, and every assertion about what this line says has to
  // learn the escape codes to find it. Emphasis inside a line still gets its
  // own span; it just starts after the statement's own words have ended.
  const lines = ["", `  ${mark.scan}  ${theme.bold("ENVIRONMENT")}`];

  if (findings.git.insideRepository) {
    lines.push(`${rail}${theme.ok(`${mark.ok} Git repository detected`)}`);
  } else if (findings.git.binary) {
    lines.push(`${rail}${theme.info(`${mark.info} No Git repository here`)}`);
  } else {
    lines.push(
      `${rail}${theme.bad(`${mark.bad} No Git repository here, and \`git\` is not on your PATH`)}`,
    );
  }

  if (findings.pathfinder.installed) {
    const { skillCount } = findings.pathfinder;
    lines.push(
      `${rail}${theme.ok(`${mark.ok} Pathfinder already installed`)} ` +
        `(${theme.bold(skillCount)} skill${plural(skillCount)})`,
    );
  }

  // The tool names are emphasised and the caveat is dimmed, which is the
  // hierarchy the sentence always had and the flat rendering threw away. What
  // the reader wants from this line is the list; what they need from it is the
  // parenthetical, exactly once.
  const tools = detectedToolLabels(findings);
  lines.push(
    tools.length > 0
      ? `${rail}${theme.ok(`${mark.ok} Tools detected:`)} ${theme.bold(tools.join(", "))} ` +
          `${theme.dim("(noted, not configured)")}`
      : `${rail}${theme.info(`${mark.info} No supported tools detected`)}`,
  );

  // Trailing blank line: whatever comes next is a different statement — the
  // install summary, a refusal, or a question — and it must not read as one
  // more finding.
  return lines.join("\n") + "\n\n";
}

/**
 * Say what happened, in full.
 *
 * Skipped files are listed individually, not counted. The whole promise of the
 * default mode is that it left your work alone, and a bare "42 skipped" does
 * not let anyone check that claim.
 */
function report(args) {
  // Two renderings, kept adjacent on purpose.
  //
  // The duplication below is a known, accepted cost rather than an oversight.
  // `contractReport` owes byte-for-byte what 1.4.1 printed, to scripts that
  // parse it; `expressiveReport` owes a person a legible hierarchy. Merging
  // them would mean one function whose every line carries a conditional, and
  // the first wording improvement would silently break somebody's grep.
  //
  // They are written next to each other so that editing one is an obvious
  // prompt to consider the other. Anything that changes what is *reported* —
  // as opposed to how it looks — has to be made twice, and that is the point.
  if (args.theme.tier === "contract") return contractReport(args);
  return expressiveReport(args);
}

/**
 * The rendering that is a promise, not a design.
 *
 * Unchanged since 1.4.1 and deliberately frozen. Every byte here is pinned by
 * `test/non-interactive.test.mjs` and by a capture-and-compare against the
 * published package, because a script somewhere is reading it.
 */
function contractReport({ outcome, harnesses, customTools, cwd, gitRoot, options, out, err, theme }) {
  const lines = [];
  const verb = options.dryRun ? "Would install" : "Installed";

  lines.push(`${verb} the Pathfinder kit into ${cwd}`);
  if (gitRoot !== cwd) {
    lines.push(`Note: the repository root is ${gitRoot}, not this directory.`);
  }
  lines.push("");

  const { written, overwritten, skipped } = outcome;
  lines.push(`  ${written} file${plural(written)} ${options.dryRun ? "to write" : "written"}`);

  if (overwritten > 0) {
    lines.push(`  ${overwritten} file${plural(overwritten)} overwritten (--force)`);
  }

  lines.push(...contractAdapterLines({ outcome, options, theme }));
  lines.push(...customToolLines(customTools));

  if (skipped.length > 0) {
    lines.push(`  ${skipped.length} file${plural(skipped.length)} left untouched because they already exist:`);
    for (const path of skipped) lines.push(`      ${path}`);
    lines.push("");
    lines.push("  Nothing above was modified. Re-run with --force to replace them.");
  }

  if (outcome.alreadyInstalled) {
    lines.push("");
    lines.push("The kit is already installed here.");
  }

  // The prompt is printed here, always — including on a re-run that wrote
  // nothing. A second run is how someone configures a harness they skipped, or
  // simply comes back for the invocation they have forgotten, and both of those
  // want the same line. It is also what makes the clipboard a convenience on
  // top of this block rather than the only channel, which is what lets every
  // clipboard failure be a non-event.
  lines.push("");
  lines.push(`Next step ${theme.glyph.dash} give your agent this prompt:`);
  lines.push("");
  lines.push(...kickstartPromptLines(harnesses));

  out(lines.join("\n") + "\n");

  const { failures } = outcome;
  if (failures.length > 0) {
    const detail = failures.map((error) => `  ${error.relativePath}: ${error.message}`).join("\n");
    err(`\ncreate-pathfinder: ${failures.length} file${plural(failures.length)} could not be written:\n${detail}\n`);
  }
}

/**
 * The last two lines of a successful install: the clipboard, then the editor.
 *
 * The guards they share live here because they are one rule, not two. Both are
 * skipped without a terminal because nothing may be asked there; both are
 * skipped under `--yes` because silence is not consent to overwrite what
 * someone is carrying around in their clipboard, nor to take over their screen;
 * and both are skipped under `--dry-run` because a mode whose promise is
 * "changes nothing" cannot make an exception for the state that lives outside
 * the directory.
 *
 * Returns nothing and reports nothing upward on purpose. There is no outcome
 * here that an install should be judged by, so there is no value for the exit
 * code to be computed from.
 */
async function offerOnboardingActions({ harnesses, cwd, options, prompter, out, env, platform, theme }) {
  if (!prompter.interactive || options.yes) return;

  const suppressed = options.noClipboard && options.noOpen;

  if (options.dryRun) {
    // Said rather than silently skipped, because the flag's whole job is to
    // describe the run — and "it would have asked about your clipboard" is
    // exactly the kind of thing someone runs a dry run to find out. Nothing is
    // said when both flags already ruled both offers out; there is no run being
    // described at that point.
    if (!suppressed) {
      out("\nOnboarding actions are not offered in a dry run; nothing was copied or opened.\n");
    }
    return;
  }

  // The report ends on the prompt block, which is the one thing on screen the
  // user is meant to act on. A question butted straight against its last line
  // reads as part of that block rather than as something being asked, so the
  // questions get the same leading blank every other device in this run gets —
  // separation is led here, never trailed.
  //
  // Printed only when a question actually follows, which is why the editors are
  // detected here rather than inside `offerEditor`: a machine with no editor on
  // PATH and `--no-clipboard` asks nothing, and must not be given a separator
  // for it.
  const editors = options.noOpen ? [] : detectEditors({ env, platform });
  if (!options.noClipboard || editors.length > 0) out("\n");

  if (!options.noClipboard) {
    await offerClipboard({ harnesses, options, prompter, out, env, platform, theme });
  }
  if (editors.length > 0) await offerEditor({ editors, cwd, prompter, out, env, platform, theme });
}

/**
 * Offer to put the printed prompt on the clipboard. Never take it.
 */
async function offerClipboard({ harnesses, options, prompter, out, env, platform, theme }) {
  const answer = await prompter.confirm(
    "Copy that prompt to your clipboard? This replaces what is on it now.",
    { defaultAnswer: true },
  );

  // `false` is a decline and `null` is nobody there. Neither is a yes, and only
  // a yes may touch the clipboard.
  if (answer !== true) return;

  // No trailing newline, deliberately. Both harnesses treat a pasted newline as
  // Enter, so appending one would submit the prompt the instant it is pasted —
  // a surprise, not a convenience, and the opposite of leaving the user in
  // control of when their session starts.
  const copied = copyToClipboard(kickstartPrompt(harnesses), { env, platform });

  out(
    copied.ok
      ? "  Copied.\n"
      : `  Not copied ${theme.glyph.dash} ${copied.reason}. The prompt is printed above.\n`,
  );
}

/**
 * Offer to open the project in an editor that is already installed here.
 *
 * The question exists only when there is something to answer it with. No editor
 * on PATH means no question at all, rather than a question whose honest answer
 * is "then don't" — an installer that asks about software you do not have is
 * asking to be told about itself. That decision is made by the caller and the
 * detected list handed down, because the caller has to know whether anything
 * will be asked before it prints the blank line above the questions.
 *
 * One editor is a yes/no; several are a numbered list with an explicit way out.
 * Neither shape can be answered by not answering: a decline, an unanswered
 * question, and "Don't open" all land on the same nothing.
 */
async function offerEditor({ editors, cwd, prompter, out, env, platform, theme }) {
  if (editors.length === 0) return;

  const chosen =
    editors.length === 1
      ? (await prompter.confirm(`Open this project in ${editors[0].label}?`, {
          defaultAnswer: true,
        })) === true
        ? editors[0]
        : null
      : await prompter.chooseOne("Open this project in an editor?", {
          options: [
            ...editors.map((editor) => ({ value: editor, label: editor.label })),
            // Last, and a real row rather than a rule about the empty answer,
            // so declining costs the same one keystroke as accepting.
            { value: null, label: "Don't open" },
          ],
          defaultValue: editors[0],
        });

  if (chosen === null) return;

  const opened = await openInEditor(chosen, cwd, { env, platform });

  // "Opening", not "Opened". The launch is detached, so what this line can
  // truthfully report is that the editor was started, not that it has drawn a
  // window — and a failure after that point is the editor's to explain.
  out(
    opened.ok
      ? `  Opening ${chosen.label}.\n`
      : `  Not opened ${theme.glyph.dash} ${opened.reason}. The install is complete; open ${cwd} yourself.\n`,
  );
}

/**
 * The adapter half of the summary.
 *
 * Three counts, kept apart because they answer three different worries: what
 * was generated, what was already right, and what was left alone. The third is
 * the one that matters to someone re-running this over a project they have
 * worked in, so conflicts are listed by name — a bare count would ask them to
 * take it on faith that their file survived.
 *
 * Empty when no harness was chosen, which is the default and must stay
 * invisible: a scripted 1.4.1-era run prints exactly what it always did.
 */
function contractAdapterLines({ outcome, options, theme }) {
  // No explicit "no harness chosen" guard: that case is no rows and
  // `blocked: false`, so it falls straight through to an empty list. The
  // blocked case is checked first because it is *also* no rows, and the two
  // must not print the same nothing.
  if (outcome.blocked) {
    return [
      "",
      "  No adapters were generated, because the kit copy did not finish.",
      "  An adapter delegates to a canonical skill file, and pointing your tool",
      "  at a file that was not written would be worse than generating nothing.",
    ];
  }

  const lines = [];

  for (const { harness, generated, replaced, unchanged, conflicts, orphans } of outcome.harnessRows) {
    lines.push(
      `  ${generated} ${harness.label} skill adapter${plural(generated)} ` +
        (options.dryRun ? "to generate" : "generated"),
    );

    if (replaced > 0) {
      lines.push(`  ${replaced} ${harness.label} adapter${plural(replaced)} replaced (--force)`);
    }

    if (unchanged > 0) {
      lines.push(`  ${unchanged} ${harness.label} adapter${plural(unchanged)} already up to date`);
    }

    if (conflicts.length > 0) {
      lines.push(
        `  ${conflicts.length} file${plural(conflicts.length)} left untouched because Pathfinder did not write ${conflicts.length === 1 ? "it" : "them"}:`,
      );
      for (const path of conflicts) lines.push(`      ${path}`);
      lines.push("");
      lines.push(
        conflicts.length === 1
          ? `  Re-run with --force to replace it ${theme.glyph.dash} note that --force also overwrites`
          : `  Re-run with --force to replace them ${theme.glyph.dash} note that --force also overwrites`,
      );
      lines.push("  Pathfinder kit files you have edited.",
      );
    }

    for (const path of orphans) {
      lines.push(`  ${path} delegates to a skill this version no longer`);
      lines.push("  ships. It was left in place; delete it yourself if you want it gone.");
    }
  }

  return lines;
}

/**
 * The tools this run was told about and cannot configure.
 *
 * The point of the whole option, and the reason it is worth a prompt: it is an
 * answer rather than a gap. Pathfinder could plausibly write `.mdc` files for
 * Cursor or drop a `SKILL.md` into any directory a tool might one day read, and
 * every one of those would be a file the user's tool ignores while their
 * installer summary claims success.
 *
 * So this states three things and stops: what does not exist, and the two
 * things that already work. No apology, because nothing here went wrong, and
 * no "yet", "planned", or "for now", because a summary is not the place to
 * imply a roadmap nobody has committed to.
 */
function customToolLines(customTools = []) {
  if (customTools.length === 0) return [];

  return [
    "",
    `  Pathfinder has no native integration for ${joinNames(customTools)}, so`,
    `  nothing is generated for ${customTools.length === 1 ? "it" : "them"}. Two things already work:`,
    "",
    "    - The kit installs AGENTS.md at the repository root, which Codex,",
    "      Cursor, and several other tools read.",
    "    - Any agent can be given the line the adapters delegate to anyway:",
    "",
    "        Use skills/<name>/SKILL.md and follow it exactly.",
  ];
}

/**
 * The rendering a person reads.
 *
 * The problem it exists to solve is the re-run screen, which is the screen
 * experienced users see most and was the weakest thing this tool printed: a
 * conflict, an orphan, eight skipped files and twenty generated adapters all
 * arrived as prose at one indent level, so nothing about the shape of the
 * output told you whether anything needed your attention.
 *
 * Three rules hold it together:
 *
 * - **Every severity is a colour, a glyph, and a word.** `warn` is never the
 *   only signal — the line also carries `mark.warn` and opens with a category
 *   word, so the hierarchy survives `NO_COLOR`, ASCII, a screen reader, and a
 *   colour-blind reader identically.
 * - **Summary lines are decorated; payload is not.** Counts sit on the gutter
 *   and get colour. The paths underneath get neither, for the reason below.
 * - **Diagnostics stay pasteable.** See `pathList`.
 */
function expressiveReport({ outcome, harnesses, customTools, cwd, gitRoot, options, out, err, theme }) {
  const mark = theme.glyph;
  const lines = [];
  const verb = options.dryRun ? "Would install" : "Installed";

  lines.push(`  ${mark.clipboard}  ${theme.bold(options.dryRun ? "DRY RUN" : "SUMMARY")}`);
  lines.push(railed(theme, `${verb} the Pathfinder kit into ${theme.bold(cwd)}`));

  if (gitRoot !== cwd) {
    lines.push(
      railed(theme, theme.info(`${mark.info} The repository root is ${gitRoot}, not this directory.`)),
    );
  }

  const { written, overwritten, skipped } = outcome;
  // A zero is reported, never celebrated. `✓ 0 files written` is a tick over
  // nothing happening, which is the kind of detail that makes a whole summary
  // feel automated rather than read.
  lines.push(
    railed(
      theme,
      tally(theme, written)(
        `${written > 0 ? mark.ok : mark.info} ${written} file${plural(written)} ${options.dryRun ? "to write" : "written"}`,
      ),
    ),
  );

  // `--force` overwriting is `info`, not `warn`. It is exactly what the flag
  // was asked to do, and marking a requested action as a warning is how a tool
  // teaches people to ignore its warnings. The files it replaced are still
  // worth stating plainly, which is what `info` is for.
  if (overwritten > 0) {
    lines.push(
      railed(
        theme,
        theme.info(`${mark.info} ${overwritten} file${plural(overwritten)} overwritten (--force)`),
      ),
    );
  }

  lines.push(...expressiveAdapterLines({ outcome, options, theme }));

  if (skipped.length > 0) {
    lines.push(
      railed(
        theme,
        theme.warn(`${mark.warn} ${skipped.length} file${plural(skipped.length)} left untouched`) +
          theme.dim(" (they already exist)"),
      ),
    );
  }

  if (customTools.length > 0) {
    lines.push(
      railed(theme, theme.info(`${mark.info} No native integration for ${joinNames(customTools)}`)),
    );
  }

  // The detail blocks, below the summary rather than inside it. A reader who
  // only wants to know whether anything needs them stops at the gutter; a
  // reader who needs the paths scrolls once and finds them undecorated.
  if (skipped.length > 0) {
    lines.push(
      ...warnBlock({
        theme,
        word: "Skipped",
        summary: `${skipped.length} file${plural(skipped.length)} already exist${skipped.length === 1 ? "s" : ""} and ${skipped.length === 1 ? "was" : "were"} left untouched`,
        paths: skipped,
        advice: ["Nothing above was modified. Re-run with --force to replace them."],
      }),
    );
  }

  lines.push(...expressiveAdapterBlocks({ outcome, theme }));

  if (customTools.length > 0) lines.push(...customToolLines(customTools));

  // `attention` is what actually wants a human: a contested path, or an adapter
  // pointing at a skill that is gone. Skipped files are deliberately not among
  // them — see `summarize`, which is where that decision now lives.
  if (outcome.failures.length === 0) {
    lines.push("");
    lines.push(
      ...readyBlock({
        theme,
        headline: endingHeadline({ theme, outcome, options }),
        detail: endingDetail({ outcome, harnesses, options }),
      }),
    );
  }

  // The prompt is printed here, always — including on a re-run that wrote
  // nothing, and including a run that ends on an error. A second run is how
  // someone configures a harness they skipped, or simply comes back for the
  // invocation they have forgotten, and both of those want the same line. It is
  // also what makes the clipboard a convenience on top of this block rather
  // than the only channel, which is what lets every clipboard failure be a
  // non-event.
  lines.push("");
  lines.push(`  ${theme.bold("Hand your agent this prompt to begin:")}`);
  lines.push("");

  // The one piece of text on screen the user is meant to act on, so it gets the
  // strongest emphasis in the run and its own indent. Colour is safe here in a
  // way it is not for a diagnostic path: selecting text in a terminal copies
  // the characters, not the escapes.
  for (const line of kickstartPromptLines(harnesses)) {
    lines.push(line.trim() === "" ? line : `    ${theme.info(theme.bold(line.trim()))}`);
  }

  out(lines.join("\n") + "\n");

  const { failures } = outcome;
  if (failures.length > 0) {
    // `bad`, not `warn`, and the distinction is the whole point of having both:
    // everything above is an outcome somebody may want to know about, and this
    // is the install failing to do what it said it would.
    const heading = theme.bad(
      `${mark.bad} ${failures.length} file${plural(failures.length)} could not be written:`,
    );
    const detail = failures.map((error) => `  ${error.relativePath}: ${error.message}`).join("\n");
    err(`\ncreate-pathfinder: ${heading}\n${detail}\n`);
  }
}

/**
 * One warning, as a heading a reader can skim and a payload they can paste.
 *
 * The split is the requirement. The heading is decorated — colour, glyph, and
 * a leading category word — because its job is to be noticed. The paths are
 * printed plain, one per line, never wrapped, never truncated, never coloured,
 * and never hung off the gutter, because their job is to survive a
 * copy-and-paste into a GitHub issue. A box character or an ANSI escape in
 * that list means somebody has to hand-edit every line they pasted.
 */
function warnBlock({ theme, word, summary, paths, advice }) {
  const mark = theme.glyph;

  return [
    "",
    `  ${theme.warn(`${mark.warn} ${word}`)} ${mark.dash} ${summary}:`,
    "",
    ...pathList(paths),
    "",
    ...advice.map((line) => `    ${theme.dim(line)}`),
  ];
}

/**
 * Paths, and nothing else.
 *
 * Indented for alignment and otherwise untouched: no glyph, no colour, no
 * gutter, no truncation, no wrapping at any width. Leading spaces are the only
 * decoration, and they are the one kind that survives a paste — a reader who
 * selects these lines gets the paths, and a reader who pastes them into a
 * Markdown issue body gets a code block for free.
 */
function pathList(paths) {
  return paths.map((path) => `      ${path}`);
}

/** The per-harness summary counts, on the gutter, each at its own severity. */
function expressiveAdapterLines({ outcome, options, theme }) {
  const mark = theme.glyph;

  // No "no harness chosen" guard: that case is no rows and `blocked: false`,
  // so it falls through to an empty list. Blocked is checked first because it
  // is also no rows, and the two must not print the same nothing.
  if (outcome.blocked) {
    return [
      railed(theme, theme.bad(`${mark.bad} No adapters were generated`) + theme.dim(" (the kit copy did not finish)")),
    ];
  }

  const lines = [];

  for (const { harness, generated, replaced, unchanged, conflicts, orphans } of outcome.harnessRows) {
    lines.push(
      railed(
        theme,
        tally(theme, generated)(
          `${generated > 0 ? mark.ok : mark.info} ${generated} ${harness.label} skill adapter${plural(generated)} ` +
            (options.dryRun ? "to generate" : "generated"),
        ),
      ),
    );

    if (replaced > 0) {
      lines.push(
        railed(theme, theme.info(`${mark.info} ${replaced} ${harness.label} adapter${plural(replaced)} replaced (--force)`)),
      );
    }

    if (unchanged > 0) {
      lines.push(
        railed(theme, theme.dim(`${mark.info} ${unchanged} ${harness.label} adapter${plural(unchanged)} already up to date`)),
      );
    }

    if (conflicts.length > 0) {
      lines.push(
        railed(
          theme,
          theme.warn(`${mark.warn} ${conflicts.length} ${harness.label} file${plural(conflicts.length)} left untouched`) +
            theme.dim(conflicts.length === 1 ? " (Pathfinder did not write it)" : " (Pathfinder did not write them)"),
        ),
      );
    }

    if (orphans.length > 0) {
      lines.push(
        railed(
          theme,
          theme.warn(`${mark.warn} ${orphans.length} ${harness.label} orphan adapter${plural(orphans.length)}`) +
            theme.dim(orphans.length === 1 ? " (the skill it points at was retired)" : " (the skills they point at were retired)"),
        ),
      );
    }
  }

  return lines;
}

/** The conflict and orphan detail blocks, with their paths kept pasteable. */
function expressiveAdapterBlocks({ outcome, theme }) {
  if (outcome.blocked) return [];

  const blocks = [];

  for (const { harness, conflicts, orphans } of outcome.harnessRows) {
    if (conflicts.length > 0) {
      const one = conflicts.length === 1;
      blocks.push(
        ...warnBlock({
          theme,
          word: "Conflict",
          summary: `${conflicts.length} ${harness.label} file${plural(conflicts.length)} at ${one ? "a path an adapter wants" : "paths adapters want"}, which Pathfinder did not write`,
          paths: conflicts,
          advice: [
            `Re-run with --force to replace ${one ? "it" : "them"} ${theme.glyph.dash} note that --force also`,
            "overwrites Pathfinder kit files you have edited.",
          ],
        }),
      );
    }

    if (orphans.length > 0) {
      const one = orphans.length === 1;
      blocks.push(
        ...warnBlock({
          theme,
          word: "Orphan",
          summary: `${orphans.length} ${harness.label} adapter${plural(orphans.length)} delegat${one ? "es" : "e"} to a skill this version no longer ships`,
          paths: orphans,
          advice: [
            `Left in place. Delete ${one ? "it" : "them"} yourself if you want ${one ? "it" : "them"} gone.`,
          ],
        }),
      );
    }
  }

  return blocks;
}

/** `a`, `a and b`, `a, b, and c`. */
function joinNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function plural(count) {
  return count === 1 ? "" : "s";
}
