/**
 * Text goes into HTML exactly one way: through here.
 *
 * The specification carries no HTML, by contract. That contract is only worth
 * anything if the renderer enforces it, so every producer-supplied string is
 * escaped on the way out and there is no raw-insertion helper to reach for.
 * `<b>bold</b>` in a title renders as those nine characters, visibly, which is
 * the correct behaviour: the producer owns content, the renderer owns markup,
 * and a producer smuggling markup through content is the boundary failing.
 */

const HTML = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

/** Escape for element content and for double-quoted attribute values alike. */
export function esc(value) {
  return String(value).replace(/[&<>"']/g, (character) => HTML.get(character));
}

/**
 * A DOM id derived from specification identifiers alone.
 *
 * Every id the renderer emits is built from ids the producer supplied, joined
 * with a separator the identifier pattern forbids. No counter, no hash, no
 * insertion order: the same specification yields the same ids on every machine.
 */
export function domId(...parts) {
  return parts.filter((part) => part !== undefined && part !== "").join("--");
}
