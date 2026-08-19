---
name: setup-tracker
description: Configure an optional external work tracker by interviewing the human and writing context/tracker.md from the shipped template.
---

# Setup Tracker

Use this skill to describe, in prose, which tracker a project uses and how
Pathfinder's work items project onto it. The result is `context/tracker.md`.

Work Tracking is **optional**. A project that never runs this skill is
unaffected: no file, no prompt, no behaviour change anywhere. Do not run this
skill unasked, and do not propose it as a missing step.

This skill configures. It never contacts a tracker.

## Rules

- Do not write `context/tracker.md` without human approval.
- Do not add code, dependencies, or an adapter for any tracker.
- Do not invent a taxonomy the team did not ask for.
- Keep the model section backend-neutral; vendor vocabulary belongs only under
  the projection heading.
- Never remove the work-item marker block. It is the one machine-stable token in
  a prose contract, and identity depends on it.

## Interview

Ask progressively, in small groups. Ask only what the config cannot be written
without:

1. Which tracker, and where it lives.
2. How an agent reaches it — a CLI, a path, or a described manual step.
3. Where the project's approved feature specs live, **but only if they are not
   in `context/features/`.** Check the repository before asking: when the
   default is what is there, record it and move on rather than spending a
   question on it.
4. Which tag namespaces the project actually uses. `area`, `type`, `priority`,
   and `agent` are available; a project needing none of them says so.
5. What the tracker already carries. **List its existing labels, fields, or
   conventions before proposing any tag value.** If something already means the
   same thing, reuse it and record the mapping rather than creating a
   near-duplicate.
6. Anything about the projection that the shipped starting points do not cover.

## Process

1. Check whether `context/tracker.md` already exists. If it does, read it, and
   treat this run as a revision — show what would change and change nothing
   else. Never overwrite a working config wholesale.
2. Read `templates/tracker.template.md`.
3. Run the interview.
4. Choose the projection:
   - **GitHub Issues via `gh`** and **local Markdown files** ship as starting
     points, both proven.
   - Any other tracker is supported by the human describing it in prose, using a
     shipped projection as the shape to follow. **That is the mechanism, not a
     gap** — do not report an unsupported tracker as a blocker.
5. Fill the placeholders and keep **one** projection block. Delete, in the
   written config:
   - the template's guidance blockquote at the top;
   - the projection block you did not keep;
   - the `pathfinder:model-start` and `pathfinder:projection-boundary` markers;
   - the italic *"Keep this block for…"* line under the projection you kept — it
     is an instruction to you, not content for the project to read.

   **The model — everything between the two markers — is kept byte-for-byte.**
   The tracker-identity paragraph above it is the one part you rewrite, because
   it names the tracker and how to reach it.
6. Present the proposed file and request approval.
7. Write `context/tracker.md` only after the human approves.
8. Report what was configured, and say plainly that nothing has been published.

## Stop Condition

Stop once the config is written. Publishing to a tracker is `sync-tracker`, not
this skill. If `sync-tracker` is not installed, say so rather than publishing by
hand.
