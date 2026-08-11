Use `skills/debug-issue/SKILL.md`.

Debug the failure I describe.

Establish expected behavior, actual behavior, and reproduction status before proposing any fix.

Read only the code, logs, tests, and configuration relevant to the failure. Do not refactor unrelated code while the cause is still unknown.

State a small ranked set of hypotheses, then test the cheapest one that meaningfully reduces uncertainty. Change one explanatory variable at a time.

Do not call something the root cause because the symptom disappeared. If the evidence only supports a probable cause or a workaround, say so.

Apply the smallest justified fix, then verify against the original failure and the nearby behavior it could have affected. Remove temporary instrumentation.

Stop and report rather than thrashing when the evidence runs out, the reproduction is too unstable, or the fix would require an architectural, dependency, security, or destructive change I have not approved. Preserve what has already been ruled out.
