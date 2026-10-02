/**
 * Judge prose: the only free text an Evidence Judge provider ever receives.
 *
 * Raw evidence — commands, output, logs, headers, URLs, environment snippets,
 * `type:locator` references — stays in the local checkpoint, and so does a
 * ticket criterion that cannot be sent as written. Beside them, the author
 * writes a short judge-facing projection: what was done and what was observed,
 * or what the criterion requires, in plain sentences. This module is that
 * projection's contract.
 *
 * The grammar is structural and positive, not a detector: a short single line
 * of letters, digits, spaces and `. , ; ( ) ' % -`. Without `: = / @ " $ \``,
 * brackets, braces, `+`, `_`, `#`, `|`, `&`, `<`, `>` or a newline, the shapes
 * a credential travels in — `user:pass`, `KEY=value`, URLs and user-info,
 * headers, JSON and YAML, base64 with padding, shell substitutions and
 * pipelines — cannot be written at all. Word rules close what the characters
 * still allow, on normalized tokens rather than raw spelling: command-line
 * options, token-like words, a token split into short pieces, an encoded
 * `user:password`, and a value written near a secret-named word.
 *
 * It is deliberately not a language parser. A letters-only word that happens
 * to be a password is still expressible; the credential screen and the final
 * outbound check run after the projection, and the projection is what keeps
 * pasted raw material out. Every problem is reported by rule, never by value.
 */

export const JUDGE_PROSE_MAX = 280;
export const JUDGE_PROSE_RULES = Object.freeze({
  line: `a single line of at most ${JUDGE_PROSE_MAX} characters`,
  characters: "only letters, digits, spaces and . , ; ( ) ' % -",
  marks: "an apostrophe only inside a word, and % only after a digit",
  option: "no command-line option such as -u or --user (a negative number such as -1 is fine)",
  token: "no token-like word: longer than 32 characters, 12 or more mixing letters and digits, 13 or more digits, or 12 or more with the case flipping as in random text",
  split: "no token, key or long number split into short pieces by spaces, hyphens, dots or brackets",
  encoded: "no encoded user and password",
  secret: "no value written after a secret-named word such as password, token, secret, key, pin or credential",
  scope: "no likely value near a secret-named word: in the same sentence before it, or within the 12 words after it, across fields and items",
  verdict: "no verdict word such as PASS, FAIL or verdict; the judge reads evidence, not the Tester's conclusion",
});
// The Tester's verdict is never evidence: upper-case verdict tokens, or the word itself.
const verdictCase = /\b(?:PASS(?:ED)?|FAIL(?:ED)?)\b|\b[Vv]erdicts?\b/;

const CHARACTERS = /^[A-Za-z0-9 .,;()'%-]+$/;
const OPTION = /(?:^|[^A-Za-z0-9])-+[A-Za-z]|--/;

/**
 * A run of letters and digits shaped like a token, a key or an encoding: very
 * long, long and mixing letters with digits, a long digit string, or long with
 * the case flipping as often as random text does (camelCase flips far less).
 */
export const tokenLike = (run) => run.length > 32 || (run.length >= 12 && /[A-Za-z]/.test(run) && /\d/.test(run)) || /\d{13,}/.test(run)
  || (run.length >= 12 && (run.match(/[a-z](?=[A-Z])/g) ?? []).length >= 5);

/** The tokens of a text: maximal runs of letters and digits, with where they sit. */
export function tokensOf(text) {
  return [...String(text).matchAll(/[A-Za-z0-9]+/g)].map((match) => ({ word: match[0], start: match.index, end: match.index + match[0].length }));
}

// A piece of a credential rather than a word: it has a digit, is an
// upper-case run, or changes case inside itself.
const fragmentLike = (word) => /\d/.test(word) || /^[A-Z]{2,}$/.test(word) || /[a-z][A-Z]|[A-Z]{2}[a-z]/.test(word);
// Pieces stay one value across any run of spaces around at most three
// hyphens, dots or brackets; a comma or a semicolon separates values.
const JOINS = /^ *[.()-]{0,3} *$/;
// A dotted version or address — at most four parts and nine digits, such as
// `15.6`, `1.2.3`, `2026.10.2` or `10.12.7.33` — is one value of its own.
const DOTTED = /(?<![A-Za-z0-9.])\d+(?:\.\d+)+(?![A-Za-z0-9])/g;
const versionLike = (dotted) => { const parts = dotted.split("."); return parts.length <= 4 && parts.join("").length <= 9; };
/**
 * Indexes of the tokens inside a dotted version, marked in one pass over both
 * lists, which are in text order. A longer dotted number is pieces.
 */
function versionTokens(text, tokens) {
  const version = new Set();
  let at = 0;
  for (const match of String(text).matchAll(DOTTED)) {
    if (!versionLike(match[0])) continue;
    const end = match.index + match[0].length;
    while (at < tokens.length && tokens[at].end <= match.index) at += 1;
    for (; at < tokens.length && tokens[at].start < end; at += 1) version.add(at);
  }
  return version;
}

/**
 * Adjacent pieces of a text read as the one value they would form when
 * joined: `AKIAIOSFOD NN7EXAMPLE`, `4111-1111-1111-1111`. Ordinary words
 * break a run, so prose is never glued together.
 */
export function joinedFragments(text) {
  const tokens = tokensOf(text);
  const version = versionTokens(text, tokens);
  const runs = [];
  let run = [];
  const close = () => { if (run.length >= 2) runs.push(run.map((token) => token.word).join("")); run = []; };
  for (const [index, token] of tokens.entries()) {
    if (version.has(index) || !fragmentLike(token.word)) { close(); continue; }
    if (run.length && !JOINS.test(text.slice(tokens[index - 1].end, token.start))) close();
    run.push(token);
  }
  close();
  return runs;
}

// Distinctive credential prefixes, found once separators are gone.
const SPLIT_FORMATS = [/(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}/, /gh[pousr][A-Za-z0-9]{30,}/, /githubpat[A-Za-z0-9]{20,}/, /glpat[A-Za-z0-9]{20,}/, /xox[abprs][A-Za-z0-9]{10,}/, /(?:sk|rk|pk)(?:live|test)[A-Za-z0-9]{10,}/];
/** A value assembled from short pieces that is shaped like a token, a known format or a card number. */
export const splitToken = (text) => joinedFragments(text).some((joined) => tokenLike(joined) || /\d{13,}/.test(joined) || SPLIT_FORMATS.some((format) => format.test(joined)));

/** Base64 that decodes, in memory, to `user:password`. Nothing decoded is kept. */
export const encodedPair = (run) => run.length >= 8 && /^[\x21-\x7e]{1,64}:[\x20-\x7e]{1,64}$/.test(Buffer.from(run, "base64").toString("latin1"));

// Secret-named words, matched on normalized tokens: lower-cased, a camelCase
// word read by its parts, a run-together compound by its secret-named ending
// or its qualified form, and two tokens a hyphen joins. So `Pass-word`,
// `password's`, `accessToken`, `apitoken` and `accessCode` all name a secret.
const SECRET_WORD = /^(?:pass(?:words?|wds?|phrases?|codes?)|pwds?|pws?|pins?|otps?|totps?|secrets?|tokens?|keys?|apikeys?|credentials?|creds?|cookies?|bearer|authorization|auth|sessionids?)$/;
const SECRET_ENDING = /(?:tokens?|passwords?|passwd|passphrases?|pass|pwd|pw|secrets?|credentials?|apikeys?|cookies?)$/;
// Ordinary words that happen to end like a secret name.
const ORDINARY = new Set(["bypass", "compass", "encompass", "surpass", "trespass", "overpass", "underpass", "multipass"]);
const QUALIFIED = /^(?:access|api|auth|secret|private|signing|license|client|master|session|recovery|refresh|deploy|admin|root|db|app|bot|ssh)(?:keys?|codes?)$/;
const secretName = (word) => {
  const lower = word.toLowerCase();
  if (SECRET_WORD.test(lower) || QUALIFIED.test(lower)) return true;
  // A run-together compound: at least two characters before a secret ending (`dbpass`, `mysqlpwd`).
  const ending = SECRET_ENDING.exec(lower);
  if (ending && lower.length - ending[0].length >= 2 && !ORDINARY.has(lower)) return true;
  const parts = word.split(/(?<=[a-z0-9])(?=[A-Z])/);
  return parts.length > 1 && parts.some((part) => SECRET_WORD.test(part.toLowerCase()));
};
// Words that may stand between a secret-named word and its value.
const FILLER = new Set(["is", "was", "were", "are", "be", "been", "set", "to", "of", "as", "equal", "equals", "value", "we", "i", "you", "they", "used", "use", "using", "with", "the", "a", "an", "its", "it", "old", "new", "our", "their", "this", "that", "s"]);

/** Indexes of the tokens that name a secret. */
function secretWords(text, tokens = tokensOf(text)) {
  const named = new Set();
  tokens.forEach((token, index) => {
    if (secretName(token.word)) named.add(index);
    const next = tokens[index + 1];
    if (next && text.slice(token.end, next.start) === "-" && secretName(token.word + next.word)) named.add(index + 1);
  });
  return named;
}

/**
 * Which judge-prose rule a value breaks, or null when it is judge prose.
 * The answer names a rule and never repeats the value.
 */
export function judgeProseProblem(value) {
  if (typeof value !== "string" || value.trim() === "") return "must be a non-empty string";
  if (value.length > JUDGE_PROSE_MAX || /[\r\n]/.test(value)) return JUDGE_PROSE_RULES.line;
  if (!CHARACTERS.test(value)) return JUDGE_PROSE_RULES.characters;
  if (/'(?![A-Za-z])|(?<![A-Za-z])'/.test(value) || /(?<![0-9])%|%(?=[A-Za-z0-9])/.test(value)) return JUDGE_PROSE_RULES.marks;
  if (OPTION.test(value)) return JUDGE_PROSE_RULES.option;
  const tokens = tokensOf(value);
  if (tokens.some((token) => tokenLike(token.word))) return JUDGE_PROSE_RULES.token;
  if (splitToken(value)) return JUDGE_PROSE_RULES.split;
  if ([...tokens.map((token) => token.word), ...joinedFragments(value)].some(encodedPair)) return JUDGE_PROSE_RULES.encoded;
  // After a secret-named word, in the same sentence — a comma or a semicolon
  // does not end the phrase — past brackets and up to three filler words, the
  // next word must be a plain lower-case word; and none of the next three
  // words may be a value, a year included.
  const sentenceEnds = (left, right) => /[.!?](?:\s|$)/.test(value.slice(left.end, right.start));
  const versions = versionTokens(value, tokens);
  // Ordinary evidence beside a secret word: a version, a quantity or a
  // numbered thing (`2048 bits`, `port 8080`), or a short acronym (`JWT`).
  const ordinary = (index) => versions.has(index) || /^[A-Z]{2,5}$/.test(tokens[index].word) || (/^\d+$/.test(tokens[index].word) && !adjacentValue(tokens, index));
  for (const index of secretWords(value, tokens)) {
    let next = index + 1;
    for (let skipped = 0; skipped < 3 && tokens[next] && FILLER.has(tokens[next].word.toLowerCase()) && !sentenceEnds(tokens[next - 1], tokens[next]); skipped += 1) next += 1;
    const after = tokens[next];
    if (after && !sentenceEnds(tokens[next - 1], after) && !/^[a-z]+$/.test(after.word) && !ordinary(next)) return JUDGE_PROSE_RULES.secret;
    for (let near = index + 1; near <= index + 3 && tokens[near] && !sentenceEnds(tokens[near - 1], tokens[near]); near += 1) {
      if (!versions.has(near) && adjacentValue(tokens, near)) return JUDGE_PROSE_RULES.secret;
    }
  }
  return null;
}

/** Right after a secret-named word: a word mixing letters and digits, or a number of four or more digits that is not a quantity or a numbered thing. */
function adjacentValue(tokens, index) {
  const { word } = tokens[index];
  if (/^\d+$/.test(word)) return word.length >= 4 && !UNITS.has(tokens[index + 1]?.word.toLowerCase()) && !NUMBERED.has(tokens[index - 1]?.word.toLowerCase());
  return word.length >= 4 && /\d/.test(word) && /[A-Za-z]/.test(word);
}

// A number followed by one of these is a quantity, and one after these is a
// numbered thing, not a value: `3600 seconds`, `port 8080`, `issue 146`.
const UNITS = new Set(["ms", "s", "sec", "secs", "second", "seconds", "minute", "minutes", "min", "mins", "hour", "hours", "day", "days", "week", "weeks", "byte", "bytes", "kb", "mb", "gb", "bit", "bits", "time", "times", "test", "tests", "request", "requests", "record", "records", "row", "rows", "line", "lines", "item", "items", "user", "users", "character", "characters", "char", "chars", "attempt", "attempts", "retry", "retries", "file", "files", "page", "pages", "step", "steps", "run", "runs", "percent"]);
const NUMBERED = new Set(["port", "ports", "line", "issue", "pr", "pull", "ticket", "version", "http", "status", "exit", "step", "round", "row", "column", "page", "build", "run", "attempt", "test", "item", "chapter", "section", "node", "rule", "case", "batch", "job", "error"]);
const WINDOW_BEFORE = 6;
const WINDOW_AFTER = 12;

/** Whether the token at `index` of a flat token list looks like a value: a mixed letter-digit word, or a long number that is not a quantity, a year or a numbered thing. */
function likelyValue(flat, index) {
  const { word } = flat[index];
  if (/^\d+$/.test(word)) {
    // Equal pieces a space or hyphen joins (`48 21`, `4111-1111`) are one number.
    let digits = word;
    let last = index;
    while (word.length >= 2 && flat[last].joinsNext && /^\d+$/.test(flat[last + 1]?.word ?? "") && flat[last + 1].word.length === word.length) { last += 1; digits += flat[last].word; }
    if (digits.length < 4) return false;
    if (last === index && /^(?:19|20)\d\d$/.test(digits)) return false;
    return !UNITS.has(flat[last + 1]?.word.toLowerCase()) && !NUMBERED.has(flat[index - 1]?.word.toLowerCase());
  }
  return word.length >= 6 && /\d/.test(word) && /[A-Za-z]/.test(word) && word.match(/[A-Za-z]+|\d+/g).length >= 3;
}

/**
 * The secret-word rule across fields: the ordered judge-text fields of one
 * item, or of the whole outbound request, read as one stream of tokens. Each
 * secret-named word reaches back to the start of its sentence (at most six
 * words) and forward across sentence, field and item boundaries (twelve
 * words); a likely value inside that window refuses. A plain quantity —
 * "The token expired after 3600 seconds." — is not a value.
 */
export function secretScopeProblem(values) {
  const flat = [];
  let sentence = 0;
  for (const text of values) {
    if (typeof text !== "string") continue;
    sentence += 1;
    const tokens = tokensOf(text);
    const named = secretWords(text, tokens);
    tokens.forEach((token, index) => {
      const gap = index > 0 ? text.slice(tokens[index - 1].end, token.start) : "";
      if (/[.;]\s|[.;]$/.test(gap) || /[.;]\s*$/.test(gap)) sentence += 1;
      const next = tokens[index + 1];
      flat.push({ word: token.word, sentence, secret: named.has(index), joinsNext: Boolean(next) && /^ *-? *$/.test(text.slice(token.end, next.start)) });
    });
  }
  for (const [at, token] of flat.entries()) {
    if (!token.secret) continue;
    for (let before = Math.max(0, at - WINDOW_BEFORE); before < at; before += 1) if (flat[before].sentence === token.sentence && likelyValue(flat, before)) return JUDGE_PROSE_RULES.scope;
    for (let after = at + 1; after <= Math.min(flat.length - 1, at + WINDOW_AFTER); after += 1) if (likelyValue(flat, after)) return JUDGE_PROSE_RULES.scope;
  }
  return null;
}

const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactly = (value, keys) => plainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export const TESTER_JUDGE_KEYS = Object.freeze(["verification", "limits_summary"]);
export const TESTER_ENTRY_KEYS = Object.freeze(["action_summary", "observation_summary"]);
export const CRITERION_SUMMARY_KEYS = Object.freeze(["criterion", "summary"]);
export const EXPERIMENT_JUDGE_KEYS = Object.freeze(["contract_attacked", "action_summary", "expected_result", "observation_summary"]);
const CRITERION_ID = /^verification:[1-9]\d?$/;

/**
 * Problems with a Tester report's `judge` projection, each naming the field
 * to rewrite. Its `verification` has one entry per raw `verification` item,
 * in order, so `tester:verification:N` names both the local raw check and its
 * projection. Its optional `criteria` restates, for the judge, a ticket
 * criterion that cannot be sent as written. `prose: false` checks shape
 * alone, for lifecycle readers that must not depend on how well the
 * projection is written.
 */
export function testerJudgeErrors(report, { prose = true } = {}) {
  const judge = report?.judge;
  const keys = plainObject(judge) && Object.hasOwn(judge, "criteria") ? [...TESTER_JUDGE_KEYS, "criteria"] : TESTER_JUDGE_KEYS;
  if (!exactly(judge, keys)) return [`judge must have exactly ${TESTER_JUDGE_KEYS.join(" and ")}, and optionally criteria`];
  const errors = [];
  const raw = Array.isArray(report.verification) ? report.verification.length : 0;
  if (!Array.isArray(judge.verification) || judge.verification.length !== raw) errors.push("judge.verification must have one entry per verification item, in order");
  for (const [index, entry] of (Array.isArray(judge.verification) ? judge.verification : []).entries()) {
    const where = `judge.verification[${index + 1}]`;
    if (!exactly(entry, TESTER_ENTRY_KEYS)) { errors.push(`${where} must have exactly ${TESTER_ENTRY_KEYS.join(" and ")}`); continue; }
    errors.push(...TESTER_ENTRY_KEYS.flatMap((key) => fieldErrors(`${where}.${key}`, entry[key], prose, { verdict: true })));
    if (prose && !errors.length) errors.push(...scopeErrors(where, TESTER_ENTRY_KEYS.map((key) => entry[key])));
  }
  errors.push(...fieldErrors("judge.limits_summary", judge.limits_summary, prose, { verdict: true }));
  if (prose && !errors.length) errors.push(...scopeErrors("judge.limits_summary", [judge.limits_summary]));
  if (keys.includes("criteria")) {
    const seen = new Set();
    if (!Array.isArray(judge.criteria) || judge.criteria.length > 20) errors.push("judge.criteria must be a list of at most 20 criterion summaries");
    for (const [index, entry] of (Array.isArray(judge.criteria) ? judge.criteria : []).entries()) {
      const where = `judge.criteria[${index + 1}]`;
      if (!exactly(entry, CRITERION_SUMMARY_KEYS) || typeof entry.criterion !== "string" || !CRITERION_ID.test(entry.criterion) || seen.has(entry.criterion)) { errors.push(`${where} must have exactly a distinct criterion (verification:N) and a summary`); continue; }
      seen.add(entry.criterion);
      errors.push(...fieldErrors(`${where}.summary`, entry.summary, prose, { verdict: true }));
      if (prose && !errors.length) errors.push(...scopeErrors(`${where}.summary`, [entry.summary]));
    }
  }
  // Across items too: a secret named in one check and its value in the next.
  if (prose && !errors.length) {
    // In the bundle's order: criteria first, by number, then checks, then limits.
    const summaries = [...(judge.criteria ?? [])].sort((left, right) => Number(left.criterion.split(":")[1]) - Number(right.criterion.split(":")[1]));
    const texts = [...summaries.map((entry) => entry.summary), ...judge.verification.flatMap((entry) => TESTER_ENTRY_KEYS.map((key) => entry[key])), judge.limits_summary];
    errors.push(...scopeErrors("judge (across its entries)", texts));
  }
  return errors;
}

/** Problems with one Adversary experiment's `judge` projection. */
export function experimentJudgeErrors(experiment, where, { prose = true } = {}) {
  const judge = experiment?.judge;
  if (!exactly(judge, EXPERIMENT_JUDGE_KEYS)) return [`${where}: judge must have exactly ${EXPERIMENT_JUDGE_KEYS.join(", ")}`];
  const errors = EXPERIMENT_JUDGE_KEYS.flatMap((key) => fieldErrors(`${where}: judge.${key}`, judge[key], prose, { verdict: true }));
  return prose && !errors.length ? scopeErrors(`${where}: judge`, EXPERIMENT_JUDGE_KEYS.map((key) => judge[key])) : errors;
}

function fieldErrors(where, value, prose, { verdict = false } = {}) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 2048) return [`${where} must be a non-empty string`];
  const problem = prose ? judgeProseProblem(value) ?? (verdict && verdictCase.test(value) ? JUDGE_PROSE_RULES.verdict : null) : null;
  return problem ? [`${where} must be rewritten as judge prose: ${problem}`] : [];
}

function scopeErrors(where, values) {
  const problem = secretScopeProblem(values);
  return problem ? [`${where} must be rewritten as judge prose: ${problem}`] : [];
}
