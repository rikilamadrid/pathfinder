# Brand assets

| File | Use |
| --- | --- |
| `logo.svg` | The mark on its own — 32-unit grid, scales to any size. |
| `logo-wordmark.svg` | Mark plus "PATHFINDER" for headers and the README. |
| `logo-wordmark.png` | 714×96 raster for contexts that reject SVG, such as npm. |
| `favicon.svg` | Browser tab icon. |
| `favicon-32.png` | 32×32 fallback for clients without SVG favicon support. |
| `icon-192.png` | Web app manifest icon, `purpose: any`. Transparent, full-bleed. |
| `icon-512.png` | Same, at the size install prompts and app listings read. |
| `icon-maskable-512.png` | Manifest icon, `purpose: maskable`. Opaque white; mark inset to the safe zone. |
| `apple-touch-icon-180.png` | iOS add-to-home-screen. Opaque — iOS composites transparency onto black. |
| `atlascope.svg` | The hero object alone, 560×560, transparent ground — the instrument from `og-image.svg` moved by one `translate`, so the two cannot drift. The docs landing page's hero image. |
| `og-image.svg` | The social card, hand-authored: wordmark beside the atlascope, 1280×640 — the 1.91:1 frame Open Graph scrapers and GitHub's repository preview both crop to without letterboxing. |
| `og-image.png` | Rasterised from `og-image.svg`, opaque, no alpha. Upload it as the repository's social preview (Settings → General) and serve it as `og:image`. |

## Colours

The mark is **blaze orange `#E0611F`**, the paint used on real trail markers.
It is deliberately the only colour in the mark, because it clears the WCAG 3:1
non-text contrast minimum against both a white page (3.58:1) and GitHub's dark
canvas `#0D1117` (5.25:1). One file therefore serves both themes — there are no
light and dark variants, and the README needs no `<picture>` element with
`prefers-color-scheme`. The wordmark letters are **bearing grey `#6B7280`**
(4.8:1 on white, 3.9:1 on dark).

### The atlascope palette

The social card is the first surface to show Pathfinder as a Wonder Wagon
object — the atlascope, a brass-cased cobalt instrument whose paper well
carries the four-bar mark as the trail it has recorded. The mark's geometry and
colour are unchanged; blaze now works as the instrument's *signal* (the trail,
the needle tip) rather than as a shell. These values are the ecosystem's, not
new inventions:

| Role | Value | Where |
| --- | --- | --- |
| Field paper | `#F5DCA6` | Card ground |
| Quiet paper | `#FBF3DE` | The map well, the maker's label |
| Cobalt enamel | `#12496B` | The instrument's face |
| Brass | `#A96E2D` | Chassis ring, bezel, pivot, fasteners |
| Edge | `#553316` | Needle tail, seams, outlines |
| Ink | `#2A160D` | Serial strokes on the label |

Every pairing the card actually paints was measured against the ground it sits
on, not assumed from earlier work:

| Pairing | Ratio | Needs |
| --- | ---: | --- |
| Bearing grey wordmark on field paper | 3.61 | 3.0 (large text) |
| Cobalt face against field paper | 7.15 | 3.0 (object boundary) |
| Brass ring against field paper | 3.16 | 3.0 (boundary) |
| Paper well against cobalt face | 8.66 | 3.0 (boundary) |
| Blaze trail bars on the paper well | 3.22 | 3.0 (non-text signal) |
| Blaze needle tip on the paper well | 3.22 | 3.0 (non-text signal) |
| Edge needle tail on the paper well | 10.14 | 3.0 |
| Cream detent ticks on cobalt | 7.74 | 3.0 |
| Ink serial on the paper label | 15.57 | 4.5 (small text) |
| Muted-ink pencil mark on the paper well | 8.38 | 3.0 |

Two pairings are **material seams, not information**, and are exempt from the
3:1 floor: brass ring against cobalt face (2.26) and bezel against enamel. They
are separated by the machined rim highlight and a shadow line, the way real
adjacent materials are, and neither carries a value a reader needs. The
object's boundary against the page — which does carry information — passes.

Blaze on paper is the pairing to watch. It clears 3.22:1 on quiet paper but
only 2.66:1 on field paper, so on the field ground it is never used bare: the
card keeps every blaze element on the quiet-paper well or the label. Any future
asset that puts blaze directly on field paper must give it an edge outline or
move it.

## Conventions

Everything here is hand-authored SVG with no build step, no embedded raster, and
no font reference — the wordmark letterforms are drawn as paths, so they render
identically everywhere and cannot fall back to a substitute face. The PNGs are
rasterised from the SVGs; regenerate them if the SVG changes rather than editing
them directly.

The four PWA icons and the social card are regenerated from their SVG sources
by one command, run from `site/`:

```sh
npm run icons                  # everything
npm run icons -- og-image.png  # one output; the icon set's bytes stay untouched
```

That is [`site/scripts/generate-icons.mjs`](../site/scripts/generate-icons.mjs),
which uses `sharp` — a `devDependency` of the site and of nothing else. It runs
by hand when a source changes; no build calls it, and the files it writes are
committed here as brand files rather than produced at deploy time. Each output's
inset and background is stated in that file, including why the maskable icon's
mark is sized at 56.6% and not the 80% the safe zone's diameter suggests.

`favicon-32.png` and `logo-wordmark.png` predate the script and are left byte for
byte as Feature 03 shipped them. If either needs regenerating, add it to the
script rather than reaching for a one-off command.
