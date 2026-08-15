/**
 * A vertical list you answer with the arrow keys, drawn on a terminal that
 * belongs to somebody else.
 *
 * The whole design follows from one decision: **readline stays the owner of raw
 * mode for the entire run.** `setRawMode` is never called here, or anywhere in
 * this package. `createInterface` turns raw mode on because stdin is a TTY and
 * `rl.close()` turns it off, and this module simply borrows the keyboard in
 * between and gives it back. Owning raw mode would mean owning its restoration
 * on every exit path including the ones nobody plans for, and the interrupt
 * guarantee this package already has would become something to maintain rather
 * than something that holds by construction.
 *
 * ## Two listeners are borrowed, not one
 *
 * An open Interface registers exactly one `keypress` listener on its input and
 * exactly one `resize` listener on its output — verified identical on Node
 * 18.12.1, 18.17.0, 20.20.2, 22.23.1 and 26.5.0.
 *
 * The first is obvious: removing it disengages readline's line editor
 * completely — no echo, no history, no line buffer — while the Interface stays
 * open and therefore still holds raw mode. The stream's keypress decoder keeps
 * running because a listener of our own goes on immediately.
 *
 * The second was found by experiment and is **not optional**. On SIGWINCH an
 * open Interface refreshes its own line, emitting `ESC[1G`, `ESC[0J` and
 * `ESC[3G` — none of which are in this package's escape budget — and painting
 * its default `"> "` prompt into the middle of the frame. Borrowing the
 * keyboard without borrowing this leaves readline drawing on top of us the
 * moment someone drags a window edge.
 *
 * ## The cursor is never hidden
 *
 * No `?25l`, ever. It parks visibly at column 0 below the block, which is why
 * nothing needs restoring, why no signal handler exists, and why an interrupted
 * run cannot leave a terminal with an invisible cursor. A repainting renderer
 * is exactly the kind of code that reaches for cursor hiding, so the absence is
 * stated here rather than left to be noticed.
 *
 * ## The question is printed once, above everything this module repaints
 *
 * The repainted block is the option rows, a blank line, and the hint — and
 * nothing else. The question is written once before the block and never
 * touched again.
 *
 * That is a width decision rather than an aesthetic one. The longest question
 * the CLI asks is 70 cells, so a question inside the block would force a
 * minimum terminal width of 71 and put keyboard selection out of reach of a
 * split pane. Outside the block it is free to wrap across as many rows as it
 * likes: the cursor-up count is computed over the block, the question is not in
 * it, and a row count that is not part of the arithmetic cannot corrupt it.
 *
 * ## Every row is clipped, and `.length` is never a width
 *
 * The byte stream this renderer emits is width-independent — it always says
 * `ESC[7A` for a seven-row block — so a row wider than the terminal takes two
 * rows, the cursor moves up one row too few, and every repaint leaves a copy of
 * the frame behind. Reproduced during the prototype at 24 columns: five copies
 * of the question for four keypresses.
 *
 * Clipping every row to `columns - 1` makes the row count equal the line count
 * by construction. It has to be `theme.clip` and `theme.width` rather than
 * `String.prototype.slice` and `.length`: `theme.ok("✓ Git repository detected")`
 * has a `.length` of 34 and occupies 25 cells, and a slice through an escape
 * sequence prints its tail as literal text.
 *
 * ## What this module deliberately is not
 *
 * No filtering, no fuzzy search, no scrolling viewport, no mouse, no spinner,
 * no animation, no colour of its own. The highlight is carried by a pointer
 * glyph, which is the one presentation that survives every tier, both
 * alphabets, and a terminal that renders no colour at all.
 */

/** Terminal width to assume when the stream will not say. */
const FALLBACK_COLUMNS = 80;

/**
 * How wide the terminal is *right now*, not when the theme was built.
 *
 * Deliberately read from the stream on every paint. A window can be dragged
 * while a question is on screen, and a renderer clipping against a remembered
 * width would clip against a terminal that no longer exists.
 */
function liveColumns(output, theme) {
  const columns = output?.columns;
  if (Number.isInteger(columns) && columns > 0) return columns;
  return theme.columns ?? FALLBACK_COLUMNS;
}

/**
 * Pad `text` on the right to `cells` columns of *rendered* width.
 *
 * Not `padEnd`, which counts UTF-16 units: it pads `[x]` and `◉` to different
 * places, and would pad a coloured string by the length of its escape sequence.
 */
function padTo(text, cells, theme) {
  const short = cells - theme.width(text);
  return short > 0 ? text + " ".repeat(short) : text;
}

/**
 * How wide the label column has to be for the second column to line up.
 *
 * Zero when there is nothing to line up against. A list of editors has nothing
 * to the right of its labels, and padding them would emit trailing whitespace
 * that means nothing and clips first.
 *
 * @param {{label: string, hint?: string}[]} options
 * @param {object} theme
 * @returns {number}
 */
export function alignmentWidth(options, theme) {
  if (!options.some((option) => Boolean(option.hint))) return 0;
  return Math.max(...options.map((option) => theme.width(option.label)));
}

/**
 * One option, as text: its label, the path it writes to, and whatever the
 * detector had to say about it.
 *
 * Exported because **both** renderers need the same grammar. The classic
 * numbered list and the keyboard selector draw completely different frames
 * around an option, but the option itself reads the same in each — and it has
 * to, because the classic path is a supported way to answer the question and
 * not a reduced one. Two implementations of this sentence would drift, and the
 * drift would be invisible until someone ran the same install twice under
 * different terminals.
 *
 * What is *not* here: the pointer, the checkbox, and the clipping. Those belong
 * to a frame, and only one of the two renderers draws them.
 *
 * @param {object} args
 * @param {object} args.theme
 * @param {{label: string, hint?: string, note?: string}} args.option
 * @param {number} [args.labelWidth] - from `alignmentWidth`
 * @param {boolean} [args.withNote] - false to compose the row without its
 *   suffix, which is how a caller asks "how short can this row be".
 * @returns {string}
 */
export function optionRow({ theme, option, labelWidth = 0, withNote = true }) {
  const label = labelWidth > 0 ? padTo(option.label, labelWidth, theme) : option.label;
  const row = label + (option.hint ? `  -> ${option.hint}` : "");
  return withNote && option.note ? `${row}   ${option.note}` : row;
}

/**
 * Build the block this renderer repaints: the option rows, a blank line, and
 * the hint.
 *
 * Pure, and exported for that reason — the no-wrap guarantee is a property of
 * these strings at a given width, and asserting it should not require
 * synthesizing a terminal and pressing keys at it.
 *
 * Every returned line is already clipped to `columns - 1`, so the caller may
 * count them as rows without checking anything.
 *
 * @param {object} args
 * @param {object} args.theme
 * @param {{label: string, value: unknown, hint?: string, note?: string}[]} args.options
 * @param {number} args.cursor - index of the highlighted row
 * @param {Set<number>} [args.selected] - checked indices, multi-select only
 * @param {boolean} [args.multi]
 * @param {number} args.columns
 * @returns {string[]}
 */
export function renderBlock({ theme, options, cursor, selected = new Set(), multi = false, columns }) {
  const budget = Math.max(0, columns - 1);
  const glyph = theme.glyph;

  // An unhighlighted row spends the same cells on nothing that a highlighted one
  // spends on the pointer, so the labels never shift sideways as the cursor
  // moves. Measured rather than assumed to be one: `❯` is one cell and `>` is
  // one cell today, and a future pointer that is not would silently misalign
  // every row.
  const blank = " ".repeat(theme.width(glyph.pointer));

  const labelWidth = alignmentWidth(options, theme);

  const rows = options.map((option, index) => {
    const pointer = index === cursor ? glyph.pointer : blank;
    const box = multi ? `${selected.has(index) ? glyph.checked : glyph.unchecked} ` : "";
    const frame = `${pointer} ${box}`;

    // The suffix renders whole or not at all.
    //
    // `note` carries `(detected)`, which the ENVIRONMENT phase has already
    // reported — so it duplicates information rather than carrying it, and a
    // truncated `(detec` would be strictly worse than its absence. This is also
    // why the minimum width is 49 rather than the wider terminal a guaranteed
    // `note` would demand: a suffix that says nothing new does not get to decide
    // whether the whole interaction is available.
    const decorated = frame + optionRow({ theme, option, labelWidth });
    const bare = frame + optionRow({ theme, option, labelWidth, withNote: false });

    return theme.clip(theme.width(decorated) <= budget ? decorated : bare, budget);
  });

  const keys = multi
    ? `${glyph.arrowUp}${glyph.arrowDown} move   space toggle   enter confirm`
    : `${glyph.arrowUp}${glyph.arrowDown} move   enter confirm`;

  return [...rows, "", theme.clip(`  ${keys}`, budget)];
}

/**
 * Ask one question with the arrow keys, over a readline Interface somebody else
 * opened.
 *
 * Returns the chosen `value`, or an array of them when `multi`, or `null` when
 * nobody answered — Escape, or a stream that ended. `null` is the same refusal
 * every existing call site already reads from the classic path, which is what
 * lets this be swapped in behind an unchanged interface.
 *
 * @param {object} args
 * @param {import("node:readline").Interface} args.readline - the raw-mode owner
 * @param {object} args.theme
 * @param {string} args.question
 * @param {{label: string, value: unknown, hint?: string, note?: string, key?: string}[]} args.options
 * @param {boolean} [args.multi]
 * @param {unknown[]} [args.initial] - values checked at the start in `multi`,
 *   and the value highlighted at the start otherwise. One shape for both, so a
 *   caller never has to remember which mode takes which.
 * @param {() => void} [args.raiseInterrupt] - how Ctrl-C re-raises. Injected so
 *   that a test can observe the interrupt rather than be killed by it.
 * @returns {Promise<unknown|unknown[]|null>}
 */
export function select({
  readline,
  theme,
  question,
  options,
  multi = false,
  initial = [],
  raiseInterrupt = () => process.kill(process.pid, "SIGINT"),
}) {
  // Nothing to choose between is not a question. Returning before anything is
  // printed keeps an empty list from leaving a hint line on screen that no key
  // can dismiss.
  if (!Array.isArray(options) || options.length === 0) return Promise.resolve(null);

  const input = readline.input;
  const output = readline.output;
  const write = (text) => output.write(text);

  const selected = new Set();
  if (multi) {
    options.forEach((option, index) => {
      if (initial.includes(option.value)) selected.add(index);
    });
  }

  // In `multi` the cursor starts at the top whatever is checked; in a
  // single-select it starts on the answer the caller would have defaulted to,
  // which is what keeps the common case one keystroke.
  const highlighted = multi ? -1 : options.findIndex((option) => initial.includes(option.value));
  let cursor = highlighted >= 0 ? highlighted : 0;

  // How many rows the block on screen occupies. Zero means nothing has been
  // drawn yet, which is also what a resize resets it to.
  let painted = 0;

  const paint = () => {
    const lines = renderBlock({
      theme,
      options,
      cursor,
      selected,
      multi,
      columns: liveColumns(output, theme),
    });

    // Back to the top of the block drawn last time, then rewrite every row in
    // place. Each row is cleared before it is written, so a shorter row can
    // never leave the tail of a longer one behind it.
    write(theme.line.up(painted));
    for (const line of lines) write(theme.line.start() + theme.line.clear() + line + "\n");
    painted = lines.length;

    // The cursor is now parked at column 0 below the block, plainly visible.
  };

  return new Promise((resolve) => {
    let settled = false;

    /**
     * Repaint from scratch, because the block on screen belongs to a width that
     * no longer exists.
     *
     * `painted` counts rows at the *old* width, so moving up by it would be
     * wrong however carefully it was counted. Forgetting it is the honest
     * recovery: the stale frame stays in scrollback and a clean one is drawn
     * below it. A resize costs one duplicated frame and never a corrupted
     * terminal.
     */
    const onResize = () => {
      painted = 0;
      paint();
    };

    function onKey(_sequence, key = {}) {
      // Ctrl-C. Borrowing readline's keypress listener took its Ctrl-C handling
      // with it, so that handling is owed back: give the keyboard up, let
      // readline drop raw mode on close, then re-raise the signal so the process
      // dies exactly the way it would have anyway — exit 130, no handler,
      // nothing swallowed.
      if (key.ctrl && key.name === "c") {
        if (settled) return;
        settled = true;

        // Restore first, so that closing readline finds the terminal exactly as
        // readline left it — and so the `close` listener below, which would
        // otherwise fire from this very `close()`, is already gone.
        restore();
        write("\n");
        readline.close();
        raiseInterrupt();

        // Reached only if the interrupt did not end the process, which is the
        // case under test and never in a real run. Settling is strictly safer
        // than leaving a promise nobody can resolve.
        resolve(null);
        return;
      }

      if (key.name === "up" || key.name === "k") {
        cursor = (cursor - 1 + options.length) % options.length;
        paint();
        return;
      }

      if (key.name === "down" || key.name === "j") {
        cursor = (cursor + 1) % options.length;
        paint();
        return;
      }

      if (multi && key.name === "space") {
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
        paint();
        return;
      }

      if (key.name === "escape") {
        paint();
        finish(null);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        paint();
        finish(answer());
        return;
      }

      // Hidden accelerators, and hidden is the point.
      //
      // `confirm` is a two-row select, and `y`/`n` kept working there costs one
      // lookup and saves anyone with the old habit a keystroke. They are not
      // presented in the hint, because the presented interaction is the arrow
      // keys — an accelerator advertised is a second interaction to learn.
      // Single-select only: in a checkbox list every letter is a candidate for
      // some future label and none of them should silently submit the form.
      if (!multi) {
        const accelerated = options.findIndex((option) => option.key !== undefined && option.key === key.name);
        if (accelerated >= 0) {
          cursor = accelerated;
          paint();
          finish(options[accelerated].value);
          return;
        }
      }

      // Everything else is ignored rather than echoed, which is what stops a
      // stray escape byte from being printed as text into the middle of the
      // block.
    }

    /** What the current state means as an answer. */
    const answer = () =>
      multi
        ? [...selected].sort((a, b) => a - b).map((index) => options[index].value)
        : options[cursor].value;

    /**
     * The stream ended while the question was on screen — Ctrl-D, or a pipe
     * that closed under us.
     *
     * Resolving `null` rather than hanging: an unanswered question is a refusal
     * every call site already knows how to read, and a prompt that waits
     * forever on a closed stdin is how a CI job hangs at 3am.
     */
    const onClose = () => finish(null);

    // Take the keyboard, and the resize handler, remembering exactly what was
    // taken so exactly that can be given back.
    const borrowedKeypress = input.listeners("keypress");
    input.removeAllListeners("keypress");
    const borrowedResize = output.listeners("resize");
    output.removeAllListeners("resize");

    function restore() {
      input.removeListener("keypress", onKey);
      for (const listener of borrowedKeypress) input.on("keypress", listener);
      output.removeListener("resize", onResize);
      for (const listener of borrowedResize) output.on("resize", listener);
      readline.removeListener("close", onClose);
    }

    function finish(value) {
      if (settled) return;
      settled = true;
      restore();
      resolve(value);
    }

    input.on("keypress", onKey);
    output.on("resize", onResize);
    readline.on("close", onClose);

    // Once, above the block, and never again. It may wrap; nothing counts it.
    write(`? ${question}\n\n`);
    paint();
  });
}
