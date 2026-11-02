// The overworld world model (lib/overworld-world.js) was extracted from the overworld page's
// buildWorld closure. test/fixtures/overworld-golden.json holds fingerprints captured from the
// code BEFORE that extraction, for Standard- and Continent-tier worlds, so any change to the
// generated world (heights, rivers, biomes, settlements, roads...) fails here by field name.
// Engines differ: V8 builds return slightly different Math.sin, cos, atan2, exp and log, and that is
// enough to change the world. So there is one fixture for Chromium's V8 (Electron here, the same
// engine as the browser app) and overworld-golden-node.json for Node, on Linux and Windows alike.
//
//   node test/overworld-world.test.js

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var H = require("./helpers/world-context.js");
var D = require("./helpers/world-digest.js");
var configs = require("./helpers/world-configs.js");

var goldenFile = process.versions.electron ? "overworld-golden.json" : "overworld-golden-node.json";
var golden = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", goldenFile), "utf8"));
var ctx = H.createContext().context;
var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
function build(c) {
  ctx.__p = { seed: c.seed, cellCount: c.cells, octaves: c.octaves, island: c.island, seaLevel: c.sea, riversOn: c.rivers, settleCount: c.settle };
  return vm.runInContext("buildOverworldWorld(__p, " + c.width + ", " + c.height + ")", ctx);
}

test("the world builder is a plain global with no canvas or DOM dependency", function () {
  assert.strictEqual(vm.runInContext("typeof buildOverworldWorld", ctx), "function");
  var src = fs.readFileSync(path.join(H.root, "lib", "overworld-world.js"), "utf8");
  var code = src.replace(/\/\/.*$/gm, "");
  assert.ok(!/\bcanvas\b|\bdocument\b|\bwindow\b|\bcontainer\b/.test(code), "no canvas/DOM reference in code");
});

configs.forEach(function (c) {
  test("world " + c.name + " is identical to the pre-extraction output", function () {
    var got = D.digestWorld(build(c));
    var want = golden[c.name];
    assert.ok(want, "golden entry exists");
    var changed = Object.keys(want).filter(function (field) { return got[field] !== want[field]; });
    assert.deepStrictEqual(changed, [], c.name + ": fields changed: " + changed.join(", "));
  });
});

test("the same parameters always give the same world", function () {
  var c = configs[0];
  assert.deepStrictEqual(D.digestWorld(build(c)), D.digestWorld(build(c)));
});

test("a different seed gives a different world", function () {
  var a = D.digestWorld(build(configs[0]));
  var b = D.digestWorld(build(Object.assign({}, configs[0], { seed: 2 })));
  assert.notStrictEqual(a.heights, b.heights);
});

console.log("\n" + passed + " passed");
