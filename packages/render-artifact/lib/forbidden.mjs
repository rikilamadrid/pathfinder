/**
 * Finding ambient API use in the render path, precisely enough to be believed.
 *
 * A grep for `Math.sin` across these files reports the sentence in
 * `determinism.md` that forbids it, the comment in `layout.mjs` explaining why
 * there is none, and this module's own list. A guard with false positives is a
 * guard somebody eventually deletes, so the source is stripped of comments and
 * of the contents of string and template literals before anything is matched.
 * What remains is code, and only code is searched.
 *
 * Template *expressions* survive the strip. `${...}` inside a template literal
 * is code — `shell.mjs` interpolates real values there — so the stripper
 * re-enters code mode for them and a forbidden call cannot hide inside one.
 * The literal text around them does not survive, which is deliberate: the
 * inline browser script in `behavior.mjs` is emitted as a constant string, and
 * a clock read *in the reader's browser* has no bearing on whether the bytes
 * this renderer produced are deterministic.
 */

/**
 * `Math` members that are exact on integers and identical on every engine.
 *
 * An allowlist rather than a list of banned functions, because the risk is not
 * the trigonometry anyone would think to ban — it is the next transcendental
 * somebody reaches for. ECMA-262 leaves the precision of `sin`, `cos`, `pow`,
 * `exp`, `log`, `sqrt`, `cbrt`, `hypot` and the rest implementation-defined, so
 * two engines may legitimately disagree in the last bits and the layout would
 * move. These eight are specified exactly.
 */
const ALLOWED_MATH = new Set([
  "floor", "ceil", "round", "trunc", "abs", "sign", "min", "max",
]);

/** Ambient sources, each with the reason it is refused. */
const FORBIDDEN = [
  [/\bDate\b/, "a clock"],
  [/\bperformance\s*\.\s*now\b/, "a clock"],
  [/\bMath\s*\.\s*random\b/, "randomness"],
  [/\bcrypto\b/, "randomness"],
  [/\brandomUUID\b/, "randomness"],
  [/\bIntl\b/, "a locale API"],
  [/\bSegmenter\b/, "a locale API"],
  [/\blocaleCompare\b/, "locale-sensitive collation"],
  [/\btoLocale[A-Z]\w*/, "locale-sensitive formatting"],
  [/\.\s*normalize\s*\(/, "Unicode normalization, whose data moves with the engine"],
  [/\beval\s*\(/, "an escape hatch out of this analysis"],
  [/\bnew\s+Function\b/, "an escape hatch out of this analysis"],
  [/\bprocess\s*\./, "the machine"],
  [/\bglobalThis\b/, "the machine"],
  [/\brequire\s*\(/, "a module edge this analysis cannot follow"],
];

/**
 * Replace comments and literal text with spaces, preserving offsets.
 *
 * Offsets are preserved so a finding can still be reported at the right line.
 * @param {string} source
 * @returns {string} the same length, with only code left
 */
export function codeOnly(source) {
  const out = source.split("");
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== "\n") out[i] = " ";
    }
  };

  let i = 0;
  // Each frame is a template literal we are inside; `depth` counts the nested
  // braces of the `${...}` we are currently in, so the closing brace is matched.
  const templates = [];

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      blank(i, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      blank(i, end < 0 ? source.length : end + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) { j += source[j] === "\\" ? 2 : 1; }
      blank(i, Math.min(j + 1, source.length));
      i = j + 1;
      continue;
    }
    if (c === "`") {
      templates.push({ depth: -1 });
      out[i] = " ";
      i += 1;
      // Blank the literal text, stepping back into code for each `${`.
      while (i < source.length && templates.length > 0) {
        const ch = source[i];
        if (ch === "\\") { blank(i, i + 2); i += 2; continue; }
        if (ch === "`") { out[i] = " "; templates.pop(); i += 1; continue; }
        if (ch === "$" && source[i + 1] === "{") {
          out[i] = " "; out[i + 1] = " ";
          i += 2;
          let depth = 1;
          // Code again until the matching brace. Nested templates recurse via
          // the same loop, so `${`a${b}`}` is handled.
          while (i < source.length && depth > 0) {
            const e = source[i];
            if (e === "{") depth += 1;
            else if (e === "}") { depth -= 1; if (depth === 0) { out[i] = " "; i += 1; break; } }
            else if (e === "`") { const inner = codeOnly(source.slice(i)); for (let k = 0; k < inner.length; k += 1) out[i + k] = inner[k]; }
            i += 1;
          }
          continue;
        }
        if (ch !== "\n") out[i] = " ";
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/**
 * Every forbidden use in one file's source.
 *
 * @param {string} source
 * @returns {{ line: number, text: string, reason: string }[]}
 */
export function forbiddenUses(source) {
  const code = codeOnly(source);
  const findings = [];
  const lineOf = (index) => code.slice(0, index).split("\n").length;

  for (const [pattern, reason] of FORBIDDEN) {
    const global = new RegExp(pattern.source, "g");
    for (const match of code.matchAll(global)) {
      findings.push({ line: lineOf(match.index), text: match[0].trim(), reason });
    }
  }

  for (const match of code.matchAll(/\bMath\s*\.\s*([A-Za-z0-9_]+)/g)) {
    if (ALLOWED_MATH.has(match[1])) continue;
    findings.push({
      line: lineOf(match.index),
      text: match[0].trim(),
      reason: `a Math member whose precision ECMA-262 leaves to the ` +
        `implementation; only ${[...ALLOWED_MATH].sort().join(", ")} are exact`,
    });
  }

  return findings.sort((a, b) => a.line - b.line || a.text.localeCompare(b.text));
}
