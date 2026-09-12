#!/usr/bin/env node
/**
 * Build the typography probe: the multilingual diagram, instrumented to measure
 * itself in the browser and say whether any label escaped its box.
 *
 * The measurement happens at view time and feeds nothing back into layout — the
 * geometry is already fixed in the delivered bytes before a browser sees them.
 * That distinction is the whole point. Measuring the *result* in three engines
 * is how the cell model is checked; measuring text *to decide* the result is
 * the thing the determinism invariant forbids, and nothing here does it.
 *
 * The probe is a copy with a script appended, never the artifact itself.
 *
 *   node scripts/typography-probe.mjs [outDir]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { SPECS, cleanUpTemporaryDirectories, deliverInSubprocess } from "../lib/harness.mjs";

const INSTRUMENT = `
<script>
(function () {
  "use strict";
  /* Inset the renderer leaves inside a node box for its label. */
  var INSET = 14;

  function boxOf(el) { var b = el.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }
  function within(inner, outer, inset) {
    return inner.x >= outer.x + inset - 0.5
      && inner.x + inner.w <= outer.x + outer.w - inset + 0.5
      && inner.y >= outer.y - 0.5
      && inner.y + inner.h <= outer.y + outer.h + 0.5;
  }

  var rows = [];
  var worst = 0;
  var failures = 0;

  Array.prototype.forEach.call(document.querySelectorAll("g.pf-node"), function (g) {
    var rect = g.querySelector("rect.pf-node-box");
    var label = g.querySelector("text.pf-node-label");
    if (!rect || !label) return;
    var r = boxOf(rect), t = boxOf(label);
    var ok = within(t, r, INSET);
    var usage = t.w / (r.w - INSET * 2);
    if (usage > worst) worst = usage;
    if (!ok) failures += 1;
    rows.push({ id: rect.id.replace(/^n--/, ""), ok: ok,
      text: Math.round(t.w), room: Math.round(r.w - INSET * 2),
      usage: Math.round(usage * 100) });
  });

  var panel = document.createElement("div");
  panel.setAttribute("style",
    "position:fixed;left:0;right:0;bottom:0;z-index:9999;max-height:46vh;overflow:auto;" +
    "font:12px ui-monospace,Menlo,monospace;padding:12px 16px;" +
    "background:" + (failures ? "#A62B1E" : "#1F6F43") + ";color:#fff");

  var lines = rows.map(function (r) {
    return (r.ok ? "  ok   " : "  ESCAPES ") + r.id +
      "  text " + r.text + "px in " + r.room + "px  (" + r.usage + "% of the room)";
  });

  var verdict = failures === 0
    ? "PASS — every label is inside its box"
    : "FAIL — " + failures + " label(s) escaped";

  panel.textContent = verdict +
    "\\nengine: " + navigator.userAgent +
    "\\nwidest label uses " + Math.round(worst * 100) + "% of the room available" +
    "\\nnodes measured: " + rows.length + "\\n\\n" + lines.join("\\n");

  document.title = (failures === 0 ? "PASS" : "FAIL") + " — typography probe";
  document.body.appendChild(panel);
})();
</script>
`;

const outDir = resolve(process.argv[2] ?? join(process.cwd(), "probe"));
mkdirSync(outDir, { recursive: true });

const delivery = deliverInSubprocess({ spec: SPECS.multilingual });
if (delivery.status !== 0) {
  process.stderr.write(`the multilingual fixture did not deliver\n${delivery.stderr}\n`);
  cleanUpTemporaryDirectories();
  process.exit(1);
}

const probe = delivery.html.replace("</body>", `${INSTRUMENT}</body>`);
const target = join(outDir, "typography-probe.html");
writeFileSync(target, probe, "utf8");
cleanUpTemporaryDirectories();

process.stdout.write(
  `wrote ${target}\n\n` +
  `The artifact itself is unchanged; this is a copy with a measuring script\n` +
  `appended. Open it in each engine and read the banner at the foot of the page:\n\n` +
  `  open -a "Google Chrome" ${target}   # Chromium\n` +
  `  open -a "Safari"        ${target}   # WebKit\n` +
  `  open -a "Firefox"       ${target}   # Gecko\n\n` +
  `The banner is green and says PASS when every label sits inside its box, and\n` +
  `red naming the offenders when one does not. It also reports how much of the\n` +
  `available room the widest label used, which is the margin the cell model is\n` +
  `buying — a number near 100%% is a pass with nothing to spare.\n`);
