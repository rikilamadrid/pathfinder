/**
 * Layer 1 — structural. The specification satisfies its schema.
 *
 * This is also where an unsupported `kind` is refused. A kind the renderer does
 * not have is never permission to improvise: there is no fallback schema, no
 * generic renderer, and no "render it as best you can" path out of here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { SCHEMA_VERSION } from "../version.mjs";
import { SchemaRegistry, validateAgainstSchema } from "./jsonschema.mjs";
import { diagnostic, isPresentationControl } from "./diagnostics.mjs";

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");

/**
 * The kind registry: the discriminator's only meaning.
 *
 * Two entries, and there is deliberately no placeholder for any future kind. A
 * placeholder entry is a promise the renderer cannot keep, and the first thing
 * it would do is turn a clean refusal into a half-render.
 */
export const KINDS = Object.freeze({
  lesson: { schema: "lesson.schema.json" },
  diagram: { schema: "diagram.schema.json" },
});

/**
 * The topologies the `diagram` kind supports, and the layout each selects.
 *
 * `graph` is the only one. A second topology is a second layout engine, not a
 * value in a list, so an unsupported topology is refused here for the same
 * reason an unsupported kind is: there is no generic layout to fall back on
 * and no "draw it as best you can" path out.
 */
export const TOPOLOGIES = Object.freeze(["graph"]);

let registry = null;

/** Load and register the schemas once. Ordering is fixed by this list. */
export function schemaRegistry() {
  if (registry) return registry;
  const next = new SchemaRegistry();
  for (const file of ["common.schema.json", "lesson.schema.json",
    "diagram.schema.json"]) {
    next.add(JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf8")));
  }
  registry = next;
  return registry;
}

/**
 * @param {unknown} spec the parsed specification
 * @returns {import("./diagnostics.mjs").Diagnostic[]}
 */
export function validateStructure(spec) {
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    return [diagnostic("structural", "specification_not_an_object", "(root)",
      "a specification must be a JSON object")];
  }

  if (spec.schema_version !== SCHEMA_VERSION) {
    return [diagnostic("structural", "schema_version_unsupported", "schema_version",
      `this engine implements schema_version ${JSON.stringify(SCHEMA_VERSION)}; ` +
      `the specification declares ${JSON.stringify(spec.schema_version ?? null)}`)];
  }

  const kind = spec.kind;
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) {
    const supported = Object.keys(KINDS).map((k) => `\`${k}\``).join(", ");
    return [diagnostic("structural", "kind_unsupported", "kind",
      `${JSON.stringify(kind ?? null)} is not an artifact kind this renderer ` +
      `supports. Supported: ${supported}. A missing kind is a refusal, not a ` +
      `reason to hand-author HTML.`)];
  }

  // The topology refusal comes before the schema for the same reason the kind
  // refusal does: `enum` would reject it too, but "must be one of \"graph\"" is
  // a sentence about a list, and the thing that went wrong was asking for a
  // layout this renderer does not have.
  if (kind === "diagram") {
    const topology = spec.diagram?.topology;
    if (topology !== undefined && !TOPOLOGIES.includes(topology)) {
      const supported = TOPOLOGIES.map((t) => `\`${t}\``).join(", ");
      return [diagnostic("structural", "topology_unsupported", "diagram.topology",
        `${JSON.stringify(topology)} is not a topology this renderer supports. ` +
        `Supported: ${supported}. A topology is a layout, not a label, so a ` +
        `missing one is a refusal rather than a reason to approximate it.`,
        "topology")];
    }
  }

  return validateAgainstSchema(spec, KINDS[kind].schema, schemaRegistry())
    .map(toDiagnostic);
}

/**
 * Turn a schema error into a diagnostic, upgrading the ones that are really a
 * producer reaching for presentation control.
 */
function toDiagnostic(error) {
  if (error.keyword === "additionalProperties" && isPresentationControl(error.property)) {
    return diagnostic("structural", "presentation_control", error.path,
      `\`${error.property}\` is presentation control and belongs to the ` +
      `renderer, not to the specification. Rejected rather than ignored: a ` +
      `field silently dropped is a producer believing it had an effect.`,
      error.property);
  }
  if (error.keyword === "additionalProperties") {
    return diagnostic("structural", "unknown_field", error.path,
      `\`${error.property}\` is not part of this contract`, error.property);
  }
  if (error.keyword === "required") {
    return diagnostic("structural", "missing_field", error.path,
      `\`${error.property}\` is required and is missing`, error.property);
  }
  return diagnostic("structural", `schema_${error.keyword}`, error.path, error.message);
}
