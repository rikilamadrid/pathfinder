// Checks the built site actually serves an installable manifest. Runs as
// `postbuild`, so it gates the build that publishes — including the one Vercel
// runs on every deploy — rather than a separate CI job that could go green
// while the deploy is broken. A non-zero exit fails the build.
//
// It reads `dist/`, not `public/` or `assets/`: the question is what a browser
// receives, and only the build output answers that. `sync-brand.mjs` silently
// copying nothing, an icon dropped from the copy list, a manifest entry
// renamed, or a size typo are all failures a check against the sources would
// miss.
//
// Deliberately dependency-free. PNG dimensions come out of the IHDR header,
// which is eight bytes at a fixed offset, so the check cannot be broken by an
// install that omits devDependencies — `sharp` is the icon *generator's*
// dependency, and nothing at build time should need it.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(siteRoot, 'dist');
const manifestPath = join(dist, 'manifest.webmanifest');

const failures = [];
const fail = (message) => failures.push(message);

// A path in the manifest is root-relative by design — resolve it against the
// build output the same way a browser resolves it against the origin.
const served = (href) => join(dist, href.replace(/^\//, ''));

const PNG_SIGNATURE = '89504e470d0a1a0a';

// Reads width and height from a PNG's IHDR chunk: 8-byte signature, 4-byte
// length, 4-byte type, then two big-endian 32-bit integers.
async function readPng(file) {
  const buf = await readFile(file);
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch (error) {
  console.error(`check-manifest: dist/manifest.webmanifest is missing or is not valid JSON`);
  console.error(`  ${error.message}`);
  process.exit(1);
}

// The keys an installability prompt is judged on, plus the two colours, which
// are useless when absent and misleading when wrong.
for (const key of [
  'name',
  'short_name',
  'description',
  'start_url',
  'scope',
  'display',
  'theme_color',
  'background_color',
]) {
  if (!manifest[key]) fail(`manifest is missing "${key}"`);
}

const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
if (icons.length === 0) fail('manifest declares no icons');

for (const icon of icons) {
  const { src, sizes, type } = icon;
  if (!src) {
    fail('an icon entry has no "src"');
    continue;
  }

  const png = await readPng(served(src)).catch(() => null);
  if (!png) {
    fail(`icon "${src}" does not resolve in dist/, or is not a PNG`);
    continue;
  }

  // The declared size is what a launcher picks an icon by. A file that resolves
  // at the wrong size is worse than a missing one, because nothing complains.
  const [declaredW, declaredH] = String(sizes ?? '').split('x').map(Number);
  if (png.width !== declaredW || png.height !== declaredH) {
    fail(`icon "${src}" is ${png.width}x${png.height} but declares sizes="${sizes}"`);
  }
  if (type !== 'image/png') {
    fail(`icon "${src}" is a PNG but declares type="${type}"`);
  }
}

// Installability wants both, and a launcher that only reads one purpose must
// still find something.
const purposes = icons.flatMap((icon) => String(icon.purpose ?? 'any').split(/\s+/));
if (!purposes.includes('any')) fail('no icon has purpose "any"');
if (!purposes.includes('maskable')) fail('no icon has purpose "maskable"');
for (const size of ['192x192', '512x512']) {
  if (!icons.some((icon) => icon.sizes === size)) fail(`no icon declares sizes="${size}"`);
}

// The landing page is where the manifest and the icons stop being files and
// become something a browser is told about. iOS in particular reads only this.
const landing = await readFile(join(dist, 'index.html'), 'utf8');

if (!landing.includes('rel="manifest"')) {
  fail('the built landing page does not link the manifest');
}

// A reader can install from any page, not only the landing page, and iOS names
// the Web Clip from the page it was added from — from the document title unless
// `apple-mobile-web-app-title` is present. That is why every page is checked and
// not a sample: the defect this replaces was metadata fixed in one place while
// every other page still proposed "Page | Pathfinder". A sample would also have
// to answer which page it sampled, and the answer would differ between a clean
// CI build and a developer's older `dist/`.
async function htmlPages(dir) {
  const pages = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) pages.push(...(await htmlPages(path)));
    else if (entry.name.endsWith('.html')) pages.push(path);
  }
  return pages;
}

const pages = await htmlPages(dist);
if (pages.length === 0) fail('dist/ contains no HTML pages');

const missingName = [];
const wrongName = [];
const missingAppleIcon = [];

for (const page of pages) {
  const html = await readFile(page, 'utf8');
  const name = html.match(/<meta name="apple-mobile-web-app-title" content="([^"]+)"/)?.[1];
  if (!name) missingName.push(page);
  else if (name !== manifest.short_name) wrongName.push(`${page} ("${name}")`);
  if (!/rel="apple-touch-icon"/.test(html)) missingAppleIcon.push(page);
}

// Reported as counts with examples: a site-wide regression would otherwise
// print one line per page and bury everything else.
const summarise = (paths) =>
  `${paths.length} of ${pages.length} pages, e.g. ${paths
    .slice(0, 3)
    .map((path) => path.slice(dist.length + 1))
    .join(', ')}`;

if (missingName.length > 0) {
  fail(`<meta name="apple-mobile-web-app-title"> missing — ${summarise(missingName)}`);
}
if (wrongName.length > 0) {
  fail(
    `apple-mobile-web-app-title disagrees with the manifest's short_name "${manifest.short_name}" — ${summarise(wrongName)}`,
  );
}
if (missingAppleIcon.length > 0) {
  fail(`apple-touch-icon link missing — ${summarise(missingAppleIcon)}`);
}

const appleIcon = landing.match(/<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/)?.[1];
if (!appleIcon) {
  fail('the built landing page has no apple-touch-icon link');
} else if (!(await readPng(served(appleIcon)).catch(() => null))) {
  fail(`apple-touch-icon "${appleIcon}" does not resolve in dist/, or is not a PNG`);
}

// Two places state the theme colour, and a browser reads both. They drift the
// moment someone edits one of them.
const metaThemeColor = landing.match(/<meta name="theme-color" content="([^"]+)"/)?.[1];
if (!metaThemeColor) {
  fail('the built landing page has no <meta name="theme-color">');
} else if (metaThemeColor.toLowerCase() !== String(manifest.theme_color).toLowerCase()) {
  fail(
    `<meta name="theme-color"> is ${metaThemeColor} but the manifest's theme_color is ${manifest.theme_color}`,
  );
}

if (failures.length > 0) {
  console.error(`check-manifest: ${failures.length} problem(s) with the built site:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `check-manifest: manifest valid, ${icons.length} icons plus the apple-touch-icon resolve in dist/, ` +
    `iOS name and icon metadata present on all ${pages.length} pages`,
);
