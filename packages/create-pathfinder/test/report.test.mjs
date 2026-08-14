/**
 * The findings report.
 *
 * Two properties matter more than the wording: it stays short, and it never
 * claims an intention. Both are asserted here rather than left to review,
 * because both are the kind of thing a later feature adds one more line to.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { formatFindings } from "../src/cli.mjs";
import { createTheme } from "../src/theme.mjs";

function findings({ git = {}, pathfinder = {}, tools = [] } = {}) {
  return {
    git: { repositoryRoot: null, insideRepository: false, binary: true, ...git },
    pathfinder: { installed: false, skillCount: 0, ...pathfinder },
    tools: [
      { id: "claude-code", label: "Claude Code", detected: false },
      { id: "codex", label: "Codex", detected: false },
      { id: "vscode", label: "VS Code", detected: false },
      { id: "cursor", label: "Cursor", detected: false },
    ].map((tool) => ({ ...tool, detected: tools.includes(tool.id) })),
  };
}

/** The report's content, without its surrounding blank lines. */
function contentLines(report) {
  return report.split("\n").filter((line) => line.trim() !== "");
}

describe("formatFindings — Git", () => {
  it("reports a repository when one was found", () => {
    const report = formatFindings(findings({ git: { insideRepository: true } }));

    assert.match(report, /\+ Git repository detected/);
  });

  it("reports the absence plainly when git is available to fix it", () => {
    const report = formatFindings(findings({ git: { binary: true } }));

    assert.match(report, /- No Git repository here/);
  });

  it("names the missing binary, because that changes what the user can do", () => {
    const report = formatFindings(findings({ git: { binary: false } }));

    assert.match(report, /! No Git repository here, and `git` is not on your PATH/);
  });
});

describe("formatFindings — installation and tools", () => {
  it("reports an existing installation with its skill count", () => {
    const report = formatFindings(findings({ pathfinder: { installed: true, skillCount: 20 } }));

    assert.match(report, /\+ Pathfinder already installed \(20 skills\)/);
  });

  it("says nothing about installation when there is none", () => {
    assert.doesNotMatch(formatFindings(findings()), /already installed/);
  });

  it("singularizes a lone skill", () => {
    const report = formatFindings(findings({ pathfinder: { installed: true, skillCount: 1 } }));

    assert.match(report, /\(1 skill\)/);
  });

  it("lists detected tools on one line, in table order", () => {
    const report = formatFindings(findings({ tools: ["vscode", "claude-code"] }));

    assert.match(report, /\+ Tools detected: Claude Code, VS Code \(noted, not configured\)/);
  });

  it("says so when nothing was detected", () => {
    assert.match(formatFindings(findings()), /- No supported tools detected/);
  });
});

describe("formatFindings — shape", () => {
  it("stays within five content lines when everything is detected", () => {
    const report = formatFindings(
      findings({
        git: { insideRepository: true },
        pathfinder: { installed: true, skillCount: 20 },
        tools: ["claude-code", "codex", "vscode", "cursor"],
      }),
    );

    assert.ok(contentLines(report).length <= 5, `report was ${contentLines(report).length} lines`);
  });

  it("states facts and promises nothing", () => {
    const report = formatFindings(
      findings({
        git: { insideRepository: true },
        tools: ["claude-code", "codex"],
      }),
    );

    assert.doesNotMatch(report, /\b(will|going to|about to|configuring|setting up)\b/i);
  });

  it("is pure ASCII by default", () => {
    const report = formatFindings(
      findings({ git: { insideRepository: true }, tools: ["claude-code"] }),
    );

    // eslint-disable-next-line no-control-regex
    assert.match(report, /^[\x00-\x7F]*$/);
  });

  it("uses the decorated marks only when asked", () => {
    const report = formatFindings(findings({ git: { insideRepository: true } }), {
      theme: createTheme({ env: { LANG: "en_US.UTF-8" }, platform: "linux", isTTY: true }),
    });

    assert.match(report, /✓ Git repository detected/);
  });

  it("is fenced by a blank line at both ends, so it never runs into its neighbours", () => {
    const report = formatFindings(findings());

    assert.ok(report.startsWith("\n"));
    assert.ok(report.endsWith("\n\n"));
    assert.ok(!report.endsWith("\n\n\n"));
  });
});
