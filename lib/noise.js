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
// doubling frequency / halving amplitude, normalized back to [0,1].
function fbm(rng, width, height, octaves) {
  const field = [];
  for (let y = 0; y < height; y++) field.push(new Float64Array(width));
  let maxAmp = 0;
  let amp = 1;
  for (let o = 0; o < octaves; o++) {
    const latW = 3 + o * 2;
    const latH = 3 + o * 2;
    const noise = makeValueNoise2D(rng, latW, latH);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = (x / width) * (latW - 1);
        const ny = (y / height) * (latH - 1);
        field[y][x] += noise(nx, ny) * amp;
      }
    }
    maxAmp += amp;
    amp *= 0.5;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) field[y][x] /= maxAmp;
  }
  return field;
}
