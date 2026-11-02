// A compact, order-stable fingerprint of a built overworld world: one SHA-256 per field, so a
// refactor that changes a single height, biome, river cell, settlement or road shows up as a named
// field mismatch instead of a vague "different". Decimals are rounded to 6 places first: builds of
// V8 can differ in the last bits of Math.sin and friends, so raw bytes differ between machines
// even when the world is the same.

var crypto = require("crypto");

// The + 0 turns -0 into 0, which has different bytes.
function round(n) { return Math.round(n * 1e6) / 1e6 + 0; }
function hashBytes(buf) { return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16); }
function typed(arr) {
  // The world is built in a vm context, so instanceof would not match this realm's Float64Array.
  if (arr.constructor.name === "Float64Array") arr = Float64Array.from(arr, round);
  return hashBytes(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
}
function text(v) {
  return hashBytes(Buffer.from(JSON.stringify(v, function (k, x) { return typeof x === "number" ? round(x) : x; })));
}

function digestWorld(w) {
  var d = {
    cols: w.cols, rows: w.rows,
    heights: typed(w.heights), mOf: typed(w.mOf), tOf: typed(w.tOf), nearRiver: typed(w.nearRiver),
    refBiomeOf: text(Array.prototype.slice.call(w.refBiomeOf)),
    regionOf: text(Array.prototype.slice.call(w.regionOf)),
    regionCategory: text(w.regionCategory),
    settlements: text(w.settlements.map(function (s) { return [s.x, s.y, s.index, s.tier, s.name, s.score]; })),
    roadPaths: text(w.roadPaths),
    landmarks: text(w.landmarks),
    wetlowlandOf: typed(w.wetlowlandOf),
    regionZoneOf: text(w.regionZoneOf),
    riverThreshold: String(round(w.riverThreshold)),
    largestLakeId: w.largestLakeId,
  };
  d.flow = w.flow ? typed(w.flow) : null;
  d.downhill = w.downhill ? typed(w.downhill) : null;
  d.isLake = w.isLake ? typed(w.isLake) : null;
  d.lakeIdOf = w.lakeIdOf ? typed(w.lakeIdOf) : null;
  d.rangeIndexOf = w.rangeIndexOf ? typed(w.rangeIndexOf) : null;
  d.rangeZoneOf = text(w.rangeZoneOf);
  return d;
}

module.exports = { digestWorld: digestWorld };
