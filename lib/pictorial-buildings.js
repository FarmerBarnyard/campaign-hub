// Pictorial building-icon renderer.
//
// Second pass: the first version (flat two-tone rect + a faint wobble
// outline) was called out directly by the account owner as "not anywhere
// near the artistic flair nor structure of WotC" -- confirmed by pulling
// an actual Mike Schley Phandalin map and cropping in on individual
// buildings rather than working from memory. What that crop actually
// shows, that the first pass didn't have: the roof visibly OVERHANGS the
// wall on every side (a thin pale wall strip peeks out past the eave), a
// small triangular gable cap pokes past each end of the ridge (the roof's
// end wall, seen from above), and the whole shape is bounded by a crisp,
// fully-opaque ink outline -- not a faint 55%-alpha line. No constraint on
// per-building draw-call cost here (explicitly waived): this is still far
// cheaper than a per-building paintWatercolorWash (lib/watercolor-wash.js,
// 24-28 layers), but no longer trying to hit some old ~2-draw-call budget
// either.

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

function fillTri(ctx, x0, y0, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.fill();
}

// rect = {cx, cy, angle}, w/h = already-final drawn dimensions (post
// shrink/cap -- same contract the old drawFootprintRect returned).
// opts: { baseColor, ink, rng, wallColor? } -- `rng` is required and
// should be drawn from the caller's own per-generate() seeded stream (not
// a fresh Math.random stream), so results stay seed-reproducible like
// everything else in this app's generators. `wallColor` lets a caller
// give every building the same pale wall tone regardless of roof color
// (matching reference maps, where walls read as a consistent cream/tan no
// matter what the roof is) -- falls back to a pale wash of the roof tone
// if omitted.
function drawPictorialBuilding(ctx, rect, w, h, opts) {
  const { baseColor, ink, rng, wallColor } = opts;
  const roofTone = jitterPictorialColor(baseColor, rng, 16);
  const lightRoof = shadePictorialColor(roofTone, 0.22 + rng() * 0.06);
  const darkRoof = shadePictorialColor(roofTone, -0.24 - rng() * 0.06);
  const wall = wallColor || shadePictorialColor(roofTone, 0.62);

  ctx.save();
  ctx.translate(rect.cx, rect.cy);
  ctx.rotate(rect.angle);

  const horizontal = w >= h;
  const overhang = Math.max(1.4, Math.min(w, h) * 0.1);
  const rw = w + overhang * 2, rh = h + overhang * 2;

  // Wall footprint, drawn at the UNDERSIZED (pre-overhang) dimensions --
  // the roof below is drawn larger, so a thin strip of this wall tone
  // peeks out past the eave line on every side.
  ctx.fillStyle = wall;
  ctx.fillRect(-w / 2, -h / 2, w, h);

  // Roof: two shaded planes split along the ridge (the long axis) --
  // still a flat light/dark read rather than a gradient (matching this
  // app's gradient-free icon convention), but with a bigger footprint
  // than the wall and a stronger light/dark split than the first pass.
  ctx.fillStyle = lightRoof;
  if (horizontal) ctx.fillRect(-rw / 2, -rh / 2, rw, rh / 2);
  else ctx.fillRect(-rw / 2, -rh / 2, rw / 2, rh);
  ctx.fillStyle = darkRoof;
  if (horizontal) ctx.fillRect(-rw / 2, 0, rw, rh / 2);
  else ctx.fillRect(0, -rh / 2, rw / 2, rh);

  // Gable caps: a small triangular ridge-cap poking past each end of the
  // ridge line -- reads as the roof's own end wall seen from above,
  // exactly the silhouette a real WotC building icon uses instead of a
  // plain rectangle.
  const cap = Math.min(rw, rh) * 0.26;
  ctx.fillStyle = darkRoof;
  if (horizontal) {
    fillTri(ctx, -rw / 2, -rh / 2, -rw / 2, rh / 2, -rw / 2 - cap, 0);
    fillTri(ctx, rw / 2, -rh / 2, rw / 2, rh / 2, rw / 2 + cap, 0);
  } else {
    fillTri(ctx, -rw / 2, -rh / 2, rw / 2, -rh / 2, 0, -rh / 2 - cap);
    fillTri(ctx, -rw / 2, rh / 2, rw / 2, rh / 2, 0, rh / 2 + cap);
  }

  // Ridge line, crisp and fully opaque (the first pass's 55%-alpha line
  // read as barely-there against the roof shading -- a real ridge line
  // is one of the strongest marks on a reference building).
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  if (horizontal) { ctx.moveTo(-rw / 2 - cap, 0); ctx.lineTo(rw / 2 + cap, 0); } else { ctx.moveTo(0, -rh / 2 - cap); ctx.lineTo(0, rh / 2 + cap); }
  ctx.stroke();

  // Hand-painted wobbled outline around the roof's own silhouette
  // (jitterPolygon over the roof rect's 4 corners plus the two gable
  // tips) -- crisp and fully opaque now, not the old faint 60%-alpha
  // wash-only line.
  const corners = horizontal
    ? [{ x: -rw / 2, y: -rh / 2 }, { x: rw / 2, y: -rh / 2 }, { x: rw / 2 + cap, y: 0 }, { x: rw / 2, y: rh / 2 }, { x: -rw / 2, y: rh / 2 }, { x: -rw / 2 - cap, y: 0 }]
    : [{ x: -rw / 2, y: -rh / 2 }, { x: 0, y: -rh / 2 - cap }, { x: rw / 2, y: -rh / 2 }, { x: rw / 2, y: rh / 2 }, { x: 0, y: rh / 2 + cap }, { x: -rw / 2, y: rh / 2 }];
  const variance = Math.max(0.6, Math.min(rw, rh) * 0.05);
  const wobbled = jitterPolygon(corners, rng, variance, 2);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(wobbled[0].x, wobbled[0].y);
  for (let i = 1; i < wobbled.length; i++) ctx.lineTo(wobbled[i].x, wobbled[i].y);
  ctx.closePath();
  ctx.stroke();

  ctx.restore();
}
