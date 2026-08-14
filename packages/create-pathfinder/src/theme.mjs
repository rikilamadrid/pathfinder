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
 * Eight ANSI colours, bold, and dim. No truecolor and no 256-colour: the
 * terminals that would benefit already render these, and the terminals that
 * would not are exactly the ones this module is careful with.
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
 */
const GLYPHS = Object.freeze({
  unicode: Object.freeze({
    ok: "✓",
    info: "·",
    warn: "▲",
    bad: "✗",
    dash: "—",
    ellipsis: "…",
  }),
  ascii: Object.freeze({
    ok: "+",
    info: "-",
    warn: "*",
    bad: "!",
    dash: "-",
    ellipsis: "...",
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
   * way.
   */
  const paint = (code) => (text) => (color ? `${code}${text}${SGR.reset}` : `${text}`);

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
