// Rasterises the PWA icon set into `assets/` from the single hand-authored
// mark, `assets/logo.svg`. Run it with `npm run icons` from `site/`, and only
// when the mark changes — the outputs are committed brand files, not build
// output. Nothing in the site build calls this script, so `sharp` stays a
// devDependency and a deploy never rasterises anything.
//
// Why a script rather than a one-off command in a README: `assets/README.md`
// asks that raster files be regenerated rather than edited, and a convention
// nobody can re-run is not a convention. This file *is* the recorded command.
//
// The mark is drawn edge to edge on its 32-unit grid, so each output states its
// own inset rather than inheriting one. See SAFE_ZONE below for the case that
// actually matters.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = resolve(siteRoot, '..', 'assets');
const mark = join(assets, 'logo.svg');

// `logo.svg` declares width="32" height="32", so libvips renders it at 32px at
// the default 72dpi. Deriving density from the target size renders the vector
// at full resolution instead of upscaling a 32px bitmap.
const BASE_PX = 32;
const BASE_DPI = 72;

// White, the ground the brand's contrast figures are quoted against in
// `assets/README.md` (blaze orange clears 3.58:1 on it). Opaque backgrounds are
// not a style choice here: iOS composites a transparent `apple-touch-icon` onto
// black, and a maskable icon's background is what the launcher's mask cuts into.
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// The maskable safe zone is a centred circle whose diameter is 80% of the icon;
// anything outside it may be cropped. The mark's bounding box is a square, and a
// square only fits inside that circle if its side is the circle's diameter over
// √2 — 56.6%, not 80%. Sizing the mark at 80% would put its corners outside the
// circle, which is exactly how a maskable icon ends up with a clipped edge.
const SAFE_ZONE = 0.8 / Math.SQRT2;

const targets = [
  // The two sizes every installability checker looks for. `purpose: "any"`
  // icons are composited by the platform as-is, so they stay full-bleed and
  // transparent — the same way the mark is used everywhere else.
  { file: 'icon-192.png', size: 192, inset: 1, background: TRANSPARENT },
  { file: 'icon-512.png', size: 512, inset: 1, background: TRANSPARENT },
  // `purpose: "maskable"`. Opaque to the edge, mark inside the safe circle.
  { file: 'icon-maskable-512.png', size: 512, inset: SAFE_ZONE, background: WHITE },
  // iOS. The mask is a rounded rectangle rather than a circle, so it takes far
  // less inset than the maskable icon — 80% keeps the mark clear of the corner
  // radius without shrinking it to maskable proportions.
  { file: 'apple-touch-icon-180.png', size: 180, inset: 0.8, background: WHITE },
];

await mkdir(assets, { recursive: true });

for (const { file, size, inset, background } of targets) {
  const markPx = Math.round(size * inset);

  const rendered = await sharp(mark, { density: (BASE_DPI * markPx) / BASE_PX })
    .resize(markPx, markPx)
    .png()
    .toBuffer();

  // Compositing onto an explicit canvas rather than padding the render keeps
  // the output exactly `size` square whatever rounding the inset produced.
  const icon = await sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: rendered, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeFile(join(assets, file), icon);
  console.log(`generate-icons: ${file} — ${size}×${size}, mark at ${Math.round(inset * 100)}%`);
}

console.log(`generate-icons: wrote ${targets.length} icons to assets/ from logo.svg`);
