/**
 * The ledger's closed vocabularies, and the transitions between statuses.
 *
 * Closed means closed: an unknown value is refused by field name with the
 * allowed set printed, never defaulted and never passed through. A ledger
 * whose fields can hold anything is a ledger a harvest cannot count, and
 * counting is the only thing that turns one observation into evidence of a
 * pattern.
 *
 * Stated once, here, because the engine, its refusals and its validator all
 * need the same answer. Nothing else in the kit restates these lists.
 */

/** The lifecycle stage where an observation was seen. Portable across harnesses. */
export const SOURCES = [
  'planning', 'implementation', 'review', 'completion',
  'orchestration', 'integration', 'release', 'debugging', 'session',
];

/** Reflect's PROJECT vs WORKFLOW CANDIDATE, recorded so a harvest can route a proposal. */
export const SCOPES = ['project', 'workflow'];

/** One per entry. Repetition is `Occurrences`, never a category of its own. */
export const CATEGORIES = [
  'unexpected-intervention', 'wrong-assumption', 'missing-contract',
  'workflow-friction', 'manual-recovery', 'insufficient-guidance', 'workaround',
];

/** What a person had to do that the workflow did not handle. */
export const INTERVENTIONS = ['none', 'decision', 'correction', 'recovery'];

export const IMPACTS = ['low', 'medium', 'high'];

export const STATUSES = ['Open', 'Proposed', 'Approved', 'Applied', 'Rejected', 'Deferred'];

/**
 * Every field whose value is drawn from a closed list, by the exact field name
 * written in the file. The validator and `record` both read this map, so a
 * field cannot be checked in one place and forgotten in the other.
 */
export const CLOSED_FIELDS = Object.freeze({
  'Source': SOURCES,
  'Scope': SCOPES,
  'Category': CATEGORIES,
  'Human intervention': INTERVENTIONS,
  'Impact': IMPACTS,
  'Status': STATUSES,
});

/**
 * The legal transitions, as `from` → the statuses reachable from it.
 *
 * `Open → Proposed → Approved → Applied` is the spine. `Rejected` and
 * `Deferred` are reachable from the two statuses where a human is actually
 * deciding something, and `Deferred → Open` lets a shelved observation come
 * back when it recurs. Everything else is refused by name.
 *
 * Deliberately absent: any edge out of `Applied` or `Rejected`. Those are
 * terminal, and reopening one is a new observation with its own evidence.
 */
export const TRANSITIONS = Object.freeze({
  'Open': ['Proposed'],
  'Proposed': ['Approved', 'Rejected', 'Deferred'],
  'Approved': ['Applied', 'Rejected', 'Deferred'],
  'Applied': [],
  'Rejected': [],
  'Deferred': ['Open'],
});

/**
 * What a transition must be given before it is allowed to happen.
 *
 * `Approved` and `Applied` demand evidence because they are claims about the
 * world — a Feature or ticket exists; a PR merged — and an unevidenced claim
 * is the failure mode the whole ledger is built against. `Rejected` and
 * `Deferred` demand the human's reason and the date they gave it, because a
 * decision without a reason cannot be reviewed later.
 */
export const TRANSITION_REQUIRES = Object.freeze({
  'Approved': { in: 'Tracked in', why: false },
  'Applied': { in: 'Applied in', why: false },
  'Rejected': { in: null, why: true },
  'Deferred': { in: null, why: true },
  'Proposed': { in: null, why: false },
  'Open': { in: null, why: false },
});

/** `--observed`, `--on`: a calendar day, given by the caller. The engine reads no clock. */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Is this a real calendar day, not merely four-two-two digits? */
export function isDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= last;
}

/**
 * Check one value against a closed field.
 *
 * @returns {null | string} null when legal, otherwise the refusal to print
 */
export function refuseValue(field, value) {
  const allowed = CLOSED_FIELDS[field];
  if (!allowed) return `unknown field \`${field}\``;
  if (allowed.includes(value)) return null;
  return `\`${field}\` must be one of ${allowed.join(', ')}, not \`${value}\``;
}
