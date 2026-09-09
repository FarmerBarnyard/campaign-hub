// Pictorial building-icon renderer -- a drop-in replacement for the plain
// rotated-rectangle-plus-outline treatment (views/map-settlement.js's old
// drawFootprintRect+drawRoofRidge pair), built to close the single biggest
// gap found when cross-referencing this project's town generator against
// real WotC (Mike Schley) town maps: every building in this app was a flat
// single-tone rectangle, while every real reference (Phandalin, Red Larch,
// Daggerford, Neverwinter) shows individually-shaded, softly-outlined
// pictorial buildings.
//
// Deliberately NOT a full per-building paintWatercolorWash (see
// lib/watercolor-wash.js) -- that costs 24-28 jittered-fill layers plus a
// texture-circle scatter PER CALL, which at ~200 buildings on a city map
// would be a 100x+ cost jump over today's ~2 draw calls per building. This
// does the same "soft edge + tonal variety" job with ONE jitterPolygon
// call and a flat two-tone roof split instead -- a deliberate, explicit
// engineering tradeoff (documented here so a future reader doesn't wonder
// why this doesn't just call paintWatercolorWash).

// Approximates the per-region HSL-jitter technique paintWatercolorWash
// uses, but as simple per-channel RGB jitter -- avoids needing a full
// hex<->HSL round-trip helper for a one-shot per-building nudge, same
// spirit (small random tonal variety), much cheaper. Accepts "rgb(r,g,b)"
// (what lerpBuildingColor in views/map-settlement.js already produces) or
// a "#rrggbb" hex string.
function parsePictorialColor(colorStr) {
  if (colorStr[0] === '#') {
    const h = colorStr.replace('#', '');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  const m = colorStr.match(/[\d.]+/g);
  return { r: +m[0], g: +m[1], b: +m[2] };
}
function clamp255(v) { return Math.max(0, Math.min(255, v)); }
function jitterPictorialColor(colorStr, rng, amount) {
  const c = parsePictorialColor(colorStr);
  return `rgb(${clamp255(c.r + (rng() - 0.5) * 2 * amount)},${clamp255(c.g + (rng() - 0.5) * 2 * amount)},${clamp255(c.b + (rng() - 0.5) * 2 * amount)})`;
}
// amount > 0 lightens (mixes toward 255), amount < 0 darkens (toward 0).
function shadePictorialColor(colorStr, amount) {
  const c = parsePictorialColor(colorStr);
  const mix = (v) => (amount >= 0 ? v + (255 - v) * amount : v + v * amount);
  return `rgb(${clamp255(mix(c.r))},${clamp255(mix(c.g))},${clamp255(mix(c.b))})`;
}

// rect = {cx, cy, angle}, w/h = already-final drawn dimensions (post
// shrink/cap -- same contract the old drawFootprintRect returned).
// opts: { baseColor, ink, rng } -- `rng` is required and should be drawn
// from the caller's own per-generate() seeded stream (not a fresh Math.random
// stream), so results stay seed-reproducible like everything else in this
// app's generators.
function drawPictorialBuilding(ctx, rect, w, h, opts) {
  const { baseColor, ink, rng } = opts;
  const tone = jitterPictorialColor(baseColor, rng, 12);
  const lightTone = shadePictorialColor(tone, 0.22);
  const darkTone = shadePictorialColor(tone, -0.18);

  ctx.save();
  ctx.translate(rect.cx, rect.cy);
  ctx.rotate(rect.angle);

  // Two-tone "roof": split along the building's own long axis (the same
  // axis a ridge line runs down), a light face on one side and a shadow
  // face on the other -- a flat light/dark read, not a gradient (this
  // codebase's icons are gradient-free everywhere except the whole-map
  // vignette; matching that convention deliberately rather than
  // introducing the first per-icon gradient in the app).
  const horizontal = w >= h;
  ctx.fillStyle = lightTone;
  if (horizontal) ctx.fillRect(-w / 2, -h / 2, w, h / 2);
  else ctx.fillRect(-w / 2, -h / 2, w / 2, h);
  ctx.fillStyle = darkTone;
  if (horizontal) ctx.fillRect(-w / 2, 0, w, h / 2);
  else ctx.fillRect(0, -h / 2, w / 2, h);

  // Ridge line at the light/dark seam.
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  if (horizontal) { ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); } else { ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2); }
  ctx.stroke();

  // Soft/painted outline: jitter the 4 corners (recursive Gaussian
  // midpoint displacement -- jitterPolygon, the same technique this app
  // already uses for terrain-wash edges, lib/watercolor-wash.js) instead
  // of a crisp strokeRect, so the silhouette reads as hand-drawn rather
  // than CAD-precise.
  const corners = [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];
  const variance = Math.max(0.6, Math.min(w, h) * 0.05);
  const wobbled = jitterPolygon(corners, rng, variance, 2);
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(wobbled[0].x, wobbled[0].y);
  for (let i = 1; i < wobbled.length; i++) ctx.lineTo(wobbled[i].x, wobbled[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();
}
