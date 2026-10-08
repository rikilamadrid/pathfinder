# Optional routing assessment

This orchestrator-only capability is off by default. It assesses one unresolved
concern at an otherwise complete ordinary review/done boundary. It can recommend
Tester, Adversary or Human, always pending human direction. It never selects
Developer, clears a gate, supplies PASS/FAIL, dispatches, accepts or merges.
Ordinary start, resume, stage and integration commands make zero routing calls.

The authority model is **model = epistemic authority; code = procedural authority**.
The model classifies meaning; Pathfinder enforces allowed routes and current-state
restrictions. `recommendation != authorization != dispatch != PASS/FAIL != acceptance != merge`.
Only `tester`, `adversary`, and `human` are provider routes. Complete confirmed
current-head Tester findings remain the only Developer repair authority.

## Separate activation and consent

A human can explicitly create `context/routing-assessment.json`:

```json
{"schema":"pathfinder.routing-config/1","enabled":true,"provider":"jev"}
```

Missing means disabled. Invalid or unknown configuration refuses.
There is no installer change. Evidence Judge configuration and consent remain
independent. Routing uses only `PATHFINDER_ROUTING_API_KEY` and optional
`PATHFINDER_ROUTING_BASE_URL`; it never falls back to Judge's `TYPESAFE_*`
credentials. Credentials authenticate, but do not activate or authorize a call.
Never paste keys into chat, request files, reports or committed configuration.
Use your existing secure environment provisioning. Credential availability
!= activation != per-invocation consent. Judge activation does not enable routing;
Judge consent does not grant routing consent, and routing works with Judge disabled.
The adapter remains pinned to `jev-1.13.0` with its existing endpoint, exact-byte,
header, timeout, response-size and no-redirect protections.

The commands below run from the main checkout. `orchestrate` means
`node skills/orchestrate/engine/bin/orchestrate.mjs`. Define the shorthand in a
POSIX-compatible shell before using the examples:

```sh
orchestrate() { node skills/orchestrate/engine/bin/orchestrate.mjs "$@"; }
orchestrate --help
```

Examples use ticket `57.6` only as a placeholder: substitute the active claim key,
exact current PR/head, current digests and actual human direction throughout.
Do not run them against a completed ticket. Keep the explicit `--live`
inventory accurate; it is the coordinator's inventory of live workers, not a
claim that a new CLI process proves other sessions have ended. No live ticket
can be assessed. The module seam accepts a fresh inventory reader for callers
whose worker inventory can change while awaiting a provider.

## Local preparation

Create a local JSON request (do not commit raw evidence or credentials). Its
exact shape is:

```json
{
  "schema":"pathfinder.routing-request/1",
  "ticket":"57.6",
  "pr":"https://github.com/owner/repo/pull/1",
  "head_sha":"FULL_CURRENT_PR_HEAD_SHA",
  "checkpoint":"CURRENT_ROUTING_CHECKPOINT_DIGEST",
  "concern":{
    "id":"boundary-one",
    "original":"Repeated boundary input lacks an observation",
    "summary":"Repeated boundary input needs more evidence.",
    "risk":"none"
  },
  "requirements":[{
    "source":"verification:1",
    "original":"Exact first Verification item from the canonical ticket",
    "summary":"Empty input is rejected."
  }],
  "evidence":[{
    "role":"tester", "index":1,
    "action":"Exercised empty input.",
    "observation":"Input was rejected."
  }]
}
```

The coordinator records the actual concern and known risk (`none`, `security`,
`high_risk`, `scope` or `unknown`). Anything except `none` refuses locally.
Existing high-risk execution profiles also refuse. Do not reclassify a known
risk merely to get a model answer. The responsible evidence authors supply
restricted action/observation prose for selected one-based report records.
List all canonical `## Verification` items, in order, with their exact originals
and explicit safe summaries. The implementation rereads those items from the
ticket store (binding the complete ticket body into requirement provenance) and the active reports from the claimed worktree, never from an
assessment provider or caller-supplied workflow facts.

Compute `checkpoint` from the current worktree's `context/current-ticket.md`
using the exported `routingCheckpointDigest(text)` in
`skills/orchestrate/engine/routing-invocation.mjs`. It hashes non-routing
checkpoint content. Budget/accounting writes do not invalidate their own request;
changes to active evidence, gates or review phase do. Obtain a new request and
human consent when its identity/provenance changes. This is a freshness binding,
not a signature against a malicious local writer.

```sh
orchestrate routing 57.6 prepare --request /tmp/concern.json --live '' --json
```

Preparation is local, works with Evidence Judge disabled and ordinary reports
without Judge fields, and does not initialize a budget. Its output contains the
versioned preparation, projection, local originals and fingerprint for review.
Keep that output local. Only `projection` can cross the provider boundary;
locators, PR/head identity, raw findings, commands and logs remain local. Invalid
or missing summaries refuse; there is no generated or raw-evidence fallback.
The bounded projection carries approved concern, requirement, action and
observation summaries plus generated refs. Raw reports, source/code, commands/logs,
conversation, excluded paths/locators, PR URLs, SHAs, verdict words and workflow
authority stay local. Credentials never enter the projection/body; the selected
provider credential authenticates the declared transport header only.

restricted-prose screening is not complete DLP. Ordinary prose can still contain
unrecognized sensitive material.
Generated references establish traceability, not semantic proof.

## Allowance is not provider consent

A separate authorization file records actual human direction:

```json
{"by":"human","ticket":"57.6","kind":"initialize","direction":"Authorize the initial two assessment attempts only"}
```

```sh
orchestrate routing 57.6 allowance --request /tmp/allowance.json --live ''
```

Default allowance is two. An absent budget never initializes itself. An existing
marker, missing/corrupt accounting or interruption requires explicit human
reconciliation. The same operation accepts the existing 57.4 `extend`
authorization (with `additional`) or `reconcile` (with `allowance` and `consumed`)
when separately directed. It cannot silently refund reserved attempts.
For an interrupted lock, the explicit local API is
`recoverRoutingLock({ worktree, ticket, authorization })` exported by
`engine/routing-record.mjs`, with authorization
`{ by: "human", ticket, kind: "recover-lock", direction }`.
There is no routing CLI `recover` subcommand. Verify the actual owner first;
live or ambiguous owners refuse recovery, and elapsed time never permits stealing.
Recovery does not refund reservations or reconcile accounting automatically.
Do not delete checkpoint or establishment-marker files to reset allowance.
Preparation is persisted
with the reservation, after authorization, in the routing checkpoint section.

## One explicit assessment

Obtain human consent for the routing capability, selected provider and this
concern/invocation. Use the fingerprint returned by fresh preparation:

```json
{
  "by":"human", "capability":"routing-assessment", "ticket":"57.6",
  "concern":"boundary-one", "provider":"jev", "invocation":"review-one",
  "fingerprint":"sha256:PREPARED_FINGERPRINT"
}
```

```sh
orchestrate routing 57.6 assess --request /tmp/concern.json --live '' \
  --consent /tmp/routing-consent.json --invocation review-one --json
```

Consent files represent the coordinator's explicit human-authorization assertion,
not authentication tokens. Do not synthesize them from provider output, Judge
consent, a budget grant or credential presence. Each explicit invocation must
carry its own authorized invocation ID. There are no automatic retries/failovers.
A valid identical cache may be reused without another request or attempt, but
this supported operation still requires explicit routing consent. Fresh attempts
are durably reserved before transport and failures remain consumed. Local
preflight refusals do not consume an attempt.

Deterministic restrictions run first: wrong/stale PR or local head, ownership,
missing/retired reports, confirmed Tester findings, pending/failed/live work,
existing gates, known risk, incomplete projections and stale requirements all
prevent provider requests. Only a complete ordinary review boundary can be
assessed. One invocation makes at most one guarded request. After awaiting, the
coordinator rereads identity, configuration, live inventory, requirements,
checkpoint and evidence before recording and again before presentation. Changed
state rejects the response. Assessment changes only routing accounting, never
phase, Gate, verdict, repair authority, status, dispatch or acceptance.

Presentation includes the route, rationale code, confidence, provisional 0.8
abstention threshold, generated refs, provider/model, fingerprint, provenance,
cache and failure/abstention reason. The routing constant is separate from the
Evidence Judge threshold. It is a
conservative abstention threshold, not a calibrated accuracy claim. Below 0.8
means Human / no advancement. Even high confidence cannot override security,
high-risk or scope concerns, unsupported combinations or current-state restrictions.
Human means no advancement; a Tester/Adversary recommendation is also no
advancement. Exit zero means a valid assessment was presented, not acceptance,
PASS or readiness to merge.

## Follow-up is a second human decision

Present the recommendation and wait for human direction. If the human requests
fresh Tester or Adversary work, separately use the existing 57.5 operation:

```sh
orchestrate followup 57.6 --request /tmp/human-direction.json --live '' --json
```

Its distinct `pathfinder.human-followup/1` request requires fresh exact
identity, concern, full checkpoint digest and explicit `review-follow-up` human
authorization. An assessment/consent object is not that authorization. The
operation retires historical review authority under 57.5 rules, does not resolve
a gate and never spawns workers. Adversary follow-up requires fresh independent
Tester review afterward. Existing coordinator controls separately govern any
dispatch. Repeating assessment never applies or repeats follow-up.

Tester follow-up retires the active Tester report and requires fresh Tester
review. Adversary follow-up retires both active reports, requires fresh Adversary
experiments, then fresh independent Tester review. Reports remain under historical
headings: historical evidence != active authority. Old PASS/experiments, including
manually relabeled copies, cannot satisfy the fresh cycle. Moving head A → B → A
cannot revive retired authority. The request shape and exact full-checkpoint
binding are documented in [resume](actions/resume.md#explicit-human-directed-same-head-follow-up).
That full digest differs from the routing digest above; do not substitute one
for the other. Follow-up updates the pending review phase only under separate
human direction; it grants no verdict, gate resolution, acceptance or merge.

## Cache and interrupted accounting

Identical valid input can reuse an assessment, not a saved recommendation.
Reuse strictly validates the assessment and its integrity, recomputes the semantic
fingerprint, and derives policy again from current state. Ticket/PR/head, concern,
workflow, evidence/requirement provenance, projection, provider/model and
contract/policy versions all participate. Changed inputs cannot reuse old answers.
Failures are never valid cache entries. Altered confidence, route, rationale,
refs or concern invalidates integrity; it protects the persistence contract from
stale/corrupt/altered records, not an attacker who rewrites both data and integrity.

Reservation is durable before transport; interruption before reservation spends
nothing, while interruption after it and transport failure remain consumed.
Concurrent invocations cannot reserve duplicate work. Shared checkpoint locking
serializes latest-read/atomic-replacement writes; provider and fresh-state reader
callbacks execute outside that lock. Completion rereads current state. Contention
refuses without an implicit retry. Reconcile missing/corrupt accounting only from
preserved evidence and explicit human direction; never infer zero consumed attempts.
An additional attempt requires separate human `extend` direction. Cache hits and
local refusals consume no attempt, and resume never automatically retries or
reapplies a human follow-up.

## Reproducible proof and exclusions

[Feature 57 acceptance evidence](routing-acceptance.md) maps the approved criteria
to executable synthetic fixtures and observed results. It makes no live Jev call
and does not mark the Feature accepted or complete.

Evidence Judge threshold calibration and Jev question-payload repetition reduction
remain two separate follow-ups. This capability includes no generic
DecisionProvider, general AI router, model/effort selection, autonomous repair,
autonomous dispatch or lifecycle automation. Ordinary tickets incur zero routing
calls; an eligible fresh invocation uses at most one, with no retry or failover.
