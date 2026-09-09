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
//
// Second pass, after the first one still read as "a spoke-and-ring diagram
// with a wobble filter" rather than a town: buildings are now drawn as
// their own oriented bounding rectangle (minAreaRect below) instead of the
// raw, amorphous Voronoi cell polygon -- the single biggest reason the
// first pass didn't look like buildings. The street skeleton is broken up
// further (uneven spoke lengths, gapped/arc-only rings instead of full
// circles, a handful of organic branch stubs) instead of just jittered.
// The boundary wobble amplitude more than doubled, collapsed to a single
// visible edge (the wall itself, for walled tiers, instead of a redundant
// second ink outline), and -- when real backdrop terrain is available --
// recedes toward any nearby coastline instead of ignoring it, with the
// harbor POI biased to actually site on that water-facing side.
function deriveSettlementSeed(overworldSeed, idx) {
  const mixSeed = (overworldSeed ^ Math.imul(idx + 1, 0x9e3779b1)) >>> 0;
  const mixRng = mulberry32(mixSeed);
  return Math.floor(mixRng() * 0xffffffff) >>> 0;
}

// Tier drives scale and density, matching the tier already assigned on the
// overworld map: village = small and sparse with no wall; town = denser
// with a wall and a couple of gates; city = densest, walled, more gates.
// Town/city radii were reduced from their original 230/300 to buy headroom
// for the much larger boundary-wobble amplitude below (see effectiveR's
// own comment for the worked-out margin math).
const SETTLEMENT_TIER_CONFIG = {
  village: { cellCount: 55, radius: 160, spokes: 4, rings: 1, wall: false, gates: 0 },
  town: { cellCount: 120, radius: 200, spokes: 6, rings: 2, wall: true, gates: 2 },
  city: { cellCount: 210, radius: 260, spokes: 8, rings: 3, wall: true, gates: 3 },
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

// Minimum-area oriented bounding rectangle via rotating calipers over the
// polygon's own edges -- the fix for "buildings don't look like buildings":
// a raw Voronoi cell polygon has no straight walls or corners a viewer
// recognizes as a structure, but the rectangle that best approximates its
// footprint (oriented to whichever edge minimizes the bounding area, not
// forced axis-aligned) does. Cheap at the small vertex counts (4-8) these
// cell polygons actually have -- O(edges x vertices) per building.
function minAreaRect(poly) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
    const edgeAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const cos = Math.cos(-edgeAngle), sin = Math.sin(-edgeAngle);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of poly) {
      const rx = p.x * cos - p.y * sin;
      const ry = p.x * sin + p.y * cos;
      if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
    }
    const w = maxX - minX, h = maxY - minY;
    const area = w * h;
    if (!best || area < best.area) {
      const ccx = (minX + maxX) / 2, ccy = (minY + maxY) / 2;
      const cosB = Math.cos(edgeAngle), sinB = Math.sin(edgeAngle);
      best = { area, w, h, angle: edgeAngle, cx: ccx * cosB - ccy * sinB, cy: ccx * sinB + ccy * cosB };
    }
  }
  return best;
}

// Draws a building/POI footprint as its oriented rectangle, shrunk for a
// visible street gap -- floored at a small minimum so a sliver-thin cell
// still reads as a real footprint instead of vanishing to a hairline, and
// capped at `maxDim` (when given) so an unusually large Voronoi cell (a
// real occurrence at low cell counts, e.g. village tier's 55 cells over a
// 160px radius) can't produce an oversized rectangle that visibly pokes
// through the town boundary/wall -- centroid-distance eligibility alone
// doesn't catch this, since the overflow comes from the rectangle's own
// size, not from being sited too close to the edge.
function drawFootprintRect(ctx, rect, shrink, fillStyle, maxDim) {
  let w = Math.max(4, rect.w * shrink), h = Math.max(4, rect.h * shrink);
  if (maxDim) { w = Math.min(w, maxDim); h = Math.min(h, maxDim); }
  ctx.save();
  ctx.translate(rect.cx, rect.cy);
  ctx.rotate(rect.angle);
  ctx.fillStyle = fillStyle;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
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

    // Coastal shaping: when a real backdrop is available, probe a ring of
    // points around the town for water so the boundary can recede toward
    // an actual nearby shore instead of ignoring it entirely -- addresses
    // "no surrounding context" more literally than just painting terrain
    // behind an oblivious circle. Smoothstepped around sea level (not a
    // hard cutoff) so the recession reads as a gradual coastal lean, not a
    // faceted bite out of the boundary.
    const coastalProbeCount = 16;
    let coastalHeights = null;
    if (sampleGuide) {
      const probeR = R * 1.15;
      coastalHeights = new Array(coastalProbeCount);
      for (let i = 0; i < coastalProbeCount; i++) {
        const angle = (i / coastalProbeCount) * Math.PI * 2;
        const px = cx + Math.cos(angle) * probeR, py = cy + Math.sin(angle) * probeR;
        coastalHeights[i] = sampleGuide(px / canvas.width, py / canvas.height);
      }
    }
    function coastalMultiplier(theta) {
      if (!coastalHeights) return 1;
      const f = (((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * coastalProbeCount;
      const i0 = Math.floor(f) % coastalProbeCount;
      const i1 = (i0 + 1) % coastalProbeCount;
      const t = f - Math.floor(f);
      const h = coastalHeights[i0] * (1 - t) + coastalHeights[i1] * t;
      const lo = sea - 0.05, hi = sea + 0.05;
      const s = Math.max(0, Math.min(1, (h - lo) / (hi - lo)));
      return 0.7 + 0.3 * s; // water side recedes to 70% radius, land side unaffected
    }

    // Organic boundary: a wobbled per-angle radius instead of a hard circle
    // -- the account owner's core complaint ("just circular images"). Same
    // makeRadialWobbleSampler mechanism the overworld already uses for its
    // island coastline, at a much larger amplitude than the first pass
    // (0.18, up from 0.08) so it actually reads as an irregular shape
    // rather than a lumpy circle. Clamped defensively so no tuning value
    // can ever push the wobbled wall off the fixed 700x700 canvas -- worked
    // out for city tier at this amplitude: R=260 -> max effectiveR ~307 ->
    // wall radius ~322 + half line width ~2.9 = ~325px, vs. 350px
    // half-canvas-extent -- 25px margin before the clamp even engages
    // (town/city radii were reduced from their original 230/300 specifically
    // to buy this headroom at the larger amplitude).
    const wobble = makeRadialWobbleSampler(boundaryRng, 5);
    const WOBBLE_AMP = 0.18;
    function effectiveR(theta) {
      const base = R * (1 + WOBBLE_AMP * wobble(theta)) * coastalMultiplier(theta);
      return Math.min(base, canvas.width / 2 * 0.97);
    }

    // Street skeleton: kept as the radial+ring shape (a full Voronoi-edge
    // street derivation remains deliberately deferred, for real reasons --
    // selecting a connected spanning edge subset, maintaining consistent
    // width, real risk of a disconnected network), but broken up much more
    // aggressively than the first pass: spoke angles are jittered far more
    // (0.45 of half-spacing, up from 0.15), spokes vary in drawn length
    // rather than all reaching the wall, and rings are arcs with a few
    // random gaps rather than full circles -- plus a handful of short
    // branch stubs off the main network for organic texture (T-junctions,
    // dead ends) instead of a perfectly clean wheel.
    const spokeJitter = (Math.PI / config.spokes) * 0.45;
    const spokeAngles = [];
    const spokeLengthFrac = [];
    for (let i = 0; i < config.spokes; i++) {
      spokeAngles.push((i / config.spokes) * Math.PI * 2 + (streetRng() - 0.5) * 2 * spokeJitter);
      spokeLengthFrac.push(0.55 + streetRng() * 0.45);
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

    const ringGapAngles = [];
    for (let i = 0; i < ringRadii.length; i++) {
      const gapCount = 2 + Math.floor(streetRng() * 3);
      const gaps = [];
      for (let g = 0; g < gapCount; g++) gaps.push({ angle: streetRng() * Math.PI * 2, halfWidth: 0.12 + streetRng() * 0.15 });
      ringGapAngles.push(gaps);
    }
    function inRingGap(ringIdx, angle) {
      return ringGapAngles[ringIdx].some((g) => {
        let diff = Math.abs(angle - g.angle) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        return diff < g.halfWidth;
      });
    }

    // Secondary branch streets: short stubs anchored on an existing spoke
    // or ring, breaking the pure radial/concentric symmetry with a bit of
    // organic texture rather than a perfectly clean wheel.
    const branchCount = Math.max(3, Math.floor(config.spokes * 1.2));
    const branchSegments = [];
    for (let b = 0; b < branchCount; b++) {
      let ax, ay;
      if (streetRng() < 0.6 && spokeAngles.length) {
        const si = Math.floor(streetRng() * spokeAngles.length);
        const angle = spokeAngles[si];
        const t = 0.25 + streetRng() * 0.6;
        const r = effectiveR(angle) * spokeLengthFrac[si] * t;
        ax = cx + Math.cos(angle) * r; ay = cy + Math.sin(angle) * r;
      } else if (ringRadii.length) {
        const ri = Math.floor(streetRng() * ringRadii.length);
        const angle = streetRng() * Math.PI * 2;
        if (inRingGap(ri, angle)) continue;
        const r = ringRadiusAt(ri, angle);
        ax = cx + Math.cos(angle) * r; ay = cy + Math.sin(angle) * r;
      } else continue;
      const branchAngle = streetRng() * Math.PI * 2;
      const branchLen = R * (0.08 + streetRng() * 0.14);
      branchSegments.push({ x1: ax, y1: ay, x2: ax + Math.cos(branchAngle) * branchLen, y2: ay + Math.sin(branchAngle) * branchLen });
    }
    function distToBranches(x, y) {
      let best = Infinity;
      for (const seg of branchSegments) {
        const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
        const lenSq = dx * dx + dy * dy || 1;
        let t = ((x - seg.x1) * dx + (y - seg.y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        best = Math.min(best, Math.hypot(x - (seg.x1 + dx * t), y - (seg.y1 + dy * t)));
      }
      return best;
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
    // Skips a ring at angles inside one of its own gaps, so buildings can
    // legitimately span across a gap the same way they can't across an
    // intact stretch of ring.
    function distToRings(x, y) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      let best = Infinity;
      for (let i = 0; i < ringRadii.length; i++) {
        if (inRingGap(i, angle)) continue;
        best = Math.min(best, Math.abs(dist - ringRadiusAt(i, angle)));
      }
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

    // Street network: spokes radiating from the plaza (uneven length),
    // wobbled concentric rings (broken into arcs by their own gaps), and
    // a scatter of short organic branch stubs.
    ctx.strokeStyle = palette.street;
    ctx.lineWidth = streetWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let si = 0; si < spokeAngles.length; si++) {
      const angle = spokeAngles[si];
      const len = effectiveR(angle) * spokeLengthFrac[si];
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * plazaR, cy + Math.sin(angle) * plazaR);
      ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
      ctx.stroke();
    }
    const ringSegments = 96;
    for (let i = 0; i < ringRadii.length; i++) {
      ctx.beginPath();
      let penDown = false;
      for (let s = 0; s <= ringSegments; s++) {
        const angle = (s / ringSegments) * Math.PI * 2;
        if (inRingGap(i, angle)) { penDown = false; continue; }
        const r = ringRadiusAt(i, angle);
        const x = cx + Math.cos(angle) * r, y = cy + Math.sin(angle) * r;
        if (!penDown) { ctx.moveTo(x, y); penDown = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.lineWidth = Math.max(6, streetWidth * 0.6);
    for (const seg of branchSegments) {
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
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
      // A cell's oriented-rectangle footprint (drawn from its centroid) can
      // extend past its own centroid's distance from town center -- a 10%
      // inset keeps rectangles from visibly poking through the boundary
      // edge/wall, without needing per-corner containment math.
      if (dist > eR * 0.9 || dist < plazaR) return null;
      if (distToSpokes(cell.x, cell.y) < streetWidth / 2) return null;
      if (distToRings(cell.x, cell.y) < streetWidth / 2) return null;
      if (distToBranches(cell.x, cell.y) < streetWidth * 0.35) return null;
      if (cell.polygon.length < 3) return null;
      return { dist, angle, eR };
    }

    // Named districts/landmarks (lib/settlement-poi.js) -- addresses "no
    // named districts or landmarks." Sited before ordinary buildings so
    // their cells can be claimed and skipped by that loop. A coastalOnly
    // POI (harbor) is additionally biased toward whichever candidates sit
    // on the water-facing side (per the same coastalMultiplier probe used
    // for the boundary), falling back to the full candidate set if none
    // qualify (no real backdrop, or a coast too far to have registered).
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
        candidates.push({ cell, angle: info.angle });
      }
      if (candidates.length === 0) continue;
      let pool = candidates;
      if (poiType.coastalOnly && coastalHeights) {
        const waterFacing = candidates.filter((c) => coastalMultiplier(c.angle) < 0.9);
        if (waterFacing.length) pool = waterFacing;
      }
      const cells = pool.map((c) => c.cell);
      cells.sort((a, b) => cellArea(b) - cellArea(a));
      const poolSize = Math.max(1, Math.ceil(cells.length * 0.35));
      const chosen = cells[Math.floor(poiRng() * poolSize)];
      claimedCellIdx.add(chosen.index);
      poiPlaced.push({ cell: chosen, poiKey, poiType });
    }

    // Ordinary buildings: tiered variety (hovel/house/manor) instead of one
    // flat color/shrink range -- weighted per settlement tier, further
    // biased toward manor near the plaza and hovel near the edge (the
    // classic historical layout, reinforcing the plaza/wall distance
    // banding this generator already conceptually uses), with fill color
    // lerping between two hand-picked-per-theme palette endpoints. Drawn
    // as each cell's own oriented bounding rectangle (minAreaRect), not
    // its raw polygon -- the fix for buildings reading as amorphous blobs.
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

      const rect = minAreaRect(cell.polygon);
      drawFootprintRect(ctx, rect, shrink, lerpBuildingColor(palette.buildingRich, palette.buildingPoor, distFrac), R * 0.3);
    }

    // POI footprints, drawn after ordinary buildings so they read as
    // visually distinct: a wider shrink (bigger structure), a dedicated
    // fill, an icon glyph, and a text label -- also an oriented rectangle,
    // same as ordinary buildings.
    ctx.font = `bold 10px ${OW_SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const p of poiPlaced) {
      const rect = minAreaRect(p.cell.polygon);
      drawFootprintRect(ctx, rect, 0.85, palette.poiFill, R * 0.35);
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
    } else {
      // No wall (village) -- the wobbled boundary itself needs a visible
      // edge, so draw the soft double-stroke ink outline (wide low-alpha +
      // thin crisp, same technique views/map-detail.js uses for its beach
      // outline). Walled tiers skip this entirely: the wall stroke drawn
      // above already reads as the town's edge, and stacking a second ink
      // outline on top of it was what produced the "two nested circles"
      // look the first pass had.
      pathFromBoundary();
      ctx.strokeStyle = palette.ink;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

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
