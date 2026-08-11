// The sidebar, grouped by the five workflow loops the README already defines.
//
// The grouping is declared here rather than derived, because it is editorial:
// which loop a skill belongs to is a statement about the workflow, and the
// README is where that statement is made. `WORKFLOW_LOOPS` below mirrors the
// "The complete workflow" section, in its order.
//
// What is *not* hardcoded is the set of skills. The groups list slugs, and
// anything on disk that no group claims is collected into a final group
// automatically, so a skill added later always reaches the sidebar — it just
// arrives ungrouped, which is a visible prompt to place it deliberately rather
// than a silent disappearance. `assertKnown` catches the opposite mistake: a
// slug listed here that no longer exists on disk fails the build by name.

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mirrors README § "The complete workflow". Each entry is a loop heading and
 * the skills that loop runs through, in the order the README walks them.
 */
const WORKFLOW_LOOPS = [
  {
    label: 'Discovery and validation',
    skills: ['kickstart-pathfinder', 'debate-me', 'prototype'],
  },
  {
    label: 'External reference analysis',
    skills: ['reverse-engineer'],
  },
  {
    label: 'Delivery loop',
    skills: [
      'to-specs',
      'load-feature',
      'start-feature',
      'debug-issue',
      'review-feature',
      'complete-feature',
    ],
  },
  {
    label: 'Learning and mentoring loop',
    skills: [
      'learn-feature',
      'teach-feature',
      'quiz-me',
      'challenge-me',
      'teach-architecture',
      'learning-review',
      'learn-codebase',
    ],
  },
  {
    label: 'Workflow reflection loop',
    skills: ['reflect'],
  },
  {
    // Not a sixth loop. `handoff` and `skillsmith` are cross-cutting utilities
    // and the README does not place them in one, so neither does this. Naming
    // the group honestly beats forcing them into a loop they do not belong to.
    label: 'Session and kit utilities',
    skills: ['handoff', 'skillsmith'],
  },
];

/**
 * Site-local guides, in reading order. These are the only pages on the site
 * that are written here rather than sourced from the kit, so unlike the skill
 * groups below they are listed explicitly — there is no directory to derive
 * them from and no risk of one going missing unnoticed.
 */
const GUIDES = [{ label: 'Getting started', link: '/guides/getting-started/' }];

/**
 * Project-context pages, most useful first rather than alphabetically. Files
 * not listed here still appear, in path order, after the ones that are.
 */
const CONTEXT_ORDER = [
  'project-overview',
  'ai-interaction',
  'coding-standards',
  'current-feature',
  'history',
];

const skillLink = (slug) => ({ label: slug, link: `/skills/${slug}/` });

function skillSlugs(skillsDir) {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .filter((entry) => existsSync(join(skillsDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function contextIds(contextDir, prefix = '') {
  return readdirSync(join(contextDir, prefix), { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .flatMap((entry) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return contextIds(contextDir, path);
      return entry.name.endsWith('.md') ? [path.replace(/\.md$/, '')] : [];
    })
    .sort();
}

/**
 * @param {{ skillsDir: string, contextDir: string }} dirs
 * @returns {import('@astrojs/starlight/types').StarlightUserConfig['sidebar']}
 */
export function buildSidebar({ skillsDir, contextDir }) {
  const onDisk = skillSlugs(skillsDir);
  const claimed = new Set(WORKFLOW_LOOPS.flatMap((loop) => loop.skills));

  const missing = [...claimed].filter((slug) => !onDisk.includes(slug));
  if (missing.length > 0) {
    throw new Error(
      `site/src/nav.mjs lists skills that do not exist: ${missing.join(', ')}. ` +
        `Update the workflow grouping to match the kit.`
    );
  }

  const groups = WORKFLOW_LOOPS.map((loop) => ({
    label: loop.label,
    items: loop.skills.map(skillLink),
  }));

  const unclaimed = onDisk.filter((slug) => !claimed.has(slug));
  if (unclaimed.length > 0) {
    groups.push({ label: 'Ungrouped skills', items: unclaimed.map(skillLink) });
  }

  const ids = contextIds(contextDir);
  const ordered = [
    ...CONTEXT_ORDER.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !CONTEXT_ORDER.includes(id)),
  ];

  return [
    { label: 'Overview', items: [{ label: 'Pathfinder', link: '/' }] },
    { label: 'Guides', items: GUIDES },
    ...groups,
    {
      label: 'Project context',
      items: ordered.map((id) => ({ label: id, link: `/context/${id}/` })),
    },
  ];
}
