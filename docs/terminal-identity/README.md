# Pathfinder: family reference audit

Pathfinder remains the reference sibling. Its four orange strokes widen toward
the viewer like trail markers: `3 / 5 / 7 / 9` cells. The silhouette, tagline,
serial `PF-047`, current version `4.4.0`, and terminal placement are preserved.
This audit changes no source, generated identity, package, dependency, or test.

## Family grammar already present

- Two leading cells; nine-cell mark; four cells between mark and name column.
- Letterspaced uppercase product name; version then serial on the same row.
- Tagline immediately below the name; one blank line around the identity.
- Truecolor orange `#E0611F`, stable 256-color orange, warm ANSI-16 fallback.
- `NO_COLOR` preserves Unicode geometry while removing every escape sequence.
- `WW_ASCII=1` substitutes `=` geometry without disabling permitted color.
- Non-TTY rendering is the established contract tier.

The intentional help contract returns plain reference text before identity.
The no-argument installer shows the identity before its first question. Neither
surface needs redesign to belong to the family. Refusing initialization retains
its existing status and output; the `no-arg` capture answers `n` in a disposable
directory, so no user project is touched.

## Narrow limitation retained deliberately

The shipped formatter switches to its single-line identity when a block would
wrap. It works at 42 columns. The identity line itself occupies 35 cells for the
current version, so a 32-column terminal wraps it. The frozen test explicitly
requires this form to contain no newline. Both widths are captured, and this
audit preserves that approved byte behavior rather than silently broadening the
change. New family rendering can offer an opt-in stacked form to other products.

## Reproduce the evidence

```sh
npm ci --ignore-scripts --prefix packages/create-pathfinder
npm test --prefix packages/create-pathfinder
python3 .github/scripts/validate-kit.py
python3 docs/terminal-identity/capture.py
python3 docs/terminal-identity/check-contracts.py
```

The capture command opens real pseudo-terminals with explicit widths. `.ansi`
files contain their actual bytes; `.txt` companions remove terminal SGR/control
sequences for reading. The manifest records command, width, capability overrides,
input, and exit status. Capture directories are temporary, so their displayed
paths can differ between runs. The help and no-argument captures are real CLI
entry surfaces. The mark captures use a harmless `--dry-run --yes` invocation.

## Regression evidence

All existing CI suites ran: installer **701**, render-artifact **825**,
orchestrate **166**, evidence-references **88**, blog-post-redactor **132**, and
reflect **137** passed: **2,049 passed**, **25 existing render-artifact skips**,
zero failures. Structural validation passed for all 26 skills. The generated
identity drift check passed against the pinned `wonder-wagon-ui@0.1.0`.

The installer suite retains its six-tier pre-foundation byte oracle, existing
narrow assertion, ASCII override, placement rules, and contract tests unchanged.
`contract-proof.json` records **42** baseline/current command comparisons across
seven environments. Each comparison checks exact stdout bytes, stderr bytes,
and exit status for version, help, invalid flag, unsupported JSON flag, dry-run,
and refused initialization. Pathfinder does not expose a JSON mode; `--json`
remains its existing usage error. No package content or release is required.
