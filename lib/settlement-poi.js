// Named districts/landmarks for the settlement generator (views/
// map-settlement.js) -- addresses the account owner's "no named districts
// or landmarks" complaint, same "purpose vocabulary, not just geometry"
// treatment lib/landmark-sites.js already gave landmark sites. Unlike a
// landmark site's rooms (an enclosed floor plan), a settlement's POIs are
// individual building footprints scattered across the town's own Voronoi
// mesh, so this table drives SITING (a radial band of the town's own
// effectiveR, not a room shape) rather than room geometry.

const SETTLEMENT_POI_TYPES = {
  market: { label: 'Market Square', iconKey: 'market', band: [0.10, 0.45] },
  temple: { label: 'Temple', iconKey: 'temple', band: [0.15, 0.55] },
  tavern: { label: 'Tavern', iconKey: 'tavern', band: [0.20, 0.75] },
  guardpost: { label: 'Guard Post', iconKey: 'guardpost', band: [0.80, 1.00], nearGate: true },
  harbor: { label: 'Harbor', iconKey: 'harbor', band: [0.70, 1.00], coastalOnly: true },
};

// Per-tier POI lists -- which types appear, and how many. `guardpost`
// listed twice for city means two separate guard-post instances (one per
// eligible gate), not a single entry with a count field, since siting picks
// one eligible cell per list entry.
const SETTLEMENT_POI_PLAN = {
  village: ['tavern'],
  town: ['market', 'temple', 'tavern', 'guardpost'],
  city: ['market', 'temple', 'tavern', 'guardpost', 'guardpost'],
};

// Returns the ordered list of POI type keys to place for this tier/coastal
// combination -- harbor only added for a coastal town/city (village stays
// tavern-only regardless, matching the plan's per-tier counts).
function settlementPoiPlan(tierKey, coastal) {
  const plan = (SETTLEMENT_POI_PLAN[tierKey] || SETTLEMENT_POI_PLAN.village).slice();
  if (coastal && tierKey !== 'village') plan.push('harbor');
  return plan;
}

function drawSettlementPOIIcon(ctx, x, y, key, ink) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1.3;
  if (key === 'market') {
    // A stall: a small awning triangle over a counter line.
    ctx.beginPath();
    ctx.moveTo(-5, -1); ctx.lineTo(0, -6); ctx.lineTo(5, -1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-5, -1); ctx.lineTo(-5, 3);
    ctx.moveTo(5, -1); ctx.lineTo(5, 3);
    ctx.moveTo(-5, 3); ctx.lineTo(5, 3);
    ctx.stroke();
  } else if (key === 'temple') {
    // A pillared triangle pediment.
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(-6, 3); ctx.lineTo(6, 3); ctx.closePath();
    ctx.stroke();
    for (const dx of [-3, 0, 3]) { ctx.beginPath(); ctx.moveTo(dx, -1); ctx.lineTo(dx, 3); ctx.stroke(); }
  } else if (key === 'tavern') {
    // A hanging sign: a mug glyph on a post.
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(0, 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(-4, -6, 6, 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(2.5, -3.5, 1.6, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  } else if (key === 'guardpost') {
    // A small crenellated tower.
    ctx.strokeRect(-4, -2, 8, 7);
    for (const dx of [-4, -1.3, 1.3, 4]) { ctx.beginPath(); ctx.moveTo(dx, -2); ctx.lineTo(dx, -5); ctx.stroke(); }
  } else if (key === 'harbor') {
    // An anchor.
    ctx.beginPath();
    ctx.arc(0, -4, 1.6, 0, Math.PI * 2);
    ctx.moveTo(0, -2.4); ctx.lineTo(0, 6);
    ctx.moveTo(-4, 3); ctx.lineTo(4, 3);
    ctx.moveTo(-4, 3); ctx.quadraticCurveTo(-4, 6, 0, 6);
    ctx.moveTo(4, 3); ctx.quadraticCurveTo(4, 6, 0, 6);
    ctx.stroke();
  }
  ctx.restore();
}
