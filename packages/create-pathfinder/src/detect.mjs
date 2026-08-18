/**
 * What is already here, and what is available to run.
 *
 * Detection is advisory. Everything in this file answers a question of the form
 * "is this present?" and nothing acts on the answer: a finding sets a default
 * or a line in the report, never a file on disk. That boundary is the whole
 * reason this is a separate module — a detector that could also configure
 * something would make every future "it noticed X" into "it did X to me."
 *
 * Nothing here spawns a process. Availability is decided by scanning PATH with
 * existsSync rather than by running `which`/`where` or the tool itself, which
 * buys three things: detection cannot hang, cannot print another program's
 * output over ours, and cannot become the dependency on the `git` binary that
 * findGitRoot exists to avoid. The cost is that a PATH entry which is present
 * but not executable reads as detected. That is the right direction to be
 * wrong in, because a finding only ever offers a default the user can decline.
 *
 * Every probe is wrapped so a failure degrades to "not detected". An unreadable
 * $HOME, a PATH full of directories that do not exist, a permissions error —
 * none of them may abort an install.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { findGitRoot } from "./kit.mjs";

/**
 * The tools worth reporting, in the order they are reported.
 *
 * This table says how to recognize a tool, and deliberately says nothing about
 * what to do with one. Feature 11 owns the harness registry — where each writes
 * and what it generates — and will consume these ids rather than restate them.
 * Two of these four (VS Code, Cursor) are not skill harnesses at all and never
 * will be; they are here because later features act on the editor, not the
 * harness.
 */
const TOOLS = [
  {
    id: "claude-code",
    label: "Claude Code",
    commands: ["claude"],
    homeMarkers: [".claude"],
    projectMarkers: [".claude"],
    termProgram: [],
  },
  {
    id: "codex",
    label: "Codex",
    commands: ["codex"],
    homeMarkers: [".codex", join(".agents", "skills")],
    projectMarkers: [".agents"],
    termProgram: [],
  },
  {
    id: "vscode",
    label: "VS Code",
    commands: ["code"],
    homeMarkers: [],
    projectMarkers: [],
    termProgram: ["vscode"],
  },
  {
    id: "cursor",
    label: "Cursor",
    commands: ["cursor"],
    homeMarkers: [".cursor"],
    projectMarkers: [".cursor"],
    termProgram: ["cursor"],
  },
];

/**
 * Everything the CLI knows about its environment before it asks anything.
 *
 * Reads the filesystem and the environment. Writes nothing, spawns nothing.
 *
 * @returns {{
 *   git: {repositoryRoot: string|null, insideRepository: boolean, binary: boolean},
 *   pathfinder: {installed: boolean, skillCount: number},
 *   tools: {id: string, label: string, detected: boolean}[],
 * }}
 */
export function detect({ cwd, env = {}, platform = process.platform } = {}) {
  const home = homeDirectory(env);
  const repositoryRoot = safe(() => findGitRoot(cwd), null);

  return {
    git: {
      repositoryRoot,
      insideRepository: repositoryRoot !== null,
      binary: safe(() => onPath("git", env, platform), false),
    },
    pathfinder: safe(() => detectPathfinder(cwd), { installed: false, skillCount: 0 }),
    tools: TOOLS.map((tool) => ({
      id: tool.id,
      label: tool.label,
      detected: safe(() => detectTool(tool, { cwd, home, env, platform }), false),
    })),
  };
}

/** The labels of every detected tool, in table order. Convenience for the report. */
export function detectedToolLabels(findings) {
  return findings.tools.filter((tool) => tool.detected).map((tool) => tool.label);
}

function detectTool(tool, { cwd, home, env, platform }) {
  const term = env.TERM_PROGRAM ?? "";
  if (tool.termProgram.some((name) => name.toLowerCase() === term.toLowerCase())) return true;
  if (tool.commands.some((command) => onPath(command, env, platform))) return true;
  if (home !== null && tool.homeMarkers.some((marker) => existsSync(join(home, marker)))) return true;
  return tool.projectMarkers.some((marker) => existsSync(join(cwd, marker)));
}

/**
 * Does this directory already look like a Pathfinder project?
 *
 * Decided by counting skill directories rather than by testing for `CLAUDE.md`,
 * which any agent-assisted project may have written for its own reasons.
 * A `skills/<name>/SKILL.md` is a far more specific signature, and the count is
 * worth having on its own — it is what makes "already installed (N skills)"
 * checkable by the person reading it.
 */
function detectPathfinder(cwd) {
  const skillsDirectory = join(cwd, "skills");
  if (!existsSync(skillsDirectory)) return { installed: false, skillCount: 0 };

  const skillCount = readdirSync(skillsDirectory, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && existsSync(join(skillsDirectory, entry.name, "SKILL.md")),
  ).length;

  return { installed: skillCount > 0, skillCount };
}

/**
 * Is `command` findable on PATH?
 *
 * The separator is derived from the passed platform rather than read from
 * `node:path`, so a test can synthesize a Windows environment on any host.
 * PATHEXT is honored for the same reason `git` is spelled `git.exe` there.
 */
export function onPath(command, env, platform) {
  const searchPath = env.PATH ?? env.Path ?? "";
  if (searchPath === "") return false;

  const separator = platform === "win32" ? ";" : ":";
  const extensions =
    platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];

  for (const directory of searchPath.split(separator)) {
    if (directory === "") continue;
    for (const extension of extensions) {
      if (existsSync(join(directory, command + extension))) return true;
    }
  }

  return false;
}

/**
 * The user's home directory, or null when the environment does not say.
 *
 * Null rather than a guess. A wrong home directory would make every
 * home-marker probe silently answer about somewhere nobody lives, and "not
 * detected" is the honest result when the environment is that impoverished —
 * which is a real CI configuration, not a hypothetical one.
 */
function homeDirectory(env) {
  return env.HOME || env.USERPROFILE || null;
}

/** Run a probe; treat any failure as "not detected". */
function safe(probe, fallback) {
  try {
    const value = probe();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}
