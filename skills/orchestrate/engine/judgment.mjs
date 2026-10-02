/**
 * The Evidence Judge: an optional, provider-agnostic second reading of whether
 * the evidence a ticket's independent Tester and Adversary produced actually
 * supports the ticket's `## Verification` claims.
 *
 * The judge classifies. Pathfinder decides. A provider returns an assessment
 * in this module's contract; this module validates it as untrusted input and
 * its own deterministic policy turns it into one of three decisions:
 *
 *   continue          proceed to the existing next gate (human approval)
 *   require_evidence  do not present the work as ready; more evidence needed
 *   escalate          stop and put the judgment in front of the human
 *
 * No decision is approval, PASS/FAIL, acceptance, or a lifecycle write. A
 * provider failure, a timeout, or malformed output is `escalate`, never
 * `continue`. With no provider configured nothing is called, nothing is
 * written, and integration behaves exactly as it did before the judge existed.
 *
 * The result is a transient checkpoint in the claim's own
 * `context/current-ticket.md`, bound to the exact PR head and to a fingerprint
 * of the evidence it judged, so a resumed integration reuses it rather than
 * asking again. Its recorded decision is never trusted on read: it is
 * recomputed from the validated assessment.
 */

import { createHash } from "node:crypto";
import { parseSource, SOURCE_TYPES } from "../../../lib/evidence-references.mjs";
import { encodedPair, experimentJudgeErrors, judgeProseProblem, secretScopeProblem, splitToken, testerJudgeErrors, tokensOf } from "./judge-prose.mjs";

export const JUDGMENT_HEADING = "## Evidence judgment";
// Version 2: the bundle carries only the judge-facing projection, never raw evidence.
export const CONTRACT = "pathfinder.evidence-judgment/2";
export const ASSESSMENTS = Object.freeze(["supported", "insufficient", "contradicted"]);
export const DECISIONS = Object.freeze(["continue", "require_evidence", "escalate"]);
export const CONCERN_KINDS = Object.freeze(["security", "scope"]);
export const FAILURE_KINDS = Object.freeze(["configuration", "timeout", "provider-error", "malformed", "outbound"]);

/** Pathfinder's threshold, not the provider's: supported below this needs more evidence. */
export const MIN_SUPPORTED_CONFIDENCE = 0.8;
export const DEFAULT_TIMEOUT_MS = 15000;
export const MAX_CRITERIA = 20;
export const MAX_BUNDLE_BYTES = 32768;
export const MAX_ASSESSMENT_BYTES = 24576;
export const MAX_RECORD_BYTES = 32768;

const RANK = { continue: 0, require_evidence: 1, escalate: 2 };
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 2048) => typeof value === "string" && value.trim() !== "" && value.length <= max;
const unit = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

// Conservative: a false positive costs a human look, a miss sends a credential
// away. Layered, and every string in the bundle is screened raw, before JSON
// escaping can hide a match. No layer ever reports the value it matched, and
// nothing decoded here is kept, logged, or returned.
//
// 1. An assignment whose name says it holds a secret, of any length. The raw
//    value — the next run of non-space, or, when the line ends there, the
//    first run on an indented line or a `- ` sequence item below, as YAML and
//    pretty-printed JSON nest it (other unindented lines are prose), including
//    a bare `-` whose scalar is on the indented line after it; quotes and
//    escapes kept — is
//    exempt only when it is empty or one `$NAME` / `${NAME}` reference, quoted
//    or not, followed by nothing but closing punctuation: `${PREFIX}hunter2`,
//    `"$P hunter2"`, `"$P"hunter2`, `"'hunter2'"` and `$P,hunter2` refuse.
const SECRET_NAME = String.raw`[A-Za-z0-9_.-]{0,64}(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credentials?)[A-Za-z0-9_-]{0,64}`;
const SEQUENCE_ITEM = String.raw`-(?:[ \t]+|[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]+)`;
const ASSIGNMENT = new RegExp(String.raw`(?:^|[^A-Za-z0-9_])["']?${SECRET_NAME}["']?\s*[:=](?:[ \t]*\r?\n(?:[ \t]*\r?\n)*(?:[ \t]+(?:${SEQUENCE_ITEM})?|${SEQUENCE_ITEM})|[ \t]*)(\S*)`, "gi");
const HARMLESS_VALUE = /^(?:(["']?)\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)\1)?[,;.:)}\]"']*$/;
const secretAssignment = (text) => [...text.matchAll(ASSIGNMENT)].some(([, value]) => !HARMLESS_VALUE.test(value.replace(/\\/g, "")));

// 2. An Authorization header (`Authorization`, `Proxy-Authorization`,
//    `X-Authorization`, …), parsed by its words: a known scheme followed by
//    anything refuses; so does any value of one or two words, which is the
//    shape of a credential with or without a scheme. Longer prose refuses when
//    any word has the shape of a secret: a digit, `+ / =`, or a capital inside
//    a word. A bare `Basic <payload>` (after a space, `:` or `=`) refuses when
//    the payload decodes, in memory, to `user:pass` or looks like one, and
//    `-u`, `-U`, `--user` or `--proxy-user` with `user:pass` refuses; a
//    numeric `uid:gid`, as `docker run -u` takes, is not a credential.
const AUTH_HEADER = /(?:^|[^A-Za-z0-9_])["']?[A-Za-z0-9_-]{0,32}?authorization["']?\s*[:=]\s*["']?([^\r\n"']{0,256})/gi;
const AUTH_SCHEMES = new Set(["basic", "bearer", "digest", "token", "negotiate", "ntlm", "hoba", "mutual", "apikey", "api-key", "key", "jwt", "oauth", "aws4-hmac-sha256"]);
const secretShaped = (word) => /\d|[+/=]|[a-z][A-Z]/.test(word);
const credentialLike = (word) => word.length >= 8 && (/\d/.test(word) || (/[A-Z]/.test(word) && /[a-z]/.test(word)) || /[+/=]/.test(word));
function authorizationCredential(text) {
  for (const [, value] of text.matchAll(AUTH_HEADER)) {
    const words = value.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    if (AUTH_SCHEMES.has(words[0].toLowerCase())) {
      if (words.length > 1) return true;
    } else if (words.length <= 2 || words.some(secretShaped)) return true;
  }
  return false;
}
const BASIC_PAYLOAD = /\bBasic(?:\s+|\s*[:=]\s*)([A-Za-z0-9+/_-]{4,}={0,2})(?![A-Za-z0-9+/=_-])/gi;
const USER_PASS = /^[\x21-\x7e]+:[\x20-\x7e]*$/;
const basicPayload = (text) => [...text.matchAll(BASIC_PAYLOAD)].some(([, payload]) =>
  credentialLike(payload) || USER_PASS.test(Buffer.from(payload, "base64").toString("latin1")));
// The flag is found after a space or JSON punctuation (`["-u", "a:b"]`). Its
// value is read as one shell word: a quote or `$(…)` is read through its
// closing mark, so `"admin: pw"` is one value, and a flag inside a value
// already read whole is part of that value, not a flag. A quoted value, with
// any JSON punctuation after it, is classified by what the quotes hold;
// otherwise quotes stay (`admin:'pw'`, `"$U":pw`). `user:pass` refuses unless
// both sides are pure `$` references. Only among a container command's own
// options (`docker run|exec|create`, `docker compose run|exec`, likewise
// podman and nerdctl, before the image, container or service and with no `;`,
// `|`, `&`, newline or stray `)` or backtick between), where `-u` means
// `uid:gid`, does a numeric pair or `$(id -u):$(id -g)` pass. Named pairs
// refuse everywhere: `admin:admin` is a credential as often as a user and
// group. Values are disjoint and the look-back is bounded, so the scan stays
// linear.
const USER_OPTION = /(?:^|[\s[,"'])(?:-[uU]|--user|--proxy-user)(?:["']?(?:\s*,\s*|\s+)|=)?/g;
const REFERENCE = /^["']?\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)["']?$/;
const ID_SUBSTITUTION = /^\$\(id -[ug]\)$/;
const QUOTED_VALUE = /^(["'])([\s\S]*)\1[,\])}]*$/;
const CONTAINER_COMMAND = /\b(?:docker|podman|nerdctl)\s+(?:(?:container|compose)\s+)?(?:run|exec|create)\b/g;
// Options of `run`/`exec` that take the next word as their value; any other
// option is read as a switch, so an unlisted one ends the options early,
// which refuses rather than passes.
const VALUE_OPTIONS = new Set(["-u", "--user", "-e", "--env", "--env-file", "-v", "--volume", "-w", "--workdir", "--name", "--network", "--entrypoint", "-p", "--publish", "-l", "--label", "--mount", "--platform", "-h", "--hostname"]);

/** One shell word from `start`: its end, and whether a quote or `$(` was left open or a `)` or backtick stood bare. */
function shellWord(text, start) {
  let at = start;
  let stray = false;
  while (at < text.length && !/\s/.test(text[at])) {
    if (text[at] === '"' || text[at] === "'") {
      const close = text.indexOf(text[at], at + 1);
      if (close === -1) return { end: text.length, open: true, stray };
      at = close + 1;
    } else if (text[at] === "$" && text[at + 1] === "(") {
      let depth = 0;
      for (at += 1; at < text.length; at += 1) if (text[at] === "(") depth += 1; else if (text[at] === ")" && --depth === 0) break;
      if (at >= text.length) return { end: text.length, open: true, stray };
      at += 1;
    } else {
      if (text[at] === ")" || text[at] === "`") stray = true;
      at += 1;
    }
  }
  return { end: at, open: false, stray };
}

/** Whether a flag at `index` stands among a container command's own options. */
function containerOption(text, index) {
  const window = text.slice(Math.max(0, index - 200), index);
  const command = window.slice(Math.max(...[";", "|", "&", "\n"].map((stop) => window.lastIndexOf(stop))) + 1);
  const found = [...command.matchAll(CONTAINER_COMMAND)].pop();
  if (!found) return false;
  const options = command.slice(found.index + found[0].length);
  let takesValue = false;
  for (let at = 0; ;) {
    while (at < options.length && /\s/.test(options[at])) at += 1;
    if (at >= options.length) return true;
    const word = shellWord(options, at);
    if (word.open || word.stray) return false;
    const token = options.slice(at, word.end);
    if (takesValue) takesValue = false;
    else if (!token.startsWith("-")) return false;
    else takesValue = VALUE_OPTIONS.has(token);
    at = word.end;
  }
}

function userOption(text) {
  let read = 0;
  for (const match of text.matchAll(USER_OPTION)) {
    const start = match.index + match[0].length;
    // Inside a value already read, or `id`'s own flag in `$(id -u)`.
    if (match.index < read || (text[start] === ")" && text.slice(Math.max(0, match.index - 4), match.index) === "$(id")) continue;
    read = shellWord(text, start).end;
    const raw = text.slice(start, read);
    const value = QUOTED_VALUE.exec(raw)?.[2] ?? raw;
    const colon = value.indexOf(":");
    if (colon === -1 || colon === value.length - 1) continue;
    const [user, group] = [value.slice(0, colon), value.slice(colon + 1)];
    if (REFERENCE.test(user) && REFERENCE.test(group)) continue;
    const uidGid = (/^\d+$/.test(user) && /^\d+$/.test(group)) || (ID_SUBSTITUTION.test(user) && ID_SUBSTITUTION.test(group));
    if (!(uidGid && containerOption(text, match.index))) return true;
  }
  return false;
}

// 3. Credential formats that are a credential wherever they appear.
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/,
  /\bwhsec_[A-Za-z0-9]{16,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i,
];
// An AWS secret access key: exactly 40 base64 characters mixing upper, lower
// and digits. A lowercase-hex commit SHA never mixes cases, so it never matches.
const AWS_SECRET = /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])/g;
const awsSecret = (value) => [...value.matchAll(AWS_SECRET)].some(([run]) => /[A-Z]/.test(run) && /[a-z]/.test(run) && /\d/.test(run));

// A JWT, `eyJ…(8+).eyJ…(8+).…`, found by a linear scan anchored on each
// `.eyJ`: a regex here backtracks quadratically over a run like `eyJ-eyJ-…`.
// Runs between dots are disjoint, so each character is read a bounded number
// of times.
const TOKEN_CHAR = /[A-Za-z0-9_-]/;
function jwt(text) {
  for (let dot = text.indexOf(".eyJ"); dot !== -1; dot = text.indexOf(".eyJ", dot + 1)) {
    let end = dot + 1;
    while (end < text.length && TOKEN_CHAR.test(text[end])) end += 1;
    if (end - (dot + 1) < 11 || text[end] !== ".") continue;
    let start = dot;
    while (start > 0 && TOKEN_CHAR.test(text[start - 1])) start -= 1;
    const first = text.slice(start, dot);
    for (let at = first.indexOf("eyJ"); at !== -1; at = first.indexOf("eyJ", at + 1)) {
      if ((at === 0 || !/[A-Za-z0-9_]/.test(first[at - 1])) && first.length - at - 3 >= 8) return true;
    }
  }
  return false;
}

// 4. User-info in a URL: `user:pass@`, and a token posing as the user. Only a
//    conventional account name (`git@`, `deploy@`, `ubuntu@`, …) is let
//    through; any other user may be a token, so it refuses. A linear scan,
//    not a regex: from each `://` with a scheme character before it, read to
//    the first delimiter, and an `@` there ends the user-info. The next `://`
//    contains `/`, so no stretch of text is read twice.
const PLAIN_USERS = new Set(["git", "hg", "svn", "deploy", "ubuntu", "ec2-user", "centos", "debian", "fedora", "admin", "root", "user", "postgres", "azureuser", "anonymous", "builder", "ci"]);
function urlUserinfo(text) {
  for (let at = text.indexOf("://"); at !== -1; at = text.indexOf("://", at + 3)) {
    if (at === 0 || !/[A-Za-z0-9+.-]/.test(text[at - 1])) continue;
    // The user-info ends at the LAST `@` before the host, as a URL parser
    // reads it: `admin@evil:pw@host` has the user-info `admin@evil:pw`.
    let last = -1;
    let index = at + 3;
    for (; index < text.length && !/[\s/?#]/.test(text[index]); index += 1) if (text[index] === "@") last = index;
    if (last !== -1) {
      const user = text.slice(at + 3, last);
      if (user !== "" && !PLAIN_USERS.has(user)) return true;
    }
  }
  return false;
}

/** Strings of a value, depth first, each exactly as a reader would see it. */
function stringsOf(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const entry of value) stringsOf(entry, out);
  else if (plain(value)) for (const entry of Object.values(value)) stringsOf(entry, out);
  return out;
}

// 5. The provider's own credential, and the ways a log or a shell restates it.
// Escaping and quoting only add backslashes and quotes, so with both removed
// from the text and the secret alike, every escaped or quoted form matches.
// Compared without case, so an upper-cased or upper-hex copy matches too.
const bare = (value) => value.replace(/[\\"']/g, "");
function knownForms(secret) {
  const forms = [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), bare(secret), squashed(secret), Buffer.from(secret).toString("hex")];
  for (const encoding of ["base64", "base64url"]) forms.push(Buffer.from(secret).toString(encoding).replace(/=+$/, ""));
  return [...new Set(forms.filter((form) => form.length > 0).map((form) => form.toLowerCase()))];
}

// A copy of the text with percent, `\x` and `\u` escapes decoded and every
// space, quote and backslash removed: a key split across lines, spaced hex,
// or a fully escaped key all collapse back to a form compared below.
const byte = (hex) => String.fromCharCode(parseInt(hex, 16));
const squashed = (text) => text
  .replace(/%([0-9a-f]{2})/gi, (_, hex) => byte(hex))
  .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => byte(hex))
  .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => byte(hex))
  .replace(/[\s\\"']/g, "");

// Base64 hides a credential behind any prefix — `api:KEY`, `Bearer KEY` — and
// text glued to the front of a run shifts its alignment. Each run is decoded
// in memory at all four alignments and only ever tested, never kept; a second
// level catches base64 inside base64, such as a Basic payload re-encoded.
const BASE64_RUN = /[A-Za-z0-9+/_-]{12,}={0,2}/g;
function* decodedRuns(text, depth = 2) {
  for (const [run] of text.matchAll(BASE64_RUN)) {
    for (let shift = 0; shift < 4; shift += 1) {
      const decoded = Buffer.from(run.slice(shift), "base64").toString("latin1");
      yield decoded;
      if (depth > 1) yield* decodedRuns(decoded, depth - 1);
    }
  }
}

/**
 * Which kind of credential, if any, a bundle carries; never which value. Every
 * declared secret is screened however short it is — a short key matching
 * ordinary text refuses, which is the side to fail on.
 */
export function credentialIn(value, secrets = []) {
  const declared = secrets.filter((secret) => typeof secret === "string" && secret !== "");
  const known = declared.flatMap(knownForms);
  const raw = [...new Set(declared.flatMap((secret) => [secret, bare(secret)]).filter(Boolean).map((form) => form.toLowerCase()))];
  for (const text of stringsOf(value)) {
    const lower = text.toLowerCase();
    const plainText = bare(lower);
    const unwrapped = squashed(text);
    const flat = unwrapped.toLowerCase();
    if (known.some((form) => lower.includes(form) || plainText.includes(form) || flat.includes(form))) return "the judge's own credential";
    if (secretAssignment(text)) return "a secret-named assignment";
    if (authorizationCredential(text) || basicPayload(text) || userOption(text)) return "an Authorization credential";
    if (SECRET_PATTERNS.some((pattern) => pattern.test(text)) || jwt(text) || awsSecret(text)) return "a known credential format";
    if (urlUserinfo(text)) return "credentials in a URL";
    for (const decoded of decodedRuns(`${text}\n${unwrapped}`)) {
      const decodedLower = decoded.toLowerCase();
      if (raw.some((form) => decodedLower.includes(form))) return "the judge's own credential, encoded";
      if (SECRET_PATTERNS.some((pattern) => pattern.test(decoded)) || jwt(decoded)) return "an encoded credential";
    }
  }
  return null;
}

// At most three spaces of indentation, as CommonMark reads a fence; any, once
// inside the section after an item, because a fence inside a list item is
// indented further. A backtick fence's info string cannot contain a backtick,
// so ```x`y is a line of text, not a fence.
const FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const indentOf = (line) => /^[ \t]*/.exec(line)[0].replace(/\t/g, "    ").length;
const fenceOf = (line, anyIndent) => {
  const match = FENCE.exec(line);
  if (!match || (!anyIndent && indentOf(line) > 3)) return null;
  return match[2][0] === "`" && match[3].includes("`") ? null : match[2];
};
// A thematic break (`---`, `* * *`, `___`) is neutral: it ends nothing and is
// no criterion. A run of `=` or `-` directly under a line of text is a setext
// heading underline instead, and whether it starts a new section cannot be
// read without guessing, so it refuses.
const THEMATIC = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
/**
 * An ATX heading's text, normalized as CommonMark reads it: the optional
 * closing run of `#` and the whitespace around the text are not part of it,
 * so `## Verification`, `## Verification ##` and `##   Verification` agree.
 */
const headingText = (raw) => (raw ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim().toLowerCase();
const ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(.*\S)\s*$/;

/**
 * The claims under judgment: the list items of the ticket's `## Verification`
 * (`-`, `*`, `+` or numbered). A continuation line, or a fenced block, belongs
 * to the item above it. Fences are opaque: a heading or a list line inside one
 * is code, never structure.
 *
 * Deliberately not clever. Anything this cannot read without guessing — more
 * than one Verification section, text before the first item, an unterminated
 * fence, a setext heading underline — is refused, so no real
 * criterion is ever silently dropped.
 *
 * @returns {{ok: true, criteria: {id: string, text: string}[]} | {ok: false, reason: string}}
 */
export function parseVerification(body) {
  const refuse = (why) => ({ ok: false, reason: `## Verification cannot be read safely: ${why}` });
  let fence = null;
  let fenceIndent = 0;
  let inside = false;
  let previous = "blank";
  let sections = 0;
  const items = [];
  const attach = (line) => {
    if (!items.length) return false;
    items[items.length - 1] += ` ${line.trim()}`;
    return true;
  };
  for (const line of String(body ?? "").split(/\r?\n/)) {
    if (fence) {
      const close = fenceOf(line, true);
      if (close && close[0] === fence[0] && close.length >= fence.length && line.trim() === close) { fence = null; previous = "fence"; }
      // A fence opened inside a list item cannot outlive it: a line indented
      // less than the opening fence ends the item, so which lines are code
      // and which are criteria cannot be read without guessing.
      else if (inside && line.trim() && fenceIndent > 0 && indentOf(line) < fenceIndent) return refuse("a code block runs past the list item it opened in");
      else if (inside && line.trim()) attach(line);
      continue;
    }
    const open = fenceOf(line, inside && items.length > 0);
    if (open) {
      if (inside && !items.length) return refuse("a code block comes before the first list item");
      fence = open;
      fenceIndent = indentOf(line);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading && heading[1].length <= 2) {
      inside = heading[1].length === 2 && headingText(heading[2]) === "verification";
      previous = "blank";
      if (inside && (sections += 1) > 1) return refuse("there is more than one ## Verification section");
      continue;
    }
    if (!inside || heading) continue;
    if (!line.trim()) { previous = "blank"; continue; }
    if (SETEXT.test(line) && previous === "text") return refuse("a setext heading underline is inside the section");
    if (THEMATIC.test(line) || SETEXT.test(line)) { previous = "break"; continue; }
    const item = ITEM.exec(line);
    // Only a paragraph of its own — text after a blank line — can sit over a
    // setext underline; a continuation line belongs to its item's paragraph.
    if (item) { items.push(item[1]); previous = "item"; }
    else if (attach(line)) previous = previous === "blank" || previous === "text" ? "text" : "continuation";
    else return refuse("text before the first item is not a list item");
  }
  if (fence && inside) return refuse("a code block is unterminated");
  return { ok: true, criteria: items.map((value, index) => ({ id: `verification:${index + 1}`, text: value })) };
}

/** The criteria alone; throws where `parseVerification` refuses. */
export function criteriaOf(body) {
  const parsed = parseVerification(body);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.criteria;
}

/**
 * The judge-facing projection of a claim's evidence, field by field from an
 * allowlist. Raw Tester verification and limits, the Adversary's hypothesis,
 * setup, steps, raw results, reproducibility, impact, verifier instruction and
 * every `type:locator` reference stay in the local checkpoint; only the judge
 * prose written beside them is copied, revalidated here because a checkpoint
 * is a file anyone can edit. An Adversary item's `provenance` is the sorted
 * set of its reference types (`cmd`, `file`, `test`, …), never a locator.
 *
 * Every id is Pathfinder's own: `tester:verification:N` and `tester:limits`
 * name the Tester checkpoint's N-th check and its limits, `adversary:N` the
 * N-th same-head experiment. The Adversary's own `experiment_id` stays local.
 *
 * Evidence without a valid projection is refused, never converted: raw text
 * is not judge prose, and guessing at it would put the boundary back inside a
 * detector.
 *
 * @returns {{ok: true, evidence: object[]} | {ok: false, reason: string}}
 */
export function projectEvidence({ findings, experiments = [] }) {
  if (!plain(findings) || findings.judge === undefined) return { ok: false, reason: "the Tester findings carry no judge-facing projection; the Tester must record its checkpoint again with `judge` prose" };
  const testerErrors = testerJudgeErrors(findings);
  if (testerErrors.length) return { ok: false, reason: `the Tester findings' judge projection is invalid: ${testerErrors.slice(0, 3).join("; ")}` };
  const evidence = [
    ...findings.judge.verification.map((entry, index) => ({ id: `tester:verification:${index + 1}`, source: "tester", action_summary: entry.action_summary, observation_summary: entry.observation_summary })),
    { id: "tester:limits", source: "tester", limits_summary: findings.judge.limits_summary },
  ];
  for (const [index, experiment] of experiments.entries()) {
    const where = `experiment ${index + 1}`;
    if (experiment.judge === undefined) return { ok: false, reason: `Adversary ${where} carries no judge-facing projection; the Adversary must record its checkpoint again with \`judge\` prose` };
    const errors = experimentJudgeErrors(experiment, where);
    if (errors.length) return { ok: false, reason: `the Adversary experiments' judge projection is invalid: ${errors.slice(0, 3).join("; ")}` };
    const { judge } = experiment;
    const provenance = [...new Set((experiment.evidence ?? []).map((ref) => parseSource(ref)?.type).filter(Boolean))].sort();
    evidence.push({
      id: `adversary:${index + 1}`,
      source: "adversary",
      contract_attacked: judge.contract_attacked,
      action_summary: judge.action_summary,
      expected_result: judge.expected_result,
      observation_summary: judge.observation_summary,
      provenance,
    });
  }
  return { ok: true, evidence };
}

/**
 * A ticket criterion as the judge may read it, or null when it cannot be sent
 * as written. Inline code marks are dropped, since only their text carries
 * meaning; the rest must already be judge prose. Nothing else is rewritten.
 */
export function criterionAsWritten(text) {
  const candidate = String(text ?? "").replace(/`([^`]+)`/g, "$1");
  return judgeProseProblem(candidate) || secretScopeProblem([candidate]) ? null : candidate;
}

/** The `verification:N` ids of a ticket's criteria that need a Tester summary to be judged. */
export function criteriaNeedingSummary(body) {
  const parsed = parseVerification(body);
  return parsed.ok ? parsed.criteria.filter((criterion) => criterionAsWritten(criterion.text) === null).map((criterion) => criterion.id) : [];
}

/**
 * The judge-facing criteria. A criterion that is judge prose as written is
 * sent as written (`source: "ticket"`). One that carries commands, paths,
 * headers, code or values stays local, and the judge reads the Tester's
 * `judge.criteria` summary of it instead (`source: "tester-summary"`); with
 * no summary the bundle is refused rather than the raw criterion sent. A
 * summary of a criterion that can be sent as written is not used, so a
 * readable requirement is never restated by the party it judges.
 *
 * @returns {{ok: true, criteria: object[]} | {ok: false, reason: string}}
 */
export function projectCriteria(criteria, findings) {
  const summaries = new Map((plain(findings?.judge) && Array.isArray(findings.judge.criteria) ? findings.judge.criteria : []).map((entry) => [entry.criterion, entry.summary]));
  const projected = [];
  const missing = [];
  for (const criterion of criteria) {
    const written = criterionAsWritten(criterion.text);
    if (written !== null) projected.push({ id: criterion.id, text: written, source: "ticket" });
    else if (summaries.has(criterion.id)) projected.push({ id: criterion.id, text: summaries.get(criterion.id), source: "tester-summary" });
    else missing.push(criterion.id);
  }
  if (missing.length) return { ok: false, reason: `${missing.join(", ")} cannot be sent as written and has no judge.criteria summary from the Tester; the Tester must record its checkpoint again with one` };
  return { ok: true, criteria: projected };
}

/**
 * The smallest sufficient evidence bundle: the judge-facing projection of the
 * ticket's verification claims, of the Tester's actual verification and
 * limits, and of the Adversary's experiments at the same head. Never the
 * Tester's verdict word, so the judge reads evidence rather than agreeing with
 * a conclusion; never raw evidence, a raw criterion that cannot be sent as
 * written, source files, diffs, or conversation. `revision` binds the bundle
 * to its PR head for the checkpoint and never reaches a provider.
 *
 * @returns {{ok: true, bundle: object} | {ok: false, reason: string}}
 */
export function buildBundle({ ticket, body, pr, head, findings, experiments = null, secrets = [] }) {
  const parsed = parseVerification(body);
  if (!parsed.ok) return { ok: false, reason: `ticket ${ticket}: ${parsed.reason}` };
  if (parsed.criteria.length === 0) return { ok: false, reason: `ticket ${ticket} has no ## Verification items to judge evidence against` };
  if (parsed.criteria.length > MAX_CRITERIA) return { ok: false, reason: `ticket ${ticket} has ${parsed.criteria.length} verification items; at most ${MAX_CRITERIA} are judged` };
  if (parsed.criteria.some((criterion) => !text(criterion.text))) return { ok: false, reason: "a verification item exceeds 2048 characters" };
  const sameHead = experiments && experiments.ticket === ticket && experiments.pr === pr && experiments.head_sha.toLowerCase() === head.toLowerCase();
  const projected = projectEvidence({ findings, experiments: sameHead ? experiments.experiments : [] });
  if (!projected.ok) return { ok: false, reason: `ticket ${ticket}: ${projected.reason}; nothing was sent` };
  const criteria = projectCriteria(parsed.criteria, findings);
  if (!criteria.ok) return { ok: false, reason: `ticket ${ticket}: ${criteria.reason}; nothing was sent` };
  const bundle = { contract: CONTRACT, ticket: { key: ticket }, revision: { pr, head_sha: head.toLowerCase() }, criteria: criteria.criteria, evidence: projected.evidence };
  if (bytes(bundle) > MAX_BUNDLE_BYTES) return { ok: false, reason: `evidence bundle exceeds ${MAX_BUNDLE_BYTES} bytes; compact judgment refused` };
  const credential = credentialIn(bundle, secrets);
  if (credential) return { ok: false, reason: `evidence bundle appears to contain a credential (${credential}); nothing was sent` };
  const outbound = outboundProblem(outboundOf(bundle), secrets);
  if (outbound) return { ok: false, reason: `evidence bundle fails the outbound contract (${outbound}); nothing was sent` };
  return { ok: true, bundle };
}

/**
 * The outbound checks a Tester's checkpoint can run when it is written, on
 * exactly what the bundle will hold, in the bundle's order: the ticket's
 * criteria, the projection being written, and the claim's same-head Adversary
 * experiments. Only problems the projection causes are reported; a ticket the
 * judge cannot read is the judge's refusal to make, not the Tester's.
 * Declared credentials are unknown here, so the screen for them runs later.
 *
 * @returns {string|null}
 */
export function projectionProblem({ ticket, body, pr, head, findings, experiments = null }) {
  const parsed = parseVerification(body);
  if (!parsed.ok || parsed.criteria.length === 0 || parsed.criteria.length > MAX_CRITERIA) return null;
  const sameHead = experiments && experiments.ticket === ticket && experiments.pr === pr && String(experiments.head_sha).toLowerCase() === String(head).toLowerCase();
  const evidence = projectEvidence({ findings, experiments: sameHead ? experiments.experiments : [] });
  if (!evidence.ok) return evidence.reason;
  const criteria = projectCriteria(parsed.criteria, findings);
  if (!criteria.ok) return criteria.reason;
  const bundle = { contract: CONTRACT, ticket: { key: ticket }, revision: { pr, head_sha: String(head).toLowerCase() }, criteria: criteria.criteria, evidence: evidence.evidence };
  if (bytes(bundle) > MAX_BUNDLE_BYTES) return `the judge-facing bundle would exceed ${MAX_BUNDLE_BYTES} bytes`;
  const problem = outboundProblem(outboundOf(bundle), []);
  return problem ? `the judge-facing request would be refused (${problem})` : null;
}

/* ------------------------------------------------- the outbound boundary --- */

/**
 * What a provider is given: the ticket key, the projected criteria and the
 * projected evidence, and nothing else — not the revision, not the contract
 * name, not the criterion sources. Every string in it is either generated by
 * Pathfinder from trusted structure (keys, ids, enums, reference types) or
 * judge prose.
 */
export function outboundOf(bundle) {
  return {
    ticket: { key: bundle.ticket.key },
    criteria: bundle.criteria.map((criterion) => ({ id: criterion.id, text: criterion.text })),
    evidence: bundle.evidence.map((entry) => ({ ...entry, ...(entry.provenance ? { provenance: [...entry.provenance] } : {}) })),
  };
}

const EVIDENCE_SHAPES = {
  "tester-check": { id: /^tester:verification:[1-9]\d?$/, keys: ["id", "source", "action_summary", "observation_summary"], prose: ["action_summary", "observation_summary"] },
  "tester-limits": { id: /^tester:limits$/, keys: ["id", "source", "limits_summary"], prose: ["limits_summary"] },
  adversary: { id: /^adversary:[1-9]\d?$/, keys: ["id", "source", "contract_attacked", "action_summary", "expected_result", "observation_summary", "provenance"], prose: ["contract_attacked", "action_summary", "expected_result", "observation_summary"] },
};
const shapeOf = (entry) => (entry.source === "adversary" ? "adversary" : entry.id === "tester:limits" ? "tester-limits" : "tester-check");

/**
 * Which outbound rule a provider's view breaks, or null. Every field is
 * re-checked by category: generated fields against a tiny machine grammar,
 * text fields as judge prose, each item's fields together for the
 * secret-word scope, and the whole view as one text, so that a credential
 * split across fragments or fields, or the judge's own key behind any
 * separator, is caught. Names a rule, never a value.
 */
export function outboundProblem(outbound, secrets = []) {
  if (!plain(outbound) || !exactKeys(outbound, ["ticket", "criteria", "evidence"])) return "unexpected top-level field";
  if (!plain(outbound.ticket) || !exactKeys(outbound.ticket, ["key"]) || typeof outbound.ticket.key !== "string" || !/^\d+\.\d+$/.test(outbound.ticket.key)) return "ticket key";
  if (!Array.isArray(outbound.criteria) || !Array.isArray(outbound.evidence)) return "criteria and evidence must be lists";
  for (const [index, criterion] of outbound.criteria.entries()) {
    if (!plain(criterion) || !exactKeys(criterion, ["id", "text"]) || criterion.id !== `verification:${index + 1}`) return `criterion ${index + 1} shape`;
    if (judgeProseProblem(criterion.text) || secretScopeProblem([criterion.text])) return `${criterion.id} text is not judge prose`;
  }
  for (const [index, entry] of outbound.evidence.entries()) {
    if (!plain(entry) || !["tester", "adversary"].includes(entry.source)) return `evidence ${index + 1} source`;
    const shape = EVIDENCE_SHAPES[shapeOf(entry)];
    if (!exactKeys(entry, shape.keys) || typeof entry.id !== "string" || !shape.id.test(entry.id)) return `evidence ${index + 1} shape`;
    if (shape.prose.some((key) => judgeProseProblem(entry[key])) || secretScopeProblem(shape.prose.map((key) => entry[key]))) return `${entry.id} is not judge prose`;
    if (entry.provenance && (!Array.isArray(entry.provenance) || !entry.provenance.every((type) => SOURCE_TYPES.includes(type)))) return `${entry.id} provenance`;
  }
  // The secret-word window across every criterion and evidence field, in order.
  const prose = [...outbound.criteria.map((criterion) => criterion.text), ...outbound.evidence.flatMap((entry) => EVIDENCE_SHAPES[shapeOf(entry)].prose.map((key) => entry[key]))];
  if (secretScopeProblem(prose)) return "a likely value near a secret-named word, across fields";
  return textProblem(stringsOf(outbound), secrets);
}

/**
 * The same whole-text checks over every string a request will carry: the
 * credential screen, a credential assembled from fragments in sequence across
 * strings, an encoded `user:password`, and each declared secret compared with
 * every separator removed from both sides.
 */
function textProblem(strings, secrets) {
  if (credentialIn(strings, secrets)) return "a credential";
  const stream = strings.join(" ");
  if (splitToken(stream)) return "a credential split into short pieces";
  if (tokensOf(stream).some((token) => encodedPair(token.word))) return "an encoded credential";
  const flat = stream.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (secrets.some((secret) => { const bare = String(secret).replace(/[^A-Za-z0-9]/g, "").toLowerCase(); return bare.length >= 8 && flat.includes(bare); })) return "the judge's own credential";
  return null;
}

/**
 * The final assertion, on the exact bytes a provider sends: a JSON body whose
 * every string and key passes the whole-text checks. Run by the fetch handed
 * to the provider, after the request is serialized and before it leaves.
 */
export function outboundBodyProblem(body, secrets = []) {
  if (typeof body !== "string" || Buffer.byteLength(body, "utf8") > 4 * MAX_BUNDLE_BYTES) return "the request body is not a bounded string";
  let parsed;
  try { parsed = JSON.parse(body); } catch { return "the request body is not JSON"; }
  // The bytes must be exactly the serialization of what was checked: no
  // duplicate key a parser would drop, no extra whitespace, no alternative escape.
  if (JSON.stringify(parsed) !== body) return "the request body is not the canonical serialization of its content";
  if (credentialIn([body], secrets)) return "a credential in the raw body";
  const strings = [];
  const walk = (value) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (plain(value)) for (const [key, entry] of Object.entries(value)) { strings.push(key); walk(entry); }
  };
  walk(parsed);
  return textProblem(strings, secrets);
}

const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];
/**
 * Which rule a provider's declared transport breaks, or null: one plain https
 * endpoint (http only on loopback) with no user-info, query or fragment;
 * lower-case header names; an Authorization header, if any, of exactly
 * `Bearer <declared credential>`; and no declared credential anywhere else.
 */
export function declaredTransportProblem(declared, secrets = []) {
  if (!plain(declared) || !exactKeys(declared, ["url", "headers"]) || typeof declared.url !== "string" || !plain(declared.headers)) return "the provider's transport is malformed";
  let url;
  try { url = new URL(declared.url); } catch { return "the provider's endpoint is not a URL"; }
  if (!(url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.href !== declared.url) return "the provider's endpoint must be a plain https URL";
  if (textProblem([declared.url], secrets)) return "the provider's endpoint carries a credential";
  const keys = secrets.filter((secret) => typeof secret === "string" && secret !== "");
  for (const [name, value] of Object.entries(declared.headers)) {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(name) || typeof value !== "string") return "a declared header is malformed";
    if (name === "authorization") {
      if (!/^Bearer [\x21-\x7e]+$/.test(value) || !keys.includes(value.slice("Bearer ".length))) return "the Authorization header is not exactly Bearer and the provider's declared credential";
    } else if (!/^[A-Za-z0-9.\/+;=, -]{1,128}$/.test(value) || credentialIn([value], secrets) || textProblem([value], keys)) return `the ${name} header carries something other than a plain value`;
  }
  return null;
}

/** Which rule one fetch call breaks against the declared transport, or null. */
export function transportProblem(url, init, declared) {
  if (typeof url !== "string" || url !== declared.url) return "the destination is not the provider's declared endpoint";
  if (!plain(init) || Object.keys(init).some((key) => !["method", "headers", "body", "redirect", "signal"].includes(key))) return "unexpected request options";
  if (init.method !== "POST" || init.redirect !== "error") return "the request must be a POST that refuses redirects";
  const headers = init.headers;
  if (!plain(headers) || !exactKeys(headers, Object.keys(declared.headers)) || Object.entries(declared.headers).some(([name, value]) => headers[name] !== value)) return "the request headers differ from the provider's declared headers";
  return null;
}

/** Key-sorted JSON, so equal evidence always hashes equally. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Identical evidence judged by the same provider and model has one fingerprint. */
export function fingerprint(bundle, judge) {
  const digest = createHash("sha256").update(canonical({ contract: CONTRACT, provider: judge.name, model: judge.model, bundle })).digest("hex");
  return `sha256:${digest}`;
}

/** The overall assessment the per-criterion assessments imply. */
export function overallOf(criteria) {
  if (criteria.some((entry) => entry.assessment === "contradicted")) return "contradicted";
  if (criteria.some((entry) => entry.assessment === "insufficient")) return "insufficient";
  return "supported";
}

/**
 * Validate a provider's assessment as untrusted input against the bundle it
 * judged. Error messages never echo provider values.
 */
export function validateAssessment(assessment, bundle) {
  const errors = [];
  if (!plain(assessment)) return { ok: false, errors: ["assessment must be an object"] };
  if (bytes(assessment) > MAX_ASSESSMENT_BYTES) return { ok: false, errors: [`assessment exceeds ${MAX_ASSESSMENT_BYTES} bytes`] };
  if (!exactKeys(assessment, ["criteria", "overall", "unresolved_claims", "security_or_scope_concerns"])) errors.push("assessment must have exactly criteria, overall, unresolved_claims, security_or_scope_concerns");
  const evidenceIds = new Set(bundle.evidence.map((entry) => entry.id));
  const criterionIds = bundle.criteria.map((entry) => entry.id);
  const refs = (value, where) => {
    if (!Array.isArray(value) || value.length > 20 || new Set(value).size !== value.length) errors.push(`${where}: evidence_refs must be at most 20 distinct references`);
    else if (value.some((ref) => !evidenceIds.has(ref))) errors.push(`${where}: evidence_refs must name evidence in the bundle`);
  };
  const criteria = Array.isArray(assessment.criteria) ? assessment.criteria : null;
  if (!criteria || criteria.length !== criterionIds.length) errors.push("criteria must assess every bundle criterion exactly once");
  const seen = new Set();
  for (const [index, entry] of (criteria ?? []).entries()) {
    const where = `criterion ${index + 1}`;
    if (!plain(entry) || !exactKeys(entry, ["criterion", "assessment", "confidence", "evidence_refs", "reason"])) { errors.push(`${where}: must have exactly criterion, assessment, confidence, evidence_refs, reason`); continue; }
    if (!criterionIds.includes(entry.criterion) || seen.has(entry.criterion)) errors.push(`${where}: unknown or duplicate criterion`);
    seen.add(entry.criterion);
    if (!ASSESSMENTS.includes(entry.assessment)) errors.push(`${where}: assessment must be ${ASSESSMENTS.join(", ")}`);
    if (!unit(entry.confidence)) errors.push(`${where}: confidence must be a number from 0 to 1`);
    refs(entry.evidence_refs, where);
    if (!text(entry.reason, 512)) errors.push(`${where}: reason must be a non-empty string of at most 512 characters`);
  }
  const overall = assessment.overall;
  if (!plain(overall) || !exactKeys(overall, ["assessment", "confidence"]) || !ASSESSMENTS.includes(overall.assessment) || !unit(overall.confidence)) errors.push("overall must have exactly an assessment and a confidence from 0 to 1");
  else if (criteria && errors.length === 0 && overall.assessment !== overallOf(criteria)) errors.push("overall contradicts the per-criterion assessments");
  const unresolved = assessment.unresolved_claims;
  if (!Array.isArray(unresolved) || unresolved.length > 20 || !unresolved.every((entry) => text(entry, 512))) errors.push("unresolved_claims must be at most 20 non-empty strings");
  const concerns = assessment.security_or_scope_concerns;
  if (!Array.isArray(concerns) || concerns.length > 20) errors.push("security_or_scope_concerns must be at most 20 concerns");
  for (const [index, concern] of (Array.isArray(concerns) ? concerns : []).entries()) {
    const where = `concern ${index + 1}`;
    if (!plain(concern) || !exactKeys(concern, ["kind", "confidence", "evidence_refs"]) || !CONCERN_KINDS.includes(concern.kind) || !unit(concern.confidence)) { errors.push(`${where}: must have exactly kind (${CONCERN_KINDS.join(" or ")}), confidence and evidence_refs`); continue; }
    refs(concern.evidence_refs, where);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Pathfinder's deterministic policy. Confidence can only lower a decision —
 * supported below the threshold needs more evidence — and never raises one:
 * a confident `insufficient` or `contradicted` is still not `continue`.
 *
 * @param {{status: "not-configured"|"refused"|"failed"|"assessed", reason?: string,
 *          failure?: {kind: string, message: string}, assessment?: object}} outcome
 * @returns {{decision: string, reasons: string[]}}
 */
export function decide(outcome, { summarized = [] } = {}) {
  if (outcome.status === "not-configured") return { decision: "continue", reasons: ["no evidence judge configured; the existing gate applies unchanged"] };
  if (outcome.status === "refused") return { decision: "escalate", reasons: [outcome.reason] };
  if (outcome.status !== "assessed") return { decision: "escalate", reasons: [`evidence judge ${outcome.failure?.kind ?? "failure"}: ${outcome.failure?.message ?? "no usable assessment"}; a judge failure is never approval`] };
  let decision = "continue";
  const reasons = [];
  const raise = (to, reason) => { if (RANK[to] > RANK[decision]) decision = to; reasons.push(reason); };
  const { criteria, unresolved_claims: unresolved, security_or_scope_concerns: concerns } = outcome.assessment;
  for (const concern of concerns) raise("escalate", `${concern.kind} concern reported (confidence ${concern.confidence.toFixed(2)})`);
  for (const entry of criteria) {
    if (entry.assessment === "contradicted") raise("escalate", `${entry.criterion}: evidence contradicts it`);
    else if (entry.assessment === "insufficient") raise("require_evidence", `${entry.criterion}: evidence is insufficient`);
    else if (entry.confidence < MIN_SUPPORTED_CONFIDENCE) raise("require_evidence", `${entry.criterion}: support below confidence ${MIN_SUPPORTED_CONFIDENCE}`);
    else if (entry.evidence_refs.length === 0) raise("require_evidence", `${entry.criterion}: support cites no evidence`);
  }
  if (unresolved.length) raise("require_evidence", `${unresolved.length} unresolved claim(s)`);
  // A criterion the judge read as the Tester's restatement is not the
  // requirement itself: however confident the judge, a human compares it with
  // the original ticket first.
  for (const id of summarized) raise("require_evidence", `${id}: judged from the Tester's summary, not the ticket's text; compare it with the original criterion`);
  if (decision === "continue") reasons.push(`every verification item is supported by cited evidence at confidence ≥ ${MIN_SUPPORTED_CONFIDENCE}`);
  return { decision, reasons };
}

const failure = (kind, message) => ({ status: "failed", failure: { kind, message } });
function safeMessage(message, secrets) {
  let line = String(message ?? "provider failed").replace(/[\r\n\u2028\u2029]+/g, " ").trim().slice(0, 300) || "provider failed";
  for (const value of secrets) if (typeof value === "string" && value.length >= 8) line = line.split(value).join("[redacted]");
  return line;
}
function frozenCopy(value) {
  if (value === null || typeof value !== "object") return value;
  const copy = Array.isArray(value) ? value.map(frozenCopy) : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, frozenCopy(entry)]));
  return Object.freeze(copy);
}

/**
 * Ask one provider once, behind the boundary. Never throws: every way a
 * provider can fail becomes a `failed` outcome.
 */
export async function runJudge({ bundle, judge, env = {}, fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, secrets = [] }) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(failure("timeout", `no answer within ${timeoutMs} ms`)); }, timeoutMs);
  });
  // The provider sees only the outbound view, re-checked here, and can send
  // only through a fetch that checks the exact serialized body before it leaves.
  const view = outboundOf(bundle);
  const viewProblem = outboundProblem(view, secrets);
  if (viewProblem) { clearTimeout(timer); return failure("outbound", `the outbound request was refused before sending (${viewProblem})`); }
  let refused = null;
  let declared;
  // The configured credential is whatever the provider declared secret, read
  // from its environment, in addition to any the caller names.
  const credentials = [...new Set([...secrets, ...(judge.secrets ?? []).map((name) => env[name])].filter((value) => typeof value === "string" && value !== ""))];
  // Every call is held to the provider's declared transport and the outbound
  // contract, and what is sent is the validated values themselves — the same
  // URL string, a copy of the declared headers, the same body string — so
  // validated bytes are transmitted bytes.
  const guarded = (url, init = {}) => {
    const body = init?.body;
    if (declared === undefined) {
      try { declared = typeof judge.transport === "function" ? frozenCopy(judge.transport(env)) : null; } catch { declared = null; }
    }
    const problem = declared === null ? "the provider declares no usable transport"
      : declaredTransportProblem(declared, credentials) ?? transportProblem(url, init, declared) ?? outboundBodyProblem(body, credentials);
    if (problem) {
      refused = problem;
      return Promise.reject(Object.assign(new Error("outbound request refused"), { kind: "outbound" }));
    }
    return fetch(declared.url, { method: "POST", headers: { ...declared.headers }, body, redirect: "error", signal: init.signal });
  };
  const asked = (async () => {
    try {
      const result = await judge.assess(frozenCopy(view), { env, fetch: guarded, signal: controller.signal });
      if (refused) return failure("outbound", `the outbound request was refused before sending (${refused})`);
      if (!plain(result) || !text(result.model, 64) || !/^[A-Za-z0-9._-]+$/.test(result.model)) return failure("malformed", "provider returned no model identity");
      // A judgment is calibrated to the pinned model. One answered by any
      // other version is not this policy's evidence, however well formed.
      if (result.model !== judge.model) return failure("malformed", `answered by model ${result.model}, not the pinned ${judge.model}`);
      const checked = validateAssessment(result.assessment, bundle);
      if (!checked.ok) return failure("malformed", checked.errors.slice(0, 3).join("; "));
      return { status: "assessed", model: result.model, assessment: result.assessment };
    } catch (error) {
      if (refused) return failure("outbound", `the outbound request was refused before sending (${refused})`);
      const kind = FAILURE_KINDS.includes(error?.kind) ? error.kind : controller.signal.aborted ? "timeout" : "provider-error";
      return failure(kind, safeMessage(error?.message, secrets));
    }
  })();
  try {
    return await Promise.race([asked, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** The checkpoint record for one outcome. */
export function judgmentRecord({ ticket, pr, head, print = null, judge, outcome, summarized = [] }) {
  const { decision, reasons } = decide(outcome, { summarized });
  return {
    contract: CONTRACT,
    ticket,
    pr,
    head_sha: head.toLowerCase(),
    fingerprint: print,
    provider: judge.name,
    model: outcome.model ?? judge.model,
    status: outcome.status,
    assessment: outcome.assessment ?? null,
    failure: outcome.failure ?? (outcome.status === "refused" ? { kind: "refused", message: outcome.reason } : null),
    decision,
    reasons,
  };
}

const RECORD_KEYS = ["contract", "ticket", "pr", "head_sha", "fingerprint", "provider", "model", "status", "assessment", "failure", "decision", "reasons"];
const PROVIDER_NAME = /^[a-z][a-z0-9-]*$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export function validateRecord(record) {
  const errors = [];
  if (!plain(record) || !exactKeys(record, RECORD_KEYS)) return { ok: false, errors: [`record must have exactly ${RECORD_KEYS.join(", ")}`] };
  if (bytes(record) > MAX_RECORD_BYTES) errors.push(`record exceeds ${MAX_RECORD_BYTES} bytes`);
  if (record.contract !== CONTRACT) errors.push("unknown contract");
  if (typeof record.ticket !== "string" || !/^\d+\.\d+$/.test(record.ticket)) errors.push("invalid ticket");
  if (typeof record.pr !== "string" || !/^https:\/\/[^\s]+\/pull\/[1-9]\d*$/.test(record.pr)) errors.push("invalid PR URL");
  if (typeof record.head_sha !== "string" || !/^[a-f0-9]{40}$/.test(record.head_sha)) errors.push("invalid head SHA");
  if (record.fingerprint !== null && (typeof record.fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.fingerprint))) errors.push("invalid fingerprint");
  if (!["refused", "failed", "assessed"].includes(record.status)) errors.push("invalid status");
  if (typeof record.provider !== "string" || !PROVIDER_NAME.test(record.provider)) errors.push("invalid provider");
  if (typeof record.model !== "string" || !MODEL_ID.test(record.model)) errors.push("invalid model");
  // Status, assessment, failure and decision must tell one story.
  if (record.status === "assessed") {
    if (!plain(record.assessment) || record.failure !== null) errors.push("an assessed record has an assessment and no failure");
  } else {
    const kinds = record.status === "refused" ? ["refused"] : FAILURE_KINDS;
    const { failure } = record;
    if (record.assessment !== null || !plain(failure) || !exactKeys(failure, ["kind", "message"]) || !kinds.includes(failure.kind) || !text(failure.message, 512)) errors.push(`a ${record.status} record has no assessment and a ${kinds.join(" or ")} failure`);
    if (record.decision !== "escalate") errors.push(`a ${record.status} record always escalates`);
  }
  if (!DECISIONS.includes(record.decision) || !Array.isArray(record.reasons) || !record.reasons.every((entry) => text(entry, 512))) errors.push("invalid decision or reasons");
  return { ok: errors.length === 0, errors };
}

export function renderJudgment(record) {
  const checked = validateRecord(record);
  if (!checked.ok) throw new Error(checked.errors.join("; "));
  return `${JUDGMENT_HEADING}\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
}

const HEADING_PATTERN = /^## Evidence judgment[ \t]*\r?$/gm;
export function readJudgment(checkpoint) {
  const headings = [...checkpoint.matchAll(HEADING_PATTERN)];
  if (headings.length !== 1) return { ok: false, errors: ["expected exactly one Evidence judgment section"] };
  const rest = checkpoint.slice(headings[0].index + headings[0][0].length);
  const end = rest.search(/^## /m);
  const body = end < 0 ? rest : rest.slice(0, end);
  const block = /^[ \t]*\r?\n(?:[ \t]*\r?\n)*```json\r?\n([\s\S]*?)^```[ \t]*\r?\n?[ \t\r\n]*$/m.exec(body);
  if (!block || block[0].length !== body.length || Buffer.byteLength(block[1]) > MAX_RECORD_BYTES) return { ok: false, errors: ["incomplete bounded JSON judgment"] };
  let record;
  try { record = JSON.parse(block[1]); } catch { return { ok: false, errors: ["invalid JSON judgment"] }; }
  const checked = validateRecord(record);
  return checked.ok ? { ok: true, record } : checked;
}

/** Replace only this section; every other line of the checkpoint survives. */
export function replaceJudgment(checkpoint, record) {
  const rendered = renderJudgment(record);
  const headings = [...checkpoint.matchAll(HEADING_PATTERN)];
  if (headings.length > 1) throw new Error("duplicate Evidence judgment sections");
  const eol = checkpoint.includes("\r\n") ? "\r\n" : "\n";
  const section = rendered.replace(/\n/g, eol);
  if (!headings.length) return `${checkpoint}${checkpoint.endsWith(eol) ? "" : eol}${eol}${section}`;
  const start = headings[0].index;
  const after = start + headings[0][0].length;
  const next = checkpoint.slice(after).search(/^## /m);
  return checkpoint.slice(0, start) + section + (next < 0 ? "" : eol + checkpoint.slice(after + next));
}

/** The criteria a bundle carries as the Tester's summary rather than the ticket's text. */
export const summarizedOf = (bundle) => (bundle?.criteria ?? []).filter((criterion) => criterion.source === "tester-summary").map((criterion) => criterion.id);

/**
 * A recorded judgment is reusable only when this provider and pinned model
 * judged exactly this evidence, its assessment still validates, and its
 * decision is the one policy derives.
 */
export function reusable(record, bundle, print, judge) {
  if (record.status !== "assessed" || record.failure !== null || record.fingerprint !== print) return false;
  if (record.provider !== judge.name || record.model !== judge.model) return false;
  if (record.ticket !== bundle.ticket.key || record.pr !== bundle.revision.pr || record.head_sha !== bundle.revision.head_sha) return false;
  if (!validateAssessment(record.assessment, bundle).ok) return false;
  return decide({ status: "assessed", assessment: record.assessment }, { summarized: summarizedOf(bundle) }).decision === record.decision;
}

/**
 * The structure of a recorded assessment, with every free-text field restated
 * from validated values. Recorded prose is never repeated: a checkpoint is a
 * file anyone can edit, and its text is no instruction to anyone.
 */
function restated(assessment, bundle) {
  const criterionIds = new Set(bundle.criteria.map((entry) => entry.id));
  return {
    criteria: assessment.criteria.map((entry) => ({
      ...entry,
      reason: `recorded ${entry.assessment} at confidence ${entry.confidence.toFixed(2)}, citing ${entry.evidence_refs.length} evidence item(s)`,
    })),
    overall: { ...assessment.overall },
    unresolved_claims: assessment.unresolved_claims.map((claim, index) => (criterionIds.has(claim) ? claim : `unresolved claim ${index + 1} (recorded text not repeated)`)),
    security_or_scope_concerns: assessment.security_or_scope_concerns.map((concern) => ({ ...concern, evidence_refs: [...concern.evidence_refs] })),
  };
}

/** More than one judgment section: which one is the record cannot be known. */
export function duplicateJudgment(checkpoint) {
  return [...String(checkpoint ?? "").matchAll(HEADING_PATTERN)].length > 1;
}

/**
 * Judge one bundle: reuse a matching checkpoint, otherwise ask the provider.
 * A reused record is rebuilt from its validated structure, so its decision
 * and every explanation are derived, never read back. A checkpoint with a
 * duplicate judgment section is refused before any provider is asked: its
 * result could not be written back.
 *
 * @returns {Promise<{record: object, from: "checkpoint"|"provider"}>}
 */
export async function evaluate({ bundle, judge, checkpoint = "", env = {}, fetch, timeoutMs, secrets = [] }) {
  if (duplicateJudgment(checkpoint)) throw new Error(`duplicate ${JUDGMENT_HEADING} sections in the checkpoint; no judge was asked`);
  const print = fingerprint(bundle, judge);
  const cached = readJudgment(checkpoint);
  if (cached.ok && reusable(cached.record, bundle, print, judge)) {
    const outcome = { status: "assessed", model: judge.model, assessment: restated(cached.record.assessment, bundle) };
    return { record: judgmentRecord({ ticket: bundle.ticket.key, pr: bundle.revision.pr, head: bundle.revision.head_sha, print, judge, outcome, summarized: summarizedOf(bundle) }), from: "checkpoint" };
  }
  const outcome = await runJudge({ bundle, judge, env, fetch, timeoutMs, secrets });
  const record = judgmentRecord({ ticket: bundle.ticket.key, pr: bundle.revision.pr, head: bundle.revision.head_sha, print, judge, outcome, summarized: summarizedOf(bundle) });
  return { record, from: "provider" };
}
