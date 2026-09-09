// Hand-drawn contour-hachure ground texture.
//
// The single biggest gap found when actually cropping into a real Mike
// Schley export (Phandalin) at high zoom rather than working from
// memory: EVERY square inch of ground on a real WotC regional/town map
// carries dense, short, curved ink dashes that visibly follow the
// terrain's own contours (true cartographic hachure shading) -- not a
// flat biome color with a light noise grain, which is all this app had.
// This is drawn as an ADDITIVE overlay on top of the existing biome
// fill/wash passes (paintWatercolorWash, paintBiomeTexture, etc.) in
// every caller -- it doesn't replace them, it's the missing top layer.
//
// No per-call budget was set here on purpose (explicitly waived): a
// Standard-tier overworld canvas gets on the order of tens of thousands
// of short strokes. That's still just canvas moveTo/lineTo/stroke calls,
// not per-stroke object churn worth optimizing away preemptively.

// `heightAt(x, y)` samples the driving field at a canvas-pixel point
// (nearest-grid lookup is fine -- callers already have one). The local
// gradient of that field, sampled via two tiny finite-difference probes,
// gives a real "which way is uphill" direction per stroke; the hachure
// itself is drawn PERPENDICULAR to that gradient (a true contour line
// runs perpendicular to the slope), which is what actually produces the
// swirling, terrain-following look real contour hachures have instead of
// a directionless scatter. `skipAt(x, y)` (optional) lets a caller leave
// water/beach or any other region bare -- reference maps never hachure
// open water.
function paintHachureField(ctx, w, h, rng, ink, heightAt, skipAt, opts) {
  opts = opts || {};
  const spacing = opts.spacing || 4;
  const strokeLen = opts.strokeLen || 8;
  const density = opts.density !== undefined ? opts.density : 1;
  const eps = opts.eps || 3;
  const passes = opts.passes || 2; // a second, offset pass roughly doubles apparent coverage without doubling stroke length

  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  for (let pass = 0; pass < passes; pass++) {
    for (let gy = spacing / 2; gy < h; gy += spacing) {
      for (let gx = spacing / 2; gx < w; gx += spacing) {
        if (rng() > density) continue;
        const px = gx + (rng() - 0.5) * spacing * 0.9;
        const py = gy + (rng() - 0.5) * spacing * 0.9;
        if (skipAt && skipAt(px, py)) continue;
        const h0 = heightAt(px, py);
        const hx = heightAt(px + eps, py) - h0;
        const hy = heightAt(px, py + eps) - h0;
        let angle = Math.atan2(hy, hx) + Math.PI / 2;
        angle += (rng() - 0.5) * 0.6; // per-stroke jitter -- keeps it from reading as mechanically precise
        const len = strokeLen * (0.55 + rng() * 0.75);
        ctx.globalAlpha = 0.3 + rng() * 0.4;
        ctx.lineWidth = 0.8 + rng() * 0.6;
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(angle) * len / 2, py - Math.sin(angle) * len / 2);
        ctx.lineTo(px + Math.cos(angle) * len / 2, py + Math.sin(angle) * len / 2);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
