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
