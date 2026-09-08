// Prop-glyph dispatcher for the BSP dungeon generator -- addresses the
// account owner's third complaint ("not enough visual detail/texture"),
// additive on top of the existing sparse rubble-dot pass (never replaces
// it). Same canvas-path-glyph convention as lib/room-shapes.js's
// drawTrapGlyph / views/map-detail.js's drawWildZoneIcon: no image assets,
// pure stroke/fill drawing at a caller-given size.

function drawDungeonPropGlyph(ctx, x, y, key, ink, accent) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 1;
  if (key === 'crate') {
    ctx.strokeStyle = ink;
    ctx.strokeRect(-3, -3, 6, 6);
    ctx.beginPath();
    ctx.moveTo(-3, -3); ctx.lineTo(3, 3);
    ctx.moveTo(3, -3); ctx.lineTo(-3, 3);
    ctx.stroke();
  } else if (key === 'barrel') {
    ctx.strokeStyle = ink;
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.6, 3.4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-2.6, -1.1); ctx.lineTo(2.6, -1.1);
    ctx.moveTo(-2.6, 1.1); ctx.lineTo(2.6, 1.1);
    ctx.stroke();
  } else if (key === 'rubble') {
    ctx.fillStyle = ink;
    for (const [dx, dy, r] of [[-2, 1, 1.4], [1.5, -1, 1.1], [0.5, 1.8, 1.3], [-1.5, -1.5, 1]]) {
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (key === 'bones') {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-3.5, -2); ctx.lineTo(3.5, 2);
    ctx.moveTo(-3.5, 2); ctx.lineTo(3.5, -2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 1.4, 0, Math.PI * 2);
    ctx.fillStyle = ink;
    ctx.fill();
  } else if (key === 'puddle') {
    ctx.fillStyle = accent || ink;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 3.6, 2.2, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (key === 'runeCircle') {
    ctx.strokeStyle = accent || ink;
    ctx.beginPath();
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 2.6, Math.sin(a) * 2.6);
    }
    ctx.stroke();
  } else if (key === 'table') {
    ctx.strokeStyle = ink;
    ctx.strokeRect(-3.5, -2, 7, 4);
  }
  ctx.restore();
}

// Cheap substring correlation between a room's purpose (from
// lib/dungeon-lore.js) and which props it tends to get -- light, not
// exhaustive, matching the plan's own scope call. Falls back to a generic
// pool for anything unmatched.
const PROP_HINTS = {
  armory: ['crate', 'crate', 'table'],
  guard: ['crate', 'table'],
  barracks: ['crate', 'rubble'],
  kitchen: ['barrel', 'table'],
  larder: ['barrel', 'barrel', 'crate'],
  ossuary: ['bones', 'bones'],
  crypt: ['bones', 'runeCircle'],
  bone: ['bones'],
  flooded: ['puddle'],
  cistern: ['puddle'],
  ritual: ['runeCircle'],
  shrine: ['runeCircle'],
  vault: ['crate'],
  treasury: ['crate'],
  workshop: ['table', 'crate'],
  alchemist: ['table', 'puddle'],
  scriptorium: ['table'],
  collapsed: ['rubble', 'rubble'],
  overgrown: ['rubble'],
};
const GENERIC_PROP_POOL = ['crate', 'barrel', 'rubble', 'table'];

function pickPropKeyForPurpose(purpose, rng) {
  const lower = (purpose || '').toLowerCase();
  for (const hintKey in PROP_HINTS) {
    if (lower.includes(hintKey)) {
      const pool = PROP_HINTS[hintKey];
      return pool[Math.floor(rng() * pool.length)];
    }
  }
  return GENERIC_PROP_POOL[Math.floor(rng() * GENERIC_PROP_POOL.length)];
}

// Independent sparse per-room pass -- coarser and discrete, unlike the
// existing per-cell debris scatter (which stays untouched, own rng stream).
// Rejection-samples a few floor cells inside the room's own rectangle
// footprint so props never land outside the room even for a non-rect shape.
function scatterDungeonProps(ctx, grid, gw, gh, rooms, cell, propRng, palette) {
  for (const room of rooms) {
    const rolls = [];
    if (propRng() < 0.6) rolls.push(1);
    if (propRng() < 0.15) rolls.push(1);
    for (const _ of rolls) {
      let placed = false;
      for (let tries = 0; tries < 8 && !placed; tries++) {
        const x = room.rx + Math.floor(propRng() * room.rw);
        const y = room.ry + Math.floor(propRng() * room.rh);
        if (y < 0 || y >= gh || x < 0 || x >= gw || grid[y][x] !== 1) continue;
        const key = pickPropKeyForPurpose(room.purpose, propRng);
        drawDungeonPropGlyph(ctx, x * cell + cell / 2, y * cell + cell / 2, key, palette.stroke, palette.propAccent);
        placed = true;
      }
    }
  }
}
