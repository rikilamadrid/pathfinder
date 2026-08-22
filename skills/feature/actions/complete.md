# Feature: Complete

Invoking this action is the human's acceptance of the Feature. Do not ask for
acceptance again.

Acceptance of the Feature is not approval of the delivery steps below. Each one
that the project's documented workflow gates is still asked for.

1. Run the project's required final checks.
2. Follow the documented Git, merge, version, release, and deployment workflow.
   Ask for approval where it requires it. If that workflow is undocumented or
   `TBD`, stop and ask rather than choosing one.
3. Mark the Feature `Complete` in its spec's `## Status`.
4. Add a compact entry to `context/history.md`.
   Create it from `templates/history.template.md` if it does not exist.
5. Clear or update `context/current-feature.md`. Do nothing if it does not exist.
6. If work tracking is configured, sync the completed state.
7. Report the completed outcome and any remaining follow-up.

Do not re-review accepted work unless final verification exposes a new problem.

Do not claim completion if required checks or delivery steps failed.
