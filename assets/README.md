# Brand assets

| File | Use |
| --- | --- |
| `logo.svg` | The mark on its own — 32-unit grid, scales to any size. |
| `logo-wordmark.svg` | Mark plus "PATHFINDER" for headers and the README. |
| `logo-wordmark.png` | 714×96 raster for contexts that reject SVG, such as npm. |
| `favicon.svg` | Browser tab icon. |
| `favicon-32.png` | 32×32 fallback for clients without SVG favicon support. |

## Colours

The mark is **blaze orange `#E0611F`**, the paint used on real trail markers.
It is deliberately the only colour in the mark, because it clears the WCAG 3:1
non-text contrast minimum against both a white page (3.58:1) and GitHub's dark
canvas `#0D1117` (5.25:1). One file therefore serves both themes — there are no
light and dark variants, and the README needs no `<picture>` element with
`prefers-color-scheme`. The wordmark letters are **bearing grey `#6B7280`**
(4.8:1 on white, 3.9:1 on dark). Any future asset should use these two values and
be checked against both grounds before it ships.

## Conventions

Everything here is hand-authored SVG with no build step, no embedded raster, and
no font reference — the wordmark letterforms are drawn as paths, so they render
identically everywhere and cannot fall back to a substitute face. The PNGs are
rasterised from the SVGs; regenerate them if the SVG changes rather than editing
them directly.
