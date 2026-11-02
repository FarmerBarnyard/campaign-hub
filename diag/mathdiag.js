// Hashes each Math function over fixed inputs, and reports which pre-rounding world fields differ.
var crypto = require("crypto"), path = require("path"), vm = require("vm");
var repo = process.argv[2] || path.join(__dirname, "..");
console.log("DIAG runtime", process.version, "v8", process.versions.v8, process.platform, process.arch, "electron", process.versions.electron || "no");
function lcg(seed) { var s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
var fns = {
  sin: function (r) { return Math.sin(r() * 20 - 10); }, cos: function (r) { return Math.cos(r() * 20 - 10); },
  tan: function (r) { return Math.tan(r() * 3); }, atan2: function (r) { return Math.atan2(r() - 0.5, r() - 0.5); },
  atan: function (r) { return Math.atan(r() * 10 - 5); }, hypot: function (r) { return Math.hypot(r() * 1000, r() * 1000); },
  pow: function (r) { return Math.pow(r() * 5, r() * 5); }, exp: function (r) { return Math.exp(r() * 10 - 5); },
  log: function (r) { return Math.log(r() * 100 + 0.01); }, sqrt: function (r) { return Math.sqrt(r() * 1000); },
  starstar: function (r) { return (r() * 5) ** (r() * 5); },
};
Object.keys(fns).forEach(function (k) {
  var r = lcg(12345), a = new Float64Array(200000);
  for (var i = 0; i < a.length; i++) a[i] = fns[k](r);
  console.log("DIAG math", k, crypto.createHash("sha256").update(Buffer.from(a.buffer)).digest("hex").slice(0, 16));
});
console.log("DIAG sort", [3, 1, 2].sort().join(), "locale", ["a", "B", "c", "é", "Z"].sort(function (a, b) { return a.localeCompare(b); }).join(), "intl", Intl.DateTimeFormat().resolvedOptions().locale);
var H = require(path.join(repo, "test/helpers/world-context.js"));
var ctx = H.createContext().context;
var c = require(path.join(repo, "test/helpers/world-configs.js"))[0];
ctx.__p = { seed: c.seed, cellCount: c.cells, octaves: c.octaves, island: c.island, seaLevel: c.sea, riversOn: c.rivers, settleCount: c.settle };
var w = vm.runInContext("buildOverworldWorld(__p, " + c.width + ", " + c.height + ")", ctx);
function h(a) { return crypto.createHash("sha256").update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest("hex").slice(0, 16); }
console.log("DIAG world", c.name, "heights", h(w.heights), "mOf", h(w.mOf), "downhill", h(w.downhill));
console.log("DIAG sample", Array.prototype.slice.call(w.heights, 0, 3000).filter(function (x, i) { return i % 500 === 0; }).join(" "));
