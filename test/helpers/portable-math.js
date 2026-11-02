// Portable sin, cos and atan2 for the overworld tests.
//
// The JavaScript spec lets Math.sin, Math.cos and Math.atan2 differ in the last bit between engines, and
// V8 builds do differ (Electron's V8 and Node 24's V8 disagree on some inputs). The world builder feeds
// these into its terrain, so the same seed can give a slightly different world on another engine. The
// golden fingerprints in fixtures/overworld-golden.json must not depend on which engine runs the test,
// so the tests replace these three functions, inside the test's own vm context only, with the classic
// fdlibm routines (the reference implementation V8 itself used before it moved to platform maths).
// The generator under lib/ is untouched. Only the three functions the builder uses are ported.
//
//   node test/helpers/portable-math.js     prints a self-check against the host Math

var buf = new DataView(new ArrayBuffer(8));
function hiWord(x) { buf.setFloat64(0, x); return buf.getInt32(0); }
function loWord(x) { buf.setFloat64(0, x); return buf.getUint32(4); }
function fromWords(hi, lo) { buf.setUint32(0, hi >>> 0); buf.setUint32(4, lo >>> 0); return buf.getFloat64(0); }

var S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
var C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
var invpio2 = 6.36619772367581382433e-01, pio2_1 = 1.57079632673412561417e+00, pio2_1t = 6.07710050650619224932e-11,
  pio2_2 = 6.07710050630396597660e-11, pio2_2t = 2.02226624879595063154e-21, pio2_3 = 2.02226624871116645580e-21,
  pio2_3t = 8.47842766036889956997e-32;

var npio2Hw = [];
for (var q = 1; q <= 32; q++) npio2Hw.push(hiWord(q * Math.PI / 2));

var nativeFallbacks = 0;

function kernelSin(x, y, iy) {
  var ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000 && Math.trunc(x) === 0) return x;
  var z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

function kernelCos(x, y) {
  var ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000 && Math.trunc(x) === 0) return 1;
  var z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  var qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  var hz = 0.5 * z - qx, a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

// Returns [n, y0, y1], or null when |x| is too large for the Cody-Waite reduction used here.
function remPio2(x) {
  var hx = hiWord(x), ix = hx & 0x7fffffff, z, y0, y1;
  if (ix <= 0x3fe921fb) return [0, x, 0];
  if (ix < 0x4002d97c) {
    if (hx > 0) {
      z = x - pio2_1;
      if (ix !== 0x3ff921fb) { y0 = z - pio2_1t; y1 = (z - y0) - pio2_1t; }
      else { z -= pio2_2; y0 = z - pio2_2t; y1 = (z - y0) - pio2_2t; }
      return [1, y0, y1];
    }
    z = x + pio2_1;
    if (ix !== 0x3ff921fb) { y0 = z + pio2_1t; y1 = (z - y0) + pio2_1t; }
    else { z += pio2_2; y0 = z + pio2_2t; y1 = (z - y0) + pio2_2t; }
    return [-1, y0, y1];
  }
  if (ix > 0x413921fb) return null;
  var t = Math.abs(x), n = Math.trunc(t * invpio2 + 0.5), fn = n;
  var r = t - fn * pio2_1, w = fn * pio2_1t;
  if (n < 32 && ix !== npio2Hw[n - 1]) {
    y0 = r - w;
  } else {
    var j = ix >> 20;
    y0 = r - w;
    var i = j - ((hiWord(y0) >> 20) & 0x7ff);
    if (i > 16) {
      t = r; w = fn * pio2_2; r = t - w; w = fn * pio2_2t - ((t - r) - w); y0 = r - w;
      i = j - ((hiWord(y0) >> 20) & 0x7ff);
      if (i > 49) { t = r; w = fn * pio2_3; r = t - w; w = fn * pio2_3t - ((t - r) - w); y0 = r - w; }
    }
  }
  y1 = (r - y0) - w;
  if (hx < 0) return [-n, -y0, -y1];
  return [n, y0, y1];
}

function sin(x) {
  var ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  if (ix >= 0x7ff00000) return NaN;
  var red = remPio2(x);
  if (!red) { nativeFallbacks++; return Math.sin(x); }
  switch (red[0] & 3) {
    case 0: return kernelSin(red[1], red[2], 1);
    case 1: return kernelCos(red[1], red[2]);
    case 2: return -kernelSin(red[1], red[2], 1);
    default: return -kernelCos(red[1], red[2]);
  }
}

function cos(x) {
  var ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  var red = remPio2(x);
  if (!red) { nativeFallbacks++; return Math.cos(x); }
  switch (red[0] & 3) {
    case 0: return kernelCos(red[1], red[2]);
    case 1: return -kernelSin(red[1], red[2], 1);
    case 2: return -kernelCos(red[1], red[2]);
    default: return kernelSin(red[1], red[2], 1);
  }
}

var atanhi = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
var atanlo = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
var aT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];

function atan(x) {
  var hx = hiWord(x), ix = hx & 0x7fffffff, id;
  if (ix >= 0x44100000) {
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && loWord(x) !== 0)) return x + x;
    return hx > 0 ? atanhi[3] + atanlo[3] : -atanhi[3] - atanlo[3];
  }
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e200000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) { id = 0; x = (2.0 * x - 1) / (2.0 + x); }
      else { id = 1; x = (x - 1) / (x + 1); }
    } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); }
    else { id = 3; x = -1.0 / x; }
  }
  var z = x * x, w = z * z;
  var s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))));
  var s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  z = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x);
  return hx < 0 ? -z : z;
}

var tiny = 1e-300, piO2 = 1.5707963267948965580e+00, piC = 3.1415926535897931160e+00, piLo = 1.2246467991473531772e-16;

function atan2(y, x) {
  if (x !== x || y !== y) return x + y;
  var hx = hiWord(x), lx = loWord(x), ix = hx & 0x7fffffff;
  var hy = hiWord(y), ly = loWord(y), iy = hy & 0x7fffffff;
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y);
  var m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if ((iy | ly) === 0) {
    switch (m) { case 0: case 1: return y; case 2: return piC + tiny; default: return -piC - tiny; }
  }
  if ((ix | lx) === 0) return hy < 0 ? -piO2 - tiny : piO2 + tiny;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) { case 0: return piC / 4 + tiny; case 1: return -piC / 4 - tiny; case 2: return 3.0 * piC / 4 + tiny; default: return -3.0 * piC / 4 - tiny; }
    }
    switch (m) { case 0: return 0; case 1: return -0; case 2: return piC + tiny; default: return -piC - tiny; }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -piO2 - tiny : piO2 + tiny;
  var k = (iy - ix) >> 20, z;
  if (k > 60) { z = piO2 + 0.5 * piLo; m &= 1; }
  else if (hx < 0 && k < -60) z = 0.0;
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return piC - (z - piLo);
    default: return (z - piLo) - piC;
  }
}

// Replaces Math.sin, Math.cos and Math.atan2 inside one vm context (the host's Math is not touched).
function install(vm, context) {
  context.__portableMath = { sin: sin, cos: cos, atan2: atan2 };
  vm.runInContext("Math.sin = __portableMath.sin; Math.cos = __portableMath.cos; Math.atan2 = __portableMath.atan2;", context);
  delete context.__portableMath;
}

module.exports = { sin: sin, cos: cos, atan2: atan2, install: install, nativeFallbacks: function () { return nativeFallbacks; } };

if (require.main === module) {
  var crypto = require("crypto");
  var h = function (a) { return crypto.createHash("sha256").update(Buffer.from(a.buffer)).digest("hex").slice(0, 12); };
  var f = new Float64Array(2000), k2 = 0;
  for (var i = 1; i <= 1000; i++) { f[k2++] = sin(i * 0.37 + 0.11); f[k2++] = cos(i * 0.91 + 0.29); }
  var g = new Float64Array(1000);
  for (var j = 0; j < 1000; j++) g[j] = atan2(j * 0.7 - 300, 500 - j * 1.3);
  var maxUlp = 0, bad = 0;
  for (var a = -20; a <= 20; a += 0.0137) {
    var d = Math.abs(sin(a) - Math.sin(a)) + Math.abs(cos(a) - Math.cos(a));
    if (d > 4e-16) bad++;
    maxUlp = Math.max(maxUlp, d);
  }
  console.log("portable trig " + h(f) + " atan2 " + h(g) + " maxDiffVsHost " + maxUlp + " over4e-16=" + bad + " fallbacks=" + nativeFallbacks);
}
