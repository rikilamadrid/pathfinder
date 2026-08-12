/**
 * Command-line surface: parse arguments, refuse unsafe situations, report.
 *
 * No CLI framework. The flag set is a handful of booleans and the whole parser
 * is a loop; a dependency tree for that would be indefensible in a project
 * whose identity is "not a framework."
 */

import { findKitRoot, COPY_LIST } from "./kit.mjs";
import { applyPlan, planInstall } from "./install.mjs";
import { detect, detectedToolLabels } from "./detect.mjs";
import { initRepository } from "./git.mjs";
import { nonInteractivePrompter } from "./prompt.mjs";

const USAGE = `Usage: npx create-pathfinder [options]

Installs the Pathfinder workflow kit into the current Git repository.

Copies: ${COPY_LIST.join(", ")}

Options:
  --dry-run       Report what would be written, and any \`git init\` that would
                  run first; change nothing and ask nothing.
  --force         Overwrite files that already exist. Off by default.
  --git-init      Run \`git init\` here if this is not a repository yet.
  --no-git-init   Never run \`git init\`; refuse instead.
  --yes           Take the defaults and ask nothing. Alias: --no-input.
                  It does not authorize \`git init\`; pass --git-init for that.
  -h, --help      Show this message.

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

  const plan = planInstall(kitRoot, cwd, { force: options.force });
  const result = applyPlan(plan, { dryRun: options.dryRun });

  report({ result, plan, cwd, gitRoot, options, out, err });
  return result.errors.length > 0 ? 1 : 0;
}

function parseArguments(argv) {
  const options = {
    dryRun: false,
    force: false,
    help: false,
    gitInit: false,
    noGitInit: false,
    yes: false,
    error: null,
  };

  for (const argument of argv) {
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
function report({ result, plan, cwd, gitRoot, options, out, err }) {
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

  if (result.errors.length > 0) {
    const failures = result.errors
      .map((error) => `  ${error.relativePath}: ${error.message}`)
      .join("\n");
    err(`\ncreate-pathfinder: ${result.errors.length} file${plural(result.errors.length)} could not be written:\n${failures}\n`);
  }
}

function plural(count) {
  return count === 1 ? "" : "s";
}
