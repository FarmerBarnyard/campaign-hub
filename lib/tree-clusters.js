// Pom-pom tree clusters -- the actual WotC/Mike Schley tree convention,
// confirmed by cropping into a real Phandalin export at high zoom: a
// forest reads as a scatter of individual round, fluffy canopy clusters
// (3-6 overlapping lobes each, dark outline, a lighter highlight lobe
// near the top-left as if lit from one direction), NOT the flat triangle
// silhouette or the two-tier conifer shape this app used everywhere
// before. Replaces both of those wherever a single tree/tree-cluster icon
// is drawn (overworld forest texture, settlement garden/orchard scatter,
// landmark backdrops via renderTerrainPatch).

function clampByte(v) { return Math.max(0, Math.min(255, v)); }
function parseTreeColor(colorStr) {
  if (colorStr[0] === '#') {
    const h = colorStr.replace('#', '');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  const m = colorStr.match(/[\d.]+/g);
  return { r: +m[0], g: +m[1], b: +m[2] };
}
function shadeTreeColor(colorStr, amount) {
  const c = parseTreeColor(colorStr);
  const mix = (v) => (amount >= 0 ? v + (255 - v) * amount : v + v * amount);
  return `rgb(${clampByte(mix(c.r))},${clampByte(mix(c.g))},${clampByte(mix(c.b))})`;
}

// cx/cy: cluster center. r: overall cluster radius (a single tree is a
// small r; a "stand" of trees just calls this multiple times with jittered
// centers, same as the old per-cell forest scatter already did). tone:
// the canopy's base color -- callers pass the theme's own forest wash
// tone rather than this file inventing a color. ink: outline color.
function drawTreeCluster(ctx, cx, cy, r, rng, tone, ink) {
  const lobeCount = 3 + Math.floor(rng() * 4); // 3-6
  const lobes = [];
  for (let i = 0; i < lobeCount; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * r * 0.4;
    lobes.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: r * (0.45 + rng() * 0.3) });
  }
  const darkTone = shadeTreeColor(tone, -0.3);
  const lightTone = shadeTreeColor(tone, 0.32);

  // Base silhouette (slightly oversized, darkest tone) -- this is what
  // gives the cluster a single continuous dark edge instead of each lobe
  // showing its own separate outline where they overlap.
  ctx.fillStyle = darkTone;
  for (const l of lobes) { ctx.beginPath(); ctx.arc(l.x, l.y, l.r * 1.1, 0, Math.PI * 2); ctx.fill(); }

  // Main canopy fill.
  ctx.fillStyle = tone;
  for (const l of lobes) { ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2); ctx.fill(); }

  // Highlight lobe, offset toward the upper-left of each lobe (a single
  // fixed "light direction" convention, same as every reference tree
  // cluster studied) -- this alone is most of what makes the cluster read
  // as a rounded, lit canopy instead of a flat blob.
  ctx.fillStyle = lightTone;
  for (const l of lobes) {
    ctx.beginPath();
    ctx.arc(l.x - l.r * 0.28, l.y - l.r * 0.28, l.r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // One shared ink outline traced around the union silhouette (each
  // lobe's own edge, at the un-oversized radius) -- overlapping strokes
  // here read as a slightly thicker, more organic line where lobes meet,
  // which matches the reference's own look rather than looking like a
  // rendering artifact.
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.1;
  for (const l of lobes) { ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2); ctx.stroke(); }
}

// A whole stand of trees scattered within a radius of (cx, cy) -- the
// usual call a forest-texture pass makes (one stand per sample point)
// rather than one cluster per call.
function drawTreeStand(ctx, cx, cy, spread, count, rng, tone, ink) {
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2, d = rng() * spread;
    const r = spread * (0.22 + rng() * 0.16);
    drawTreeCluster(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, rng, tone, ink);
  }
}
