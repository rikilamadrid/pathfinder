# `render-artifact` — engine tests

Repository-only tests for the artifact renderer. The engine itself lives at
`skills/render-artifact/engine/` and ships with the kit; this package does not
ship, is not published, and has no dependencies.

```sh
cd packages/render-artifact
npm test
```

`node --test` is the standard library, so there is no install step. A fresh
clone with only Node needs nothing else.

## Why the tests are not next to the engine

`skills/` is copied whole into every installed project, and the installer's
`NEVER_SHIPS` list names five `context/` paths and nothing else. There is no
exclusion mechanism keeping test files out of somebody else's repository —
placement is the mechanism. `test/placement.test.mjs` asserts that arrangement
still holds; `npm pack --dry-run` in `packages/create-pathfinder` confirms the
published tarball agrees.

## What is checked

| Suite | Claim |
| --- | --- |
| `determinism` | Same specification bytes and renderer version give the same artifact bytes across varied working directory, `TZ`, `LANG`/`LC_ALL`, and ambient environment. |
| `ambient` | The render path transitively imports zero `node:` builtins, and no delivered artifact carries a hostname, username, absolute path, clock read, or process detail the specification did not supply. |
| `golden` | The committed HTML and digest are what this renderer produces from these specifications. |
| `output-shape` | UTF-8, no byte-order mark, LF only, self-contained, and every ordering taken from the specification. |
| `trust` | A receipt describes the specification that was rendered; an artifact claims its evidence was checked only when this engine checked it. |
| `provenance` | A reader can tell `derived`, `proposed` with a source, and `proposed` with none apart, and no producer field selects the wording. |
| `diagram` | The `diagram` boundary holds: a producer cannot place, size, colour, route, rank or emphasise anything, and the attempt is refused rather than ignored. |
| `geometry` | Renderer arithmetic — no overlapping boxes, edges terminating on node boundaries, nothing past the canvas, no label wider than its box. |
| `interaction` | Traversal, path highlight and focus read the graph rather than the picture, and every fact is in the document before any script runs. |
| `contrast` | The diagram's own surfaces clear WCAG 2.1 AA in both themes, measured rather than inherited on trust. |
| `producer-contract` | Each producer skill still tells an agent to write a specification, keyed by contract rather than by kind. |
| `placement` | The tests exercise the shipped engine and never reach an installed project. |

Deterministic validation proves an artifact was checked. It does not prove the
artifact looks right — a person has to open it for that, and that judgement is
recorded separately.

## The specimens

`fixtures/deterministic-lesson.json` cites nothing. Delivering it resolves no
commit and reads no blob, so a digest that moves has one suspect: the renderer.
That is the specimen the determinism tests use.

The engine's two shipped examples — `examples/lesson.json` and
`examples/diagram.json` — do cite this repository at a fixed commit, so they are
the specimens that exercise evidence resolution and the provenance block on real
output of each kind.

The rest of `fixtures/` is registered in `SPECS` in `lib/harness.mjs`, which is
the one list the goldens and the cross-environment checks iterate. Adding a
specimen is a line there and a pair of files under `golden/`; it is deliberately
not a new suite. Four of them are a producer skill's real output and are listed
again as `PRODUCER_SPECIMENS`, so a new producer lands with the same coverage as
the existing ones rather than weaker coverage of its own.

## When a golden fails

Exactly one question matters: was the output change intended?

- **Yes** — bump `RENDERER_VERSION` in
  `skills/render-artifact/engine/version.mjs` and run `npm run goldens`, in the
  same commit. The version is part of the deterministic input, so an
  intentional output change is a release; without the bump it is
  indistinguishable from a determinism failure.
- **No** — rendering is no longer a pure function of the specification and the
  renderer. Start at `test/ambient.test.mjs`: something reached for a clock,
  the environment, the locale, or the filesystem.

Never regenerate a golden to make a red test green.
