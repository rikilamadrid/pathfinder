/**
 * The `static` routing policy: the default when the mode file names none.
 *
 * It reads nothing from the estimate. Implementation and repair run as
 * `developer`, adversary as `adversary`, review as `tester`, and model and
 * reasoning effort are `inherited` —
 * whatever the session that dispatches the worker already runs on.
 *
 * A routing policy is one module in this directory exporting `select`. The
 * registry finds it by file name; nothing else in the engine names it.
 */

export const description = "developer implements, tester reviews, model and effort inherited";

/**
 * @param {object} profile the validated estimate half of a profile
 * @param {{session: "implementation" | "adversary" | "review" | "repair"}} options
 * @returns {{role: string, model: string, effort: string}}
 */
export function select(profile, { session }) {
  return {
    role: session === "review" ? "tester" : session === "adversary" ? "adversary" : "developer",
    model: "inherited",
    effort: "inherited",
  };
}
