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
 * The second is the decided interaction model. ~~`node:readline` and printed
 * lines. No setRawMode, no keypress handler, no cursor control, no redraw.~~
 * **Superseded in Feature 23**, in two different ways, and the sentence was
 * partly wrong when it was written:
 *
 * - **"No setRawMode" was never true of the process**, only of this file.
 *   `node:readline` turns raw mode on itself the moment its input is a TTY, and
 *   turns it off again on `close()` — verified across five Node majors during
 *   the spike. What is true, and is now the load-bearing statement, is that
 *   **readline owns raw mode and Pathfinder never touches it.** The distinction
 *   matters: the first is a claim about terminal state that a reader could check
 *   and find false, and the second is the reason no interrupt can leave a
 *   terminal broken.
 * - **There is now a keypress handler and a redraw**, in `select.mjs`, borrowed
 *   from readline and given back. Which is a change of interaction, not of
 *   ownership.
 *
 * What has *not* changed is the reason the original sentence existed. The
 * line-based path still works in a dumb terminal, over a pipe, and on a CI
 * runner, and it is still here — every function below keeps its numbered/`y n`
 * implementation intact and reaches for it whenever `theme.selection` is false.
 * That is a supported way to use this tool, reachable deliberately with
 * `PATHFINDER_PROMPT=classic`, and not a fallback anyone should feel they have
 * been demoted to. `text()` never had anything to gain from a keypress loop and
 * is untouched.
 *
 * Answers are bounded. Unparseable input is re-prompted a fixed number of times
 * and then gives up, so an input stream that will never produce a `y` cannot
 * spin forever. Giving up returns null rather than the default: null means
 * "nobody answered", and the caller decides what that is worth. For a question
 * that authorizes an action, it is worth a refusal.
 */

import { createInterface } from "node:readline";

import { alignmentWidth, optionRow, select } from "./select.mjs";
import { createTheme } from "./theme.mjs";

const YES = new Set(["y", "yes"]);
const NO = new Set(["n", "no"]);

/**
 * A question-asker bound to one pair of streams.
 *
 * `theme` decides *how* a question is asked and nothing else. Every function
 * below returns the same values through either path, which is what lets the
 * choice be made here instead of at four call sites — and what lets the whole
 * existing test suite drive the classic path unchanged by simply not supplying
 * one. The default theme knows about no terminal at all, so it answers no to
 * `selection`, which is the conservative answer and the right one for a
 * prompter built from streams nobody has described.
 *
 * @param {{input: NodeJS.ReadableStream, output: NodeJS.WritableStream,
 *          interactive?: boolean, retries?: number, theme?: object}} options
 * @returns {{interactive: boolean,
 *            confirm: (question: string, options?: {defaultAnswer?: boolean}) => Promise<boolean|null>,
 *            chooseMany: (question: string, config?: object) => Promise<unknown[]|null>,
 *            chooseOne: (question: string, config?: object) => Promise<unknown|null>,
 *            text: (question: string) => Promise<string|null>,
 *            close: () => void}}
 */
export function createPrompter({
  input,
  output,
  interactive = false,
  retries = 3,
  theme = createTheme(),
}) {
  let reader = null;

  // Created on first use, not here. A run that never reaches a question — a
  // repository that already exists, `--help`, a bad flag — must not attach a
  // reader to stdin, because attaching one resumes the stream and a process
  // holding an open stdin does not exit on its own.
  function ensureReader() {
    if (reader === null) reader = createReader({ input, output, theme });
    return reader;
  }

  /**
   * Ask one question with the arrow keys.
   *
   * The Interface is handed over rather than a pair of streams, because the
   * selector's whole contract is that it borrows from an open readline and
   * gives it back. Nothing here consults `input.isTTY`: the decision was made
   * once, in the theme, and a module that re-derived it could disagree with the
   * one place that is allowed to have an opinion — and could not be tested over
   * a pipe at all.
   */
  const ask = (question, config) =>
    select({ readline: ensureReader().readline, theme, question, ...config });

  return {
    interactive,

    async confirm(question, { defaultAnswer = true } = {}) {
      if (!interactive) {
        throw new Error(`refusing to ask "${question}": this prompter is not interactive`);
      }

      // Two rows rather than a typed letter. `y` and `n` still work and are
      // deliberately not printed: the presented interaction is the one the hint
      // line describes, and an accelerator that has to be advertised is a second
      // thing to learn rather than a shortcut for people who already know it.
      if (theme.selection) {
        return ask(question, {
          options: [
            { label: "Yes", value: true, key: "y" },
            { label: "No", value: false, key: "n" },
          ],
          initial: [defaultAnswer],
        });
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

    /**
     * Ask which of a numbered list apply. Several answers, or none.
     *
     * Numbers rather than checkboxes, for the same reason `confirm` is a line
     * and not a keypress handler: no raw mode, no redraw, so it works in a dumb
     * terminal, over ssh, and inside an editor console. `Enter` takes the
     * default — which is what keeps the common case one keystroke — and `0` is
     * an explicit "none of them", distinct from an empty line that means "the
     * default", because a default of nothing and a choice of nothing should not
     * have to be told apart by their side effects.
     *
     * Returns the chosen options' `value`s in list order, or null when nobody
     * answered. Null is not an empty selection: the caller decides what an
     * unanswered question is worth.
     *
     * @param {string} question
     * @param {{options: {label: string, value: unknown}[], defaultSelection?: unknown[]}} config
     * @returns {Promise<unknown[]|null>}
     */
    async chooseMany(question, { options: choices = [], defaultSelection = [] } = {}) {
      if (!interactive) {
        throw new Error(`refusing to ask "${question}": this prompter is not interactive`);
      }
      if (choices.length === 0) return [];

      // A checkbox list, which is what this question always was. Note what does
      // *not* move: the caller still supplies `{label, value}` and still reads
      // back the chosen values in list order, so no decision about what the
      // options mean has crossed into this file.
      if (theme.selection) {
        return ask(question, { options: choices, multi: true, initial: defaultSelection });
      }

      const defaults = choices.filter((choice) => defaultSelection.includes(choice.value));
      const defaultNumbers = defaults.map((choice) => choices.indexOf(choice) + 1);

      // The same option grammar the selector uses, inside a numbered list
      // instead of a repainted block. An option that names the path it writes
      // to is not a decoration the keyboard path earned — it is the answer to
      // "what does checking this box do", and both paths owe it.
      const labelWidth = alignmentWidth(choices, theme);

      const header = [
        `? ${question}`,
        ...choices.map(
          (choice, index) => `    ${index + 1}. ${optionRow({ theme, option: choice, labelWidth })}`,
        ),
        defaultNumbers.length > 0
          ? `  Numbers, comma-separated. Enter for the detected default [${defaultNumbers.join(",")}], or 0 for none.`
          : "  Numbers, comma-separated. Enter or 0 for none.",
        "",
      ].join("\n");

      output.write(header);

      for (let attempt = 0; attempt < retries; attempt += 1) {
        const answer = await ensureReader().ask("> ");
        if (answer === null) return null;

        const normalized = answer.trim();
        if (normalized === "") return defaults.map((choice) => choice.value);

        const selected = parseSelection(normalized, choices.length);
        if (selected !== null) return selected.map((index) => choices[index].value);

        output.write(`  Please answer with numbers from 1 to ${choices.length}, or 0 for none.\n`);
      }

      return null;
    },

    /**
     * Ask which one of a numbered list. Exactly one, or none.
     *
     * The same lines-and-numbers shape as `chooseMany`, and separate from it on
     * purpose: a question with one answer must not print "comma-separated" and
     * must not have to decide what `1,2` meant. A caller that wants "none" as a
     * possibility supplies it as an option, because a list of editors and a
     * decision not to open one read better as three rows than as a rule.
     *
     * Returns the chosen option's `value`, or null when nobody answered. An
     * option whose value is null and an unanswered question are indistinguishable
     * here, which is correct for every question worth asking this way: both mean
     * nothing should happen.
     *
     * @param {string} question
     * @param {{options: {label: string, value: unknown}[], defaultValue?: unknown}} config
     * @returns {Promise<unknown|null>}
     */
    async chooseOne(question, { options: choices = [], defaultValue } = {}) {
      if (!interactive) {
        throw new Error(`refusing to ask "${question}": this prompter is not interactive`);
      }
      if (choices.length === 0) return null;

      const fallback = choices.find((choice) => choice.value === defaultValue) ?? choices[0];

      // The default becomes the highlighted row rather than a number in a
      // sentence, so taking it still costs one keystroke.
      if (theme.selection) {
        return ask(question, { options: choices, initial: [fallback.value] });
      }

      const defaultNumber = choices.indexOf(fallback) + 1;
      const labelWidth = alignmentWidth(choices, theme);

      output.write(
        [
          `? ${question}`,
          ...choices.map(
            (choice, index) => `    ${index + 1}. ${optionRow({ theme, option: choice, labelWidth })}`,
          ),
          `  A number, or Enter for [${defaultNumber}].`,
          "",
        ].join("\n"),
      );

      for (let attempt = 0; attempt < retries; attempt += 1) {
        const answer = await ensureReader().ask("> ");
        if (answer === null) return null;

        const normalized = answer.trim();
        if (normalized === "") return fallback.value;

        if (/^\d+$/.test(normalized)) {
          const number = Number(normalized);
          if (number >= 1 && number <= choices.length) return choices[number - 1].value;
        }

        output.write(`  Please answer with a number from 1 to ${choices.length}.\n`);
      }

      return null;
    },

    /**
     * Ask for a line of free text. Whatever they typed, or null.
     *
     * Deliberately the thinnest of the three: no retries, no default, no
     * validation. There is nothing here to re-prompt *about* — any line is a
     * well-formed answer to "what is it called" — so judging one is the
     * caller's job, and only the caller knows what makes a name unusable.
     *
     * An empty line comes back as `""` and is a real answer, distinct from the
     * `null` of a stream that ended. A caller looping for several values reads
     * the first as "done" and the second as "nobody is there", which happen to
     * lead to the same place but for different reasons.
     */
    async text(question) {
      if (!interactive) {
        throw new Error(`refusing to ask "${question}": this prompter is not interactive`);
      }

      const answer = await ensureReader().ask(`? ${question} `);
      return answer === null ? null : answer.trim();
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
 * Read a comma-separated list of numbers, or null if any part of it is not one.
 *
 * All-or-nothing on purpose. Taking the valid half of `1,banana` would act on a
 * selection the user did not make, and this question decides what gets written
 * into their project. Duplicates collapse and order follows the list, so `2,1`
 * and `1,2,2` mean the same thing.
 *
 * `0` means none, and only on its own: `0,1` is a contradiction, not a subset.
 */
function parseSelection(input, count) {
  const parts = input.split(",").map((part) => part.trim());
  if (parts.some((part) => !/^\d+$/.test(part))) return null;

  const numbers = parts.map(Number);
  if (numbers.includes(0)) return numbers.every((number) => number === 0) ? [] : null;
  if (numbers.some((number) => number > count)) return null;

  return [...new Set(numbers)].sort((a, b) => a - b).map((number) => number - 1);
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
function createReader({ input, output, theme }) {
  // `terminal` is forced only where the selector will run, and only ever from
  // false to true. On a real terminal readline works this out for itself and
  // the flag changes nothing; over a pipe it is what makes the keypress decoder
  // exist at all, which is the difference between a selector that can be tested
  // and one that can only be tried. It is never forced *off*, so no classic run
  // has its line editing altered by this.
  const readline = createInterface(
    theme?.selection ? { input, output, terminal: true } : { input, output },
  );
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
    // The Interface itself, for the one caller that needs the *owner* rather
    // than a line: the selector borrows this object's listeners and hands them
    // back. Exposed rather than re-created, because a second Interface over the
    // same stdin would be a second thing turning raw mode on and off.
    readline,

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
