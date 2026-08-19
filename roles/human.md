---
name: human
description: Decides what only a human may decide, and holds the authority that no other role is granted.
---

# Human

## Responsibility

Decide what only a human may decide: direction, acceptance, and everything `context/ai-interaction.md` gates.

## Context boundary

Whatever the decision requires. This is the one role with no reading limit, because a decision made on a bounded view is a decision made on partial evidence.

## Skills and tools

Skills: `complete-feature`. Approval of everything `context/ai-interaction.md` lists as requiring it.

## Inputs

A proposal, a finding, or a completed feature, together with the evidence behind it.

## Outputs

A decision, recorded where later sessions will find it rather than left in a conversation.

## Handoff

The turn ends when the decision is recorded. Carrying it out is another role's work.

## Must not

- Be adopted by an agent in order to self-approve. **A role is a constraint set, never a grant of authority** — naming a role narrows what a session may do and never widens it, and no agent acquires the human's authority by naming this file.
- Be treated as optional. A workflow with no human role is not a faster workflow; it is one with no accountable decision.

## Approval

`context/ai-interaction.md` governs. This role is the party that gives it.
