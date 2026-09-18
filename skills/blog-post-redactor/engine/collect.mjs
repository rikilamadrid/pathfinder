/**
 * Stage 1: evidence extraction.
 *
 * Read-only by construction, not by promise. Every git subcommand this module
 * is allowed to run is on an allowlist, and anything else throws before it
 * reaches a process. The article pipeline never needs to write to the
 * repository it is describing, so it is not given the ability to.
 *
 * The collector reports what it could not find as loudly as what it found.
 * `missing` is the input to honesty downstream: it lowers evidence confidence
 * and it is what turns an appealing claim into `[NEEDS HUMAN CONFIRMATION]`.
 */

import { parseScope, describeScope, isUnresolved } from './scope.mjs';

/** Git subcommands that cannot alter the repository, its index, or its refs. */
export const READ_ONLY_GIT = new Set([
  'log', 'show', 'diff', 'status', 'rev-parse', 'rev-list', 'merge-base',
  'describe', 'ls-files', 'ls-tree', 'cat-file', 'shortlog', 'name-rev',
  'symbolic-ref', 'for-each-ref', 'config',
]);

/** Flags that turn an otherwise read-only subcommand into a writing one. */
const WRITING_FLAGS = new Set(['--replace-all', '--add', '--unset', '--edit']);

export function assertReadOnlyGit(args) {
  const [subcommand] = args;
  if (!READ_ONLY_GIT.has(subcommand)) {
    throw new Error(
      `blog-post-redactor refuses to run \`git ${subcommand}\`: evidence collection is read-only`
    );
  }
  for (const arg of args) {
    if (WRITING_FLAGS.has(arg)) {
      throw new Error(
        `blog-post-redactor refuses \`git ${subcommand} ${arg}\`: evidence collection is read-only`
      );
    }
  }
  return true;
}

// Unit and record separators. Commit subjects and bodies contain newlines and
// every printable punctuation mark, so the format needs delimiters that prose
// cannot produce by accident.
const FIELD = '';
const RECORD = '';
const LOG_FORMAT = ['%H', '%an', '%aI', '%s', '%b'].join(FIELD) + RECORD;

/** Docs worth reading whenever they exist, because they state intent. */
const STANDING_DOCS = [
  'CHANGELOG.md',
  'README.md',
  'context/history.md',
  'context/project-overview.md',
  'context/current-ticket.md',
  'ARCHITECTURE.md',
  'docs/architecture.md',
];

const ASSET_PATTERN = /\.(png|jpe?g|gif|svg|webp|mp4|webm|pdf)$/i;
const TEST_PATTERN = /(^|\/)(tests?|__tests__|spec)\//i;
const TEST_FILE_PATTERN = /\.(test|spec)\.[a-z]+$/i;

/**
 * @param {object} io
 * @param {(cmd: string, args: string[]) => {status: number, stdout: string}} io.run
 * @param {(path: string) => string|null} io.readFile
 * @param {(path: string) => boolean} io.exists
 * @param {string[]} [io.argv]
 */
export function collect({ run, readFile, exists, argv = [], scope: given = null }) {
  const scope = given ?? parseScope(argv);
  const missing = [];
  const warnings = [];

  const git = (...args) => {
    assertReadOnlyGit(args);
    const result = run('git', args);
    return result && result.status === 0 ? result.stdout.trim() : null;
  };

  const head = git('rev-parse', 'HEAD');
  if (!head) {
    return emptyBundle(scope, ['not a git repository, or no commits yet']);
  }

  const range = resolveRange({ git, scope, missing, warnings });
  const commits = range ? readCommits(git, range) : [];
  if (range && commits.length === 0) {
    missing.push(`no commits found for ${describeScope(scope)}`);
  }

  const files = range ? readFiles(git, range) : [];
  const docs = readDocs({ readFile, exists, files });
  const changelog = readChangelog(readFile);
  const { prs, issues } = readPullRequests({ run, scope, commits, warnings });
  const tests = detectTests(files);
  const assets = files.filter((file) => ASSET_PATTERN.test(file.path));
  const commands = range ? [{ command: `git log ${range}`, purpose: 'commit list' }] : [];

  if (!changelog) missing.push('no CHANGELOG.md, so no stated user-facing effect');
  if (tests.length === 0) {
    missing.push('no test files in the diff, so no verification evidence from the change itself');
  }
  if (prs.length === 0 && scope.kind === 'pr') {
    missing.push(`pull request #${scope.value} could not be read`);
  }
  if (isUnresolved(scope)) {
    missing.push(`scope "${scope.value}" names work in human terms and is not pinned to a git ref`);
  }

  return {
    scope: { ...scope, description: describeScope(scope) },
    range,
    head,
    commits,
    files,
    docs,
    changelog,
    prs,
    issues,
    tests,
    assets,
    commands,
    warnings,
    missing,
  };
}

function emptyBundle(scope, missing) {
  return {
    scope: { ...scope, description: describeScope(scope) },
    range: null, head: null, commits: [], files: [], docs: [], changelog: null,
    prs: [], issues: [], tests: [], assets: [], commands: [], warnings: [], missing,
  };
}

function resolveRange({ git, scope, missing, warnings }) {
  if (scope.kind === 'range') return scope.value;

  if (scope.kind === 'since') {
    const resolved = git('rev-parse', '--verify', `${scope.value}^{commit}`);
    if (!resolved) {
      missing.push(`ref \`${scope.value}\` does not exist in this repository`);
      return null;
    }
    return `${scope.value}..HEAD`;
  }

  if (scope.kind === 'pr') {
    // The PR's own record is read through the host below; a local range for it
    // is not assumed, because the branch may not be checked out here.
    return null;
  }

  if (scope.kind === 'label') return null;

  // working: this branch against the default branch it forked from.
  const defaultRef =
    git('symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD') ??
    (git('rev-parse', '--verify', '--quiet', 'origin/main') ? 'origin/main' : null) ??
    (git('rev-parse', '--verify', '--quiet', 'main') ? 'main' : null);

  if (!defaultRef) {
    warnings.push('no default branch found; falling back to the last commit only');
    return 'HEAD~1..HEAD';
  }

  const base = git('merge-base', defaultRef, 'HEAD');
  if (!base) {
    warnings.push(`could not find a merge base with ${defaultRef}`);
    return 'HEAD~1..HEAD';
  }
  return `${base}..HEAD`;
}

function readCommits(git, range) {
  const out = git('log', `--format=${LOG_FORMAT}`, '--no-merges', range);
  if (!out) return [];

  return out
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, author, date, subject, body] = record.split(FIELD);
      return { sha, author, date, subject, body: (body ?? '').trim() };
    })
    .filter((commit) => Boolean(commit.sha));
}

function readFiles(git, range) {
  const out = git('diff', '--numstat', range);
  if (!out) return [];

  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [added, removed, path] = line.split(/\t/);
      return {
        path,
        added: added === '-' ? null : Number(added),
        removed: removed === '-' ? null : Number(removed),
        binary: added === '-',
      };
    })
    .filter((file) => Boolean(file.path));
}

function readDocs({ readFile, exists, files }) {
  const paths = new Set(STANDING_DOCS.filter((path) => exists(path)));
  for (const file of files) {
    if (/\.mdx?$/i.test(file.path) && exists(file.path)) paths.add(file.path);
  }

  const docs = [];
  for (const path of [...paths].sort()) {
    const text = readFile(path);
    if (text == null) continue;
    docs.push({ path, headings: headingsOf(text), bytes: text.length });
  }
  return docs;
}

function headingsOf(text) {
  return text
    .split('\n')
    .filter((line) => /^#{1,3}\s+\S/.test(line))
    .map((line) => line.replace(/^#+\s+/, '').trim())
    .slice(0, 40);
}

function readChangelog(readFile) {
  const text = readFile('CHANGELOG.md');
  if (text == null) return null;

  const sections = [];
  let current = null;

  for (const line of text.split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current) sections.push(current);
      current = { heading: heading[1], entries: [] };
      continue;
    }
    if (current && /^\s*-\s+\S/.test(line)) {
      current.entries.push(line.replace(/^\s*-\s+/, '').trim());
    }
  }
  if (current) sections.push(current);

  return { path: 'CHANGELOG.md', sections };
}

/**
 * Pull requests, when a host CLI is present. Their absence is ordinary — a
 * repository with no `gh`, or no network, still has commits — so it produces a
 * warning rather than a failure.
 */
function readPullRequests({ run, scope, commits, warnings }) {
  const prs = [];
  const issues = [];

  const numbers = new Set();
  if (scope.kind === 'pr') numbers.add(String(scope.value));
  for (const commit of commits) {
    const match = /\(#(\d+)\)\s*$/.exec(commit.subject ?? '');
    if (match) numbers.add(match[1]);
  }
  if (numbers.size === 0) return { prs, issues };

  for (const number of [...numbers].sort((a, b) => Number(a) - Number(b))) {
    const result = run('gh', [
      'pr', 'view', String(number),
      '--json', 'number,title,body,state,mergedAt,url',
    ]);
    if (!result || result.status !== 0) {
      warnings.push(
        `pull request #${number} could not be read (gh unavailable or not authenticated)`
      );
      continue;
    }
    try {
      prs.push(JSON.parse(result.stdout));
    } catch {
      warnings.push(`pull request #${number} returned unreadable JSON`);
    }
  }

  return { prs, issues };
}

function detectTests(files) {
  const suites = new Map();
  for (const file of files) {
    if (!TEST_PATTERN.test(file.path) && !TEST_FILE_PATTERN.test(file.path)) continue;
    const parts = file.path.split('/');
    const root = parts.length > 1 ? parts.slice(0, -1).join('/') : file.path;
    if (!suites.has(root)) suites.set(root, { path: root, files: [] });
    suites.get(root).files.push(file.path);
  }
  return [...suites.values()].sort((a, b) => a.path.localeCompare(b.path));
}
