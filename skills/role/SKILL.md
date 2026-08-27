---
name: role
description: Explicitly override the role Pathfinder's lifecycle would assume.
argument-hint: planner|developer|tester
---

# Role

Explicitly activate exactly one role for the current session.

Normal lifecycle skills assume their responsible role automatically. Use this
skill only when the human wants to override that default or inspect/debug work
under a particular responsibility boundary.

The human names it, for example:

`/role planner`
`/role developer`
`/role tester`

## Process

1. Take the role name from the invocation.
   If none was given, list the available files in `roles/` and stop.
2. Read only `roles/<name>.md`.
   If it does not exist, say so, list the available role names, and stop.
3. Confirm in one line and wait for work:

   `Active role: <name>`

## Rules

- Activate only the role the human named.
- The explicit role overrides a lifecycle skill's automatic default for the
  rest of the current session/conversation context.
- Read only that role file.
- Do not start the role's work.
- Do not write project state just to remember the role.
- The role applies only to the current session/conversation context.
- A role narrows responsibility. It never grants human authority.
