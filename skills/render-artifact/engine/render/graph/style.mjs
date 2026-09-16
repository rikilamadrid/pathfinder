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

/* ---- what the map says about itself before it is touched ----

   Every other signal this artifact has is state-dependent: a control un-greys
   once it can do something, a node lights up once it is chosen, the status line
   describes a selection once there is one. At rest all of them are off, and a
   reader who has not yet guessed that the picture answers gestures is shown
   nothing that says it does. That is a discoverability failure, not a styling
   preference, and the cursor is the cheapest honest fix: it is present before
   any click, it follows the pointer, and it names the gesture that will work.

   It changes with the state rather than claiming one thing throughout, because
   the available gesture genuinely changes. At fit the whole graph is framed and
   the clamp makes panning a no-op, so a grab cursor there would promise a
   movement that cannot happen; zoom is what is on offer, and the cursor says
   so. Once zoomed there is somewhere to pan to, and it becomes a grab. */
.pf-canvas[data-pf-pannable="true"] .pf-graph { cursor: grab; }
.pf-canvas[data-pf-dragging] .pf-graph { cursor: grabbing; }
/* A node is a thing you press, at every scale, including the one where the
   background is not draggable. The pointer says which surface it is over,
   which is the whole of the gesture arbitration made visible. */
.pf-canvas .pf-node { cursor: pointer; }
.pf-canvas[data-pf-dragging] .pf-node { cursor: grabbing; }

/* A node answers the pointer before it is clicked. The same argument: focusing
   a component has worked since the reading interactions shipped, and nothing
   on the canvas ever admitted it. This adds no behaviour — it makes behaviour
   that already exists visible. */
.pf-node { cursor: pointer; }
.pf-node:hover .pf-node-box { stroke: var(--pf-accent); }

/* ---- where the keyboard is, on the map ----

   The drawn component is the control, so the focus indicator belongs on it and
   in the same vocabulary the canvas's own tab stop already uses: the accent,
   three pixels of it, held off the shape so the node's stroke stays readable
   underneath. An outline rather than a thicker stroke deliberately, because
   the thicker accent stroke already means *selected* — a reader tabbing across
   the map has to be able to tell where the keyboard is from what they have
   chosen, and two signals that look alike tell them neither.

   The :focus-visible rule alone would be the whole of it if every engine
   agreed about that pseudo-class on an SVG element; the pair below is the
   ordinary fallback, and it resolves to the same thing: a ring for the
   keyboard, and nothing for a click.

   Opacity is restored last. A focused node may be one the current selection
   dims to 22%, and a focus ring nobody can see is not a focus indicator. */
.pf-node:focus { outline: 3px solid var(--pf-accent); outline-offset: 3px; }
.pf-node:focus:not(:focus-visible) { outline: none; }
.pf-node:focus-visible { outline: 3px solid var(--pf-accent); outline-offset: 3px; }
.pf-node[data-pf-state]:focus-visible { opacity: 1; }

/* The live scale, set in the same type as the rest of the instrument panel
   and given a fixed-width figure so the control surface does not twitch as
   the camera moves through 100% / 125% / 150%. */
.pf-tool-scale {
  padding: 4px 8px;
  color: var(--pf-muted);
  font-family: var(--pf-mono);
  font-size: .78rem;
  font-variant-numeric: tabular-nums;
  min-width: 4.5ch;
  text-align: center;
}

/* ---- the stage ----

   Inside the explorer the canvas is not a figure in a column; it is the screen.
   It loses the card treatment it wore as an illustration — the margin, the
   border, the radius, the shadow, the horizontal scrollbar — because a surface
   that fills the viewport has nothing to sit on and nothing to scroll beside.

   The SVG is sized to the stage rather than to its own aspect ratio, and the
   viewBox does the rest: with the default xMidYMid meet, zoom 1 is the whole
   graph centred in whatever shape the window happens to be. That is what makes
   "fit" mean fit-to-screen here without a single measurement.

   Native touch scrolling is deliberately left alone. The explorer takes no
   touch gesture of its own, so suppressing the browser's would cost a touch
   reader the page and buy nothing. */
/* The stage is a grid so the panel can take real width from the map rather
   than cover part of it. Two columns: the map, and whatever the panel needs.
   A hidden panel is display:none, so the auto column measures nothing and
   the map has the whole stage — the same rule describes both states, and there
   is no "panel open" class for them to disagree about.

   This is what makes 52.2's contract cheap. Because the panel is a sibling
   that shrinks the canvas, the canvas's own box is already the rectangle left
   free of it, measured by the browser rather than predicted by arithmetic that
   could drift from the stylesheet. */
[data-pf-layout="explorer"] .pf-stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  /* Lead, map, controls. The controls' row is auto so it takes exactly the
     height the buttons need at this width and no more — it grows on its own
     when they wrap, which is the width where guessing a reserved band would
     have been wrong. */
  grid-template-rows: auto minmax(0, 1fr) auto;
}
[data-pf-layout="explorer"] .pf-lead { grid-column: 1 / -1; }
[data-pf-layout="explorer"] .pf-canvas { grid-column: 1; grid-row: 2; }
[data-pf-layout="explorer"] .pf-panel { grid-column: 2; grid-row: 2; }
[data-pf-layout="explorer"] .pf-lead {
  flex: 0 0 auto;
  margin: 0;
  padding: var(--pf-space-4) var(--pf-space-5) var(--pf-space-3);
}
[data-pf-layout="explorer"] .pf-lead h1 { margin: 0; font-size: 1.35rem; }
[data-pf-layout="explorer"] .pf-lead-sub {
  margin: var(--pf-space-1) 0 0;
  font-size: .9rem;
}
[data-pf-layout="explorer"] .pf-canvas {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 0;
  background: none;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  overflow: hidden;
}
[data-pf-layout="explorer"] .pf-graph {
  width: 100%;
  height: 100%;
  /* The camera's own origin. With the transform anchored at the top-left, a
     point p inside the element lands at x + p*scale on screen, which is what
     makes the clamp two comparisons and the pan a raw pixel delta.

     The touch-action property is deliberately absent. It was here to stop the browser
     scrolling the page before custom touch gestures could see it; those
     gestures are gone, and suppressing native touch scrolling for a gesture
     stack that no longer exists would take the page away from touch readers
     for nothing. */
  transform-origin: 0 0;
  will-change: transform;
}
/* Motion only for an automatic move, and only while one is running.

   The transition is opt-in rather than standing, because a standing one is
   applied to every write of this property -- including the sixty a second a
   drag makes. Each of those would then be eased over its own duration, and the
   map would lag the pointer by most of it: a 1:1 pan cannot go through an
   easing curve and still be 1:1. The script sets the attribute when it moves
   the camera itself and clears it the moment the reader takes over, so the
   rule is on for exactly the movement it is for.

   Slower than a control's feedback and eased out rather than in-and-out,
   because this is the viewpoint travelling over a fixed map. Nothing in the
   graph moves: the transform is on the map as a whole, so every node keeps
   every coordinate the build-time layout gave it, and what changes is where
   the reader is standing. */
[data-pf-layout="explorer"] .pf-canvas[data-pf-camera] .pf-graph {
  transition: transform .34s cubic-bezier(.22, .61, .36, 1);
}
/* The controls sit in a row of their own beneath the map, and that is a
   correction the integrated acceptance run forced.

   They used to float in the map's bottom-left corner, sharing the canvas's
   grid cell so that neither took space from the other. The reasoning was
   sound and the result was not: an opaque card with a shadow, stacked over
   the map, hides whatever the map has drawn underneath it. Measured on the
   acceptance specimen at 1440x900, that was two of the twenty components --
   stage-kit.mjs and publish-guard.mjs, both present and both readable with
   scripting off, and both invisible the moment the explorer enhanced the
   page. A reader cannot look for what they cannot see, and the overview state
   is the one that has to show them where to explore next.

   The fix is the smallest one that makes the defect impossible rather than
   unlikely: give the controls a row, and the grid stops overlapping them with
   anything. It is the same contract 52.3 wrote for the panel, applied to the
   other piece of chrome -- the panel takes width from the map by being a grid
   sibling, and the toolbar now takes height from it the same way. What the
   free rectangle reports and what the browser paints cannot disagree, because
   there is no longer an overlay for them to disagree about.

   The alternatives were measured and rejected. Making the card translucent
   only makes the collision prettier. Reserving the band under a still-floating
   toolbar costs exactly the same height while keeping the overlay that caused
   the defect. Tucking the controls beside the title fails on arithmetic: the
   bar is about 890px wide, so it fits next to a short title at 1440 and
   collides with a longer one, at a narrower window, or in a language whose
   words are longer.

   Full stage width rather than the map's column, so the controls do not jump
   sideways when the panel opens and takes the map's width away. */
[data-pf-layout="explorer"] .pf-graph-tools {
  grid-column: 1 / -1;
  grid-row: 3;
  margin: 0;
  padding: var(--pf-space-3) var(--pf-space-5);
  background: var(--pf-surface);
  border-top: 1px solid var(--pf-line);
}
[data-pf-layout="explorer"] .pf-graph-status { margin-top: var(--pf-space-2); }

/* Selection. Keyed off attributes the script sets and nothing else, so the
   delivered document is identical whether or not a browser ever runs it.

   The focused component is a filled slab rather than a differently-bordered
   box, and that is a correction rather than a decoration. Until the integrated
   acceptance run the three states differed on two channels: a border colour,
   and opacity. Measured on the acceptance specimen, that is not enough at the
   scale a focus actually lands at. The focus camera reaches 2.34, and at that
   scale most of the graph is off-frame -- eight of the twenty components leave
   two or more direct neighbours inside the frame, and run() leaves six. The
   competition is therefore almost entirely focused-against-near, and those two
   were separated by one thin border and 25% opacity while sharing a fill, a
   size, and a typeface. Opacity is also the weakest of the channels available
   here: a white box on a near-white page barely moves when it is faded, so the
   25% bought far less separation than the number suggests.

   Filling the focused component with the accent changes what kind of object it
   is rather than how strongly the same object is drawn, which is what makes it
   findable in one glance instead of by comparison. No colour is invented to do
   it: --pf-accent over --pf-accent-ink is the pairing .pf-skip already
   ships in the shared theme, it is measured in both themes by the contrast
   suite, and theme.mjs's own note -- the accent may take a rule or a fill but
   never a word -- is the rule being followed rather than bent.

   The role stroke this overrides is not lost. A focused component states its
   role twice in words: in the caption inside the box, and in the panel docked
   beside it. A dash pattern is the weakest of those three and the only one the
   fill costs.

   "near" drops further than it did for the same reason the fill exists: the
   neighbours have to recede, and opacity is doing that work alone. It stays
   well clear of "off", because a component whose neighbours are unreadable
   tells the reader less than one whose neighbours are merely quieter. */
.pf-node[data-pf-state="off"],
.pf-edge[data-pf-state="off"] { opacity: .22; }
.pf-node[data-pf-state="near"],
.pf-edge[data-pf-state="near"] { opacity: .62; }
.pf-node[data-pf-state="on"] .pf-node-box {
  fill: var(--pf-accent);
  stroke: var(--pf-accent);
  stroke-width: 4;
}
.pf-node[data-pf-state="on"] .pf-node-label,
.pf-node[data-pf-state="on"] .pf-node-role { fill: var(--pf-accent-ink); }
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

/* ---------- the docked detail surface ----------

   Part of the explorer, not an article beside it: it shares the map's edge,
   carries the same surface and line tokens as every other panel in the kit,
   and scrolls on its own so reading a long component never scrolls the map
   out from under the reader. The map keeps its full height beside it, which
   is the requirement that rules out docking below.

   Nothing here styles a component. What lands in .pf-panel-body is a
   pf-card written by the renderer and moved, so it arrives with the styling
   it already had in the reading — one presentation of a citation, not a second
   one that could drift from it. The rules below only undo the card's own outer
   spacing, which belonged to a list it is no longer in. */
/* display:flex would otherwise beat the user agent's [hidden] rule, and an
   author declaration outranks it. Without this the closed panel keeps its
   column: an empty bordered frame taking a third of the stage before anything
   is selected, and dead chrome on a page with no scripting at all. */
.pf-panel[hidden] { display: none; }
.pf-panel {
  display: flex;
  flex-direction: column;
  width: min(380px, 38vw);
  min-height: 0;
  overflow: hidden;
  background: var(--pf-surface);
  border-left: 1px solid var(--pf-line);
}
.pf-panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pf-space-2);
  flex: 0 0 auto;
  padding: var(--pf-space-3) var(--pf-space-4);
  border-bottom: 1px solid var(--pf-line);
}
/* The title takes its own row so the two controls stay on one line together.
   Sharing a row with them wrapped "Close" onto a line of its own at the panel's
   real width, which reads as a third thing rather than the pair it is. */
.pf-panel-title {
  flex: 1 0 100%;
  margin: 0;
  font-size: .72rem;
  font-family: var(--pf-mono);
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--pf-muted);
}
.pf-panel-body,
.pf-panel-relations {
  padding: var(--pf-space-4);
  overflow-y: auto;
}
.pf-panel-body { flex: 0 1 auto; }
.pf-panel-relations {
  flex: 1 1 auto;
  min-height: 0;
  border-top: 1px solid var(--pf-line);
}
/* The moved card sheds the frame it wore in the reading. It is the panel's
   only occupant now, so a second border inside a bordered panel would be a
   box in a box saying nothing. */
.pf-panel-body .pf-card {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
}
/* The card's own focus button is how the written reading selects a component.
   Inside the panel it would offer to select what is already selected. */
.pf-panel-body .pf-pick { display: none; }
.pf-panel-relations .pf-legend { gap: var(--pf-space-3); }

/* Narrow: there is no width to give a column, so the panel takes height
   instead and the map keeps the rest. Still reserved space and still the same
   panel — the smallest adaptation that keeps both things on screen, not a
   second design. */
@media (max-width: 900px) {
  [data-pf-layout="explorer"] .pf-stage {
    grid-template-columns: minmax(0, 1fr);
    /* The map's row carries a floor, and the panel's a ceiling. Without the
       floor the panel's content decides how much map is left, and a component
       with four detail paragraphs crushes the map to a strip -- which loses
       the one thing docking beside the map was for: seeing what you selected
       while you read about it. The map keeps the larger share by construction,
       not by hoping the content is short. */
    grid-template-rows: auto minmax(42svh, 1fr) auto;
  }
  [data-pf-layout="explorer"] .pf-canvas { grid-column: 1; grid-row: 2; }
  [data-pf-layout="explorer"] .pf-panel { grid-column: 1; grid-row: 3; }
  /* The controls go back over the map here, and only here. Three rows is what
     this stage can hold: the map's 42svh floor and the panel's 34svh ceiling
     are the accepted geometry, the lead takes what a title takes, and at this
     width the controls wrap to three rows of buttons about 169px tall. A
     fourth row for them does not fit, and the row that loses is the map's --
     measured at 430x880 with a component selected, it fell from 369px to
     119px and took the focused label down to 0.85 of its authored size, which
     is the one thing the camera is not allowed to do.

     So narrow keeps the overlay and the occlusion that comes with it. That is
     a real limitation rather than a tidy resolution, and it is bounded: the
     focus camera frames into the rectangle publishFreeRect() publishes, which
     already subtracts this bar, so a selected component is never parked under
     it. What narrow does not get is the clean overview desktop now has. */
  [data-pf-layout="explorer"] .pf-graph-tools {
    grid-column: 1;
    grid-row: 2;
    align-self: end;
    justify-self: start;
    position: relative;
    z-index: 2;
    max-width: calc(100% - var(--pf-space-4) * 2);
    margin: var(--pf-space-4);
    padding: var(--pf-space-3);
    border-top: 0;
    border: 1px solid var(--pf-line);
    border-radius: var(--pf-radius);
    box-shadow: var(--pf-shadow);
  }
  .pf-panel {
    width: auto;
    max-height: 34svh;
    border-left: 0;
    border-top: 1px solid var(--pf-line);
  }
}
`.trim();
