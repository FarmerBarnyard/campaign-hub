// The zoom-in window (lib/map-window.js): reading and writing its address, and reading fields out of a
// built overworld at the window's coordinates. A real world is built once (10,000 cells) and the
// sampler is checked against it cell by cell.
//
//   node test/map-window.test.js

var assert = require("assert");
var path = require("path");
var vm = require("vm");
var H = require("./helpers/world-context.js");
var MW = require(path.join(H.root, "lib", "map-window.js"));
var MapLink = require(path.join(H.root, "lib", "map-link.js"));

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
function q(s) { return new URLSearchParams(s); }

var base = "seed=938479&oc=40000&oo=4&oi=1&orv=1&os=6&sea=0.42&ofb=0&orb=0&owz=1&osc=s&wx=0.125&wy=0.25&ww=0.25";

test("an address without a window is not a window", function () {
  assert.strictEqual(MW.parse(q("seed=1&x=10&y=20&guide=abc")), null);
  assert.strictEqual(MW.parse(q("seed=1&ww=")), null);
  assert.strictEqual(MW.parse(null), null);
});

test("a window address reads back to the same window and writes the same text", function () {
  var w = MW.parse(q(base));
  assert.strictEqual(w.seed, 938479);
  assert.strictEqual(w.cells, 40000);
  assert.strictEqual(w.octaves, 4);
  assert.strictEqual(w.island, true);
  assert.strictEqual(w.rivers, true);
  assert.strictEqual(w.settle, 6);
  assert.strictEqual(w.sea, 0.42);
  assert.strictEqual(w.wildZones, true);
  assert.strictEqual(w.continent, false);
  assert.strictEqual(MW.toParams(w), base);
  assert.deepStrictEqual(MW.parse(q(MW.toParams(w))), w);
});

test("the address is short and uses only characters a saved map note accepts", function () {
  var text = MW.toParams(MW.parse(q(base)));
  assert.ok(text.length < 200, "length " + text.length);
  assert.ok(/^[A-Za-z0-9%_.~+=&,-]*$/.test(text));
  assert.strictEqual(MapLink.mapHash({ Map_Route: "map/detail", Map_Params: text }), "#/map/detail?" + text);
});

test("a window is snapped to something the map can show", function () {
  var tooSmall = MW.clamp(0.5, 0.5, 0.01);
  assert.strictEqual(tooSmall.ww, Math.round(10000 / MW.MAX_ZOOM) / 10000);
  var spill = MW.clamp(0.9, 0.9, 0.25);
  assert.ok(spill.wx + spill.ww <= 1 && spill.wy + spill.ww <= 1, "stays inside the overworld");
  assert.deepStrictEqual(MW.clamp(-3, -3, 0.5), { wx: 0, wy: 0, ww: 0.5 });
  assert.strictEqual(MW.clamp(0, 0, 7).ww, 1);
  assert.deepStrictEqual(MW.clamp(NaN, NaN, NaN), { wx: 0, wy: 0, ww: 0.25 });
});

test("bad or missing numbers fall back to the overworld page defaults", function () {
  var w = MW.parse(q("ww=0.25&seed=abc&oc=zz&sea=9&ofb=500&os=-4"));
  assert.strictEqual(w.seed, 1);
  assert.strictEqual(w.cells, 40000);
  assert.strictEqual(w.sea, 1);
  assert.strictEqual(w.forestBias, 100);
  assert.strictEqual(w.settle, 0);
  assert.strictEqual(w.island, true);
});

test("the Continent canvas is 1600x1200 and a Standard one 800x600; zoom is the inverse of the width", function () {
  assert.deepStrictEqual(MW.canvasFor(MW.parse(q(base))), { width: 800, height: 600 });
  assert.deepStrictEqual(MW.canvasFor(MW.parse(q(base.replace("osc=s", "osc=c")))), { width: 1600, height: 1200 });
  assert.strictEqual(MW.zoomOf(MW.parse(q(base))), 4);
  assert.strictEqual(MW.parse(q("ww=0.25&osc=c")).cells, 150000, "Continent default cell count");
});

test("the world parameters are the ones lib/overworld-world.js builds from", function () {
  var wp = MW.worldParams(MW.parse(q(base)));
  assert.deepStrictEqual(wp, { seed: 938479, cellCount: 40000, octaves: 4, island: true, seaLevel: 0.42, riversOn: true, settleCount: 6 });
});

// --- against a real world ---

var ctx = H.createContext().context;
ctx.__p = { seed: 1, cellCount: 10000, octaves: 4, island: true, seaLevel: 0.42, riversOn: true, settleCount: 6 };
var world = vm.runInContext("buildOverworldWorld(__p, 800, 600)", ctx);
var win = MW.parse(q("seed=1&oc=10000&oo=4&oi=1&orv=1&os=6&sea=0.42&wx=0&wy=0&ww=0.5"));
var sample = MW.sampler(world, win);

test("the world records what it was laid out on", function () {
  assert.strictEqual(world.seaLevel, 0.42);
  assert.strictEqual(world.width, 800);
  assert.strictEqual(world.height, 600);
});

test("reading at a cell centre gives exactly that cell's value", function () {
  [[10, 7], [30, 20], [5, 40], [49, 36]].forEach(function (rc) {
    var c = rc[0], r = rc[1];
    var u = ((c + 0.5) * world.cellW) / (win.ww * 800), v = ((r + 0.5) * world.cellH) / (win.ww * 600);
    var i = r * world.cols + c;
    assert.ok(Math.abs(sample.heightAt(u, v) - world.heights[i]) < 1e-12, "height");
    assert.ok(Math.abs(sample.moistureAt(u, v) - world.mOf[i]) < 1e-12, "moisture");
    assert.ok(Math.abs(sample.temperatureAt(u, v) - world.tOf[i]) < 1e-12, "temperature");
    assert.strictEqual(sample.nearest(u, v), i);
  });
});

test("between two cells the reading lies between their values", function () {
  var c = 20, r = 15, i = r * world.cols + c, j = i + 1;
  var u = ((c + 1.0) * world.cellW) / (win.ww * 800), v = ((r + 0.5) * world.cellH) / (win.ww * 600);
  var h = sample.heightAt(u, v), lo = Math.min(world.heights[i], world.heights[j]), hi = Math.max(world.heights[i], world.heights[j]);
  assert.ok(h >= lo - 1e-12 && h <= hi + 1e-12);
  assert.ok(Math.abs(h - (world.heights[i] + world.heights[j]) / 2) < 1e-9, "halfway is the mean");
});

test("overworld and detail pixels convert both ways", function () {
  var w2 = MW.parse(q("seed=1&sea=0.42&wx=0.2&wy=0.3&ww=0.25"));
  var s2 = MW.sampler(world, w2);
  // the window starts at (0.2 * 800, 0.3 * 600) = (160, 180) and is 200 x 150 overworld pixels across
  var d = s2.toDetail(160, 250);
  assert.ok(Math.abs(d.x - 0) < 1e-9 && Math.abs(d.y - ((250 - 180) / 150) * 600) < 1e-9);
  var back = s2.toOverworld(d.x, d.y);
  assert.ok(Math.abs(back.x - 160) < 1e-9 && Math.abs(back.y - 250) < 1e-9);
  assert.ok(Math.abs(s2.scale - 0.25) < 1e-12, "a 4x window is 0.25 overworld pixels per detail pixel");
});

test("the river network matches the overworld: sources have flow, a trunk is only drawn once", function () {
  var chains = MW.riverChains(world, 1);
  assert.ok(chains.length > 0, "this seed has rivers");
  chains.forEach(function (ch) {
    assert.ok(ch.points.length >= 2);
    assert.ok(ch.points[0].flow >= world.riverThreshold, "a river starts where the flow qualifies");
    assert.strictEqual(ch.maxFlow, Math.max.apply(null, ch.points.map(function (p) { return p.flow; })));
  });
  var visited = {};
  chains.forEach(function (ch) {
    ch.points.slice(1, -1).forEach(function (p) {
      var k = p.x + "," + p.y;
      assert.ok(!visited[k], "a trunk is not drawn twice");
      visited[k] = 1;
    });
  });
});

test("a river that reaches the sea stops at the shore instead of running on over open water", function () {
  var chains = MW.riverChains(world, 1), ended = 0;
  chains.forEach(function (ch) {
    var last = ch.points[ch.points.length - 1];
    assert.ok(last.h >= world.seaLevel - 1e-12, "no point below the sea");
    if (last.h === world.seaLevel) ended++;
  });
  assert.ok(ended > 0, "this seed has at least one river that meets the sea");
});

test("a lower threshold adds streams and never removes a river", function () {
  var main = MW.riverChains(world, 1), more = MW.riverChains(world, 0.3);
  assert.ok(more.length >= main.length);
  var pts = function (cs) { return cs.reduce(function (n, c) { return n + c.points.length; }, 0); };
  assert.ok(pts(more) > pts(main));
});

test("a world built without rivers has none and no lake field", function () {
  var none = { cols: 2, rows: 2, cellW: 1, cellH: 1, heights: [0, 0, 0, 0], mOf: [0, 0, 0, 0], tOf: [0, 0, 0, 0], flow: null, downhill: null, isLake: null };
  assert.deepStrictEqual(MW.riverChains(none, 1), []);
  assert.strictEqual(MW.sampler(none, MW.parse(q("ww=1"))).lakeAt, null);
});

test("wild zones that reach the window come back with a mask of the cells in their region", function () {
  var fake = {
    cols: 4, rows: 4, cellW: 200, cellH: 150, heights: new Float64Array(16), mOf: new Float64Array(16), tOf: new Float64Array(16),
    regionOf: [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1], regionZoneOf: [null, { key: "z1" }], rangeZoneOf: null, rangeIndexOf: null,
  };
  var s = MW.sampler(fake, { wx: 0, wy: 0, ww: 1, continent: false });
  var cells = [];
  for (var i = 0; i < 16; i++) cells.push({ x: (i % 4) * 200 + 100, y: Math.floor(i / 4) * 150 + 75 });
  var mesh = { cells: cells, width: 800, height: 600 };
  var entries = s.zoneEntries(mesh, true);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].zone.key, "z1");
  assert.strictEqual(entries[0].mask.length, 16);
  assert.ok(entries[0].mask[2] === 1 && entries[0].mask[0] === 0);
  assert.deepStrictEqual(s.zoneEntries(mesh, false), []);
});

// --- choosing a window ---

test("a click centres a window of the chosen zoom, pushed inside the map at the edges", function () {
  var mid = MW.fromCentre(400, 300, 4, 800, 600);
  assert.deepStrictEqual(mid, { wx: 0.375, wy: 0.375, ww: 0.25 });
  var corner = MW.fromCentre(5, 5, 4, 800, 600);
  assert.deepStrictEqual(corner, { wx: 0, wy: 0, ww: 0.25 });
  var far = MW.fromCentre(799, 599, 2, 800, 600);
  assert.deepStrictEqual(far, { wx: 0.5, wy: 0.5, ww: 0.5 });
  assert.strictEqual(MW.fromCentre(400, 300, 50, 800, 600).ww, Math.round(10000 / MW.MAX_ZOOM) / 10000, "capped at the deepest zoom");
  assert.strictEqual(MW.fromCentre(400, 300, 0.2, 800, 600).ww, 1, "never wider than the map");
});

test("a drag makes a 4:3 box that grows from where it started, whichever way it goes", function () {
  var down = MW.fromDrag({ x: 100, y: 100 }, { x: 300, y: 250 }, 800, 600);
  assert.deepStrictEqual(down, { wx: 0.125, wy: 0.1667, ww: 0.25 });
  var up = MW.fromDrag({ x: 300, y: 250 }, { x: 100, y: 100 }, 800, 600);
  assert.deepStrictEqual(up, { wx: 0.125, wy: 0.1667, ww: 0.25 });
  // a tall drag is sized by its height (150 of 600 is a quarter), a wide one by its width
  assert.strictEqual(MW.fromDrag({ x: 0, y: 0 }, { x: 40, y: 150 }, 800, 600).ww, 0.25);
  assert.strictEqual(MW.fromDrag({ x: 0, y: 0 }, { x: 400, y: 10 }, 800, 600).ww, 0.5);
  // dragging past the edge keeps the box inside the map
  var spill = MW.fromDrag({ x: 700, y: 500 }, { x: 900, y: 650 }, 800, 600);
  assert.ok(spill.wx + spill.ww <= 1 && spill.wy + spill.ww <= 1);
});

test("a box can be moved and re-zoomed without leaving the map or losing its centre", function () {
  var box = { wx: 0.375, wy: 0.375, ww: 0.25 };
  assert.deepStrictEqual(MW.nudge(box, 0.1, -0.1), { wx: 0.475, wy: 0.275, ww: 0.25 });
  assert.deepStrictEqual(MW.nudge(box, 5, 5), { wx: 0.75, wy: 0.75, ww: 0.25 });
  var zoomed = MW.withZoom(box, 8);
  assert.strictEqual(zoomed.ww, 0.125);
  assert.ok(Math.abs((zoomed.wx + zoomed.ww / 2) - 0.5) < 1e-3 && Math.abs((zoomed.wy + zoomed.ww / 2) - 0.5) < 1e-3, "same centre");
  assert.strictEqual(MW.withZoom(box, 1).ww, 1);
});

test("the zoom choices are all inside what a window can be", function () {
  MW.ZOOM_LEVELS.forEach(function (z) { assert.ok(z >= 2 && z <= MW.MAX_ZOOM); });
  assert.ok(MW.ZOOM_LEVELS.indexOf(4) >= 0);
});

console.log("\n" + passed + " passed");
