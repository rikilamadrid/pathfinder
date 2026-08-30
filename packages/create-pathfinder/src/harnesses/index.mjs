/**
 * The harness registry.
 *
 * A harness is a coding tool that discovers skills by reading files from a
 * fixed directory in the project. This table says where each one looks, how a
 * user invokes what it finds there, and — where the tool has a session
 * lifecycle event — which handler files Pathfinder generates for it. Nothing
 * more: it is a table, not a plugin system. A new harness is one object, and
 * there is deliberately no loader, no manifest format, and no way for a user
 * to register their own.
 *
 * Two entries today, and the second one cost exactly what this shape promised:
 * one object. Adding Codex changed no renderer, no ownership rule, no planner,
 * and no line of `cli.mjs` — the only difference between the harnesses is where
 * the file goes.
 *
 * Detection is not re-implemented here. `src/detect.mjs` already probes for
 * these tools and reports them by id, and duplicating that would create a
 * second answer to "is Claude Code here?" that can disagree with the one the
 * report prints. A harness therefore consumes the finding rather than
 * repeating the probe.
 */

/**
 * Every harness Pathfinder can generate adapters for.
 *
 * - `id` matches the tool id in `src/detect.mjs`, which is what makes
 *   `detect` a lookup instead of a second probe.
 * - `skillsDir` is written with forward slashes and joined per-platform by
 *   whatever touches the filesystem. It is a relative path inside the
 *   destination project, never absolute.
 * - `invocation` is how a user calls the skill once the harness has found it.
 *   Reporting only; nothing branches on it.
 *
 * - `hooksDir` and `hooks` are optional and describe session lifecycle
 *   handlers this harness can run. A harness that omits them receives no
 *   handler and no substitute for one — which is the honest answer for a tool
 *   with no lifecycle primitive, not a gap to fill. `name` names the canonical
 *   handler in `src/hooks/<name>.mjs`; `file` is its destination name, stable
 *   so a human who activated it once keeps a valid activation across updates
 *   with no settings rewrite.
 *
 *   Pathfinder owns the handler file and nothing else. It writes no settings
 *   file, so a generated handler is inert until a human activates it.
 *
 * @type {ReadonlyArray<{id: string, label: string, skillsDir: string,
 *                       detect: (findings: object) => boolean,
 *                       invocation: (name: string) => string,
 *                       hooksDir?: string,
 *                       hooks?: ReadonlyArray<{name: string, file: string}>}>}
 */
export const HARNESSES = Object.freeze([
  Object.freeze({
    id: "claude-code",
    label: "Claude Code",
    skillsDir: ".claude/skills",
    detect: (findings) => toolDetected(findings, "claude-code"),
    invocation: (name) => `/${name}`,
    hooksDir: ".claude/hooks",
    hooks: Object.freeze([
      Object.freeze({ name: "session-orientation", file: "pathfinder-session-orientation.mjs" }),
    ]),
  }),
  Object.freeze({
    id: "codex",
    label: "Codex",
    // Codex scans `.agents/skills` in every directory from the working
    // directory up to the repository root, so one directory at the root is
    // found from anywhere inside the project. Nothing extra is generated for
    // subdirectories. The personal scope, `$HOME/.agents/skills`, is a
    // different place and Pathfinder never writes there.
    skillsDir: ".agents/skills",
    detect: (findings) => toolDetected(findings, "codex"),
    invocation: (name) => `$${name}`,
  }),
]);

/** Valid `--agents` values, in registry order. For error messages and help. */
export const HARNESS_IDS = Object.freeze(HARNESSES.map((harness) => harness.id));

/** The harness with this id, or null. Unknown ids are the caller's to report. */
export function findHarness(id) {
  return HARNESSES.find((harness) => harness.id === id) ?? null;
}

/**
 * The harness a person means when they type this, or null.
 *
 * Only reached when someone has said their tool is *not* one of the supported
 * ones, so its whole job is to catch the case where it is after all — typing
 * "claude" at a question that already offered Claude Code on the line above.
 * Recording that as an unsupported tool would tell them Pathfinder cannot do
 * the thing it just offered to do.
 *
 * Matching is exact against the names a harness actually goes by: its id, its
 * label, and the first word of its label. Deliberately not a prefix or
 * substring search, which would claim "code" for Codex when the person almost
 * certainly meant VS Code — and refusing to record a name is only defensible
 * when the alternative really is a duplicate.
 */
export function harnessNamed(name) {
  const typed = normalizeName(name);
  if (typed === "") return null;

  return (
    HARNESSES.find((harness) =>
      [harness.id, harness.label, harness.label.split(" ")[0]]
        .map(normalizeName)
        .includes(typed),
    ) ?? null
  );
}

/** Case, spaces, and punctuation are not what distinguishes one tool from another. */
function normalizeName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * The harnesses `detect()` found, in registry order.
 *
 * These form the *default* selection and are never applied without
 * confirmation — detection offers, it does not decide.
 */
export function detectedHarnesses(findings) {
  return HARNESSES.filter((harness) => harness.detect(findings));
}

/**
 * Did detection see this tool?
 *
 * Tolerant of a findings object that predates a harness or was synthesized by
 * a caller: an absent entry reads as "not detected" rather than throwing, for
 * the same reason every probe in detect.mjs degrades that way.
 */
function toolDetected(findings, id) {
  const tools = findings?.tools ?? [];
  return tools.some((tool) => tool.id === id && tool.detected === true);
}
