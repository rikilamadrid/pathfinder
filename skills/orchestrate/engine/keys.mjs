/**
 * Ticket keys, and the two things the engine does with them: recognise one
 * and order two.
 *
 * A key is `NN.TT` — the parent Feature's number and the ticket number within
 * it — and it is the identity blocker edges are matched on. Nothing here knows
 * what a key means; it only refuses to mistake `53.10` for `53.1`, which a
 * string comparison would do in both directions.
 */

const KEY_PATTERN = /^(\d+)\.(\d+)$/;

/** Is this string a ticket key? */
export function isKey(value) {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

/** Numeric ordering: by Feature, then by ticket. `53.2` sorts before `53.10`. */
export function compareKeys(a, b) {
  const [af, at] = a.split(".").map(Number);
  const [bf, bt] = b.split(".").map(Number);
  return af - bf || at - bt;
}

/** The Feature number a key belongs to, as a string without the dot. */
export function featureOf(key) {
  return key.split(".")[0];
}

/**
 * A slug for a branch name, derived from a ticket title.
 *
 * Lower-case ASCII letters and digits joined by single hyphens, capped so the
 * branch name stays readable in a listing. Deterministic: the same title
 * always gives the same slug, which is what lets a claim be recognised by the
 * branch it made.
 */
export function slugify(title, { max = 40 } = {}) {
  const slug = String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug === "" ? "ticket" : slug;
}
