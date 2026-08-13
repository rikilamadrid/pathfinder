/**
 * What to tell your agent first, in the words the chosen tool understands.
 *
 * This used to be one hardcoded string naming a file path, and that was right
 * for exactly as long as Pathfinder configured nothing. Once a run can generate
 * native adapters, the path form is no longer the best answer for someone who
 * just watched twenty skills be installed into their harness — it is the answer
 * for someone whose tool cannot discover them.
 *
 * A pure function of the selection, deliberately: no filesystem, no detection,
 * no process. Everything harness-specific comes out of the registry's own
 * `invocation`, so a third harness supplies its wording by existing rather than
 * by adding a branch here.
 */

/** The skill this prompt starts. The one name in this module that is not derived. */
export const KICKSTART_SKILL = "kickstart-pathfinder";

/**
 * The harness-neutral prompt, unchanged from every version before this one.
 *
 * Two lines because it is read aloud to an agent, and because the second half —
 * "do not install packages or write product code yet" — is the part that keeps
 * a first session from turning into an unrequested scaffold.
 */
const PATH_PROMPT =
  `Use skills/${KICKSTART_SKILL}/SKILL.md. Help me initialize this project. ` +
  "Do not install packages or write product code yet.";

/**
 * The prompt to print, and to offer to copy.
 *
 * Exactly one harness gets that harness's native invocation, because it is the
 * more reliable entry point once the adapter exists and it is shorter than the
 * thing it replaces.
 *
 * Zero or several harnesses both fall back to the path form, for different
 * reasons that happen to have the same answer. Zero means nothing was
 * generated, so there is no native invocation to name. Several means one
 * clipboard cannot serve two syntaxes — and picking a favorite would quietly
 * decide which of the user's tools is the real one.
 *
 * @param {ReadonlyArray<{invocation?: (name: string) => string}>} harnesses
 *   The harnesses this run configured, in registry order.
 * @returns {string}
 */
export function kickstartPrompt(harnesses = []) {
  const selected = Array.isArray(harnesses) ? harnesses.filter(Boolean) : [];
  if (selected.length !== 1) return PATH_PROMPT;

  const [harness] = selected;
  if (typeof harness.invocation !== "function") return PATH_PROMPT;

  const invocation = harness.invocation(KICKSTART_SKILL);

  // A registry entry that returns nothing usable falls back rather than
  // printing an empty "next step". Nothing in this repository does that today;
  // the guard is here because the alternative failure is a blank instruction.
  return typeof invocation === "string" && invocation.trim() !== "" ? invocation.trim() : PATH_PROMPT;
}

/**
 * The prompt as the summary prints it: wrapped, indented, already a block.
 *
 * The path form is two indented lines under a heading and has been since 1.4.1,
 * so it is reproduced exactly rather than re-wrapped by a general algorithm
 * that might land the break one word over. A native invocation is a single
 * short token and needs no wrapping at all.
 *
 * @returns {string[]} lines, indented, with no trailing blank
 */
export function kickstartPromptLines(harnesses = []) {
  const prompt = kickstartPrompt(harnesses);

  if (prompt !== PATH_PROMPT) return [`  ${prompt}`];

  return [
    `  Use skills/${KICKSTART_SKILL}/SKILL.md. Help me initialize this`,
    "  project. Do not install packages or write product code yet.",
  ];
}
