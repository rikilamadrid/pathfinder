/**
 * Stage 4: verification.
 *
 * Every check here is decidable from artifacts. None of them asks whether the
 * article is good — that is a human judgment and the skill says so. They ask
 * whether it is *supportable*: does each cited source exist in the bundle that
 * was collected, is every unsupported claim marked as one, does the stated
 * confidence match the evidence, and did the run write anything it had no
 * business writing.
 *
 * The voice rules are inputs rather than constants, because `voice.md` must be
 * editable without touching the pipeline.
 */

import { extractSources, knownSources, resolves } from './sources.mjs';

export const REQUIRED_METADATA_KEYS = [
  'title', 'slug', 'summary', 'angle', 'scope',
  'evidenceConfidence', 'needsHumanConfirmation',
];

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

export const MARKER = '[NEEDS HUMAN CONFIRMATION]';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const finding = (rule, severity, message) => ({ rule, severity, message });

/**
 * Voice rules, read from `voice.md`. Phrases live in a fenced `banned` block so
 * that editing the voice is editing prose, not editing code.
 */
export function parseVoiceRules(text) {
  const banned = [];
  if (typeof text !== 'string') return { bannedPhrases: banned };

  const block = /```banned\n([\s\S]*?)```/.exec(text);
  if (!block) return { bannedPhrases: banned };

  for (const line of block[1].split('\n')) {
    const phrase = line.trim();
    if (phrase && !phrase.startsWith('#')) banned.push(phrase);
  }
  return { bannedPhrases: banned };
}

export function checkMetadata(metadata) {
  const findings = [];

  if (!metadata || typeof metadata !== 'object') {
    return [finding('metadata-shape', 'error', 'metadata.json is missing or is not an object')];
  }

  for (const key of REQUIRED_METADATA_KEYS) {
    if (!(key in metadata)) {
      findings.push(finding('metadata-keys', 'error', `metadata.json is missing \`${key}\``));
    }
  }

  for (const key of ['title', 'slug', 'summary', 'angle', 'scope']) {
    if (key in metadata && (typeof metadata[key] !== 'string' || metadata[key].trim() === '')) {
      findings.push(finding('metadata-keys', 'error', `metadata.json \`${key}\` is empty`));
    }
  }

  if (typeof metadata.slug === 'string' && metadata.slug && !SLUG_PATTERN.test(metadata.slug)) {
    findings.push(finding('metadata-slug', 'error',
      `\`slug\` is \`${metadata.slug}\`; it must be lowercase words joined by single hyphens`));
  }

  if ('evidenceConfidence' in metadata && !CONFIDENCE_LEVELS.includes(metadata.evidenceConfidence)) {
    findings.push(finding('metadata-confidence', 'error',
      `\`evidenceConfidence\` is \`${metadata.evidenceConfidence}\`; it must be one of ${CONFIDENCE_LEVELS.join(', ')}`));
  }

  if ('needsHumanConfirmation' in metadata && !Array.isArray(metadata.needsHumanConfirmation)) {
    findings.push(finding('metadata-confirmations', 'error',
      '`needsHumanConfirmation` must be an array, even when it is empty'));
  }

  return findings;
}

/**
 * Every source reference in the evidence and the article must resolve against
 * the collected bundle. This is the check that makes "never invent facts"
 * enforceable rather than aspirational.
 */
export function checkTraceability(texts, bundle) {
  const findings = [];
  const known = knownSources(bundle);

  for (const [label, text] of Object.entries(texts)) {
    for (const source of extractSources(text)) {
      if (!resolves(source, known)) {
        findings.push(finding('source-resolves', 'error',
          `${label} cites \`${source.ref}\`, which is not in the collected evidence`));
      }
    }
  }

  return findings;
}

/**
 * A claim with no source must carry the marker, and every marker must be
 * accounted for in metadata. Both directions matter: an unmarked guess is a
 * fabrication, and a marker the metadata does not list is invisible to whoever
 * has to resolve it.
 */
export function checkConfirmationMarkers(articleText, metadata) {
  const findings = [];
  const inArticle = countOccurrences(articleText, MARKER);
  const listed = Array.isArray(metadata?.needsHumanConfirmation)
    ? metadata.needsHumanConfirmation.length
    : 0;

  if (inArticle > listed) {
    findings.push(finding('confirmation-listed', 'error',
      `the article carries ${inArticle} ${MARKER} marker(s) but metadata lists ${listed}; ` +
      'every marker must be listed so a human knows what to resolve'));
  }

  if (listed > inArticle) {
    findings.push(finding('confirmation-listed', 'warning',
      `metadata lists ${listed} item(s) needing confirmation but the article carries ${inArticle} marker(s)`));
  }

  return findings;
}

/**
 * Stated confidence has to match the bundle it came from. A run that collected
 * gaps cannot call itself high confidence, and this is the rule that stops an
 * optimistic default from surviving to publication.
 */
export function checkConfidence(metadata, bundle) {
  const findings = [];
  const stated = metadata?.evidenceConfidence;
  if (!CONFIDENCE_LEVELS.includes(stated)) return findings;

  const missing = bundle?.missing?.length ?? 0;
  const commits = bundle?.commits?.length ?? 0;
  const confirmations = Array.isArray(metadata?.needsHumanConfirmation)
    ? metadata.needsHumanConfirmation.length
    : 0;

  if (stated === 'high' && missing > 0) {
    findings.push(finding('confidence-matches-evidence', 'error',
      `\`evidenceConfidence\` is high, but collection recorded ${missing} gap(s); ` +
      'high confidence means nothing was missing'));
  }

  if (stated === 'high' && confirmations > 0) {
    findings.push(finding('confidence-matches-evidence', 'error',
      '`evidenceConfidence` is high, but the article still needs human confirmation'));
  }

  if (stated !== 'low' && commits === 0) {
    findings.push(finding('confidence-matches-evidence', 'error',
      'no commits were collected, so confidence cannot be above low'));
  }

  return findings;
}

/**
 * The pipeline reads a repository and writes one directory. Anything else that
 * changed during the run is a defect, whoever caused it.
 */
export function checkWriteScope(changedPaths, outputDir) {
  const prefix = outputDir.endsWith('/') ? outputDir : `${outputDir}/`;
  return (changedPaths ?? [])
    .filter((path) => path && path !== outputDir && !path.startsWith(prefix))
    .map((path) => finding('write-scope', 'error',
      `\`${path}\` changed during the run; blog-post-redactor writes only inside \`${outputDir}\``));
}

export function checkVoice(articleText, bannedPhrases) {
  const findings = [];
  const haystack = (articleText ?? '').toLowerCase();

  for (const phrase of bannedPhrases ?? []) {
    if (haystack.includes(phrase.toLowerCase())) {
      findings.push(finding('voice-banned-phrase', 'warning',
        `the article contains "${phrase}", which voice.md bans`));
    }
  }

  return findings;
}

/**
 * @param {object} input
 * @param {object} input.bundle       collected evidence
 * @param {object} input.metadata     parsed metadata.json
 * @param {string} input.article      article.md
 * @param {string} input.evidence     evidence.md
 * @param {string[]} input.changedPaths paths the run changed, repo-relative
 * @param {string} [input.outputDir]
 * @param {string[]} [input.bannedPhrases]
 */
export function verify({
  bundle, metadata, article = '', evidence = '',
  changedPaths = [], outputDir = 'blog-posts', bannedPhrases = [],
}) {
  const findings = [
    ...checkMetadata(metadata),
    ...checkTraceability({ 'evidence.md': evidence, 'article.md': article }, bundle),
    ...checkConfirmationMarkers(article, metadata),
    ...checkConfidence(metadata, bundle),
    ...checkWriteScope(changedPaths, outputDir),
    ...checkVoice(article, bannedPhrases),
  ];

  return {
    ok: findings.every((item) => item.severity !== 'error'),
    errors: findings.filter((item) => item.severity === 'error').length,
    warnings: findings.filter((item) => item.severity === 'warning').length,
    findings,
  };
}

function countOccurrences(text, needle) {
  if (typeof text !== 'string' || !needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}
