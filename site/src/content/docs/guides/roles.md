---
title: Roles
description: Four declarative contracts that scope a session to one responsibility — shipped with every install, and inert until a human names one.
---

Pathfinder has always had a role. It is
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
describes something you switch on by typing a sentence.

The switch is deliberately not the presence of the directory. A capability that
activates because a file was installed is a capability you have to opt *out* of,
and you would have opted in by running an installer.

## A skill says how; a role says what you are responsible for

That distinction is the whole reason a role is a separate file rather than
another section inside a skill.

A [skill](/guides/workflow/) is a procedure. It has steps, it has an order, and
it governs one task from start to finish. A role is a standing contract: what a
worker is responsible for across several tasks and handoffs, what it reads, what
ends its turn, and what it must not do.

Some constraints have no home in a skill, because **a skill cannot see what
preceded it.** Nothing stops an agent from finishing a review and immediately
implementing its own findings — `review-feature` says not to modify code, and
that holds inside the skill, but the erosion that matters happens *between*
skills. `roles/qa.md` is where "do not continue into `start-feature` in this
session to fix what you just found" can actually live. Reviewing your own repair
is not a review.

## The four

| Role | Responsible for | Skills it uses |
| --- | --- | --- |
| `planner` | Turning approved direction into approved feature specs | [`debate-me`](/skills/debate-me/), [`to-specs`](/skills/to-specs/) |
| `developer` | Implementing one approved feature, one chunk at a time | [`load-feature`](/skills/load-feature/), [`start-feature`](/skills/start-feature/) |
| `qa` | Establishing whether delivered work meets its acceptance criteria | [`review-feature`](/skills/review-feature/) |
| `human` | Deciding what only a human may decide | [`complete-feature`](/skills/complete-feature/) |

You name one in a sentence — *"Work as the developer role"* — and the session
reads that file before anything else and follows it for the duration. There is no
command, no flag, and no file for you to create.

Each file states a responsibility, a context boundary, the skills it uses, its
inputs and outputs, the condition that ends its turn, what it must not do, and a
pointer to the approval policy. **Approval policy is never restated in a role**,
because two homes for approval policy is how they come to disagree, and
[`context/ai-interaction.md`](/context/ai-interaction/) is the home.

A role file also never contains procedure. The moment one reads *"first do X,
then do Y"* it has become a skill, and the layer has failed.

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

## Roles have no adapters

A skill has harness adapters because Claude Code and Codex
auto-discover skills in a fixed directory and expose them as `/name` and `$name`.
Neither tool has a role directory to discover, so a role adapter would be
adapting to nothing.

So the adapter count does not move, no harness registry changes, and a role is
loaded the way any file is loaded — by reading it. Every tool can read a file,
which is the cheapest portability there is.

## They are yours to edit

Installed role files are starting points, in the same sense as `context/*.md` and
unlike `skills/*/SKILL.md`. Edit them, tighten a context boundary, add a
constraint your project learned the hard way. A project that wants a fifth role
copies an existing file — the directory is the list, and nothing enumerates it.

Two things worth knowing about how a role behaves in practice: it is read at the
start of a session and governs it for the duration, and **nothing enforces it at
runtime.** It is not consulted per tool call. Like the rest of Pathfinder, it
works because it is written down and read, not because something checks.

## Related

[Context boundaries](/concepts/context-boundaries/) is the discipline a role's
boundary section applies to one responsibility, and
[human approval](/concepts/human-approval/) is the policy every role points at
and none of them restates.
