/**
 * Command-line surface: parse arguments, refuse unsafe situations, report.
 *
 * No CLI framework. The flag set is four booleans and the whole parser is a
 * loop; a dependency tree for that would be indefensible in a project whose
 * identity is "not a framework."
 */

import { findKitRoot, COPY_LIST } from "./kit.mjs";
import { applyPlan, planInstall } from "./install.mjs";
import { detect, detectedToolLabels } from "./detect.mjs";

const USAGE = `Usage: npx create-pathfinder [options]

Installs the Pathfinder workflow kit into the current Git repository.

Copies: ${COPY_LIST.join(", ")}

Options:
  --dry-run    Report what would be written; change nothing.
  --force      Overwrite files that already exist. Off by default.
  -h, --help   Show this message.
`;

export function run(argv, { cwd, out, err, env = {}, platform = process.platform, stdoutIsTTY = false }) {
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

  // Printed only to a terminal. The report is for a person, and the acceptance
  // criteria require non-interactive output to stay what 1.4.1 produced — so a
  // piped run, a CI log, and `> install.txt` all keep the old bytes.
  if (stdoutIsTTY) {
    out(formatFindings(findings, { unicode: supportsUnicode(env, platform) }));
  }

  // Refused rather than allowed with a warning: this tool writes several
  // hundred files, and without version control the user has no way to inspect
  // or undo what it did.
  const gitRoot = findings.git.repositoryRoot;
  if (gitRoot === null) {
    err(
      `create-pathfinder: ${cwd} is not inside a Git repository.\n\n` +
        "The kit is installed into version control so you can review the\n" +
        "files it adds and undo them if you change your mind. Run `git init`\n" +
        "here first, or cd into an existing repository, then run this again.\n",
    );
    return 1;
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

  const plan = planInstall(kitRoot, cwd, { force: options.force });
  const result = applyPlan(plan, { dryRun: options.dryRun });

  report({ result, plan, cwd, gitRoot, options, out, err });
  return result.errors.length > 0 ? 1 : 0;
}

function parseArguments(argv) {
  const options = { dryRun: false, force: false, help: false, error: null };

  for (const argument of argv) {
    switch (argument) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--force":
        options.force = true;
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

  return options;
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
  const mark = unicode
    ? { ok: "✓", info: "·", bad: "✗" }
    : { ok: "+", info: "-", bad: "!" };

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
