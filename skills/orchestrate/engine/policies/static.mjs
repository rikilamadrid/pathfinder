/**
 * The `static` routing policy: the one v1 ships.
 *
 * It reads nothing from the estimate. Implementation runs as `developer`,
 * review runs as `tester`, and model and reasoning effort are `inherited` —
 * whatever the session that dispatches the worker already runs on.
 *
 * A routing policy is one module in this directory exporting `select`. The
 * registry finds it by file name; nothing else in the engine names it.
 */

export const description = "developer implements, tester reviews, model and effort inherited";

/**
 * @param {object} profile the validated estimate half of a profile
 * @param {{session: "implementation" | "review"}} options
 * @returns {{role: string, model: string, effort: string}}
 */
export function select(profile, { session }) {
  return {
    role: session === "review" ? "tester" : "developer",
    model: "inherited",
    effort: "inherited",
  };
}
