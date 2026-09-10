# Determinism

**The invariant:** given the same specification bytes and the same renderer
version, rendering produces byte-identical HTML in every supported environment.

The renderer implementation is part of the compiler, which is why the version is
named in the invariant and reported in every receipt. A renderer release may
intentionally change output — that is a version change, not a determinism
failure. Without the version in the receipt, the two would be indistinguishable.

**If you change anything that can alter rendered HTML — markup, CSS, inline
behaviour, ordering, escaping — bump `engine/version.mjs` in the same commit.**
A kit release that does not touch rendering must leave it alone.

## What the invariant forbids

Nothing in the render path may read:

- a clock, in any form — `Date`, `Date.now`, a timestamp, a duration
- randomness, including `Math.random` and `randomUUID`
- the machine — hostname, username, environment variables, process or OS details
- the filesystem's opinion — the working directory, an absolute path, a
  directory listing's order
- the locale — `Intl`, `localeCompare`, or any locale-dependent number, date, or
  string formatting

If a timestamp appears in an artifact, it came from `source.generated_at` in the
specification. There is no other way for one to get there.

## How it is enforced

**The render path imports nothing.** `render/index.mjs`, `render/lesson.mjs`,
`render/shell.mjs`, `render/theme.mjs`, `render/behavior.mjs`,
`render/escape.mjs`, `version.mjs` and `verification.mjs` import only each
other. Not one `node:` builtin between them. `verification.mjs` in particular
imports nothing at all, which is why the shell can consult it without dragging
the validator — and `node:fs` with it — into rendering. Rendering is a pure function of the specification and this
code, and the cheapest way to keep it that way is for there to be nothing
ambient in scope to reach for.

**Ordering comes from the specification.** Every list is emitted in the order
the specification wrote it. Where a set has to be ordered — extra properties in
a diagnostic, for instance — it is sorted by codepoint, never with
`localeCompare`, whose answer depends on the reader's locale.

**Identifiers are derived.** Every DOM id is built from producer-supplied ids
joined with a separator the identifier pattern forbids. No counter, no hash, no
insertion order.

**The bytes are checked, not assumed.** Delivery rejects output containing a
carriage return or beginning with a byte-order mark, rather than trusting that
no template ever grew one.

## How to check it

Render the same specification in deliberately different environments and compare
the artifact digests:

```sh
cd /some/other/directory
TZ=Pacific/Kiritimati LANG=tr_TR.UTF-8 LC_ALL=tr_TR.UTF-8 \
  node .../engine/bin/render.mjs deliver <spec.json> <out.html> --repo <repo> --json
```

Different working directory, different timezone, different locale. The
`sha256` in the receipt must not move.

`doctor`'s determinism check is weaker and says so: it compares two renders
inside one process, which catches a renderer that varies run to run but cannot
see an environment dependency at all. Cross-environment determinism is checked
by actually varying the environment.
