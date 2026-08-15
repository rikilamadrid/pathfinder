/**
 * Every capability decision and every decorated byte the CLI emits.
 *
 * One seam, so that a second consumer or a second kind of decoration has
 * somewhere to attach. Before this module, `marks()` and `supportsUnicode()`
 * sat beside the one report they served, and two non-ASCII characters had
 * already escaped the ASCII fallback entirely — which is the argument for the
 * seam, not an accident of that particular pair.
 *
 * Three properties hold, and each one exists to stop a class of call-site bug:
 *
 * - **Total functions.** `theme.ok("text")` returns the plain string when
 *   colour is off; the line primitives return the empty string when repainting
 *   is not allowed. A call site never asks about capability, so a call site can
 *   never forget to. A call site that seems to need a conditional means this
 *   module is missing a helper.
 * - **Pure.** `createTheme` reads `{ env, platform, isTTY }` and nothing else —
 *   no `process`, no `node:tty`, no filesystem. `run()` is already handed all
 *   three, so there is no second source to disagree with. The tests build
 *   several themes per file, which a module-level singleton would prevent.
 * - **Decoration, not drawing.** No timer, no loop, no frame, no buffer, no
 *   state that survives a call. The line primitives are two escape strings and
 *   a boolean. If this file grows a concept of drawing, it has overreached.
 *
 * Deliberately absent: cursor visibility control. A renderer that never hides
 * the cursor has nothing to restore, so no signal handler and no interrupted
 * run can leave a terminal broken. A cursor parked at the end of a progress bar
 * is the accepted cost of that guarantee. Feature 23 adds a second repainting
 * surface and does not weaken this: the selector parks the cursor visibly below
 * its block for exactly the same reason.
 *
 * Newly present, and worth naming beside that absence: `width` and `clip`, from
 * `cells.mjs`. They measure rather than decorate, which is why the algorithm
 * lives in its own module and only the seam is published here — and they are
 * the one part of this file that answers the same way in every tier, because a
 * string's printed width is a fact about the string rather than a capability of
 * the terminal.
 */

import { clip, width } from "./cells.mjs";

/**
 * SGR codes, written out rather than depended on.
 *
 * Eight ANSI colours, bold, and dim. Every *severity* in this module is one of
 * these and will stay one of these: they render identically everywhere, and a
 * level that means "this went wrong" must never depend on a colour that some
 * terminal renders as something else.
 */
const SGR = Object.freeze({
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  red: "\u001B[31m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  cyan: "\u001B[36m",
});

/**
 * Blaze orange, `#E0611F`, in as many alphabets as terminals actually speak.
 *
 * This is the one colour in the CLI that is an *identity* rather than a level,
 * and it is the only reason this module knows what a colour depth is. The
 * severity paints are untouched by all of it, which is the containment that
 * makes the extra depth affordable: a terminal that lies about its capability
 * costs the brand its exact hue, and costs meaning nothing.
 *
 * Three renderings, best first:
 *
 * - **24-bit** - the real value, exactly. Nothing is approximated.
 * - **256** - index 166, `#D75F00`. Chosen by computing the nearest cell of the
 *   6x6x6 cube rather than by eye: `#E0611F` is (224, 97, 31), the cube's
 *   levels are 0/95/135/175/215/255, and (215, 95, 0) is nearest by squared
 *   distance at 1046 - well clear of the obvious rival 208 `#FF8700` at 3366.
 * - **16** - bold yellow, and only here. This is the floor, never the
 *   preference: it is the only warm accent the eight ANSI values offer, so at
 *   this depth alone do the brand and `warn` share a hue. The collision is
 *   contained rather than waved away - at this depth the identity is carried by
 *   the mark's form, its letterspacing, and its position, and a warning is
 *   always additionally a glyph and a word. Closing that overlap is precisely
 *   what the two depths above are for.
 */
const BRAND = Object.freeze({
  24: "\u001B[38;2;224;97;31m",
  8: "\u001B[38;5;166m",
  4: `${SGR.bold}${SGR.yellow}`,
});

/**
 * The glyph table, in whichever alphabet this terminal can be trusted with.
 *
 * One table, so a finding and the action it leads to are marked the same way,
 * and so that every character above U+007F the CLI prints has exactly one
 * source. `ellipsis` and `dash` are here for the same reason the severity marks
 * are: they were being printed unconditionally by call sites that had already
 * been told the terminal only gets ASCII.
 *
 * `warn` is the one genuinely new choice. In ASCII it is `*` rather than the
 * obvious `!`, because `!` already means `bad` — and a collision between the
 * two would land precisely in the plain tier, where the glyph is doing the most
 * work because there is no colour beside it.
 *
 * The second group is structural rather than severity: the marks a run's
 * identity and phases are built from. `scan` and `box` are emoji in the
 * decorated alphabet, which is a deliberate product decision and not a drift,
 * and each has an ASCII counterpart that survives the fallback with its sense
 * intact - a lens, and a crate.
 *
 * `barFull` and `barEmpty` are the progress bar's two cells. They only ever
 * render in the expressive tier, since `dynamic` is false everywhere else and
 * the bar draws nothing there - but they carry ASCII counterparts anyway, so
 * that the alphabets stay the same size and the fallback stays a property of
 * this table rather than a fact about who happens to call it.
 *
 * `rule` is both the stroke the Pathfinder mark is drawn from and the character
 * any other horizontal device would use. `gutter` hangs a block together down
 * its left edge. Both are drawn left to right from a fixed count and neither
 * closes on the right, ~~so no caller ever has to know the printed width of a
 * decorated string~~ — **superseded in Feature 22; see `width` and `clip`
 * below.** That is why there is no corner, no box, and no border character in
 * this table — a closed box cannot be aligned without width maths that emoji
 * defeat, which the prototype demonstrated by failing to close its own.
 *
 * The struck clause was true of every device in this module and is still the
 * reason none of them closes on the right. What falsified it is a surface this
 * module did not have when the sentence was written: a *repainting* one. A
 * renderer that redraws a block in place has to know how many rows that block
 * occupies, and a line wider than the terminal silently becomes two — so the
 * cursor-up count goes wrong and the block walks down the screen. Feature 23's
 * prototype reproduced exactly that at 24 columns.
 *
 * So the conclusion is narrowed rather than reversed. Nothing here draws a box,
 * and nothing should. But "no caller needs printed width" was a claim about
 * *what this module happened to contain*, not a rule about terminals, and the
 * honest correction is to publish the measurement rather than let a caller
 * reach for `.length` and be wrong by the length of an escape sequence.
 *
 * The third group is the selector's, added by Feature 23, and it is five rather
 * than the four a checkbox list looks like it needs. `pointer` marks the
 * highlighted row, `checked` and `unchecked` carry a multi-select row's state,
 * and `arrowUp` and `arrowDown` are the hint line's — printed as text in a
 * sentence, and therefore glyphs like any other rather than the escape
 * sequences the same arrows arrive as.
 *
 * Their ASCII counterparts are the reason the minimum-width floor is what it is.
 * `[x]` is three cells where `◉` is one, and `...` is three where `…` is one, so
 * ASCII is the *binding* alphabet for width — 5 to 8 cells wider per row — and
 * the floor below is derived against it rather than against the pretty one.
 */
const GLYPHS = Object.freeze({
  unicode: Object.freeze({
    ok: "✓",
    info: "·",
    warn: "▲",
    bad: "✗",
    dash: "—",
    ellipsis: "…",
    scan: "🔍",
    box: "📦",
    clipboard: "📋",
    party: "🎉",
    rule: "━",
    gutter: "│",
    barFull: "█",
    barEmpty: "░",
    pointer: "❯",
    checked: "◉",
    unchecked: "○",
    arrowUp: "↑",
    arrowDown: "↓",
  }),
  ascii: Object.freeze({
    ok: "+",
    info: "-",
    warn: "*",
    bad: "!",
    dash: "-",
    ellipsis: "...",
    scan: "(o)",
    box: "(=)",
    clipboard: "(:)",
    party: "\\o/",
    rule: "=",
    gutter: "|",
    barFull: "#",
    barEmpty: ".",
    pointer: ">",
    checked: "[x]",
    unchecked: "[ ]",
    arrowUp: "^",
    arrowDown: "v",
  }),
});

/**
 * Can this terminal be trusted with the decorated glyphs?
 *
 * Answered from the environment rather than attempted and hoped for, and biased
 * hard toward "no": an unanswerable environment gets ASCII, which is readable
 * everywhere, while a wrong "yes" leaves mojibake in the first output a new
 * user ever sees from this tool.
 *
 * Moved from `cli.mjs` unchanged. The rules are not revisited here — a rewrite
 * would be a behaviour change wearing a refactor's clothes.
 */
function detectUnicode(env, platform) {
  if (platform === "win32") {
    return Boolean(env.WT_SESSION) || env.TERM_PROGRAM === "vscode";
  }
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return /utf-?8/i.test(locale);
}

/**
 * May this run emit colour?
 *
 * The order of these checks is the whole answer, so it is written as a sequence
 * of refusals ending in the default:
 *
 * 1. `FORCE_COLOR=0` is an explicit "no" and outranks everything, including a
 *    terminal that would otherwise qualify.
 * 2. `NO_COLOR` disables on presence, whatever its value — that is the
 *    convention, and honouring the value would make `NO_COLOR=` a surprise.
 *    It outranks `FORCE_COLOR`, which promises only to override TTY detection.
 * 3. `TERM=dumb` is the terminal telling us what it is.
 * 4. `FORCE_COLOR` set to anything else turns colour on with no TTY, which is
 *    how a CI job that renders ANSI in its log viewer asks for it.
 * 5. Otherwise: colour if this is a terminal.
 */
function detectColor(env, isTTY) {
  if (env.FORCE_COLOR === "0") return false;
  if (env.NO_COLOR !== undefined) return false;
  if (env.TERM === "dumb") return false;
  if (env.FORCE_COLOR !== undefined) return true;
  return isTTY;
}

/**
 * How many colours this terminal has *said* it can render: 0, 4, 8, or 24 bits.
 *
 * A third axis beside colour and Unicode, and deliberately not a fourth tier.
 * The tier answers "what kind of presentation is this", and every tier already
 * works at every depth — so a depth is a refinement of one colour, never a
 * different rendering. Exactly one consumer exists, `brand`, and if a severity
 * ever reads this value something has gone wrong upstream.
 *
 * Answered only from what the environment volunteers. Nothing is probed, no
 * escape sequence is written and read back, and no reply is waited for: a
 * capability query is a round trip with a terminal that may never answer, and
 * this module is not allowed to block or to hold state.
 *
 * The order is a sequence of claims, strongest first, ending in the floor:
 *
 * 1. `FORCE_COLOR` at 2 or 3 is someone stating a depth outright. This is the
 *    convention the ecosystem settled on, and it is also the only way to
 *    exercise the upper depths in a test without pretending to be a terminal.
 * 2. `COLORTERM` of `truecolor` or `24bit` is the de-facto announcement, set by
 *    every terminal that means it.
 * 3. A `TERM` ending in `-direct` is the terminfo spelling of the same claim.
 * 4. A `TERM` containing `256color` is the older, narrower claim.
 * 5. Otherwise 4 — the floor, and the answer for every terminal that said
 *    nothing.
 *
 * Biased toward under-claiming, exactly as `detectUnicode` is, but the stakes
 * are far lower here and worth stating plainly: a wrong "yes" about Unicode
 * leaves mojibake in someone's first impression, whereas a wrong "yes" here
 * renders one wordmark in an unintended colour or, on a terminal that ignores
 * the sequence entirely, in the default one. `COLORTERM` does leak across ssh,
 * tmux, and sudo, so being wrong is realistic — it is simply cheap.
 */
function detectColorDepth(env, color) {
  if (!color) return 0;
  if (env.FORCE_COLOR === "3") return 24;
  if (env.FORCE_COLOR === "2") return 8;

  const colorterm = env.COLORTERM || "";
  if (/^(truecolor|24bit)$/i.test(colorterm)) return 24;

  const term = env.TERM || "";
  if (/-direct$/i.test(term)) return 24;
  if (/256color/i.test(term)) return 8;

  return 4;
}

/**
 * Which presentation tier this run gets.
 *
 * Decided once, here, as a documented function of capability — the alternative
 * is every call site guessing, and them disagreeing.
 *
 * - `contract` — not a terminal. A pipe, a redirect, a CI log. These bytes are
 *   a promise kept to scripts written against 1.4.1, so the tier is decided by
 *   the TTY alone and nothing else can promote a run into it or out of it.
 * - `expressive` — a terminal that answered yes to both colour and Unicode.
 * - `plain` — a terminal that did not. Not a degraded mode: it is a supported
 *   way to use this tool, and anything that reads correctly only in
 *   `expressive` is a defect.
 *
 * `FORCE_COLOR` with no TTY is the one combination worth stating outright: the
 * tier is `contract` and colour is on. That is not a contradiction — the tier
 * answers "is anyone watching this live", the capability answers "did they ask
 * for colour", and someone setting `FORCE_COLOR` in a pipeline has answered the
 * second question themselves.
 */
function selectTier({ isTTY, color, unicode }) {
  if (!isTTY) return "contract";
  return color && unicode ? "expressive" : "plain";
}

/**
 * How many columns a terminal that told us nothing is assumed to have.
 *
 * 80, because that is the width a terminal has when it has no opinion, and
 * because guessing narrow is the safe direction: an over-wide guess lets a row
 * wrap, which is the one failure the clipping in `cells.mjs` exists to prevent.
 */
const DEFAULT_COLUMNS = 80;

/**
 * The narrowest terminal keyboard selection is offered on: **49 columns**.
 *
 * Measured rather than chosen. The derivation ran the real prompt corpus — every
 * selection question the CLI can ask — through the width model in `cells.mjs`,
 * in both alphabets, and asked what each candidate width still preserves:
 *
 * | Tier preserved                  | Columns |
 * |---------------------------------|---------|
 * | marker + full label             | 24      |
 * | + full hint line                | 41      |
 * | **+ `-> path` context**         | **49**  |
 * | + `(detected)` suffix           | 56      |
 *
 * 49 is the smallest width at which nothing load-bearing is lost: the marker,
 * the whole label, the whole interaction hint, and the path each row would
 * write to. An earlier estimate of 32 was falsified outright — at 32 the hint
 * loses the word `confirm` and the path is cut mid-word, and even 40 loses one
 * character.
 *
 * The floor is deliberately **not** 56. `(detected)` is the only thing 49 gives
 * up, and it is already stated in the run's ENVIRONMENT block, so it duplicates
 * information rather than carrying it. A suffix that says nothing new does not
 * get to decide whether the whole interaction is available — it is omitted
 * cleanly at narrow widths instead, never truncated to a fragment.
 *
 * Not configurable, and that is the decision rather than an omission. A floor
 * anyone can lower is a floor that stops meaning what it was measured to mean.
 */
const SELECTION_MIN_COLUMNS = 49;

/**
 * May this run ask its questions with the arrow keys?
 *
 * A capability in its own right, and specifically **not** derived from
 * `dynamic`. `dynamic` is colour ∧ unicode, and neither is a claim about
 * repainting: someone who set `NO_COLOR` asked for no decoration, not for no
 * cursor movement, and someone in a Latin-1 locale said nothing at all about
 * either. Deriving one from the other would take the keyboard away from users
 * who never asked to lose it.
 *
 * Five conditions, written as refusals, in the order that makes each one's
 * reason legible:
 *
 * 1. **`PATHFINDER_PROMPT=classic` outranks everything.** It is a person saying
 *    so, and it is the first-class answer for a screen reader — where a
 *    repainting block re-announces itself on every arrow press and the highlight
 *    is carried by position and colour, neither of which is conveyed. It also
 *    outranks capability so that scripts and anyone who simply prefers typing a
 *    number get a supported path rather than a workaround.
 * 2. **Both ends must be terminals.** A selector needs somewhere to repaint
 *    *and* someone able to press a key. Either half missing and the question
 *    cannot be answered this way at all.
 * 3. **`TERM=dumb` is the terminal telling us what it is.** Taken at its word,
 *    exactly as `detectColor` takes it.
 * 4. **`setRawMode` must exist on the input.** Not called here or anywhere in
 *    this package — readline owns raw mode and keeps it — but its absence means
 *    the stream cannot deliver keypresses, so there is nothing to borrow.
 * 5. **At least `SELECTION_MIN_COLUMNS`.** Below the floor the classic path is
 *    used, which is a supported way to answer the question rather than a
 *    degradation of this one.
 */
function detectSelection({ env, isTTY, inputIsTTY, setRawMode, columns }) {
  if (env.PATHFINDER_PROMPT === "classic") return false;
  if (!isTTY || !inputIsTTY) return false;
  if (env.TERM === "dumb") return false;
  if (!setRawMode) return false;
  return columns >= SELECTION_MIN_COLUMNS;
}

/**
 * Build a theme from what the process was able to observe about the outside
 * world.
 *
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env] - the environment,
 *   as `run()` received it.
 * @param {string} [options.platform] - `process.platform`, as `run()` received
 *   it.
 * @param {boolean} [options.isTTY] - whether stdout is a terminal.
 * @param {boolean} [options.inputIsTTY] - whether stdin is a terminal. Defaults
 *   to false for the same reason every other capability here does: an
 *   unanswerable environment gets the conservative answer.
 * @param {boolean} [options.setRawMode] - whether the input stream offers
 *   `setRawMode`. Passed as a boolean rather than the stream, so this module
 *   stays pure and no test has to synthesize a TTY to ask a question about one.
 * @param {number} [options.columns] - the terminal's width. Anything that is
 *   not a positive integer — including the `undefined` a non-TTY stream reports
 *   — falls back to 80 rather than throwing.
 * @returns {Readonly<object>} the theme
 */
export function createTheme({
  env = {},
  platform = "linux",
  isTTY = false,
  inputIsTTY = false,
  setRawMode = false,
  columns,
} = {}) {
  const unicode = detectUnicode(env, platform);
  const color = detectColor(env, isTTY);
  const colorDepth = detectColorDepth(env, color);
  const tier = selectTier({ isTTY, color, unicode });

  // A width, always, and never a throw. `process.stdout.columns` is `undefined`
  // whenever stdout is not a terminal, and every arithmetic done with it
  // afterwards would be `NaN` — which compares false against every threshold and
  // would silently answer "no" to questions nobody asked.
  const terminalColumns =
    Number.isInteger(columns) && columns > 0 ? columns : DEFAULT_COLUMNS;

  // May this run repaint a line it has already written? Only where someone is
  // watching it happen. A pipe keeps every byte ever written to it, so a
  // progress treatment that repaints into a log file produces a transcript of
  // its own animation.
  const dynamic = tier === "expressive";

  const selection = detectSelection({
    env,
    isTTY,
    inputIsTTY,
    setRawMode,
    columns: terminalColumns,
  });

  // Who is allowed the cursor escapes, and it is the union of the two surfaces
  // that repaint rather than either one alone.
  //
  // This used to be `dynamic` by itself, and that was correct while the progress
  // bar was the only repainting thing in the package. It stopped being correct
  // the moment a second surface repainted under a *different* capability: a
  // selector on a `NO_COLOR` terminal is offered — `NO_COLOR` says nothing about
  // repainting — and would then have been handed `""` for the very sequences it
  // needs, clearing no line and leaving the tail of every longer row behind.
  //
  // No existing output moves. `progress.mjs` tests `theme.dynamic` itself before
  // it reaches for a primitive, so widening the gate cannot widen what the
  // progress bar draws. What it does narrow is one promise worth stating
  // outright rather than discovering: "a run without colour emits no escape
  // byte" now means no *colour* escape byte. A plain-tier terminal driving a
  // selector emits `ESC[2K` and `ESC[nA`, because that is what a selector is.
  const repaints = dynamic || selection;

  /**
   * Wrap `text` in an SGR pair, or hand it back untouched.
   *
   * The reset is unconditional rather than a matching "off" code, because a
   * caller may nest and the cheap correct thing is to end every span the same
   * way. Several codes may be given, which is how emphasis combines with a
   * colour without a call site nesting two paints and emitting two resets.
   */
  const paint =
    (...codes) =>
    (text) =>
      color ? `${codes.join("")}${text}${SGR.reset}` : `${text}`;

  const glyph = unicode ? GLYPHS.unicode : GLYPHS.ascii;

  return Object.freeze({
    // What was decided, exposed for tests and for the one place that may
    // legitimately branch: a caller choosing between whole presentations.
    tier,
    color,
    unicode,
    dynamic,

    // May this run's questions be answered with the arrow keys?
    //
    // Read by `prompt.mjs` to choose between two whole implementations of the
    // same interface, which is the one legitimate reason to branch on a
    // capability. False is not an error and not a degraded rendering: it selects
    // the numbered/`y n` path, which is a supported way to use this tool and
    // stays byte-identical to the one 1.6.0 shipped.
    selection,

    // The width the capability above was decided against, resolved and never
    // undefined.
    //
    // A *snapshot*, and the distinction matters: a terminal can be resized while
    // a question is on screen, so a renderer clipping its rows must read the
    // live value from the stream it is writing to. This is here to answer "how
    // wide did we think it was when we decided", which is what a test and a
    // reviewer need, and nothing else.
    columns: terminalColumns,

    glyph,

    // Severity, named for what it means and never for the colour it happens to
    // use. Four levels: `warn` is new and nothing consumes it yet.
    //
    // Colour never carries meaning alone. Every one of these takes a string
    // that already says something, and the call sites pair them with a glyph
    // from the table above — so a `plain` terminal, a screen reader, and a
    // colour-blind reader all lose the decoration and keep the message.
    ok: paint(SGR.green),
    info: paint(SGR.cyan),
    warn: paint(SGR.yellow),
    bad: paint(SGR.red),

    // Emphasis, not severity. Kept separate so that "important" and "something
    // went wrong" cannot be confused for one another at a call site.
    bold: paint(SGR.bold),
    dim: paint(SGR.dim),

    // What depth the brand got, exposed for the same reason `tier` is: tests
    // need to assert it, and a reviewer needs to be able to ask.
    colorDepth,

    // Identity, and the only place a colour is chosen to mean "Pathfinder"
    // rather than to mean a level.
    //
    // Written against BRAND rather than through `paint`, because this is the
    // one paint whose escape sequence is chosen at run time from what the
    // terminal claimed. Everything else in this module has exactly one code for
    // its whole life, and keeping those two facts in separate functions is what
    // stops a future severity from quietly acquiring a depth.
    //
    // Note what is *not* here: any attempt to reproduce #E0611F on a terminal
    // that did not say it could. At depth 4 the brand degrades to the warm
    // accent the eight ANSI values offer and the mark's form carries the rest,
    // which is the whole reason the mark is a drawing of the logo and not a
    // coloured word.
    brand: (text) => (colorDepth === 0 ? `${text}` : `${BRAND[colorDepth]}${text}${SGR.reset}`),

    // The only escape sequences that are not colour, and the reason they live
    // here: a progress renderer that hand-rolled its own would be a second
    // place capable of writing bytes into a pipe. Exactly three — return to
    // column zero, clear the current line, and move up — and every one of them
    // is the empty string wherever repainting is not allowed, so a caller that
    // never checks a capability still emits nothing.
    //
    // `up` is the *only* escape Feature 23 added, and the budget is the design
    // rather than a coincidence. A selector needs to get back to the top of the
    // block it drew and rewrite it; it does not need absolute positioning, a
    // scroll region, an alternate screen, or — above all — cursor hiding. A
    // fourth primitive appearing here means a renderer has started drawing
    // something this package decided not to draw.
    //
    // `n` is a row count, so a non-positive or non-integer one is not an error
    // to raise but a movement to decline: the first paint of a block has nothing
    // above it to return to, and `ESC[0A` moves one row on some terminals rather
    // than none.
    line: Object.freeze({
      start: () => (repaints ? "\r" : ""),
      clear: () => (repaints ? "\u001B[2K" : ""),
      up: (n) => (repaints && Number.isInteger(n) && n > 0 ? `\u001B[${n}A` : ""),
    }),

    // How wide a rendered string actually is, and how to make it narrower.
    //
    // Published here rather than imported directly by call sites, for the same
    // reason every paint is: one seam, so a second opinion about what a
    // decorated string measures cannot come into existence. A caller reaching
    // past this into `cells.mjs` is doing the thing this module exists to
    // prevent — and a caller reaching for `.length` is simply wrong, by the
    // length of whatever escape sequence the theme just wrapped around it.
    //
    // Note what these are *not* conditioned on. Unlike `line`, they consult
    // neither `dynamic` nor `color` nor the tier: how many cells a string
    // occupies is a fact about the string, and a function that gave a different
    // answer in a pipe would be lying about identical bytes. Capability decides
    // what a caller *does* with the answer, not what the answer is.
    //
    // Deliberately thin. No padding, no alignment, and above all no wrapping —
    // `cells.mjs` explains why wrapping is the one addition that would turn
    // this into the layout engine neither module is allowed to become.
    width,
    clip,
  });
}
