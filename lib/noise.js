// Seedable PRNG (mulberry32) + hand-rolled value-noise / fractal-Brownian-motion.
// No external libraries -- this environment has no npm/Node to install one.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(t) { return t * t * (3 - 2 * t); }

function makeValueNoise2D(rng, latW, latH) {
  const lattice = [];
  for (let y = 0; y < latH; y++) {
    const row = [];
    for (let x = 0; x < latW; x++) row.push(rng());
    lattice.push(row);
  }
  return function (x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, latW - 1), y1 = Math.min(y0 + 1, latH - 1);
    const sx = smoothstep(x - x0), sy = smoothstep(y - y0);
    const top = lattice[y0][x0] * (1 - sx) + lattice[y0][x1] * sx;
    const bot = lattice[y1][x0] * (1 - sx) + lattice[y1][x1] * sx;
    return top * (1 - sy) + bot * sy;
  };
}

// Fractal-Brownian-motion by hand: sum several octaves of value noise at
// doubling frequency / halving amplitude, normalized back to [0,1]. Returns
// a continuous `sample(u, v)` closure over normalized [0,1] coordinates
// (not a raster array) -- the underlying makeValueNoise2D lattices already
// support continuous sampling, so a caller can query it at arbitrary points
// (e.g. a Voronoi cell's centroid) rather than only at fixed grid indices.
function makeFbmSampler(rng, octaves) {
  const octaveNoises = [];
  let maxAmp = 0;
  let amp = 1;
  for (let o = 0; o < octaves; o++) {
    const latW = 3 + o * 2;
    const latH = 3 + o * 2;
    octaveNoises.push({ noise: makeValueNoise2D(rng, latW, latH), latW, latH, amp });
    maxAmp += amp;
    amp *= 0.5;
  }
  return function sample(u, v) {
    let val = 0;
    for (const oct of octaveNoises) {
      val += oct.noise(u * (oct.latW - 1), v * (oct.latH - 1)) * oct.amp;
    }
    return val / maxAmp;
  };
}
