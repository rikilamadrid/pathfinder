/**
 * How a diagram looks, in terms of the identity that already exists.
 *
 * Not one colour is defined here. Every value below resolves to a `--pf-*`
 * token from `theme.mjs`, so a diagram inherits both themes, the measured
 * contrast behind them, and any future change to either, without restating a
 * single one. That is what "adding a kind must not require restating the
 * identity" means when the kind is a picture rather than a page.
 *
 * What *is* defined here is shape: stroke weights, corner treatment, the grid
 * the canvas sits on. Those are diagram vocabulary and have no meaning for a
 * lesson, which is why they live beside the diagram renderer rather than in the
 * shared theme.
 *
 * Two deliberate choices, both of which read as design and are really
 * accessibility:
 *
 * - **Role is never carried by colour alone.** Shape and a printed role word
 *   carry it; the accent only reinforces it.
 * - **Labels are monospace.** Diagram labels are technical tokens — endpoint
 *   names, queue names, service names — and mono is the honest typography for
 *   them. It is also what keeps a character-budget line break close to the
 *   truth while the width-aware model is still being decided.
 */

export const GRAPH_CSS = `
.pf-canvas {
  margin: var(--pf-space-5) 0 var(--pf-space-7);
  padding: var(--pf-space-4);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-radius);
  box-shadow: var(--pf-shadow);
  overflow-x: auto;
}
.pf-graph {
  display: block;
  width: 100%;
  height: auto;
  font-family: var(--pf-mono);
}

.pf-group-box {
  fill: var(--pf-surface-2);
  stroke: var(--pf-line-strong);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}
.pf-group[data-pf-depth="1"] .pf-group-box { stroke-dasharray: 2 3; }
.pf-group-label {
  fill: var(--pf-muted);
  font-size: 12px;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.pf-node-box {
  fill: var(--pf-surface);
  stroke: var(--pf-line-strong);
  stroke-width: 2;
}
.pf-node[data-pf-role="store"] .pf-node-box,
.pf-node[data-pf-role="queue"] .pf-node-box { stroke-dasharray: 7 3; }
.pf-node[data-pf-role="external"] .pf-node-box,
.pf-node[data-pf-role="actor"] .pf-node-box { stroke: var(--pf-accent); }
.pf-node[data-pf-role="terminal"] .pf-node-box { stroke: var(--pf-ok); }
.pf-node[data-pf-role="decision"] .pf-node-box { stroke: var(--pf-accent); stroke-dasharray: 3 3; }

.pf-node-label {
  fill: var(--pf-ink);
  font-size: 13px;
  font-weight: 600;
}
.pf-node-role {
  fill: var(--pf-muted);
  font-size: 10px;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.pf-edge-line {
  fill: none;
  stroke: var(--pf-line-strong);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.pf-edge-on-path .pf-edge-line { stroke: var(--pf-accent); stroke-width: 3; }
.pf-edge[data-pf-relation="depends_on"] .pf-edge-line { stroke-dasharray: 5 4; }
.pf-edge[data-pf-relation="publishes"] .pf-edge-line,
.pf-edge[data-pf-relation="consumes"] .pf-edge-line { stroke-dasharray: 2 4; }
.pf-edge-label {
  fill: var(--pf-muted);
  font-size: 11px;
}
.pf-edge-on-path .pf-edge-label { fill: var(--pf-link); }

/* ---- the reading controls, and what a selection looks like ----

   Three states, and the distinction is deliberate. "on" is what the reader
   asked about. "near" is what it touches — still readable, because a component
   whose neighbours have been greyed out tells you less than one whose
   neighbours are merely quieter. "off" is the rest of the graph, dimmed rather
   than removed: the document keeps every fact whatever is selected, and a
   reader who dislikes the dimming can turn scripting off and read all of it.

   No colour is defined here either. Selection reads through the accent that
   already carries emphasis, and through opacity, so it works in both themes
   without a second palette. Opacity alone would be a colour-only signal, so
   the focused node also thickens its stroke. */
.pf-graph-tools { margin: var(--pf-space-5) 0 calc(var(--pf-space-3) * -1); }
.pf-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pf-space-2);
}
.pf-tool {
  padding: 4px 10px;
  background: var(--pf-surface);
  color: var(--pf-ink);
  border: 1px solid var(--pf-line-strong);
  border-radius: var(--pf-radius-sm);
  font-family: var(--pf-mono);
  font-size: .78rem;
  cursor: pointer;
}
.pf-tool:hover:not(:disabled) { border-color: var(--pf-accent); color: var(--pf-link); }
.pf-tool:disabled { opacity: .45; cursor: default; }
.pf-tool-sep {
  width: 1px;
  height: 1.2em;
  background: var(--pf-line);
}
.pf-graph-status {
  margin: var(--pf-space-2) 0 0;
  color: var(--pf-muted);
  font-family: var(--pf-mono);
  font-size: .78rem;
}
/* Inline and free to wrap. A float here escaped its heading at narrow widths,
   which is exactly where this gets read. */
.pf-pick { margin-left: var(--pf-space-2); white-space: nowrap; }

.pf-canvas:focus-visible { outline: 3px solid var(--pf-accent); outline-offset: 2px; }
.pf-canvas[data-pf-zoom="in"] .pf-graph { cursor: grab; }
.pf-canvas[data-pf-dragging] .pf-graph { cursor: grabbing; }

/* Selection. Keyed off attributes the script sets and nothing else, so the
   delivered document is identical whether or not a browser ever runs it. */
.pf-node[data-pf-state="off"],
.pf-edge[data-pf-state="off"] { opacity: .22; }
.pf-node[data-pf-state="near"],
.pf-edge[data-pf-state="near"] { opacity: .75; }
.pf-node[data-pf-state="on"] .pf-node-box {
  stroke: var(--pf-accent);
  stroke-width: 4;
}
.pf-edge[data-pf-state="on"] .pf-edge-line {
  stroke: var(--pf-accent);
  stroke-width: 3;
}
.pf-edge[data-pf-state="on"] .pf-edge-label { fill: var(--pf-link); }

/* The written entry the selection points at. A left rule rather than a fill:
   the card already has a surface, and stacking another on it would flatten
   the hierarchy the evidence block sits in. */
[data-pf-entry][aria-current] {
  border-left: 3px solid var(--pf-accent);
  padding-left: var(--pf-space-3);
}

@media (prefers-reduced-motion: no-preference) {
  .pf-node, .pf-edge { transition: opacity 120ms linear; }
}

/* The reading list below the canvas: the same facts, as text, for a reader who
   is not looking at a picture. */
.pf-legend { display: grid; gap: var(--pf-space-4); }
.pf-legend-role {
  display: inline-block;
  margin-left: var(--pf-space-2);
  padding: 1px 6px;
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-radius-sm);
  color: var(--pf-muted);
  font-family: var(--pf-mono);
  font-size: .72rem;
  letter-spacing: .08em;
  text-transform: uppercase;
  vertical-align: middle;
}
.pf-relation {
  font-family: var(--pf-mono);
  font-size: .82rem;
  color: var(--pf-muted);
}
.pf-walk { margin: 0; padding-left: var(--pf-space-5); }
.pf-walk li { margin-bottom: var(--pf-space-1); }
`.trim();
