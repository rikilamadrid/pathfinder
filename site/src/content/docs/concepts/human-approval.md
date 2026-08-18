---
title: Human approval
description: The actions an agent stops and asks about, where that list lives, and why nothing enforces it.
---

Pathfinder's central claim is that the agent proposes and you decide. That claim
becomes specific in three places, and they are not the same thing. Confusing them is
easy, and it matters, because each one is changed by editing a different file.

## Operations that require approval

Things the agent would otherwise carry out. It stops and asks first:

- dependencies or build-tool changes,
- architecture migrations,
- database, auth, payment, secrets, or security-sensitive changes,
- destructive commands or file deletion,
- rewriting Git history,
- commits, merges, releases, and deployments,
- adopting prototype code into production,
- writes that leave your repository, such as items on a shared work tracker.

This list is declared in [`context/ai-interaction.md`](/context/ai-interaction/) — a
markdown file the installer copied into your project, which you own. That is the
whole design. Widen it, narrow it, or pre-approve parts of it, and the change takes
effect because agents read the file. Nothing has to be reconfigured, and no setting
lives somewhere you cannot see.

If your project pre-approves dependency installs, say so there. If it requires
approval for anything touching a payment path, say that instead. The default list is
a starting point, not a policy you inherited.

## Decisions that stay yours

Not operations the agent pauses on — choices it never makes:

- product and MVP scope,
- technology stack and architecture,
- database, authentication, APIs, and infrastructure,
- prototype direction, and whether prototype code is ever adopted,
- reconstruction choices derived from an external reference,
- Git and delivery workflow.

These are not governed by `ai-interaction.md`, and editing that file does not hand
any of them over. They are decisions, recorded in
[`context/project-overview.md`](/context/project-overview/) once you have made them.

## What the documented workflow governs

Git and delivery sit slightly apart from both lists. You choose the workflow; an
agent then *follows* what `context/project-overview.md` documents, without asking
each time — and asks when that policy is still [`TBD`](/concepts/decision-states/)
rather than picking one.

So a commit still stops for approval, because committing is an operation on the
first list. Which branch it goes on does not, because you already answered that.

## Recommendations are proposals, not silent decisions

An agent may recommend any of these, with reasoning, evidence, and alternatives.
[`debate-me`](/skills/debate-me/) makes the distinction explicit by labelling every
choice `recommended` and refusing to write approved context until you answer.

The inverse rule matters as much: an agent should say which parts of what it just
told you are facts, which are recommendations, and which are assumptions. A
recommendation presented as a finding is a decision made without you.

## Nothing enforces any of this

Worth saying plainly. There is no runtime, no hook, and no permission system. These
are rules written in markdown, and an agent that ignores them will succeed at
ignoring them.

What the kit gives you is narrower and still useful: the boundary is written down,
in your repository, in a file you can read in one sitting and change in one line. When an
agent crosses it, you have something specific to point at — and pointing at a rule
is what makes the correction stick for the rest of the session.

## Related

[Decision states](/concepts/decision-states/) cover the other half: `TBD` marks a
decision that is yours and has not been made yet, and an agent must not resolve one
quietly while doing something else. [The workflow](/guides/workflow/) marks each
approval point on the loop where it happens.
