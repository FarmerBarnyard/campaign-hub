// Prints the overworld golden fingerprints for the JavaScript engine running this script, as JSON.
// Only recapture after a deliberate change to the generated world, or a Node major version change.
//
//   node test/helpers/capture-golden.js

var vm = require("vm");
var H = require("./world-context.js");
var D = require("./world-digest.js");
var configs = require("./world-configs.js");

var ctx = H.createContext().context;
var out = {};
configs.forEach(function (c) {
  ctx.__p = { seed: c.seed, cellCount: c.cells, octaves: c.octaves, island: c.island, seaLevel: c.sea, riversOn: c.rivers, settleCount: c.settle };
  out[c.name] = D.digestWorld(vm.runInContext("buildOverworldWorld(__p, " + c.width + ", " + c.height + ")", ctx));
});
console.log(JSON.stringify(out, null, 1));
