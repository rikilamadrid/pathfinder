/**
 * What a human does to turn a generated handler on, and how they turn it off.
 *
 * Pathfinder generates the handler and stops. Activation is native harness
 * configuration in a file Pathfinder does not own, does not read, and never
 * writes — so the only thing this package can offer is the exact text to paste
 * and an honest account of what happens if nobody pastes it.
 *
 * That is why this module is prose and nothing else. It imports no `node:fs`,
 * holds no path to a settings file it might one day open, and returns strings.
 * `test/hooks.test.mjs` asserts both halves of that: this is the one module
 * under `src/` allowed to name a settings file, and it is allowed to precisely
 * because it cannot act on one.
 *
 * The fragment is built from the registry's stable handler path rather than
 * written out, so a fragment that no longer matches what the installer
 * generates is not a thing this package can print.
 *
 * The handler ships mode 0644 and is not executable, whatever its shebang
 * says, so the command runs it through Node. `$CLAUDE_PROJECT_DIR` is what
 * keeps the activation correct from a subdirectory and inside a worktree.
 */

import { HARNESSES } from "./harnesses/index.mjs";
import { hookPath, hooksFor } from "./harnesses/hook.mjs";

/** Where a human puts the fragment. The first is the documented default. */
export const DEFAULT_SURFACE = ".claude/settings.local.json";
export const SHARED_SURFACE = ".claude/settings.json";

/**
 * Does this harness declare that it can run a handler at all?
 *
 * Read from the registry — `hooksDir` is the field that says "this tool has a
 * place handlers go" — rather than from the length of `hooks`, which is the
 * thing being checked. Codex answers no, and that is a correct answer, not a
 * gap: it gets no handler and no activation prose.
 */
export function supportsActivation(harness) {
  return typeof harness?.hooksDir === "string" && harness.hooksDir !== "";
}

/**
 * The one handler a capable harness activates, or null for a harness that has
 * no place to put one.
 *
 * v1 ships exactly one orientation handler per capable harness, and this is
 * where that assumption is stated instead of assumed. `hooksFor(harness)[0]`
 * reads identically whether the registry holds one handler, none, or three —
 * which is precisely the property that makes it unsafe: a registry that lost
 * its hook would print no fragment and a registry that grew a second one would
 * silently document the first. Both are wrong, and both are silent.
 *
 * So a capable harness that does not resolve to exactly one handler throws.
 * Callers that legitimately have nothing to say — a Codex run — are served by
 * the null, not by the throw.
 *
 * @throws {Error} when the registry and this assumption disagree.
 */
export function activationHandler(harness) {
  const hooks = hooksFor(harness);

  if (!supportsActivation(harness)) {
    if (hooks.length > 0) {
      throw new Error(
        `activation: ${harness?.id ?? "harness"} declares ${hooks.length} handler(s) ` +
          "but no hooksDir to put them in",
      );
    }
    return null;
  }

  if (hooks.length !== 1) {
    throw new Error(
      `activation: ${harness.id} supports session orientation, so exactly one handler ` +
        `must resolve; the registry gives ${hooks.length}`,
    );
  }

  return hooks[0];
}

/**
 * Every harness this build can print activation for, with its handler.
 *
 * Exported for `validate-kit.py`, which needs the set rather than one harness:
 * checking the guide against `claude-code` alone would pass unchanged on the
 * day a second capable harness is added and left undocumented.
 *
 * Throws for the same reasons `activationHandler` does, which is the point —
 * a validator that enumerates this cannot pass vacuously.
 */
export function activationTargets() {
  return HARNESSES.map((harness) => ({ harness, hook: activationHandler(harness) })).filter(
    ({ hook }) => hook !== null,
  );
}

/**
 * The command that runs one handler, quoted for a shell.
 *
 * Exported for the documentation build and the tests, which check the site and
 * the installer against one spelling rather than two.
 */
export function activationCommand(harness, hook) {
  return `node "$CLAUDE_PROJECT_DIR/${hookPath(harness, hook)}"`;
}

/**
 * The native fragment, as the lines a person pastes.
 *
 * The matcher is deliberately omitted, so one entry covers the lifecycle
 * sources without naming any of them.
 *
 * `startup`, `resume`, `clear`, and `compact` were each observed live per
 * source against a real install, not inferred from `startup`. `fork` was not:
 * the reachable surface, `claude --resume --fork-session`, emits
 * `source: "resume"`, so it was covered by driving the handler with a `fork`
 * payload instead. The handler branches on the source for nothing, which is
 * what bounds what that weaker evidence can cost.
 */
export function activationFragmentLines(harness, hook) {
  return [
    "{",
    '  "hooks": {',
    '    "SessionStart": [',
    "      {",
    '        "hooks": [',
    "          {",
    '            "type": "command",',
    `            "command": ${JSON.stringify(activationCommand(harness, hook))}`,
    "          }",
    "        ]",
    "      }",
    "    ]",
    "  }",
    "}",
  ];
}

/**
 * The whole activation note for one harness, as undecorated lines.
 *
 * Returned as text rather than printed, so the two renderings in `cli.mjs`
 * decorate one set of sentences instead of each keeping their own copy — the
 * same reason `outcome.mjs` exists. Empty for a harness with no handler, which
 * is how a Codex run says nothing at all about activation.
 *
 * `dryRun` changes tense and nothing else. A dry run has written no handler, so
 * a note that says "the handler is inert" is describing a file that is not
 * there — the one sentence on that screen a reader could act on and be wrong
 * about. The fragment itself is identical in both modes, because the path it
 * points at is the path the real run will write.
 *
 * The unactivated answer is stated in the same breath as the fragment, because
 * a reader who decides not to paste it is owed the consequence on the same
 * screen: no automatic orientation, and `/whereami` on demand.
 */
export function activationLines(harness, { dryRun = false } = {}) {
  const hook = activationHandler(harness);
  if (!hook) return [];

  const opening = dryRun
    ? [
        "The handler would be inert. Once installed it would run only if you add",
        `this to ${DEFAULT_SURFACE}:`,
      ]
    : [
        "The handler is inert. It runs only if you add this to",
        `${DEFAULT_SURFACE}:`,
      ];

  const closing = dryRun
    ? [
        "Without the fragment there would be no automatic orientation. Nothing else",
        "would change: run /whereami whenever you want the same picture.",
        "To remove it later, delete the handler and drop the fragment. Either order",
        "is fine, and so is doing only one: an unreferenced handler never runs.",
        "A fragment for a missing handler is a no-op that cannot block a session.",
      ]
    : [
        "Without the fragment there is no automatic orientation. Nothing else",
        "changes: run /whereami whenever you want the same picture.",
        "To remove it later, delete the handler and drop the fragment. Either order",
        "is fine, and so is doing only one: an unreferenced handler never runs.",
        "A fragment for a missing handler is a no-op that cannot block a session.",
      ];

  return [
    ...opening,
    "",
    ...activationFragmentLines(harness, hook),
    "",
    `${DEFAULT_SURFACE} keeps the choice yours and`,
    `per-machine. Use ${SHARED_SURFACE} only to turn it on for everyone`,
    "who clones the repository.",
    ...closing,
  ];
}
