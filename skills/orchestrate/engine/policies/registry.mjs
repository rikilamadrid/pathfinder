/**
 * `select(profile, policy)` — the second of the three steps, and the seam.
 *
 * A routing policy is a module file in this directory exporting
 * `select(estimate, { session })`. The registry lists the directory, so adding
 * a policy is adding one file: no scheduler, claim, status, or brief code
 * names a policy, and a test proves that by adding one.
 *
 * What the registry guards is the output, not the policy. A selection must
 * name a role the project has a contract for, and a model and effort that are
 * plain lower-case names. The policy chooses; the registry refuses a choice
 * the rest of Pathfinder could not act on.
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TOKEN } from "../profile.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const NOT_POLICIES = new Set(["registry.mjs"]);
export const SESSIONS = Object.freeze(["implementation", "review"]);

/** Every policy this engine ships, by name, sorted. */
export function shippedPolicies() {
  return readdirSync(HERE)
    .filter((file) => file.endsWith(".mjs") && !NOT_POLICIES.has(file))
    .map((file) => file.slice(0, -".mjs".length))
    .filter((name) => TOKEN.test(name))
    .sort();
}

/**
 * Load a policy by name.
 *
 * @returns {Promise<{ok: true, name: string, select: Function} | {ok: false, message: string}>}
 */
export async function loadPolicy(name) {
  const shipped = shippedPolicies();
  if (!shipped.includes(name)) {
    return {
      ok: false,
      message: `routing policy \`${name}\` is not shipped with this engine. Shipped: ${shipped.join(", ")}`,
    };
  }
  const module = await import(pathToFileURL(join(HERE, `${name}.mjs`)).href);
  if (typeof module.select !== "function") {
    return { ok: false, message: `routing policy \`${name}\` exports no select function` };
  }
  return { ok: true, name, select: module.select };
}

/**
 * Run a loaded policy and check what it chose.
 *
 * @returns {{ok: true, selection: {policy: string, role: string, model: string, effort: string}}
 *         | {ok: false, message: string}}
 */
export function runPolicy(policy, estimate, { session, root }) {
  if (!SESSIONS.includes(session)) {
    return { ok: false, message: `session must be ${SESSIONS.join(" or ")}, not \`${session}\`` };
  }

  let chosen;
  try {
    chosen = policy.select(Object.freeze({ ...estimate }), Object.freeze({ session }));
  } catch (error) {
    return { ok: false, message: `routing policy \`${policy.name}\` failed: ${error.message}` };
  }

  for (const field of ["role", "model", "effort"]) {
    if (typeof chosen?.[field] !== "string" || !TOKEN.test(chosen[field])) {
      return {
        ok: false,
        message: `routing policy \`${policy.name}\` chose ${field} \`${chosen?.[field]}\`, which is not a lower-case name`,
      };
    }
  }

  if (root && !existsSync(join(root, "roles", `${chosen.role}.md`))) {
    return {
      ok: false,
      message: `routing policy \`${policy.name}\` chose role \`${chosen.role}\`, but roles/${chosen.role}.md does not exist`,
    };
  }

  return {
    ok: true,
    selection: { policy: policy.name, role: chosen.role, model: chosen.model, effort: chosen.effort },
  };
}
