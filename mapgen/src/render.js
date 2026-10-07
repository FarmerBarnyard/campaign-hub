// Renders one map headlessly and returns the bitmap plus the render trace.
//
// A fresh generator context per render keeps one map's module-level state
// from leaking into the next -- important for an audit run that renders
// hundreds of seeds back to back and must not have run N depend on run N-1.

const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { createGeneratorContext } = require('./load-generators');

const FONT_DIR = path.resolve(__dirname, '..', 'fonts');
const RENDER_TIMEOUT_MS = 120000;

// The generator source is shared verbatim with the browser (see
// load-generators.js), and the browser never supersamples -- a canvas
// element's `.width`/`.height` there are always exactly the drawing-coordinate
// size, because nothing ever scales the context. Every generator relies on
// that equivalence: `canvas.width / 2` for the settlement center, mesh sizing,
// shoreline UV sampling, the hachure field, ground fills, dozens of call
// sites across all five map types.
//
// Node-side supersampling breaks that equivalence. renderMap creates the
// PHYSICAL canvas at baseW*scale x baseH*scale pixels and applies
// ctx.scale(scale, scale) so draw calls still work in the original
// coordinate space -- but the canvas object's own `.width`/`.height`
// properties report the physical size, not the logical one. At scale 2 a
// town centered with `canvas.width / 2` lands at drawing-coordinate 700,
// which the scaled context then places at physical pixel 1400 -- the far
// edge, not the middle. Confirmed directly: a scale-2 settlement render put
// the whole town in one corner of the frame while the identical seed at
// scale 1 rendered centered and correct. This is not a defect in the
// settlement generator or the recent silhouette/countryside work -- it is
// inherent to how this service has always done supersampling, and it was
// never exercised because every audit run (and the 200-seed gates through
// this whole project) used the default scale of 1.
//
// The fix stays entirely server-side rather than touching the shared
// generator source: what the generator receives as `canvas` is a thin view
// whose `.width`/`.height` report the LOGICAL size while `getContext()`
// delegates to the real, already-scaled physical canvas. The physical canvas
// itself -- used for `.toBuffer()`, `pixelsAtBaseScale()`, and the returned
// envelope's dimensions -- is untouched.
function makeCanvasView(physicalCanvas, logicalW, logicalH) {
  return {
    get width() { return logicalW; },
    get height() { return logicalH; },
    getContext: (...args) => physicalCanvas.getContext(...args),
    // Only ever touched by post-generation interactive wiring (hover cursor,
    // click hit-testing in views/map-overworld.js) that a headless render
    // never fires -- present so attaching them doesn't throw.
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: logicalW, height: logicalH, right: logicalW, bottom: logicalH }),
  };
}

// A form-control stub with a REAL value/checked state, unlike generic()
// below (which always reports value:'' and checked:false regardless of
// what the browser template's own `value="..."`/`checked` attributes say).
// generate() functions written for the live UI read their config straight
// off these controls -- `renderOverworldMap` has no `params` argument at
// all, so this stub map is the ONLY way a headless caller can drive it.
function inputStub(value, checked) {
  return {
    value: String(value), checked: !!checked, textContent: '', innerHTML: '',
    style: {}, disabled: false, addEventListener() {}, appendChild() {},
  };
}

// map-overworld.js's renderOverworldMap(container) -- note, no params
// argument -- reads every generation setting straight off these control
// IDs (views/map-overworld.js:1679-1690), because it was written purely for
// the live browser form and the generation-vs-DOM split the settlement
// generator already has never happened here. Against the plain generic()
// stub below, every one of these read back empty/false: parseInt('') is
// NaN, so `seaLevel`, `forestBias` and `ruggedBias` (no `|| default` guard
// on any of them, unlike seed/cells/octaves/settleCount which do have one)
// came out NaN, and a NaN sea level makes every land-vs-water height
// comparison false -- which is why a render came back as almost solid
// ocean texture with zero settlements, no rivers, and continent mode
// instead of the intended island default. `seed` similarly always fell
// back to 1 regardless of what a caller asked for, since NaN also fails
// its own `|| 1` guard... no, wait, `NaN || 1` DOES equal 1 -- the point is
// it silently overrode whatever seed a caller actually requested.
//
// This mirrors the browser template's OWN declared defaults exactly
// (views/map-overworld.js:810-852), so an overworld render with no
// generation params behaves exactly as it would freshly loaded in a
// browser -- the difference is a caller can now actually override any of
// them, which the live page could already do via its own form.
function makeOverworldStubs(params) {
  const p = (key, fallback) => (params && params[key] !== undefined ? params[key] : fallback);
  const flag = (key, fallback) => {
    const v = p(key, undefined);
    if (v === undefined) return fallback;
    return v !== 'false' && v !== '0' && v !== '';
  };
  return {
    '#ow-seed': inputStub(p('seed', Math.floor(Math.random() * 1e6))),
    '#ow-cells': inputStub(p('cells', 40000)),
    '#ow-oct': inputStub(p('octaves', 4)),
    '#ow-sea': inputStub(p('sea', 42)),
    '#ow-forest-bias': inputStub(p('forestBias', 0)),
    '#ow-rugged-bias': inputStub(p('ruggedBias', 0)),
    '#ow-island': inputStub('', flag('island', true)),
    '#ow-rivers': inputStub('', flag('rivers', true)),
    '#ow-wildzones': inputStub('', flag('wildzones', true)),
    '#ow-legend': inputStub('', flag('legend', false)),
    '#ow-settle': inputStub(p('settle', 6)),
    '#ow-tile-cols': inputStub(p('tileCols', 3)),
    '#ow-tile-rows': inputStub(p('tileRows', 3)),
  };
}

function makeContainerStub(canvas, theme, extraNamed) {
  const generic = () => ({
    value: '', textContent: '', innerHTML: '', checked: false, style: {}, disabled: false,
    addEventListener() {}, appendChild() {}, querySelector: () => generic(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  });
  // Panels the generators write to are captured rather than discarded --
  // they are the map's metadata (notable locations, room key, lore) and the
  // browser still needs them once it stops generating locally.
  const captured = {};
  const panel = (key) => ({
    get innerHTML() { return captured[key] || ''; },
    set innerHTML(v) { captured[key] = v; },
    textContent: '', addEventListener() {}, appendChild() {},
  });
  const named = {
    '#st-canvas': canvas,
    '#dg-canvas': canvas,
    '#ow-canvas': canvas,
    '#dt-canvas': canvas,
    '#lm-canvas': canvas,
    '#st-theme': { value: theme, addEventListener() {}, innerHTML: '', appendChild() {} },
    '#dg-theme': { value: theme, addEventListener() {}, innerHTML: '', appendChild() {} },
    '#ow-theme': { value: theme, addEventListener() {}, innerHTML: '', appendChild() {} },
    '#dt-theme': { value: theme, addEventListener() {}, innerHTML: '', appendChild() {} },
    '#lm-theme': { value: theme, addEventListener() {}, innerHTML: '', appendChild() {} },
    '#st-poi': panel('poi'),
    '#dg-key': panel('roomKey'),
    '#lm-lore': panel('lore'),
    '#st-heading': { textContent: '' },
    ...extraNamed,
  };
  return {
    captured,
    container: {
      innerHTML: '',
      querySelector: (sel) => named[sel] || generic(),
      querySelectorAll: () => [],
      appendChild() {}, addEventListener() {},
    },
  };
}

// The generators fire generate() without awaiting it, but call
// progress.done() as their last act -- overriding showGenerationProgress
// gives an exact completion signal without touching generator source.
function installCompletionSignal(sandbox) {
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  sandbox.showGenerationProgress = () => ({ update() {}, done() { resolveDone(); } });
  return { done, fail: (e) => rejectDone(e) };
}

// type: 'settlement' | 'dungeon' | 'detail' | 'landmark' | 'overworld'
// params: plain object of URL-style params
// scale: supersample factor; the generator draws at its normal coordinates
//        and simply lands on more pixels (a true supersample, not a bigger town)
async function renderMap({ type, params = {}, scale = 1, theme = 'parchment', trace = true }) {
  const { context, sandbox, fonts } = createGeneratorContext({ fontDir: FONT_DIR });

  const entry = {
    settlement: 'renderSettlementMap',
    dungeon: 'renderDungeonMap',
    detail: 'renderDetailMap',
    landmark: 'renderLandmarkMap',
    overworld: 'renderOverworldMap',
  }[type];
  if (!entry || typeof sandbox[entry] !== 'function') {
    throw new Error(`unknown or unavailable map type: ${type}`);
  }

  const baseW = type === 'settlement' ? (sandbox.SETTLEMENT_CANVAS_SIZE || 700) : type === 'dungeon' ? 900 : 800;
  const baseH = type === 'settlement' ? (sandbox.SETTLEMENT_CANVAS_SIZE || 700) : type === 'dungeon' ? 600 : 600;
  const canvas = createCanvas(Math.round(baseW * scale), Math.round(baseH * scale));
  if (scale !== 1) canvas.getContext('2d').scale(scale, scale);

  const signal = installCompletionSignal(sandbox);
  // The generator gets the logical-size view (see makeCanvasView above);
  // everything below this point (`.toBuffer()`, pixel sampling, the returned
  // envelope) keeps using the real physical `canvas`.
  // Always wrapped, never the raw physical canvas -- @napi-rs/canvas's
  // Canvas has no addEventListener/style/getBoundingClientRect at all, real
  // DOM methods a browser <canvas> always has. map-overworld.js's own
  // interactive hover/click wiring calls addEventListener directly on its
  // canvas unconditionally, so ANY overworld render -- scale 1 included --
  // threw immediately: this had never actually succeeded through this
  // service. At scale 1, logical and physical size are equal, so wrapping
  // changes nothing about settlement's already-verified scale-1 geometry;
  // it only turns a hard crash into a harmless no-op for methods nothing
  // in settlement's own generation path happens to call.
  const canvasView = makeCanvasView(canvas, baseW, baseH);
  const extraNamed = type === 'overworld' ? makeOverworldStubs(params) : undefined;
  const { container, captured } = makeContainerStub(canvasView, theme, extraNamed);

  if (trace) sandbox.beginRenderTrace();
  const started = Date.now();
  try {
    sandbox[entry](container, new URLSearchParams(params));
    await Promise.race([
      signal.done,
      new Promise((_, reject) => setTimeout(() => reject(new Error('render timed out')), RENDER_TIMEOUT_MS)),
    ]);
  } finally {
    // Always close the trace, even on failure, so a timed-out render cannot
    // leave tracing on and contaminate the next one.
    var captureTrace = trace ? sandbox.endRenderTrace() : null;
  }

  return {
    canvas,
    trace: captureTrace,
    meta: captured,
    fonts,
    // Trace geometry is in unscaled generator coordinates; rule checks that
    // compare against pixels need the base size, not the supersampled one.
    width: baseW,
    height: baseH,
    scale,
    elapsedMs: Date.now() - started,
  };
}

// Pixels at generator coordinates, so geometry rules and pixel rules agree.
function pixelsAtBaseScale(canvas, baseW, baseH, scale) {
  if (scale === 1) {
    return canvas.getContext('2d').getImageData(0, 0, baseW, baseH).data;
  }
  const down = createCanvas(baseW, baseH);
  down.getContext('2d').drawImage(canvas, 0, 0, baseW, baseH);
  return down.getContext('2d').getImageData(0, 0, baseW, baseH).data;
}

module.exports = { renderMap, pixelsAtBaseScale, RENDER_TIMEOUT_MS };
