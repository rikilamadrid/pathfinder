/**
 * The renderer's own version, and the single source of truth for it.
 *
 * This is deliberately not the Pathfinder release version and deliberately not
 * carried by a `package.json`. Two reasons, both structural:
 *
 * 1. Everything under `skills/` is copied into every destination project. A
 *    manifest here would ship into other people's repositories and read as a
 *    dependency the kit does not have. `NOT_A_FRAMEWORK.md` is the promise
 *    that would break.
 * 2. The determinism invariant is *same specification bytes + same renderer
 *    version -> same artifact bytes*. That makes this constant part of the
 *    compiler's input, so it has to move exactly when rendered output can
 *    move, and at no other time. A kit release that does not touch rendering
 *    must leave it alone; tying it to the kit version would make every release
 *    look like an intentional output change.
 *
 * Bump this in the same commit as any change that can alter rendered HTML --
 * markup, CSS, inline behaviour, ordering, or escaping.
 */
export const RENDERER_VERSION = "0.8.0";

/** The specification `schema_version` this engine understands. */
export const SCHEMA_VERSION = "1.0";
