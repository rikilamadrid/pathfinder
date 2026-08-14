/**
 * The install phase's progress bar: one counter, one format function, one write.
 *
 * Not a renderer framework, and deliberately not extensible. It holds three
 * numbers and knows how to draw one line from them.
 *
 * **What makes this bar honest**, since a progress bar is the easiest thing in
 * a CLI to fake and the prototype rejected an earlier version of it as theatre:
 *
 * - **The denominator is a plan, not an estimate.** `planInstall` and
 *   `planAdapters` both return complete lists before a single byte is written,
 *   so the total is a count of enumerated work rather than a guess that gets
 *   corrected as it goes.
 * - **The numerator is completions.** It moves when `applyPlan` or
 *   `applyAdapterPlan` finishes a unit and tells us so. There is no timer in
 *   this file, no interval, no rate, and nothing that advances because time
 *   passed. That is also why no throttle is needed: the bar repaints at most
 *   once per completed unit, and the unit count is bounded by the plan.
 * - **A run that finishes instantly is a correct run.** If the work takes 30ms
 *   the bar reaches 100% in 30ms and the phase ends. Nothing sleeps or paces
 *   itself so the effect can be admired.
 * - **Nothing is displayed that has not been earned.** Both the fill and the
 *   percentage floor rather than round, so neither can show a complete bar
 *   while a unit is still outstanding.
 * - **A failure cannot produce a clean 100%.** A failed unit advances nothing;
 *   it increments a separate counter that the bar renders explicitly. An
 *   install that lost two files ends visibly short with those two named, which
 *   is the one thing the summary underneath must never be contradicted about.
 *
 * **What it deliberately cannot do.** There is no hide-cursor sequence here and
 * no way to write one: `theme.line` exposes exactly two escapes, return to
 * column zero and clear the line, and neither of them is stateful. A renderer
 * with nothing to restore cannot leave a terminal broken, so this file has no
 * signal handler, no exit hook, and no try/finally — an interrupted run leaves
 * a visible cursor on a partly drawn bar, which is the accepted cost and the
 * reason the guarantee holds without any machinery defending it.
 */

/**
 * How many cells the bar occupies.
 *
 * A constant, not a function of the terminal width. Deriving it from the
 * terminal would mean measuring, would make the bar jump on a resize, and would
 * make its rendering depend on a value this process has no reliable way to
 * track. A fixed bar is stable in scrollback and identical in every transcript.
 */
const BAR_CELLS = 24;

/**
 * Build the progress treatment for one run.
 *
 * Three behaviours, chosen from the theme and never from a call site:
 *
 * - `contract` — nothing at all. No bar, no milestone, no byte. This tier is a
 *   promise made to scripts, and a repaint written into a pipe would produce a
 *   log file containing a transcript of an animation.
 * - `plain` — milestones, no bar. The phase still says what it finished; it
 *   simply does not repaint a line, because `dynamic` is false.
 * - `expressive` — milestones and the bar.
 *
 * @param {object} options
 * @param {object} options.theme - the run's theme, from `createTheme`.
 * @param {number} options.total - units the plans enumerated. Zero disables the
 *   bar, which is what a dry run and an empty plan both want.
 * @param {(text: string) => void} options.out - where to write.
 */
export function createProgress({ theme, total = 0, out = () => {} } = {}) {
  const speaks = theme.tier !== "contract";
  const repaints = speaks && theme.dynamic && total > 0;

  let done = 0;
  let failed = 0;

  /**
   * The bar, as one line, from the three numbers above.
   *
   * Floor rather than round on both the fill and the percentage. Rounding would
   * let 35 of 36 units display a full bar at 100%, which is a claim about work
   * that has not happened — the exact defect this whole design exists to avoid,
   * and one that would only ever be visible on the last unit of a slow run.
   */
  const bar = () => {
    const filled = Math.floor((done / total) * BAR_CELLS);
    const track =
      theme.glyph.barFull.repeat(filled) + theme.glyph.barEmpty.repeat(BAR_CELLS - filled);
    const percent = String(Math.floor((done / total) * 100)).padStart(3);

    // Painted `warn` the moment anything has failed, so the bar's own colour
    // stops agreeing with a summary that is about to report an error. Colour is
    // not the only carrier: the count and its glyph are spelled out beside it.
    const tail = failed > 0 ? `  ${theme.warn(`${theme.glyph.warn} ${failed} failed`)}` : "";
    return `  ${failed > 0 ? theme.warn(track) : theme.ok(track)} ${percent}%${tail}`;
  };

  const repaint = () => {
    if (repaints) out(theme.line.start() + theme.line.clear() + bar());
  };

  return {
    /** One unit resolved. The only thing that may move this bar. */
    advance({ ok = true } = {}) {
      if (ok) done += 1;
      else failed += 1;
      repaint();
    },

    /**
     * A phase finished. Printed above the bar, which is then redrawn.
     *
     * The clear-then-print-then-repaint order is what lets a milestone scroll
     * into the transcript while the bar stays on the last line, using only the
     * two escapes the theme exposes. Moving the cursor up to keep the bar in
     * place would need sequences that do not exist here on purpose.
     */
    milestone(text) {
      if (!speaks) return;
      if (repaints) out(theme.line.start() + theme.line.clear());
      out(`${text}\n`);
      repaint();
    },

    /**
     * End the phase, leaving the completed bar on screen.
     *
     * One newline, so the bar becomes part of the transcript rather than
     * something the summary overwrites. Someone pasting the run into an issue
     * keeps the evidence that the phase ran.
     */
    finish() {
      if (repaints) out("\n");
    },

    /** Exposed for tests and for a caller that wants to assert its own totals. */
    get completed() {
      return done;
    },
    get failures() {
      return failed;
    },
    get total() {
      return total;
    },
  };
}
