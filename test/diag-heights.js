// TEMPORARY diagnostic: prints quantised hashes of the overworld heights and raw trig bit patterns.
var vm = require("vm");
var crypto = require("crypto");
var H = require("./helpers/world-context.js");
var configs = require("./helpers/world-configs.js");
var ctx = H.createContext().context;
function h(buf) { return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12); }
console.log("DIAG node " + process.versions.node + " v8 " + process.versions.v8 + " " + process.platform + " " + process.arch);
var f = new Float64Array(2000), k = 0;
for (var i = 1; i <= 1000; i++) { f[k++] = Math.sin(i * 0.37 + 0.11); f[k++] = Math.cos(i * 0.91 + 0.29); }
console.log("DIAG trig " + h(Buffer.from(f.buffer)));
var g = new Float64Array(1000);
for (var j = 0; j < 1000; j++) g[j] = Math.atan2(j * 0.7 - 300, 500 - j * 1.3);
console.log("DIAG atan2 " + h(Buffer.from(g.buffer)));
var p = new Float64Array(1000);
for (var m = 0; m < 1000; m++) p[m] = Math.hypot(m * 0.7 - 300, 500 - m * 1.3);
console.log("DIAG hypot " + h(Buffer.from(p.buffer)));
configs.forEach(function (c) {
  ctx.__p = { seed: c.seed, cellCount: c.cells, octaves: c.octaves, island: c.island, seaLevel: c.sea, riversOn: c.rivers, settleCount: c.settle };
  var w = vm.runInContext("buildOverworldWorld(__p, " + c.width + ", " + c.height + ")", ctx);
  var line = "DIAG " + c.name + " raw=" + h(Buffer.from(w.heights.buffer, w.heights.byteOffset, w.heights.byteLength));
  [3, 6, 9, 12].forEach(function (d) {
    var q = new Float64Array(w.heights.length), s = Math.pow(10, d);
    for (var i = 0; i < q.length; i++) q[i] = Math.round(w.heights[i] * s) / s;
    line += " q" + d + "=" + h(Buffer.from(q.buffer));
  });
  console.log(line);
});
