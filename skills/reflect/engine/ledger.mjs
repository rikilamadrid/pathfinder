/**
 * The ledger file: where it is, how it reads, and how one entry is written.
 *
 * `context/improvement-ledger.md` is human-readable Markdown with
 * machine-readable lines, the same design as every other `context/` file. One
 * entry is one `## <id> — <title>` section that opens with an identity marker,
 * then `- Field: value` lines, then one short paragraph saying what happened.
 *
 * Two things this module is careful about:
 *
 *   1. **Line numbers.** Every parsed piece carries the 1-based line it came
 *      from, because `validate`'s job is to name a violation somewhere a
 *      person can go and look at it. A validator that says "invalid" without
 *      saying where is a validator nobody uses twice.
 *   2. **The raw lines.** Parsing keeps the file's own array of lines, so an
 *      edit can replace one line and leave every other byte exactly as it was.
 *      This is `statefile.mjs`'s discipline applied to a bigger file: the
 *      ledger is append-only for entries and occurrences, and the one
 *      exception — a human-directed `resolve` — rewrites only the target
 *      entry's status metadata.
 *
 * The evidence grammar is not defined here. References are read through
 * `lib/evidence-references.mjs`, the kit's one statement of it, so the ledger
 * accepts exactly what `blog-post-redactor` accepts and refuses exactly what it
 * refuses. There is deliberately no reference-shaped regular expression
 * anywhere under `skills/reflect/engine/`.
 */

import { join } from 'node:path';

import { extractSources, parseSource } from '../../../lib/evidence-references.mjs';

/** The engine's entire write surface, relative to a project root. */
export const LEDGER_PATH = 'context/improvement-ledger.md';

/** The shipped shape a ledger is created from on first record. */
export const TEMPLATE_PATH = 'templates/improvement-ledger.template.md';

export const ID_PATTERN = /^\d{3}$/;

/**
 * The order field lines are written in, and the order a reader meets them.
 *
 * Fixed rather than insertion-ordered so that two ledgers recording the same
 * observation are the same bytes. The resolution fields sit after `Status`
 * because that is the order they become true in.
 */
export const FIELD_ORDER = [
  'Observed',
  'Source',
  'Scope',
  'Category',
  'Human intervention',
  'Impact',
  'Candidate improvement',
  'Status',
  'Tracked in',
  'Applied in',
  'Decision',
  'Evidence',
  'Occurrences',
];

/** Fields only a `resolve` writes. Everything else is written once, at record. */
export const RESOLUTION_FIELDS = ['Status', 'Tracked in', 'Applied in', 'Decision'];

export function ledgerPath(root) {
  return join(root, ...LEDGER_PATH.split('/'));
}

export function templatePath(root) {
  return join(root, ...TEMPLATE_PATH.split('/'));
}

/** `001`, `002`, … — zero-padded, never reused, never renumbered. */
export function formatId(number) {
  return String(number).padStart(3, '0');
}

/** References as they are written in the file: backticked, comma-separated. */
export function formatRefs(refs) {
  return refs.map((ref) => `\`${ref}\``).join(', ');
}

/**
 * Read the references out of one field line's value.
 *
 * Delegates to the shared primitive rather than matching backticks here, so
 * "what counts as a reference" has exactly one answer in the kit.
 */
export function refsIn(value) {
  return extractSources(value).map((source) => source.ref);
}

/** Validate a reference given on the command line, where it carries no backticks. */
export function validRef(ref) {
  return parseSource(ref) !== null;
}

/**
 * The canonical spelling of a reference, as the grammar defines it.
 *
 * A reference arrives from a command line, where a stray space is easy to
 * introduce and impossible to see. Writing the parsed form means the file
 * holds one spelling of each reference, and that two ledgers recording the
 * same evidence are the same bytes. The normalization is the primitive's, not
 * a second opinion about it.
 */
export function normalizeRef(ref) {
  return parseSource(ref)?.ref ?? ref;
}

const HEADING = /^##\s+(\S+)\s+—\s+(.+?)\s*$/;
const MARKER = /^<!--\s*pathfinder:improvement\s+(\S+)\s*-->\s*$/;
const FIELD = /^-\s+([A-Z][A-Za-z ]*?):\s*(.*)$/;
const OCCURRENCE = /^\s{2,}-\s+(\S+)\s+—\s*(.*)$/;

/**
 * Parse a ledger's text.
 *
 * Structural only: it reports what is there and where, and decides nothing
 * about whether a value is allowed. `validate.mjs` owns that judgment, so that
 * a malformed file can still be parsed far enough to say what is wrong with it.
 *
 * @returns {{eol: string, lines: string[], headerEnd: number, entries: object[]}}
 */
export function parseLedger(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  const entries = [];
  let current = null;
  let headerEnd = lines.length;

  lines.forEach((line, index) => {
    const number = index + 1;
    const heading = HEADING.exec(line);

    if (heading) {
      if (entries.length === 0) headerEnd = index;
      current = {
        id: heading[1],
        title: heading[2],
        headingLine: number,
        marker: null,
        markerLine: null,
        fields: new Map(),
        occurrences: [],
        paragraph: [],
        endLine: number,
      };
      entries.push(current);
      return;
    }

    if (!current) return;
    current.endLine = number;

    const marker = MARKER.exec(line);
    if (marker) {
      current.marker = marker[1];
      current.markerLine = number;
      return;
    }

    const occurrence = OCCURRENCE.exec(line);
    if (occurrence && current.fields.has('Occurrences')) {
      current.occurrences.push({
        date: occurrence[1],
        rest: occurrence[2],
        refs: refsIn(occurrence[2]),
        line: number,
      });
      return;
    }

    const field = FIELD.exec(line);
    if (field) {
      const name = field[1].trim();
      // A repeated field is kept as the first one plus a note, so `validate`
      // can name the duplicate instead of silently preferring one of them.
      if (current.fields.has(name)) {
        current.duplicates = current.duplicates ?? [];
        current.duplicates.push({ name, line: number });
        return;
      }
      current.fields.set(name, { value: field[2].trim(), line: number });
      return;
    }

    if (line.trim() !== '') current.paragraph.push({ text: line, line: number });
  });

  return { eol, lines, headerEnd, entries };
}

/** One entry's field value, or null. */
export function field(entry, name) {
  return entry.fields.get(name)?.value ?? null;
}

/**
 * Render one entry as the lines that are appended to the file.
 *
 * Takes already-validated input: rendering is not the place to discover that a
 * category is unknown.
 */
export function renderEntry({ id, title, values, evidence, note, observed }) {
  const lines = [`## ${id} — ${title}`, '', `<!-- pathfinder:improvement ${id} -->`, ''];

  for (const name of FIELD_ORDER) {
    if (name === 'Occurrences' || name === 'Evidence') continue;
    const value = values[name];
    if (value === undefined || value === null || value === '') continue;
    lines.push(`- ${name}: ${value}`);
  }

  lines.push(`- Evidence: ${formatRefs(evidence)}`);
  lines.push('- Occurrences: 1');
  lines.push(`  - ${observed} — ${formatRefs(evidence)}`);
  lines.push('');
  lines.push(...wrap(note));
  lines.push('');

  return lines;
}

/** One occurrence sub-item, appended under an entry's `Occurrences` line. */
export function renderOccurrence(date, refs) {
  return `  - ${date} — ${formatRefs(refs)}`;
}

/**
 * Wrap the evidence paragraph at 78 columns on spaces.
 *
 * Deterministic and locale-free: it splits on ASCII spaces and counts code
 * units, so the same paragraph is the same bytes on every machine. A word
 * longer than the width is left long rather than broken, because breaking a
 * reference or a path would make it unusable.
 */
export function wrap(text, width = 78) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines = [];
  let line = '';
  for (const word of words) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}
