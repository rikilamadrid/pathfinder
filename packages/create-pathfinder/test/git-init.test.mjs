/**
 * Who decides that a repository gets created, and what it costs to say no.
 *
 * Every path through the decision is here, because the failure mode this
 * feature risks is not a crash — it is a tool that creates a repository nobody
 * asked it to create, or one that quietly hangs a script waiting for an answer
 * that will never come.
 *
 * Flag cases use `--dry-run`, which reaches the same decision and then performs
 * none of it: the assertion that the directory is still empty afterwards then
 * covers both the install and the `git init`. The cases about the *question*
 * cannot, because `--dry-run` does not ask one; they run for real and decline,
 * which is equally empty afterwards. The two cases that must prove a real
 * repository appears are marked, and only those run the binary.
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { run } from "../src/cli.mjs";
import { nonInteractivePrompter } from "../src/prompt.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

/** An empty directory that is not a repository and is not inside one. */
function makeLooseDirectory() {
  const cwd = mkdtempSync(join(tmpdir(), "pathfinder-loose-"));
  temporaryRoots.push(cwd);
  return cwd;
}

/**
 * A directory that already is a repository.
 *
 * `findGitRoot` looks for `.git` and never runs the binary, so a bare directory
 * of that name is a repository as far as every decision here is concerned.
 */
function makeRepository() {
  const cwd = makeLooseDirectory();
  mkdirSync(join(cwd, ".git"));
  return cwd;
}

/** A PATH on which `git` is findable, without requiring the real binary. */
function makeFakeGitPath() {
  const binary = mkdtempSync(join(tmpdir(), "pathfinder-bin-"));
  temporaryRoots.push(binary);
  writeFileSync(join(binary, "git"), "");
  return binary;
}

/**
 * A prompter that answers the Git question as told and declines everything else.
 *
 * `asked` holds the yes/no questions only, so these tests keep asserting about
 * the Git question and nothing else. The harness question is recorded
 * separately and answered "none", which is what makes every assertion here
 * about a run that configures no tools.
 *
 * The scoping is deliberate and was a real bug for about an hour. A prompter
 * that answered `true` to every confirm authorized the clipboard offer too, so
 * a suite run on a Linux machine with `xclip` installed would have overwritten
 * the developer's own clipboard — the exact harm the offer exists to prevent,
 * inflicted by the tests for an unrelated feature. Saying yes to one question
 * is not saying yes to the next one, here as much as in the CLI.
 */
function scriptedPrompter(answer, { harnesses = [] } = {}) {
  const asked = [];
  const offered = [];
  const GIT_QUESTION = "Initialize a Git repository here?";
  return {
    interactive: true,
    asked,
    offered,
    confirm: async (question) => {
      asked.push(question);
      return question === GIT_QUESTION ? answer : false;
    },
    chooseMany: async (question) => {
      offered.push(question);
      return harnesses;
    },
    // These tests pass a real PATH, so a machine with `code` or `cursor` on it
    // reaches the editor offer. Answering it with "nothing" is the same
    // precaution the per-question `confirm` above is: a test about `git init`
    // must not open a window on the developer's screen.
    chooseOne: async () => null,
    close: () => {},
  };
}

function invoke(argv, { cwd, gitOnPath = true, prompter = nonInteractivePrompter(), ...rest }) {
  let out = "";
  let err = "";
  const code = run(argv, {
    cwd,
    out: (text) => (out += text),
    err: (text) => (err += text),
    env: gitOnPath ? { PATH: makeFakeGitPath() } : {},
    platform: "linux",
    prompter,
    ...rest,
  });
  return code.then((value) => ({ code: value, out, err }));
}

describe("git init — the flags", () => {
  it("--git-init authorizes it without a terminal", async () => {
    const cwd = makeLooseDirectory();

    const { code, out } = await invoke(["--git-init", "--dry-run"], { cwd });

    assert.equal(code, 0);
    assert.match(out, /Would run `git init` in /);
    assert.match(out, /Would install the Pathfinder kit/);
  });

  it("--no-git-init refuses instead", async () => {
    const cwd = makeLooseDirectory();

    const { code, err } = await invoke(["--no-git-init"], { cwd });

    assert.equal(code, 1);
    assert.match(err, /is not inside a Git repository/);
    assert.deepEqual(readdirSync(cwd), []);
  });

  it("--no-git-init wins over a terminal, and nothing is asked", async () => {
    const cwd = makeLooseDirectory();
    const prompter = scriptedPrompter(true);

    const { code } = await invoke(["--no-git-init"], { cwd, prompter });

    assert.equal(code, 1);
    assert.deepEqual(prompter.asked, []);
  });

  it("exits 2 when both flags are given, without touching the directory", async () => {
    const cwd = makeLooseDirectory();

    const { code, err } = await invoke(["--git-init", "--no-git-init"], { cwd });

    assert.equal(code, 2);
    assert.match(err, /contradict each other/);
    assert.deepEqual(readdirSync(cwd), []);
  });

  it("--yes does not authorize it", async () => {
    // "Assume the defaults" must not cover the one thing that has to be said
    // out loud. This is the spec's edge case: `--yes` in a non-Git directory
    // without `--git-init` refuses.
    const cwd = makeLooseDirectory();
    const prompter = scriptedPrompter(true);

    const { code, err } = await invoke(["--yes"], { cwd, prompter });

    assert.equal(code, 1);
    assert.match(err, /pass --git-init/);
    assert.deepEqual(prompter.asked, []);
    assert.deepEqual(readdirSync(cwd), []);
  });

  it("--no-input is the same flag", async () => {
    const cwd = makeLooseDirectory();
    const prompter = scriptedPrompter(true);

    const { code } = await invoke(["--no-input"], { cwd, prompter });

    assert.equal(code, 1);
    assert.deepEqual(prompter.asked, []);
  });
});

describe("git init — the TTY guard", () => {
  it("asks nothing when there is no terminal, and says how to proceed", async () => {
    const cwd = makeLooseDirectory();

    const { code, err } = await invoke([], { cwd });

    assert.equal(code, 1);
    // The 1.4.1 refusal, unchanged, plus the one line this feature adds.
    assert.match(err, /is not inside a Git repository/);
    assert.match(err, /Run `git init`\nhere first, or cd into an existing repository/);
    assert.match(err, /To have this command run `git init` for you, pass --git-init\./);
    assert.deepEqual(readdirSync(cwd), []);
  });

  // Declining is what makes these two safe to run for real: the question is
  // asked, the answer is no, and nothing is created. `--dry-run` cannot stand
  // in here any more, because it no longer reaches the question at all.
  it("asks when there is one", async () => {
    const cwd = makeLooseDirectory();
    const prompter = scriptedPrompter(false);

    await invoke([], { cwd, prompter, stdoutIsTTY: true });

    assert.deepEqual(prompter.asked, ["Initialize a Git repository here?"]);
    assert.deepEqual(readdirSync(cwd), []);
  });

  it("explains why before it asks", async () => {
    const cwd = makeLooseDirectory();

    const { out } = await invoke([], {
      cwd,
      prompter: scriptedPrompter(false),
      stdoutIsTTY: true,
    });

    assert.match(out, /installs into version control so you can review what it wrote/);
    assert.match(out, /will not touch an existing history/);
  });
});

describe("git init — declining", () => {
  it("writes nothing and exits 1", async () => {
    const cwd = makeLooseDirectory();

    const { code, err } = await invoke([], { cwd, prompter: scriptedPrompter(false) });

    assert.equal(code, 1);
    assert.match(err, /Nothing was installed\./);
    assert.match(err, /Run `git init` here yourself/);
    assert.deepEqual(readdirSync(cwd), []);
  });

  it("treats an unanswerable question as a decline", async () => {
    // null is what the prompter returns for a closed stdin or input that never
    // resolved to a yes or a no. No usable approval is no approval.
    const cwd = makeLooseDirectory();

    const { code } = await invoke([], { cwd, prompter: scriptedPrompter(null) });

    assert.equal(code, 1);
    assert.deepEqual(readdirSync(cwd), []);
  });
});

describe("git init — when git is not installed", () => {
  it("refuses without offering a flag that cannot work", async () => {
    const cwd = makeLooseDirectory();

    const { code, err } = await invoke([], { cwd, gitOnPath: false });

    assert.equal(code, 1);
    assert.match(err, /`git`\nis not available to create one/);
    assert.match(err, /Install Git\n\(https:\/\/git-scm\.com\/downloads\)/);
    assert.doesNotMatch(err, /--git-init/);
  });

  it("refuses even when --git-init was passed", async () => {
    const cwd = makeLooseDirectory();

    const { code, err } = await invoke(["--git-init"], { cwd, gitOnPath: false });

    assert.equal(code, 1);
    assert.match(err, /is not available to create one/);
    assert.deepEqual(readdirSync(cwd), []);
  });

  it("asks nothing, because no answer could help", async () => {
    const cwd = makeLooseDirectory();
    const prompter = scriptedPrompter(true);

    await invoke([], { cwd, gitOnPath: false, prompter, stdoutIsTTY: true });

    assert.deepEqual(prompter.asked, []);
  });
});

describe("git init — --dry-run performs nothing", () => {
  it("leaves no .git and no files while reporting both", async () => {
    const cwd = makeLooseDirectory();

    const { code, out } = await invoke(["--dry-run", "--git-init"], { cwd });

    assert.equal(code, 0);
    assert.match(out, /Would run `git init`/);
    assert.match(out, /\d+ files to write/);
    assert.deepEqual(readdirSync(cwd), []);
  });

  // The question it would otherwise ask exists only to authorize the `git
  // init`, and no `git init` is coming. The file plan is identical whichever
  // way it were answered, so asking would buy a report the tool can write on
  // its own — and refusing instead would withhold the one thing that was asked
  // for. Reporting is the whole mode.
  it("asks nothing, even with a terminal on both ends", async () => {
    const cwd = makeLooseDirectory();
    const prompter = scriptedPrompter(false);

    const { code, out } = await invoke(["--dry-run"], { cwd, prompter, stdoutIsTTY: true });

    assert.equal(code, 0);
    assert.deepEqual(prompter.asked, []);
    assert.match(out, /Would run `git init`/);
    assert.match(out, /\d+ files to write/);
    assert.deepEqual(readdirSync(cwd), []);
  });

  it("reports the same thing without a terminal, so a script sees the plan too", async () => {
    const cwd = makeLooseDirectory();

    const { code, out } = await invoke(["--dry-run"], { cwd });

    assert.equal(code, 0);
    assert.match(out, /Would run `git init`/);
    assert.deepEqual(readdirSync(cwd), []);
  });

  // Two walls survive the mode, because both are real at the moment the user
  // drops `--dry-run`. Reporting a plan that cannot run would be the lie the
  // mode exists to avoid.
  it("still refuses when the user said never", async () => {
    const cwd = makeLooseDirectory();
    const prompter = scriptedPrompter(true);

    const { code, err } = await invoke(["--dry-run", "--no-git-init"], { cwd, prompter });

    assert.equal(code, 1);
    assert.match(err, /is not inside a Git repository/);
    assert.deepEqual(prompter.asked, []);
    assert.deepEqual(readdirSync(cwd), []);
  });

  it("still refuses when there is no `git` to run", async () => {
    const cwd = makeLooseDirectory();

    const { code, err } = await invoke(["--dry-run"], { cwd, gitOnPath: false });

    assert.equal(code, 1);
    assert.match(err, /`git`\n?\s*is not available to create one/);
    assert.deepEqual(readdirSync(cwd), []);
  });

  it("changes nothing inside a repository that already exists", async () => {
    const cwd = makeRepository();

    const { code, out } = await invoke(["--dry-run"], { cwd, stdoutIsTTY: true });

    assert.equal(code, 0);
    assert.doesNotMatch(out, /Would run `git init`/);
    assert.deepEqual(readdirSync(cwd), [".git"]);
  });
});

describe("git init — the real thing", () => {
  it("initializes on approval and completes the install", async () => {
    const cwd = makeLooseDirectory();

    const { code, out } = await invoke([], {
      cwd,
      env: { PATH: process.env.PATH },
      prompter: scriptedPrompter(true),
    });

    assert.equal(code, 0);
    assert.match(out, /git init - initialized an empty repository/);
    assert.ok(existsSync(join(cwd, ".git")), "the repository exists");
    assert.ok(existsSync(join(cwd, "skills")), "the kit was installed");
    assert.match(out, /Installed the Pathfinder kit into /);
    // The note about a repository root elsewhere would be wrong here: the
    // directory we initialized is the root.
    assert.doesNotMatch(out, /the repository root is/);
  });

  it("reports the initialization in the terminal's own alphabet", async () => {
    const cwd = makeLooseDirectory();

    const { out } = await invoke([], {
      cwd,
      env: { PATH: process.env.PATH, LANG: "en_US.UTF-8" },
      prompter: scriptedPrompter(true),
    });

    assert.match(out, /✓ git init — initialized an empty repository/);
  });

  it("is not offered again on a second run", async () => {
    const cwd = makeLooseDirectory();

    await invoke([], { cwd, env: { PATH: process.env.PATH }, prompter: scriptedPrompter(true) });

    const prompter = scriptedPrompter(true);
    const { code, out } = await invoke([], { cwd, env: { PATH: process.env.PATH }, prompter });

    assert.equal(code, 0);
    // The Git question specifically, not "no questions at all": a second run
    // still ends by offering to copy the Kickstart prompt, which is a different
    // question about a directory that is already a repository.
    assert.equal(prompter.asked.includes("Initialize a Git repository here?"), false);
    assert.doesNotMatch(out, /git init/);
  });
});
