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
    // Clamped on BOTH ends -- callers are only guaranteed x,y in [0, latW-1]
    // / [0, latH-1] for the plain isotropic samplers above, but
    // makeAnisotropicSampler below can query well outside that range (a
    // rotated, stretched coordinate frame pushes some points past the unit
    // square). Without a lower clamp, a negative x0/y0 silently indexes
    // `lattice` with a negative or out-of-bounds index, reading `undefined`
    // and throwing inside the very next property access.
    const x0 = Math.max(0, Math.min(latW - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(latH - 1, Math.floor(y)));
    const x1 = Math.min(x0 + 1, latW - 1), y1 = Math.min(y0 + 1, latH - 1);
    const sx = smoothstep(Math.max(0, Math.min(1, x - x0))), sy = smoothstep(Math.max(0, Math.min(1, y - y0)));
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

// Ridged multifractal (Perlin/Musgrave): folds each octave's smooth value
// noise into a sharp crease along its zero-crossings (`1 - abs(2n-1)`),
// then weights each successive octave by how strong the PREVIOUS octave's
// ridge already was at that point -- real ridgelines connect into
// continuous lines this way, rather than scattering as isolated peaks the
// way thresholding plain isotropic FBM does (every peak is just wherever
// unrelated noise happens to be locally high, with nothing tying
// neighboring peaks into a range). This is the standard technique for
// mountain-range-like terrain, not a home-grown approximation -- verified
// here by testing the actual output (does it read as a connected ridge
// line?), the same "well-established, testable" bar as the hydraulic
// erosion technique already in this codebase.
function makeRidgedFbmSampler(rng, octaves) {
  const octaveNoises = [];
  let amp = 1, maxAmp = 0;
  for (let o = 0; o < octaves; o++) {
    const latW = 3 + o * 2, latH = 3 + o * 2;
    octaveNoises.push({ noise: makeValueNoise2D(rng, latW, latH), latW, latH, amp });
    maxAmp += amp;
    amp *= 0.55;
  }
  return function sample(u, v) {
    let val = 0, weight = 1;
    for (const oct of octaveNoises) {
      let n = oct.noise(u * (oct.latW - 1), v * (oct.latH - 1));
      n = 1 - Math.abs(2 * n - 1);
      n *= n;
      n *= weight;
      weight = Math.max(0, Math.min(1, n * 2.2));
      val += n * oct.amp;
    }
    return val / maxAmp;
  };
}

// Samples `baseSampler` through a rotated, stretched coordinate frame --
// stretching one axis compresses that axis's features together (reading as
// elongated along the OTHER axis), so a ridged-noise field sampled through
// this reads as a mountain range with a real long axis in a random
// direction per seed, instead of isotropic (equally "wide" in every
// direction, hence blob-like) terrain.
function makeAnisotropicSampler(baseSampler, angle, stretchAlong, stretchAcross) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return function (u, v) {
    const du = u - 0.5, dv = v - 0.5;
    const ru = du * cos + dv * sin;
    const rv = -du * sin + dv * cos;
    return baseSampler(0.5 + ru * stretchAlong, 0.5 + rv * stretchAcross);
  };
}

// A wobbly per-angle radius multiplier -- sum of a handful of sine
// harmonics at random phase/amplitude, integer frequencies so the result
// tiles smoothly over a full turn (theta and theta+2*PI must agree).
// Multiplying a base falloff radius by this instead of using a fixed
// circular radius is what turns "perfectly round island" into a coastline
// with real large-scale bays and headlands -- deliberately much lower
// frequency than the fine erosion-driven height noise, so it governs the
// landmass's GROSS shape while erosion/value-noise still governs local
// coastline detail on top of it.
function makeRadialWobbleSampler(rng, harmonics) {
  harmonics = harmonics || 6;
  const terms = [];
  for (let i = 0; i < harmonics; i++) {
    terms.push({ freq: i + 2, phase: rng() * Math.PI * 2, amp: (1 / (i + 1)) * (0.5 + rng() * 0.5) });
  }
  let maxAmp = 0;
  for (const t of terms) maxAmp += t.amp;
  return function (theta) {
    let v = 0;
    for (const t of terms) v += Math.sin(t.freq * theta + t.phase) * t.amp;
    return v / maxAmp;
  };
}
