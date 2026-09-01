---
title: Session orientation
description: An optional Claude Code hook that hands a starting session your Pathfinder work state. Pathfinder generates the handler; switching it on is yours, and skipping it costs nothing.
---

Every session starts by working out where it is. Which ticket is loaded, which
branch you are on, whether there is a handoff waiting. You can always ask —
that is what [`whereami`](/skills/whereami/) is for — but on a supported harness
you can have the answer arrive on its own.

Pathfinder installs the machinery and stops there. What it writes is one file:

```text
.claude/hooks/pathfinder-session-orientation.mjs
```

That file is **inert**. Pathfinder writes no settings file, so nothing
references it and nothing runs it. It sits on disk until you say otherwise.

## If you do nothing

Nothing happens, and nothing is missing.

There is no automatic orientation, and that is the whole of the difference. No
skill changes, no lifecycle step changes, no ticket behaves differently. Run
`/whereami` when you want the same picture. For example, its output keeps this
shape (the names and counts here are illustrative):

```text
Role:    none
Feature: 12 — Example reporting workflow
Ticket:  12.3 — Add an example activity filter
Git:     feature/example-activity-filter — 2 changed
Context: available
Next:    Run /ticket start
```

The same answer holds for a harness with no session lifecycle event at all.
Codex gets no handler, no `.claude` file, and no substitute for one — it gets
the full, unmodified Pathfinder workflow, and `whereami` on demand. Automatic
orientation is a convenience layered on top of Pathfinder, never a part of it.

## Switching it on

Add this to `.claude/settings.local.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/pathfinder-session-orientation.mjs\""
          }
        ]
      }
    ]
  }
}
```

That is the entire step. Nothing else changes, and the next session you start
receives the block.

Three details in that fragment are load-bearing:

- **`node`, not the file on its own.** The handler ships readable but not
  executable, so its shebang is decoration. Run it through Node.
- **`$CLAUDE_PROJECT_DIR`.** Claude Code expands it to your project root, which
  is what keeps the activation correct from a subdirectory or a worktree.
- **No `matcher`.** One entry with the matcher omitted covers the lifecycle
  sources without naming any of them, so you do not need a second event or a
  second entry.

### What was actually observed

The sources below are stated at the strength of the evidence behind them, not
at the strength of the design.

`startup`, `resume`, `clear`, and `compact` were each observed live, per
source, against a real Claude Code install with the matcher omitted — the
handler ran and the payload carried that `source` value.

`fork` was not. The reachable surface, `claude --resume --fork-session`, emits
`source: "resume"`, so a live session could not be made to produce
`source: "fork"` through the automatable surfaces available. The handler was
driven directly with a `fork` payload and transported it correctly. It branches
on the source value for nothing at all — it copies it into one line of the
block — so whether Claude Code emits `fork` from some surface not reached here
changes nothing the handler does. That is the honest state of it: four sources
by live per-source evidence, one by payload-level execution.

### Which file to put it in

`.claude/settings.local.json` is the default this guide recommends, and the
reason is blast radius. It is yours, per-machine, and normally untracked, so
turning orientation on is a decision about your own sessions.

`.claude/settings.json` is committed, so a fragment there switches the
capability on for everyone who clones the repository. That is a real choice a
team can make deliberately — just make it deliberately.

Either way, the file is yours. Pathfinder never creates, reads, merges, or
writes a settings file, in this version or any planned one, which is why hook
configuration you already have survives installs and updates by construction
rather than by a merge algorithm that has to be trusted.

## What a session receives

A bounded, read-only snapshot. This representative block uses illustrative
branch and context counts while preserving the real output shape:

```text
# Pathfinder work state (read-only orientation)

Session: startup
Git:     feature/example-activity-filter — 2 changed
Context: project-overview.md yes · history.md yes · tracker.md no · handoff.md no · features/ 7 specs · tickets/ no
Role:    none — no /role override can be active yet; do not assume one

context/current-ticket.md, verbatim:

# Current Ticket
...
```

It transports; it does not interpret. `context/current-ticket.md` is **quoted,
never parsed** — that file is written by `/ticket load` with no schema, and
nothing validates its shape, so quoting is what makes the handler immune to a
file whose shape is not guaranteed. The excerpt is capped at 40 lines and 2,000
characters, and says so when it truncates.

It reads. It never writes: it opens files for reading and runs one `git status`
with `--no-optional-locks`, so not even the index cache is touched.

It fails open and silent. A directory that is not a Pathfinder project produces
no output at all. Empty, unreadable, oversized, malformed, and absent state each
exit successfully with nothing on stderr. A broken convenience that announced
itself into every session would be worse than no convenience.

And it decides nothing. Role, Feature identity, ticket meaning, and the next
action are `whereami`'s reading of that same file, and the handler must not
produce a second, divergent one. The last line of every block says so.

## Updating

The path is stable, so an update replaces the handler and your activation keeps
working. No settings rewrite, no migration step.

An update only replaces a file Pathfinder positively established it wrote — the
marker on line two. A file of your own at that path is reported and left alone
unless you pass `--force`.

## Removing it

Two steps, and you perform both:

1. Delete `.claude/hooks/pathfinder-session-orientation.mjs`.
2. Remove the `SessionStart` fragment from your settings file.

Order does not matter, and neither does doing only one. An unreferenced handler
never runs. A fragment pointing at a missing handler is a no-op that cannot
block a session — `SessionStart` has no power to stop anything, which is what
bounds the worst case of a stale activation to "no orientation block".

Pathfinder deletes nothing, here or anywhere. A handler a future version no
longer ships is reported as an orphan and left exactly where it is, because a
still-referenced handler that keeps working beats knowingly invalidating an
activation you made.
