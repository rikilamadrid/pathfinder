/**
 * Where the camera goes when a reader focuses a component.
 *
 * **Arithmetic, and nothing else.** This module knows about rectangles. It
 * does not know what a node is, what "downstream" means, which elements are
 * related, or how a browser event reaches it — the neighbourhood arrives as a
 * list of ids the caller derived from the adjacency index, and the boxes
 * arrive as the integers `layout.mjs` wrote. Keeping it that way is what makes
 * the focus camera testable without a browser and impossible to turn into a
 * second definition of what is related to what.
 *
 * **It is a string for the same reason the traversal is.** `CAMERA_JS` is
 * emitted into the artifact verbatim and evaluated by the tests verbatim.
 * Writing the camera twice — once for the browser and once for Node — would
 * leave two implementations free to disagree about where a focused node lands,
 * and the one that shipped would be the one nobody had tested. Twenty focuses
 * on the acceptance specimen are checked against this exact text.
 *
 * **Nothing here measures the picture.** Three runtime facts come in: how large
 * the browser is painting the map, the rectangle the explorer's own chrome
 * leaves free, and the canvas dimensions the build-time layout wrote into the
 * `viewBox`. Every position the camera aims at is computed from the integer
 * coordinates already on the drawn elements. No text is measured, no glyph is
 * inspected, and no box is ever compared with another to decide meaning.
 *
 * ## The one thing this camera guarantees
 *
 * The focused node's label renders at no less than its authored size, and the
 * focused node's box lies inside the free rectangle. Framing the whole
 * neighbourhood is explicitly *not* guaranteed, because on a real map it
 * cannot be: measured across the twenty nodes of the acceptance specimen, a
 * node's direct neighbours can span 1984×1476 of a 2148×1612 canvas, which
 * fits only at the unreadable overview scale. Seventeen of those twenty
 * neighbourhoods cannot be framed whole at a readable scale. So the camera
 * takes readability as the floor, frames as much context as that scale admits,
 * and reports what it left outside — rather than quietly zooming back out to
 * the scale this Feature exists to escape.
 *
 * Imports nothing, like everything else on the render path.
 */

/**
 * The readable band, in painted pixels per user unit.
 *
 * `READABLE` is 1 because the layout's user units *are* CSS pixels at the
 * authored size: `draw.mjs` writes a node's box as 208×76 user units and
 * `style.mjs` sets its label at 13px in that same space. Painting one user
 * unit to one pixel is therefore the exact statement "the label renders at no
 * less than its authored size", and it is why this number needs no font
 * measurement to be true.
 *
 * `COMFORT` is the ceiling, and it exists for the small neighbourhoods rather
 * than the large ones. A node with one neighbour would otherwise fit at four
 * or five times authored size, which is not reading a map, it is being thrown
 * at a box. Above this the extra scale buys legibility nobody asked for and
 * costs all the surrounding context.
 */
const BAND = Object.freeze({ READABLE: 1, COMFORT: 1.5 });

/**
 * Two margins, and they answer different questions.
 *
 * `PAD` is breathing room for the *neighbourhood* fit: how much of the free
 * rectangle a whole neighbourhood must leave empty before the camera decides
 * it fits. `EDGE` is the hard margin for the *focused node*: how far its box
 * must stay from the edge of the free rectangle, which is what stops "inside
 * the frame" from meaning "touching the last pixel of it".
 *
 * `EDGE` is deliberately smaller than `layout.mjs`'s own `MARGIN` of 56. The
 * canvas already reserves that much around the outermost node, so a camera
 * margin under it is always satisfiable — which is what makes the containment
 * guarantee reachable for a node at the very edge of the canvas rather than
 * only for the comfortable ones in the middle.
 */
const MARGIN = Object.freeze({ PAD: 32, EDGE: 24 });

/**
 * The camera arithmetic, as the source that ships.
 *
 * `pfCameraTarget` answers one question: given where the map is painted, what
 * the chrome leaves free, and which boxes matter, where should the camera be?
 * It returns camera state and the set it could not fit — never a DOM change,
 * never a side effect, and nothing it read from the document itself.
 *
 * ## The coordinate chain, stated once
 *
 * The SVG carries `viewBox="0 0 W H"` and is painted into its element box with
 * the default `preserveAspectRatio`, so the browser picks one uniform scale
 * `s0 = min(frame.w / W, frame.h / H)` and centres the result, leaving a
 * letterbox band `ox`, `oy` on whichever axis has room to spare. The camera's
 * own transform then applies on top of that, anchored at `0 0`.
 *
 * Composing the two, a user-space point `u` lands at
 *
 *     screen = x + ox * scale + (s0 * scale) * u
 *
 * and `s0 * scale` is the *painted scale* — pixels per user unit, the number
 * the readability guarantee is actually about. Solving for `x` given a
 * required screen position is the whole of what the two axis functions below
 * do. Writing the chain out here is what keeps three different places from
 * each rediscovering the letterbox term and one of them getting it wrong.
 *
 * ## Why the clamp is expressed against the free rectangle
 *
 * The camera must be able to lift a node at the foot of the canvas clear of a
 * toolbar pinned to the foot of the map. A clamp that keeps the content
 * covering the whole *frame* makes that impossible by construction: the
 * lowest the content may travel is exactly the position that parks the last
 * node under the controls. Clamping against the free rectangle instead gives
 * the camera precisely the extra travel the chrome took away, and collapses to
 * the original clamp — the same two comparisons, the same numbers — the moment
 * nothing overlays the map.
 */
export const CAMERA_JS = `
var PF_READABLE = ${BAND.READABLE};
var PF_COMFORT = ${BAND.COMFORT};
var PF_PAD = ${MARGIN.PAD};
var PF_EDGE = ${MARGIN.EDGE};

/* The union of a set of boxes, in user units. Boxes an id has no entry for are
   skipped rather than guessed at: a neighbourhood is built from the adjacency
   index and the picture is built from the same node list, so a missing box is
   unreachable -- and a union that invented one would aim the camera at
   somewhere nothing is drawn. */
function pfUnion(boxes, ids) {
  var x0 = null, y0 = null, x1 = null, y1 = null;
  for (var i = 0; i < ids.length; i += 1) {
    var box = boxes[ids[i]];
    if (!box) continue;
    if (x0 === null || box.x < x0) x0 = box.x;
    if (y0 === null || box.y < y0) y0 = box.y;
    if (x1 === null || box.x + box.w > x1) x1 = box.x + box.w;
    if (y1 === null || box.y + box.h > y1) y1 = box.y + box.h;
  }
  if (x0 === null) return null;
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/* One axis of the camera, in the order the three rules take precedence.

   Aim:     put the aim point at the centre of the free rectangle.
   Contain: then bring the focused node wholly inside that rectangle, which is
            the guarantee and therefore outranks the aim.
   Clamp:   then keep the map covering the free rectangle, which outranks
            both -- a camera that satisfied the guarantee by sliding the map
            off its own edge would be showing empty space to do it.

   The three are applied in that order rather than blended, so which one moved
   the camera is always answerable. Where a node is wider than the space it
   must fit inside, containment is impossible and centring it is the closest
   honest answer; the caller finds out by reading \`inside\` rather than by
   being told a rectangle held when it did not. */
function pfAxis(offset, painted, scale, lo, size, frameSize, aim, nodeLo, nodeHi) {
  var value = lo + size / 2 - offset - painted * aim;

  var low = lo + PF_EDGE - offset - painted * nodeLo;
  var high = lo + size - PF_EDGE - offset - painted * nodeHi;
  if (low > high) {
    value = lo + size / 2 - offset - painted * ((nodeLo + nodeHi) / 2);
  } else {
    value = Math.min(Math.max(value, low), high);
  }

  return Math.min(lo, Math.max(lo + size - frameSize * scale, value));
}

/**
 * Where the camera goes to focus one node.
 *
 * input.canvas  { w, h }              the viewBox, in user units
 * input.frame   { w, h }              the painted element box, in CSS pixels
 * input.free    { x, y, width, height }  the rectangle the chrome leaves free
 * input.boxes   { id: { x, y, w, h } }   drawn boxes, in user units
 * input.focus   the id being focused
 * input.near    the ids of its direct neighbours
 *
 * Returns { scale, x, y, painted, inside, offFrame }.
 */
function pfCameraTarget(input) {
  var canvas = input.canvas;
  var frame = input.frame;
  var free = input.free;
  var node = input.boxes[input.focus];
  if (!node || !canvas.w || !canvas.h || !frame.w || !frame.h) return null;

  /* What the browser did before the camera got here: one uniform scale, and a
     letterbox band on whichever axis had room to spare. */
  var s0 = Math.min(frame.w / canvas.w, frame.h / canvas.h);
  if (!(s0 > 0)) return null;
  var ox = (frame.w - canvas.w * s0) / 2;
  var oy = (frame.h - canvas.h * s0) / 2;

  var ids = [input.focus];
  for (var n = 0; n < input.near.length; n += 1) ids.push(input.near[n]);
  var union = pfUnion(input.boxes, ids) || node;

  /* The scale the whole neighbourhood would need, and then the band. Below the
     readable floor the neighbourhood loses; above the comfort ceiling the
     extra scale is refused. Both edges of that band are reached by real nodes
     on a real map, which is why it is a band and not a constant. */
  var fitted = Math.min(
    (free.width - PF_PAD * 2) / union.w,
    (free.height - PF_PAD * 2) / union.h);
  var painted = Math.min(PF_COMFORT, Math.max(PF_READABLE, fitted));
  var scale = painted / s0;

  /* What the camera points at, and the decision the reader feels most.

     When the whole neighbourhood fits at a readable scale, the union's centre
     is the right aim: everything is on screen either way, and centring the
     group is the composition that shows the focused component *in* its
     context rather than beside it.

     When it does not fit -- seventeen of the twenty components on the
     acceptance specimen -- the union's centre is an aim point that serves
     nobody. It is the middle of a rectangle mostly outside the frame, so
     pointing there pushes the focused component out to a margin, where
     containment catches it and parks it against the edge, and the context it
     was supposed to buy is off-screen anyway. Measured across the specimen
     that put eighteen of twenty focused components more than 150 pixels off
     the centre of the frame, three of them against a margin with no
     neighbour visible at all: the worst of both, a subject shoved aside for
     context that never arrived.

     So the focused component itself becomes the aim, and whatever context
     fits falls around it. The reader's eye goes to the middle of the frame,
     and what is in the middle of the frame is what they selected. */
  var fits = fitted >= PF_READABLE;
  var aimX = fits ? union.x + union.w / 2 : node.x + node.w / 2;
  var aimY = fits ? union.y + union.h / 2 : node.y + node.h / 2;

  var x = pfAxis(ox * scale, painted, scale, free.x, free.width, frame.w,
    aimX, node.x, node.x + node.w);
  var y = pfAxis(oy * scale, painted, scale, free.y, free.height, frame.h,
    aimY, node.y, node.y + node.h);

  /* Where a user-space point lands once this camera is applied. */
  var atX = function (u) { return x + ox * scale + painted * u; };
  var atY = function (u) { return y + oy * scale + painted * u; };

  var inside = atX(node.x) >= free.x - 0.5
    && atX(node.x + node.w) <= free.x + free.width + 0.5
    && atY(node.y) >= free.y - 0.5
    && atY(node.y + node.h) <= free.y + free.height + 0.5;

  /* What the reader cannot see. A neighbour with any part of itself inside the
     free rectangle is visible -- a box cut by the edge is still something a
     reader can find and follow -- so only a neighbour that misses the
     rectangle entirely is reported. Overstating this would be worse than
     saying nothing: an affordance that claims things are hidden when they are
     on screen teaches a reader to ignore it. */
  var offFrame = [];
  for (var k = 0; k < input.near.length; k += 1) {
    var other = input.boxes[input.near[k]];
    if (!other) continue;
    var visible = atX(other.x + other.w) > free.x
      && atX(other.x) < free.x + free.width
      && atY(other.y + other.h) > free.y
      && atY(other.y) < free.y + free.height;
    if (!visible) offFrame.push(input.near[k]);
  }

  return {
    scale: scale, x: x, y: y, painted: painted,
    inside: inside, offFrame: offFrame,
  };
}
`.trim();
