#!/usr/bin/env node
/**
 * The two deterministic ends of the pipeline, as commands.
 *
 * Only `collect` and `verify` live here. Choosing an angle and writing the
 * article are judgment, and judgment belongs to the agent reading the stage
 * files — not to a script pretending to have taste.
 *
 * This process writes inside the output directory and nowhere else.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collect } from '../collect.mjs';
import { parseScope, describeScope } from '../scope.mjs';
import { verify, parseVoiceRules } from '../verify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = `blog-post-redactor engine

  collect [scope] [--out <dir>]   Collect read-only evidence into <dir>/evidence.json
  verify  [--dir <dir>]           Check the produced blog post against that evidence

Scope selectors (collect):
  --pr <number>        one pull request
  --since <ref>        commits since a ref
  --range <a>..<b>     an explicit commit range
  "<free text>"        a human-named scope, carried as unresolved
  (none)               this branch against its default branch

Options:
  --cwd <dir>          repository to read (default: current directory)
  --out, --dir <dir>   output directory (default: blog-posts)
  -h, --help
`;

function flag(argv, ...names) {
  for (const name of names) {
    const index = argv.indexOf(name);
    if (index !== -1 && argv[index + 1]) return argv[index + 1];
  }
  return null;
}

function runner(cwd) {
  return (cmd, args) => {
    const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.error) return { status: 1, stdout: '', stderr: String(result.error) };
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
}

function io(cwd) {
  return {
    run: runner(cwd),
    readFile: (path) => {
      try {
        return readFileSync(resolve(cwd, path), 'utf8');
      } catch {
        return null;
      }
    },
    exists: (path) => existsSync(resolve(cwd, path)),
  };
}

function changedPaths(cwd) {
  const result = runner(cwd)('git', ['status', '--porcelain']);
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((line) => (line.includes(' -> ') ? line.split(' -> ')[1] : line));
}

function commandCollect(argv) {
  const cwd = resolve(flag(argv, '--cwd') ?? process.cwd());
  const out = flag(argv, '--out', '--dir') ?? 'blog-posts';
  const scope = parseScope(argv);
  const bundle = collect({ ...io(cwd), scope });

  const dir = resolve(cwd, out);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'evidence.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');

  console.log(`scope:     ${describeScope(scope)}`);
  console.log(`range:     ${bundle.range ?? '(none resolved)'}`);
  console.log(`commits:   ${bundle.commits.length}`);
  console.log(`files:     ${bundle.files.length}`);
  console.log(`prs:       ${bundle.prs.length}`);
  console.log(`tests:     ${bundle.tests.length}`);
  console.log(`docs:      ${bundle.docs.length}`);
  console.log(`written:   ${join(out, 'evidence.json')}`);

  if (bundle.warnings.length > 0) {
    console.log('\nwarnings:');
    for (const warning of bundle.warnings) console.log(`  - ${warning}`);
  }
  if (bundle.missing.length > 0) {
    console.log('\nmissing evidence (drives confidence and confirmation markers):');
    for (const gap of bundle.missing) console.log(`  - ${gap}`);
  }

  return 0;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function commandVerify(argv) {
  const cwd = resolve(flag(argv, '--cwd') ?? process.cwd());
  const out = flag(argv, '--dir', '--out') ?? 'blog-posts';
  const dir = resolve(cwd, out);

  const bundle = readJson(join(dir, 'evidence.json'));
  if (!bundle) {
    console.error(`no readable ${join(out, 'evidence.json')}; run \`collect\` first`);
    return 1;
  }

  const voice = readText(resolve(HERE, '..', '..', 'voice.md'));
  const report = verify({
    bundle,
    metadata: readJson(join(dir, 'metadata.json')),
    article: readText(join(dir, 'article.md')),
    evidence: readText(join(dir, 'evidence.md')),
    changedPaths: changedPaths(cwd),
    outputDir: out,
    bannedPhrases: parseVoiceRules(voice).bannedPhrases,
  });

  for (const item of report.findings) {
    console.log(`${item.severity.toUpperCase()}  ${item.rule}: ${item.message}`);
  }

  console.log(
    report.findings.length === 0
      ? 'OK — every claim traces to collected evidence'
      : `\n${report.errors} error(s), ${report.warnings} warning(s)`
  );

  return report.ok ? 0 : 1;
}

function main(argv) {
  const [command, ...rest] = argv;

  if (!command || command === '-h' || command === '--help') {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  try {
    if (command === 'collect') return commandCollect(rest);
    if (command === 'verify') return commandVerify(rest);
  } catch (error) {
    console.error(String(error.message ?? error));
    return 1;
  }

  console.error(`unknown command: ${command}\n`);
  console.log(USAGE);
  return 1;
}

process.exit(main(process.argv.slice(2)));
