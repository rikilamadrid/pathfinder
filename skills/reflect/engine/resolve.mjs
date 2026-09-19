/**
 * `resolve` — record the decision a person made about one entry.
 *
 * This is the one command that rewrites anything, and the rewrite is kept as
 * small as it can be: the target entry's `Status` line, and the resolution
 * field the new status requires. Every other byte of the file — every other
 * entry, this entry's evidence, its occurrences, the header, the blank lines —
 * is the same afterwards. That is not politeness, it is what makes the ledger
 * reviewable: a resolution shows up in a diff as the two or three lines it
 * actually is.
 *
 * Nothing here infers. A closed issue does not make an entry `Applied`, a
 * merged pull request does not make it `Approved`, and no amount of evidence
 * moves a status by itself. A person decides, names the evidence, and this
 * writes down what they decided. The ledger's authority is zero by design, and
 * inference is how a record quietly acquires some.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { STATUSES, TRANSITIONS, TRANSITION_REQUIRES, isDate } from './vocabulary.mjs';
import { FIELD_ORDER, field, formatRefs, ledgerPath, normalizeRef, parseLedger, validRef } from './ledger.mjs';

const refuse = (message, usage = false) => ({ ok: false, usage, message });

/**
 * @returns {{ok: true, id: string, from: string, to: string, changed: string[], path: string}
 *          | {ok: false, usage?: boolean, message: string}}
 */
export function resolve({ root, id, status, in: evidence = [], why = null, on = null }) {
  if (!id) return refuse('resolve needs an entry id, such as `resolve 001 Proposed`', true);
  if (!status) return refuse('resolve needs a status', true);
  if (!STATUSES.includes(status)) {
    return refuse(`\`Status\` must be one of ${STATUSES.join(', ')}, not \`${status}\``);
  }

  const path = ledgerPath(root);
  if (!existsSync(path)) return refuse(`there is no ledger at ${path}`);

  const parsed = parseLedger(readFileSync(path, 'utf8'));
  const entry = parsed.entries.find((candidate) => candidate.id === id);
  if (!entry) {
    const known = parsed.entries.map((candidate) => candidate.id).join(', ') || 'none';
    return refuse(`no entry \`${id}\` in the ledger; it holds ${known}`);
  }

  const from = field(entry, 'Status');
  if (!from) return refuse(`${id} has no \`Status\` line; run validate`);
  if (!STATUSES.includes(from)) {
    return refuse(`${id} is \`${from}\`, which is not a status; run validate`);
  }

  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(status)) {
    const where = allowed.length > 0 ? `only ${allowed.join(' or ')}` : 'nothing; it is terminal';
    return refuse(`${id} is \`${from}\`, and \`${from}\` goes to ${where} — not \`${status}\``);
  }

  const requires = TRANSITION_REQUIRES[status];

  if (requires.in) {
    if (evidence.length === 0) {
      return refuse(`\`${status}\` requires --in: the evidence that ${status === 'Approved' ? 'the work is tracked somewhere' : 'it landed'}`);
    }
    for (const ref of evidence) {
      if (!validRef(ref)) {
        return refuse(`\`${ref}\` is not an evidence reference; use the \`type:locator\` grammar, such as \`pr:133\``);
      }
    }
  } else if (evidence.length > 0) {
    return refuse(`\`${status}\` takes no --in; only Approved and Applied name evidence`);
  }

  if (requires.why) {
    if (!why || String(why).trim() === '') {
      return refuse(`\`${status}\` requires --why: the human's reason, in their words`);
    }
    if (String(why).includes('\n')) return refuse('--why must be one line');
    if (!on) return refuse(`\`${status}\` requires --on <YYYY-MM-DD>: the day the decision was made`);
    if (!isDate(on)) return refuse(`\`${on}\` is not a date; --on takes YYYY-MM-DD`);
  }

  // `Proposed` is the point where an entry stops being an observation and
  // starts being a suggestion, so it is the point that needs one.
  if (status === 'Proposed' && !field(entry, 'Candidate improvement')) {
    return refuse(`${id} has no \`Candidate improvement\`, and an entry cannot be Proposed without one`);
  }

  const refs = evidence.map(normalizeRef);
  const writes = { 'Status': status };
  if (status === 'Approved') writes['Tracked in'] = formatRefs(refs);
  if (status === 'Applied') writes['Applied in'] = formatRefs(refs);
  if (requires.why) writes['Decision'] = `${String(why).trim()} (${on})`;

  const lines = [...parsed.lines];
  const changed = [];

  // Applied in a fixed order so that two entries resolved the same way read
  // the same, and so an insertion never depends on the order of an object's
  // keys. Insertions shift later lines, so the entry's own line numbers are
  // re-read from a fresh parse between writes rather than trusted.
  for (const name of FIELD_ORDER.filter((candidate) => candidate in writes)) {
    const state = parseLedger(lines.join(parsed.eol));
    const target = state.entries.find((candidate) => candidate.id === id);
    const existing = target.fields.get(name);
    const line = `- ${name}: ${writes[name]}`;

    if (existing) {
      if (lines[existing.line - 1] !== line) changed.push(name);
      lines[existing.line - 1] = line;
      continue;
    }

    lines.splice(insertionPoint(target, name), 0, line);
    changed.push(name);
  }

  writeFileSync(path, lines.join(parsed.eol), 'utf8');

  return { ok: true, id, from, to: status, changed, path };
}

/**
 * Where a field line that is not there yet belongs, as a 0-based splice index.
 *
 * After the nearest field that precedes it in `FIELD_ORDER` and is present,
 * falling back to before the nearest one that follows it. Keeping the file in
 * one order is what lets a reader skim two entries and compare them, and what
 * keeps a diff to the line that changed.
 */
function insertionPoint(entry, name) {
  const position = FIELD_ORDER.indexOf(name);

  for (let index = position - 1; index >= 0; index -= 1) {
    const before = entry.fields.get(FIELD_ORDER[index]);
    if (before) return before.line;
  }
  for (let index = position + 1; index < FIELD_ORDER.length; index += 1) {
    const after = entry.fields.get(FIELD_ORDER[index]);
    if (after) return after.line - 1;
  }
  return entry.markerLine ?? entry.headingLine;
}
