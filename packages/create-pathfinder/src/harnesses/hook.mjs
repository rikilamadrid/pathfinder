/**
 * Hook handlers: what they are, and which ones Pathfinder is allowed to write.
 *
 * A harness may expose a session lifecycle event. Where one does, Pathfinder
 * can put a handler on disk for it — and that is the whole of what Pathfinder
 * owns. It writes no settings file, registers nothing, and activates nothing:
 * a generated handler is inert until a human adds native configuration
 * pointing at it. That is why this module has no notion of a settings file, a
 * hook registry, an event schema, or a cross-harness runtime, and must not
 * grow one.
 *
 * Two differences from `adapter.mjs`, and only two:
 *
 * **There is no renderer.** An adapter is *rendered* from canonical
 * frontmatter, which is what makes it body-independent and safe to commit. A
 * handler's bytes *are* its behavior, so the canonical file beside this one is
 * shipped verbatim. "Generation" here is a byte-for-byte copy of a file this
 * package carries, which is also what makes the installed handler mechanically
 * comparable to the canonical implementation.
 *
 * **The marker is a line comment.** The adapter marker is written for Markdown
 * and spelled as an HTML comment; a script needs its own syntax and its own
 * format version. Ownership is otherwise the identical discipline, decided by
 * `classifyOwnership`, which both artifacts share.
 *
 * Nothing here deletes.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { classifyOwnership, isOwnedState } from "./adapter.mjs";

/** The marker token, and the format version this build writes and owns. */
export const HOOK_MARKER_TOKEN = "pathfinder:hook";
export const HOOK_MARKER_VERSION = 1;

/**
 * The marker line, parsed strictly.
 *
 * The version is captured rather than matched, for the same reason it is in
 * `adapter.mjs`: a file written by a future format is recognized but not
 * claimed. This build owns v1 and nothing else.
 */
const HOOK_MARKER_PATTERN = new RegExp(
  `^//\\s*${HOOK_MARKER_TOKEN} v(\\d+)(?:\\s+name=(\\S+))?\\s*$`,
);

/**
 * The marker a file carries, or null.
 *
 * Searched line by line rather than with a multiline regex so a marker quoted
 * inside a string or a longer line cannot be mistaken for the real one.
 *
 * @returns {{version: number, name: string|null}|null}
 */
export function readHookMarker(content) {
  if (typeof content !== "string") return null;

  for (const line of content.split(/\r?\n/)) {
    const match = HOOK_MARKER_PATTERN.exec(line.trim());
    if (match) return { version: Number(match[1]), name: match[2] ?? null };
  }

  return null;
}

/** Does this file carry a marker in the format this build owns? */
export function isPathfinderHook(content) {
  return readHookMarker(content)?.version === HOOK_MARKER_VERSION;
}

/**
 * The handlers a harness receives, in registry order.
 *
 * A harness with no `hooks` field receives none — which is every harness but
 * Claude Code today, and is why a Codex destination gets no `.claude` artifact
 * of any kind rather than a substitute for one.
 */
export function hooksFor(harness) {
  return harness?.hooks ?? [];
}

/**
 * The file names this version ships into one harness's hooks directory.
 *
 * Read from the registry rather than from the destination, for the reason
 * `readCanonicalSkills` reads the kit: a stale file left behind in someone's
 * project must not be able to add itself to the set Pathfinder claims to own,
 * and this is what makes an orphan detectable at all.
 */
export function shippedHookFiles(harness) {
  return new Set(hooksFor(harness).map((hook) => hook.file));
}

/** Where a harness looks for this handler, relative to the project root. */
export function hookPath(harness, hook) {
  return `${harness.hooksDir}/${hook.file}`;
}

/**
 * The canonical bytes of one handler, exactly as they will be installed.
 *
 * Resolved against this module rather than against the kit root, because the
 * handler is part of the *installer* — it ships inside the npm package under
 * `src/`, and never through `copy-list.json`, which is uniform and would hand
 * a Claude Code handler to every destination regardless of harness.
 *
 * Read on demand rather than cached: an install reads it once, and a stale
 * module-level copy is a worse failure than a second `readFileSync`.
 */
export function readHookSource(hook) {
  return readFileSync(hookSourcePath(hook), "utf8");
}

/** Where the canonical handler lives inside this package. Absolute. */
export function hookSourcePath(hook) {
  return fileURLToPath(new URL(`../hooks/${hook.name}.mjs`, import.meta.url));
}

/**
 * Decide what Pathfinder may do with one path a handler would occupy.
 *
 * Takes the file's current contents rather than a path, so the decision is a
 * pure function of what is on disk and can be tested exhaustively without one.
 * `existing` is null when nothing is there.
 *
 * @param {{name: string, isShippedHook?: boolean,
 *          existing: string|null, expected?: string|null}} input
 */
export function classifyHook({ name, isShippedHook = true, existing = null, expected = null }) {
  const marker = readHookMarker(existing);

  const state = classifyOwnership({
    existing,
    expected,
    ours: marker?.version === HOOK_MARKER_VERSION,
    shipped: isShippedHook,
  });

  return { name, state, marker, owned: isOwnedState(state) };
}
