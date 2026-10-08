# Feature 57 acceptance evidence

This is reproducible evidence for human review, not Feature completion or
acceptance. Source: the approved Feature 57 spec,
`.features/57-optional-routing-assessment.md` in the maintainer checkout. The
criteria below follow its Acceptance Criteria order. No completed history is
rewritten. Production behavior is unchanged by this documentation ticket.

## Reproduce locally

From the repository root with Node, npm, Git and Python available:

```sh
node skills/orchestrate/engine/bin/orchestrate.mjs --help
npm --prefix packages/orchestrate test
python3 .github/scripts/validate-kit.py
git diff --check
npm --prefix site ci --ignore-scripts
npm --prefix site run build
```

The orchestration suite creates disposable local Git projects. Its provider
callbacks/fetch doubles use synthetic credentials; transport integration tests
use local loopback servers. No live Jev endpoint or real credential is needed.
Do not run the documented live `assess` operation merely to reproduce this proof.

For a focused rerun use `node --test packages/orchestrate/test/<file>` with the
exact filename in the matrix. The full suite runs all those files. Test names
below are searchable anchors, not invented commands.

The supported CLI help prints these operations:

```text
routing <key> prepare|allowance|assess --request <local.json> --live <keys-or-empty> [--consent <consent.json> --invocation <id>] [--json]
followup <key> --request <human-direction.json> --live <keys-or-empty> [--json]
```

`routing-invocation.test.mjs` / `CLI local preparation/allowance and unconsented
assessment use the same boundary` executes actual CLI requests in disposable
projects: prepare and allowance exit 0; assessment without consent exits 1 with
`routing-consent-required` and zero attempts. `routing-followup.test.mjs` / `CLI
changes only checkpoint authority; briefs carry fresh concern without dispatch`
executes the separate human direction. Successful assessment is exercised through
the explicit coordinator module seam with intercepted fetch, because the public
CLI deliberately has no fake-provider flag. JSON shapes in the workflow reference
match these exercised request/consent/follow-up structures; placeholders must be
replaced with current local identity and actual human direction.

## Small synthetic walkthrough

This runs the supported coordinator seam against the existing fixture, including
the pinned protocol and exact-byte intercept. `setup` explicitly enables routing
in its disposable project and leaves Judge absent. The synthetic consent is for
the double only, not permission for a live service:

```sh
node --input-type=module <<'JS'
import { strict as assert } from 'node:assert';
import { setup, boundary, authority } from './packages/orchestrate/fixtures/routing/harness.mjs';
import { cleanUpTemporaryDirectories } from './packages/orchestrate/lib/harness.mjs';
try {
  const s = setup();
  const b = boundary(s);
  const before = authority(s);
  console.log(JSON.stringify({ preparation: s.prepare().ok, allowance: s.init(), calls: b.seen.length }));
  const fresh = await b.run();
  const cached = await b.run();
  assert.deepEqual(authority(s), before);
  console.log(JSON.stringify({ recommendation: fresh.recommendation, confidence: fresh.confidence, threshold: fresh.provisional_threshold, human_direction: fresh.requires_human_direction, cache: cached.cache, calls: b.seen.length, attempts: s.record().attempts.length, remaining: s.record().allowance - s.record().attempts.length }));
} finally { cleanUpTemporaryDirectories(); }
JS
```

Observed output (2026-10-08, Node v26.5.0, npm 11.20.0):

```json
{"preparation":true,"allowance":{"ok":true,"allowance":2,"consumed":0},"calls":0}
{"recommendation":"tester","confidence":0.9,"threshold":0.8,"human_direction":true,"cache":"cache","calls":1,"attempts":1,"remaining":1}
```

The second assessment reuses the cache; both keep human direction pending. The
assertion compares workflow authority before/after. The table below adds negative
cases and the separate human follow-up rather than treating this happy path as
sufficient evidence.

## Acceptance matrix

All paths below are relative to `packages/orchestrate/test/`. “Pass” records the
assertions observed in this ticket's verification run, not a production guarantee.

| Approved Feature 57 acceptance criterion | Executable test / fixture / command | Observed result |
| --- | --- | --- |
| 1. Default no-call; independent routing/Judge config and credentials | `routing-invocation.test.mjs`: `configuration and credentials never activate calls`; `consent is capability, concern, provider, fingerprint and invocation scoped`; `routing-boundary.test.mjs`: `preflight and consent reject deterministic/disabled states` | Pass: disabled/config-only/credential-only/Judge-consent-only paths make zero provider requests. |
| 2. Routing enabled, Judge disabled; ordinary reports and local preparation | `routing-invocation.test.mjs`: `routing enabled and Judge disabled`; `routing-projection.test.mjs`: `ordinary reports prepare independently of Judge`; fixture `../fixtures/routing/harness.mjs` | Pass: local preparation needs no Judge fields or calls; separately authorized assessment presents a recommendation with Judge absent. |
| 3. Deterministic/stale/invalid/live/failed states stop requests | `routing-policy.test.mjs`: `every deterministic restriction wins`; `routing-invocation.test.mjs`: `deterministic restrictions, stale identities, invalid projections and live workers make zero requests` | Pass: restrictions remain authoritative; no attempt/call for refused preflight. |
| 4. One bounded request; only human-mediated recommendations, no workflow changes | `routing-boundary.test.mjs`: `full path is Judge-independent for all three recommendations`, `guard refuses adapter endpoint/header/body/redirect substitution and a second request`; fixture `authority`/`unchanged` and `boundary` oracles | Pass: Tester/Adversary/Human presentations keep human direction pending; exact wire bytes and all non-routing checkpoint bytes, ticket, head, claim and refs are checked outside provider error handling. No automatic dispatch. |
| 5. Tester findings alone authorize repair; Adversary requires independent Tester | `routing-policy.test.mjs`: `malformed values, missing fields, authority additions and unknown enums refuse`; `routing-followup.test.mjs`: `keeps fresh confirmed findings as the sole Developer repair authority`, `retires both reports for Adversary then requires independent Tester over fresh experiments` | Pass: provider Developer/authority fields refuse; confirmed fresh Tester findings retain existing repair path. |
| 6. Same-head retirement, historical preservation and recoverable fresh obligation | `routing-followup.test.mjs`: `reproduces the old shortcut`, `refuses relabeling retired content`, `keeps retired A reports inactive after follow-up at B and return to A`, `is atomic/idempotent on interruption`; `routing-boundary.test.mjs`: `assessment/cache cannot revive retired reports` | Pass: old PASS/experiments cannot return to active authority; duplicates do not repeat follow-up; Tester-only and Adversary→Tester cycles require fresh evidence. |
| 7. Every mapping and conservative result, threshold/security/protocol/failures | `routing-policy.test.mjs`: `all route/rationale/concern combinations map conservatively`, `threshold is independent`; `routing-provider.test.mjs`: strict protocol, missing credentials and timeout cases; `routing-boundary.test.mjs`: `hostile protocol/adapter answers`, `HTTP redirects/errors, malformed protocol, wrong model and oversize reply` | Pass: 0.8 inclusive; below threshold, malformed/invalid refs, wrong model, high-confidence security and failure produce Human/no advancement. |
| 8. Approved projection only; no raw fallback, exact local refs, hostile prose containment | `routing-projection.test.mjs`: `source digests bind exact original records`, `missing or invalid author summaries`, `whole-bundle restricted prose`; `routing-provider.test.mjs`: snapshot/getter/serialization cases; `routing-boundary.test.mjs`: `outbound snapshot rejects raw records/authority/credentials` | Pass: generated refs bind local originals; unsafe inputs refuse; exact validated outbound bytes equal intercepted bytes, and validated detached inbound result is returned. |
| 9. Identical cache reuse; every semantic change/stale application invalidates | `routing-record.test.mjs`: `complete semantic fingerprints invalidate`, `policy is recomputed`, `isolated valid-shaped changes to every assessment field invalidate integrity`; `routing-invocation.test.mjs`: `head, evidence, concern, config, live state and requirements changes during await`; `routing-boundary.test.mjs`: `altered cache fields and stale fingerprints` | Pass: unchanged valid reuse adds zero calls/attempts; altered assessment integrity fails; current policy/state wins, no persisted recommendation is trusted. |
| 10. Failure/interruption/concurrency/repeated invocation/exhaustion/corrupt accounting | `routing-record.test.mjs`: failure, process interruption, independent processes, shared writer/lock cases; `routing-boundary.test.mjs`: `simultaneous invocations reserve once`, `lost/corrupt checkpoint or establishment marker`, interruption cases | Pass: reserve before callback; failures/interrupted reservations stay consumed; no reset, retry, duplicate provider request or automatic dispatch. |
| 11. Explicit initial allowance; lost established budget needs reconciliation | `routing-record.test.mjs`: `allowance initialization is explicit`, `missing/corrupt established budget`, `missing or corrupt establishment marker`, `a budget and marker copied from another ticket`; `routing-invocation.test.mjs`: consent-scope case | Pass: explicit authorization gives two attempts, not call consent; missing/corrupt accounting refuses; extension/reconciliation require human direction. |
| 12. Existing orchestration/Judge suites and kit validation; doubles only | Full `npm --prefix packages/orchestrate test`; `python3 .github/scripts/validate-kit.py` | Verification result recorded below. Existing Judge, findings, experiments, state/recovery and routing suites run together; synthetic/loopback transport only. |
| 13. Accurate authority, threshold, privacy and workflow documentation | Actual `--help`; CLI fixture checks above; [workflow reference](routing-assessment.md); independent Adversary and Tester review | Commands/config traced to shipped implementation. Independent review is pending when Developer publishes this evidence; this document grants no acceptance. |

## Verification observed on 2026-10-08

Documentation branch based on `b6700cc2ad95ab9579cafe24bef08019e911ecd3`,
Node v26.5.0 and npm 11.20.0:

- Full orchestration suite: 536 tests, 66 suites, zero failures (about 147 seconds).
- Kit validation: 26 skills, all rules passed.
- `git diff --check`: no errors.
- Canonical site build: 44 pages; manifest/icon/iOS metadata checks passed on all
  44 pages. Its prebuild also ran the canonical-input contamination regressions.
- CLI help and synthetic walkthrough above ran successfully. No live Jev call,
  real credential, version bump or publication occurred.

## Limits and excluded follow-ups

model = epistemic authority; code = procedural authority. Recommendation is not
authorization, dispatch, PASS/FAIL, acceptance or merge. The provisional routing
0.8 threshold is independent of Judge calibration, not an accuracy claim.

restricted-prose screening is not complete DLP. Ordinary prose can contain
unrecognized sensitive material. These are bounded synthetic containment tests,
not proof against every hostile input. Cache integrity detects altered data under
the persistence contract, not an attacker able to rewrite both data and metadata.

Evidence Judge threshold calibration and Jev question-payload repetition reduction
remain separate follow-ups. General DecisionProvider/router work, model/effort
selection, autonomous repair/dispatch/lifecycle automation are excluded. No live
provider smoke test, version bump or publication is part of this evidence.
