// Organic road/path renderer -- replaces this app's original flat, dead-
// straight, uniform-width stroke (views/map-overworld.js's inter-
// settlement roads, views/map-settlement.js's streets/lanes) with a
// smoothed, ribbon-width path that reads like a real worn track rather
// than a drafting-tool line -- the single furthest-from-WotC-reference
// element found when this project cross-referenced real Mike Schley town
// maps (Red Larch's roads are wide, soft-edged, and bend with the
// terrain; this app's were a uniform 2px straight stroke).

// Builds a ribbon polygon (a left-side point array + a right-side point
// array) by offsetting each smoothed centerline point perpendicular to
// its local tangent (averaged incoming/outgoing segment direction, so
// corners don't pinch), with small per-point width jitter so the ribbon's
// own edge isn't perfectly parallel either.
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

// points: [{x,y}, ...] centerline (2+ points, world space).
// opts: { color, edgeColor, width, rng, surface }. `surface`
// ('dirt'|'stone'|'water', default 'stone') controls how much the
// ribbon's own width wobbles and how soft its edge halo reads -- dirt
// tracks (village lanes) wobble more and read softer than paved city
// streets; water (a river channel, reused by the settlement river
// feature) gets the widest, softest treatment of the three.
function strokeOrganicRoad(ctx, points, opts) {
  if (points.length < 2) return;
  const { color, edgeColor, width, rng, surface } = opts;
  const wobbleAmount = surface === 'dirt' ? 0.22 : surface === 'water' ? 0.15 : 0.08;
  const haloAlpha = surface === 'dirt' ? 0.12 : surface === 'water' ? 0.16 : 0.15;

  const smoothed = chaikinSmooth(points, 2);
  const { left, right } = buildRoadRibbon(smoothed, width, rng, wobbleAmount);

  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  // Double-stroke halo on the ribbon's own outline -- the same wide+faint
  // then thin+crisp technique this app already uses for coastlines/
  // rivers (views/map-overworld.js, views/map-detail.js's
  // renderTerrainPatch), applied to a road edge here for the first time.
  ctx.strokeStyle = edgeColor;
  ctx.lineJoin = 'round';
  ctx.globalAlpha = haloAlpha;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;
}
