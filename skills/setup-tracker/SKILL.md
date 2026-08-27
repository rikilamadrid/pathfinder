---
name: setup-tracker
description: Choose the canonical ticket store when it is not local Markdown.
---

# Setup Tracker

Configure a ticket store only when the human asks.

Pathfinder works normally without one: with no configuration, tickets are local
Markdown files under `context/tickets/`. That is already a store, and for many
projects it is the right one. This skill is for projects whose tickets belong
somewhere else instead.

## Process

1. Ask where tickets should live:
   - GitHub Issues
   - local Markdown files
   - another tracker the human describes — Jira, Linear, Azure DevOps, or
     something internal
2. Ask only for the information needed to use that store.
3. Say plainly what the choice means: that store becomes the only place the
   project's tickets exist. Moving to a different one later is a deliberate
   human migration, and nothing moves tickets between stores automatically.
4. Create a proposed `context/tracker.md` naming, at minimum:
   - the store and how an agent reaches it
   - where tickets are within it, when that is a choice the store offers
   - how a ticket carries its key, so a later run finds the ticket it created
5. Show it to the human.
6. Write it only after approval.

If `context/tracker.md` already exists, modify only the requested settings.

## The key

A ticket's key is `NN.TT` — the parent Feature number and the ticket number
within it. In the local Markdown store it is the filename. In any other store
the config has to say what carries it: a marker in the item body, a recorded
issue number, a field the tracker offers.

Which one is the store's business. What the kit requires is only the property —
a later session must be able to find the ticket by its key, because blocker
edges name keys and nothing else.

Ask for it explicitly. A config that cannot answer this is not finished.

## Rules

- Do not create tickets. This skill configures the store and nothing else.
- Do not create labels, tags, or tracker conventions unless requested.
- Do not add dependencies or tracker-specific code.
- The configured store is canonical. There is one ticket artifact, and no copy
  of it in the repository.
- Feature specs are not tickets. They stay in the repository whatever the store.
- Configuration is always optional. Its absence selects the local Markdown
  store, so never write a placeholder config.

Creating and updating tickets belongs to `to-tickets` and the ticket lifecycle,
not here.

Stop after configuration.
