/**
 * The diagram's inline behaviour: focus, traversal, path highlight, zoom, pan.
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
 * `data-pf-mode`, `aria-current`, `disabled` — and the stylesheet decides what
 * those look like. It writes one `viewBox` for zoom and pan. It never creates a
 * node, never writes text into the document, and never restates a summary or a
 * citation. That last part is load-bearing for the provenance contract: an
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
 * **Activating a node does not navigate.** It selects, and nothing else moves:
 * no scroll position changes, no document section is scrolled into view, and
 * no location is written. The full written reading stays available behind an
 * explicit control, which is a reader asking for it rather than a side effect
 * of touching the map.
 */

import { TRAVERSAL_JS } from "./interaction.mjs";

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

  var canvas = document.querySelector("[data-pf-canvas]");
  var svg = canvas ? canvas.querySelector("[data-pf-graph]") : null;
  if (!canvas || !svg) return;

  var status = document.querySelector("[data-pf-status]");

  function all(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  /* The canvas is a picture to assistive technology, so the interactive
     surface is the toolbar and the written reading below it — real buttons,
     in document order, carrying the stylesheet's existing focus ring. Every
     one of them is revealed here rather than shipped visible, because a
     control that cannot work should not be offered: with scripting off a
     reader meets no dead buttons and loses nothing they could have read. */
  all("[data-pf-controls]").forEach(function (group) { group.hidden = false; });

  var MAX_ZOOM = 4;
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

  var nodeGroups = all("[data-pf-node]");
  var edgeGroups = all("[data-pf-edge]");
  var entries = all("[data-pf-entry]");

  /* ---- the camera ---- */

  function frame() {
    return { w: svg.clientWidth || 1, h: svg.clientHeight || 1 };
  }

  /* Keep the content covering the frame. At scale 1 both bounds collapse to
     zero, which is the honest statement that there is nowhere to pan at
     overview -- the same fact the pan gate below reads. */
  function clamp() {
    var box = frame();
    view.x = Math.min(0, Math.max(box.w - box.w * view.scale, view.x));
    view.y = Math.min(0, Math.max(box.h - box.h * view.scale, view.y));
  }

  function paint() {
    clamp();
    svg.style.transform =
      "translate(" + view.x + "px, " + view.y + "px) scale(" + view.scale + ")";
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
    next = Math.round(Math.min(Math.max(next, 1), MAX_ZOOM) * 100) / 100;
    if (next === view.scale) return;
    var box = frame();
    var cx = box.w / 2;
    var cy = box.h / 2;
    var atX = (cx - view.x) / view.scale;
    var atY = (cy - view.y) / view.scale;
    view.scale = next;
    view.x = cx - atX * next;
    view.y = cy - atY * next;
    paint();
  }

  function zoomBy(step) { zoomTo(view.scale + step); }

  function fit() {
    view.scale = 1;
    view.x = 0;
    view.y = 0;
    paint();
  }

  /* Screen pixels in, screen pixels out. */
  function panBy(dx, dy) {
    view.x += dx;
    view.y += dy;
    paint();
  }

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
      return "Focused: " + label(state.focus) + ". " +
        count(countOf(picked.edges), "direct relationship") + ".";
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
  }

  /* A control at its limit is disabled rather than left to do nothing when
     pressed. Fit is the floor deliberately: zooming out past the whole graph
     would only add empty space, and "fit" is then always the way back. */
  function limits() {
    act("zoom-out", view.scale <= 1);
    act("zoom-in", view.scale >= MAX_ZOOM);
    act("fit", view.scale === 1 && view.x === 0 && view.y === 0);

    /* The camera says where it is, on the control that takes you back. A
       reader who can see "140%" knows both that the map moved and what the
       control will undo, which is the cheapest orientation signal there is. */
    var readout = document.querySelector("[data-pf-scale]");
    if (readout) readout.textContent = Math.round(view.scale * 100) + "%";
  }

  function act(name, isDisabled) {
    var button = document.querySelector('[data-pf-act="' + name + '"]');
    if (button) button.disabled = Boolean(isDisabled);
  }

  function focusNode(id, options) {
    if (!model.labels[id]) return;
    state.focus = id;
    state.trace = null;
    state.path = null;
    apply();
    if (options && options.reveal) reveal(id);
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

    /* A node in the picture: the pointer route. It selects and does nothing
       else -- no scroll, no navigation, no location. Reaching the written
       reading is the "details" control above, deliberately pressed. Keyboard
       readers reach this same state through the entry buttons, which is why
       nothing in the canvas is a tab stop. */
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

  canvas.addEventListener("keydown", function (event) {
    /* A step in screen pixels, like the drag it stands in for. */
    var step = Math.max(24, Math.round(frame().w / 8));
    var moved = true;
    if (event.key === "ArrowLeft") panBy(step, 0);
    else if (event.key === "ArrowRight") panBy(-step, 0);
    else if (event.key === "ArrowUp") panBy(0, step);
    else if (event.key === "ArrowDown") panBy(0, -step);
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
    var control = document.querySelector('[data-pf-act="reading"]');
    if (control) {
      control.setAttribute("aria-expanded", readingOpen ? "true" : "false");
      control.textContent = readingOpen
        ? ${JSON.stringify(UI.readingClose)}
        : ${JSON.stringify(UI.readingOpen)};
    }
  }

  /* The camera's frame changes with the window, and a clamp computed against
     the old one would leave the content parked off-centre. */
  window.addEventListener("resize", function () { paint(); });

  reading(false);
  paint();
  apply();
})();
`.trim();
}
