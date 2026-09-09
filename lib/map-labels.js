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
  ctx.restore();
}
