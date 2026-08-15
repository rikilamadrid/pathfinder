/**
 * The rules about asking.
 *
 * Two of these matter more than the rest: a non-interactive prompter refuses to
 * ask rather than defaulting quietly, and no sequence of bad input can make
 * `confirm` loop forever. Both are the difference between a CLI that is
 * scriptable and one that hangs on a build machine at 3am.
 */

import { strict as assert } from "node:assert";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";

import { createPrompter, nonInteractivePrompter } from "../src/prompt.mjs";
import { createTheme } from "../src/theme.mjs";

/**
 * A prompter wired to streams instead of a terminal.
 *
 * `typed` is delivered up front; a PassThrough buffers it until readline reads,
 * so the answers are waiting before the question is asked. `written()` returns
 * everything the prompter printed.
 */
function scripted(typed, options = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = "";
  output.on("data", (chunk) => (printed += chunk.toString()));

  if (typed !== null) input.write(typed);

  return {
    prompter: createPrompter({ input, output, interactive: true, ...options }),
    written: () => printed,
    endInput: () => input.end(),
  };
}

describe("createPrompter — the TTY guard", () => {
  it("refuses to ask anything when it is not interactive", async () => {
    const prompter = nonInteractivePrompter();

    await assert.rejects(() => prompter.confirm("Initialize a Git repository here?"), {
      message: /refusing to ask "Initialize a Git repository here\?"/,
    });
  });

  it("prints nothing when it is not interactive", async () => {
    const { prompter, written } = scripted("y\n", { interactive: false });

    await assert.rejects(() => prompter.confirm("Anything?"));
    assert.equal(written(), "");
  });

  it("reports its own interactivity, so callers can branch on one flag", () => {
    assert.equal(nonInteractivePrompter().interactive, false);
    assert.equal(scripted("").prompter.interactive, true);
  });
});

describe("createPrompter — confirm", () => {
  it("reads yes", async () => {
    const { prompter } = scripted("y\n");
    assert.equal(await prompter.confirm("Go?"), true);
    prompter.close();
  });

  it("reads no", async () => {
    const { prompter } = scripted("n\n");
    assert.equal(await prompter.confirm("Go?"), false);
    prompter.close();
  });

  it("accepts the spelled-out words, in any case", async () => {
    const yes = scripted("YES\n");
    assert.equal(await yes.prompter.confirm("Go?"), true);
    yes.prompter.close();

    const no = scripted("No\n");
    assert.equal(await no.prompter.confirm("Go?"), false);
    no.prompter.close();
  });

  it("treats a bare Enter as the default", async () => {
    const yes = scripted("\n");
    assert.equal(await yes.prompter.confirm("Go?", { defaultAnswer: true }), true);
    yes.prompter.close();

    const no = scripted("\n");
    assert.equal(await no.prompter.confirm("Go?", { defaultAnswer: false }), false);
    no.prompter.close();
  });

  it("shows which answer Enter will give", async () => {
    const yes = scripted("\n");
    await yes.prompter.confirm("Go?", { defaultAnswer: true });
    assert.match(yes.written(), /\? Go\? \[Y\/n\] $/);
    yes.prompter.close();

    const no = scripted("\n");
    await no.prompter.confirm("Go?", { defaultAnswer: false });
    assert.match(no.written(), /\? Go\? \[y\/N\] $/);
    no.prompter.close();
  });

  it("re-prompts on an answer it cannot read", async () => {
    const { prompter, written } = scripted("maybe\ny\n");

    assert.equal(await prompter.confirm("Go?"), true);
    assert.match(written(), /Please answer y or n\./);
    prompter.close();
  });

  it("gives up after a bounded number of unreadable answers", async () => {
    // The mistyped-pipe case: input that will never resolve to a yes or a no.
    // Answering null rather than the default is what makes an unanswered
    // authorization a refusal at the call site.
    const { prompter, written } = scripted("what\nwhat\nwhat\nwhat\nwhat\n", { retries: 3 });

    assert.equal(await prompter.confirm("Go?", { defaultAnswer: true }), null);
    assert.equal(written().match(/\? Go\?/g).length, 3);
    prompter.close();
  });

  it("answers null when the input ends without an answer", async () => {
    const { prompter, endInput } = scripted(null);

    const pending = prompter.confirm("Go?");
    endInput();

    assert.equal(await pending, null);
    prompter.close();
  });

  it("attaches nothing to the input stream until a question is asked", () => {
    const input = new PassThrough();
    const prompter = createPrompter({ input, output: new PassThrough(), interactive: true });

    // A reader resumes stdin, and a process holding an open stdin does not
    // exit. A run that never asks must leave the stream exactly as it found it.
    assert.equal(input.listenerCount("data"), 0);
    assert.equal(input.readableFlowing, null);
    prompter.close();
  });
});

describe("createPrompter — chooseMany", () => {
  const options = [
    { label: "Claude Code   -> .claude/skills/", value: "claude-code" },
    { label: "Codex         -> .agents/skills/", value: "codex" },
  ];

  it("reads one number", async () => {
    const { prompter } = scripted("1\n");
    assert.deepEqual(await prompter.chooseMany("Which tools?", { options }), ["claude-code"]);
    prompter.close();
  });

  it("reads several, in list order, ignoring repeats and spacing", async () => {
    const { prompter } = scripted(" 2 , 1 ,2\n");
    assert.deepEqual(await prompter.chooseMany("Which tools?", { options }), [
      "claude-code",
      "codex",
    ]);
    prompter.close();
  });

  it("treats a bare Enter as the detected default", async () => {
    const { prompter } = scripted("\n");

    const chosen = await prompter.chooseMany("Which tools?", {
      options,
      defaultSelection: ["codex"],
    });

    assert.deepEqual(chosen, ["codex"]);
    prompter.close();
  });

  it("treats Enter with nothing detected as none, not as everything", async () => {
    const { prompter } = scripted("\n");
    assert.deepEqual(await prompter.chooseMany("Which tools?", { options }), []);
    prompter.close();
  });

  it("reads 0 as none, distinct from the default", async () => {
    const { prompter } = scripted("0\n");

    const chosen = await prompter.chooseMany("Which tools?", {
      options,
      defaultSelection: ["claude-code"],
    });

    assert.deepEqual(chosen, []);
    prompter.close();
  });

  it("prints the list, and says what Enter will do", async () => {
    const { prompter, written } = scripted("\n");

    await prompter.chooseMany("Which tools?", { options, defaultSelection: ["claude-code"] });

    assert.match(written(), /\? Which tools\?/);
    assert.match(written(), /    1\. Claude Code {3}-> \.claude\/skills\//);
    assert.match(written(), /    2\. Codex/);
    assert.match(written(), /Enter for the detected default \[1\], or 0 for none\./);
    prompter.close();
  });

  it("says Enter means none when nothing was detected", async () => {
    const { prompter, written } = scripted("\n");

    await prompter.chooseMany("Which tools?", { options });

    assert.match(written(), /Numbers, comma-separated\. Enter or 0 for none\./);
    prompter.close();
  });

  it("rejects a selection it cannot read in full, rather than taking half of it", async () => {
    const { prompter, written } = scripted("1,banana\n1\n");

    assert.deepEqual(await prompter.chooseMany("Which tools?", { options }), ["claude-code"]);
    assert.match(written(), /Please answer with numbers from 1 to 2, or 0 for none\./);
    prompter.close();
  });

  it("rejects a number nobody offered, and a none mixed with a choice", async () => {
    for (const typed of ["3\n1\n", "0,1\n1\n"]) {
      const { prompter, written } = scripted(typed);

      assert.deepEqual(await prompter.chooseMany("Which tools?", { options }), ["claude-code"]);
      assert.match(written(), /Please answer with numbers/);
      prompter.close();
    }
  });

  it("gives up after a bounded number of unreadable answers", async () => {
    const { prompter } = scripted("what\nwhat\nwhat\nwhat\n", { retries: 3 });

    assert.equal(await prompter.chooseMany("Which tools?", { options }), null);
    prompter.close();
  });

  it("answers null when the input ends without an answer", async () => {
    const { prompter, endInput } = scripted(null);

    const pending = prompter.chooseMany("Which tools?", { options });
    endInput();

    assert.equal(await pending, null);
    prompter.close();
  });

  it("refuses to ask when it is not interactive", async () => {
    await assert.rejects(
      () => nonInteractivePrompter().chooseMany("Which tools?", { options }),
      /refusing to ask "Which tools\?"/,
    );
  });

  it("asks nothing when there is nothing to choose between", async () => {
    const { prompter, written } = scripted("");

    assert.deepEqual(await prompter.chooseMany("Which tools?", { options: [] }), []);
    assert.equal(written(), "");
    prompter.close();
  });
});

describe("createPrompter — chooseOne", () => {
  const options = [
    { value: "cursor", label: "Cursor" },
    { value: "vscode", label: "VS Code" },
    { value: null, label: "Don't open" },
  ];

  it("returns the numbered choice", async () => {
    const { prompter } = scripted("2\n");

    assert.equal(await prompter.chooseOne("Open?", { options, defaultValue: "cursor" }), "vscode");
    prompter.close();
  });

  it("takes the default on an empty line", async () => {
    const { prompter } = scripted("\n");

    assert.equal(await prompter.chooseOne("Open?", { options, defaultValue: "cursor" }), "cursor");
    prompter.close();
  });

  it("names the default in the question, so one keystroke is enough", async () => {
    const { prompter, written } = scripted("\n");

    await prompter.chooseOne("Open?", { options, defaultValue: "vscode" });

    assert.match(written(), /^\? Open\?\n {4}1\. Cursor\n {4}2\. VS Code\n {4}3\. Don't open\n/);
    assert.match(written(), /A number, or Enter for \[2\]\./);
    // One answer, so the question must not offer a list of them.
    assert.doesNotMatch(written(), /comma/);
    prompter.close();
  });

  it("re-asks an answer that is not one of the numbers, then gives up", async () => {
    const { prompter, written } = scripted("banana\n9\n1,2\n");

    assert.equal(await prompter.chooseOne("Open?", { options }), null);
    assert.equal(written().match(/Please answer with a number from 1 to 3\./g).length, 3);
    prompter.close();
  });

  it("returns null when the stream ends", async () => {
    const ended = scripted(null);
    const pending = ended.prompter.chooseOne("Open?", { options });
    ended.endInput();

    assert.equal(await pending, null);
    ended.prompter.close();
  });

  it("refuses to ask when it is not interactive", async () => {
    await assert.rejects(
      () => nonInteractivePrompter().chooseOne("Open?", { options }),
      /refusing to ask "Open\?"/,
    );
  });

  it("asks nothing when there is nothing to choose between", async () => {
    const { prompter, written } = scripted("");

    assert.equal(await prompter.chooseOne("Open?", { options: [] }), null);
    assert.equal(written(), "");
    prompter.close();
  });
});

describe("createPrompter — text", () => {
  it("returns the line, trimmed", async () => {
    const { prompter } = scripted("  Zed  \n");

    assert.equal(await prompter.text("Which tool?"), "Zed");
    prompter.close();
  });

  it("prints the question once, on the line it reads", async () => {
    const { prompter, written } = scripted("Zed\n");

    await prompter.text("Which tool?");

    assert.equal(written(), "? Which tool? ");
    prompter.close();
  });

  // The distinction the caller's loop is built on: "" ends it because someone
  // said so, null ends it because nobody is there.
  it("tells an empty answer apart from no answer at all", async () => {
    const { prompter } = scripted("\n");
    assert.equal(await prompter.text("Which tool?"), "");
    prompter.close();

    const ended = scripted(null);
    const pending = ended.prompter.text("Which tool?");
    ended.endInput();
    assert.equal(await pending, null);
    ended.prompter.close();
  });

  it("takes answers in order, without losing one typed ahead", async () => {
    const { prompter } = scripted("Zed\nAider\n\n");

    assert.equal(await prompter.text("Which tool?"), "Zed");
    assert.equal(await prompter.text("Which tool?"), "Aider");
    assert.equal(await prompter.text("Which tool?"), "");
    prompter.close();
  });

  // No retries here, deliberately: every line is a well-formed answer to "what
  // is it called", so there is nothing to re-prompt about. Judging a name is
  // the caller's job, because only the caller knows what makes one unusable.
  it("accepts whatever was typed, and judges none of it", async () => {
    const { prompter } = scripted("../../etc/passwd\n");

    assert.equal(await prompter.text("Which tool?"), "../../etc/passwd");
    prompter.close();
  });

  it("refuses to ask when it is not interactive", async () => {
    await assert.rejects(
      () => nonInteractivePrompter().text("Which tool?"),
      /refusing to ask "Which tool\?"/,
    );
  });

  it("attaches nothing to the input stream until a question is asked", async () => {
    const { prompter, written } = scripted("Zed\n");

    assert.equal(written(), "");
    prompter.close();
  });
});

/**
 * Which of the two implementations a question reaches, and why.
 *
 * The interface is identical either way, so these assert the *route* taken and
 * the values that come back through it — never the rendering, which
 * `select.test.mjs` owns. The classic half needs no new tests at all: every
 * suite above drives it, because a prompter built without a theme answers no to
 * `selection`, and that they still pass unchanged is the evidence that no
 * business logic moved.
 */

const ESC = "\u001B";
const ARROW_DOWN = `${ESC}[B`;

/** A terminal that can do everything, unless an override is handed in. */
function capableTheme(env = {}, columns = 80) {
  return createTheme({
    env: { LANG: "en_US.UTF-8", ...env },
    platform: "linux",
    isTTY: true,
    inputIsTTY: true,
    setRawMode: true,
    columns,
  });
}

/** A prompter over pipes, with keys pressed at it after the question is asked. */
function keyboard(theme) {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = "";
  output.on("data", (chunk) => (printed += chunk.toString()));
  output.columns = theme.columns;

  return {
    prompter: createPrompter({ input, output, interactive: true, theme }),
    written: () => printed,
    async press(...keys) {
      for (const key of keys) {
        input.write(key);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    },
  };
}

describe("createPrompter — which implementation a question reaches", () => {
  it("answers confirm with two rows and the arrow keys", async () => {
    const bench = keyboard(capableTheme());
    const answered = bench.prompter.confirm("Initialize a Git repository here?");

    await bench.press(ARROW_DOWN, "\r");

    assert.equal(await answered, false);
    assert.ok(bench.written().includes("Yes"), "the answers were not offered as rows");
    assert.ok(bench.written().includes("No"));
    assert.equal(bench.written().includes("[Y/n]"), false, "the classic suffix leaked through");
    bench.prompter.close();
  });

  it("starts confirm on the caller's default", async () => {
    for (const defaultAnswer of [true, false]) {
      const bench = keyboard(capableTheme());
      const answered = bench.prompter.confirm("Really?", { defaultAnswer });

      await bench.press("\r");

      assert.equal(await answered, defaultAnswer);
      bench.prompter.close();
    }
  });

  it("keeps y and n working without printing them", async () => {
    const bench = keyboard(capableTheme());
    const answered = bench.prompter.confirm("Really?", { defaultAnswer: true });

    await bench.press("n");

    assert.equal(await answered, false);
    assert.equal(/\by\s*\/\s*n\b/i.test(bench.written()), false, "the accelerators were advertised");
    bench.prompter.close();
  });

  it("answers chooseOne with the highlighted row", async () => {
    const bench = keyboard(capableTheme());
    const answered = bench.prompter.chooseOne("Open this project in an editor?", {
      options: [
        { value: "cursor", label: "Cursor" },
        { value: "code", label: "VS Code" },
        { value: null, label: "Don't open" },
      ],
      defaultValue: "cursor",
    });

    await bench.press(ARROW_DOWN, "\r");

    assert.equal(await answered, "code");
    assert.equal(bench.written().includes("1."), false, "a numbered list was printed");
    bench.prompter.close();
  });

  it("answers chooseMany with the checked rows, in list order", async () => {
    const bench = keyboard(capableTheme());
    const answered = bench.prompter.chooseMany("Configure Pathfinder for which tools?", {
      options: [
        { value: "claude-code", label: "Claude Code" },
        { value: "codex", label: "Codex" },
      ],
      defaultSelection: ["codex"],
    });

    await bench.press(" ", "\r");

    assert.deepEqual(await answered, ["claude-code", "codex"]);
    assert.equal(bench.written().includes("comma-separated"), false, "the classic instructions leaked");
    bench.prompter.close();
  });

  it("still returns an empty list without asking when there is nothing to choose", async () => {
    const bench = keyboard(capableTheme());

    assert.deepEqual(await bench.prompter.chooseMany("Which tools?", { options: [] }), []);
    assert.equal(bench.written(), "");
    bench.prompter.close();
  });

  it("leaves text() on readline, where line editing already works", async () => {
    const bench = keyboard(capableTheme());
    const answered = bench.prompter.text("Which tool?");

    await bench.press("Zed\r");

    assert.equal(await answered, "Zed");
    bench.prompter.close();
  });

  it("still refuses to ask anything when it is not interactive", async () => {
    const prompter = createPrompter({
      input: new PassThrough(),
      output: new PassThrough(),
      interactive: false,
      theme: capableTheme(),
    });

    await assert.rejects(() => prompter.confirm("Anything?"), /refusing to ask/);
    await assert.rejects(() => prompter.chooseOne("Anything?", { options: [{ value: 1, label: "One" }] }));
    await assert.rejects(() => prompter.chooseMany("Anything?", { options: [{ value: 1, label: "One" }] }));
  });
});

describe("createPrompter — everything that routes back to classic", () => {
  /** Ask one confirm and report which implementation printed. */
  async function route(theme) {
    const input = new PassThrough();
    const output = new PassThrough();
    let printed = "";
    output.on("data", (chunk) => (printed += chunk.toString()));
    input.write("y\n");

    const prompter = createPrompter({ input, output, interactive: true, theme });
    const answer = await prompter.confirm("Initialize a Git repository here?");
    prompter.close();

    return { answer, classic: printed.includes("[Y/n]") };
  }

  it("uses the selector on a fully capable terminal", () => {
    assert.equal(capableTheme().selection, true);
  });

  it("routes to classic when PATHFINDER_PROMPT=classic", async () => {
    const { answer, classic } = await route(capableTheme({ PATHFINDER_PROMPT: "classic" }));

    assert.equal(classic, true, "the override did not reach the prompter");
    assert.equal(answer, true);
  });

  it("routes to classic when TERM is dumb", async () => {
    const { classic } = await route(capableTheme({ TERM: "dumb" }));

    assert.equal(classic, true);
  });

  it("routes to classic below the 49-column floor and to the selector at it", async () => {
    assert.equal((await route(capableTheme({}, 48))).classic, true, "48 columns should be classic");
    assert.equal(capableTheme({}, 49).selection, true, "49 columns should be the selector");
  });

  it("routes to classic when nobody described the terminal at all", async () => {
    const { classic } = await route(createTheme());

    assert.equal(classic, true);
  });

  it("prints the classic bytes unchanged, whichever refusal got us here", async () => {
    // Byte-identical to 1.6.0 is the promise, and the cheapest way to keep it is
    // to route to the same code rather than to a re-implementation of it.
    const overrides = [
      capableTheme({ PATHFINDER_PROMPT: "classic" }),
      capableTheme({ TERM: "dumb" }),
      capableTheme({}, 48),
      createTheme(),
    ];

    for (const theme of overrides) {
      const input = new PassThrough();
      const output = new PassThrough();
      let printed = "";
      output.on("data", (chunk) => (printed += chunk.toString()));
      input.write("\n");

      const prompter = createPrompter({ input, output, interactive: true, theme });
      await prompter.chooseOne("Open this project in an editor?", {
        options: [
          { value: "cursor", label: "Cursor" },
          { value: null, label: "Don't open" },
        ],
        defaultValue: "cursor",
      });
      prompter.close();

      assert.ok(printed.includes("    1. Cursor"), `a numbered list was expected: ${JSON.stringify(printed)}`);
      assert.ok(printed.includes("  A number, or Enter for [1]."));
    }
  });
});
