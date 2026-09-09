// Organic road/path renderer.
//
// Second pass: the first version filled a smoothed, soft-edged ribbon --
// closer to WotC than the original flat 2px stroke, but a real Mike
// Schley road (confirmed by cropping into an actual Phandalin export)
// is NOT a filled shape at all. It's two independently-wobbled thin pale
// lines with sparse perpendicular cross-ticks between them -- a "worn
// track" drawn the way a human cartographer would actually ink a path,
// with the ground's own texture still showing through the middle. Rivers
// are the one surface that stays a filled ribbon below (real reference
// rivers ARE painted solid), now with a pale current-line texture down
// the centerline instead of a flat fill.

// Builds a ribbon polygon (a left-side point array + a right-side point
// array) by offsetting each smoothed centerline point perpendicular to
// its local tangent (averaged incoming/outgoing segment direction, so
// corners don't pinch), with small per-point width jitter so the two
// edges independently wobble rather than staying perfectly parallel.
function buildRoadRibbon(points, width, rng, wobbleAmount) {
  const left = [], right = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const w = (width / 2) * (1 + (rng() - 0.5) * 2 * wobbleAmount);
    left.push({ x: points[i].x + nx * w, y: points[i].y + ny * w });
    right.push({ x: points[i].x - nx * w, y: points[i].y - ny * w });
  }
  return { left, right };
}

function strokeRiverRibbon(ctx, smoothed, opts) {
  const { color, edgeColor, width, rng } = opts;
  const { left, right } = buildRoadRibbon(smoothed, width, rng, 0.15);
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = edgeColor;
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Pale "current" highlight down the centerline -- the wavy-line water
  // texture reference rivers use instead of a flat, texture-less fill.
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = Math.max(1, width * 0.12);
  ctx.beginPath();
  ctx.moveTo(smoothed[0].x, smoothed[0].y);
  for (let i = 1; i < smoothed.length; i++) ctx.lineTo(smoothed[i].x, smoothed[i].y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// points: [{x,y}, ...] centerline (2+ points, world space).
// opts: { color, edgeColor, width, rng, surface }. `surface`
// ('dirt'|'stone'|'water', default 'stone') -- 'water' (the settlement
// river feature) keeps the filled-ribbon treatment above; 'dirt'/'stone'
// draw the double-line worn-track treatment, with dirt lanes wobbling
// more and cross-ticking less often (a rougher, less-maintained path)
// than paved stone streets. `color` drives the two edge lines/ticks
// (every theme already picks a pale street tone for this); `edgeColor`
// is only used by the water/river branch.
function strokeOrganicRoad(ctx, points, opts) {
  if (points.length < 2) return;
  const { color, edgeColor, width, rng, surface } = opts;
  const smoothed = chaikinSmooth(points, 2);

  if (surface === 'water') {
    strokeRiverRibbon(ctx, smoothed, opts);
    return;
  }

  const wobbleAmount = surface === 'dirt' ? 0.3 : 0.14;
  const tickChance = surface === 'dirt' ? 0.35 : 0.55;
  const { left, right } = buildRoadRibbon(smoothed, width, rng, wobbleAmount);

  // A faint pale wash between the two edges -- trodden bare ground, not
  // empty space, but still visibly lighter than the two crisp lines
  // bounding it.
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1;

  // The two edge lines themselves, each independently wobbled (built
  // into `left`/`right` above already) -- this, not the fill, is what
  // actually reads as "a road" at a glance.
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  function strokeSide(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  strokeSide(left);
  strokeSide(right);

  // Cross-ticks: short perpendicular marks between the two edges at
  // sparse, irregular intervals -- the "worn track" texture cue every
  // reference road actually uses instead of a filled ribbon.
  ctx.lineWidth = 1;
  for (let i = 0; i < left.length; i += 2) {
    if (rng() > tickChance) continue;
    ctx.beginPath();
    ctx.moveTo(left[i].x, left[i].y);
    ctx.lineTo(right[i].x, right[i].y);
    ctx.stroke();
  }
}
