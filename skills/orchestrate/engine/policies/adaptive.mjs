/**
 * The `adaptive` routing policy: a level from the estimate, and one row of a
 * level × session table.
 *
 * The level is 2 when risk or complexity is `high`; 0 only when complexity is
 * `low`, context is `small`, and risk is `low`; otherwise 1. So an
 * `unassessed` risk is never level 0, and a `high` complexity is level 2
 * whatever risk was assessed.
 *
 * Models are harness-neutral tiers — `light`, `standard`, `strong` — which the
 * harness translation maps to a concrete model or refuses by name. Roles are
 * the `static` ones. Repair runs one step above implementation: confirmed
 * findings are evidence the first allocation was insufficient. No adversary,
 * review, or repair cell sits below its implementation cell.
 *
 * The table is the whole policy. Nothing else is read.
 */

export const description = "level from complexity, context and risk; tiered model and effort per session";

const ROLES = Object.freeze({ implementation: "developer", adversary: "adversary", review: "tester", repair: "developer" });

/** `TABLE[level][session]` is `[model tier, effort]`. */
export const TABLE = Object.freeze([
  Object.freeze({ implementation: ["light", "low"], adversary: ["standard", "low"], review: ["standard", "medium"], repair: ["standard", "medium"] }),
  Object.freeze({ implementation: ["standard", "medium"], adversary: ["standard", "high"], review: ["standard", "high"], repair: ["strong", "high"] }),
  Object.freeze({ implementation: ["strong", "high"], adversary: ["strong", "high"], review: ["strong", "high"], repair: ["strong", "xhigh"] }),
]);

/** The level an estimate is routed at: 0, 1, or 2. */
export function level(estimate) {
  const complexity = estimate.complexity.value;
  const risk = estimate.risk.value;
  if (risk === "high" || complexity === "high") return 2;
  if (complexity === "low" && estimate.context.value === "small" && risk === "low") return 0;
  return 1;
}

/**
 * @param {object} estimate the validated estimate half of a profile
 * @param {{session: "implementation" | "adversary" | "review" | "repair"}} options
 * @returns {{role: string, model: string, effort: string}}
 */
export function select(estimate, { session }) {
  const cell = TABLE[level(estimate)][session];
  if (!cell) throw new Error(`no adaptive selection for session \`${session}\``);
  return { role: ROLES[session], model: cell[0], effort: cell[1] };
}
