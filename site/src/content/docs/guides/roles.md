---
title: Roles
description: Four declarative contracts that scope a session to one responsibility — plain Markdown, shipped with every install, and inert until a human names one.
---

Pathfinder already had a role contract before this page existed. It is
[`context/ai-interaction.md`](/context/ai-interaction/), and it describes exactly
one: *the AI agent*, undifferentiated. Approval boundaries, the feature
lifecycle, context discipline, scope control, and review priorities — all written
for a single worker that plays every part in sequence.

Roles split that one implicit contract into four explicit ones.

## You do not have to do anything

**Naming a role is the only thing that activates one.** The four files install
with the kit and sit there. Nothing prompts you for one, no skill behaves
differently because they exist, and a session where you never say the word works
exactly as [the workflow page](/guides/workflow/) documents.

If that is your whole interest in this page, you are done. Everything below
describes something you switch on by typing a sentence — literally a sentence:

```text
Work as the developer role.
```

There is no command, no flag, and no file for you to create.

The switch is deliberately not the presence of the directory. A capability that
activates because a file was installed is a capability you have to opt *out* of,
and you would have opted in by running an installer.

## The lifecycle

Four responsibilities, in the order work moves through them. What each one hands
over is a finished artifact, shown under its arrow:

```text
Planner   →   Developer   →   QA   →   Human
   │             │             │         │
   │             │             │         └─ a decision, recorded
   │             │             └─ findings, and the risk that remains
   │             └─ a verified delivery chunk
   └─ an approved feature spec
```

Those arrows are the one thing on this page most likely to be misread.

### Nothing here invokes anything

This is the part the arrows invite you to get wrong, so it is worth being blunt
about:

**Roles do not call one another, and Pathfinder is not an orchestration
runtime.** There is no dispatcher, no queue, no scheduler, and no agent handing
work to another agent. A handoff is a sentence in a Markdown file saying *this
turn is over and what ends it* — a human reads that, and a human starts the next
session by naming the next role.

So the diagram above is a description of how work moves through people and
sessions. It is not a machine, and nothing executes it. If you want the developer
role to pick up where the planner stopped, you open a session and say so.

The same goes for a role's constraints: **nothing enforces them at runtime.** A
role is read at the start of a session and governs it for the duration. It is not
consulted per tool call, and no checker validates that a session obeyed it. Like
the rest of Pathfinder, it works because it is written down and read.

## Role versus skill

The distinction is the whole reason a role is a separate file rather than another
section inside a skill:

| | A role says | A skill says |
| --- | --- | --- |
| **What it is** | What a worker is responsible for | How to perform one task |
| **Shape** | Responsibility, context boundary, handoff, constraints | A procedure, in order |
| **Scope** | Across several tasks and handoffs | One task, start to finish |
| **Lifetime** | A session | An invocation |

A role file that starts explaining *"first do X, then do Y"* has become a skill,
and the layer has failed.

Some constraints have no home in a skill, because **a skill cannot see what
preceded it.** Nothing stops an agent from finishing a review and immediately
implementing its own findings — [`review-feature`](/skills/review-feature/) says
not to modify code, and that holds inside the skill, but the erosion that matters
happens *between* skills. `roles/qa.md` is where "do not continue into
[`start-feature`](/skills/start-feature/) in this session to fix what you just
found" can actually live. Reviewing your own repair is not a review.

## The four shipped roles

Each maps to skills that already ship. Nothing here is a new capability — the
role names an existing responsibility and bounds it.

| Role | Responsible for | Skills it uses today |
| --- | --- | --- |
| `planner` | Turning approved direction into approved feature specs | [`debate-me`](/skills/debate-me/), [`to-specs`](/skills/to-specs/) |
| `developer` | Implementing one approved feature, one chunk at a time | [`load-feature`](/skills/load-feature/), [`start-feature`](/skills/start-feature/), plus your project's build and test commands |
| `qa` | Establishing whether delivered work meets its acceptance criteria | [`review-feature`](/skills/review-feature/), plus your test commands and browser automation where a spec calls for it |
| `human` | Deciding what only a human may decide | [`complete-feature`](/skills/complete-feature/), and approval of everything [`context/ai-interaction.md`](/context/ai-interaction/) gates |

Name one and the session reads that file before anything else, then follows it
for the duration.

Each file states a responsibility, a context boundary, the skills it uses, its
inputs and outputs, the condition that ends its turn, what it must not do, and a
pointer to the approval policy. **Approval policy is never restated in a role**,
because two homes for approval policy is how they come to disagree, and
[`context/ai-interaction.md`](/context/ai-interaction/) is the home.

### There is no debugger role

[`debug-issue`](/skills/debug-issue/) already carries explicit boundaries, stop
conditions, a handoff, and its principles — a complete role contract living
inside the skill. A second copy would either restate it or be a stub. **Where a
skill is the whole role, the skill is the role file.**

## A role is a constraint set, never a grant of authority

`roles/human.md` exists to make that unmistakable. Naming a role **narrows** what
a session may do and never widens it, and no agent acquires a human's authority
by reading a file that describes one. The human role is the party that gives
approval, not a costume for asking differently.

It is also not optional. A workflow with no human role is not a faster workflow;
it is one with no accountable decision.

## Plain Markdown, not an agent definition

A role contract is a Markdown file with a name and a description. That is the
whole format, and it is deliberate.

**A role carries no `model`, no `tools`, and no `isolation`.** Those fields are
what a harness-native agent definition carries, and every one of them is
*behaviour* — which tool may run, which model answers, where it executes. A role
states responsibility and constraint and leaves behaviour to the tool you happen
to be using.

That is what keeps the layer vendor-neutral. These are not Claude Code subagents
and not Codex agent definitions; they are files, and the same four work
unchanged in a tool that has no agent concept at all.

It is also why **roles have no adapters.** A skill gets a generated adapter
because Claude Code and Codex auto-discover skills in a fixed directory and
surface them as `/name` and `$name`. Neither tool has a role directory to
discover, so a role adapter would be adapting to nothing. The adapter count does
not move, no harness registry changes, and a role is loaded the way any file is
loaded — by reading it. Every tool can read a file, which is the cheapest
portability there is.

## They are yours to edit

Installed role files are starting points, in the same sense as `context/*.md` and
unlike `skills/*/SKILL.md`. Edit them, tighten a context boundary, add a
constraint your project learned the hard way. A project that wants a fifth role
copies an existing file — the directory is the list, and nothing enumerates it,
so adding one costs no registration anywhere.

## Related

[Context boundaries](/concepts/context-boundaries/) is the discipline a role's
boundary section applies to one responsibility.
[Human approval](/concepts/human-approval/) is the policy every role points at
and none of them restates. [The workflow](/guides/workflow/) is the sequence of
skills these four responsibilities are drawn over.
