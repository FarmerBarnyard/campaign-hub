// Halo-text labels with a leader line -- the actual WotC/Mike Schley
// building-naming convention, confirmed directly against a real Phandalin
// crop: every named building is labeled right on the map (not tucked into
// a separate numbered legend) using a serif label with a white halo
// behind the ink so it stays legible over the busy hachured ground, and a
// thin white-then-ink leader line with a small terminal dot connects the
// label back to the actual building when the label itself has to sit
// off to one side.

// Draws `text` centered at (x, y). If `targetX`/`targetY` are given (the
// building/feature this label names), draws a leader line from just below
// the label to that point, with a small dot at the target end -- the
// leader is itself double-stroked (a thicker pale line under a thinner
// ink one) so it stays visible crossing both light and dark ground.
function drawHaloLabel(ctx, text, x, y, targetX, targetY, opts) {
  opts = opts || {};
  const font = opts.font || 'italic 12px Georgia, "Palatino Linotype", serif';
  const ink = opts.ink || '#241a10';
  const halo = opts.halo || 'rgba(255,252,240,0.92)';
  ctx.save();
  ctx.font = font;
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  if (targetX !== undefined && targetY !== undefined) {
    const labelEdgeY = y + (opts.leaderFromBelow === false ? 0 : 8);
    ctx.strokeStyle = halo;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, labelEdgeY);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.moveTo(x, labelEdgeY);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(targetX, targetY, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = halo;
  ctx.lineWidth = 3.5;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y);

  // See lib/render-trace.js. Measured here, inside the save/restore, so the
  // font in effect is the one the text was actually drawn with.
  if (typeof isTracing === 'function' && isTracing()) {
    const m = ctx.measureText(text);
    const boxW = m.width;
    const boxH = (m.actualBoundingBoxAscent || 8) + (m.actualBoundingBoxDescent || 3);
    const left = ctx.textAlign === 'center' ? x - boxW / 2 : ctx.textAlign === 'right' ? x - boxW : x;
    traceShape('labels', {
      text, x, y,
      box: { x: left, y: y - boxH / 2, w: boxW, h: boxH },
      targetX, targetY,
    });
  }

  ctx.restore();
}

// Collision-aware placement for a whole set of labels (RULES.md L2/L3).
//
// drawHaloLabel puts a label exactly where it is told, so callers that placed
// labels at a fixed offset from their feature produced overlapping pairs
// whenever two features landed close together -- a 200-seed audit found this
// on roughly one map in fifteen, which is precisely the failure rate that
// eyeballing single exports never catches.
//
// Each label is tried at a ring of candidate positions around its target,
// nearest first, and takes the first that clears both the already-placed
// labels and the canvas edge. A label with nowhere to go is dropped rather
// than drawn on top of another: an unreadable pile of overlapping names loses
// more information than one missing name, and the caller gets it back in
// `skipped` so it can still be listed in the map's side panel.
//
// items: [{ text, targetX, targetY, font?, ink?, halo?, priority? }]
// opts:  { width, height, margin?, gap?, offsets? }
function placeHaloLabels(ctx, items, opts) {
  opts = opts || {};
  const margin = opts.margin === undefined ? 6 : opts.margin;
  const gap = opts.gap === undefined ? 2 : opts.gap;
  // Nearest first: sitting just under its feature is the convention, and the
  // further rings are only reached when that spot is taken.
  const offsets = opts.offsets || [
    { dx: 0, dy: 14 }, { dx: 0, dy: -14 },
    { dx: 0, dy: 24 }, { dx: 0, dy: -24 },
    { dx: 30, dy: 8 }, { dx: -30, dy: 8 },
    { dx: 34, dy: -10 }, { dx: -34, dy: -10 },
    { dx: 0, dy: 38 }, { dx: 0, dy: -38 },
    { dx: 48, dy: 20 }, { dx: -48, dy: 20 },
    { dx: 52, dy: -24 }, { dx: -52, dy: -24 },
  ];

  // Bigger/more important features claim their preferred spot first, so a
  // dropped label is a minor one rather than whichever happened to be last.
  const ordered = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (b.it.priority || 0) - (a.it.priority || 0) || a.i - b.i);

  const placedBoxes = [];
  const placed = [];
  const skipped = [];

  for (const { it } of ordered) {
    ctx.save();
    ctx.font = it.font || 'italic 12px Georgia, "Palatino Linotype", serif';
    const m = ctx.measureText(it.text);
    const w = m.width;
    const h = (m.actualBoundingBoxAscent || 8) + (m.actualBoundingBoxDescent || 3);
    ctx.restore();

    let chosen = null;
    for (const off of offsets) {
      const cx = it.targetX + off.dx;
      const cy = it.targetY + off.dy;
      const box = { x: cx - w / 2, y: cy - h / 2, w, h };
      // L3: the audit treats a label within 4px of the edge as clipped, so
      // the default margin keeps a real gap rather than sitting on the limit.
      if (box.x < margin || box.y < margin) continue;
      if (box.x + box.w > opts.width - margin || box.y + box.h > opts.height - margin) continue;
      const grown = { x: box.x - gap, y: box.y - gap, w: box.w + gap * 2, h: box.h + gap * 2 };
      if (placedBoxes.some((p) => boxesOverlap(p, grown))) continue;
      chosen = { cx, cy, box, off };
      break;
    }

    if (!chosen) { skipped.push(it); continue; }
    placedBoxes.push(chosen.box);
    placed.push(it);

    // Only draw a leader when the label sits far enough away that the link
    // back to its feature isn't obvious; a label tucked directly under its
    // building doesn't need a line pointing at it.
    const far = Math.hypot(chosen.off.dx, chosen.off.dy) > 20;
    drawHaloLabel(
      ctx, it.text, chosen.cx, chosen.cy,
      far ? it.targetX : undefined,
      far ? it.targetY : undefined,
      // drawHaloLabel anchors the leader 8px below the text, which is right
      // when the label sits ABOVE its target and the line runs downward. For a
      // label below its target the line runs back up, and that same anchor
      // would draw it straight through the words -- so anchor on the text
      // centre instead, where the halo still keeps it legible.
      { font: it.font, ink: it.ink, halo: it.halo, leaderFromBelow: chosen.off.dy > 0 ? false : undefined }
    );
  }

  return { placed, skipped };
}

function boxesOverlap(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}
