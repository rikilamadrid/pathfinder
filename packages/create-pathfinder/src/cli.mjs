/**
 * Command-line surface: parse arguments, refuse unsafe situations, report.
 *
 * No CLI framework. The flag set is a handful of booleans and the whole parser
 * is a loop; a dependency tree for that would be indefensible in a project
 * whose identity is "not a framework."
 */

import { findKitRoot, COPY_LIST } from "./kit.mjs";
import { applyAdapterPlan, applyPlan, planAdapters, planInstall } from "./install.mjs";
import { detect, detectedToolLabels } from "./detect.mjs";
import { initRepository } from "./git.mjs";
import { nonInteractivePrompter } from "./prompt.mjs";
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
  --yes           Take the defaults and ask nothing. Alias: --no-input.
                  It does not authorize \`git init\` or configure any tool;
                  pass --git-init and --agents for those.
  -h, --help      Show this message.

Adapters are generated files Pathfinder owns and regenerates without --force.
A file it did not generate is never replaced, at any path, without --force.

Without a terminal on both stdin and stdout, nothing is ever asked. In that
case a directory that is not a Git repository needs --git-init, or the install
is refused.
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
  const unicode = supportsUnicode(env, platform);
  const mark = marks(unicode);

  // Printed only to a terminal. The report is for a person, and the acceptance
  // criteria require non-interactive output to stay what 1.4.1 produced — so a
  // piped run, a CI log, and `> install.txt` all keep the old bytes.
  if (stdoutIsTTY) {
    out(formatFindings(findings, { unicode }));
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
  const { harnesses, customTools } = await selectHarnesses({ findings, options, prompter, out });

  const plan = planInstall(kitRoot, cwd, { force: options.force });
  const result = applyPlan(plan, { dryRun: options.dryRun });

  // Deliberately after the copy. An adapter delegates to a canonical file, so
  // generating one beside a copy that failed would point the user's tool at a
  // file that is not there.
  const adapters = generateAdapters({ harnesses, kitRoot, cwd, options, result });

  report({ result, plan, adapters, harnesses, customTools, cwd, gitRoot, options, out, err });
  return result.errors.length > 0 || adapters.result.errors.length > 0 ? 1 : 0;
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
const SOMETHING_ELSE = Object.freeze({ label: "Something else…" });

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
async function selectHarnesses({ findings, options, prompter, out }) {
  if (options.agents !== null) {
    return { harnesses: options.agents.map((id) => findHarness(id)), customTools: [] };
  }
  if (!prompter.interactive || options.yes) return { harnesses: [], customTools: [] };

  const detected = detectedHarnesses(findings);
  const entries = [...HARNESSES, SOMETHING_ELSE];
  const width = Math.max(...entries.map((entry) => entry.label.length));

  const answer = await prompter.chooseMany("Configure Pathfinder for which tools?", {
    options: entries.map((entry) => ({
      value: entry,
      label:
        `${entry.label.padEnd(width)}  -> ` +
        // The path is shown so nobody has to check a box to find out what it
        // writes. The last entry earns the same courtesy by admitting it
        // writes nothing, in the column where every other row names a file.
        (entry === SOMETHING_ELSE
          ? "nothing is generated"
          : `${entry.skillsDir}/` + (detected.includes(entry) ? "   (detected)" : "")),
    })),
    defaultSelection: detected,
  });

  out("\n");

  const chosen = answer ?? [];
  const harnesses = chosen.filter((entry) => entry !== SOMETHING_ELSE);
  const customTools = chosen.includes(SOMETHING_ELSE) ? await askCustomTools({ prompter, out }) : [];

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
async function askCustomTools({ prompter, out }) {
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
        `  ${supported.label} is supported — it is in the list above, and writes to\n` +
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
function generateAdapters({ harnesses, kitRoot, cwd, options, result }) {
  const none = { plan: [], result: applyAdapterPlan([]), blocked: false };

  if (harnesses.length === 0) return none;

  // The copy failed part-way. Reporting adapters as generated on top of that
  // would be a success message about a broken install.
  if (result.errors.length > 0) return { ...none, blocked: true };

  const plan = planAdapters(harnesses, { kitRoot, targetRoot: cwd, force: options.force });
  return { plan, result: applyAdapterPlan(plan, { dryRun: options.dryRun }), blocked: false };
}

function parseArguments(argv) {
  const options = {
    dryRun: false,
    force: false,
    help: false,
    gitInit: false,
    noGitInit: false,
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
 * Say what was found, before saying what will be done.
 *
 * Deliberately short, and deliberately passive. Every line states a fact about
 * the machine; none of them implies an intention. The parenthetical on the
 * tools line is load-bearing — a bare list of everything installed on someone's
 * laptop reads like an announcement that all of it is about to be configured,
 * which is not true here and will still not be true after Feature 11, where
 * configuring anything requires an answer to a question.
 */
export function formatFindings(findings, { unicode = false } = {}) {
  const mark = marks(unicode);

  const lines = ["", "Pathfinder", ""];

  if (findings.git.insideRepository) {
    lines.push(`  ${mark.ok} Git repository detected`);
  } else if (findings.git.binary) {
    lines.push(`  ${mark.info} No Git repository here`);
  } else {
    lines.push(`  ${mark.bad} No Git repository here, and \`git\` is not on your PATH`);
  }

  if (findings.pathfinder.installed) {
    const { skillCount } = findings.pathfinder;
    lines.push(`  ${mark.ok} Pathfinder already installed (${skillCount} skill${plural(skillCount)})`);
  }

  const tools = detectedToolLabels(findings);
  lines.push(
    tools.length > 0
      ? `  ${mark.ok} Tools detected: ${tools.join(", ")} (noted, not configured)`
      : `  ${mark.info} No supported tools detected`,
  );

  // Trailing blank line: whatever comes next is a different statement — the
  // install summary, a refusal, or in a later chunk a question — and it must
  // not read as a sixth finding.
  return lines.join("\n") + "\n\n";
}

/**
 * The line markers, in whichever alphabet this terminal can be trusted with.
 *
 * One table, so a finding and an action it leads to are marked the same way.
 */
function marks(unicode) {
  return unicode
    ? { ok: "✓", info: "·", bad: "✗", dash: "—" }
    : { ok: "+", info: "-", bad: "!", dash: "-" };
}

/**
 * Can this terminal be trusted with the decorated marks?
 *
 * Answered from the environment rather than attempted and hoped for, and biased
 * hard toward "no": an unanswerable environment gets ASCII, which is readable
 * everywhere, while a wrong "yes" leaves mojibake in the first output a new
 * user ever sees from this tool.
 */
function supportsUnicode(env, platform) {
  if (platform === "win32") {
    return Boolean(env.WT_SESSION) || env.TERM_PROGRAM === "vscode";
  }
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return /utf-?8/i.test(locale);
}

/**
 * Say what happened, in full.
 *
 * Skipped files are listed individually, not counted. The whole promise of the
 * default mode is that it left your work alone, and a bare "42 skipped" does
 * not let anyone check that claim.
 */
function report({ result, plan, adapters, harnesses, customTools, cwd, gitRoot, options, out, err }) {
  const lines = [];
  const verb = options.dryRun ? "Would install" : "Installed";

  lines.push(`${verb} the Pathfinder kit into ${cwd}`);
  if (gitRoot !== cwd) {
    lines.push(`Note: the repository root is ${gitRoot}, not this directory.`);
  }
  lines.push("");

  const written = options.dryRun ? plan.filter((i) => i.status === "write").length : result.written;
  lines.push(`  ${written} file${plural(written)} ${options.dryRun ? "to write" : "written"}`);

  if (result.overwritten > 0) {
    lines.push(`  ${result.overwritten} file${plural(result.overwritten)} overwritten (--force)`);
  }

  lines.push(...adapterLines({ adapters, harnesses, options }));
  lines.push(...customToolLines(customTools));

  const skipped = plan.filter((item) => item.status === "skip");
  if (skipped.length > 0) {
    lines.push(`  ${skipped.length} file${plural(skipped.length)} left untouched because they already exist:`);
    for (const item of skipped) lines.push(`      ${item.relativePath}`);
    lines.push("");
    lines.push("  Nothing above was modified. Re-run with --force to replace them.");
  }

  if (written === 0 && skipped.length === plan.length) {
    lines.push("");
    lines.push("The kit is already installed here.");
  } else {
    lines.push("");
    lines.push("Next step — give your agent this prompt:");
    lines.push("");
    lines.push("  Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this");
    lines.push("  project. Do not install packages or write product code yet.");
  }

  out(lines.join("\n") + "\n");

  const failures = [...result.errors, ...adapters.result.errors];
  if (failures.length > 0) {
    const detail = failures.map((error) => `  ${error.relativePath}: ${error.message}`).join("\n");
    err(`\ncreate-pathfinder: ${failures.length} file${plural(failures.length)} could not be written:\n${detail}\n`);
  }
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
function adapterLines({ adapters, harnesses, options }) {
  if (harnesses.length === 0) return [];

  if (adapters.blocked) {
    return [
      "",
      "  No adapters were generated, because the kit copy did not finish.",
      "  An adapter delegates to a canonical skill file, and pointing your tool",
      "  at a file that was not written would be worse than generating nothing.",
    ];
  }

  const failed = new Set(adapters.result.errors.map((error) => error.relativePath));
  const lines = [];

  for (const harness of harnesses) {
    const mine = adapters.plan.filter(
      (item) => item.harness === harness && !failed.has(item.relativePath),
    );
    const count = (action) => mine.filter((item) => item.action === action).length;

    const generated = count("write");
    const replaced = count("replace");
    const unchanged = count("up-to-date");
    const conflicts = mine.filter((item) => item.action === "conflict");
    const orphans = mine.filter((item) => item.action === "orphan");

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
      for (const item of conflicts) lines.push(`      ${item.relativePath}`);
      lines.push("");
      lines.push(
        conflicts.length === 1
          ? "  Re-run with --force to replace it — note that --force also overwrites"
          : "  Re-run with --force to replace them — note that --force also overwrites",
      );
      lines.push("  Pathfinder kit files you have edited.",
      );
    }

    for (const item of orphans) {
      lines.push(`  ${item.relativePath} delegates to a skill this version no longer`);
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

/** `a`, `a and b`, `a, b, and c`. */
function joinNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function plural(count) {
  return count === 1 ? "" : "s";
}
