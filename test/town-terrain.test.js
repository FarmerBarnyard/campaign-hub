// Guards for the two ways a town map used to stop matching the overworld it was opened from
// (reported 2026-10-10 on seed 362610, Mercove): the terrain window was stretched, and the coast was
// re-noised until a narrow neck of land drowned.
//
//   node test/town-terrain.test.js
//
// Plain Node, standard library only. These read the source because the pieces live inside view closures.

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var root = path.join(__dirname, "..");
var read = function (p) { return fs.readFileSync(path.join(root, p), "utf8"); };

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("the town map's terrain window is square in overworld pixels (the canvas it is painted on is square)", function () {
  var ow = read("views/map-overworld.js");
  var at = ow.indexOf("function buildSettlementMapUrl");
  assert.ok(at !== -1);
  var body = ow.slice(at, at + 1800);
  assert.ok(/windowCellsX = \(canvas\.width \/ SETTLEMENT_ZOOM_FACTOR\) \/ cellW/.test(body));
  assert.ok(/windowCellsY = \(canvas\.width \/ SETTLEMENT_ZOOM_FACTOR\) \/ cellH/.test(body),
    "the vertical extent uses the same pixel size as the horizontal one, not canvas.height");
});

test("click-through maps keep the overworld's coast (no hydraulic erosion, light noise)", function () {
  var detail = read("views/map-detail.js");
  assert.ok(/const faithful = !!win \|\| \(!!opts\.faithful && !!sampleGuide\)/.test(detail));
  assert.ok(/if \(!faithful\) applyHydraulicErosion/.test(detail));
  assert.ok(/faithful \? 0\.1 : 0\.2/.test(detail));
  ["views/map-detail.js", "views/map-landmark.js", "views/map-settlement.js"].forEach(function (f) {
    assert.ok(/renderTerrainPatch\([^)]*faithful: true/.test(read(f)), f + " asks for the faithful coast");
  });
});

test("inside a terrain-backed town the ground is the terrain's own, not a tan fill", function () {
  var s = read("views/map-settlement.js");
  assert.ok(s.indexOf("townGroundTone") === -1, "the tan biome-blend fill is gone");
  assert.ok(/if \(!sampleGuide\) \{\s*const groundWarp|if \(!sampleGuide\) \{/.test(s), "the radial straw hatching only runs without a backdrop");
});

console.log(passed + " passed");
