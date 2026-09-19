/**
 * A scratch project to run the ledger engine against.
 *
 * Every test gets its own directory with the real shipped template in it, so
 * the suite exercises the file a destination project actually receives rather
 * than a fixture that resembles it. Nothing here touches the checkout.
 *
 * The CLI is driven as a child process rather than imported, because the exit
 * code is part of the contract and a returned object cannot fail to be one.
 * Where a test is about a value rather than a status, it imports the module
 * directly instead.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

export const BIN = join(REPO, 'skills', 'reflect', 'engine', 'bin', 'ledger.mjs');
export const TEMPLATE = join(REPO, 'templates', 'improvement-ledger.template.md');
export const FIXTURE = join(REPO, 'packages', 'evidence-references', 'fixtures', 'references.json');

const made = [];

export function cleanup() {
  for (const directory of made) rmSync(directory, { recursive: true, force: true });
  made.length = 0;
}

/** A project with the shipped template and nothing else. */
export function project() {
  const root = mkdtempSync(join(tmpdir(), 'pathfinder-ledger-'));
  made.push(root);
  mkdirSync(join(root, 'templates'), { recursive: true });
  mkdirSync(join(root, 'context'), { recursive: true });
  cpSync(TEMPLATE, join(root, 'templates', 'improvement-ledger.template.md'));
  return root;
}

/** Run the CLI in `root`. `env` and `cwd` are overridable for the determinism tests. */
export function ledger(root, args, { cwd = root, env = {} } = {}) {
  // The subcommand comes first, as a person would type it; `--root` is an
  // option of that subcommand, not a word before it.
  const [command, ...rest] = args;
  const result = spawnSync(process.execPath, [BIN, command, '--root', root, ...rest], {
    cwd, encoding: 'utf8', env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export const ledgerFile = (root) => join(root, 'context', 'improvement-ledger.md');

export const read = (root) => readFileSync(ledgerFile(root), 'utf8');

/** The arguments of a complete, valid observation, so a test varies one thing. */
export function observation(overrides = {}) {
  const values = {
    observed: '2026-09-18',
    source: 'orchestration',
    scope: 'workflow',
    category: 'missing-contract',
    intervention: 'recovery',
    impact: 'high',
    title: 'A thing that happened',
    note: 'It happened, and this says what happened without saying what to do about it.',
    ...overrides,
  };
  const evidence = overrides.evidence ?? ['issue:111'];

  const args = [];
  for (const [name, value] of Object.entries(values)) {
    if (name === 'evidence' || value === null || value === undefined) continue;
    args.push(`--${name}`, String(value));
  }
  for (const ref of evidence) args.push('--evidence', ref);
  return args;
}

/** Record one valid observation, varying whatever the test cares about. */
export const recordOne = (root, overrides = {}) => ledger(root, ['record', ...observation(overrides)]);

/**
 * Every file in a tree, as path → contents, so a test can prove that a command
 * touched exactly one of them and nothing else appeared or vanished.
 */
export function snapshot(root) {
  const files = new Map();
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.set(relative(root, path).split(sep).join('/'), readFileSync(path, 'utf8'));
    }
  };
  walk(root);
  return files;
}

/** Paths that differ between two snapshots: changed, added or removed. */
export function touched(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
}

export { readFileSync, writeFileSync, statSync };
