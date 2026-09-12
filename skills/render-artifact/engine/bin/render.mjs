#!/usr/bin/env node
/**
 * `render-artifact` — validate a specification, or deliver it as an artifact.
 *
 *   node bin/render.mjs validate <spec.json> [--repo <dir>] [--json]
 *   node bin/render.mjs deliver  <spec.json> <out.html> [--repo <dir>] [--json]
 *   node bin/render.mjs doctor   [--json]
 *
 * Exit codes are the contract, and a non-zero exit is never reported as
 * success:
 *
 *   0  every layer that ran passed, and the artifact was committed
 *   1  a validation or delivery layer failed; nothing was committed
 *   2  the command line was wrong
 *
 * `--repo` names the repository whose history evidence resolves in. It defaults
 * to the specification's own directory, which is right for a specification that
 * lives in the repository it cites, and is exactly what needs overriding when
 * it does not.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { RENDERER_VERSION } from "../version.mjs";
import { validateSpecification, formatReport } from "../validate/index.mjs";
import { deliver } from "../deliver.mjs";
import { doctor } from "../doctor.mjs";

const USAGE = `render-artifact ${RENDERER_VERSION}

  validate <spec.json> [--repo <dir>] [--json]
      Run the structural, composition and evidence layers. Writes nothing.

  deliver <spec.json> <out.html> [--repo <dir>] [--json]
      Validate, then render and commit the artifact atomically. Prints a
      receipt naming the renderer version and the digests it produced.

  doctor [--json]
      Report whether this machine can render at all. Does not validate any
      particular specification.
`;

function main(argv) {
  const flags = { json: false, repo: null };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === "--json") { flags.json = true; continue; }
    if (argument === "--repo") {
      i += 1;
      if (i >= argv.length) return usageError("--repo needs a directory");
      flags.repo = argv[i];
      continue;
    }
    if (argument === "--help" || argument === "-h") { process.stdout.write(USAGE); return 0; }
    if (argument.startsWith("-")) return usageError(`unknown option \`${argument}\``);
    positional.push(argument);
  }

  const [command, ...rest] = positional;
  if (command === undefined) return usageError("no command given");
  if (command === "doctor") return runDoctor(flags);
  if (command === "validate") return runValidate(rest, flags);
  if (command === "deliver") return runDeliver(rest, flags);
  return usageError(`unknown command \`${command}\``);
}

function runDoctor(flags) {
  const result = doctor();
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`render-artifact ${RENDERER_VERSION} — capability check\n\n`);
    for (const check of result.checks) {
      process.stdout.write(`  ${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}\n`);
    }
    process.stdout.write(
      "\n  This reports whether the engine can render here. It does not " +
      "validate\n  any specification, and the determinism check compares two " +
      "renders in\n  one process — cross-environment determinism is checked by " +
      "rendering the\n  same specification in different environments and " +
      "comparing digests.\n");
  }
  return result.ok ? 0 : 1;
}

function runValidate([specPath], flags) {
  if (!specPath) return usageError("validate needs a specification path");

  const loaded = loadSpec(specPath, flags);
  if (loaded.exitCode !== undefined) return loaded.exitCode;

  const result = validateSpecification(loaded.spec, { repoDir: repoDirFor(specPath, flags) });

  if (flags.json) {
    // `not_run` is reported here for the same reason it is in the human-readable
    // report: a caller that saw `ok: true` beside two layers, with nothing
    // saying why the third is missing, would have to infer the difference
    // between "everything passed" and "one layer did not apply" — and the point
    // of keeping the layers apart is that nobody has to infer it.
    process.stdout.write(`${JSON.stringify({
      ok: result.ok,
      renderer_version: RENDERER_VERSION,
      ran: result.ran,
      skipped: result.skipped,
      not_run: result.notRun,
      resolved_citations: result.resolvedCitations,
      diagnostics: result.diagnostics,
    }, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }

  process.stdout.write(`validating ${specPath}\n${formatReport(result)}\n`);
  process.stdout.write(result.ok
    ? "\nvalid. Nothing was written: `validate` never delivers.\n"
    : "\ninvalid. Nothing was written.\n");
  return result.ok ? 0 : 1;
}

function runDeliver([specPath, outPath], flags) {
  if (!specPath || !outPath) return usageError("deliver needs a specification path and an output path");

  // Read the bytes and hand only the bytes on. `deliver` parses, validates,
  // renders and digests from that one source, so the receipt cannot end up
  // describing a specification other than the one that was rendered.
  let specBytes;
  try {
    specBytes = readFileSync(specPath);
  } catch (error) {
    return reportLoadFailure(flags, "specification_unreadable", specPath, error.message);
  }

  const result = deliver(specBytes, specPath, outPath, { repoDir: repoDirFor(specPath, flags) });

  if (!result.ok) {
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        renderer_version: RENDERER_VERSION,
        delivered: false,
        diagnostics: result.diagnostics,
      }, null, 2)}\n`);
    } else if (result.validation) {
      process.stderr.write(`validating ${specPath}\n${formatReport(result.validation)}\n`);
      process.stderr.write(
        `\ninvalid. Nothing was delivered, and any artifact already at ` +
        `${outPath} is untouched.\n`);
    } else {
      for (const d of result.diagnostics) {
        process.stderr.write(`  FAIL delivery: [${d.code}] ${d.message}\n`);
      }
    }
    return 1;
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({
      ok: true, delivered: true, ...result.receipt,
    }, null, 2)}\n`);
    return 0;
  }

  const { receipt } = result;
  process.stdout.write([
    `validating ${specPath}`,
    formatReport(result.validation),
    "  ok delivery: rendered, digested, and committed atomically",
    "",
    "receipt",
    `  renderer version   ${receipt.renderer_version}`,
    `  specification      ${receipt.specification.path}`,
    `    sha256           ${receipt.specification.sha256}`,
    `    bytes            ${receipt.specification.bytes}`,
    `  artifact           ${receipt.artifact.path}`,
    `    sha256           ${receipt.artifact.sha256}`,
    `    bytes            ${receipt.artifact.bytes}`,
    "",
    "  Delivered. This says the artifact was validated and written, not that it",
    "  looks right — open it in a browser to know that.",
    "",
  ].join("\n"));
  return 0;
}

/** Where evidence resolves: `--repo` if given, otherwise the spec's directory. */
function repoDirFor(specPath, flags) {
  return resolve(flags.repo ?? dirname(resolve(specPath)));
}

function loadSpec(specPath, flags) {
  let bytes;
  try {
    bytes = readFileSync(specPath);
  } catch (error) {
    return { exitCode: reportLoadFailure(flags, "specification_unreadable", specPath, error.message) };
  }

  let spec;
  try {
    spec = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return { exitCode: reportLoadFailure(flags, "specification_not_json", specPath, error.message) };
  }

  return { spec, bytes };
}

function reportLoadFailure(flags, code, path, message) {
  const d = { layer: "structural", code, path, message };
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: false, diagnostics: [d] }, null, 2)}\n`);
  } else {
    process.stderr.write(`  FAIL structural: [${code}] ${path}\n       ${message}\n`);
  }
  return 1;
}

function usageError(message) {
  process.stderr.write(`render-artifact: ${message}\n\n${USAGE}`);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
