/**
 * Files that live inside the kit but must never reach a destination project.
 *
 * `context/tracker.md` is the whole list, and its absence *is* Work Tracking's
 * off switch. Shipping this repository's copy would hand every new project a
 * configuration naming a tracker it does not own — with the switch already
 * flipped on before anybody asked for it.
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

import { planInstall } from "../src/install.mjs";
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
 * A copy of the real kit with a `context/tracker.md` planted in it.
 *
 * Copied rather than mutating the checkout, because the checkout is the
 * developer's working tree and a crashed test must not leave a stray config in
 * it — which is the very file this rule exists to keep out of places.
 */
function kitWithTrackerConfig() {
  const kitRoot = findKitRoot();
  assert.ok(kitRoot, "the kit root should resolve from a checkout");

  const fake = temporaryDirectory("pathfinder-never-ships-kit-");
  for (const entry of COPY_LIST) {
    cpSync(join(kitRoot, entry), join(fake, entry), { recursive: true });
  }
  writeFileSync(join(fake, "context", "tracker.md"), "# Tracker\n\nlocal only\n");
  return fake;
}

describe("neverShips", () => {
  it("matches the tracker config by kit-relative path", () => {
    assert.equal(neverShips("context/tracker.md"), true);
  });

  it("does not match a tracker.md living anywhere else", () => {
    // Basename matching would catch all of these, and every one of them is a
    // file some project legitimately wrote for itself.
    assert.equal(neverShips("tracker.md"), false);
    assert.equal(neverShips("templates/tracker.md"), false);
    assert.equal(neverShips("context/features/tracker.md"), false);
    assert.equal(neverShips("docs/context/tracker.md"), false);
  });

  it("leaves the rest of context/ alone", () => {
    assert.equal(neverShips("context/ai-interaction.md"), false);
    assert.equal(neverShips("context/current-feature.md"), false);
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
