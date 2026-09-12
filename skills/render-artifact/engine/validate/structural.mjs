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
import { cellWidth } from "../render/graph/width.mjs";
import { SchemaRegistry, validateAgainstSchema } from "./jsonschema.mjs";
import { diagramEvidenceSites } from "./diagram-parts.mjs";
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

    // Ahead of the schema for the same reason the two refusals above are. The
    // schema's own conditional says `source` is required when provenance is
    // `derived`, and would reject this too — as "`source` is required and is
    // missing", a sentence about a field. What went wrong is a claim: the
    // specification says it was derived from a repository and does not say
    // which, so there is nothing for a citation to resolve against.
    if (spec.provenance === "derived"
        && !Object.prototype.hasOwnProperty.call(spec, "source")) {
      return [diagnostic("structural", "source_required_for_derived", "source",
        `a \`derived\` diagram maps what a repository asserts about itself at ` +
        `a declared commit, so it must say which repository and which commit. ` +
        `Without a source there is nothing for its citations to resolve ` +
        `against, and nothing that makes it derived from anything. A diagram ` +
        `describing a system with no repository behind it is \`proposed\`.`,
        "source")];
    }
  }

  const errors = validateAgainstSchema(spec, KINDS[kind].schema, schemaRegistry())
    .map(toDiagnostic);
  if (errors.length > 0) return errors;

  // Label caps are counted in columns, which is why they are here rather than
  // as a `maxLength`. A column is not a character: `漢` is one character and two
  // columns, a Devanagari matra is one character and none, and `String.length`
  // is not even a character count but a count of UTF-16 units. Capping on any
  // of those would give a producer writing in one script a different allowance
  // from a producer writing in another.
  return kind === "diagram"
    ? [...provenanceErrors(spec), ...labelWidthErrors(spec)]
    : [];
}

/**
 * The two provenance rules a schema cannot express, both refusals rather than
 * anything the engine works around.
 *
 * **A citation with no source.** There is nothing to resolve it against: no
 * repository, no commit, no history. Accepting it and moving on would be the
 * engine holding an unchecked citation and saying nothing about it, and the
 * artifact would then display a file path and a line range as though they had
 * been verified. It is refused here, in the structural layer, because it is a
 * contradiction in the specification's own shape rather than a citation that
 * failed to resolve — the evidence layer never runs for such a specification,
 * so a rule living there would never fire.
 *
 * **`artifact.summary` on a `derived` diagram.** Every other place prose can
 * make a claim is covered by the evidence rules. `artifact.summary` is the one
 * that is not addressed to any node, edge or group, so it has nothing to carry
 * a citation of its own — which makes it the exit a claim would leave by. The
 * subtitle stays available, and so does every node's `summary`; what is refused
 * is an uncited assertion at the top of a document whose whole premise is that
 * its assertions are cited.
 */
function provenanceErrors(spec) {
  const out = [];
  const hasSource = Object.prototype.hasOwnProperty.call(spec, "source");

  if (!hasSource) {
    for (const site of diagramEvidenceSites(spec.diagram)) {
      if (site.evidence.length === 0) continue;
      out.push(diagnostic("structural", "citation_without_source", site.path,
        `${site.subject} cites \`${site.evidence[0].path}\`, and this ` +
        `specification declares no source. A citation resolves against a ` +
        `commit; with no repository and no commit there is nothing to resolve ` +
        `it against, so it is refused rather than displayed as though it had ` +
        `been checked. Either declare a source, or remove the citation and ` +
        `let the diagram describe an intended system.`, site.subject));
    }
  }

  if (spec.provenance === "derived" && spec.artifact.summary !== undefined) {
    out.push(diagnostic("structural", "artifact_summary_forbidden",
      "artifact.summary",
      `a \`derived\` diagram carries no \`artifact.summary\`. Every other ` +
      `place prose asserts something — a node, an edge, a group, a path, a ` +
      `view — carries evidence for it, and this one cannot: it belongs to the ` +
      `document rather than to anything in the diagram, so there is nowhere ` +
      `for its citation to go. Put the claim on the thing it is about and ` +
      `cite it there, or use \`artifact.subtitle\`, which names the diagram ` +
      `rather than asserting anything about the system.`, "summary"));
  }

  return out;
}

/** The column cap for each place a label appears. */
const LABEL_CELLS = Object.freeze({ node: 32, group: 32, path: 32, view: 32, edge: 24 });

/**
 * Refuse a label wider than its cap, naming the width in columns.
 *
 * Refused, never shortened. The renderer owns where a label goes and how it
 * wraps; it owns none of the words, and a label that arrives too wide is a
 * conversation with the producer rather than something to quietly trim.
 */
function labelWidthErrors(spec) {
  const out = [];
  const check = (label, cap, path, what) => {
    if (label === undefined) return;
    const width = cellWidth(label);
    if (width <= cap) return;
    out.push(diagnostic("structural", "label_too_long", path,
      `${what} is ${width} columns wide and the cap is ${cap}. Columns, not ` +
      `characters: a wide character counts two and a combining mark counts ` +
      `none. Shorten the label — the renderer will not do it for you, because ` +
      `the words are yours.`, label));
  };

  const { diagram } = spec;
  diagram.nodes.forEach((node, i) =>
    check(node.label, LABEL_CELLS.node, `diagram.nodes[${i}].label`, `node label "${node.label}"`));
  (diagram.groups ?? []).forEach((group, i) =>
    check(group.label, LABEL_CELLS.group, `diagram.groups[${i}].label`, `group label "${group.label}"`));
  diagram.edges.forEach((edge, i) =>
    check(edge.label, LABEL_CELLS.edge, `diagram.edges[${i}].label`, `edge label "${edge.label}"`));
  (diagram.paths ?? []).forEach((path, i) =>
    check(path.label, LABEL_CELLS.path, `diagram.paths[${i}].label`, `path label "${path.label}"`));
  (diagram.views ?? []).forEach((view, i) =>
    check(view.label, LABEL_CELLS.view, `diagram.views[${i}].label`, `view label "${view.label}"`));
  return out;
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
