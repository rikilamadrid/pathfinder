/**
 * `doctor` — can this machine render at all?
 *
 * Deliberately not "does the shipped example validate here". Those are
 * different questions and conflating them would make the answer useless. The
 * example under `examples/` cites the Pathfinder source repository at a fixed
 * commit; in an installed destination project that commit does not exist, and
 * validating it there correctly fails. A `doctor` that reported that as a
 * broken installation would be wrong about the only thing it is for.
 *
 * So: `doctor` checks capability — the runtime, the schemas, the kind registry,
 * and that rendering is reproducible in this process. Whether a particular
 * specimen validates is what `validate` is for.
 */

import { RENDERER_VERSION, SCHEMA_VERSION } from "./version.mjs";
import { KINDS, schemaRegistry, validateStructure } from "./validate/structural.mjs";
import { validateComposition } from "./validate/composition.mjs";
import { renderOnly } from "./deliver.mjs";
import { RENDERERS } from "./render/index.mjs";

/** The Node the kit already requires. Nothing else is needed. */
const MINIMUM_NODE_MAJOR = 18;

/**
 * A specimen that exercises the whole path without needing a repository: no
 * citations, so no Git, so the check means the same thing on every machine.
 */
const SELF_CHECK = Object.freeze({
  schema_version: SCHEMA_VERSION,
  kind: "lesson",
  artifact: { title: "Renderer self-check" },
  source: { repo: "pathfinder", commit: "0000000" },
  lesson: {
    modules: [{
      id: "self-check",
      title: "Self-check",
      sections: [{ type: "prose", id: "self-check-prose", body: ["Rendered locally."] }],
    }],
  },
});

/**
 * @returns {{ ok: boolean, checks: {name: string, ok: boolean, detail: string}[] }}
 */
export function doctor() {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  add("node", major >= MINIMUM_NODE_MAJOR,
    `Node ${process.versions.node} (needs >= ${MINIMUM_NODE_MAJOR})`);

  add("dependencies", true,
    "zero runtime dependencies; the engine imports only node: builtins");

  try {
    const registry = schemaRegistry();
    add("schemas", registry.byId.size >= 2,
      `${[...registry.byId.keys()].sort().join(", ")} loaded`);
  } catch (error) {
    add("schemas", false, `schemas could not be loaded: ${error.message}`);
  }

  const kinds = Object.keys(KINDS).sort();
  const rendered = Object.keys(RENDERERS).sort();
  add("kinds", kinds.join(",") === rendered.join(","),
    `schema kinds [${kinds.join(", ")}] and renderers [${rendered.join(", ")}] agree`);

  try {
    const structural = validateStructure(SELF_CHECK);
    const composition = structural.length === 0 ? validateComposition(SELF_CHECK) : [];
    add("validation", structural.length === 0 && composition.length === 0,
      structural.length === 0 && composition.length === 0
        ? "structural and composition layers ran on an internal specimen"
        : "the internal specimen did not validate, which means the engine is broken");
  } catch (error) {
    add("validation", false, `validation threw: ${error.message}`);
  }

  try {
    const first = renderOnly(SELF_CHECK);
    const second = renderOnly(SELF_CHECK);
    add("determinism", first.sha256 === second.sha256,
      first.sha256 === second.sha256
        ? `two renders of one specimen agreed (${first.sha256.slice(0, 12)}…, ` +
          `${first.bytes} bytes)`
        : `two renders of one specimen disagreed: ${first.sha256} vs ${second.sha256}`);
  } catch (error) {
    add("determinism", false, `rendering threw: ${error.message}`);
  }

  add("renderer", true, `render-artifact ${RENDERER_VERSION}, schema_version ${SCHEMA_VERSION}`);

  return { ok: checks.every((check) => check.ok), checks };
}
