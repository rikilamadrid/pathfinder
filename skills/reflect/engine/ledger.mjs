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
 * **Where an entry's fields stop.** The field block is the run of
 * `- Field: value` lines that follows the marker, and it ends at the first
 * blank line after it began. Everything after that is the evidence paragraph,
 * whatever it looks like. The boundary has to be positional, because the
 * paragraph is prose a person wrote and prose can contain a line that reads
 * exactly like a field — wrapping alone can produce one. Without the boundary,
 * such a line became a field the entry never had, and a later resolution
 * rewrote it in place, silently editing the middle of somebody's evidence. The
 * ledger's whole claim is that evidence is never edited, so the parser is
 * where that has to be made true.
 *
 * Line endings are kept per line rather than detected once for the file. A
 * ledger with one stray CRLF in it would otherwise be rewritten end to end by
 * a one-line status change, which turns a reviewable two-line diff into a
 * seventy-line one.
 *
 * @returns {{eol: string, lines: string[], endings: string[], headerEnd: number, entries: object[]}}
 */
export function parseLedger(text) {
  const parts = String(text).split(/(\r\n|\n)/);
  const lines = [];
  const endings = [];
  for (let index = 0; index < parts.length; index += 2) {
    lines.push(parts[index]);
    endings.push(parts[index + 1] ?? '');
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';

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
        fieldsOpen: true,
        endLine: number,
      };
      entries.push(current);
      return;
    }

    if (!current) return;
    current.endLine = number;

    if (line.trim() === '') {
      // The blank line that closes the field block, once there is one to close.
      if (current.fields.size > 0) current.fieldsOpen = false;
      return;
    }

    const marker = MARKER.exec(line);
    if (marker && current.marker === null) {
      current.marker = marker[1];
      current.markerLine = number;
      return;
    }

    if (current.fieldsOpen) {
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

      // Prose arriving before any blank line still ends the fields: whatever
      // this is, the field block is over.
      if (current.fields.size > 0) current.fieldsOpen = false;
    }

    current.paragraph.push({ text: line, line: number });
  });

  return { eol, lines, endings, headerEnd, entries };
}

/**
 * Put a parsed ledger back together, each line with the ending it arrived with.
 *
 * @param {{lines: string[], endings: string[], eol: string}} parsed
 */
export function joinLedger({ lines, endings, eol }) {
  return lines.map((line, index) => `${line}${endings[index] ?? eol}`).join('');
}

/**
 * Insert one line into a parsed ledger, at a 0-based index.
 *
 * The new line takes the ending of the line it displaces, so inserting into a
 * CRLF file produces a CRLF line and inserting into an LF file an LF one,
 * without anything having to know which kind of file this is.
 */
export function insertLine(parsed, at, line) {
  parsed.lines.splice(at, 0, line);
  parsed.endings.splice(at, 0, parsed.endings[at] ?? parsed.endings[at - 1] ?? parsed.eol);
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
