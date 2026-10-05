// Loads the browser generator source into a Node VM context.
//
// The app is a no-build-step, plain-<script> site: every lib/ and views/ file
// declares top-level globals and relies on them being shared. `require()`
// would give each file its own module scope and break that, so each file is
// evaluated with vm.runInContext against ONE shared context instead --
// reproducing browser <script> semantics exactly. That is what lets the
// service run the same art code the browser runs, with no second
// implementation to drift out of sync.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, Path2D, GlobalFonts, DOMMatrix, Image } = require('@napi-rs/canvas');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Order matters and mirrors index.html. Deliberately EXCLUDED:
//   auth-gate.js, lib/api.js, lib/wikilink.js  -- network/DOM, unused by drawing
//   lib/generation-progress.js                 -- pure DOM; stubbed below instead
//   views/library.js, campaign.js, new-note.js, app.js -- routing/DOM only
const LIB_FILES = [
  'lib/render-trace.js', // must precede the primitives that report into it
  'lib/noise.js',
  'lib/voronoi-mesh.js',
  'lib/terrain-grid.js',
  'lib/watercolor-wash.js',
  'lib/hydrology.js',
  'lib/pictorial-buildings.js',
  'lib/organic-roads.js',
  'lib/tree-clusters.js',
  'lib/hachure-terrain.js',
  'lib/map-labels.js',
  'lib/keyed-legend.js',
  'lib/map-themes.js',
  'lib/settlement-names.js',
  'lib/map-biome-zones.js',
  'lib/campaign-themes.js',
  'lib/zip-writer.js',
  'lib/room-shapes.js',
  'lib/landmark-sites.js',
  'lib/landmark-lore.js',
  'lib/dungeon-lore.js',
  'lib/dungeon-props.js',
  'lib/settlement-poi.js',
];

// map-dungeon.js is required by the others: it defines the shared
// populateCampaignSelect / wireMapExportSave / drawDungeonLegend helpers.
// map-settlement.js additionally reaches for OW_SERIF (map-overworld.js) and
// renderTerrainPatch (map-detail.js), so all five load together.
const VIEW_FILES = [
  'views/map-dungeon.js',
  'views/map-overworld.js',
  'views/map-settlement.js',
  'views/map-detail.js',
  'views/map-landmark.js',
];

// Registers the fonts the generators name (Georgia / Palatino / Book Antiqua
// serif stacks, plus sans-serif). Without metric-compatible faces present,
// measureText returns different widths than the browser and every label
// shifts -- the single biggest fidelity risk in moving off the browser.
// Registering a file under its own name is not enough: the generators ask for
// "Georgia", "Palatino Linotype", "Book Antiqua" and "sans-serif", and none of
// those families exist on Linux under those names. fonts/fonts.json maps each
// bundled file to the family names it should answer to, so the existing font
// stacks resolve without editing generator source.
//
// Returns { files, families, missing } so the caller can refuse to render
// rather than quietly producing a map whose every label sits in the wrong
// place -- a silent fallback here is indistinguishable from correct output
// until someone compares two exports side by side.
function registerFonts(fontDir) {
  const result = { files: [], families: [], missing: [] };
  if (!fontDir || !fs.existsSync(fontDir)) {
    result.missing = ['<no font directory>'];
    return result;
  }

  let manifest = { aliases: {}, required: [] };
  const manifestPath = path.join(fontDir, 'fonts.json');
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }

  const families = new Set();
  for (const entry of fs.readdirSync(fontDir)) {
    if (!/\.(ttf|otf)$/i.test(entry)) continue;
    const full = path.join(fontDir, entry);
    try {
      if (GlobalFonts.registerFromPath(full)) result.files.push(entry);
    } catch (err) {
      // A single unreadable font must not take the renderer down; the
      // coverage check below is what actually gates quality.
      continue;
    }
    // Same file registered again under each alias, so one face can answer to
    // every name in a CSS stack (bold/italic faces register under the same
    // alias and canvas picks between them by the face's own style).
    for (const alias of manifest.aliases?.[entry] || []) {
      try {
        if (GlobalFonts.registerFromPath(full, alias)) families.add(alias);
      } catch (err) { /* alias unavailable; reported via `missing` below */ }
    }
  }

  result.families = [...families];
  result.missing = (manifest.required || []).filter((f) => !families.has(f));
  return result;
}

// Minimal DOM stand-in. The generators touch the DOM in only a handful of
// places (a theme <select> read, an innerHTML shell, a panel write, and
// event wiring), so this covers those rather than pretending to be a DOM.
// It shrinks to nothing once the core/ refactor lands and the pure
// generator functions are called directly.
function makeElementStub(overrides = {}) {
  const el = {
    value: '',
    textContent: '',
    checked: false,
    style: {},
    children: [],
    disabled: false,
    innerHTML: '',
    querySelector: () => makeElementStub(),
    querySelectorAll: () => [],
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    click() {},
    remove() {},
    ...overrides,
  };
  return el;
}

function makeDocumentStub(canvasFactory) {
  return {
    createElement(tag) {
      if (String(tag).toLowerCase() === 'canvas') return canvasFactory(300, 150);
      return makeElementStub();
    },
    createElementNS(_ns, tag) { return this.createElement(tag); },
    querySelector: () => makeElementStub(),
    querySelectorAll: () => [],
    body: makeElementStub(),
    head: makeElementStub(),
    documentElement: makeElementStub(),
    addEventListener() {},
  };
}

// Builds a fresh sandbox with every generator global defined. Fresh per
// render keeps one map's module-level state from leaking into the next.
// allowMissingFonts exists only for tooling that genuinely does not care about
// type (a geometry-only spike). Anything that produces a map a person will look
// at must leave it off: rendering with a fallback face is not a degraded map,
// it is a wrong one, and nothing downstream can detect it.
function createGeneratorContext({ fontDir, allowMissingFonts = false } = {}) {
  const fonts = registerFonts(fontDir);
  if (fonts.missing.length && !allowMissingFonts) {
    throw new Error(
      `missing required font families: ${fonts.missing.join(', ')} -- ` +
      `every label would silently fall back and shift. Check ${fontDir}/fonts.json ` +
      `and that the font files it names are present.`
    );
  }

  const canvasFactory = (w, h) => createCanvas(w, h);

  const sandbox = {
    console,
    Path2D,
    DOMMatrix,
    Image,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    document: makeDocumentStub(canvasFactory),
    // lib/generation-progress.js is pure DOM and is not loaded; the
    // generators call these two, so they get inert equivalents. yieldToPaint
    // must still yield -- the generators await it between phases.
    yieldToPaint: () => new Promise((resolve) => setImmediate(resolve)),
    showGenerationProgress: () => ({ update() {}, done() {} }),
    // lib/api.js is not loaded (it is browser fetch against the Worker), but
    // views/map-dungeon.js's populateCampaignSelect -- shared by every view's
    // init -- calls Api.get. It already swallows failures, so an inert
    // rejecting stub is enough and keeps the service from ever calling out.
    Api: {
      get: () => Promise.reject(new Error('api_unavailable_headless')),
      post: () => Promise.reject(new Error('api_unavailable_headless')),
    },
    __createCanvas: canvasFactory,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const context = vm.createContext(sandbox);

  const loaded = [];
  for (const rel of [...LIB_FILES, ...VIEW_FILES]) {
    const full = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(full)) {
      throw new Error(`generator source missing: ${rel}`);
    }
    const code = fs.readFileSync(full, 'utf8');
    try {
      vm.runInContext(code, context, { filename: rel });
    } catch (err) {
      throw new Error(`failed loading ${rel}: ${err.message}`);
    }
    loaded.push(rel);
  }

  return { context, sandbox, loaded, fonts };
}

module.exports = { createGeneratorContext, registerFonts, makeElementStub, REPO_ROOT };
