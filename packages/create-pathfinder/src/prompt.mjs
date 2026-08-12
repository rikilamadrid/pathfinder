/**
 * Asking a question, and the rules about when one may be asked at all.
 *
 * Two constraints shape everything here.
 *
 * The first is the TTY guard. A prompt is only ever offered when *both* stdin
 * and stdout are terminals, and that decision is made once, by the caller, and
 * carried on this object. A prompter built with `interactive: false` does not
 * ask a question quietly and default it — it throws, because a CLI that asks
 * nothing must also print nothing, and a guard bug that degrades silently would
 * show up as a script that hangs on someone's CI runner months later.
 *
 * The second is the decided interaction model: `node:readline` and printed
 * lines. No setRawMode, no keypress handler, no cursor control, no redraw. That
 * is what makes this work in a dumb terminal, over ssh, and inside an editor's
 * integrated console, and it is a decision rather than a default.
 *
 * Answers are bounded. Unparseable input is re-prompted a fixed number of times
 * and then gives up, so an input stream that will never produce a `y` cannot
 * spin forever. Giving up returns null rather than the default: null means
 * "nobody answered", and the caller decides what that is worth. For a question
 * that authorizes an action, it is worth a refusal.
 */

import { createInterface } from "node:readline";

const YES = new Set(["y", "yes"]);
const NO = new Set(["n", "no"]);

/**
 * A question-asker bound to one pair of streams.
 *
 * @param {{input: NodeJS.ReadableStream, output: NodeJS.WritableStream,
 *          interactive?: boolean, retries?: number}} options
 * @returns {{interactive: boolean,
 *            confirm: (question: string, options?: {defaultAnswer?: boolean}) => Promise<boolean|null>,
 *            close: () => void}}
 */
export function createPrompter({ input, output, interactive = false, retries = 3 }) {
  let reader = null;

  // Created on first use, not here. A run that never reaches a question — a
  // repository that already exists, `--help`, a bad flag — must not attach a
  // reader to stdin, because attaching one resumes the stream and a process
  // holding an open stdin does not exit on its own.
  function ensureReader() {
    if (reader === null) reader = createReader({ input, output });
    return reader;
  }

  return {
    interactive,

    async confirm(question, { defaultAnswer = true } = {}) {
      if (!interactive) {
        throw new Error(`refusing to ask "${question}": this prompter is not interactive`);
      }

      const suffix = defaultAnswer ? "[Y/n]" : "[y/N]";

      for (let attempt = 0; attempt < retries; attempt += 1) {
        const answer = await ensureReader().ask(`? ${question} ${suffix} `);

        // End of input. Ctrl-D, or a stream that closed under us.
        if (answer === null) return null;

        const normalized = answer.trim().toLowerCase();
        if (normalized === "") return defaultAnswer;
        if (YES.has(normalized)) return true;
        if (NO.has(normalized)) return false;

        output.write("  Please answer y or n.\n");
      }

      return null;
    },

    close() {
      if (reader !== null) {
        reader.close();
        reader = null;
      }
    },
  };
}

/**
 * A prompter that cannot be asked anything.
 *
 * What the CLI holds when there is no terminal on both ends, or when `--yes`
 * has already answered everything. Handing back a real object rather than null
 * keeps the call sites free of `prompter?.` — the guard is `interactive`, in
 * one place, and it reads as the rule it is.
 */
export function nonInteractivePrompter() {
  return createPrompter({ input: null, output: null, interactive: false });
}

/**
 * A line-at-a-time reader over one stream pair.
 *
 * Built on the `line` event rather than `readline.question`, which looks like
 * the obvious choice and is not: a line that arrives while no question is
 * outstanding is discarded, so the second `question` in a sequence — issued a
 * microtask later, because the first was awaited — waits forever for input that
 * was already delivered. Typing ahead, and any test that writes its answers up
 * front, would hang. Holding the lines here instead means input is never lost
 * between questions.
 *
 * `close` resolves every outstanding and future read as null. A prompt reached
 * with a closed stdin must fall through to the caller's decision about an
 * unanswered question, not hang.
 */
function createReader({ input, output }) {
  const readline = createInterface({ input, output });
  const delivered = [];
  const waiting = [];
  let closed = false;

  readline.on("line", (line) => {
    const resolve = waiting.shift();
    if (resolve) resolve(line);
    else delivered.push(line);
  });

  readline.on("close", () => {
    closed = true;
    while (waiting.length > 0) waiting.shift()(null);
  });

  return {
    /**
     * Print `text` and resolve with the next line, or null at end of input.
     *
     * The prompt goes through readline rather than straight to the stream so
     * that on a real terminal readline knows its width and can redraw the line
     * correctly when the user backspaces over what they typed.
     */
    ask(text) {
      readline.setPrompt(text);
      readline.prompt();

      if (delivered.length > 0) return Promise.resolve(delivered.shift());
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiting.push(resolve));
    },

    close() {
      readline.close();
    },
  };
}
