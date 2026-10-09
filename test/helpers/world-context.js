// Loads the map generators' plain-<script> sources into one vm context, the same way the browser
// shares globals between <script> tags (and the way mapgen/src/load-generators.js does), but with
// no canvas: enough to build an overworld world and read its fields. Used by the overworld tests.

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var root = path.join(__dirname, "..", "..");

var FILES = [
  "lib/render-trace.js", "lib/noise.js", "lib/voronoi-mesh.js", "lib/terrain-grid.js",
  "lib/watercolor-wash.js", "lib/hydrology.js", "lib/pictorial-buildings.js", "lib/organic-roads.js",
  "lib/tree-clusters.js", "lib/hachure-terrain.js", "lib/map-labels.js", "lib/keyed-legend.js",
  "lib/map-themes.js", "lib/settlement-names.js", "lib/map-biome-zones.js", "lib/campaign-themes.js",
  "lib/zip-writer.js", "lib/room-shapes.js", "lib/landmark-sites.js", "lib/landmark-lore.js",
  "lib/dungeon-lore.js", "lib/dungeon-props.js", "lib/settlement-poi.js", "lib/overworld-world.js", "lib/map-window.js",
  "views/map-dungeon.js", "views/map-overworld.js", "views/map-settlement.js", "views/map-detail.js", "views/map-window.js",
  "views/map-landmark.js",
];

function stubElement() {
  return {
    value: "", textContent: "", checked: false, style: {}, children: [], innerHTML: "",
    querySelector: stubElement, querySelectorAll: function () { return []; },
    appendChild: function (c) { return c; }, addEventListener: function () {},
    getContext: function () { return null; }, remove: function () {},
  };
}

// `skip` lists files that do not exist yet (before the refactor) or that a test does not want.
function createContext(opts) {
  opts = opts || {};
  var sandbox = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    atob: function (s) { return Buffer.from(s, "base64").toString("binary"); },
    btoa: function (s) { return Buffer.from(s, "binary").toString("base64"); },
    document: { createElement: stubElement, querySelector: stubElement, querySelectorAll: function () { return []; }, body: stubElement(), addEventListener: function () {} },
    Api: { get: function () { return Promise.reject(new Error("no api")); } },
    yieldToPaint: function () { return Promise.resolve(); },
    showGenerationProgress: function () { return { update: function () {}, done: function () {} }; },
    Path2D: function () {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  var context = vm.createContext(sandbox);
  var loaded = [];
  FILES.forEach(function (rel) {
    if (opts.skip && opts.skip.indexOf(rel) !== -1) return;
    var full = path.join(root, rel);
    if (!fs.existsSync(full)) return;
    vm.runInContext(fs.readFileSync(full, "utf8"), context, { filename: rel });
    loaded.push(rel);
  });
  return { context: context, loaded: loaded };
}

module.exports = { createContext: createContext, root: root };
