/**
 * What a run did, derived once.
 *
 * Two renderings print this install — `contractReport` owes byte-for-byte what
 * 1.4.1 printed, `expressiveReport` owes a person a legible hierarchy — and
 * they had each grown their own copy of the same four derivations: the
 * mode-dependent written count, the skipped filter, the failure merge, and a
 * per-harness adapter tally that appeared three times character-for-character.
 * Four facts, ten spellings, and no mechanism keeping them in agreement. This
 * module is the one spelling. The renderings stay two renderings; they just
 * stop each deciding what the numbers are.
 *
 * Pure by construction: no filesystem, no `process`, no writing. Everything
 * here is a function of the plans and results it is handed, which is what lets
 * a summary be tested without building a temporary repository or a fake
 * terminal.
 *
 * Two counters elsewhere are deliberately *not* folded in, and a later change
 * that "finishes the job" will break them:
 *
 * - `countWritten` in `cli.mjs` runs mid-run, before adapters are applied, and
 *   reports a different number — `written + overwritten`, labelled "copied" —
 *   than the summary's `written`. It cannot read a result that does not exist
 *   yet.
 * - The streaming per-harness counts in `generateAdapters` accumulate as units
 *   resolve, so milestones can print while the work is happening, and they
 *   count conflicts, orphans, and up-to-date adapters differently from the
 *   rows below. A summary computed at the end cannot drive a progress bar.
 */

/**
 * Every derived fact both renderings need, and nothing either of them can
 * compute for itself.
 *
 * @param {object} args
 * @param {{relativePath: string, status: "write"|"skip"|"overwrite"}[]} args.plan
 *   the kit copy plan, in `planInstall`'s sort
 * @param {{written: number, skipped: number, overwritten: number,
 *          errors: {relativePath: string, message: string}[]}} args.result
 * @param {{plan: object[], result: object, blocked: boolean}} args.adapters
 * @param {{label: string}[]} args.harnesses the selected harnesses, registry order
 * @param {{dryRun?: boolean}} args.options
 * @returns {Readonly<object>} frozen; rows and lists frozen with it
 */
export function summarize({ plan, result, adapters, harnesses, options }) {
  // A dry run has no `result.written` to report, because nothing was written.
  // The plan is counted instead, which is the same number the run would have
  // produced had it been allowed to write.
  const written = options.dryRun
    ? plan.filter((item) => item.status === "write").length
    : result.written;

  const skipped = plan
    .filter((item) => item.status === "skip")
    .map((item) => item.relativePath);

  // Copy errors before adapter errors, because that is the order they happened
  // in and the order the failure list has always printed.
  const failures = Object.freeze([...result.errors, ...adapters.result.errors]);

  return Object.freeze({
    written,
    overwritten: result.overwritten,
    skipped: Object.freeze(skipped),
    // Nothing to write and every file already there. Not the same as `written
    // === 0`, which a partly failed copy also satisfies.
    alreadyInstalled: written === 0 && skipped.length === plan.length,
    failures,
    blocked: adapters.blocked,
    // Summed from the result, never from `harnessRows`. The rows exclude paths
    // that errored and this does not, so the two disagree exactly when a write
    // fails — and this is the number the closing headline speaks for.
    built: adapters.result.generated + adapters.result.replaced,
    attention: attentionCount(adapters),
    harnessRows: harnessRows({ adapters, harnesses }),
  });
}

/**
 * What actually wants a human: a contested path, or an adapter pointing at a
 * skill that is gone.
 *
 * Skipped files are deliberately not counted. A re-run over an existing install
 * skips every file by design, and calling thirty-six routine skips "things to
 * look at" would turn the one number that should mean something into noise
 * nobody reads twice.
 *
 * Counted across the whole adapter plan rather than across `harnessRows`,
 * errored paths included, because a path that could not be written is still a
 * path somebody has to go and look at.
 */
function attentionCount(adapters) {
  if (adapters.blocked) return 0;
  return adapters.plan.filter(
    (item) => item.action === "conflict" || item.action === "orphan",
  ).length;
}

/**
 * One row per selected harness, in the order the harnesses were given.
 *
 * The three-way distinction the report depends on is carried by the rows
 * themselves, and all three collapse to a zero if it is lost:
 *
 * - no harness chosen — no rows, `blocked: false`
 * - the kit copy failed — no rows, `blocked: true`
 * - a harness that produced nothing — a row of zeroes
 *
 * The blocked case returns no rows explicitly rather than falling out of an
 * empty plan, so that a harness which was chosen and never reached is never
 * described as having generated zero adapters.
 *
 * Paths that failed to write are excluded from every count and list here: an
 * adapter that could not be written was not generated, is not up to date, and
 * is not a conflict the user can resolve by re-running with `--force`. They are
 * reported once, as failures.
 */
function harnessRows({ adapters, harnesses }) {
  if (harnesses.length === 0 || adapters.blocked) return Object.freeze([]);

  const failed = new Set(adapters.result.errors.map((error) => error.relativePath));

  return Object.freeze(
    harnesses.map((harness) => {
      // Identity, not label: the harness object on a plan item is the registry
      // entry itself, and two entries could plausibly share a label one day.
      const mine = adapters.plan.filter(
        (item) => item.harness === harness && !failed.has(item.relativePath),
      );
      const count = (action) => mine.filter((item) => item.action === action).length;
      const paths = (action) =>
        Object.freeze(
          mine.filter((item) => item.action === action).map((item) => item.relativePath),
        );

      return Object.freeze({
        harness,
        generated: count("write"),
        replaced: count("replace"),
        unchanged: count("up-to-date"),
        // `planAdapters` order, which is the order they will be printed in.
        conflicts: paths("conflict"),
        orphans: paths("orphan"),
      });
    }),
  );
}
