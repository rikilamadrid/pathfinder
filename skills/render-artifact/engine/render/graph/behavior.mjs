/**
 * The diagram's inline behaviour: focus, traversal, path highlight, zoom, pan,
 * and the camera that moves to whatever the reader selected.
 *
 * **Per kind, not shared.** The shell's own script carries the theme toggle,
 * navigation position and quiz feedback, and every artifact gets it. This one
 * is appended only for a diagram, for the same reason `GRAPH_CSS` is: a lesson
 * has no graph, and shipping traversal code to every lesson would put dead
 * script in an artifact that can never run it. The theme toggle in particular
 * is *reused* from the shell and not reimplemented here — a diagram-specific
 * copy would be a second control fighting the first over the same attribute.
 *
 * **Every interaction reads the semantic model.** `interaction.mjs` inlines an
 * index built from the specification's nodes, edges and paths, and traversal
 * runs over that. Nothing here measures, inspects or infers from the picture:
 * no bounding boxes are compared to decide what is downstream, no polyline is
 * asked what it touches. Geometry is an output of the graph, so reading meaning
 * back out of it would make "downstream" depend on where the layout happened to
 * put things.
 *
 * **The script only changes state.** It sets attributes — `data-pf-state`,
 * `data-pf-mode`, `aria-current`, `disabled`, and the `tabindex`, `role` and
 * `aria-label` that make a drawn component a control — and the stylesheet
 * decides what those look like. It writes one `transform` for the camera. It
 * never creates a node, never writes text into the document, and never
 * restates a summary or a citation. The one name it composes is a drawn node's
 * accessible name, and both halves of that are already in the artifact: the
 * renderer's own verb, and the label the producer gave that node. That last part is load-bearing for the provenance contract: an
 * interaction that re-rendered evidence could get it wrong, or make it read as
 * stronger than it is. Focusing a component takes the reader to the evidence
 * that is already there, in the words the renderer already chose.
 *
 * With scripting off, every fact is still in the document and the artifact is
 * still a readable, navigable page. What is lost is the ability to ask it
 * questions, which is the definition of an enhancement.
 *
 * **The camera is screen-space, and the `viewBox` is never written.** Camera
 * state is a scale and an offset applied as one `transform` on the SVG, which
 * is what lets a drag be the pointer's own pixel delta rather than a value
 * converted into user units, rounded into an integer attribute and clamped —
 * three steps that each discard a fraction of the movement, and together are
 * why the previous camera crept. It also keeps scale a float the stylesheet
 * can transition, so camera movement is animatable and interruptible.
 *
 * The only measurement is the element's own box: how large the browser is
 * currently painting this SVG, which is a fact about the reader's window at
 * the moment they gesture. It happens long after the bytes were written and
 * cannot affect them — no text is measured, no node box is measured, and no
 * coordinate is inferred from anything drawn. Every position the camera aims
 * at still comes from the integer coordinates the build-time layout wrote.
 *
 * **One gesture, one surface.** Dragging the background pans; a node or an
 * edge is activated, never dragged; a control does its own thing; and ordinary
 * wheel and trackpad scrolling belongs to the page and is not intercepted.
 * Wheel zoom and pinch zoom were removed from this Feature rather than
 * repaired — the interaction reference installs no wheel handler at all and
 * still reads unmistakably as a spatial explorer.
 *
 * **Selection and camera are two things, and they stay two things.** Selection
 * decides what is related -- out of the adjacency index, never out of the
 * picture. The camera decides where to stand to look at it, out of the integer
 * coordinates the build-time layout wrote. Focusing a component runs both, in
 * that order, and the camera consumes the selection's answer without
 * contributing to it: there is one definition of what is related to what, and
 * the thing that moves the viewpoint is not it.
 *
 * The camera's guarantee is deliberately narrow, because the wider one is
 * unreachable. It frames the focused component so its label renders at no less
 * than its authored size, inside the rectangle the docked panel and the
 * toolbar leave free, and frames as much of the neighbourhood as that scale
 * admits. Framing the *whole* neighbourhood is not promised: on the acceptance
 * specimen seventeen of twenty neighbourhoods span more canvas than a readable
 * scale can show, so a camera that promised it would be promising the overview
 * scale back. What it does instead is say how much it left outside.
 *
 * **An automatic move is a transaction the reader can end.** It is a CSS
 * transition on the one transform the camera writes, which is what makes it
 * interruptible at all: the browser is interpolating a value the script can
 * read back at any instant. Every reader gesture samples that value first,
 * adopts it, and carries on from there -- so a drag during a move continues
 * from where the movement had visibly reached rather than snapping to its
 * start or its target. Under `prefers-reduced-motion: reduce` the transition
 * is never turned on and the camera change applies immediately; every state
 * reachable with animation stays reachable without it.
 *
 * **Activating a node does not navigate.** It selects, and nothing else moves:
 * no scroll position changes, no document section is scrolled into view, and
 * no location is written. The full written reading stays available behind an
 * explicit control, which is a reader asking for it rather than a side effect
 * of touching the map.
 *
 * **One control, two ways in.** The drawn component is the control: the
 * pointer presses it and the keyboard focuses the same visible thing, and both
 * reach the same selection. There is no keyboard-only copy of a node anywhere
 * in the document, because a second representation is a second thing to keep
 * true. Enhanced, this is the whole of how selection is reached — the written
 * reading is closed, and a keyboard reader is not made to open the fallback
 * document to use the explorer everybody else is using.
 */

import { TRAVERSAL_JS } from "./interaction.mjs";
import { CAMERA_JS } from "./camera.mjs";

/**
 * Renderer-owned interface language. The producer supplies none of it, and
 * there is no field through which it could.
 *
 * The status sentences are deliberately about *structure* — what is selected
 * and how much it reaches — and never about trust. A traversal result is not a
 * verification claim, and no wording here may let it read as one.
 */
const UI = Object.freeze({
  nothing: "Nothing selected. Choose a component to focus it.",
  cleared: "Selection cleared.",
  // The two faces of one control. Naming the destination rather than the
  // mechanism -- "full reading", not "toggle panel" -- is what makes it read
  // as the deliberate secondary route it is.
  readingOpen: "Full reading",
  readingClose: "Back to map",
  // What a drawn component is called once it is a control. The verb is the
  // renderer's and the noun after it is the label the producer already gave
  // that node, read back out of the interaction index -- so the accessible
  // name contains the visible one, which is what a reader speaking the name
  // they can see needs it to do. It is the same construction the written
  // entry's own button uses, deliberately: two routes to one act should not
  // be two different names for it.
  pick: "Focus",
  // The skip link's destination when the map is the presentation on screen.
  // The other face of it is whatever the document shipped, which is the right
  // answer for the full reading and for no scripting at all, and is read off
  // the link rather than restated here.
  skipMap: "Skip to the map",
});

/**
 * @param {string} modelJson the serialized interaction model
 * @returns {string} the diagram's inline script, for the shell's per-kind slot
 */
export function graphBehavior(modelJson) {
  return `
(function () {
  "use strict";

  var model = ${modelJson};

  ${TRAVERSAL_JS}

  ${CAMERA_JS}

  var canvas = document.querySelector("[data-pf-canvas]");
  var svg = canvas ? canvas.querySelector("[data-pf-graph]") : null;
  if (!canvas || !svg) return;

  var status = document.querySelector("[data-pf-status]");

  function all(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  /* Every control is revealed here rather than shipped visible, because a
     control that cannot work should not be offered: with scripting off a
     reader meets no dead buttons and loses nothing they could have read --
     every fact these navigate to is already written out below the canvas. */
  all("[data-pf-controls]").forEach(function (group) { group.hidden = false; });

  /* The ceiling a reader can reach with the controls, and the floor under it.

     The ceiling is not a constant, because the one thing it must never do is
     sit below the scale a focus needs. Reading a node's label at its authored
     size costs "1 / s0" -- around 2.5 on a desktop map cell, and over 4.3 on a
     short laptop one, where the map is painted smaller and the camera has
     further to climb. A fixed 4 is comfortably above the first number and
     silently below the second, which would make the readability guarantee hold
     on the machine it was written on and fail on a smaller screen without
     saying so. Derived from the camera's own comfort ceiling instead, so it is
     always exactly enough: no focus target can exceed PF_COMFORT / s0, and
     neither can a reader pressing the zoom control. */
  var ZOOM_CEILING = 4;
  var ZOOM_STEP = 0.25;

  /* The camera is screen-space state applied as one transform on the SVG, and
     the viewBox is never written again. That is the whole of the change from
     the previous camera, and every property this ticket had to deliver follows
     from it.

     A drag can be the pointer's own delta, in client pixels, added straight to
     the offset -- no conversion into user units and back, so nothing is
     quantised and nothing drifts. A previous implementation converted every
     pointer step through getScreenCTM(), rounded the result into the integer
     viewBox, clamped it, and then re-read the grabbed point from the clamped
     value; each of those three steps discards a fraction of the movement, and
     together they are why dragging crept and fought the zoom.

     Scale is a float the stylesheet can transition, so a camera move is
     animatable and interruptible rather than a sequence of rewritten
     attributes. And with transform-origin at 0 0 the arithmetic is the
     simplest form there is: a point p inside the element lands at x + p*scale
     on screen, which makes the clamp below two comparisons.

     Nothing here measures the picture. The camera reads the element's own box
     -- where the browser is painting right now, a fact about the reader's
     window -- and never a node, a label or a rendered glyph. */
  var view = { scale: 1, x: 0, y: 0 };
  var state = { focus: null, trace: null, path: null };

  /* How many of the focused component's direct neighbours the camera could not
     get into the frame. Camera state, not selection state: the same selection
     leaves a different number outside a wide window and a narrow one, and the
     status line says so rather than letting a reader conclude the relationship
     is not there. */
  var offFrame = 0;

  var nodeGroups = all("[data-pf-node]");
  var edgeGroups = all("[data-pf-edge]");
  var entries = all("[data-pf-entry]");

  /* ---- the map is the application, so the components on it are the controls

     Enhanced, the written reading is closed, and with it went the per-entry
     focus buttons that used to be the only keyboard route into selection.
     Reopening the reading to get them back would have made the keyboard
     reader's explorer a different artifact from everyone else's -- the
     fallback document, reached by a control nobody else has to press. So the
     drawn component becomes the control instead: one visible thing that the
     pointer presses and the keyboard focuses, carrying one selection
     behaviour, named once.

     Promoted here rather than emitted as markup, on exactly the terms every
     other control in this artifact is. tabindex in the delivered bytes would
     put twenty tab stops in a document where nothing can answer a press, and
     a button role on a shape that does nothing is a promise the no-scripting
     artifact cannot keep. With no scripting the picture stays a picture, the
     reading is already open beneath it, and its focus buttons are the route --
     which is what they are for.

     The SVG sheds an img role at the same moment and for the same reason.
     img prunes everything inside it from the accessibility tree, which is
     the correct description of a picture and a fatal one for a picture with
     twenty buttons in it: the nodes would take focus and announce nothing.
     group keeps the title the shell drew and lets what is inside be reached.
     Nothing about the picture's own words changes -- no text is written, moved
     or restated; one attribute that says "there is nothing in here" stops
     being true and is corrected.

     The accessible name is the producer's own label out of the interaction
     index, behind the renderer's verb. Nothing is invented, nothing is
     duplicated, and no evidence reaches it. */
  svg.setAttribute("role", "group");
  for (var promoted = 0; promoted < nodeGroups.length; promoted += 1) {
    var drawnNode = nodeGroups[promoted];
    var drawnId = drawnNode.getAttribute("data-pf-node");
    /* A drawn node the model does not carry cannot be selected and cannot be
       named, so it is not offered as a control. Unreachable from this
       renderer -- the picture and the index are built from one node list --
       and asserted rather than assumed, because a focusable thing that does
       nothing when pressed is the defect this repair exists to remove. */
    if (!model.labels[drawnId]) continue;
    drawnNode.setAttribute("tabindex", "0");
    drawnNode.setAttribute("role", "button");
    drawnNode.setAttribute("aria-label",
      ${JSON.stringify(UI.pick)} + " " + model.labels[drawnId]);
  }

  /* ---- the camera ---- */

  function frame() {
    return { w: svg.clientWidth || 1, h: svg.clientHeight || 1 };
  }

  /* The canvas the build-time layout wrote, read back off the viewBox. This is
     the deterministic integer geometry -- the same numbers layout.mjs
     computed and draw.mjs emitted -- and not a measurement of anything. */
  function canvasBox() {
    var viewBox = (svg.getAttribute("viewBox") || "").split(/[\\s,]+/);
    return { w: Number(viewBox[2]) || 0, h: Number(viewBox[3]) || 0 };
  }

  /* The scale the browser is already painting the map at, before the camera
     applies anything: one uniform factor, because the viewBox is fitted with
     the default preserveAspectRatio. */
  function baseScale() {
    var box = frame();
    var art = canvasBox();
    if (!art.w || !art.h) return 0;
    return Math.min(box.w / art.w, box.h / art.h);
  }

  function maxZoom() {
    var s0 = baseScale();
    if (!(s0 > 0)) return ZOOM_CEILING;
    return Math.max(ZOOM_CEILING, PF_COMFORT / s0);
  }

  /* Every drawn node's box, in user units, taken from the integer attributes
     the layout wrote. Cached because they are build-time output and cannot
     change: a second read would be a second chance to get the same answer.

     "rect" rather than a class selector, for the reason every hook in this
     artifact is a data attribute: a stylesheet may rename ".pf-node-box", and
     the camera would then aim at nothing. The first rect inside a node group
     is its box, which is how draw.mjs writes it. */
  var boxCache = null;
  function nodeBoxes() {
    if (boxCache) return boxCache;
    boxCache = Object.create(null);
    for (var i = 0; i < nodeGroups.length; i += 1) {
      var group = nodeGroups[i];
      var rect = group.querySelector("rect");
      if (!rect) continue;
      boxCache[group.getAttribute("data-pf-node")] = {
        x: Number(rect.getAttribute("x")),
        y: Number(rect.getAttribute("y")),
        w: Number(rect.getAttribute("width")),
        h: Number(rect.getAttribute("height")),
      };
    }
    return boxCache;
  }

  /* The rectangle the explorer's own chrome leaves free, as the panel and the
     toolbar published it. Read rather than recomputed: this is the seam the
     docked surface owns, and a camera that derived its own version of it would
     be free to disagree with the thing actually covering the map.

     The whole frame is the honest fallback for an artifact where nothing has
     published one yet -- a rectangle nobody wrote is not a reason to refuse to
     move the camera. */
  function freeRect() {
    var box = frame();
    var published = (canvas.getAttribute("data-pf-free") || "").split(/[\\s,]+/);
    var free = {
      x: Number(published[0]),
      y: Number(published[1]),
      width: Number(published[2]),
      height: Number(published[3]),
    };
    if (!(free.width > 0) || !(free.height > 0)) {
      return { x: 0, y: 0, width: box.w, height: box.h };
    }
    return free;
  }

  /* Keep the content covering the rectangle the reader can actually see. At
     scale 1, with nothing overlaying the map, both bounds collapse to zero --
     the honest statement that there is nowhere to pan at overview, and the
     same fact the pan gate below reads.

     Against the free rectangle rather than the whole frame, because the
     difference is exactly the travel the focus camera needs. The toolbar is
     pinned to the foot of the map, so a clamp that kept the content covering
     the *frame* would make the lowest reachable position the one that parks
     the bottom row of the graph under the controls -- and no amount of care in
     the camera arithmetic could lift it clear, because the clamp would put it
     straight back. Widening the bound by the obstructed band gives back
     precisely that band and nothing else, and when nothing overlays the map
     the free rectangle *is* the frame and these are the two comparisons they
     have always been. */
  function clamp() {
    var box = frame();
    var free = freeRect();
    view.x = Math.min(free.x,
      Math.max(free.x + free.width - box.w * view.scale, view.x));
    view.y = Math.min(free.y,
      Math.max(free.y + free.height - box.h * view.scale, view.y));
  }

  /* The transform this script last wrote, remembered rather than read back.

     style.transform does not return what was set: the CSSOM reserialises the
     value, so a browser hands back rounded numbers in its own formatting and a
     comparison against the string just written would never match. Keeping the
     value here makes "did the camera actually move" answerable without asking
     the document, and answerable identically in every engine. */
  var written = "";

  function writeTransform(value) {
    written = value;
    svg.style.transform = value;
  }

  function paint() {
    clamp();
    var next =
      "translate(" + view.x + "px, " + view.y + "px) scale(" + view.scale + ")";

    /* A move that does not change the transform starts no transition, so no
       transitionend can arrive to end it -- and the moving state would outlive
       a move that never happened, leaving the next camera write to animate
       when it should track. Ending it here is the one place that covers every
       way of asking for a move that turns out to be a move to where the camera
       already is: focusing the focused component again, an arrow key against
       the pan limit, or fit while already fitted. */
    if (next === written) canvas.removeAttribute("data-pf-camera");
    writeTransform(next);

    canvas.setAttribute("data-pf-zoom", view.scale <= 1 ? "fit" : "in");
    canvas.setAttribute("data-pf-pannable", view.scale > 1 ? "true" : "false");
    limits();
  }

  /* Zoom about the middle of the frame. Neither a button nor a key names a
     point to zoom toward, and this Feature no longer carries a gesture that
     does -- wheel and pinch zoom were removed rather than repaired, because
     the reference viewer installs no wheel handler at all and still reads as
     an explorer, and because a wheel handler on a page that also scrolls gives
     one physical gesture two meanings. */
  function zoomTo(next) {
    takeOver();
    next = Math.round(Math.min(Math.max(next, 1), maxZoom()) * 100) / 100;
    if (next === view.scale) return;
    var box = frame();
    var cx = box.w / 2;
    var cy = box.h / 2;
    var atX = (cx - view.x) / view.scale;
    var atY = (cy - view.y) / view.scale;
    glide(function () {
      view.scale = next;
      view.x = cx - atX * next;
      view.y = cy - atY * next;
      paint();
    });
  }

  function zoomBy(step) { zoomTo(view.scale + step); }

  function fit() {
    takeOver();
    /* Animated like any other camera change: fit is a move back to the whole
       map, and a reader who watched the camera travel in should be able to
       watch it travel out. */
    beginMove();
    view.scale = 1;
    view.x = 0;
    view.y = 0;
    paint();
    settleMove();
  }

  /* Screen pixels in, screen pixels out.

     No sampling of its own. During a drag the pointerdown has already taken
     the camera over, and every other caller goes through glide, which does it
     once before the movement starts -- doing it here as well would cancel the
     animation glide had just turned on, one line after turning it on. */
  function panBy(dx, dy) {
    view.x += dx;
    view.y += dy;
    paint();
  }

  /* ---- an automatic move is a transaction the reader can end ----

     The move itself is a CSS transition on the one transform the camera
     writes, which is why it can be interrupted at all: the browser is
     interpolating a value this code can read back at any instant. The
     attribute is what turns that transition on, so a drag -- which must be the
     pointer's own pixel delta and nothing else -- never runs through an easing
     curve, and the 1:1 pan this Feature requires stays 1:1.

     takeOver is the whole of the interruption contract. It samples the
     transform the reader can currently see, adopts it as camera state, and
     pins it there before the gesture applies. Without the sample the camera
     would carry on to a target the reader has already overruled, or jump back
     to where the move began; with it, a drag continues from exactly where the
     movement had visibly reached. Every reader-initiated camera change goes
     through it -- drag, zoom control, keyboard, fit -- so there is one place
     that decides what interrupting means. */
  function reducedMotion() {
    return Boolean(window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* Honoured here rather than only in the stylesheet. The theme's reduce block
     collapses every transition, so motion would already be gone -- but a
     camera whose animation is removed underneath it while it still believes it
     is animating is a camera that cannot report when a move has finished. The
     script asks the question directly, and a reader who prefers no motion gets
     a camera that applies immediately and reaches every state the animated one
     reaches. Asked on each move rather than cached: the preference can change
     while the page is open, and a cached answer would strand the reader on
     whichever setting happened to be true at load. */
  function beginMove() {
    if (reducedMotion()) return false;
    canvas.setAttribute("data-pf-camera", "move");
    return true;
  }

  function settleMove() {
    if (reducedMotion()) canvas.removeAttribute("data-pf-camera");
  }

  /* A camera change the reader asked for in one step: a zoom control, an arrow
     key, the nudge that brings a tabbed-to component into view. Each is a jump
     between two positions of a fixed map, which is exactly what this Feature
     says motion is for, so each gets the same movement an automatic focus
     gets.

     Dragging is the one camera change that does not go through here, and
     deliberately. A drag is already continuous -- it is the pointer's own
     travel -- so easing it would only put the map behind the hand moving it. */
  function glide(change) {
    takeOver();
    beginMove();
    change();
    settleMove();
  }

  /** The transform as the browser is painting it this instant, mid-move. */
  function paintedTransform() {
    if (!window.getComputedStyle) return null;
    var value = window.getComputedStyle(svg).transform;
    if (!value || value === "none" || value.indexOf("(") < 0) return null;
    var parts = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")"))
      .split(",");
    /* A 2D matrix carries the scale first and the translation last; a 3D one
       spells the same three numbers out at 0, 12 and 13. Both are answers a
       browser legitimately gives for this property. */
    var scale, x, y;
    if (parts.length === 16) {
      scale = Number(parts[0]); x = Number(parts[12]); y = Number(parts[13]);
    } else if (parts.length === 6) {
      scale = Number(parts[0]); x = Number(parts[4]); y = Number(parts[5]);
    } else {
      return null;
    }
    if (!(scale > 0)) return null;
    return { scale: scale, x: x, y: y };
  }

  function takeOver() {
    if (!canvas.hasAttribute("data-pf-camera")) return;
    var current = paintedTransform();
    canvas.removeAttribute("data-pf-camera");
    if (!current) return;
    view.scale = current.scale;
    view.x = current.x;
    view.y = current.y;
    /* Pinned where the eye last saw it, before the gesture moves it on. The
       attribute is already off, so this write does not animate -- which is
       what stops the camera drifting on to the abandoned target between this
       instant and the reader's next pixel of movement. */
    writeTransform(
      "translate(" + view.x + "px, " + view.y + "px) scale(" + view.scale + ")");
  }

  /* The move is over when the transform stops interpolating. Read from the
     event rather than timed against the stylesheet's duration, so the two can
     never disagree about when the camera arrived. */
  svg.addEventListener("transitionend", function (event) {
    if (event.propertyName && event.propertyName !== "transform") return;
    canvas.removeAttribute("data-pf-camera");
  });

  /* ---- the selection: focus, traversal, path ---- */

  function endpointsOf(edgeId) {
    return model.edges[edgeId] || null;
  }

  function selection() {
    var nodes = Object.create(null);
    var near = Object.create(null);
    var edges = Object.create(null);
    var mode = "";

    if (state.path && model.paths[state.path]) {
      /* Exactly the edges the producer authored, addressed by id. Two edges
         joining one pair are two different claims, and only the one named by
         the path is lit. */
      mode = "path";
      var walked = model.paths[state.path];
      for (var i = 0; i < walked.length; i += 1) {
        edges[walked[i]] = true;
        var ends = endpointsOf(walked[i]);
        if (ends) { near[ends[0]] = true; near[ends[1]] = true; }
      }
    } else if (state.focus && state.trace) {
      mode = "trace";
      var reached = pfTraverse(model, state.focus, state.trace);
      for (var n = 0; n < reached.nodes.length; n += 1) nodes[reached.nodes[n]] = true;
      for (var e = 0; e < reached.edges.length; e += 1) edges[reached.edges[e]] = true;
    } else if (state.focus) {
      mode = "focus";
      nodes[state.focus] = true;
      var sides = [model.out[state.focus] || [], model["in"][state.focus] || []];
      for (var s = 0; s < sides.length; s += 1) {
        for (var k = 0; k < sides[s].length; k += 1) {
          edges[sides[s][k][0]] = true;
          near[sides[s][k][1]] = true;
        }
      }
    }

    return { mode: mode, nodes: nodes, near: near, edges: edges };
  }

  function describe(picked) {
    if (picked.mode === "path") {
      return "Path: " + count(model.paths[state.path].length, "relationship") + ", exactly as authored.";
    }
    if (picked.mode === "trace") {
      var word = state.trace === "in" ? "Upstream of " : "Downstream of ";
      return word + label(state.focus) + ": " +
        count(countOf(picked.nodes) - 1, "component") + " reached, " +
        count(countOf(picked.edges), "relationship") + " crossed.";
    }
    if (picked.mode === "focus") {
      /* Structure, and then what is off the edge of it. The second sentence is
         the affordance this Feature owes a reader whose neighbourhood does not
         fit: a focus that framed four of a component's nine relationships and
         said nothing would be quietly claiming the other five do not exist.
         Still a statement about the map and never about trust -- it counts
         what the frame left out, and says nothing about how well anything in
         it is supported. */
      return "Focused: " + label(state.focus) + ". " +
        count(countOf(picked.edges), "direct relationship") + "." +
        (offFrame > 0
          ? " " + count(offFrame, "related component") + " outside the frame."
          : "");
    }
    return ${JSON.stringify(UI.nothing)};
  }

  function label(id) {
    return model.labels[id] || id;
  }

  function count(n, noun) {
    return n + " " + noun + (n === 1 ? "" : "s");
  }

  function countOf(set) {
    return Object.keys(set).length;
  }

  function mark(elements, attribute, picked) {
    for (var i = 0; i < elements.length; i += 1) {
      var element = elements[i];
      var id = element.getAttribute(attribute);
      if (picked.mode === "") {
        element.removeAttribute("data-pf-state");
        continue;
      }
      var value = picked.nodes[id] ? "on"
        : picked.edges[id] ? "on"
        : picked.near[id] ? "near"
        : "off";
      element.setAttribute("data-pf-state", value);
    }
  }

  function apply() {
    var picked = selection();

    canvas.setAttribute("data-pf-mode", picked.mode);
    mark(nodeGroups, "data-pf-node", picked);
    mark(edgeGroups, "data-pf-edge", picked);

    /* The drawn node the reader chose says so, in the same word the written
       entry uses. Dimming is a visual signal and aria-current is the one a
       reader who is not looking at the picture gets; without it a screen
       reader moving back over the map would find twenty buttons and no way to
       tell which one is the current selection. */
    for (var drawn = 0; drawn < nodeGroups.length; drawn += 1) {
      if (nodeGroups[drawn].getAttribute("data-pf-node") === state.focus) {
        nodeGroups[drawn].setAttribute("aria-current", "true");
      } else {
        nodeGroups[drawn].removeAttribute("aria-current");
      }
    }

    /* The written reading is where the details and the evidence live. Marking
       the selected entry current is the whole of the details interaction: the
       reader is sent to the evidence already in the document rather than
       shown a second copy of it. */
    for (var i = 0; i < entries.length; i += 1) {
      var entry = entries[i];
      var kind = entry.getAttribute("data-pf-entry");
      var forId = entry.getAttribute("data-pf-for");
      var isCurrent = (kind === "node" && forId === state.focus)
        || (kind === "path" && forId === state.path)
        /* An edge row is current when the highlighted path walks it, which is
           what makes "highlight this path" and "read its evidence" one act
           rather than two. Keyed off the picked edge set, so it is exactly the
           authored edges and never a similar-looking one. */
        || (kind === "edge" && picked.mode === "path" && Boolean(picked.edges[forId]));
      if (isCurrent) {
        entry.setAttribute("aria-current", "true");
      } else {
        entry.removeAttribute("aria-current");
      }
    }

    if (status) status.textContent = describe(picked);

    act("upstream", !state.focus);
    act("downstream", !state.focus);
    act("details", !state.focus);
    act("clear", picked.mode === "");

    /* The panel follows the selection rather than being driven beside it, so
       there is one place selection is decided and the docked surface cannot
       disagree with the map about what is selected. */
    showPanel();
  }

  /* A control at its limit is disabled rather than left to do nothing when
     pressed. Fit is the floor deliberately: zooming out past the whole graph
     would only add empty space, and "fit" is then always the way back. */
  function limits() {
    act("zoom-out", view.scale <= 1);
    act("zoom-in", view.scale >= maxZoom());
    act("fit", view.scale === 1 && view.x === 0 && view.y === 0);

    /* The camera says where it is, on the control that takes you back. A
       reader who can see "140%" knows both that the map moved and what the
       control will undo, which is the cheapest orientation signal there is. */
    var readout = document.querySelector("[data-pf-scale]");
    if (readout) readout.textContent = Math.round(view.scale * 100) + "%";
  }

  /* Every control carrying the action, not the first one found. Two surfaces
     now offer "open full details" and "clear" -- the toolbar and the docked
     panel -- and a disable that reached only one of them would leave the other
     pressable and doing nothing, which is the exact defect the disabling
     exists to prevent. */
  function act(name, isDisabled) {
    var buttons = all('[data-pf-act="' + name + '"]');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].disabled = Boolean(isDisabled);
    }
  }

  /* ---- the docked detail surface ----

     The panel shows a component's own card. Not a rendering of it, not a
     summary of it, not a template filled from the index: the element the
     renderer wrote, moved.

     That distinction is the whole design. interaction.mjs carries labels and
     adjacency and deliberately carries no summary, detail or citation, so
     there is nothing here to render a component *from* even if this code
     wanted to. What there is instead is a card already in the document, with
     the producer's words and the producer's evidence in the presentation the
     lesson renderer established, and moving it costs nothing and can restate
     nothing. A reader using a screen reader meets that citation once, because
     there is one of it.

     A move has to be undoable, so each moved element records where it came
     from -- its parent and the sibling it sat before -- and undocking replays
     those in reverse. Reverse matters: two rows removed from one list store
     each other as neighbours, and putting the later one back first is what
     makes every stored sibling still present when it is needed. */
  var panel = document.querySelector("[data-pf-panel]");
  var panelSlot = document.querySelector("[data-pf-panel-slot]");
  var panelEdges = document.querySelector("[data-pf-panel-edges]");
  var panelRelations = document.querySelector("[data-pf-panel-relations]");
  var docked = [];

  function dock(element, into) {
    if (!element || !into || element.parentNode === into) return;
    docked.push({
      element: element,
      parent: element.parentNode,
      next: element.nextSibling,
    });
    into.appendChild(element);
  }

  function undock() {
    for (var i = docked.length - 1; i >= 0; i -= 1) {
      var moved = docked[i];
      if (!moved.parent) continue;
      moved.parent.insertBefore(moved.element, moved.next);
    }
    docked = [];
  }

  /* Open with the selected component's card, or closed with nothing in it.
     There is no third state: the panel is either showing one component or it
     is not there, and "there but empty" is a frame a reader has to wonder
     about. */
  function showPanel() {
    if (!panel) return;
    undock();

    var id = state.focus;
    if (!id || readingOpen) {
      panel.hidden = true;
      if (panelRelations) panelRelations.hidden = true;
      publishFreeRect();
      return;
    }

    var card = document.querySelector(
      '[data-pf-entry="node"][data-pf-for="' + id + '"]');
    if (card) dock(card, panelSlot);

    /* What runs in and what runs out, as the rows the document already has.
       Outgoing first, then incoming: the order the written reading uses, kept
       so a reader who has read one meets the other in the same shape. */
    var rows = 0;
    if (panelEdges) {
      var sides = [model.out[id] || [], model["in"][id] || []];
      for (var s = 0; s < sides.length; s += 1) {
        for (var k = 0; k < sides[s].length; k += 1) {
          var row = document.querySelector(
            '[data-pf-entry="edge"][data-pf-for="' + sides[s][k][0] + '"]');
          if (row) { dock(row, panelEdges); rows += 1; }
        }
      }
    }
    if (panelRelations) panelRelations.hidden = rows === 0;

    panel.hidden = false;
    publishFreeRect();
  }

  /* ---- the rectangle 52.2 frames into ----

     The panel is a grid sibling of the canvas rather than a layer over it, so
     opening it genuinely takes width away from the map instead of covering
     part of one. That is what makes this contract cheap: the canvas's own box
     is already the panel's subtraction, measured by the browser rather than
     predicted here.

     What is left to subtract is the chrome that really does float over the
     map -- the toolbar in its corner. A camera that framed a node into the
     full canvas box could still park it under those controls, which is the
     same defect as parking it under the panel and is worth no less care.

     Published on the canvas as x y width height in canvas-local CSS pixels,
     so it is inspectable from outside and provable against what the browser
     actually painted. 52.2 reads this rectangle and frames into it; this
     ticket writes it and moves no camera. */
  function publishFreeRect() {
    if (!canvas.getBoundingClientRect) return;
    var box = canvas.getBoundingClientRect();
    var free = { x: 0, y: 0, width: box.width, height: box.height };

    var chrome = document.querySelector("[data-pf-chrome]");
    if (chrome && !chrome.hidden && chrome.getBoundingClientRect) {
      var bar = chrome.getBoundingClientRect();
      if (bar.width && bar.height) {
        /* The toolbar is pinned to the map's bottom edge, so the band it
           occupies is a band across the bottom and the map above it is what
           is free. Stated as the one rule rather than guessed at per shape:
           an earlier version only subtracted when the bar took less than half
           the height, which meant the narrow layout -- where the controls wrap
           to three rows and take nearly half the map -- reported the whole
           canvas as free, and that is precisely where a camera would park a
           node under them. A small honest rectangle beats a large wrong one. */
        /* Clamped to the box as well as to zero, because the toolbar is a
           grid sibling below the map rather than an overlay on it: its top
           is then past the canvas's bottom and the subtraction would report
           a rectangle taller than the thing it describes. Bounded both ways,
           the one rule covers both arrangements -- it subtracts a real
           overlap and subtracts nothing when the chrome takes its own space,
           which is what the contract has always meant. */
        free.height = Math.min(box.height, Math.max(0, bar.top - box.top));
      }
    }

    canvas.setAttribute("data-pf-free",
      Math.round(free.x) + " " + Math.round(free.y) + " " +
      Math.round(free.width) + " " + Math.round(free.height));
    return free;
  }

  function focusNode(id, options) {
    if (!model.labels[id]) return;
    state.focus = id;
    state.trace = null;
    state.path = null;
    offFrame = 0;
    apply();
    aimCamera(id);
    if (options && options.reveal) reveal(id);
  }

  /* ---- the semantic camera ----

     Selection decides what is related; this decides where to stand to look at
     it. Keeping them apart is why the neighbourhood below is read straight out
     of selection() rather than gathered again from the adjacency index: the
     focus mode already computes exactly the set the dimming uses, and a camera
     that walked the index a second time would be a second definition of what
     is related to what, free to drift from the first. The camera consumes that
     answer and contributes nothing to it.

     Run after apply(), and that order is load-bearing. apply() docks the
     selected component's card, which is what gives the panel its width, which
     is what makes the free rectangle the panel publishes true. Aiming first
     would frame the node into the rectangle that existed before the panel
     opened, and park it under the panel -- the exact defect the seam exists to
     prevent. */
  function aimCamera(id) {
    var boxes = nodeBoxes();
    if (!boxes[id]) return;

    var picked = selection();
    var near = [];
    for (var other in picked.near) {
      /* A self-edge makes a component its own neighbour. It is already the
         thing being framed, so counting it again would let the camera report
         a component as outside the frame it is in the middle of. */
      if (other !== id && boxes[other]) near.push(other);
    }

    var target = pfCameraTarget({
      canvas: canvasBox(),
      frame: frame(),
      free: freeRect(),
      boxes: boxes,
      focus: id,
      near: near,
    });
    if (!target) return;

    offFrame = target.offFrame.length;

    beginMove();
    view.scale = target.scale;
    view.x = target.x;
    view.y = target.y;
    paint();
    settleMove();

    /* Said once the camera knows what it framed. apply() has already written
       the structural half of this sentence; rewriting it here rather than
       having the camera reach into the selection's wording keeps one function
       composing it. The live region collapses the two writes of one task into
       a single announcement, so a screen reader hears the finished sentence
       rather than both halves of it. */
    if (status) status.textContent = describe(picked);
  }

  function reveal(id) {
    var entry = document.querySelector('[data-pf-entry="node"][data-pf-for="' + id + '"]');
    if (!entry) return;
    var open = entry.closest ? entry.closest("details") : null;
    if (open) open.open = true;
    if (entry.scrollIntoView) entry.scrollIntoView({ block: "nearest" });
  }

  function clear() {
    state.focus = null;
    state.trace = null;
    state.path = null;
    apply();
    if (status) status.textContent = ${JSON.stringify(UI.cleared)};
  }

  /* ---- wiring ---- */

  document.addEventListener("click", function (event) {
    /* The click a finished pan emits. Consumed here rather than suppressed at
       the source, because the pointer gesture cannot cancel it and a reader
       who dragged the map did not ask to select whatever they let go over. */
    if (swallowClick) {
      swallowClick = false;
      return;
    }

    var target = event.target;
    if (!target || !target.closest) return;

    var control = target.closest("[data-pf-act]");
    if (control && !control.disabled) {
      var action = control.getAttribute("data-pf-act");
      if (action === "zoom-in") zoomBy(ZOOM_STEP);
      else if (action === "zoom-out") zoomBy(-ZOOM_STEP);
      else if (action === "fit") fit();
      else if (action === "reset") { fit(); clear(); reading(false); }
      else if (action === "reading") reading(!readingOpen);
      else if (action === "upstream") { state.trace = "in"; state.path = null; apply(); }
      else if (action === "downstream") { state.trace = "out"; state.path = null; apply(); }
      /* The explicit secondary path into the full written reading, and the
         only route that still scrolls anything. A reader pressing a control
         labelled for it has asked to go there; a reader touching the map has
         not. */
      else if (action === "details") { reading(true); reveal(state.focus); }
      else if (action === "clear") clear();
      else if (action === "path") {
        state.path = control.getAttribute("data-pf-path");
        state.focus = null;
        state.trace = null;
        apply();
      }
      return;
    }

    /* A written entry's own button: the keyboard route into focus. */
    var pick = target.closest("[data-pf-pick]");
    if (pick) {
      focusNode(pick.getAttribute("data-pf-pick"), { reveal: false });
      return;
    }

    /* A node in the picture: the pointer route into the same control the
       keyboard focuses. It selects and does nothing else -- no scroll, no
       navigation, no location. Reaching the written reading is the "details"
       control above, deliberately pressed. */
    var drawn = target.closest("[data-pf-node]");
    if (drawn) focusNode(drawn.getAttribute("data-pf-node"), { reveal: false });
  });

  /* ---- pointer gestures: one gesture, one surface ----

     There is exactly one pointer gesture now: drag the background to pan. The
     previous implementation put wheel zoom, pinch zoom, drag pan and click
     focus on the same element at every scale, on a page that also scrolled,
     and left them to sort themselves out. They did not. This resolves the
     arbitration structurally instead, by giving each gesture a surface it does
     not share:

       background  -> pan          (and only where there is somewhere to pan)
       node, edge  -> activate
       controls    -> their own action
       wheel       -> the page's, untouched

     A gesture that begins on a node is never a pan, so dragging across a
     component cannot drag the map out from under the click. A drag that has
     actually moved swallows the click it would otherwise emit, so releasing a
     pan over a component does not select it. And at overview the clamp leaves
     nothing to pan to, so the gate is closed there rather than letting a drag
     look broken by doing nothing visible. */
  var DRAG_SLOP = 3;
  var readingOpen = false;
  var grab = null;
  var dragging = false;
  var swallowClick = false;

  /* What a pan may start on. Anything the reader can act on owns its own
     gesture; the background is what is left. */
  function panSurface(target) {
    if (!target || !target.closest) return false;
    if (target.closest("[data-pf-node]")) return false;
    if (target.closest("[data-pf-edge]")) return false;
    if (target.closest("[data-pf-act]")) return false;
    if (target.closest("[data-pf-pick]")) return false;
    return Boolean(target.closest("[data-pf-graph]"));
  }

  svg.addEventListener("pointerdown", function (event) {
    swallowClick = false;
    if (event.button !== 0) return;
    /* The instant the reader presses, before anything is decided about what
       the press means. An automatic move that carried on for one more frame
       after the hand landed on it would be the camera arguing with the reader,
       and the pan below needs camera state that matches what is on screen
       rather than where the move was headed. */
    takeOver();
    if (view.scale <= 1) return;
    if (!panSurface(event.target)) return;

    grab = { x: event.clientX, y: event.clientY };
    dragging = false;
  });

  svg.addEventListener("pointermove", function (event) {
    if (!grab) return;

    if (!dragging) {
      if (Math.abs(event.clientX - grab.x) < DRAG_SLOP &&
          Math.abs(event.clientY - grab.y) < DRAG_SLOP) return;
      dragging = true;
      canvas.setAttribute("data-pf-dragging", "true");
      /* Captured only once the gesture is certainly a drag. Capturing on
         pointerdown would retarget the compatibility mouse events -- a
         captured pointer sends its click to the capturing element, not to the
         node under it -- and take the pointer route into selection away
         entirely. */
      if (svg.setPointerCapture) {
        try { svg.setPointerCapture(event.pointerId); } catch (ignored) { /* gone */ }
      }
    }

    /* The delta the pointer actually travelled, straight into the camera. */
    panBy(event.clientX - grab.x, event.clientY - grab.y);
    grab = { x: event.clientX, y: event.clientY };
  });

  function endPointer() {
    if (dragging) swallowClick = true;
    grab = null;
    dragging = false;
    canvas.removeAttribute("data-pf-dragging");
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);

  /* Enter and Space on a drawn component, which is what a button role
     promises and what a keyboard reader will press. Delegated on the SVG so
     one listener covers every node, and taken before the canvas's own key
     handler below sees it -- that one owns the arrows, plus, minus and zero,
     and deliberately still does while focus is on a node, so panning and
     zooming stay available from wherever the reader happens to be.

     Space is prevented for the reason every scripted button prevents it: left
     alone it scrolls. Enter is prevented so that a node inside a page that
     also has links cannot become a navigation. Neither writes a location,
     scrolls a section into view, or opens the reading -- keyboard activation
     reaches exactly the state a click reaches, which is the point. */
  svg.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    var target = event.target;
    if (!target || !target.closest) return;
    var drawn = target.closest("[data-pf-node]");
    if (!drawn) return;
    event.preventDefault();
    focusNode(drawn.getAttribute("data-pf-node"), { reveal: false });
  });

  /* Focus has to land somewhere the reader can see.

     Two things would otherwise move the map out from under a tab stop. The
     browser scrolls a focused element into view, and the stage clips rather
     than scrolls, so that scroll is invisible movement the camera does not
     know about -- it is undone here rather than prevented, because a Tab is
     not a programmatic focus and there is no flag to pass it. And at any zoom
     above the overview a node can simply be outside the frame, focused,
     ringed, and off screen -- a focus indicator nobody can see is not one.

     So the camera moves instead, by the smallest amount that brings the
     focused node inside the frame, which is the same service the browser's
     scroll performs on a page that scrolls. At the overview every node is in
     frame already and this does nothing at all.

     It reads one painted box: where the browser is drawing the thing that just
     took focus. That is the same kind of measurement the camera already makes
     of its own frame, and it is a camera decision end to end. No box is ever
     compared with another to decide what is upstream, downstream, adjacent or
     grouped -- those come from the index and only from the index. */
  var FOCUS_MARGIN = 16;

  function numeric(box) {
    return box && typeof box.left === "number" && typeof box.right === "number"
      && typeof box.top === "number" && typeof box.bottom === "number";
  }

  /** How far to move one axis so [near, far] sits inside [low, high]. */
  function nudge(near, far, low, high) {
    if (near < low) return Math.min(low - near, high - far);
    if (far > high) return Math.max(high - far, low - near);
    return 0;
  }

  canvas.addEventListener("focusin", function (event) {
    canvas.scrollLeft = 0;
    canvas.scrollTop = 0;

    /* Tab is a reader gesture like any other, and this handler is about to
       read painted boxes. Sampling first is what keeps the measurement and the
       camera state describing the same instant: mid-move they would otherwise
       be one frame apart, and the nudge would correct for a position the
       camera had already left. */
    takeOver();

    var target = event && event.target;
    if (!target || !target.closest || !target.getBoundingClientRect) return;
    var drawn = target.closest("[data-pf-node]");
    if (!drawn || !drawn.getBoundingClientRect) return;

    var node = drawn.getBoundingClientRect();
    var frameBox = canvas.getBoundingClientRect();
    if (!numeric(node) || !numeric(frameBox)) return;

    var dx = nudge(node.left, node.right,
      frameBox.left + FOCUS_MARGIN, frameBox.right - FOCUS_MARGIN);
    var dy = nudge(node.top, node.bottom,
      frameBox.top + FOCUS_MARGIN, frameBox.bottom - FOCUS_MARGIN);
    if (dx || dy) glide(function () { panBy(dx, dy); });
  });

  canvas.addEventListener("keydown", function (event) {
    /* A step in screen pixels, like the drag it stands in for. */
    var step = Math.max(24, Math.round(frame().w / 8));
    var moved = true;
    if (event.key === "ArrowLeft") glide(function () { panBy(step, 0); });
    else if (event.key === "ArrowRight") glide(function () { panBy(-step, 0); });
    else if (event.key === "ArrowUp") glide(function () { panBy(0, step); });
    else if (event.key === "ArrowDown") glide(function () { panBy(0, -step); });
    else if (event.key === "+" || event.key === "=") zoomBy(ZOOM_STEP);
    else if (event.key === "-") zoomBy(-ZOOM_STEP);
    else if (event.key === "0") fit();
    else moved = false;
    if (moved) event.preventDefault();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") clear();
  });

  /* ---- the written reading ----

     Enhanced, the explorer is the application and the written reading is not a
     scrolling companion beneath it: the reader came to a map, and a map with
     thirteen thousand pixels of article under it is a document. It is closed
     here rather than removed, so every fact stays in the delivered document
     and one control reopens it.

     With no scripting this never runs. The attribute is never set, the CSS
     that depends on it never applies, and the artifact is the complete
     readable document it has always been -- which is the whole of what the
     no-scripting mode owes. It does not owe an explorer. */
  function reading(open) {
    readingOpen = Boolean(open);
    document.body.setAttribute("data-pf-reading", readingOpen ? "open" : "closed");
    /* The full reading is the complete document, so everything the panel
       borrowed goes back before it is shown -- a Relationships list missing
       the rows of whatever happened to be selected is not the complete
       document, it is a document with a hole in it. Closing the reading
       re-docks the current selection, so the two presentations agree without
       either one keeping a copy. */
    showPanel();
    var control = document.querySelector('[data-pf-act="reading"]');
    if (control) {
      control.setAttribute("aria-expanded", readingOpen ? "true" : "false");
      control.textContent = readingOpen
        ? ${JSON.stringify(UI.readingClose)}
        : ${JSON.stringify(UI.readingOpen)};
    }
    aimSkip();
  }

  /* The page's first tab stop, aimed at the reading that is actually on
     screen. One link, re-aimed -- not a second link, and not a link that is
     right in one state and points into a hidden subtree in the other.

     The shipped href and the shipped words are the fallback, and they are
     already correct: with no scripting the whole reading is on the page and
     #pf-content is where a reader wants to land. They are read off the link
     rather than restated here, so the no-scripting wording and the
     reading-open wording cannot drift apart. Closed, the reading is
     display:none and the map is the content, so the link says so and goes
     there. */
  var skip = document.querySelector("[data-pf-skip]");
  var skipFallback = skip
    ? { href: skip.getAttribute("href"), text: skip.textContent }
    : null;

  function aimSkip() {
    if (!skip || !skipFallback) return;
    /* The fallback is also what an explorer with no id on its map gets: a
       link that lands in the document it shipped beats one aimed at a
       fragment that does not resolve. Unreachable from this renderer, which
       always writes the id, and cheap enough to be certain of. */
    if (readingOpen || !canvas.id) {
      skip.setAttribute("href", skipFallback.href);
      skip.textContent = skipFallback.text;
      return;
    }
    skip.setAttribute("href", "#" + canvas.id);
    skip.textContent = ${JSON.stringify(UI.skipMap)};
  }

  /* The camera's frame changes with the window, and a clamp computed against
     the old one would leave the content parked off-centre. */
  window.addEventListener("resize", function () {
    paint();
    /* The free rectangle is a fact about the reader's window, so it is stale
       the moment the window changes. Republished here rather than recomputed
       on demand, so 52.2's camera reads a value that is already right. */
    publishFreeRect();
  });

  reading(false);
  paint();
  apply();
})();
`.trim();
}
