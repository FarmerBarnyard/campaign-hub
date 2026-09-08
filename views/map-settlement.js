// Settlement/town-scale map: drilled into from a settlement marker on the
// overworld map (map-overworld.js). Reuses lib/voronoi-mesh.js at
// building-plot density instead of terrain-cell density -- same mesh code,
// different scale of what a "cell" represents.
//
// The town's own seed is *derived* from (overworldSeed, settlementIndex)
// rather than entered by hand, so there is nothing here for the user to
// desync: regenerating the same overworld seed and clicking the same
// settlement always reproduces the identical town. Deliberately no
// "Regenerate" control -- reseeding the layout independently of the
// overworld settlement it belongs to would break that guarantee.
//
// Organic-town overhaul (account owner's own words: "just circular images,
// with some geometric shapes within"): the boundary is now a
// makeRadialWobbleSampler-wobbled silhouette (same mechanism the overworld
// uses for its island coastline) instead of a hard circle, the radial
// street skeleton is jittered/wobbled rather than perfectly even, named
// POIs (lib/settlement-poi.js) sit alongside ordinary buildings, buildings
// vary by tier/color, and the town renders directly in real backdrop
// terrain (views/map-detail.js's renderTerrainPatch) rather than floating
// on a flat fill -- unlike views/map-landmark.js's framed inset-card
// treatment, a town sits directly in its landscape (walls and all), the
// way a real regional map presents one, so there is no separate panel here.
function deriveSettlementSeed(overworldSeed, idx) {
  const mixSeed = (overworldSeed ^ Math.imul(idx + 1, 0x9e3779b1)) >>> 0;
  const mixRng = mulberry32(mixSeed);
  return Math.floor(mixRng() * 0xffffffff) >>> 0;
}

// Tier drives scale and density, matching the tier already assigned on the
// overworld map: village = small and sparse with no wall; town = denser
// with a wall and a couple of gates; city = densest, walled, more gates.
const SETTLEMENT_TIER_CONFIG = {
  village: { cellCount: 55, radius: 160, spokes: 4, rings: 1, wall: false, gates: 0 },
  town: { cellCount: 120, radius: 230, spokes: 6, rings: 2, wall: true, gates: 2 },
  city: { cellCount: 210, radius: 300, spokes: 8, rings: 3, wall: true, gates: 3 },
};

// Building-tier variety (footprint size band + relative weight), addressing
// "buildings all look identical" -- weights differ per settlement tier
// (village skews hovel-heavy, city skews manor-heavier) and are further
// biased by distance-from-plaza at draw time (see generate() below).
const BUILDING_TIERS = {
  village: [
    { key: 'hovel', weight: 0.60, shrink: [0.55, 0.68] },
    { key: 'house', weight: 0.38, shrink: [0.68, 0.80] },
    { key: 'manor', weight: 0.02, shrink: [0.78, 0.88] },
  ],
  town: [
    { key: 'hovel', weight: 0.40, shrink: [0.55, 0.68] },
    { key: 'house', weight: 0.50, shrink: [0.68, 0.80] },
    { key: 'manor', weight: 0.10, shrink: [0.78, 0.88] },
  ],
  city: [
    { key: 'hovel', weight: 0.30, shrink: [0.55, 0.68] },
    { key: 'house', weight: 0.52, shrink: [0.68, 0.80] },
    { key: 'manor', weight: 0.18, shrink: [0.78, 0.88] },
  ],
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function lerpBuildingColor(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r},${g},${bl})`;
}

function renderSettlementMap(container, params) {
  const overworldSeed = parseInt(params.get('seed'), 10) || 1;
  const idx = parseInt(params.get('idx'), 10) || 0;
  const name = params.get('name') || 'Unnamed settlement';
  const tierKey = SETTLEMENT_TIER_CONFIG[params.get('tier')] ? params.get('tier') : 'village';
  const config = SETTLEMENT_TIER_CONFIG[tierKey];
  const seed = deriveSettlementSeed(overworldSeed, idx);

  // Terrain-backdrop params, same parsing helpers views/map-detail.js and
  // views/map-landmark.js already use (parseGuideParam/clampParam) --
  // sampleGuide is null for any caller that omits them (an old bookmarked
  // `?seed=&idx=&name=&tier=` link, or a not-yet-updated batch-export call),
  // which is the signal generate() below uses to fall back to today's exact
  // flat-ground rendering rather than attempting a backdrop.
  const clickX = parseFloat(params.get('x')) || 0;
  const clickY = parseFloat(params.get('y')) || 0;
  const targetAvgHeight = clampParam(params.get('h'), 0.5);
  const targetAvgMoisture = clampParam(params.get('m'), 0.5);
  const sea = clampParam(params.get('sea'), 0.42);
  const sampleGuide = parseGuideParam(params);
  const coastal = params.get('coastal') === '1';

  container.innerHTML = `
    <h2 id="st-heading"></h2>
    <p><a href="#/map/overworld">&larr; Back to overworld map</a></p>
    <div class="map-layout">
      <div class="map-controls">
        <label>Theme <select id="st-theme"></select></label>
        <p class="status-text">Derived from overworld seed ${overworldSeed}, settlement #${idx + 1} -- this layout is fixed to that settlement and can't be reseeded independently.</p>
        <hr>
        <button id="st-export">Export PNG</button>
        <label>Save as <input id="st-filename" placeholder="filename.png" autocomplete="off"></label>
        <label>Campaign <select id="st-campaign"></select></label>
        <button id="st-save">Save to campaign</button>
        <p id="st-status" class="status-text"></p>
      </div>
      <canvas id="st-canvas" width="700" height="700"></canvas>
    </div>
    <div class="settlement-poi-panel" id="st-poi"></div>
  `;
  container.querySelector('#st-heading').textContent = `${name} (${tierKey})`;

  populateCampaignSelect(container.querySelector('#st-campaign'));
  populateThemeSelect(container.querySelector('#st-theme'));

  const canvas = container.querySelector('#st-canvas');
  // `let`, not `const` -- wireMapExportSave's high-res export temporarily
  // points this at an offscreen context so generate() redraws there instead
  // of the on-screen canvas, then restores it.
  let ctx = canvas.getContext('2d');

  function generate() {
    const theme = MAP_THEMES[container.querySelector('#st-theme').value] || MAP_THEMES[MAP_THEME_DEFAULT];
    const palette = theme.settlement;

    // Dedicated rng streams, same isolation convention as the overworld/
    // dungeon generators: mesh geometry, wall-gate placement, building
    // footprint variety, the organic boundary wobble, street jitter, and
    // POI siting each get their own stream so toggling/regenerating any one
    // of them never perturbs the others or the town layout itself when a
    // theme switch redraws the same seed.
    const meshRng = mulberry32(seed + 77777);
    const wallRng = mulberry32(seed + 991);
    const buildingRng = mulberry32(seed + 55555);
    const boundaryRng = mulberry32(seed + 707070);
    const streetRng = mulberry32(seed + 606060);
    const poiRng = mulberry32(seed + 838383);

    const cx = canvas.width / 2, cy = canvas.height / 2;
    const R = config.radius;
    const streetWidth = Math.max(10, R * 0.045);
    const plazaR = R * 0.08;

    // Organic boundary: a wobbled per-angle radius instead of a hard circle
    // -- the account owner's core complaint ("just circular images"). Same
    // makeRadialWobbleSampler mechanism the overworld already uses for its
    // island coastline. Clamped defensively so no tuning value can ever push
    // the wobbled wall off the fixed 700x700 canvas (worked out for city
    // tier: R=300 -> max effectiveR 324 -> wall radius 340.2 + half line
    // width ~3.3 = 343.5px, vs. 350px half-canvas-extent -- 6.5px margin
    // before the clamp even engages).
    const wobble = makeRadialWobbleSampler(boundaryRng, 5);
    const WOBBLE_AMP = 0.08;
    function effectiveR(theta) {
      return Math.min(R * (1 + WOBBLE_AMP * wobble(theta)), canvas.width / 2 * 0.97);
    }

    // Street skeleton: kept as the radial+ring shape (a full Voronoi-edge
    // street derivation was already deliberately deferred by this file's
    // own prior roadmap note, for real reasons -- selecting a connected
    // spanning edge subset, maintaining consistent width, real risk of a
    // disconnected network), but jittered/wobbled so it no longer reads as
    // a perfectly planned diagram.
    const spokeJitter = (Math.PI / config.spokes) * 0.15;
    const spokeAngles = [];
    for (let i = 0; i < config.spokes; i++) {
      spokeAngles.push((i / config.spokes) * Math.PI * 2 + (streetRng() - 0.5) * 2 * spokeJitter);
    }
    const ringRadii = [];
    const ringWobblers = [];
    for (let i = 1; i <= config.rings; i++) {
      ringRadii.push(R * (i / (config.rings + 1)));
      ringWobblers.push(makeRadialWobbleSampler(streetRng, 4));
    }
    const RING_WOBBLE_AMP = 0.07;
    function ringRadiusAt(ringIdx, theta) {
      return ringRadii[ringIdx] * (1 + RING_WOBBLE_AMP * ringWobblers[ringIdx](theta));
    }

    function distToSpokes(x, y) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) return 0;
      const angle = Math.atan2(dy, dx);
      let best = Infinity;
      for (const spokeAngle of spokeAngles) {
        let diff = Math.abs(angle - spokeAngle) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        best = Math.min(best, dist * Math.sin(diff));
      }
      return Math.abs(best);
    }
    // Samples the wobbled ring radius at the query point's own angle -- a
    // cheap, sufficient local approximation (it doesn't need the true
    // nearest point on the curve, just "is this cell near a street here").
    function distToRings(x, y) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      let best = Infinity;
      for (let i = 0; i < ringRadii.length; i++) best = Math.min(best, Math.abs(dist - ringRadiusAt(i, angle)));
      return best;
    }

    const mesh = buildVoronoiMesh(meshRng, canvas.width, canvas.height, config.cellCount);

    // Sample the wobbled boundary into a closed loop -- drives the terrain
    // clip below and the ink edge stroke at the end.
    const boundarySegments = 128;
    const townBoundaryLoop = [];
    for (let i = 0; i < boundarySegments; i++) {
      const angle = (i / boundarySegments) * Math.PI * 2;
      const r = effectiveR(angle);
      townBoundaryLoop.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    }
    function pathFromBoundary() {
      ctx.beginPath();
      ctx.moveTo(townBoundaryLoop[0].x, townBoundaryLoop[0].y);
      for (let i = 1; i < townBoundaryLoop.length; i++) ctx.lineTo(townBoundaryLoop[i].x, townBoundaryLoop[i].y);
      ctx.closePath();
    }

    // Surrounding terrain: reuses views/map-detail.js's renderTerrainPatch
    // exactly as views/map-landmark.js does, painting real backdrop terrain
    // (biomes/rivers/coastline/hills matching the parent map's actual
    // geography at this settlement) across the whole canvas. `zone` is
    // intentionally omitted -- wild-zone recoloring doesn't belong under an
    // ordinary town. Falls back to today's exact flat ground fill when no
    // guide data was supplied (old bookmarked links, or a caller that
    // hasn't been updated -- see views/map-overworld.js).
    if (sampleGuide) {
      renderTerrainPatch(ctx, canvas, { seed, sea, targetAvgHeight, targetAvgMoisture, sampleGuide, zone: null, palette: theme.overworld });
    } else {
      ctx.fillStyle = palette.ground;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Everything from here through the plaza is clipped to the wobbled
    // boundary when a backdrop was painted -- this is what makes the town
    // read as literally cut into the terrain rather than floating over a
    // flattened square. A no-op save/restore (no clip) when there's no
    // backdrop to cut into.
    ctx.save();
    if (sampleGuide) {
      pathFromBoundary();
      ctx.clip();
      ctx.fillStyle = palette.ground;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Street network: spokes radiating from the plaza plus wobbled
    // concentric rings.
    ctx.strokeStyle = palette.street;
    ctx.lineWidth = streetWidth;
    ctx.lineCap = 'round';
    for (const angle of spokeAngles) {
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * plazaR, cy + Math.sin(angle) * plazaR);
      ctx.lineTo(cx + Math.cos(angle) * effectiveR(angle), cy + Math.sin(angle) * effectiveR(angle));
      ctx.stroke();
    }
    ctx.lineJoin = 'round';
    const ringSegments = 96;
    for (let i = 0; i < ringRadii.length; i++) {
      ctx.beginPath();
      for (let s = 0; s <= ringSegments; s++) {
        const angle = (s / ringSegments) * Math.PI * 2;
        const r = ringRadiusAt(i, angle);
        const x = cx + Math.cos(angle) * r, y = cy + Math.sin(angle) * r;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Gate angles computed before buildings/POIs so guard-post siting can
    // require proximity to one -- purely angular, no radius dependency, so
    // wobbling the boundary above can't perturb gate placement or width.
    let gateAngles = [];
    if (config.wall) {
      for (let i = 0; i < config.gates; i++) {
        gateAngles.push((i / config.gates) * Math.PI * 2 + (wallRng() - 0.5) * 0.5);
      }
    }
    function nearAnyGate(angle) {
      return gateAngles.some((g) => {
        let diff = Math.abs(angle - g) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        return diff < 0.35;
      });
    }
    function cellArea(cell) {
      let a = 0;
      const poly = cell.polygon;
      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
        a += p1.x * p2.y - p2.x * p1.y;
      }
      return Math.abs(a) / 2;
    }
    function eligibleForPlot(cell) {
      const dx = cell.x - cx, dy = cell.y - cy;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const eR = effectiveR(angle);
      if (dist > eR || dist < plazaR) return null;
      if (distToSpokes(cell.x, cell.y) < streetWidth / 2) return null;
      if (distToRings(cell.x, cell.y) < streetWidth / 2) return null;
      if (cell.polygon.length < 3) return null;
      return { dist, angle, eR };
    }

    // Named districts/landmarks (lib/settlement-poi.js) -- addresses "no
    // named districts or landmarks." Sited before ordinary buildings so
    // their cells can be claimed and skipped by that loop.
    const poiPlan = settlementPoiPlan(tierKey, coastal);
    const claimedCellIdx = new Set();
    const poiPlaced = [];
    for (const poiKey of poiPlan) {
      const poiType = SETTLEMENT_POI_TYPES[poiKey];
      if (!poiType) continue;
      const candidates = [];
      for (const cell of mesh.cells) {
        if (claimedCellIdx.has(cell.index)) continue;
        const info = eligibleForPlot(cell);
        if (!info) continue;
        const frac = (info.dist - plazaR) / Math.max(1, info.eR - plazaR);
        if (frac < poiType.band[0] || frac > poiType.band[1]) continue;
        if (poiType.nearGate && !nearAnyGate(info.angle)) continue;
        candidates.push(cell);
      }
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => cellArea(b) - cellArea(a));
      const poolSize = Math.max(1, Math.ceil(candidates.length * 0.35));
      const chosen = candidates[Math.floor(poiRng() * poolSize)];
      claimedCellIdx.add(chosen.index);
      poiPlaced.push({ cell: chosen, poiKey, poiType });
    }

    // Ordinary buildings: tiered variety (hovel/house/manor) instead of one
    // flat color/shrink range -- weighted per settlement tier, further
    // biased toward manor near the plaza and hovel near the edge (the
    // classic historical layout, reinforcing the plaza/wall distance
    // banding this generator already conceptually uses), with fill color
    // lerping between two hand-picked-per-theme palette endpoints.
    const buildingTiers = BUILDING_TIERS[tierKey] || BUILDING_TIERS.village;
    for (const cell of mesh.cells) {
      if (claimedCellIdx.has(cell.index)) continue;
      const info = eligibleForPlot(cell);
      if (!info) continue;
      const distFrac = Math.max(0, Math.min(1, (info.dist - plazaR) / Math.max(1, info.eR - plazaR)));

      const weights = buildingTiers.map((t) => t.weight);
      const manorIdx = buildingTiers.findIndex((t) => t.key === 'manor');
      const hovelIdx = buildingTiers.findIndex((t) => t.key === 'hovel');
      if (manorIdx >= 0) weights[manorIdx] *= (1 - distFrac) * 1.6 + 0.2;
      if (hovelIdx >= 0) weights[hovelIdx] *= distFrac * 1.6 + 0.2;
      const totalW = weights.reduce((a, b) => a + b, 0);
      let roll = buildingRng() * totalW, tier = buildingTiers[buildingTiers.length - 1];
      for (let i = 0; i < buildingTiers.length; i++) {
        if (roll < weights[i]) { tier = buildingTiers[i]; break; }
        roll -= weights[i];
      }
      const [minS, maxS] = tier.shrink;
      const shrink = minS + buildingRng() * (maxS - minS);

      const poly = cell.polygon;
      ctx.fillStyle = lerpBuildingColor(palette.buildingRich, palette.buildingPoor, distFrac);
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const sx = cell.x + (p.x - cell.x) * shrink;
        const sy = cell.y + (p.y - cell.y) * shrink;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fill();
    }

    // POI footprints, drawn after ordinary buildings so they read as
    // visually distinct: a wider shrink (bigger structure), a dedicated
    // fill, an icon glyph, and a text label.
    ctx.font = `bold 10px ${OW_SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const p of poiPlaced) {
      const poly = p.cell.polygon;
      const shrink = 0.85;
      ctx.fillStyle = palette.poiFill;
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const pt = poly[i];
        const sx = p.cell.x + (pt.x - p.cell.x) * shrink;
        const sy = p.cell.y + (pt.y - p.cell.y) * shrink;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fill();
      drawSettlementPOIIcon(ctx, p.cell.x, p.cell.y - 8, p.poiType.iconKey, palette.ink);
      ctx.fillStyle = palette.ink;
      ctx.fillText(p.poiType.label, p.cell.x, p.cell.y + 6);
    }

    ctx.fillStyle = palette.plaza;
    ctx.beginPath();
    ctx.arc(cx, cy, plazaR, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // undo the terrain clip (no-op if none was applied)

    if (config.wall) {
      const gateHalfWidth = 0.1;
      function nearGate(angle) {
        return gateAngles.some((g) => {
          let diff = Math.abs(angle - g) % (Math.PI * 2);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          return diff < gateHalfWidth;
        });
      }
      ctx.strokeStyle = palette.wall;
      ctx.lineWidth = Math.max(3, R * 0.022);
      ctx.lineCap = 'butt';
      const segments = 160;
      let penDown = false;
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const wallR = effectiveR(angle) * 1.05;
        const x = cx + Math.cos(angle) * wallR, y = cy + Math.sin(angle) * wallR;
        if (nearGate(angle)) { penDown = false; continue; }
        if (!penDown) { ctx.moveTo(x, y); penDown = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Short perpendicular tick at each gate opening, matching the
      // dungeon generator's door-tick convention.
      ctx.lineWidth = Math.max(2, R * 0.016);
      for (const g of gateAngles) {
        const wallR = effectiveR(g) * 1.05;
        const gx = cx + Math.cos(g) * wallR, gy = cy + Math.sin(g) * wallR;
        const perp = g + Math.PI / 2;
        const half = streetWidth * 0.6;
        ctx.beginPath();
        ctx.moveTo(gx - Math.cos(perp) * half, gy - Math.sin(perp) * half);
        ctx.lineTo(gx + Math.cos(perp) * half, gy + Math.sin(perp) * half);
        ctx.stroke();
      }
    }

    // Soft double-stroke ink edge around the wobbled boundary (wide low-
    // alpha + thin crisp, same technique views/map-detail.js already uses
    // for its beach outline) so the organic silhouette reads as a
    // deliberate edge against the backdrop, not just an implicit clip.
    pathFromBoundary();
    ctx.strokeStyle = palette.ink;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Notable-locations panel: plain DOM text below the canvas, not part of
    // the PNG export (matches every other generator's "canvas is the
    // export unit" convention). Regenerated every call so a theme switch
    // never leaves stale entries.
    const poiEl = container.querySelector('#st-poi');
    if (poiPlaced.length) {
      poiEl.innerHTML = `<h3>Notable locations</h3>` +
        poiPlaced.map((p) => `<p>${p.poiType.label}</p>`).join('');
    } else {
      poiEl.innerHTML = '';
    }
  }

  generate();
  container.querySelector('#st-theme').addEventListener('change', generate);
  wireMapExportSave(container, canvas, 'st', (offCtx) => {
    const prevCtx = ctx;
    ctx = offCtx;
    generate();
    ctx = prevCtx;
  });
}
