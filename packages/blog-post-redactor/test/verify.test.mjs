import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  verify, checkMetadata, checkTraceability, checkConfirmationMarkers,
  checkConfidence, checkWriteScope, checkVoice, parseVoiceRules,
  MARKER, REQUIRED_METADATA_KEYS,
} from '../../../skills/blog-post-redactor/engine/verify.mjs';

const BUNDLE = {
  commits: [{ sha: 'a1b2c3d4e5f6' }],
  files: [{ path: 'src/stage.mjs' }],
  prs: [{ number: 126 }],
  missing: [],
};

const GOOD_METADATA = {
  title: 'How the stage got split',
  slug: 'how-the-stage-got-split',
  summary: 'Why extraction and writing became separate passes.',
  angle: 'The boundary that finally made sense',
  scope: 'commits since v4.3.0',
  evidenceConfidence: 'high',
  needsHumanConfirmation: [],
};

const rules = (findings, rule) => findings.filter((f) => f.rule === rule);

test('metadata.json must carry every required key', () => {
  assert.deepEqual(checkMetadata(GOOD_METADATA), []);

  for (const key of REQUIRED_METADATA_KEYS) {
    const partial = { ...GOOD_METADATA };
    delete partial[key];
    assert.ok(rules(checkMetadata(partial), 'metadata-keys').length > 0,
      `a missing \`${key}\` must be reported`);
  }
});

test('metadata.json is rejected outright when it is not an object', () => {
  assert.equal(checkMetadata(null)[0].rule, 'metadata-shape');
  assert.equal(checkMetadata('a string')[0].rule, 'metadata-shape');
});

test('the slug has to be a slug', () => {
  for (const slug of ['Not A Slug', 'trailing-', 'double--hyphen', 'UPPER']) {
    const findings = checkMetadata({ ...GOOD_METADATA, slug });
    assert.ok(rules(findings, 'metadata-slug').length > 0, `${slug} must be rejected`);
  }
});

test('confidence is a closed vocabulary and confirmations are a list', () => {
  assert.ok(rules(checkMetadata({ ...GOOD_METADATA, evidenceConfidence: 'very high' }),
    'metadata-confidence').length > 0);
  assert.ok(rules(checkMetadata({ ...GOOD_METADATA, needsHumanConfirmation: 'none' }),
    'metadata-confirmations').length > 0);
});

test('a cited source that is not in the bundle is an unsupported claim', () => {
  const findings = checkTraceability(
    { 'evidence.md': 'It landed in `commit:a1b2c3d4` and `pr:126`.' },
    BUNDLE,
  );
  assert.deepEqual(findings, []);

  const invented = checkTraceability(
    { 'evidence.md': 'It landed in `pr:999`, obviously.' },
    BUNDLE,
  );
  assert.equal(invented.length, 1);
  assert.equal(invented[0].rule, 'source-resolves');
  assert.match(invented[0].message, /pr:999/);
});

test('an unsupported claim must be marked, and every marker must be listed', () => {
  const article = `The stage was split ${MARKER} for latency reasons.`;

  const unlisted = checkConfirmationMarkers(article, { needsHumanConfirmation: [] });
  assert.equal(unlisted.length, 1);
  assert.equal(unlisted[0].severity, 'error');

  const listed = checkConfirmationMarkers(article, {
    needsHumanConfirmation: ['Was the split motivated by latency?'],
  });
  assert.deepEqual(listed, []);
});

test('a listed confirmation with no marker in the article is a warning, not an error', () => {
  const findings = checkConfirmationMarkers('No markers here.', {
    needsHumanConfirmation: ['something'],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warning');
});

test('high confidence is refused when the bundle recorded gaps', () => {
  const findings = checkConfidence(GOOD_METADATA, { ...BUNDLE, missing: ['no CHANGELOG.md'] });
  assert.ok(findings.some((f) => /high confidence means nothing was missing/.test(f.message)));
});

test('high confidence is refused while anything still needs confirmation', () => {
  const findings = checkConfidence(
    { ...GOOD_METADATA, needsHumanConfirmation: ['why?'] },
    BUNDLE,
  );
  assert.ok(findings.some((f) => /still needs human confirmation/.test(f.message)));
});

test('no commits caps confidence at low', () => {
  const empty = { commits: [], missing: [] };
  assert.ok(checkConfidence({ ...GOOD_METADATA, evidenceConfidence: 'medium' }, empty).length > 0);
  assert.deepEqual(
    checkConfidence({ ...GOOD_METADATA, evidenceConfidence: 'low' }, empty)
      .filter((f) => /above low/.test(f.message)),
    [],
  );
});

test('anything written outside the output directory fails the run', () => {
  assert.deepEqual(checkWriteScope(['blog-posts/article.md', 'blog-posts/metadata.json'], 'blog-posts'), []);

  const findings = checkWriteScope(['src/stage.mjs', 'blog-posts/article.md'], 'blog-posts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'write-scope');
  assert.match(findings[0].message, /src\/stage\.mjs/);
});

test('a directory that merely starts with the output name is not inside it', () => {
  const findings = checkWriteScope(['blog-posts-backup/x.md'], 'blog-posts');
  assert.equal(findings.length, 1);
});

test('voice rules are read from voice.md, not from code', () => {
  const voice = readFileSync(
    new URL('../../../skills/blog-post-redactor/voice.md', import.meta.url), 'utf8',
  );
  const { bannedPhrases } = parseVoiceRules(voice);

  assert.ok(bannedPhrases.length > 5, 'voice.md should publish a banned list');
  assert.ok(bannedPhrases.includes('game-changing'));

  const findings = checkVoice('This is a game-changing release.', bannedPhrases);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warning');
  assert.deepEqual(checkVoice('This is a small release.', bannedPhrases), []);
});

test('a voice file with no banned block simply bans nothing', () => {
  assert.deepEqual(parseVoiceRules('# Voice\n\nJust prose.\n').bannedPhrases, []);
  assert.deepEqual(parseVoiceRules(undefined).bannedPhrases, []);
});

test('a clean run passes end to end', () => {
  const report = verify({
    bundle: BUNDLE,
    metadata: GOOD_METADATA,
    article: 'The stage was split because extraction kept finding its own thesis.',
    evidence: 'Split in `commit:a1b2c3d4`, reviewed in `pr:126`.',
    changedPaths: ['blog-posts/article.md'],
    outputDir: 'blog-posts',
    bannedPhrases: ['game-changing'],
  });

  assert.equal(report.ok, true);
  assert.equal(report.errors, 0);
  assert.deepEqual(report.findings, []);
});

test('a run built on incomplete evidence fails with named reasons', () => {
  const report = verify({
    bundle: { commits: [], missing: ['no CHANGELOG.md', 'no tests in the diff'] },
    metadata: { ...GOOD_METADATA, evidenceConfidence: 'high' },
    article: `It doubled throughput ${MARKER}.`,
    evidence: 'Measured in `pr:999`.',
    changedPaths: ['blog-posts/article.md', 'README.md'],
    outputDir: 'blog-posts',
    bannedPhrases: [],
  });

  assert.equal(report.ok, false);
  const names = new Set(report.findings.map((f) => f.rule));
  assert.ok(names.has('source-resolves'));
  assert.ok(names.has('confirmation-listed'));
  assert.ok(names.has('confidence-matches-evidence'));
  assert.ok(names.has('write-scope'));
});
