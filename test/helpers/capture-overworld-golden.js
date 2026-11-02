// Regenerates test/fixtures/overworld-golden.json with the portable maths the overworld test uses.
// Only run this after an INTENDED change to the world builder, and review the diff by field name.
//
//   node test/helpers/capture-overworld-golden.js

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var H = require("./world-context.js");
var D = require("./world-digest.js");
var PM = require("./portable-math.js");
var configs = require("./world-configs.js");

var ctx = H.createContext().context;
PM.install(vm, ctx);
var out = {};
configs.forEach(function (c) {
  ctx.__p = { seed: c.seed, cellCount: c.cells, octaves: c.octaves, island: c.island, seaLevel: c.sea, riversOn: c.rivers, settleCount: c.settle };
  out[c.name] = D.digestWorld(vm.runInContext("buildOverworldWorld(__p, " + c.width + ", " + c.height + ")", ctx));
  console.log("captured " + c.name);
});
if (PM.nativeFallbacks() !== 0) throw new Error("portable maths fell back to the engine's own functions");
fs.writeFileSync(path.join(__dirname, "..", "fixtures", "overworld-golden.json"), JSON.stringify(out, null, 1) + "\n");
