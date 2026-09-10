/**
 * Layer 4 — delivery. Parse, validate, render, digest, and commit atomically.
 *
 * Four properties this file exists to guarantee:
 *
 * 1. **One source of truth: the bytes.** `deliver` takes the specification as
 *    bytes and nothing else. It copies them, parses that copy, validates the
 *    parsed value, renders that same value, and reports the digest of those
 *    same bytes. There is deliberately no parameter through which a caller
 *    could supply an object alongside unrelated bytes — the receipt would then
 *    describe a specification that was never rendered, and nothing downstream
 *    could tell. The absent parameter is the guarantee; a check would only be
 *    a second thing to get wrong.
 * 2. **Verification is earned.** Delivery runs validation itself and mints its
 *    attestation from that result. The renderer emits a verification claim only
 *    against one, so an artifact that says its evidence was checked is an
 *    artifact whose evidence this process checked, moments earlier, from these
 *    bytes.
 * 3. **Atomic commit.** The artifact is written to a temporary file beside the
 *    destination and renamed over it. A rename within a directory is atomic, so
 *    a reader never sees a half-written page, and a failure at any earlier step
 *    leaves the previously delivered artifact exactly as it was.
 * 4. **A receipt that says what it checked.** Renderer version, and SHA-256 and
 *    byte count for both the specification and the artifact. The renderer
 *    version is in there because it is part of the deterministic input: the
 *    invariant is *same specification bytes and same renderer version*, so a
 *    receipt naming only the digests would describe half the compiler.
 */

import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, basename, join } from "node:path";

import { RENDERER_VERSION } from "./version.mjs";
import { render } from "./render/index.mjs";
import { diagnostic } from "./validate/diagnostics.mjs";
import { validateSpecification } from "./validate/index.mjs";
import { attest } from "./verification.mjs";

/**
 * @typedef {object} Receipt
 * @property {string} renderer_version
 * @property {{ path: string, sha256: string, bytes: number }} specification
 * @property {{ path: string, sha256: string, bytes: number }} artifact
 */

/**
 * Validate, render, and commit the specification held in `specBytes`.
 *
 * @param {Buffer} specBytes  the specification exactly as it was read
 * @param {string} specPath   where it was read from, for the receipt
 * @param {string} outPath    where the artifact is committed
 * @param {{ repoDir: string }} options  where evidence resolves
 * @returns {{ ok: true, receipt: Receipt, validation: object }
 *          | { ok: false, diagnostics: object[], validation?: object }}
 */
export function deliver(specBytes, specPath, outPath, { repoDir }) {
  // Copy first. Everything below — the parse, the render, the digest — reads
  // this copy, so a caller mutating its own buffer afterwards cannot leave the
  // receipt describing bytes that were never rendered.
  const frozenBytes = Buffer.from(specBytes);

  let spec;
  try {
    spec = JSON.parse(frozenBytes.toString("utf8"));
  } catch (error) {
    return fail("specification_not_json", specPath,
      `the specification could not be parsed, and nothing was written: ${error.message}`);
  }

  const validation = validateSpecification(spec, { repoDir });
  if (!validation.ok) {
    return { ok: false, validation, diagnostics: validation.diagnostics };
  }

  let html;
  try {
    // The attestation is minted here, from the validation just performed on
    // this parse of these bytes. It is the only thing that lets the artifact
    // say its evidence was checked.
    html = render(deepFreeze(structuredClone(spec)), attest(validation));
  } catch (error) {
    return fail("render_failed", outPath,
      `rendering threw and nothing was written: ${error.message}`);
  }

  // The invariant is about bytes, so check the bytes rather than trusting that
  // no template ever grew a `\r` or that no environment introduced a BOM.
  if (html.includes("\r")) {
    return fail("carriage_return_in_output", outPath,
      "rendered HTML contains a carriage return; artifacts use \\n only, on " +
      "every platform");
  }
  if (html.charCodeAt(0) === 0xFEFF) {
    return fail("byte_order_mark_in_output", outPath,
      "rendered HTML begins with a byte-order mark; artifacts are UTF-8 " +
      "without one");
  }

  const artifactBytes = Buffer.from(html, "utf8");

  try {
    commitAtomically(outPath, artifactBytes);
  } catch (error) {
    return fail("commit_failed", outPath,
      `the artifact could not be committed, and any previously delivered ` +
      `artifact is untouched: ${error.message}`);
  }

  return {
    ok: true,
    validation,
    receipt: {
      renderer_version: RENDERER_VERSION,
      specification: {
        path: specPath,
        sha256: sha256(frozenBytes),
        bytes: frozenBytes.byteLength,
      },
      artifact: {
        path: outPath,
        sha256: sha256(artifactBytes),
        bytes: artifactBytes.byteLength,
      },
    },
  };
}

/**
 * Render without writing anything and without validating anything.
 *
 * No attestation is minted, so the artifact makes no claim to have been
 * checked. Used by `doctor`, which is asking whether rendering works at all,
 * and by anyone comparing two renders rather than keeping either.
 */
export function renderOnly(spec) {
  const html = render(deepFreeze(structuredClone(spec)));
  const bytes = Buffer.from(html, "utf8");
  return { html, sha256: sha256(bytes), bytes: bytes.byteLength };
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(code, path, message) {
  return { ok: false, diagnostics: [diagnostic("delivery", code, path, message)] };
}

/**
 * Write beside the destination, flush to disk, then rename over it.
 *
 * The `fsync` matters as much as the rename: without it the rename can be
 * durable while the content behind it is not, which is how a crash leaves a
 * correctly named, empty artifact. The temporary name is derived from the
 * destination and the process id so two concurrent deliveries to one path do
 * not stage over each other.
 */
function commitAtomically(outPath, bytes) {
  const directory = dirname(outPath);
  const temporary = join(directory, `.${basename(outPath)}.${process.pid}.tmp`);

  let handle;
  try {
    writeFileSync(temporary, bytes, { encoding: null, mode: 0o644 });
    handle = openSync(temporary, "r+");
    fsyncSync(handle);
  } catch (error) {
    safeUnlink(temporary);
    throw error;
  } finally {
    if (handle !== undefined) closeSync(handle);
  }

  try {
    renameSync(temporary, outPath);
  } catch (error) {
    safeUnlink(temporary);
    throw error;
  }
}

function safeUnlink(path) {
  try {
    unlinkSync(path);
  } catch {
    /* Nothing to clean up, or nothing we can do about it. */
  }
}

/** Freeze an object graph in place, so rendering cannot mutate its own input. */
function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}
