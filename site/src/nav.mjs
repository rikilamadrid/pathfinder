// The sidebar, grouped by the five workflow loops.
//
// The grouping is declared here rather than derived, because it is editorial:
// which loop a skill belongs to is a statement about the workflow, and
// `guides/workflow.md` is where that statement is made — the README carries an
// overview of two loops and links out for the rest. `WORKFLOW_LOOPS` below
// mirrors that guide's loop names and order.
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
 *
 * `boundary` is the README's own statement of where the loop's central skill
 * stops and its neighbors begin, quoted from the block that follows that loop's
 * diagram. It is declared for the same reason the grouping is: it is an
 * editorial claim about the workflow, made in the README, and a loop that has
 * one is the loop a newcomer most often picks the wrong skill inside. The skill
 * reference renders it above the group — see `buildSkillReference` in
 * `loaders/kit.mjs`, which is the only consumer.
 *
 * These are cross-skill statements, so no single `SKILL.md` owns one. Everything
 * a *skill* says about itself still comes from the skill: the reference page
 * takes every name and description straight out of its frontmatter and holds no
 * copy of either.
 *
 * Exported, because both the sidebar and the reference page group by it and two
 * declarations of the same claim would be one too many.
 */
export const WORKFLOW_LOOPS = [
  {
    label: 'Discovery and validation',
    skills: ['kickstart-pathfinder', 'debate-me', 'prototype'],
  },
  {
    label: 'External reference analysis',
    skills: ['reverse-engineer'],
    boundary: [
      'reverse-engineer = understand an external reference',
      'learn-codebase   = understand the current codebase',
      'kickstart        = initialize project context',
      'prototype        = validate a proposed direction',
      'to-specs         = convert an approved direction into planned work',
    ],
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
    boundary: [
      'debug-issue     = an observed failure needs an explanation',
      'start-feature   = planned construction is difficult',
      'review-feature  = completed implementation needs inspection for defects',
      'learn-codebase  = the real question is understanding the repository',
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
const GUIDES = [
  { label: 'Getting started', link: '/guides/getting-started/' },
  { label: 'The workflow', link: '/guides/workflow/' },
];

/**
 * The four ideas that live above any single skill, in the order a newcomer meets
 * them. Each page explains one and then points at the kit file that governs it;
 * none of them restates a skill.
 */
const CONCEPTS = [
  { label: 'Context boundaries', link: '/concepts/context-boundaries/' },
  { label: 'Delivery chunks', link: '/concepts/delivery-chunks/' },
  { label: 'Decision states', link: '/concepts/decision-states/' },
  { label: 'Human approval', link: '/concepts/human-approval/' },
];

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
    { label: 'Concepts', items: CONCEPTS },
    // The index sits above the groups it summarizes, so "which skill do I need?"
    // is answerable before scrolling twenty names.
    { label: 'Skill reference', items: [{ label: 'All skills', link: '/skills/' }] },
    ...groups,
    {
      label: 'Project context',
      items: ordered.map((id) => ({ label: id, link: `/context/${id}/` })),
    },
  ];
}
