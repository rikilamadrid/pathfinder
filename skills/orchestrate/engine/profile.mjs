/**
 * The execution profile: `pathfinder.execution-profile/1`.
 *
 * One ticket's estimate — how complex, how much context, how safe to run
 * beside the other workers, how risky — and the selection a routing policy
 * made from it: which role runs the session, on which model, at which
 * reasoning effort. It is orchestration state, never ticket content. It lives
 * in the claim, is shown before approval, and is echoed to the tracker.
 *
 * The schema is closed and versioned. An unknown field, an unknown value, or a
 * missing one is refused rather than tolerated, because a profile a future
 * policy half-understands is exactly how a model choice gets silently lost.
 * A change to the shape is `/2`, not an edit to `/1`.
 *
 * The YAML here is written and read by this module alone, in one fixed shape,
 * so it needs no YAML library: `renderProfile` is the only writer and
 * `parseProfile` accepts exactly what it writes.
 */

export const PROFILE_SCHEMA = "pathfinder.execution-profile/1";

export const ESTIMATE_VALUES = Object.freeze({
  complexity: Object.freeze(["low", "medium", "high"]),
  context: Object.freeze(["small", "medium", "large"]),
  "parallel-safety": Object.freeze(["isolated", "shared-surface", "serialize"]),
  risk: Object.freeze(["low", "medium", "high", "unassessed"]),
});

export const ESTIMATE_FIELDS = Object.freeze(Object.keys(ESTIMATE_VALUES));
export const SOURCES = Object.freeze(["derived", "assessed"]);
export const SELECTION_FIELDS = Object.freeze(["policy", "role", "model", "effort"]);

/** A name a role, model, effort, or policy may take: lower-case, dotted or hyphenated. */
export const TOKEN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Check a profile against the schema.
 *
 * @returns {{ok: true} | {ok: false, errors: string[]}}
 */
export function validateProfile(profile) {
  const errors = [];
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const exact = (value, allowed, where) => {
    if (!isObject(value)) {
      errors.push(`${where} must be an object`);
      return false;
    }
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) errors.push(`${where} has an unknown field \`${key}\``);
    }
    return true;
  };

  if (!exact(profile, ["schema", "ticket", "estimate", "selection"], "profile")) return { ok: false, errors };

  if (profile.schema !== PROFILE_SCHEMA) errors.push(`schema must be \`${PROFILE_SCHEMA}\`, not \`${profile.schema}\``);
  if (typeof profile.ticket !== "string" || !/^\d+\.\d+$/.test(profile.ticket)) {
    errors.push("ticket must be a key such as `53.4`");
  }

  if (exact(profile.estimate, ESTIMATE_FIELDS, "estimate")) {
    for (const field of ESTIMATE_FIELDS) {
      const entry = profile.estimate[field];
      const where = `estimate.${field}`;
      if (entry === undefined) {
        errors.push(`${where} is missing`);
        continue;
      }
      if (!exact(entry, ["value", "source", "reason"], where)) continue;
      if (!ESTIMATE_VALUES[field].includes(entry.value)) {
        errors.push(`${where}.value \`${entry.value}\` is not one of ${ESTIMATE_VALUES[field].join(", ")}`);
      }
      if (!SOURCES.includes(entry.source)) errors.push(`${where}.source must be derived or assessed`);
      if (entry.reason !== undefined && (typeof entry.reason !== "string" || entry.reason.trim() === "")) {
        errors.push(`${where}.reason must be non-empty text when present`);
      }
      if (entry.source === "assessed" && entry.reason === undefined) {
        errors.push(`${where} is assessed and must carry a reason`);
      }
      if (field !== "risk" && entry.source === "assessed") {
        errors.push(`${where} is always derived; only risk may be assessed`);
      }
      if (field === "risk" && entry.value === "unassessed" && entry.source !== "derived") {
        errors.push("estimate.risk `unassessed` is what derivation reports, never an assessment");
      }
    }
  }

  if (exact(profile.selection, SELECTION_FIELDS, "selection")) {
    for (const field of SELECTION_FIELDS) {
      const value = profile.selection[field];
      if (typeof value !== "string" || !TOKEN.test(value)) {
        errors.push(`selection.${field} must be a lower-case name, not \`${value}\``);
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** The profile as YAML, in one fixed field order. Same profile, same bytes. */
export function renderProfile(profile) {
  const lines = [`schema: ${profile.schema}`, `ticket: "${profile.ticket}"`, "estimate:"];
  for (const field of ESTIMATE_FIELDS) {
    const entry = profile.estimate[field];
    lines.push(`  ${field}:`, `    value: ${entry.value}`, `    source: ${entry.source}`);
    // JSON.stringify leaves U+2028 and U+2029 raw, and both end a line to a
    // line-anchored reader. Escaped, a reason is always one physical line.
    if (entry.reason !== undefined) {
      lines.push(`    reason: ${JSON.stringify(entry.reason).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")}`);
    }
  }
  lines.push("selection:");
  for (const field of SELECTION_FIELDS) lines.push(`  ${field}: ${profile.selection[field]}`);
  return lines.join("\n") + "\n";
}

/**
 * Read back what `renderProfile` wrote, and nothing else.
 *
 * @returns {{ok: true, profile: object} | {ok: false, errors: string[]}}
 */
export function parseProfile(text) {
  const profile = { estimate: {}, selection: {} };
  let block = null;
  let field = null;

  for (const raw of String(text).split(/\r?\n/)) {
    if (raw.trim() === "") continue;
    const top = /^([a-z]+):\s*(.*)$/.exec(raw);
    const second = /^ {2}([a-z-]+):\s*(.*)$/.exec(raw);
    const third = /^ {4}([a-z]+):\s*(.*)$/.exec(raw);

    if (top) {
      block = null;
      field = null;
      if (top[1] === "estimate" || top[1] === "selection") block = top[1];
      else if (top[1] === "schema") profile.schema = top[2];
      else if (top[1] === "ticket") profile.ticket = unquote(top[2]);
      else return { ok: false, errors: [`unknown top-level field \`${top[1]}\``] };
    } else if (second && block === "selection") {
      profile.selection[second[1]] = second[2];
    } else if (second && block === "estimate" && second[2] === "") {
      field = second[1];
      profile.estimate[field] = {};
    } else if (third && block === "estimate" && field) {
      profile.estimate[field][third[1]] = third[1] === "reason" ? unquote(third[2]) : third[2];
    } else {
      return { ok: false, errors: [`unreadable profile line: ${raw}`] };
    }
  }

  const checked = validateProfile(profile);
  if (!checked.ok) return checked;

  // Exactly what the writer writes, and nothing it would not: a duplicated
  // key, an unquoted reason, or reordered fields re-renders differently and is
  // refused, so a hand edit cannot quietly change what a claim recorded.
  const canonical = renderProfile(profile);
  if (String(text).replace(/\r\n/g, "\n").replace(/\n*$/, "\n") !== canonical) {
    return { ok: false, errors: ["the profile is not in the exact form the engine writes"] };
  }
  return { ok: true, profile };
}

function unquote(value) {
  const text = String(value).trim();
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}
