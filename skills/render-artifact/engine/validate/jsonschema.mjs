/**
 * A JSON Schema validator covering exactly the keywords this engine's schemas
 * use, and nothing else.
 *
 * Writing one rather than depending on one is not preference. The engine ships
 * inside `skills/`, which is copied whole into every destination project, and
 * `NOT_A_FRAMEWORK.md` promises those projects acquire no runtime and no
 * package manager. A dependency here would be a dependency in every installed
 * project. The schemas are ours, so the subset is knowable: adding a keyword to
 * a schema means adding it here, and an unknown keyword is a hard error rather
 * than something quietly ignored — a validator that silently skips the rule you
 * just wrote is worse than no validator.
 *
 * Supported: $ref, $defs, type, const, enum, properties, required,
 * additionalProperties (false only), items, minItems, maxItems, uniqueItems,
 * minLength, maxLength, pattern, minimum, maximum, oneOf.
 */

/** Keywords carrying documentation rather than constraint. */
const ANNOTATIONS = new Set(["$id", "$schema", "title", "description", "$defs"]);

const CONSTRAINTS = new Set([
  "$ref", "type", "const", "enum", "properties", "required",
  "additionalProperties", "items", "minItems", "maxItems", "uniqueItems",
  "minLength", "maxLength", "pattern", "minimum", "maximum", "oneOf",
]);

/**
 * @typedef {object} SchemaError
 * @property {string} path      dotted/bracketed path into the instance
 * @property {string} keyword   the keyword that rejected it
 * @property {string} message   what is wrong, in the reader's terms
 * @property {string} [property] the offending property name, when there is one
 */

/** JSON's own type names, as `typeof` cannot tell array from object from null. */
function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function typeMatches(value, expected) {
  const actual = jsonType(value);
  if (expected === "number") return actual === "integer" || actual === "number";
  if (expected === "integer") return actual === "integer";
  return actual === expected;
}

/** Stable, locale-independent rendering of a value inside a diagnostic. */
function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

/**
 * A registry of schemas by `$id`, able to resolve the two ref shapes the
 * schemas use: `other.schema.json#/$defs/name` and `#/$defs/name`.
 */
export class SchemaRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this.byId = new Map();
  }

  add(schema) {
    if (typeof schema?.$id !== "string") {
      throw new Error("schema has no $id; refs could not resolve it");
    }
    this.byId.set(schema.$id, schema);
    return this;
  }

  /**
   * @param {string} ref  the `$ref` value
   * @param {string} fromId  the `$id` of the schema the ref appeared in
   */
  resolve(ref, fromId) {
    const hash = ref.indexOf("#");
    if (hash < 0) throw new Error(`unsupported $ref without a fragment: ${ref}`);
    const id = ref.slice(0, hash) || fromId;
    const pointer = ref.slice(hash + 1);
    const root = this.byId.get(id);
    if (!root) throw new Error(`$ref names an unregistered schema: ${ref}`);

    let node = root;
    for (const rawSegment of pointer.split("/")) {
      if (rawSegment === "") continue;
      const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
      node = node?.[segment];
      if (node === undefined) throw new Error(`$ref does not resolve: ${ref}`);
    }
    return { schema: node, id };
  }
}

/**
 * Validate `instance` against the schema registered under `rootId`.
 *
 * Errors come back in a deterministic order: depth-first through the instance,
 * and for object properties in the order the schema declares them, never the
 * order the instance happens to carry or `Object.keys` happens to return.
 *
 * @returns {SchemaError[]}
 */
export function validateAgainstSchema(instance, rootId, registry) {
  const errors = [];
  const root = registry.byId.get(rootId);
  if (!root) throw new Error(`no schema registered as ${rootId}`);
  walk(instance, root, rootId, "", errors, registry);
  return errors;
}

function push(errors, path, keyword, message, property) {
  const error = { path: path || "(root)", keyword, message };
  if (property !== undefined) error.property = property;
  errors.push(error);
}

function walk(value, schema, schemaId, path, errors, registry) {
  for (const keyword of Object.keys(schema)) {
    if (!ANNOTATIONS.has(keyword) && !CONSTRAINTS.has(keyword)) {
      throw new Error(
        `schema ${schemaId} at ${path || "(root)"} uses unsupported keyword ` +
        `\`${keyword}\`; add it to validate/jsonschema.mjs rather than ` +
        `letting it be ignored`,
      );
    }
  }

  if (schema.$ref !== undefined) {
    const { schema: target, id } = registry.resolve(schema.$ref, schemaId);
    walk(value, target, id, path, errors, registry);
    return;
  }

  if (schema.oneOf !== undefined) {
    walkOneOf(value, schema.oneOf, schemaId, path, errors, registry);
    return;
  }

  if (schema.const !== undefined && value !== schema.const) {
    push(errors, path, "const", `must be ${show(schema.const)}, found ${show(value)}`);
    return;
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    push(errors, path, "enum",
      `must be one of ${schema.enum.map(show).join(", ")}, found ${show(value)}`);
    return;
  }

  if (schema.type !== undefined && !typeMatches(value, schema.type)) {
    push(errors, path, "type", `must be ${schema.type}, found ${jsonType(value)}`);
    return;
  }

  const type = jsonType(value);
  if (type === "string") walkString(value, schema, path, errors);
  if (type === "integer" || type === "number") walkNumber(value, schema, path, errors);
  if (type === "array") walkArray(value, schema, schemaId, path, errors, registry);
  if (type === "object") walkObject(value, schema, schemaId, path, errors, registry);
}

/**
 * `oneOf` here is always a discriminated union over `type`, so branch selection
 * is by the discriminator rather than by counting how many branches passed.
 * The difference matters to the reader: "unknown section type" and a precise
 * complaint about the branch they meant beat six parallel rejections.
 */
function walkOneOf(value, branches, schemaId, path, errors, registry) {
  const resolved = branches.map((branch) =>
    branch.$ref ? registry.resolve(branch.$ref, schemaId) : { schema: branch, id: schemaId });

  const discriminators = resolved.map(({ schema }) => schema?.properties?.type?.const);
  const known = discriminators.filter((d) => typeof d === "string");

  if (known.length !== resolved.length) {
    throw new Error(`oneOf at ${path || "(root)"} is not discriminated by a \`type\` const`);
  }
  if (jsonType(value) !== "object") {
    push(errors, path, "oneOf", `must be an object, found ${jsonType(value)}`);
    return;
  }

  const index = discriminators.indexOf(value.type);
  if (index < 0) {
    push(errors, `${path}.type`, "oneOf",
      `must be one of ${known.map(show).join(", ")}, found ${show(value.type)}`,
      "type");
    return;
  }
  const branch = resolved[index];
  walk(value, branch.schema, branch.id, path, errors, registry);
}

function walkString(value, schema, path, errors) {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    push(errors, path, "minLength",
      `must be at least ${schema.minLength} character(s), found ${value.length}`);
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    push(errors, path, "maxLength",
      `must be at most ${schema.maxLength} character(s), found ${value.length}`);
  }
  if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
    push(errors, path, "pattern",
      `must match ${schema.pattern}, found ${show(value)}`);
  }
}

function walkNumber(value, schema, path, errors) {
  if (schema.minimum !== undefined && value < schema.minimum) {
    push(errors, path, "minimum", `must be at least ${schema.minimum}, found ${value}`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    push(errors, path, "maximum", `must be at most ${schema.maximum}, found ${value}`);
  }
}

function walkArray(value, schema, schemaId, path, errors, registry) {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    push(errors, path, "minItems",
      `must have at least ${schema.minItems} item(s), found ${value.length}`);
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    push(errors, path, "maxItems",
      `must have at most ${schema.maxItems} item(s), found ${value.length}`);
  }
  if (schema.uniqueItems === true) {
    const seen = new Set();
    for (let index = 0; index < value.length; index += 1) {
      const key = JSON.stringify(value[index]);
      if (seen.has(key)) {
        push(errors, `${path}[${index}]`, "uniqueItems",
          `duplicates an earlier item: ${show(value[index])}`);
      }
      seen.add(key);
    }
  }
  if (schema.items !== undefined) {
    for (let index = 0; index < value.length; index += 1) {
      walk(value[index], schema.items, schemaId, `${path}[${index}]`, errors, registry);
    }
  }
}

function walkObject(value, schema, schemaId, path, errors, registry) {
  for (const name of schema.required ?? []) {
    if (!Object.prototype.hasOwnProperty.call(value, name)) {
      push(errors, path ? `${path}.${name}` : name, "required",
        `is required and is missing`, name);
    }
  }

  if (schema.additionalProperties === false && schema.properties) {
    const allowed = new Set(Object.keys(schema.properties));
    // Instance key order is producer-controlled, so sort to keep diagnostics
    // stable. Codepoint order, never `localeCompare`.
    const extras = Object.keys(value).filter((name) => !allowed.has(name)).sort();
    for (const name of extras) {
      push(errors, path ? `${path}.${name}` : name, "additionalProperties",
        `is not part of this contract`, name);
    }
  } else if (schema.additionalProperties !== undefined
             && schema.additionalProperties !== false) {
    throw new Error(
      `schema ${schemaId} at ${path || "(root)"} uses a non-false ` +
      `additionalProperties, which this validator does not implement`);
  }

  for (const [name, subschema] of Object.entries(schema.properties ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(value, name)) continue;
    walk(value[name], subschema, schemaId, path ? `${path}.${name}` : name,
      errors, registry);
  }
}
