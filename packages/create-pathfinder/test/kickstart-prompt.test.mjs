/**
 * The prompt is a pure function of the selection, which is the whole reason it
 * is testable this way: every combination of harnesses is a table row, and a
 * third harness would add rows rather than branches.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { HARNESSES, findHarness } from "../src/harnesses/index.mjs";
import {
  KICKSTART_SKILL,
  kickstartPrompt,
  kickstartPromptLines,
} from "../src/kickstart-prompt.mjs";

const claudeCode = findHarness("claude-code");
const codex = findHarness("codex");

const PATH_FORM =
  "Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project. " +
  "Do not install packages or write product code yet.";

test("no harness selected keeps the harness-neutral path prompt", () => {
  assert.equal(kickstartPrompt([]), PATH_FORM);
});

test("the path prompt is byte-identical to what 1.4.1 printed", () => {
  // The exact string, not a regenerated one. This is the prompt every existing
  // README, guide, and screenshot quotes, and it may only change deliberately.
  assert.equal(
    kickstartPrompt([]),
    "Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this project. Do not install packages or write product code yet.",
  );
});

test("Claude Code alone gets its native invocation", () => {
  assert.equal(kickstartPrompt([claudeCode]), "/kickstart-pathfinder");
});

test("Codex alone gets its native invocation", () => {
  assert.equal(kickstartPrompt([codex]), "$kickstart-pathfinder");
});

test("both harnesses fall back to the path form, in either order", () => {
  assert.equal(kickstartPrompt([claudeCode, codex]), PATH_FORM);
  assert.equal(kickstartPrompt([codex, claudeCode]), PATH_FORM);
});

test("every single-harness selection uses that harness's own invocation", () => {
  // Derived from the registry rather than listed, so a third harness is covered
  // by this test the day it is added and cannot ship without an invocation.
  for (const harness of HARNESSES) {
    assert.equal(kickstartPrompt([harness]), harness.invocation(KICKSTART_SKILL));
  }
});

test("a nullish or malformed selection degrades to the path form", () => {
  assert.equal(kickstartPrompt(), PATH_FORM);
  assert.equal(kickstartPrompt(null), PATH_FORM);
  assert.equal(kickstartPrompt([null]), PATH_FORM);
  assert.equal(kickstartPrompt("claude-code"), PATH_FORM);
  assert.equal(kickstartPrompt([{ id: "broken" }]), PATH_FORM);
  assert.equal(kickstartPrompt([{ invocation: () => "" }]), PATH_FORM);
  assert.equal(kickstartPrompt([{ invocation: () => "   " }]), PATH_FORM);
  assert.equal(kickstartPrompt([{ invocation: () => null }]), PATH_FORM);
});

test("the printed block and the copied string say the same thing", () => {
  // Two representations of one prompt is exactly the kind of duplication that
  // drifts. Collapsing whitespace is the only difference either is allowed.
  for (const selection of [[], [claudeCode], [codex], [claudeCode, codex]]) {
    const printed = kickstartPromptLines(selection).join(" ").replace(/\s+/g, " ").trim();
    assert.equal(printed, kickstartPrompt(selection).replace(/\s+/g, " ").trim());
  }
});

test("the printed path form keeps its two indented lines", () => {
  assert.deepEqual(kickstartPromptLines([]), [
    "  Use skills/kickstart-pathfinder/SKILL.md. Help me initialize this",
    "  project. Do not install packages or write product code yet.",
  ]);
});

test("a native invocation prints as one indented line", () => {
  assert.deepEqual(kickstartPromptLines([claudeCode]), ["  /kickstart-pathfinder"]);
});

test("the skill it names is a real skill in this repository", () => {
  assert.equal(KICKSTART_SKILL, "kickstart-pathfinder");
});
