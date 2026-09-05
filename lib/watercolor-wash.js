// Tyler Hobbs-style layered watercolor wash (tylerxhobbs.com, "A Guide to
// Simulating Watercolor Paint with Generative Art"), scaled down for this
// project's per-region (not per-cell, not per-hero-shape) use: a boundary
// polygon gets several differently-jittered copies of itself stacked at low
// alpha using standard source-over blending -- NOT multiply, which
// converges every low-alpha layer toward a flat mid-tone regardless of
// per-layer hue variance -- then a texture-mask pass of small semi-
// transparent circles (multiply/lighten) breaks the resulting wash into a
// mottled, painterly texture instead of a uniform tint. Validated against a
// standalone prototype (both a landmass-scale and a hill-region-scale
// shape) before being wired in here; see the map-generator plan doc for the
// research and the two bugs that prototype caught (wrong blend mode on the
// layer stack; fixed-pixel texture-circle radius looking oversized on a
// small shape) and how they were fixed below.

function gaussianSample(rng) {
  const u1 = Math.max(1e-9, rng()), u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Recursive Gaussian-midpoint-displacement over a closed polygon loop --
// the same "walk each edge, insert a new point" shape as chaikinSmooth in
// voronoi-mesh.js, but displacing the midpoint by noise instead of cutting
// corners deterministically, so each call produces a differently-wobbled
// silhouette of the same underlying boundary.
function jitterPolygon(poly, rng, variance, depth) {
  if (depth <= 0 || poly.length < 3) return poly;
  const next = [];
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i], p1 = poly[(i + 1) % poly.length];
    next.push(p0);
    next.push({
      x: (p0.x + p1.x) / 2 + gaussianSample(rng) * variance,
      y: (p0.y + p1.y) / 2 + gaussianSample(rng) * variance,
    });
  }
  return jitterPolygon(next, rng, variance * 0.55, depth - 1);
}

function polygonBounds(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function strokePolygonPath(ctx, poly) {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

// `boundary` need not already be a closed loop -- an open coastline-style
// chain (a region touching the canvas edge) is closed here by simply
// connecting its last point back to its first, the same low-stakes
// approximation extractCoastlineChains itself already accepts at the map's
// outer border. `hsl` is the wash's base {h, s, l} tone (see
// map-themes.js's `wash` palette); `ink` is the theme's own ink color, used
// for a crisp outline on top of the wash so the region still reads as a
// bordered shape rather than a fuzzy cloud with no edge.
function paintWatercolorWash(ctx, boundary, rng, hsl, ink, layers) {
  if (boundary.length < 3) return;
  layers = layers || 25;
  const bounds = polygonBounds(boundary);
  const span = Math.max(1, Math.min(bounds.width, bounds.height));

  // A solid, fully-opaque fill of the exact (smoothed) boundary first --
  // the caller's underlying per-cell flat fill still has each cell's own
  // sharp Voronoi edges, and a smoothed boundary curves slightly *inside*
  // those corners, so without this base fill a jagged sliver of the
  // original hard-edged color peeks out past the smoothed/jittered wash
  // above it. This also gives the translucent layers below a correctly-
  // colored, fully-opaque backdrop instead of whatever the per-cell fill
  // happened to be, which matters for how the layer stack's average color
  // reads (see the light-variance note below).
  ctx.fillStyle = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
  strokePolygonPath(ctx, boundary);
  ctx.fill();

  const variance = Math.max(2, span * 0.05);
  for (let i = 0; i < layers; i++) {
    const jittered = jitterPolygon(boundary, rng, variance, 4);
    const h = hsl.h + (rng() - 0.5) * 36;
    const s = Math.max(20, hsl.s + (rng() - 0.5) * 28);
    const l = hsl.l + (rng() - 0.5) * 16;
    ctx.fillStyle = `hsla(${h}, ${s}%, ${l}%, 0.09)`;
    strokePolygonPath(ctx, jittered);
    ctx.fill();
  }

  // Texture-mask circles: radius is a *fraction of the shape's own span*,
  // not a fixed pixel range -- a fixed range that reads fine on a large
  // landmass shows up as oversized, disconnected blobs on a much smaller
  // hill/forest region (the bug the Step 0 prototype caught).
  //
  // `lighten` mode takes the brighter of the two colors on every overlap,
  // so unlike `multiply` (which is self-limiting -- it can only darken) a
  // few hundred overlapping lighten circles keep ratcheting the result
  // brighter with no ceiling. Kept deliberately rare, dim, and capped well
  // below white -- an earlier tuning at 28% chance / shade 200-230 washed
  // every biome using this function out to a pale, low-contrast smudge
  // against its neighbors (caught only after shipping, not during the
  // Step 0 prototype review, which happened to test shapes where the
  // paling read as acceptable "watercolor fade" rather than "lost the
  // biome").
  const minR = Math.max(1.5, span * 0.02);
  const maxR = Math.max(minR + 1, span * 0.07);
  const circleCount = Math.round((bounds.width * bounds.height) / 70);
  for (let i = 0; i < circleCount; i++) {
    const cx = bounds.minX + rng() * bounds.width;
    const cy = bounds.minY + rng() * bounds.height;
    const r = minR + rng() * (maxR - minR);
    if (rng() < 0.85) {
      ctx.globalCompositeOperation = 'multiply';
      const shade = 150 + rng() * 60;
      ctx.fillStyle = `rgba(${shade | 0},${shade | 0},${shade | 0},0.1)`;
    } else {
      ctx.globalCompositeOperation = 'lighten';
      const shade = 190 + rng() * 20;
      ctx.fillStyle = `rgba(${shade | 0},${shade | 0},${shade | 0},0.04)`;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.2;
  strokePolygonPath(ctx, boundary);
  ctx.stroke();
  ctx.globalAlpha = 1;
}
