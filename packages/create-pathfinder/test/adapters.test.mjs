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

/** A prompter that offers the harness question and answers it as told. */
function scriptedPrompter({ harnesses = [], interactive = true } = {}) {
  const offered = [];
  return {
    interactive,
    offered,
    confirm: async () => true,
    chooseMany: async (question, config) => {
      offered.push({ question, config });
      return harnesses;
    },
    close: () => {},
  };
}

async function invoke(argv, { cwd, prompter = scriptedPrompter({ interactive: false }) } = {}) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    cwd,
    out: (text) => (out += text),
    err: (text) => (err += text),
    env: {},
    platform: "linux",
    prompter,
  });
  return { code, out, err };
}

function adapter(cwd, name) {
  return join(cwd, ".claude", "skills", name, "SKILL.md");
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

describe("the interactive question", () => {
  it("offers every harness, defaulting to the detected ones", async () => {
    const cwd = makeRepository();
    mkdirSync(join(cwd, ".claude"));
    const prompter = scriptedPrompter({ harnesses: [] });

    await invoke([], { cwd, prompter });

    const [{ question, config }] = prompter.offered;
    assert.equal(question, "Configure Pathfinder for which tools?");
    assert.equal(config.options.length, 1);
    assert.match(config.options[0].label, /Claude Code\s+-> \.claude\/skills\/\s+\(detected\)/);
    assert.deepEqual(
      config.defaultSelection.map((harness) => harness.id),
      ["claude-code"],
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
    assert.equal(existsSync(adapter(cwd, "reflect")), true);
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
