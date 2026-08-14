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
import { kickstartPrompt } from "../src/kickstart-prompt.mjs";

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

  // `/bin/cat` by absolute path, so the synthesized PATH can be this directory
  // and nothing else. That matters more than it looks: PATH is now also what
  // decides whether an editor is detected, and a suite that inherited the real
  // one would ask about the editors installed on whichever machine ran it.
  writeFileSync(tool, `#!/bin/sh\n/bin/cat > ${JSON.stringify(sink)}\n`);
  chmodSync(tool, 0o755);

  return {
    sink,
    directory,
    path: directory,
    contents: () => (existsSync(sink) ? readFileSync(sink, "utf8") : null),
  };
}

/**
 * A fake editor launcher that records the arguments it was given.
 *
 * Named `code` or `cursor` and dropped on the synthesized PATH, so detection
 * finds exactly the editors a test asked for and no more. It writes its
 * arguments one per line, which is what makes "a project path with a space in
 * it arrived as one argument" a checkable claim rather than a hope.
 */
function fakeEditor(name, { directory = scratch("pathfinder-onboarding-editors-"), script } = {}) {
  const sink = join(directory, `${name}-args`);
  const tool = join(directory, name);

  writeFileSync(
    tool,
    script ?? `#!/bin/sh\nfor argument in "$@"; do echo "$argument"; done > ${JSON.stringify(sink)}\n`,
  );
  chmodSync(tool, 0o755);

  const read = () =>
    existsSync(sink) ? readFileSync(sink, "utf8").trimEnd().split("\n") : null;

  return {
    directory,
    path: directory,
    arguments: read,
    /**
     * The arguments, once they exist.
     *
     * Polled rather than awaited, because the launch is detached on purpose:
     * the CLI returns as soon as the process exists, so a test that read the
     * file immediately would be asserting on a race it wrote itself. Giving up
     * returns null, which reads as "it never ran" at the assertion.
     */
    waitForArguments: async (timeoutMs = 2000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = read();
        if (value !== null) return value;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return null;
    },
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
  editor = false,
  choice = null,
  harnesses = [],
} = {}) {
  const asked = [];
  const offered = [];
  return {
    interactive,
    asked,
    offered,
    confirm: async (question) => {
      asked.push(question);
      if (question.startsWith("Initialize a Git repository")) return git;
      if (question.startsWith("Copy that prompt")) return clipboard;
      if (question.startsWith("Open this project in")) return editor;
      throw new Error(`unexpected question: ${question}`);
    },
    chooseMany: async () => harnesses,
    /** Picks by label, because the editor objects are not the test's to build. */
    chooseOne: async (question, config) => {
      asked.push(question);
      offered.push(config.options.map((option) => option.label));
      const picked = config.options.find((option) => option.label === choice);
      return picked === undefined ? null : picked.value;
    },
    text: async () => "",
    close: () => {},
  };
}

/**
 * A directory holding a `git` that is never run.
 *
 * Detection asks only whether the name is on PATH, and these tests synthesize
 * PATH entry by entry, so a run that must reach the `git init` question has to
 * be told that `git` exists at all.
 */
function fakeGitPath() {
  const directory = scratch("pathfinder-onboarding-git-");
  writeFileSync(join(directory, "git"), "");
  return directory;
}

async function invoke(
  argv,
  {
    cwd,
    clipboardPath = "",
    editorPath = null,
    gitPath = null,
    prompter,
    platform = "darwin",
    locale = "en_US.UTF-8",
  } = {},
) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    cwd,
    out: (text) => (out += text),
    err: (text) => (err += text),
    // A UTF-8 locale, because these tests are about what the offers do, not
    // about the alphabet they are written in. Stating it keeps their assertions
    // readable now that the punctuation comes from the theme; the ASCII forms
    // are asserted on purpose in `describe("the ASCII corrections")` below.
    env: {
      PATH: [clipboardPath, editorPath, gitPath].filter(Boolean).join(":"),
      LANG: locale,
    },
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
    assert.match(out, /Onboarding actions are not offered in a dry run; nothing was copied or opened\./);
  });

  it("is not reached when the install was refused", async () => {
    const cwd = makeLooseDirectory();
    const clipboard = fakeClipboard();
    const prompter = scriptedPrompter({ git: false, clipboard: true });

    const { code } = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      gitPath: fakeGitPath(),
      prompter,
    });

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

describe("the flags", () => {
  it("documents both in --help", async () => {
    const { code, out } = await invoke(["--help"], { cwd: makeRepository() });
    assert.equal(code, 0);
    assert.match(out, /--no-clipboard/);
    assert.match(out, /--no-open/);
  });

  it("keeps them independent of each other", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const editor = fakeEditor("code");

    // --no-open leaves the clipboard offer standing, and the copy still happens.
    const prompter = scriptedPrompter({ clipboard: true, editor: true });
    const { code } = await invoke(["--no-open"], {
      cwd,
      clipboardPath: clipboard.path,
      editorPath: editor.path,
      prompter,
    });

    assert.equal(code, 0);
    assert.deepEqual(prompter.asked, [CLIPBOARD_QUESTION]);
    assert.equal(clipboard.contents(), kickstartPrompt([]));
    assert.equal(editor.arguments(), null);
  });
});

/** The single-editor question, as the user reads it. */
const OPEN_QUESTION = "Open this project in VS Code?";

describe("the editor offer — what is asked, and of whom", () => {
  it("asks nothing when no editor is on PATH", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const prompter = scriptedPrompter({ editor: true });

    const { code } = await invoke([], { cwd, clipboardPath: clipboard.path, prompter });

    assert.equal(code, 0);
    assert.deepEqual(prompter.asked, [CLIPBOARD_QUESTION]);
  });

  it("asks a yes/no naming the one editor it found", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const editor = fakeEditor("code");
    const prompter = scriptedPrompter({ editor: false });

    const { code } = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      editorPath: editor.path,
      prompter,
    });

    assert.equal(code, 0);
    assert.deepEqual(prompter.asked, [CLIPBOARD_QUESTION, OPEN_QUESTION]);
    assert.equal(editor.arguments(), null, "declining launched nothing");
  });

  it("offers a numbered list with a way out when several are found", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const editors = scratch("pathfinder-onboarding-both-");
    fakeEditor("code", { directory: editors });
    fakeEditor("cursor", { directory: editors });
    const prompter = scriptedPrompter({ choice: null });

    const { code } = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      editorPath: editors,
      prompter,
    });

    assert.equal(code, 0);
    assert.deepEqual(prompter.asked, [CLIPBOARD_QUESTION, "Open this project in an editor?"]);
    // Alphabetical, and VS Code is not first. The order is a fact about the
    // alphabet rather than a claim about which editor Pathfinder expects.
    assert.deepEqual(prompter.offered, [["Cursor", "VS Code", "Don't open"]]);
  });

  it("launches nothing when the numbered list is answered with Don't open", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const editors = scratch("pathfinder-onboarding-declined-");
    const code = fakeEditor("code", { directory: editors });
    const cursor = fakeEditor("cursor", { directory: editors });

    const result = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      editorPath: editors,
      prompter: scriptedPrompter({ choice: "Don't open" }),
    });

    assert.equal(result.code, 0);
    assert.equal(code.arguments(), null);
    assert.equal(cursor.arguments(), null);
    assert.doesNotMatch(result.out, /Opening/);
  });
});

describe("the editor offer — the launch", () => {
  it("opens the project directory when the offer is accepted", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const editor = fakeEditor("code");

    const { code, out } = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      editorPath: editor.path,
      prompter: scriptedPrompter({ editor: true }),
    });

    assert.equal(code, 0);
    assert.match(out, /  Opening VS Code\.\n/);
    assert.deepEqual(await editor.waitForArguments(), [cwd]);
  });

  it("passes a path with spaces in it as one argument", async () => {
    const parent = scratch("pathfinder-onboarding-spaced-");
    const cwd = join(parent, "my project files");
    mkdirSync(join(cwd, ".git"), { recursive: true });
    const clipboard = fakeClipboard();
    const editor = fakeEditor("code");

    const { code } = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      editorPath: editor.path,
      prompter: scriptedPrompter({ editor: true }),
    });

    assert.equal(code, 0);
    assert.deepEqual(await editor.waitForArguments(), [cwd]);
  });

  it("does not wait for the editor to exit", async () => {
    // The stub sleeps far longer than this test may take. A CLI that waited
    // would fail by timing out rather than by an assertion, which is the point:
    // the only way to pass is to have returned while it was still running.
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const editor = fakeEditor("code", { script: "#!/bin/sh\nsleep 30\n" });

    const started = Date.now();
    const { code, out } = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      editorPath: editor.path,
      prompter: scriptedPrompter({ editor: true }),
    });

    assert.equal(code, 0);
    assert.match(out, /Opening VS Code\./);
    assert.ok(Date.now() - started < 5000, "the install did not wait for the editor");
  });

  it("reports a launch that fails and still exits 0", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    // Present on PATH, and not executable — `code` is there, and running it
    // fails. The install must survive that, because it already succeeded.
    const directory = scratch("pathfinder-onboarding-broken-editor-");
    writeFileSync(join(directory, "code"), "not an executable\n");
    chmodSync(join(directory, "code"), 0o644);

    const { code, out } = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      editorPath: directory,
      prompter: scriptedPrompter({ editor: true }),
    });

    assert.equal(code, 0);
    assert.match(out, /  Not opened — code could not be run/);
    assert.match(out, new RegExp(`open ${cwd} yourself`));
    assert.ok(existsSync(join(cwd, "skills")), "the kit was still installed");
  });
});

describe("the editor offer — when it is not made at all", () => {
  it("is suppressed by --no-open", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const editor = fakeEditor("code");
    const prompter = scriptedPrompter({ editor: true });

    const { code, out } = await invoke(["--no-open"], {
      cwd,
      clipboardPath: clipboard.path,
      editorPath: editor.path,
      prompter,
    });

    assert.equal(code, 0);
    assert.equal(prompter.asked.includes(OPEN_QUESTION), false);
    assert.equal(editor.arguments(), null);
    // The flag suppresses the offer, not the install.
    assert.match(out, /Installed the Pathfinder kit into /);
  });

  it("is never offered without a terminal", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const editor = fakeEditor("code");
    const prompter = scriptedPrompter({ interactive: false, editor: true });

    const { code } = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      editorPath: editor.path,
      prompter,
    });

    assert.equal(code, 0);
    assert.deepEqual(prompter.asked, []);
    assert.equal(editor.arguments(), null);
  });

  it("is not performed under --yes, because silence is not consent", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const editor = fakeEditor("code");
    const prompter = scriptedPrompter({ editor: true });

    const { code } = await invoke(["--yes"], {
      cwd,
      clipboardPath: clipboard.path,
      editorPath: editor.path,
      prompter,
    });

    assert.equal(code, 0);
    assert.deepEqual(prompter.asked, []);
    assert.equal(editor.arguments(), null);
  });

  it("launches nothing in a dry run, and says so once for both actions", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const editor = fakeEditor("code");
    const prompter = scriptedPrompter({ clipboard: true, editor: true });

    const { code, out } = await invoke(["--dry-run"], {
      cwd,
      clipboardPath: clipboard.path,
      editorPath: editor.path,
      prompter,
    });

    assert.equal(code, 0);
    assert.deepEqual(prompter.asked, []);
    assert.equal(editor.arguments(), null);
    assert.equal(clipboard.contents(), null);
    assert.match(out, /nothing was copied or opened\./);
  });

  it("says nothing about a dry run when both flags already ruled both out", async () => {
    const cwd = makeRepository();
    const { out } = await invoke(["--dry-run", "--no-clipboard", "--no-open"], {
      cwd,
      prompter: scriptedPrompter(),
    });

    assert.doesNotMatch(out, /Onboarding actions/);
  });

  it("is not reached when the install was refused", async () => {
    const cwd = makeLooseDirectory();
    const editor = fakeEditor("code");
    const prompter = scriptedPrompter({ git: false, editor: true });

    const { code } = await invoke([], {
      cwd,
      editorPath: editor.path,
      gitPath: fakeGitPath(),
      prompter,
    });

    assert.equal(code, 1);
    assert.deepEqual(prompter.asked, ["Initialize a Git repository here?"]);
    assert.equal(editor.arguments(), null);
  });
});

/**
 * The blank line above the questions, Feature 21.
 *
 * A real captured run showed the first question butted straight against the
 * last line of the printed prompt, which made the two read as one block — the
 * prompt looked like it continued into a question. The separator is asserted at
 * ask time rather than on the finished transcript, because by the end the
 * answers and the sign-off have been printed over the top of the thing being
 * pinned.
 */
describe("the questions are separated from the prompt they follow", () => {
  /** Records what had been printed at the moment each question was asked. */
  function snapshottingPrompter(readOutput, { editor = false } = {}) {
    const seen = [];
    return {
      interactive: true,
      seen,
      confirm: async (question) => {
        seen.push({ question, before: readOutput() });
        if (question.startsWith("Copy that prompt")) return false;
        if (question.startsWith("Open this project in")) return editor;
        throw new Error(`unexpected question: ${question}`);
      },
      chooseMany: async () => [],
      chooseOne: async () => null,
      text: async () => "",
      close: () => {},
    };
  }

  async function runWith(argv, { cwd, editorPath = null, prompter: build }) {
    let out = "";
    const prompter = build(() => out);
    const code = await run(argv, {
      cwd,
      out: (text) => (out += text),
      err: () => {},
      env: { PATH: [fakeClipboard().path, editorPath].filter(Boolean).join(":"), LANG: "en_US.UTF-8" },
      platform: "darwin",
      prompter,
    });
    return { code, out, prompter };
  }

  it("prints one blank line between the prompt block and the first question", async () => {
    const cwd = makeRepository();

    const { code, prompter } = await runWith([], {
      cwd,
      prompter: (readOutput) => snapshottingPrompter(readOutput),
    });

    assert.equal(code, 0);
    const [first] = prompter.seen;
    assert.equal(first.question, CLIPBOARD_QUESTION);
    // The prompt's own last line, then exactly one empty line, and nothing else.
    assert.match(first.before, /Do not install packages or write product code yet\.\n\n$/);
  });

  it("separates the questions once, not once each", async () => {
    const cwd = makeRepository();
    const editor = fakeEditor("code");

    const { prompter } = await runWith([], {
      cwd,
      editorPath: editor.path,
      prompter: (readOutput) => snapshottingPrompter(readOutput),
    });

    assert.deepEqual(
      prompter.seen.map((entry) => entry.question),
      [CLIPBOARD_QUESTION, OPEN_QUESTION],
    );
    // Declining the clipboard prints nothing, so the second question sees the
    // same bytes the first did — one separator, shared, with the two questions
    // adjacent underneath it.
    assert.equal(prompter.seen[1].before, prompter.seen[0].before);
  });

  it("prints no separator when nothing will be asked", async () => {
    const cwd = makeRepository();

    // `--no-clipboard` rules out the one question that is always available, and
    // an empty PATH means no editor to offer, so this run asks nothing at all.
    const { out, prompter } = await runWith(["--no-clipboard"], {
      cwd,
      prompter: (readOutput) => snapshottingPrompter(readOutput),
    });

    assert.deepEqual(prompter.seen, []);
    assert.match(out, /Do not install packages or write product code yet\.\n$/);
  });
});

/**
 * The ASCII corrections, Feature 20.
 *
 * The other three of the seven literals that used to print as Unicode whatever
 * the terminal could show. Both failure lines carry an em dash, and a failure
 * message rendered as mojibake is the worst possible moment for it: the user is
 * already being told something did not work.
 */
describe("the ASCII corrections", () => {
  it("writes the clipboard failure with an ASCII dash", async () => {
    const cwd = makeRepository();

    const { out } = await invoke([], {
      cwd,
      clipboardPath: scratch("pathfinder-onboarding-ascii-empty-"),
      prompter: scriptedPrompter({ clipboard: true }),
      locale: "C",
    });

    assert.match(out, /Not copied - no clipboard tool is available here\./);
    assert.doesNotMatch(out, /—/);
  });

  it("writes the editor failure with an ASCII dash", async () => {
    const cwd = makeRepository();
    const clipboard = fakeClipboard();
    const directory = scratch("pathfinder-onboarding-ascii-editor-");
    writeFileSync(join(directory, "code"), "not an executable\n");
    chmodSync(join(directory, "code"), 0o644);

    const { out } = await invoke([], {
      cwd,
      clipboardPath: clipboard.path,
      editorPath: directory,
      prompter: scriptedPrompter({ editor: true }),
      locale: "C",
    });

    assert.match(out, / {2}Not opened - code could not be run/);
  });

  it("writes the next-step line with an ASCII dash", async () => {
    const cwd = makeRepository();

    const { out } = await invoke([], { cwd, locale: "C" });

    assert.match(out, /Next step - give your agent this prompt:/);
  });

  it("leaves no character above U+007F anywhere in an ASCII run", async () => {
    const cwd = makeRepository();

    const { out, err } = await invoke([], {
      cwd,
      clipboardPath: scratch("pathfinder-onboarding-ascii-clean-"),
      prompter: scriptedPrompter({ clipboard: true }),
      locale: "C",
    });

    // eslint-disable-next-line no-control-regex
    assert.match(out + err, /^[\x00-\x7F]*$/);
  });

  it("still writes the decorated forms in a UTF-8 terminal", async () => {
    const cwd = makeRepository();

    const { out } = await invoke([], {
      cwd,
      clipboardPath: scratch("pathfinder-onboarding-utf8-"),
      prompter: scriptedPrompter({ clipboard: true }),
    });

    assert.match(out, /Not copied — no clipboard tool is available here\./);
    assert.match(out, /Next step — give your agent this prompt:/);
  });
});
