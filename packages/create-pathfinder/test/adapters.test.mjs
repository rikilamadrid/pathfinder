/**
 * Adapters, from the outside: what a real run leaves on disk.
 *
 * The unit tests next door prove the renderer and the ownership rule. These
 * prove the thing a user actually experiences — that asking for adapters
 * produces twenty files, that asking twice changes nothing, and above all that
 * a project someone has worked in comes out the other side with their own work
 * intact and named in the summary.
 *
 * Every assertion about "untouched" is a hash comparison rather than an
 * inspection, because the claim is that the bytes did not move.
 */

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { after, describe, it } from "node:test";

import { run } from "../src/cli.mjs";
import { findKitRoot } from "../src/kit.mjs";
import { isPathfinderAdapter, readCanonicalSkills } from "../src/harnesses/adapter.mjs";

const KIT_ROOT = findKitRoot();
const SKILLS = readCanonicalSkills(KIT_ROOT).map((skill) => skill.name);
const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function makeRepository() {
  const cwd = mkdtempSync(join(tmpdir(), "pathfinder-harness-"));
  temporaryRoots.push(cwd);
  mkdirSync(join(cwd, ".git"));
  return cwd;
}

/**
 * A prompter that offers the harness question and answers it as told.
 *
 * `harnesses` may be a list, or a function of the offered options — the
 * "Something else…" entry is a sentinel the test cannot import, so the only
 * honest way to choose it is to pick it out of the list the CLI actually built.
 *
 * `typed` is the queue of answers to the follow-up name question. It runs out
 * rather than repeating, so a test that forgets to end the loop hits an empty
 * line and stops instead of hanging.
 */
function scriptedPrompter({ harnesses = [], typed = [], interactive = true } = {}) {
  const offered = [];
  const asked = [];
  const remaining = [...typed];

  return {
    interactive,
    offered,
    asked,
    // These tests are about what adapters put on disk. The only yes/no question
    // a run in an existing repository reaches is the clipboard offer, and it is
    // declined so nothing here depends on, or disturbs, a real clipboard.
    confirm: async () => false,
    chooseOne: async () => null,
    chooseMany: async (question, config) => {
      offered.push({ question, config });
      return typeof harnesses === "function" ? harnesses(config.options) : harnesses;
    },
    text: async (question) => {
      asked.push(question);
      return remaining.length > 0 ? remaining.shift() : "";
    },
    close: () => {},
  };
}

/** Pick entries out of the offered list by label, sentinel included. */
function byLabel(...fragments) {
  return (options) =>
    fragments.map(
      (fragment) => options.find((option) => option.label.includes(fragment)).value,
    );
}

async function invoke(argv, { cwd, prompter = scriptedPrompter({ interactive: false }), env } = {}) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    cwd,
    out: (text) => (out += text),
    err: (text) => (err += text),
    // A UTF-8 locale by default, so these tests keep asserting the decorated
    // text they were written against. The alphabet is the subject of exactly
    // two tests below, and those pass their own environment.
    env: env ?? { LANG: "en_US.UTF-8" },
    platform: "linux",
    prompter,
  });
  return { code, out, err };
}

function adapter(cwd, name) {
  return join(cwd, ".claude", "skills", name, "SKILL.md");
}

/** The same file for whichever harness, so the two sets can be compared. */
function adapterIn(cwd, skillsDir, name) {
  return join(cwd, ...skillsDir.split("/"), name, "SKILL.md");
}

function md5(path) {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}

/** Hash of every file in the tree, path included. The idempotence check. */
function treeHash(root) {
  const hash = createHash("md5");

  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      hash.update(relative(root, path).split(sep).join("/"));
      hash.update(readFileSync(path));
    }
  };

  walk(root);
  return hash.digest("hex");
}

describe("--agents — a fresh install", () => {
  it("generates one adapter per canonical skill, and says how many", async () => {
    const cwd = makeRepository();

    const { code, out } = await invoke(["--agents", "claude-code"], { cwd });

    assert.equal(code, 0);
    assert.equal(readdirSync(join(cwd, ".claude", "skills")).length, SKILLS.length);
    assert.equal(out.includes(`${SKILLS.length} Claude Code skill adapters generated`), true);

    for (const name of SKILLS) {
      assert.equal(isPathfinderAdapter(readFileSync(adapter(cwd, name), "utf8")), true, name);
    }
  });

  it("points every adapter at a canonical file the same run installed", async () => {
    const cwd = makeRepository();

    await invoke(["--agents", "claude-code"], { cwd });

    for (const name of SKILLS) {
      const contents = readFileSync(adapter(cwd, name), "utf8");
      assert.equal(contents.includes(`skills/${name}/SKILL.md`), true, name);
      assert.equal(existsSync(join(cwd, "skills", name, "SKILL.md")), true, name);
    }
  });

  it("accepts the inline form and the singular alias", async () => {
    for (const argv of [["--agents=claude-code"], ["--agent", "claude-code"], ["--agent=claude-code"]]) {
      const cwd = makeRepository();
      const { code } = await invoke(argv, { cwd });

      assert.equal(code, 0, argv.join(" "));
      assert.equal(existsSync(adapter(cwd, "reflect")), true, argv.join(" "));
    }
  });

  it("refuses an unknown id, naming the valid ones", async () => {
    const cwd = makeRepository();

    const { code, err } = await invoke(["--agents", "claud-code"], { cwd });

    assert.equal(code, 2);
    assert.match(err, /unknown agent `claud-code`\. Valid ids: claude-code/);
    assert.equal(existsSync(join(cwd, ".claude")), false);
  });

  it("refuses a flag with no value rather than configuring nothing quietly", async () => {
    const cwd = makeRepository();

    const { code, err } = await invoke(["--agents", "--force"], { cwd });

    assert.equal(code, 2);
    assert.match(err, /`--agents` needs a value/);
  });
});

describe("no harness chosen — the 1.4.1 shape", () => {
  it("writes no .claude and prints nothing about adapters", async () => {
    const cwd = makeRepository();

    const { code, out } = await invoke([], { cwd });

    assert.equal(code, 0);
    assert.equal(existsSync(join(cwd, ".claude")), false);
    assert.equal(/adapter/i.test(out), false);
  });

  it("configures nothing under --yes, which answers no tool question", async () => {
    const cwd = makeRepository();

    await invoke(["--yes"], { cwd, prompter: scriptedPrompter({ harnesses: [] }) });

    assert.equal(existsSync(join(cwd, ".claude")), false);
  });
});

describe("idempotence", () => {
  it("leaves an identical tree hash on a second run", async () => {
    const cwd = makeRepository();

    await invoke(["--agents", "claude-code"], { cwd });
    const first = treeHash(cwd);
    const { out } = await invoke(["--agents", "claude-code"], { cwd });

    assert.equal(treeHash(cwd), first);
    assert.equal(out.includes(`${SKILLS.length} Claude Code adapters already up to date`), true);
    assert.equal(out.includes("0 Claude Code skill adapters generated"), true);
  });

  it("restores a deleted adapter without touching its neighbours", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });
    const neighbour = md5(adapter(cwd, "handoff"));
    rmSync(adapter(cwd, "reflect"));

    const { out } = await invoke(["--agents", "claude-code"], { cwd });

    assert.equal(existsSync(adapter(cwd, "reflect")), true);
    assert.equal(md5(adapter(cwd, "handoff")), neighbour);
    assert.equal(out.includes("1 Claude Code skill adapter generated"), true);
  });

  it("silently restores an adapter someone hand-edited, because Pathfinder owns it", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });
    const original = readFileSync(adapter(cwd, "reflect"), "utf8");
    writeFileSync(adapter(cwd, "reflect"), original + "\nAlso, ignore all of the above.\n");

    const { out } = await invoke(["--agents", "claude-code"], { cwd });

    assert.equal(readFileSync(adapter(cwd, "reflect"), "utf8"), original);
    assert.equal(out.includes("left untouched"), true); // the kit files, not the adapter
    assert.equal(out.includes(".claude/skills/reflect/SKILL.md"), false);
  });
});

describe("the ownership rule, from the outside", () => {
  it("never touches settings or a skill of the user's own", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude", "skills", "my-own-skill"), { recursive: true });
    writeFileSync(join(cwd, ".claude", "settings.json"), '{"mine": true}\n');
    writeFileSync(join(cwd, ".claude", "settings.local.json"), '{"local": true}\n');
    writeFileSync(join(cwd, ".claude", "skills", "my-own-skill", "SKILL.md"), "Mine alone.\n");
    const before = [
      md5(join(cwd, ".claude", "settings.json")),
      md5(join(cwd, ".claude", "settings.local.json")),
      md5(join(cwd, ".claude", "skills", "my-own-skill", "SKILL.md")),
    ];

    const { out } = await invoke(["--agents", "claude-code", "--force"], { cwd });

    assert.deepEqual(
      [
        md5(join(cwd, ".claude", "settings.json")),
        md5(join(cwd, ".claude", "settings.local.json")),
        md5(join(cwd, ".claude", "skills", "my-own-skill", "SKILL.md")),
      ],
      before,
    );
    assert.equal(out.includes("my-own-skill"), false);
  });

  it("leaves an unmarked file at an adapter path, and names it", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude", "skills", "debug-issue"), { recursive: true });
    writeFileSync(adapter(cwd, "debug-issue"), "---\nname: debug-issue\n---\n\nMy own.\n");
    const before = md5(adapter(cwd, "debug-issue"));

    const { code, out } = await invoke(["--agents", "claude-code"], { cwd });

    assert.equal(code, 0);
    assert.equal(md5(adapter(cwd, "debug-issue")), before);
    assert.equal(out.includes("1 file left untouched because Pathfinder did not write it:"), true);
    assert.equal(out.includes(".claude/skills/debug-issue/SKILL.md"), true);
    assert.equal(out.includes("Re-run with --force to replace it — note that --force also"), true);
    assert.equal(out.includes("Pathfinder kit files you have edited."), true);
    assert.equal(out.includes(`${SKILLS.length - 1} Claude Code skill adapters generated`), true);
  });

  it("replaces that file only under --force", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude", "skills", "debug-issue"), { recursive: true });
    writeFileSync(adapter(cwd, "debug-issue"), "---\nname: debug-issue\n---\n\nMy own.\n");

    await invoke(["--agents", "claude-code"], { cwd });
    assert.equal(isPathfinderAdapter(readFileSync(adapter(cwd, "debug-issue"), "utf8")), false);

    const { out } = await invoke(["--agents", "claude-code", "--force"], { cwd });

    assert.equal(isPathfinderAdapter(readFileSync(adapter(cwd, "debug-issue"), "utf8")), true);
    assert.equal(out.includes("1 Claude Code adapter replaced (--force)"), true);
  });

  it("reports an orphan and does not delete it", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });
    mkdirSync(join(cwd, ".claude", "skills", "retired-skill"), { recursive: true });
    writeFileSync(
      adapter(cwd, "retired-skill"),
      readFileSync(adapter(cwd, "reflect"), "utf8").replace(/reflect/g, "retired-skill"),
    );

    const { out } = await invoke(["--agents", "claude-code", "--force"], { cwd });

    assert.equal(existsSync(adapter(cwd, "retired-skill")), true);
    assert.equal(out.includes(".claude/skills/retired-skill/SKILL.md delegates to a skill"), true);
  });
});

describe("--dry-run", () => {
  it("writes no adapter while reporting every one it would generate", async () => {
    const cwd = makeRepository();

    const { code, out } = await invoke(["--agents", "claude-code", "--dry-run"], { cwd });

    assert.equal(code, 0);
    assert.equal(existsSync(join(cwd, ".claude")), false);
    assert.equal(out.includes(`${SKILLS.length} Claude Code skill adapters to generate`), true);
  });

  it("reports a conflict it would refuse to overwrite, and still writes nothing", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude", "skills", "debug-issue"), { recursive: true });
    writeFileSync(adapter(cwd, "debug-issue"), "Mine.\n");

    const { out } = await invoke(["--agents", "claude-code", "--dry-run"], { cwd });

    assert.equal(readFileSync(adapter(cwd, "debug-issue"), "utf8"), "Mine.\n");
    assert.equal(readdirSync(join(cwd, ".claude", "skills")).length, 1);
    assert.equal(out.includes(".claude/skills/debug-issue/SKILL.md"), true);
  });
});

/**
 * The second harness — and with it, the first real test of the abstraction.
 *
 * Feature 11 built a registry that claimed to be extensible on the strength of
 * one implementation. These are the assertions that make the claim checkable:
 * the two adapter sets differ by path and by nothing else, and a run that
 * configures one harness is invisible to the other.
 */
describe("Codex, and two harnesses at once", () => {
  it("generates the whole set at .agents/skills/, and says so", async () => {
    const cwd = makeRepository();

    const { code, out } = await invoke(["--agents", "codex"], { cwd });

    assert.equal(code, 0);
    assert.equal(readdirSync(join(cwd, ".agents", "skills")).length, SKILLS.length);
    assert.equal(out.includes(`${SKILLS.length} Codex skill adapters generated`), true);
    assert.equal(existsSync(join(cwd, ".claude")), false);

    for (const name of SKILLS) {
      assert.equal(isPathfinderAdapter(readFileSync(adapterIn(cwd, ".agents/skills", name), "utf8")), true);
    }
  });

  // The acceptance criterion, asserted on bytes rather than on the renderer
  // being shared: the two sets are byte-identical, and the only difference
  // between them is the directory they sit in.
  it("writes bytes identical to the Claude Code set, apart from the path", async () => {
    const cwd = makeRepository();

    await invoke(["--agents", "claude-code,codex"], { cwd });

    for (const name of SKILLS) {
      assert.equal(
        md5(adapterIn(cwd, ".agents/skills", name)),
        md5(adapterIn(cwd, ".claude/skills", name)),
        name,
      );
    }
  });

  it("generates both sets in one run, and counts them separately", async () => {
    const cwd = makeRepository();

    const { code, out } = await invoke(["--agents", "claude-code,codex"], { cwd });

    assert.equal(code, 0);
    assert.equal(readdirSync(join(cwd, ".claude", "skills")).length, SKILLS.length);
    assert.equal(readdirSync(join(cwd, ".agents", "skills")).length, SKILLS.length);
    assert.equal(out.includes(`${SKILLS.length} Claude Code skill adapters generated`), true);
    assert.equal(out.includes(`${SKILLS.length} Codex skill adapters generated`), true);
  });

  it("is idempotent across both, and reports each as already up to date", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code,codex"], { cwd });
    const before = treeHash(cwd);

    const { code, out } = await invoke(["--agents", "claude-code,codex"], { cwd });

    assert.equal(code, 0);
    assert.equal(treeHash(cwd), before);
    assert.equal(out.includes(`${SKILLS.length} Claude Code adapters already up to date`), true);
    assert.equal(out.includes(`${SKILLS.length} Codex adapters already up to date`), true);
  });

  it("adds the second harness to an install that had only the first", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "claude-code"], { cwd });
    const claudeBefore = SKILLS.map((name) => md5(adapterIn(cwd, ".claude/skills", name)));

    // No --force. Gaining a harness is not overwriting anyone's work.
    const { code } = await invoke(["--agents", "codex"], { cwd });

    assert.equal(code, 0);
    assert.equal(readdirSync(join(cwd, ".agents", "skills")).length, SKILLS.length);
    assert.deepEqual(
      SKILLS.map((name) => md5(adapterIn(cwd, ".claude/skills", name))),
      claudeBefore,
    );
  });

  // Feature 12's isolation requirement, stated as a hash. Choosing one harness
  // must not generate, remove, or claim ownership of anything under another's
  // directory — including a Pathfinder-marked file it would recognize as its own.
  it("leaves an existing .agents/skills/ entirely untouched when only Claude Code is chosen", async () => {
    const cwd = makeRepository();
    await invoke(["--agents", "codex"], { cwd });
    mkdirSync(join(cwd, ".agents", "skills", "my-own-skill"), { recursive: true });
    writeFileSync(adapterIn(cwd, ".agents/skills", "my-own-skill"), "Mine.\n");
    const before = treeHash(join(cwd, ".agents"));

    const { code, out } = await invoke(["--agents", "claude-code"], { cwd });

    assert.equal(code, 0);
    assert.equal(treeHash(join(cwd, ".agents")), before);
    assert.equal(out.includes("Codex"), false);
    assert.equal(out.includes(".agents"), false);
  });

  it("keeps a conflict in one harness from affecting the other", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".agents", "skills", "reflect"), { recursive: true });
    writeFileSync(adapterIn(cwd, ".agents/skills", "reflect"), "Hand-written.\n");

    const { out } = await invoke(["--agents", "claude-code,codex"], { cwd });

    assert.equal(readFileSync(adapterIn(cwd, ".agents/skills", "reflect"), "utf8"), "Hand-written.\n");
    assert.equal(out.includes(`${SKILLS.length} Claude Code skill adapters generated`), true);
    assert.equal(out.includes(`${SKILLS.length - 1} Codex skill adapters generated`), true);
    assert.equal(out.includes(".agents/skills/reflect/SKILL.md"), true);
    assert.equal(out.includes(".claude/skills/reflect/SKILL.md"), false);
  });

  it("reports an unwritable .agents rather than crashing on it", async () => {
    const cwd = makeRepository();
    // `.agents` is a file. Every path beneath it is unwritable, and the run
    // must say so per file rather than abort — the same contract the kit copy
    // has held since 1.0.
    writeFileSync(join(cwd, ".agents"), "not a directory\n");

    const { code, err } = await invoke(["--agents", "codex"], { cwd });

    assert.equal(code, 1);
    assert.equal(err.includes(".agents/skills/"), true);
    assert.equal(statSync(join(cwd, ".agents")).isFile(), true);
  });

  it("names both valid ids when asked for one that does not exist", async () => {
    const cwd = makeRepository();

    const { code, err } = await invoke(["--agents", "codecs"], { cwd });

    assert.equal(code, 2);
    assert.equal(err.includes("unknown agent `codecs`"), true);
    assert.equal(err.includes("Valid ids: claude-code, codex"), true);
    assert.equal(existsSync(join(cwd, ".agents")), false);
  });
});

describe("the interactive question", () => {
  it("offers every harness, defaulting to the detected ones", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude"));
    const prompter = scriptedPrompter({ harnesses: [] });

    await invoke([], { cwd, prompter });

    const [{ question, config }] = prompter.offered;
    assert.equal(question, "Configure Pathfinder for which tools?");
    assert.equal(config.options.length, 3);
    assert.match(config.options[0].label, /Claude Code\s+-> \.claude\/skills\/\s+\(detected\)/);

    // Offered, and visibly not detected. A harness the user does not have is
    // still a choice they may make; detection only decides the default.
    assert.match(config.options[1].label, /Codex\s+-> \.agents\/skills\/$/);

    // The third entry says what it writes in the same column as the other two,
    // because that column is where a reader looks to find out.
    assert.match(config.options[2].label, /Something else…\s+-> nothing is generated$/);

    assert.deepEqual(
      config.defaultSelection.map((harness) => harness.id),
      ["claude-code"],
    );
  });

  it("never offers the unsupported-tool entry as a default", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude"));
    mkdirSync(join(cwd, ".agents"));
    const prompter = scriptedPrompter({ harnesses: [] });

    await invoke([], { cwd, prompter });

    const [{ config }] = prompter.offered;
    assert.equal(config.defaultSelection.length, 2);
    assert.equal(
      config.defaultSelection.some((entry) => entry.skillsDir === undefined),
      false,
    );
  });

  it("defaults to both when both are detected", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude"));
    mkdirSync(join(cwd, ".agents"));
    const prompter = scriptedPrompter({ harnesses: [] });

    await invoke([], { cwd, prompter });

    const [{ config }] = prompter.offered;
    assert.deepEqual(
      config.defaultSelection.map((harness) => harness.id),
      ["claude-code", "codex"],
    );
  });

  it("generates nothing when the answer is none", async () => {
    const cwd = makeRepository();

    await invoke([], { cwd, prompter: scriptedPrompter({ harnesses: [] }) });

    assert.equal(existsSync(join(cwd, ".claude")), false);
  });

  it("generates what the answer asked for", async () => {
    const cwd = makeRepository();
    const { HARNESSES } = await import("../src/harnesses/index.mjs");

    await invoke([], { cwd, prompter: scriptedPrompter({ harnesses: [HARNESSES[0]] }) });

    assert.equal(readdirSync(join(cwd, ".claude", "skills")).length, SKILLS.length);
  });

  it("does not ask when --agents already said so", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({ harnesses: [] });

    await invoke(["--agents", "claude-code"], { cwd, prompter });

    assert.deepEqual(prompter.offered, []);
    assert.deepEqual(prompter.asked, []);
    assert.equal(existsSync(adapter(cwd, "reflect")), true);
  });
});

/**
 * "Something else…" — the option whose entire value is that it refuses.
 *
 * Pathfinder could write `.mdc` files for Cursor, or drop a `SKILL.md` into any
 * directory a tool might one day read. Every one of those would be a file the
 * tool ignores under a summary claiming success. These tests pin the opposite
 * behavior: zero files, an accurate explanation, and exit 0.
 */
describe("an unsupported tool", () => {
  it("installs the kit, generates nothing, names the tool, and exits 0", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({
      harnesses: byLabel("Something else"),
      typed: ["Zed"],
    });

    const { code, out } = await invoke([], { cwd, prompter });

    assert.equal(code, 0);
    assert.equal(existsSync(join(cwd, "skills", "reflect", "SKILL.md")), true);
    assert.equal(existsSync(join(cwd, ".claude")), false);
    assert.equal(existsSync(join(cwd, ".agents")), false);

    assert.equal(out.includes("Pathfinder has no native integration for Zed"), true);
    assert.equal(out.includes("AGENTS.md at the repository root"), true);
    assert.equal(out.includes("Use skills/<name>/SKILL.md and follow it exactly."), true);

    // No adapter arithmetic for a harness that was never chosen.
    assert.equal(/skill adapters? (generated|to generate)/.test(out), false);
  });

  it("records several names, in the order they were given", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({
      harnesses: byLabel("Something else"),
      typed: ["Zed", "Aider", "JetBrains AI", ""],
    });

    const { out } = await invoke([], { cwd, prompter });

    assert.equal(
      out.includes("no native integration for Zed, Aider, and JetBrains AI"),
      true,
    );
    assert.equal(out.includes("nothing is generated for them"), true);
  });

  it("collapses a name repeated in a different case", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({
      harnesses: byLabel("Something else"),
      typed: ["Zed", "zed", "ZED"],
    });

    const { out } = await invoke([], { cwd, prompter });

    assert.equal(out.includes("no native integration for Zed, so"), true);
    assert.equal(out.includes("nothing is generated for it."), true);
    assert.equal((out.match(/zed/gi) ?? []).length, 1);
  });

  // The message is an answer, not an apology and not a roadmap. A summary that
  // says "not yet" makes a promise nobody in this repository has made.
  it("neither apologizes nor implies a plan", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({
      harnesses: byLabel("Something else"),
      typed: ["Zed"],
    });

    const { out } = await invoke([], { cwd, prompter });

    for (const word of [
      "sorry",
      "unfortunately",
      "not yet",
      "for now",
      "planned",
      "roadmap",
      "coming",
      "future",
      "support for Zed",
    ]) {
      assert.equal(out.toLowerCase().includes(word.toLowerCase()), false, word);
    }
  });

  it("offers the real option instead of recording a supported tool twice", async () => {
    for (const [typed, label, id, dir] of [
      ["claude", "Claude Code", "claude-code", ".claude/skills"],
      ["Claude Code", "Claude Code", "claude-code", ".claude/skills"],
      ["claude-code", "Claude Code", "claude-code", ".claude/skills"],
      ["CODEX", "Codex", "codex", ".agents/skills"],
    ]) {
      const cwd = makeRepository();
      let printed = "";
      const prompter = scriptedPrompter({
        harnesses: byLabel("Something else"),
        typed: [typed],
      });

      const { out } = await invoke([], { cwd, prompter });
      printed = out;

      assert.equal(printed.includes(`${label} is supported`), true, typed);
      assert.equal(printed.includes(`--agents ${id}`), true, typed);
      assert.equal(printed.includes(`${dir}/`), true, typed);

      // Named, not recorded — and still not generated, because saying "that one
      // is real" is not the same as being told to configure it.
      assert.equal(printed.includes("no native integration"), false, typed);
      assert.equal(existsSync(join(cwd, ".claude")), false, typed);
      assert.equal(existsSync(join(cwd, ".agents")), false, typed);
    }
  });

  // "code" is almost certainly VS Code, not Codex. A prefix match would refuse
  // to record it and send the user to the wrong tool.
  it("does not claim a near-miss for a supported harness", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({
      harnesses: byLabel("Something else"),
      typed: ["code"],
    });

    const { out } = await invoke([], { cwd, prompter });

    assert.equal(out.includes("no native integration for code"), true);
    assert.equal(out.includes("is supported"), false);
  });

  it("refuses a name it could not print back faithfully, and keeps asking", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({
      harnesses: byLabel("Something else"),
      typed: [
        "../../etc/passwd",
        "tool; rm -rf /",
        "[31mred",
        "x".repeat(41),
        "",
        "Zed",
      ],
    });

    const { code, out } = await invoke([], { cwd, prompter });

    assert.equal(code, 0);
    assert.equal(out.includes("passwd"), false);
    assert.equal(out.includes("rm -rf"), false);
    assert.equal(out.includes("["), false);
    assert.equal(out.includes("x".repeat(41)), false);

    // The empty line ended the loop before `Zed` was reached, so nothing was
    // recorded at all — and the run still succeeded.
    assert.equal(out.includes("no native integration"), false);
  });

  it("stops asking after a bounded number of names", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({
      harnesses: byLabel("Something else"),
      typed: Array.from({ length: 40 }, (_, index) => `tool-${index}`),
    });

    await invoke([], { cwd, prompter });

    assert.equal(prompter.asked.length, 10);
    assert.equal(prompter.asked.every((question) => question === "Which tool? (Enter when done)"), true);
  });

  it("generates for the harnesses chosen alongside it, and only those", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({
      harnesses: byLabel("Codex", "Something else"),
      typed: ["Zed"],
    });

    const { code, out } = await invoke([], { cwd, prompter });

    assert.equal(code, 0);
    assert.equal(readdirSync(join(cwd, ".agents", "skills")).length, SKILLS.length);
    assert.equal(existsSync(join(cwd, ".claude")), false);
    assert.equal(out.includes(`${SKILLS.length} Codex skill adapters generated`), true);
    assert.equal(out.includes("no native integration for Zed"), true);
  });

  it("asks for no name when the option was not chosen", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({ harnesses: byLabel("Codex") });

    const { out } = await invoke([], { cwd, prompter });

    assert.deepEqual(prompter.asked, []);
    assert.equal(out.includes("no native integration"), false);
  });
});

describe("when the kit copy fails", () => {
  it("generates no adapters and says why", async () => {
    const cwd = makeRepository();
    // A directory where a kit file must go. The copy of that one file fails,
    // which is the situation an adapter must not paper over.
    mkdirSync(join(cwd, "CLAUDE.md"));

    // --force, because an existing path is otherwise skipped rather than
    // copied, and a skip is not a failure.
    const { code, out, err } = await invoke(["--agents", "claude-code", "--force"], { cwd });

    assert.equal(code, 1);
    assert.equal(existsSync(join(cwd, ".claude")), false);
    assert.equal(out.includes("No adapters were generated, because the kit copy did not finish."), true);
    assert.equal(err.includes("CLAUDE.md"), true);
    assert.equal(statSync(join(cwd, "CLAUDE.md")).isDirectory(), true);
  });
});

/**
 * The ASCII corrections, Feature 20.
 *
 * Four of the seven literals that used to be printed as Unicode regardless of
 * what the terminal could show. A `LANG=C` run used to receive an em dash and
 * an ellipsis it had already been told it could not render; it now receives the
 * ASCII forms, and these tests are where that promise is written down.
 *
 * The UTF-8 forms are covered by every other test in this file, all of which
 * run under a UTF-8 locale and none of which changed.
 */
describe("the ASCII corrections", () => {
  const ascii = { LANG: "C" };

  it("writes the sentinel's ellipsis in ASCII, and moves the arrows to match", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({ harnesses: [] });

    await invoke([], { cwd, prompter, env: ascii });

    const [{ config }] = prompter.offered;
    assert.match(config.options[2].label, /Something else\.\.\.\s+-> nothing is generated$/);

    // The sentinel is the longest row, so its width decides the column every
    // arrow lands in. Asserted across all three rows rather than on the one
    // that changed, because a column that only mostly lines up is the defect.
    const columns = config.options.map((option) => option.label.indexOf("->"));
    assert.deepEqual(columns, [columns[0], columns[0], columns[0]]);
  });

  it("keeps the UTF-8 column where it was", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({ harnesses: [] });

    await invoke([], { cwd, prompter });

    const [{ config }] = prompter.offered;
    assert.match(config.options[2].label, /Something else…\s+-> nothing is generated$/);
  });

  it("writes the supported-tool notice with an ASCII dash", async () => {
    const cwd = makeRepository();
    const prompter = scriptedPrompter({
      harnesses: byLabel("Something else"),
      typed: ["codex"],
    });

    const { out } = await invoke([], { cwd, prompter, env: ascii });

    assert.equal(out.includes("Codex is supported - it is in the list above"), true);
    assert.equal(out.includes("—"), false);
  });

  it("writes the conflict advice with an ASCII dash", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude", "skills", "debug-issue"), { recursive: true });
    writeFileSync(adapter(cwd, "debug-issue"), "---\nname: debug-issue\n---\n\nMy own.\n");

    const { out } = await invoke(["--agents", "claude-code"], { cwd, env: ascii });

    assert.equal(out.includes("Re-run with --force to replace it - note that --force also"), true);
  });

  it("writes the next-step line with an ASCII dash", async () => {
    const cwd = makeRepository();

    const { out } = await invoke(["--agents", "claude-code"], { cwd, env: ascii });

    assert.equal(out.includes("Next step - give your agent this prompt:"), true);
  });

  it("leaves no character above U+007F anywhere in an ASCII run", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude", "skills", "debug-issue"), { recursive: true });
    writeFileSync(adapter(cwd, "debug-issue"), "---\nname: debug-issue\n---\n\nMy own.\n");

    const { out, err } = await invoke(["--agents", "claude-code"], { cwd, env: ascii });

    // eslint-disable-next-line no-control-regex
    assert.match(out + err, /^[\x00-\x7F]*$/);
  });
});
