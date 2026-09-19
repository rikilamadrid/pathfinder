/**
 * `harvest` — what the ledger says, arranged so a person can act on it.
 *
 * Read-only, and deterministic in the strong sense: the same file produces the
 * same bytes on any machine, in any directory, in any timezone, under any
 * locale. That is why nothing here calls a clock, and why every ordering is an
 * explicit comparison on code points rather than `localeCompare`, whose answer
 * depends on where the machine thinks it is.
 *
 * It reports. It does not resolve, promote, merge, deduplicate, propose a
 * Feature, or change a status. Reading a report and deciding what it means is
 * reflect's work in the session, with a person present; this is the part that
 * can be checked by a test.
 *
 * "No proposal" is an expected outcome. A ledger whose entries are all single
 * observations is telling you something true.
 */

import { existsSync, readFileSync } from 'node:fs';

import { CATEGORIES, IMPACTS, SOURCES } from './vocabulary.mjs';
import { field, ledgerPath, parseLedger } from './ledger.mjs';

/**
 * High first: the order a person triages in, not alphabetical order.
 *
 * `IMPACTS` runs low to high, so the rank is the position itself and the
 * comparison below subtracts in the direction that puts the biggest first.
 */
const IMPACT_RANK = new Map(IMPACTS.map((impact, index) => [impact, index + 1]));

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function harvest({ root }) {
  const path = ledgerPath(root);
  if (!existsSync(path)) {
    return { ok: true, empty: true, path, report: emptyReport(), text: 'No ledger yet. Nothing to harvest.\n' };
  }

  const parsed = parseLedger(readFileSync(path, 'utf8'));
  const entries = parsed.entries.map(summarise);

  const open = entries.filter((entry) => entry.status === 'Open').sort(triage);
  const proposed = entries.filter((entry) => entry.status === 'Proposed').sort(triage);
  const approved = entries.filter((entry) => entry.status === 'Approved').sort(byId);
  const recurred = entries.filter(hasRecurredSinceDeferral).sort(byId);

  const report = {
    entries: entries.length,
    open: open.map(view),
    repeated: repeatedSignals(entries),
    recurredSinceDeferral: recurred.map(view),
    proposed: proposed.map(view),
    approved: approved.map((entry) => ({ ...view(entry), trackedIn: entry.trackedIn })),
    counts: {
      category: tally(entries, 'category', CATEGORIES),
      source: tally(entries, 'source', SOURCES),
      status: tallyBy(entries, (entry) => entry.status),
    },
  };

  return { ok: true, empty: false, path, report, text: render(report) };
}

function emptyReport() {
  return {
    entries: 0, open: [], repeated: [], recurredSinceDeferral: [], proposed: [], approved: [],
    counts: { category: [], source: [], status: [] },
  };
}

function summarise(entry) {
  const decision = field(entry, 'Decision') ?? '';
  const date = /\((\d{4}-\d{2}-\d{2})\)\s*$/.exec(decision);
  return {
    id: entry.id,
    title: entry.title,
    status: field(entry, 'Status') ?? '',
    category: field(entry, 'Category') ?? '',
    source: field(entry, 'Source') ?? '',
    impact: field(entry, 'Impact') ?? '',
    candidate: field(entry, 'Candidate improvement') ?? '',
    trackedIn: field(entry, 'Tracked in') ?? '',
    appliedIn: field(entry, 'Applied in') ?? '',
    decision,
    decidedOn: date ? date[1] : null,
    occurrences: entry.occurrences.length,
    dates: entry.occurrences.map((occurrence) => occurrence.date),
  };
}

const view = (entry) => ({
  id: entry.id, title: entry.title, occurrences: entry.occurrences,
  impact: entry.impact, category: entry.category, source: entry.source,
  candidate: entry.candidate,
});

/** Occurrences descending, then impact descending, then id ascending. */
function triage(a, b) {
  if (a.occurrences !== b.occurrences) return b.occurrences - a.occurrences;
  const impact = (IMPACT_RANK.get(b.impact) ?? 0) - (IMPACT_RANK.get(a.impact) ?? 0);
  if (impact !== 0) return impact;
  return byCodePoint(a.id, b.id);
}

const byId = (a, b) => byCodePoint(a.id, b.id);

/**
 * The two ways the file says "this keeps happening".
 *
 * One entry with more than one occurrence is the direct way. Two open entries
 * that share a category and a candidate improvement are the indirect way: a
 * person recorded them separately and the file now shows they are asking for
 * the same change. Naming both is the point of a harvest; deciding whether the
 * second really is one pattern is not the engine's call, and nothing here
 * merges them.
 */
function repeatedSignals(entries) {
  const signals = entries
    .filter((entry) => entry.occurrences >= 2)
    .sort(triage)
    .map((entry) => ({
      kind: 'occurrences', ids: [entry.id], occurrences: entry.occurrences,
      title: entry.title, candidate: entry.candidate,
    }));

  const groups = new Map();
  for (const entry of entries) {
    if (entry.status !== 'Open' || !entry.candidate) continue;
    const key = JSON.stringify([entry.category, entry.candidate]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const shared = [...groups.entries()]
    .filter(([, group]) => group.length >= 2)
    .sort((a, b) => byCodePoint(a[0], b[0]))
    .map(([, group]) => ({
      kind: 'shared-candidate',
      ids: group.map((entry) => entry.id).sort(byCodePoint),
      occurrences: group.reduce((total, entry) => total + entry.occurrences, 0),
      title: group[0].candidate,
      candidate: group[0].candidate,
    }));

  return [...signals, ...shared];
}

/** A deferred entry that happened again after it was shelved. */
function hasRecurredSinceDeferral(entry) {
  if (entry.status !== 'Deferred' || !entry.decidedOn) return false;
  return entry.dates.some((date) => date > entry.decidedOn);
}

function tally(entries, key, vocabulary) {
  const counts = new Map(vocabulary.map((value) => [value, 0]));
  for (const entry of entries) {
    if (counts.has(entry[key])) counts.set(entry[key], counts.get(entry[key]) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || byCodePoint(a[0], b[0]))
    .map(([value, count]) => ({ value, count }));
}

function tallyBy(entries, of) {
  const counts = new Map();
  for (const entry of entries) counts.set(of(entry), (counts.get(of(entry)) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || byCodePoint(a[0], b[0]))
    .map(([value, count]) => ({ value, count }));
}

function render(report) {
  const out = ['# Harvest', '', `${report.entries} entr${report.entries === 1 ? 'y' : 'ies'}.`, ''];

  section(out, 'Open, most repeated first', report.open,
    (entry) => `- ${entry.id} — ${entry.title} (${entry.occurrences} occurrence(s), ${entry.impact} impact, ${entry.category})`);

  section(out, 'Repeated', report.repeated,
    (signal) => (signal.kind === 'occurrences'
      ? `- ${signal.ids[0]} — ${signal.title} (${signal.occurrences} occurrences)`
      : `- ${signal.ids.join(', ')} — share a category and candidate: ${signal.candidate}`));

  section(out, 'Deferred, and happened again since', report.recurredSinceDeferral,
    (entry) => `- ${entry.id} — ${entry.title} (${entry.occurrences} occurrence(s))`);

  section(out, 'Proposed, awaiting a decision', report.proposed,
    (entry) => `- ${entry.id} — ${entry.title}`);

  section(out, 'Approved, and where the work is tracked', report.approved,
    (entry) => `- ${entry.id} — ${entry.title} -> ${entry.trackedIn}`);

  if (report.counts.category.length > 0 || report.counts.status.length > 0) {
    out.push('## Counts', '');
    out.push(`By category: ${line(report.counts.category)}`);
    out.push(`By source: ${line(report.counts.source)}`);
    out.push(`By status: ${line(report.counts.status)}`);
    out.push('');
  }

  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

const line = (rows) => (rows.length > 0 ? rows.map((row) => `${row.value} ${row.count}`).join(', ') : 'none');

function section(out, heading, rows, render_) {
  out.push(`## ${heading}`, '');
  out.push(...(rows.length > 0 ? rows.map(render_) : ['None.']));
  out.push('');
}
