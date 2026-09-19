/**
 * Scope selectors. One place that decides what "the work" means, because every
 * later stage is only as honest as the boundary it was given.
 *
 * A scope is inert data. Resolving it to commits is `collect.mjs`'s job, and
 * parsing never touches the repository — which is what makes it testable
 * without one.
 */

/** @typedef {{kind: string, value: string|null, raw: string[]}} Scope */

export const SCOPE_KINDS = ['working', 'pr', 'since', 'range', 'label'];

/**
 * A free-text scope ("Pathfinder 4.4.0") names work in human terms. It cannot
 * be resolved to commits without a decision, so it is carried as `label` and
 * every later stage must treat it as unresolved until a ref is supplied.
 */
export function parseScope(argv = []) {
  const raw = [...argv];
  const free = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--pr') {
      const value = argv[i + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error('--pr needs a numeric pull request id, e.g. --pr 126');
      }
      return { kind: 'pr', value, raw };
    }

    if (arg === '--since') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--since needs a git ref, e.g. --since v4.3.0');
      }
      return { kind: 'since', value, raw };
    }

    if (arg === '--range') {
      const value = argv[i + 1];
      if (!value || !value.includes('..')) {
        throw new Error('--range needs a git range, e.g. --range v4.3.0..HEAD');
      }
      return { kind: 'range', value, raw };
    }

    if (arg.startsWith('--')) {
      i += 1; // skip an unrelated flag's value; unknown flags are not scope
      continue;
    }

    free.push(arg);
  }

  if (free.length > 0) {
    return { kind: 'label', value: free.join(' '), raw };
  }

  return { kind: 'working', value: null, raw };
}

/** A one-line human statement of the scope, used verbatim in metadata.json. */
export function describeScope(scope) {
  switch (scope.kind) {
    case 'pr':
      return `pull request #${scope.value}`;
    case 'since':
      return `commits since ${scope.value}`;
    case 'range':
      return `commit range ${scope.value}`;
    case 'label':
      return scope.value;
    case 'working':
      return 'the current branch against its default branch';
    default:
      throw new Error(`unknown scope kind: ${scope.kind}`);
  }
}

/** True when the scope names work that no git ref pins down yet. */
export function isUnresolved(scope) {
  return scope.kind === 'label';
}
