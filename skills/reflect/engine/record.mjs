/**
 * `record` — append one observation, or one occurrence of one already there.
 *
 * Everything this command refuses, it refuses before touching the file: a
 * command that writes half an entry and then reports a bad category has made
 * the ledger worse than the mistake did. Validation first, one append last.
 *
 * The two shapes are deliberately different operations rather than one clever
 * one. A new observation gets the next id and a full entry. `--repeats <id>`
 * names an entry that already exists and adds a dated occurrence to it. The
 * engine never decides that two observations are the same thing: no fuzzy
 * matching, no similarity, no inference. Deciding that is reflect's judgment
 * and the human's, and the engine only does what it was explicitly told.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { CLOSED_FIELDS, isDate, refuseValue } from './vocabulary.mjs';
import {
  FIELD_ORDER, ID_PATTERN, field, formatId, formatRefs, ledgerPath, normalizeRef,
  parseLedger, renderEntry, renderOccurrence, templatePath, validRef,
} from './ledger.mjs';

const refuse = (message) => ({ ok: false, message });

/** The fields a new observation must carry, in the order a refusal names them. */
const REQUIRED = ['observed', 'source', 'scope', 'category', 'intervention', 'impact', 'title'];

const FIELD_OF = {
  source: 'Source', scope: 'Scope', category: 'Category',
  intervention: 'Human intervention', impact: 'Impact',
};

/**
 * @param {object} options
 * @param {string} options.root project root; the ledger is always at
 *   `context/improvement-ledger.md` beneath it
 * @returns {{ok: true, id: string, occurrences: number, created: boolean, path: string}
 *          | {ok: false, usage?: boolean, message: string}}
 */
export function record({ root, repeats = null, evidence = [], note = '', ...given }) {
  if (evidence.length === 0) {
    return refuse('an observation needs at least one evidence reference: pass --evidence <type:locator>');
  }
  for (const ref of evidence) {
    if (!validRef(ref)) {
      return refuse(`\`${ref}\` is not an evidence reference; use the \`type:locator\` grammar, such as \`issue:129\` or \`file:README.md#L1-L20\``);
    }
  }
  const refs = evidence.map(normalizeRef);

  if (given.observed === undefined || given.observed === null || given.observed === '') {
    return refuse('--observed <YYYY-MM-DD> is required: the engine reads no clock, so the date is yours to give');
  }
  if (!isDate(given.observed)) {
    return refuse(`\`${given.observed}\` is not a date; --observed takes YYYY-MM-DD`);
  }

  const path = ledgerPath(root);
  const exists = existsSync(path);

  if (repeats !== null) {
    if (!exists) return refuse(`there is no ledger at ${path} yet, so ${repeats} cannot be repeated`);
    return appendOccurrence({ path, repeats, date: given.observed, evidence: refs });
  }

  for (const name of REQUIRED) {
    const value = given[name];
    if (value === undefined || value === null || String(value).trim() === '') {
      return refuse(`--${name} is required`);
    }
  }
  for (const [option, name] of Object.entries(FIELD_OF)) {
    const problem = refuseValue(name, given[option]);
    if (problem) return refuse(problem);
  }
  if (String(given.title).includes('\n')) return refuse('--title must be one line');
  if (given.candidate && String(given.candidate).includes('\n')) return refuse('--candidate must be one line');
  if (String(note).trim() === '') {
    return refuse('--note is required: one short paragraph saying what happened');
  }

  let text = '';
  let created = false;
  if (exists) {
    text = readFileSync(path, 'utf8');
  } else {
    const template = templatePath(root);
    if (!existsSync(template)) {
      return refuse(`no ledger at ${path} and no template at ${template} to create it from`);
    }
    text = readFileSync(template, 'utf8');
    created = true;
  }

  const parsed = parseLedger(text);

  for (const entry of parsed.entries) {
    if (entry.title === String(given.title).trim()) {
      return refuse(`${entry.id} already records \`${entry.title}\`; add an occurrence with --repeats ${entry.id} rather than a second entry`);
    }
  }

  const id = formatId(nextNumber(parsed.entries));
  const lines = renderEntry({
    id,
    title: String(given.title).trim(),
    observed: given.observed,
    evidence: refs,
    note,
    values: {
      'Observed': given.observed,
      'Source': given.source,
      'Scope': given.scope,
      'Category': given.category,
      'Human intervention': given.intervention,
      'Impact': given.impact,
      'Candidate improvement': given.candidate ? String(given.candidate).trim() : null,
      'Status': 'Open',
    },
  });

  const body = text.replace(/\s*$/, '');
  const next = `${body}${parsed.eol}${parsed.eol}${lines.join(parsed.eol).replace(/\s*$/, '')}${parsed.eol}`;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next, 'utf8');

  return { ok: true, id, occurrences: 1, created, path };
}

/**
 * The next id is one past the highest number in the file, not the count.
 *
 * Counting entries would reuse an id the day somebody deletes a section by
 * hand, and a reused id silently reattaches one observation's history to
 * another. Ids are never reused and never renumbered.
 */
function nextNumber(entries) {
  let highest = 0;
  for (const entry of entries) {
    if (!ID_PATTERN.test(entry.id)) continue;
    highest = Math.max(highest, Number(entry.id));
  }
  return highest + 1;
}

/** Add one dated occurrence to an existing entry and raise its count by one. */
function appendOccurrence({ path, repeats, date, evidence }) {
  const text = readFileSync(path, 'utf8');
  const parsed = parseLedger(text);
  const entry = parsed.entries.find((candidate) => candidate.id === repeats);

  if (!entry) {
    const known = parsed.entries.map((candidate) => candidate.id).join(', ') || 'none';
    return { ok: false, message: `no entry \`${repeats}\` in the ledger; it holds ${known}` };
  }

  const occurrences = entry.fields.get('Occurrences');
  if (!occurrences) {
    return { ok: false, message: `${repeats} has no \`Occurrences\` line to add to; run validate` };
  }

  const count = Number(occurrences.value.trim());
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, message: `${repeats}'s \`Occurrences\` is \`${occurrences.value}\`, which is not a count; run validate` };
  }

  const lines = [...parsed.lines];
  lines[occurrences.line - 1] = `- Occurrences: ${count + 1}`;

  // After the last occurrence sub-item the entry already has, so the list stays
  // in the order the occurrences were recorded.
  const last = entry.occurrences.at(-1);
  const at = last ? last.line : occurrences.line;
  lines.splice(at, 0, renderOccurrence(date, evidence));

  writeFileSync(path, lines.join(parsed.eol), 'utf8');

  return { ok: true, id: repeats, occurrences: count + 1, created: false, path, repeated: true };
}

export { FIELD_ORDER, CLOSED_FIELDS, field, formatRefs };
