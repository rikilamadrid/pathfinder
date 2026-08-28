---
name: hooksmith
description: Turn a plain-English automation or deterministic guarantee into the smallest working, correctly scoped, verified hook for the active AI coding harness.
argument-hint: [what the hook must guarantee or do]
---

# Hooksmith

A skill is reusable reasoning. A hook is deterministic lifecycle automation.

> A skill asks. A hook guarantees.

Start from the behavior the human describes. Do not start from a harness, an
event name, a settings file, or a script.

A hook is trusted executable configuration: it runs automatically, with the
human's credentials, every time its trigger matches, and nothing asks first.
Build one the way you would accept a change to CI.

## 1. Decide whether this should be a hook

Answer before anything else, out loud:

- deterministic lifecycle behavior — a guarantee, or an automatic reaction to
  something the session did → hook candidate
- judgment or reasoning workflow → a skill; use `skillsmith`
- something a human runs when they want it → a script, a command, or a Make
  target

Example: "never allow edits to approved Feature specs." Whether the rule holds
cannot depend on an agent remembering it, and the answer is a path comparison.
That is a hook.

Anti-example: "review whether this implementation actually satisfies the
Feature." That is a reading of intent against evidence. No trigger expresses it,
and a hook that approximates it will block correct work and pass incorrect work.
It belongs in a reviewer skill.

Say which of the three the request is. Concluding "this is not a hook" is a
successful outcome of this skill — stop there and name what to use instead.

## 2. Describe the hook without naming a harness

Write the behavior down in these terms, and only these, before looking at any
harness:

- **lifecycle moment** — what point in the session's life this attaches to
- **trigger** — what narrows it to the cases the human means
- **action** — what actually happens when it fires
- **blocking or non-blocking** — must it *stop* something, or only react to it
- **ownership and scope** — whose sessions this fires in
- **failure behavior** — what happens when the hook itself errors
- **verification** — what would prove it works, and what would prove it does not

The worked example becomes:

> pre-action, blocking file-mutation guard on the approved Feature spec paths,
> owned by the project or the kit, failing closed only if the check is trivially
> correct, verified by one edit that must pass and one that must be refused.

That paragraph is the portable contract: what the hook must guarantee, stated in
terms no harness owns. What follows it is four different things, and keeping
them apart is the point of the rest of this skill — translation onto one
harness's primitives (step 4), implementation of the action (step 5–6),
configuration that installs it (step 7), and verification that it actually
behaves that way (step 8). Only the first is translation.

Keep this description in the report. It is what survives a change of harness.

## 3. Identify the active harness and read what it can actually do

Name the harness this session is running in. Then inspect its current hook or
lifecycle capabilities and conventions — its documentation, its configuration
files, what it already has configured — rather than assuming they match another
harness or match what you remember.

Confirm four things before translating anything:

- which lifecycle moments it exposes, and their real names
- how a trigger is expressed, and how precisely it can narrow
- whether the moment you need can **block**, or only observe
- where the configuration lives, and what scopes it offers

If the harness exposes no equivalent lifecycle primitive, or exposes one that
cannot block when the guarantee requires blocking, say so plainly and stop. A
guarantee the harness cannot enforce is not a hook — it is a rule, a skill, or a
check the human runs. Do not build something that looks like enforcement and is
not.

### Claude Code

The first harness this skill supports concretely, and a reference for what a
translation looks like — not the definition of a hook.

Under Claude Code, read the current documentation before relying on any detail:

- https://code.claude.com/docs/en/hooks.md — reference
- https://code.claude.com/docs/en/hooks-guide.md — examples

That contract changes faster than any skill describing it, which is why nothing
here restates its event list. Once confirmed against the fetched page, use its
own vocabulary directly — the lifecycle event names, the matcher and condition
syntax, the handler types, the settings and plugin locations, the way a handler
receives input and returns a decision. Naming them is correct here and wrong
anywhere else.

Under any other harness, use that harness's native equivalent on the same terms:
read its documentation first, then speak its vocabulary.

#### The worked example, realized here

The step 2 description — *pre-action, blocking file-mutation guard on the
approved Feature spec paths, owned by the project or the kit* — becomes, under
this harness and no other:

| Portable term | Claude Code realization |
| --- | --- |
| lifecycle moment, pre-action | a `PreToolUse` event, which fires before the tool call and can block it |
| trigger | a matcher on the file-writing tools, narrowed further by an `if` condition on the spec paths |
| blocking | a denying permission decision, or exit code 2, returned by the handler |
| ownership, project or kit | `.claude/settings.json` in the repository, or the plugin's `hooks/hooks.json` |

Every cell on the right is this harness's dialect. Another harness answers the
same four questions with different names, or cannot answer one of them at all —
which is what step 3 is for. Treat the table as an illustration of the shape of
a translation, and confirm each cell against the documentation you just fetched
before relying on it; the names and the decision format change.

## 4. Translate, narrowest first

Map the description from step 2 onto what step 3 found:

- the lifecycle moment → the harness's nearest real moment, blocking-capable if
  the guarantee needs it
- the trigger → the narrowest expression the harness supports; a trigger that
  fires on everything is a noise problem that hides the cases the hook exists for
- ownership → the smallest scope that delivers the guarantee. Scope is a blast
  radius: a guarantee one person wants does not belong in everyone's
  configuration, and a project guarantee does not belong in something that ships
  to other people's projects.

State every place the translation is imperfect. The guarantee is only as strong
as the trigger, so say plainly what it does not catch.

For a hook that ships with Pathfinder, prefer what the installation environment
already guarantees. A hook needing a runtime, a package manager, or a dependency
the kit does not already assume is a hook Pathfinder cannot ship.

### Two approval gates

They are independent, and either one can apply:

- **Location.** Writing outside the repository — user settings, machine
  configuration — needs approval.
- **Blast radius.** Installing or changing a hook whose behavior reaches beyond
  the human's own private, local configuration needs approval, wherever the file
  sits. That covers a project hook committed to the repository and a hook
  shipped by Pathfinder or a plugin: both make other people's sessions behave
  differently, and neither is yours to decide.

Building and testing a candidate hook in a scratch or local-only place is not
gated. Ask at the moment of installing or modifying shared automatic behavior,
not before experimenting.

## 5. Choose the smallest reliable action

Prefer, in order: what the harness's own handler types give you for free; a
short shell command; a small script in a runtime the environment already has.
Choose a language because it is present and appropriate, not out of habit.

The action runs in the harness's environment, not the human's shell. Do not
assume a project's virtual environment, `PATH`, or dependencies are active. If
the hook must run a project command, run it as the human would type it, in the
project directory, and confirm it resolves there — a hook that always fails
looks exactly like a hook that always works.

## 6. Decide failure and recursion behavior

State the choice explicitly:

- **fail open** — an unexpected error allows the action. The default. A broken
  hook must not brick a session.
- **fail closed** — an unexpected error blocks. Only for a real safety boundary,
  and only when the check is simple enough to be obviously correct.

A hook attached to the end of a turn must not block the very ending it caused.
Find the harness's re-entry signal and exit early when it is set. A hook that
loops is worse than no hook.

Keep the action fast. It runs on every match.

## 7. Merge, never overwrite

Read the existing configuration before writing. Add this hook to what is already
there; leave every other moment and every other hook intact. Losing someone's
unrelated hook is a silent, hard-to-notice failure.

## 8. Prove it, both ways

Run the hook, the way this harness runs hooks. Verification is where the
abstraction ends: use the harness's real invocation, real input shape, and real
signals.

Verify both sides of the boundary:

- a case that must be **allowed** — it passes
- a case that must **trigger, block, or react** — it fires, with a reason a
  reader would understand

A hook that responds identically to both is broken, whichever way it responds.
Fix it and re-run before reporting anything.

Never report success from reading the code. A hook that always blocks and a hook
that always allows are indistinguishable on the page.

## 9. Report

State:

- the harness-independent description from step 2
- the harness, and what its capabilities were confirmed to be
- what was created, and where it lives
- what triggers it, what it guarantees, and what it does not catch
- what was actually executed, and what each run proved
- the one line the human would edit to adjust it
- how the human can trigger it themselves
- that the hook runs automatically with their credentials, and should be
  reviewed like any other executable configuration

Say plainly what could not be verified, and name anything the harness could not
enforce.

## Rules

- One hook per invocation. Finish it, verify it, report it, stop.
- Do not treat one harness's event names, configuration files, handler types, or
  input and output contracts as universal. They are that harness's dialect.
- Do not build a cross-harness abstraction layer, runtime, adapter framework,
  registry, or orchestration system. The abstraction is the reasoning in steps
  1–2; everything written to disk is native to one harness.
- Do not write outside the repository — user settings, machine configuration —
  without approval.
- Do not install or change a hook that affects anyone but the human running this
  session — a project hook in the repository, a hook shipped by Pathfinder or a
  plugin — without approval. Experimenting locally is free; making shared
  automatic behavior is not.
- Do not add a dependency to make a hook possible. Choose a smaller hook.
- Do not weaken an existing hook to make a new one fit.
- Do not report a hook as working without having run it.

## Stop conditions

Stop and hand the decision back when:

- the behavior turns out to need judgment, and belongs in a skill
- the active harness has no equivalent primitive, or none that can block when
  blocking is the point
- its documentation contradicts what the hook would rely on
- the guarantee cannot be expressed by any available trigger
- the correct scope is one the human has not approved, or is shared and the
  human has not approved installing it
- verification cannot distinguish the allowed case from the blocked one

Keep version one small and easy to delete. A hook nobody can explain is a hook
nobody can trust.
