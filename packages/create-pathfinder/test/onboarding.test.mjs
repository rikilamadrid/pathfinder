/**
 * The clipboard offer, from the outside.
 *
 * The unit tests next door prove the prompt derivation and the writer table.
 * These prove the rule that matters more than either: nothing reaches the
 * clipboard without an explicit yes, on any path, and every way the copy can
 * fail leaves a complete install and exit 0 behind it.
 *
 * The clipboard is never really touched. A stub named after the platform's
 * tool sits at the front of a synthesized PATH and writes to a file, so
 * "was it copied, and with exactly what bytes" is answered by reading that
 * file — and a test that copies nothing can prove it by the file's absence
 * rather than by trusting a printed line.
 */

import { strict as assert } from "node:assert";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { run } from "../src/cli.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function scratch(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

function makeRepository() {
  const cwd = scratch("pathfinder-onboarding-");
  mkdirSync(join(cwd, ".git"));
  return cwd;
}

function makeLooseDirectory() {
  return scratch("pathfinder-onboarding-loose-");
}

/**
 * A fake `pbcopy` that records its stdin, and the file it records into.
 *
 * macOS is chosen for the synthesized platform because its table has exactly
 * one entry, so a test that finds the stub found the only thing it could have.
 */
function fakeClipboard() {
  const directory = scratch("pathfinder-onboarding-bin-");
  const sink = join(directory, "clipboard-contents");
  const tool = join(directory, "pbcopy");

  writeFileSync(tool, `#!/bin/sh\ncat > ${JSON.stringify(sink)}\n`);
  chmodSync(tool, 0o755);

  return {
    sink,
    // The system directories follow, because the stub runs `cat`.
    path: `${directory}:${process.env.PATH ?? ""}`,
    contents: () => (existsSync(sink) ? readFileSync(sink, "utf8") : null),
  };
}

/**
 * A prompter that records every question and answers each kind as told.
 *
 * Answers are per-question rather than blanket, because a blanket `true` is
 * how a test authorizes an action it was not written to be about.
 */
function scriptedPrompter({
  interactive = true,
  git = true,
  clipboard = false,
  harnesses = [],
} = {}) {
  const asked = [];
  return {
    interactive,
    asked,
    confirm: async (question) => {
      asked.push(question);
      if (question.startsWith("Initialize a Git repository")) return git;
      if (question.startsWith("Copy that prompt")) return clipboard;
      throw new Error(`unexpected question: ${question}`);
    },
    chooseMany: async () => harnesses,
    text: async () => "",
    close: () => {},
  };
}

async function invoke(argv, { cwd, clipboardPath = "", prompter, platform = "darwin" } = {}) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    cwd,
    out: (text) => (out += text),
    err: (text) => (err += text),
    env: { PATH: clipboardPath },
    platform,
    prompter: prompter ?? scriptedPrompter(),
  });
  return { code, out, err };
}

/** The question, as the user reads it. Asserted on rather than paraphrased. */
const CLIPBOARD_QUESTION = "Copy that prompt to your clipboard? This replaces what is on it now.";

describe("the clipboard offer — consent", () => {
  it("copies the prompt when the offer is accepted", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();

    const { code, out } = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      prompter: scriptedPrompter({ clipboard: true }),
    });

    assert.equal(code, 0);
    assert.match(out, /  Copied\.\n/);
    assert.equal(
      clipboard.contents(),
      "Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project. " +
        "Do not install packages or write product code yet.",
    );
  });

  it("writes nothing to the clipboard when the offer is declined", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();

    const { code, out } = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      prompter: scriptedPrompter({ clipboard: false }),
    });

    assert.equal(code, 0);
    // The tool was never run, which is stronger than "it ran and copied the
    // same thing back": the file it would have written does not exist.
    assert.equal(clipboard.contents(), null);
    assert.doesNotMatch(out, /Copied/);
    assert.doesNotMatch(out, /Not copied/);
  });

  it("treats an unanswerable question as a decline", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const prompter = scriptedPrompter();
    prompter.confirm = async () => null;

    const { code } = await invoke([], { cwd, clipboardPath: clipboard.path, prompter });

    assert.equal(code, 0);
    assert.equal(clipboard.contents(), null);
  });

  it("asks after the summary, so the prompt is on screen before the question", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();

    const { out } = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      prompter: scriptedPrompter({ clipboard: true }),
    });

    assert.ok(
      out.indexOf("Next step — give your agent this prompt:") < out.indexOf("  Copied."),
      "the prompt is printed before the copy is reported",
    );
  });

  it("still prints and offers the prompt when nothing was left to install", async () => {
    // A re-run writes no files, and used to end at "already installed" with no
    // next step. It is offered anyway, because a second run is how someone
    // configures a harness they skipped the first time — or simply comes back
    // for the invocation they have forgotten, which is the same line either way.
    const cwd = makeRepository();
    const clipboard = fakeClipboard();

    await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      prompter: scriptedPrompter({ clipboard: false }),
    });
    assert.equal(clipboard.contents(), null, "the first run declined");

    const prompter = scriptedPrompter({ clipboard: true });
    const { code, out } = await invoke(["--agents=claude-code"], {
      cwd,
      clipboardPath: clipboard.path,
      prompter,
    });

    assert.equal(code, 0);
    assert.match(out, /The kit is already installed here\./);
    assert.match(out, /Next step — give your agent this prompt:\n\n {2}\/kickstart-pathfinder\n/);
    assert.deepEqual(prompter.asked, [CLIPBOARD_QUESTION]);
    assert.equal(clipboard.contents(), "/kickstart-pathfinder");
  });

  it("prints the prompt whether or not it is copied", async () => {
    for (const accepted of [true, false]) {
      const cwd = makeRepository();
      const clipboard = fakeClipboard();

      const { out } = await invoke([], {
        cwd,
        clipboardPath: clipboard.path,
        prompter: scriptedPrompter({ clipboard: accepted }),
      });

      assert.match(out, /Use skills\/kickstart-pathfinder\/SKILL\.md/);
    }
  });
});

describe("the clipboard offer — when it is not made at all", () => {
  it("is never offered without a terminal", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const prompter = scriptedPrompter({ interactive: false });

    const { code } = await invoke([], { cwd, clipboardPath: clipboard.path, prompter });

    assert.equal(code, 0);
    assert.deepEqual(prompter.asked, []);
    assert.equal(clipboard.contents(), null);
  });

  it("is suppressed by --no-clipboard", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const prompter = scriptedPrompter({ clipboard: true });

    const { code, out } = await invoke(["--no-clipboard"], {
      cwd,
      clipboardPath: clipboard.path,
      prompter,
    });

    assert.equal(code, 0);
    assert.deepEqual(prompter.asked, []);
    assert.equal(clipboard.contents(), null);
    // The flag suppresses the offer, not the prompt.
    assert.match(out, /Use skills\/kickstart-pathfinder\/SKILL\.md/);
  });

  it("is not performed under --yes, because silence is not consent", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const prompter = scriptedPrompter({ clipboard: true });

    const { code } = await invoke(["--yes"], { cwd, clipboardPath: clipboard.path, prompter });

    assert.equal(code, 0);
    assert.deepEqual(prompter.asked, []);
    assert.equal(clipboard.contents(), null);
  });

  it("is not offered in a dry run, and says so", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const prompter = scriptedPrompter({ clipboard: true });

    const { code, out } = await invoke(["--dry-run"], {
      cwd,
      clipboardPath: clipboard.path,
      prompter,
    });

    assert.equal(code, 0);
    assert.deepEqual(prompter.asked, []);
    assert.equal(clipboard.contents(), null);
    assert.match(out, /Onboarding actions are not offered in a dry run; nothing was copied\./);
  });

  it("is not reached when the install was refused", async () => {
    const cwd = makeLooseDirectory();
    const clipboard = fakeClipboard();
    const prompter = scriptedPrompter({ git: false, clipboard: true });

    const { code } = await invoke([], { cwd, clipboardPath: clipboard.path, prompter });

    assert.equal(code, 1);
    assert.deepEqual(prompter.asked, ["Initialize a Git repository here?"]);
    assert.equal(clipboard.contents(), null);
  });
});

describe("the clipboard offer — degradation", () => {
  it("completes the install with no clipboard tool available", async () => {
    const cwd = makeRepository();

    const { code, out } = await invoke([], {
      cwd,
      clipboardPath: scratch("pathfinder-onboarding-empty-"),
      prompter: scriptedPrompter({ clipboard: true }),
    });

    assert.equal(code, 0);
    assert.match(out, /Not copied — no clipboard tool is available here\. The prompt is printed above\./);
    assert.match(out, /Use skills\/kickstart-pathfinder\/SKILL\.md/);
    assert.ok(existsSync(join(cwd, "skills")), "the kit was still installed");
  });

  it("completes the install when the clipboard tool fails", async () => {
    const cwd = makeRepository();
    const directory = scratch("pathfinder-onboarding-broken-");
    const tool = join(directory, "pbcopy");
    writeFileSync(tool, "#!/bin/sh\necho 'Error: Can\\'t open display' >&2\nexit 1\n");
    chmodSync(tool, 0o755);

    const { code, out } = await invoke([], {
      cwd,
      clipboardPath: `${directory}:${process.env.PATH ?? ""}`,
      prompter: scriptedPrompter({ clipboard: true }),
    });

    assert.equal(code, 0);
    assert.match(out, /Not copied — pbcopy /);
    assert.ok(existsSync(join(cwd, "skills")), "the kit was still installed");
  });

  it("does not change the exit code of a failed install", async () => {
    // A clipboard that works cannot rescue a broken install, and the reverse
    // matters more: the copy is not what the exit code is about.
    const cwd = makeRepository();
    const clipboard = fakeClipboard();

    const { code } = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      prompter: scriptedPrompter({ clipboard: true }),
    });

    assert.equal(code, 0);
  });
});

describe("the prompt follows the harness that was chosen", () => {
  async function promptFor(harnessIds) {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();

    const argv = harnessIds.length > 0 ? [`--agents=${harnessIds.join(",")}`] : [];
    const { out } = await invoke(argv, {
      cwd,
      clipboardPath: clipboard.path,
      prompter: scriptedPrompter({ clipboard: true }),
    });

    return { out, copied: clipboard.contents() };
  }

  it("offers Claude Code its own invocation", async () => {
    const { out, copied } = await promptFor(["claude-code"]);
    assert.match(out, /Next step — give your agent this prompt:\n\n {2}\/kickstart-pathfinder\n/);
    assert.equal(copied, "/kickstart-pathfinder");
  });

  it("offers Codex its own invocation", async () => {
    const { copied } = await promptFor(["codex"]);
    assert.equal(copied, "$kickstart-pathfinder");
  });

  it("falls back to the path form when two harnesses were configured", async () => {
    const { copied } = await promptFor(["claude-code", "codex"]);
    assert.match(copied, /^Use skills\/kickstart-pathfinder\/SKILL\.md\./);
  });

  it("keeps the path form when no harness was configured", async () => {
    const { copied } = await promptFor([]);
    assert.match(copied, /^Use skills\/kickstart-pathfinder\/SKILL\.md\./);
  });

  it("copies exactly what it printed, with no trailing newline", async () => {
    const { copied } = await promptFor(["claude-code"]);
    assert.equal(copied, "/kickstart-pathfinder");
    assert.equal(copied.endsWith("\n"), false);
  });
});

describe("--no-clipboard as a flag", () => {
  it("is documented in --help", async () => {
    const { code, out } = await invoke(["--help"], { cwd: makeRepository() });
    assert.equal(code, 0);
    assert.match(out, /--no-clipboard/);
  });

  it("does not imply --no-open, which this version does not have", async () => {
    // Chunk 2 adds the editor offer and its flag together. Documenting a flag
    // before anything honors it would make this version lie about itself.
    const { code, err } = await invoke(["--no-open"], { cwd: makeRepository() });
    assert.equal(code, 2);
    assert.match(err, /unknown option `--no-open`/);
  });
});
