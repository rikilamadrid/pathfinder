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
 * Pointer and keyboard panning do read the element's rendered size, because
 * turning a drag in pixels into a movement in user units cannot be done
 * without it. That is a reading of the reader's window at the time they drag;
 * it happens long after the bytes were written and cannot affect them.
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

  var viewBox = svg.getAttribute("viewBox").split(" ");
  var BASE = { w: Number(viewBox[2]), h: Number(viewBox[3]) };
  var MAX_ZOOM = 6;

  var view = { zoom: 1, x: 0, y: 0 };
  var state = { focus: null, trace: null, path: null };

  var nodeGroups = all("[data-pf-node]");
  var edgeGroups = all("[data-pf-edge]");
  var entries = all("[data-pf-entry]");

  /* ---- the view: zoom and pan, clamped to the graph's own bounds ---- */

  function paint() {
    var w = Math.max(1, Math.floor(BASE.w / view.zoom));
    var h = Math.max(1, Math.floor(BASE.h / view.zoom));

    /* Clamped to the content, so panning can never wander off into empty
       space and "fit" is always the way back. */
    view.x = Math.min(Math.max(view.x, 0), Math.max(0, BASE.w - w));
    view.y = Math.min(Math.max(view.y, 0), Math.max(0, BASE.h - h));

    svg.setAttribute("viewBox", view.x + " " + view.y + " " + w + " " + h);
    canvas.setAttribute("data-pf-zoom", view.zoom === 1 ? "fit" : "in");
    limits();
  }

  function zoomBy(factor) {
    var before = { w: BASE.w / view.zoom, h: BASE.h / view.zoom };
    var next = Math.min(Math.max(view.zoom * factor, 1), MAX_ZOOM);
    if (next === view.zoom) return;

    var after = { w: BASE.w / next, h: BASE.h / next };
    /* Keep whatever is in the middle of the view in the middle of it. */
    view.x = view.x + Math.floor((before.w - after.w) / 2);
    view.y = view.y + Math.floor((before.h - after.h) / 2);
    view.zoom = next;
    paint();
  }

  function fit() {
    view.zoom = 1;
    view.x = 0;
    view.y = 0;
    paint();
  }

  function panBy(dx, dy) {
    view.x = view.x + dx;
    view.y = view.y + dy;
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
    act("zoom-out", view.zoom <= 1);
    act("zoom-in", view.zoom >= MAX_ZOOM);
    act("fit", view.zoom === 1 && view.x === 0 && view.y === 0);
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
    var target = event.target;
    if (!target || !target.closest) return;

    var control = target.closest("[data-pf-act]");
    if (control && !control.disabled) {
      var action = control.getAttribute("data-pf-act");
      if (action === "zoom-in") zoomBy(1.5);
      else if (action === "zoom-out") zoomBy(1 / 1.5);
      else if (action === "fit") fit();
      else if (action === "reset") { fit(); clear(); }
      else if (action === "upstream") { state.trace = "in"; state.path = null; apply(); }
      else if (action === "downstream") { state.trace = "out"; state.path = null; apply(); }
      else if (action === "details") reveal(state.focus);
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

    /* A node in the picture: the pointer route. Keyboard readers reach the
       same state through the entry buttons above, which is why nothing in
       the canvas is a tab stop. */
    var drawn = target.closest("[data-pf-node]");
    if (drawn) focusNode(drawn.getAttribute("data-pf-node"), { reveal: true });
  });

  /* Drag to pan. Pixels become user units through the element's rendered
     width, which is a reading of the reader's window and not of anything
     that decided the artifact's bytes. */
  var dragging = null;
  svg.addEventListener("pointerdown", function (event) {
    if (view.zoom === 1) return;
    dragging = { x: event.clientX, y: event.clientY };
    canvas.setAttribute("data-pf-dragging", "true");
    if (svg.setPointerCapture) svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener("pointermove", function (event) {
    if (!dragging) return;
    var rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var scaleX = (BASE.w / view.zoom) / rect.width;
    var scaleY = (BASE.h / view.zoom) / rect.height;
    panBy(
      Math.floor((dragging.x - event.clientX) * scaleX),
      Math.floor((dragging.y - event.clientY) * scaleY));
    dragging = { x: event.clientX, y: event.clientY };
  });
  function endDrag() {
    dragging = null;
    canvas.removeAttribute("data-pf-dragging");
  }
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  /* Keyboard panning, on the canvas itself, which is a tab stop for exactly
     this reason. Escape clears from anywhere. */
  canvas.addEventListener("keydown", function (event) {
    var step = Math.max(16, Math.floor(BASE.w / view.zoom / 8));
    var moved = true;
    if (event.key === "ArrowLeft") panBy(-step, 0);
    else if (event.key === "ArrowRight") panBy(step, 0);
    else if (event.key === "ArrowUp") panBy(0, -step);
    else if (event.key === "ArrowDown") panBy(0, step);
    else if (event.key === "+" || event.key === "=") zoomBy(1.5);
    else if (event.key === "-") zoomBy(1 / 1.5);
    else if (event.key === "0") fit();
    else moved = false;
    if (moved) event.preventDefault();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") clear();
  });

  paint();
  apply();
})();
`.trim();
}
