/**
 * `validate` — parse the whole ledger and say what is wrong with it, by id and
 * line.
 *
 * The ledger is a file people edit by hand as well as a file the engine writes,
 * and that is deliberate: it is Markdown a reviewer reads in a diff. The cost
 * of that choice is that a hand edit can leave it malformed, and the payment is
 * this command. A hand edit that keeps the file valid is fine and expected.
 *
 * Every violation names the entry and the line, because a validator that says
 * "invalid" and stops is one a person runs once and then ignores. Nothing is
 * repaired here: naming the problem is the whole job, and a tool that silently
 * fixed a ledger would be editing evidence.
 *
 * Evidence references are checked through `lib/evidence-references.mjs`, so the
 * ledger accepts exactly what every other Pathfinder evidence surface accepts.
 */

import { existsSync, readFileSync } from 'node:fs';

import { CLOSED_FIELDS, STATUSES, isDate, refuseValue } from './vocabulary.mjs';
import { ID_PATTERN, field, formatId, ledgerPath, parseLedger, refsIn, validRef } from './ledger.mjs';

/** Written once at record and never rewritten; every entry must carry them. */
const REQUIRED_FIELDS = ['Observed', 'Source', 'Scope', 'Category', 'Human intervention', 'Impact', 'Status', 'Evidence', 'Occurrences'];

/** What a status must be accompanied by, once an entry has reached it. */
const STATUS_REQUIRES = { 'Approved': 'Tracked in', 'Applied': 'Applied in', 'Rejected': 'Decision', 'Deferred': 'Decision' };

export function validate({ root }) {
  const path = ledgerPath(root);
  if (!existsSync(path)) {
    return { ok: true, path, missing: true, problems: [], text: 'No ledger. A project with nothing recorded is valid.\n' };
  }

  const parsed = parseLedger(readFileSync(path, 'utf8'));
  const problems = [];
  const say = (id, line, message) => problems.push({ id, line, message });

  const seen = new Map();

  parsed.entries.forEach((entry, index) => {
    const id = entry.id;

    if (!ID_PATTERN.test(id)) {
      say(id, entry.headingLine, `id \`${id}\` is not three digits`);
    } else {
      const expected = formatId(index + 1);
      if (id !== expected) say(id, entry.headingLine, `ids run in order from 001; this is entry ${index + 1} and should be \`${expected}\``);
    }

    if (seen.has(id)) {
      say(id, entry.headingLine, `duplicate id; ${id} is already used at line ${seen.get(id)}`);
    } else {
      seen.set(id, entry.headingLine);
    }

    if (entry.title.trim() === '') say(id, entry.headingLine, 'heading has no title');

    if (entry.marker === null) {
      say(id, entry.headingLine, 'no `<!-- pathfinder:improvement <id> -->` marker; the marker is the entry identity');
    } else if (entry.marker !== id) {
      say(id, entry.markerLine, `marker says \`${entry.marker}\` but the heading says \`${id}\``);
    }

    for (const duplicate of entry.duplicates ?? []) {
      say(id, duplicate.line, `\`${duplicate.name}\` appears twice`);
    }

    for (const name of REQUIRED_FIELDS) {
      if (!entry.fields.has(name)) say(id, entry.headingLine, `no \`${name}\` line`);
    }

    for (const [name, allowed] of Object.entries(CLOSED_FIELDS)) {
      const present = entry.fields.get(name);
      if (!present) continue;
      const problem = refuseValue(name, present.value);
      if (problem) say(id, present.line, problem);
      void allowed;
    }

    const observed = entry.fields.get('Observed');
    if (observed && !isDate(observed.value)) {
      say(id, observed.line, `\`Observed\` is \`${observed.value}\`, which is not a YYYY-MM-DD date`);
    }

    const evidence = entry.fields.get('Evidence');
    if (evidence) {
      const refs = refsIn(evidence.value);
      if (refs.length === 0) {
        say(id, evidence.line, 'no evidence reference; an entry names at least one, in backticks, in the `type:locator` grammar');
      }
      for (const raw of backticked(evidence.value)) {
        if (!validRef(raw)) say(id, evidence.line, `\`${raw}\` is not an evidence reference`);
      }
    }

    if (entry.paragraph.length === 0) {
      say(id, entry.headingLine, 'no evidence paragraph saying what happened');
    }

    const status = entry.fields.get('Status');
    if (status && STATUSES.includes(status.value)) {
      const needs = STATUS_REQUIRES[status.value];
      if (needs && !entry.fields.has(needs)) {
        const article = /^[AEIOU]/.test(needs) ? 'an' : 'a';
        say(id, status.line, `\`${status.value}\` requires ${article} \`${needs}\` line`);
      }
      if (status.value === 'Proposed' && !field(entry, 'Candidate improvement')) {
        say(id, status.line, '`Proposed` requires a `Candidate improvement` line');
      }
    }

    for (const name of ['Tracked in', 'Applied in']) {
      const present = entry.fields.get(name);
      if (!present) continue;
      if (refsIn(present.value).length === 0) {
        say(id, present.line, `\`${name}\` names no reference`);
      }
      for (const raw of backticked(present.value)) {
        if (!validRef(raw)) say(id, present.line, `\`${raw}\` is not an evidence reference`);
      }
    }

    const decision = entry.fields.get('Decision');
    if (decision && !/\(\d{4}-\d{2}-\d{2}\)\s*$/.test(decision.value)) {
      say(id, decision.line, '`Decision` must end with the date it was made, as `(YYYY-MM-DD)`');
    }

    const occurrences = entry.fields.get('Occurrences');
    if (occurrences) {
      const count = Number(occurrences.value.trim());
      if (!Number.isInteger(count) || count < 1) {
        say(id, occurrences.line, `\`Occurrences\` is \`${occurrences.value}\`, which is not a count`);
      } else if (count !== entry.occurrences.length) {
        const listed = entry.occurrences.length;
        say(id, occurrences.line,
          `\`Occurrences\` says ${count} but ${listed} ${listed === 1 ? 'is' : 'are'} listed`);
      }
    }

    for (const occurrence of entry.occurrences) {
      if (!isDate(occurrence.date)) {
        say(id, occurrence.line, `occurrence date \`${occurrence.date}\` is not YYYY-MM-DD`);
      }
      if (occurrence.refs.length === 0) {
        say(id, occurrence.line, 'occurrence names no evidence reference');
      }
    }
  });

  problems.sort((a, b) => a.line - b.line);

  return {
    ok: problems.length === 0,
    path,
    missing: false,
    entries: parsed.entries.length,
    problems,
    text: render(parsed.entries.length, problems),
  };
}

/** Every backticked span in a field value, so a malformed one can be named. */
function backticked(value) {
  return [...String(value).matchAll(/`([^`]*)`/g)].map((match) => match[1]);
}

function render(entries, problems) {
  if (problems.length === 0) {
    return `OK - ${entries} entr${entries === 1 ? 'y' : 'ies'}, every one well formed.\n`;
  }
  const lines = problems.map((problem) => `${problem.id} line ${problem.line}: ${problem.message}`);
  return `${lines.join('\n')}\n\n${problems.length} problem(s) in ${entries} entr${entries === 1 ? 'y' : 'ies'}.\n`;
}
