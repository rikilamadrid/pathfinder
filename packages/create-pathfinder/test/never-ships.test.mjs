/**
 * Files that live inside the kit but must never reach a destination project.
 *
 * `context/tracker.md` is the original case, and its absence *is* Work
 * Tracking's off switch. Shipping this repository's copy would hand every new
 * project a configuration naming a tracker it does not own — with the switch
 * already flipped on before anybody asked for it.
 *
 * `context/history.md` is the case that is not like the others. It is durable
 * project truth, tracked in Git here exactly as a destination project tracks
 * its own — and that is why it must never be copied: the receiving project
 * would find somebody else's completed work filed as its own. Under `--force`
 * it would find its own overwritten, which is data loss rather than noise.
 *
 * Two paths can carry a kit file to a project and both are tested here,
 * because the file only has to escape through one of them:
 *
 *   1. the installer, running from a checkout — `planInstall`;
 *   2. the published tarball — `stage-kit.mjs`, which copies from the working
 *      tree and therefore does not care what `.gitignore` says.
 *
 * The second is the one that would actually have leaked. A `.gitignore` entry
 * looks like it solves this and does not.
 */

import { strict as assert } from "node:assert";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { applyPlan, planInstall } from "../src/install.mjs";
import { COPY_LIST, findKitRoot, neverShips, neverShipsFilter } from "../src/kit.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function temporaryDirectory(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

/**
 * A copy of the real kit with never-ships files planted in it.
 *
 * Copied rather than mutating the checkout, because the checkout is the
 * developer's working tree and a crashed test must not leave a stray config in
 * it — which is the very kind of file this rule exists to keep out of places.
 *
 * @param {Record<string, string>} planted kit-relative path to contents
 */
function kitWith(planted) {
  const kitRoot = findKitRoot();
  assert.ok(kitRoot, "the kit root should resolve from a checkout");

  const fake = temporaryDirectory("pathfinder-never-ships-kit-");
  for (const entry of COPY_LIST) {
    cpSync(join(kitRoot, entry), join(fake, entry), { recursive: true });
  }
  for (const [relativePath, contents] of Object.entries(planted)) {
    writeFileSync(join(fake, ...relativePath.split("/")), contents);
  }
  return fake;
}

function kitWithTrackerConfig() {
  return kitWith({ "context/tracker.md": "# Tracker\n\nlocal only\n" });
}

const PATHFINDER_HISTORY = "# History\n\n- Pathfinder's own completed work\n";

function kitWithHistory() {
  return kitWith({ "context/history.md": PATHFINDER_HISTORY });
}

describe("neverShips", () => {
  it("matches the tracker config by kit-relative path", () => {
    assert.equal(neverShips("context/tracker.md"), true);
  });

  it("matches transient session state by kit-relative path", () => {
    // Neither ships as a blank stencil any more — `/feature load` and `handoff`
    // write them on first use. What is being guarded against here is the
    // opposite leak: a maintainer's *filled-in* copy reaching a new project.
    assert.equal(neverShips("context/current-feature.md"), true);
    assert.equal(neverShips("context/handoff.md"), true);
  });

  it("does not match a tracker.md living anywhere else", () => {
    // Basename matching would catch all of these, and every one of them is a
    // file some project legitimately wrote for itself.
    assert.equal(neverShips("tracker.md"), false);
    assert.equal(neverShips("templates/tracker.md"), false);
    assert.equal(neverShips("context/features/tracker.md"), false);
    assert.equal(neverShips("docs/context/tracker.md"), false);
  });

  it("does not match transient state living anywhere else", () => {
    assert.equal(neverShips("current-feature.md"), false);
    assert.equal(neverShips("handoff.md"), false);
    assert.equal(neverShips("docs/context/handoff.md"), false);
  });

  it("matches this repository's own completed-work record", () => {
    // The one entry that is tracked in Git rather than ignored. Being durable
    // project truth is not a reason to ship it; it is a reason it belongs to
    // exactly one project, which is this one.
    assert.equal(neverShips("context/history.md"), true);
  });

  it("does not match a history.md living anywhere else", () => {
    // The template is what a destination project's own history is created
    // from, so it has to keep shipping. The rest are files a project wrote.
    assert.equal(neverShips("templates/history.template.md"), false);
    assert.equal(neverShips("history.md"), false);
    assert.equal(neverShips("context/features/history.md"), false);
    assert.equal(neverShips("docs/context/history.md"), false);
  });

  it("leaves the durable context files alone", () => {
    // The durable half of `context/` is exactly what a destination project is
    // supposed to receive, and is tracked in Git rather than ignored.
    assert.equal(neverShips("context/ai-interaction.md"), false);
    assert.equal(neverShips("context/coding-standards.md"), false);
    assert.equal(neverShips("context/project-overview.md"), false);
  });
});

describe("the installer", () => {
  it("plans nothing for a tracker config sitting in the kit", () => {
    const kitRoot = kitWithTrackerConfig();
    const target = temporaryDirectory("pathfinder-never-ships-target-");

    const plan = planInstall(kitRoot, target);

    assert.equal(
      plan.some((item) => item.relativePath === "context/tracker.md"),
      false,
      "context/tracker.md must never appear in an install plan",
    );
  });

  it("still plans the rest of context/", () => {
    const kitRoot = kitWithTrackerConfig();
    const target = temporaryDirectory("pathfinder-never-ships-target-");

    const plan = planInstall(kitRoot, target);
    const contextFiles = plan.filter((item) => item.relativePath.startsWith("context/"));

    assert.ok(
      contextFiles.length > 0,
      "excluding one file must not exclude the directory holding it",
    );
    assert.ok(
      contextFiles.some((item) => item.relativePath === "context/ai-interaction.md"),
      "context/ai-interaction.md is part of the kit and must still install",
    );
  });
});

describe("a project's own history", () => {
  /**
   * The data-loss case, and the reason this file earns a test of its own.
   *
   * `planInstall` marks an existing destination file `overwrite` under
   * `--force`, and `applyPlan` calls `copyFileSync`. A project that has been
   * running Pathfinder for a year and re-runs the installer to refresh its
   * skills would have had its completed-work record replaced by a stranger's.
   * Asserting the plan is not enough here: what matters is the bytes on disk
   * afterwards.
   */
  const OWN_HISTORY = "# History\n\n- 2026-01-01 — this project's own work\n";

  function projectWithHistory() {
    const target = temporaryDirectory("pathfinder-never-ships-target-");
    mkdirSync(join(target, "context"), { recursive: true });
    writeFileSync(join(target, "context", "history.md"), OWN_HISTORY);
    return target;
  }

  for (const force of [false, true]) {
    it(`survives an install byte for byte${force ? " under --force" : ""}`, () => {
      const kitRoot = kitWithHistory();
      const target = projectWithHistory();

      const plan = planInstall(kitRoot, target, { force });
      assert.equal(
        plan.some((item) => item.relativePath === "context/history.md"),
        false,
        "context/history.md must never appear in an install plan",
      );

      applyPlan(plan);

      assert.equal(
        readFileSync(join(target, "context", "history.md"), "utf8"),
        OWN_HISTORY,
        "the project's own history must be exactly as it was",
      );
    });
  }

  it("is not created in a project that has none", () => {
    const kitRoot = kitWithHistory();
    const target = temporaryDirectory("pathfinder-never-ships-target-");

    applyPlan(planInstall(kitRoot, target));

    assert.equal(
      existsSync(join(target, "context", "history.md")),
      false,
      "a project writes its own history on first completion, not at install",
    );
    assert.equal(
      existsSync(join(target, "templates", "history.template.md")),
      true,
      "the template it writes that history from must still ship",
    );
  });
});

describe("staging for publication", () => {
  /**
   * `stage-kit.mjs` resolves the repository from its own location, so it cannot
   * be pointed at a fixture. What it *can* be made to share is the predicate:
   * `neverShipsFilter` is the exact function the script hands to `cpSync`, so
   * these tests cover the real path arithmetic rather than a lookalike rebuilt
   * from basenames. A test that restates the filter proves only that `cpSync`
   * honours `filter`.
   */
  it("keeps the copy root, which cpSync asks about first", () => {
    // Returning false here would skip the entire subtree, so this is the one
    // answer the filter cannot afford to get wrong.
    const filter = neverShipsFilter("/kit");
    assert.equal(filter("/kit"), true);
    assert.equal(filter(join("/kit", "context")), true);
  });

  it("rejects the tracker config by its path, not its name", () => {
    const filter = neverShipsFilter("/kit");

    assert.equal(filter(join("/kit", "context", "tracker.md")), false);
    assert.equal(filter(join("/kit", "context", "ai-interaction.md")), true);
    assert.equal(filter(join("/kit", "templates", "tracker.md")), true);
    assert.equal(filter(join("/kit", "context", "features", "tracker.md")), true);
  });

  it("filters the tracker config out of a real recursive copy", () => {
    const source = temporaryDirectory("pathfinder-never-ships-source-");
    const destination = temporaryDirectory("pathfinder-never-ships-dest-");

    mkdirSync(join(source, "context", "features"), { recursive: true });
    writeFileSync(join(source, "context", "tracker.md"), "# Tracker\n");
    writeFileSync(join(source, "context", "ai-interaction.md"), "# Interaction\n");
    // A legitimate file the rule must not catch, one level deeper than the
    // config — basename matching would take this with it.
    writeFileSync(join(source, "context", "features", "tracker.md"), "# Spec\n");

    cpSync(join(source, "context"), join(destination, "context"), {
      recursive: true,
      filter: neverShipsFilter(source),
    });

    assert.equal(
      existsSync(join(destination, "context", "tracker.md")),
      false,
      "a staged kit must not carry the tracker config",
    );
    assert.equal(
      existsSync(join(destination, "context", "ai-interaction.md")),
      true,
      "everything else in context/ must still be staged",
    );
    assert.equal(
      existsSync(join(destination, "context", "features", "tracker.md")),
      true,
      "a tracker.md elsewhere in the tree is a different file",
    );
  });

  it("is the filter stage-kit.mjs actually applies", () => {
    // Guards the seam itself: if staging ever stops importing the shared
    // predicate, the tests above would keep passing against a function nothing
    // calls. That is the failure this whole finding was about.
    const script = readFileSync(
      new URL("../scripts/stage-kit.mjs", import.meta.url),
      "utf8",
    );

    assert.match(script, /filter:\s*neverShipsFilter\(REPO_ROOT\)/);
  });
});
