---
title: Human approval
description: The actions an agent stops and asks about, where that list lives, and why nothing enforces it.
---

Pathfinder's central claim is that the agent proposes and you decide. Approval
boundaries are where that claim becomes specific enough to act on.

Unless you have written otherwise, an agent following this kit stops and asks
before:

- dependencies or build-tool changes,
- architecture migrations,
- database, auth, payment, secrets, or security-sensitive changes,
- destructive commands or file deletion,
- rewriting Git history,
- commits, merges, releases, and deployments,
- adopting prototype code into production.

Alongside that, the choices that are yours by default: product and MVP scope,
technology stack and architecture, infrastructure, prototype direction,
reconstruction choices taken from an external reference, and the Git and delivery
workflow.

## The list lives in your repository

It is [`context/ai-interaction.md`](/context/ai-interaction/) — a markdown file the
installer copied into your project, which you own.

That is the whole design. You can widen the list, narrow it, or pre-approve parts of
it, and the change takes effect because agents read the file. Nothing has to be
reconfigured, and no setting lives somewhere you cannot see.

If your project pre-approves dependency installs, say so there. If it requires
approval for anything touching a payment path, say that instead. The default list is
a starting point, not a policy you inherited.

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
in your repository, in a file you can read in two minutes and change in one. When an
agent crosses it, you have something specific to point at — and pointing at a rule
is what makes the correction stick for the rest of the session.

## Related

[Decision states](/concepts/decision-states/) cover the other half: `TBD` marks a
decision that is yours and has not been made yet, and an agent must not resolve one
quietly while doing something else. [The workflow](/guides/workflow/) marks each
approval point on the loop where it happens.
