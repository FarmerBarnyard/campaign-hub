// Named districts/landmarks for the settlement generator (views/
// map-settlement.js) -- addresses the account owner's "no named districts
// or landmarks" complaint, same "purpose vocabulary, not just geometry"
// treatment lib/landmark-sites.js already gave landmark sites. Unlike a
// landmark site's rooms (an enclosed floor plan), a settlement's POIs are
// individual building footprints scattered across the town's own Voronoi
// mesh, so this table drives SITING (a radial band of the town's own
// effectiveR, not a room shape) rather than room geometry.

const SETTLEMENT_POI_TYPES = {
  market: { label: 'Market Square', iconKey: 'market', band: [0.05, 0.35] },
  // Band tightened close to the market hub -- a real medieval town's
  // church/cathedral is typically the dominant building right at or next
  // to the market, not scattered mid-town. Its label and footprint size
  // are further overridden per tier in views/map-settlement.js (Chapel/
  // Church/Cathedral, with a correspondingly bigger footprint for city).
  temple: { label: 'Temple', iconKey: 'temple', band: [0.05, 0.30] },
  tavern: { label: 'Tavern', iconKey: 'tavern', band: [0.20, 0.75] },
  guardpost: { label: 'Guard Post', iconKey: 'guardpost', band: [0.80, 1.00], nearGate: true },
  harbor: { label: 'Harbor', iconKey: 'harbor', band: [0.70, 1.00], coastalOnly: true },
  // Village-only named buildings -- individually named (matching
  // Phandalin's "Stonehill Inn," "Barthen's Provisions") rather than one
  // more anonymous hovel/house rect. Sited through this same band-siting
  // machinery instead of the sparse-cluster "Cottage" loop in
  // views/map-settlement.js.
  inn: { label: 'Inn', iconKey: 'inn', band: [0.10, 0.45] },
  provisioner: { label: 'Provisioner', iconKey: 'provisioner', band: [0.15, 0.55] },
  smithy: { label: 'Smithy', iconKey: 'smithy', band: [0.20, 0.65] },
  farmstead: { label: 'Farmstead', iconKey: 'farmstead', band: [0.65, 1.00] },
};

// Per-tier POI lists -- which types appear, and how many. `guardpost`
// listed twice for city means two separate guard-post instances (one per
// eligible gate), not a single entry with a count field, since siting picks
// one eligible cell per list entry. Village gets the named-building table
// (inn/provisioner/smithy/farmstead) instead of the generic 'tavern' --
// the sparse cluster of anonymous "Cottage" buildings around them (see
// views/map-settlement.js) is what actually reads as the rest of the
// village.
const SETTLEMENT_POI_PLAN = {
  village: ['inn', 'provisioner', 'smithy', 'farmstead'],
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
  } else if (key === 'inn') {
    // A wayside sign: a peaked roof over a doorway.
    ctx.beginPath();
    ctx.moveTo(-5, -2); ctx.lineTo(0, -7); ctx.lineTo(5, -2);
    ctx.stroke();
    ctx.strokeRect(-4, -2, 8, 6);
    ctx.beginPath();
    ctx.moveTo(0, -2); ctx.lineTo(0, 4);
    ctx.stroke();
  } else if (key === 'provisioner') {
    // A cinched trade-goods sack.
    ctx.beginPath();
    ctx.moveTo(-4, 4); ctx.quadraticCurveTo(-5, -3, -2, -4); ctx.lineTo(2, -4);
    ctx.quadraticCurveTo(5, -3, 4, 4); ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-2, -4); ctx.lineTo(-1, -6); ctx.moveTo(2, -4); ctx.lineTo(1, -6);
    ctx.stroke();
  } else if (key === 'smithy') {
    // An anvil with a hammer laid across it.
    ctx.beginPath();
    ctx.moveTo(-5, 3); ctx.lineTo(5, 3); ctx.lineTo(3, -1); ctx.lineTo(-3, -1); ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -1); ctx.lineTo(0, -4);
    ctx.moveTo(-3, -6); ctx.lineTo(3, -3);
    ctx.stroke();
  } else if (key === 'farmstead') {
    // A wheat sheaf: three stalks bound at the top.
    for (const dx of [-3, 0, 3]) {
      ctx.beginPath();
      ctx.moveTo(dx, 4); ctx.lineTo(dx, -5);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-4, -5); ctx.lineTo(4, -5);
    ctx.stroke();
  }
  ctx.restore();
}
