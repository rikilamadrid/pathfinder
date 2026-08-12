/**
 * Adapters: what they contain, and which ones Pathfinder is allowed to write.
 *
 * A canonical skill at `skills/<name>/SKILL.md` is the single behavior
 * contract. An adapter is a generated discovery shim that a harness can find,
 * carrying the canonical metadata and a pointer — and no behavior of its own.
 * Two properties make that arrangement safe, and both are enforced here.
 *
 * **Body-independence.** `render` is a function of the canonical *frontmatter*
 * only. Editing a skill body — the overwhelming majority of skill changes —
 * produces a byte-identical adapter, so generated files can be committed and
 * verified without turning every prose edit into a diff. Nothing in this file
 * ever reads a canonical body.
 *
 * **Decidable ownership.** Pathfinder regenerates a file only when the file
 * itself says Pathfinder wrote it. A user may legitimately have their own
 * `.claude/skills/debug-issue/SKILL.md`, and a name match is not evidence of
 * anything. The marker is the mechanism — not a hash, not a manifest, not the
 * name. Nothing here deletes.
 *
 * Everything in this module is pure except `readSkillMetadata`, which reads one
 * file. No planning, no writing, no CLI: those are Chunk 2's.
 */

import { readFileSync } from "node:fs";

/** The marker token, and the format version this build writes and owns. */
export const MARKER_TOKEN = "pathfinder:adapter";
export const MARKER_VERSION = 1;

/**
 * The marker line, parsed strictly.
 *
 * The version is captured rather than matched, so a file written by a future
 * format is *recognized* but not claimed: this build owns v1 and nothing else.
 * Silently regenerating a format it does not understand would be the same
 * mistake as owning a file by name.
 */
const MARKER_PATTERN = new RegExp(
  `^<!--\\s*${MARKER_TOKEN} v(\\d+)(?:\\s+source=(\\S+))?\\s*-->$`,
);

/**
 * The ownership classes. Every path under a harness skills directory is
 * exactly one of these, and each maps to one behavior:
 *
 * | State       | Means                                          | Behavior                        |
 * | ----------- | ---------------------------------------------- | ------------------------------- |
 * | `absent`    | canonical skill, nothing on disk               | generate                        |
 * | `stale`     | our marker, contents differ                    | regenerate, no flag needed      |
 * | `current`   | our marker, byte-identical                     | nothing; report as up to date   |
 * | `conflict`  | canonical name, no marker we own               | leave it, report by name        |
 * | `orphan`    | our marker, name this version no longer ships  | report, never delete            |
 * | `unmanaged` | anything else under the harness directory      | never read, never written       |
 *
 * `conflict` is the only state `--force` may act on, and the only one where a
 * user's file is at stake. It covers a hand-written file *and* a marker whose
 * version this build does not own — both are "someone else's file" as far as
 * this code is concerned.
 */
export const ADAPTER_STATE = Object.freeze({
  ABSENT: "absent",
  STALE: "stale",
  CURRENT: "current",
  CONFLICT: "conflict",
  ORPHAN: "orphan",
  UNMANAGED: "unmanaged",
});

/** States Pathfinder may write without `--force`. */
const OWNED_STATES = new Set([ADAPTER_STATE.ABSENT, ADAPTER_STATE.STALE, ADAPTER_STATE.CURRENT]);

/**
 * Where a canonical skill lives, relative to the project root.
 *
 * Always forward slashes. This string is rendered into the adapter body, so it
 * is a fact about the document rather than about the host filesystem — a
 * backslash here would make Windows-generated adapters differ from everyone
 * else's, which is exactly the byte-determinism this layer promises not to
 * break.
 */
export function canonicalPath(name) {
  return `skills/${name}/SKILL.md`;
}

/** Where a harness looks for that skill, relative to the project root. */
export function adapterPath(harness, name) {
  return `${harness.skillsDir}/${name}/SKILL.md`;
}

/**
 * Parse a canonical `SKILL.md`'s frontmatter into the metadata an adapter
 * carries.
 *
 * Deliberately the same tolerance `.github/scripts/validate-kit.py` uses — a
 * flat block of `key: value` lines between two `---` fences — so the installer
 * and the validator cannot disagree about what a skill declares, and neither
 * needs a YAML dependency. Values are taken verbatim: a description containing
 * a colon keeps it, and nothing is re-worded, wrapped, or truncated.
 *
 * Throws rather than returning a partial result. A skill with no `description`
 * would otherwise produce an adapter a harness silently ignores, and a loud
 * failure naming the file is far cheaper than that.
 *
 * @returns {{name: string, description: string, argumentHint: string|null}}
 */
export function parseSkillFrontmatter(text, { source = "SKILL.md" } = {}) {
  const lines = text.split(/\r?\n/);

  if (lines[0]?.trimEnd() !== "---") {
    throw new Error(`${source}: line 1 must be exactly \`---\``);
  }

  const close = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  if (close === -1) {
    throw new Error(`${source}: frontmatter has no closing \`---\``);
  }

  const data = new Map();
  for (const line of lines.slice(1, close)) {
    if (line.trim() === "") continue;
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`${source}: frontmatter line is not a \`key: value\` pair: ${line}`);
    }
    data.set(match[1], match[2].trim());
  }

  for (const key of ["name", "description"]) {
    if (!data.get(key)) throw new Error(`${source}: frontmatter \`${key}\` is missing or empty`);
  }

  return {
    name: data.get("name"),
    description: data.get("description"),
    argumentHint: data.get("argument-hint") || null,
  };
}

/** Read one canonical skill's metadata. The only filesystem access here. */
export function readSkillMetadata(path, { source = path } = {}) {
  return parseSkillFrontmatter(readFileSync(path, "utf8"), { source });
}

/**
 * Render the adapter bytes for one skill.
 *
 * Same input, same bytes, on every platform: lines are joined with `\n`
 * explicitly and never `os.EOL`, and nothing here consults the clock, the
 * environment, or the canonical body.
 *
 * `harness` is taken and validated but does not currently change the output —
 * both harnesses in the plan read `SKILL.md` with `name`/`description`
 * frontmatter, so one renderer serves both. It stays in the signature because
 * the first harness that needs a different file format supplies its own
 * renderer, and callers should already be passing the harness by then.
 *
 * @returns {string} the complete file contents, LF, one trailing newline
 */
export function render(harness, { name, description, argumentHint = null } = {}) {
  if (!harness?.skillsDir) throw new Error("render: a harness is required");
  assertRenderableName(name);
  if (!description) throw new Error(`render: skill \`${name}\` has no description`);

  const canonical = canonicalPath(name);

  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    ...(argumentHint ? [`argument-hint: ${argumentHint}`] : []),
    "---",
    "",
    `<!-- ${MARKER_TOKEN} v${MARKER_VERSION} source=${canonical} -->`,
    "<!-- Generated by create-pathfinder. Do not edit; re-run `npx create-pathfinder`. -->",
    "",
    `Read \`${canonical}\` in this repository and follow it exactly.`,
    "",
    "That file is the canonical, tool-neutral definition of this skill. This file",
    "exists only so this tool can discover it, and contains no behavior of its own.",
    "",
    `If \`${canonical}\` does not exist, stop and tell the user the`,
    "Pathfinder kit is not installed in this repository. Do not improvise the skill.",
    "",
  ].join("\n");
}

/**
 * The marker a file carries, or null.
 *
 * Searched line by line rather than with a multiline regex so a marker quoted
 * inside a fenced block or a longer line cannot be mistaken for the real one.
 *
 * @returns {{version: number, source: string|null}|null}
 */
export function readMarker(content) {
  if (typeof content !== "string") return null;

  for (const line of content.split(/\r?\n/)) {
    const match = MARKER_PATTERN.exec(line.trim());
    if (match) return { version: Number(match[1]), source: match[2] ?? null };
  }

  return null;
}

/** Does this file carry a marker in the format this build owns? */
export function isPathfinderAdapter(content) {
  return readMarker(content)?.version === MARKER_VERSION;
}

/**
 * Decide what Pathfinder may do with one path under a harness skills
 * directory.
 *
 * Takes the file's current contents rather than a path, so the decision is a
 * pure function of what is on disk and can be tested exhaustively without one.
 * `existing` is null when nothing is there.
 *
 * @param {{name: string, isCanonicalSkill: boolean,
 *          existing: string|null, expected?: string|null}} input
 * @returns {{name: string, state: string, marker: {version: number, source: string|null}|null,
 *            owned: boolean, forceReplaceable: boolean}}
 */
export function classifyAdapter({ name, isCanonicalSkill, existing = null, expected = null }) {
  const marker = readMarker(existing);
  const ours = marker?.version === MARKER_VERSION;

  const state = (() => {
    // A marked file naming a skill this version does not ship. Reported so it
    // cannot rot unnoticed, and left alone: deleting in someone else's
    // repository is a different authority than writing, and is not claimed.
    if (!isCanonicalSkill) return ours ? ADAPTER_STATE.ORPHAN : ADAPTER_STATE.UNMANAGED;
    if (existing === null) return ADAPTER_STATE.ABSENT;
    if (!ours) return ADAPTER_STATE.CONFLICT;
    return existing === expected ? ADAPTER_STATE.CURRENT : ADAPTER_STATE.STALE;
  })();

  return {
    name,
    state,
    marker,
    owned: OWNED_STATES.has(state),
    forceReplaceable: state === ADAPTER_STATE.CONFLICT,
  };
}

/**
 * A name that can be rendered into a path and a document.
 *
 * Narrow on purpose. The name arrives from a file the installer did not write
 * and is interpolated into `skills/<name>/SKILL.md`, so a separator or a `..`
 * would turn a metadata bug into a path that escapes the directory it was
 * meant to describe.
 */
function assertRenderableName(name) {
  if (!name) throw new Error("render: skill has no name");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes("..")) {
    throw new Error(`render: skill name is not usable as a path segment: ${name}`);
  }
}
