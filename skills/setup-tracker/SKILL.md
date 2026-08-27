---
name: setup-tracker
description: Configure optional work tracking for the project.
---

# Setup Tracker

Configure a work tracker only when the human asks.

Pathfinder works normally without one. Tickets already live in the repository;
a tracker gives them an external identity, and nothing else.

## Process

1. Ask where tickets should be published:
   - GitHub Issues
   - local Markdown files
   - another tracker the human describes
2. Ask only for the information needed to use that tracker.
3. Check where the tickets live. Ask only when they are not in
   `context/tickets/`; when the default is what the repository has, record it
   and move on.
4. Create a proposed `context/tracker.md` naming, at minimum:
   - the tracker and how an agent reaches it
   - the ticket source
   - how a published item records its ticket key, so a later run recognises the
     item it published last time
5. Show it to the human.
6. Write it only after approval.

If `context/tracker.md` already exists, modify only the requested settings.

## The key

A ticket's key is `NN.TT`, taken from its filename by `to-tickets` — the parent
Feature number and the ticket number within it.

The config's job is to say how that key survives the trip: a marker in the item
body, a recorded issue number, a field the tracker offers. Which one is the
tracker's business. What the kit requires is only the property — a re-run must
recognise the item it published last time. Without it, publishing is a duplicate
generator.

Ask for it explicitly. A config that cannot answer this is not finished.

## Rules

- Do not publish or create work items.
- Do not create labels, tags, or tracker conventions unless requested.
- Do not add dependencies or tracker-specific code.
- The repository is canonical. The projection is one-way, and tracker state
  never changes Pathfinder state.
- Tracking is always optional. Its off switch is the absence of
  `context/tracker.md`, so never write a placeholder config.

Publishing belongs to the ticket lifecycle, not here.

Stop after configuration.
