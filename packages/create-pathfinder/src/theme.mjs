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
 * is the accepted cost of that guarantee.
 */

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
 * closes on the right, so no caller ever has to know the printed width of a
 * decorated string. That is why there is no corner, no box, and no border
 * character in this table — a closed box cannot be aligned without width maths
 * that emoji defeat, which the prototype demonstrated by failing to close its
 * own.
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
 * Build a theme from what the process was able to observe about the outside
 * world.
 *
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env] - the environment,
 *   as `run()` received it.
 * @param {string} [options.platform] - `process.platform`, as `run()` received
 *   it.
 * @param {boolean} [options.isTTY] - whether stdout is a terminal.
 * @returns {Readonly<object>} the theme
 */
export function createTheme({ env = {}, platform = "linux", isTTY = false } = {}) {
  const unicode = detectUnicode(env, platform);
  const color = detectColor(env, isTTY);
  const colorDepth = detectColorDepth(env, color);
  const tier = selectTier({ isTTY, color, unicode });

  // May this run repaint a line it has already written? Only where someone is
  // watching it happen. A pipe keeps every byte ever written to it, so a
  // progress treatment that repaints into a log file produces a transcript of
  // its own animation.
  const dynamic = tier === "expressive";

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
    // place capable of writing bytes into a pipe. Exactly two — return to
    // column zero, and clear the current line — and both are the empty string
    // whenever repainting is not allowed, so a caller that never checks
    // `dynamic` still emits nothing.
    line: Object.freeze({
      start: () => (dynamic ? "\r" : ""),
      clear: () => (dynamic ? "\u001B[2K" : ""),
    }),
  });
}
