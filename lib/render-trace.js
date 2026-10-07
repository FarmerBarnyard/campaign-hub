// Render trace -- opt-in instrumentation so a validator can check GEOMETRY
// rules (RULES.md B1 overlap, S1 street occlusion, L2 label collision)
// against what was actually drawn, instead of inferring it from pixels.
//
// Pixel analysis can answer "is the ground varied" but not "did this
// building's silhouette cross into its neighbour's plot" -- that needs the
// real polygons. The drawing primitives are already the single choke point
// every building, road and label passes through, so they report here.
//
// Inert unless a caller calls beginRenderTrace(): in the browser nothing
// does, so each hook costs one falsy check. The trace lives in a module
// global rather than being threaded through every draw call because these
// primitives are shared, positional-argument functions used from several
// generators -- adding a parameter to all of them would be a far wider
// change for no benefit.

let RENDER_TRACE = null;

function beginRenderTrace() {
  RENDER_TRACE = {
    buildings: [], roads: [], labels: [], trees: [], rivers: [], bridges: [],
    boundary: [], fields: [],
  };
  return RENDER_TRACE;
}

function endRenderTrace() {
  const trace = RENDER_TRACE;
  RENDER_TRACE = null;
  return trace;
}

function isTracing() {
  return RENDER_TRACE !== null;
}

// Buckets are created on demand. The previous version pushed only into kinds
// that beginRenderTrace happened to have pre-declared and dropped everything
// else silently -- so adding a new trace kind produced no data, no error and
// no clue, and the rule depending on it simply returned null and vanished from
// the audit. A rule that disappears looks exactly like a rule that passes,
// which is the one failure mode this whole harness exists to prevent.
function traceShape(kind, data) {
  if (!RENDER_TRACE) return;
  if (!RENDER_TRACE[kind]) RENDER_TRACE[kind] = [];
  RENDER_TRACE[kind].push(data);
}

// Maps a point from a primitive's local (translated + rotated) frame back
// into world/canvas space, so traced geometry from different primitives is
// directly comparable.
function traceLocalToWorld(cx, cy, angle, lx, ly) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
}

function traceRectCorners(cx, cy, angle, w, h) {
  return [
    traceLocalToWorld(cx, cy, angle, -w / 2, -h / 2),
    traceLocalToWorld(cx, cy, angle, w / 2, -h / 2),
    traceLocalToWorld(cx, cy, angle, w / 2, h / 2),
    traceLocalToWorld(cx, cy, angle, -w / 2, h / 2),
  ];
}
