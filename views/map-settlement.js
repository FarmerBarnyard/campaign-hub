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
// Third pass, aimed specifically at real medieval town/city structure
// rather than generic "organic blob" variety:
//  1. The market hub is now offset from the town's own geometric center
//     (hubX/hubY below) -- real medieval towns grew from a market street/
//     square near a gate or river crossing, not from the mathematical
//     middle of the eventual walled area. Streets, the plaza, and every
//     POI-siting distance band are relative to this hub; only the outer
//     boundary silhouette and the wall stay centered on the town's own
//     (cx, cy), since that's what actually has to fit the fixed canvas.
//  2. A dense secondary-lane layer (buildLaneNetwork) fills the gaps
//     between the primary spoke/ring/branch streets with many short,
//     winding, narrow lanes branching off each other and off the main
//     network -- the maze of alleys a real town has, instead of only a
//     handful of wide streets.
//  3. The temple POI is resized and relabeled per tier (Chapel/Church/
//     Cathedral) and sited tight against the hub -- the dominant building
//     next to the market, not a same-sized icon scattered mid-town.
//  4. City tier gets a genuinely distinct castle compound (buildCastle
//     below): its own walled bailey with a dominant keep, sited at the
//     town's highest nearby ground when real backdrop terrain is available
//     (falls back to a random edge point otherwise), nestled into the town
//     wall's own circuit rather than floating as an ordinary POI.
//  5. The main wall is now a faceted polygon (fewer, longer straight
//     segments) with small towers at intervals instead of a smooth curve --
//     reads as a fortification, not a rounded blob.
function deriveSettlementSeed(overworldSeed, idx) {
  const mixSeed = (overworldSeed ^ Math.imul(idx + 1, 0x9e3779b1)) >>> 0;
  const mixRng = mulberry32(mixSeed);
  return Math.floor(mixRng() * 0xffffffff) >>> 0;
}

// Tier drives scale and density, matching the tier already assigned on the
// overworld map: village = small and sparse with no wall; town = denser
// with a wall and a couple of gates; city = densest, walled, more gates,
// and the only tier with its own castle compound.
const SETTLEMENT_TIER_CONFIG = {
  village: { cellCount: 55, radius: 160, spokes: 4, rings: 1, wall: false, gates: 0 },
  town: { cellCount: 120, radius: 200, spokes: 6, rings: 2, wall: true, gates: 2 },
  city: { cellCount: 210, radius: 260, spokes: 8, rings: 3, wall: true, gates: 3 },
};

// Building-tier variety (footprint size band + relative weight), addressing
// "buildings all look identical" -- weights differ per settlement tier
// (village skews hovel-heavy, city skews manor-heavier) and are further
// biased by distance-from-hub at draw time (see generate() below).
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

// Temple label/size by tier -- the church is the dominant building next to
// a real medieval market, not a same-sized icon; city gets "Cathedral" and
// the biggest footprint, village a modest "Chapel".
const TEMPLE_BY_TIER = {
  village: { label: 'Chapel', shrink: 0.90, maxDimFrac: 0.34 },
  town: { label: 'Church', shrink: 0.92, maxDimFrac: 0.38 },
  city: { label: 'Cathedral', shrink: 0.95, maxDimFrac: 0.42 },
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
// polygon's own edges -- turns a raw, amorphous Voronoi cell polygon into
// an actual rectangle (walls/corners a viewer recognizes as a building).
// Cheap at the small vertex counts (4-8) these cell polygons actually have.
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
// still reads as a real footprint, and capped at `maxDim` (when given) so
// an unusually large Voronoi cell (a real occurrence at low cell counts,
// e.g. village tier's 55 cells over a 160px radius) can't produce an
// oversized rectangle that visibly pokes through the town boundary/wall.
// An optional `strokeStyle` outlines the footprint -- a visible wall line
// is what makes a filled rectangle actually read as a structure rather
// than a colored tile. Returns the final {w, h} drawn (post-floor/cap) so
// callers can layer further detail (a roof ridge) at the same scale.
function drawFootprintRect(ctx, rect, shrink, fillStyle, maxDim, strokeStyle) {
  let w = Math.max(4, rect.w * shrink), h = Math.max(4, rect.h * shrink);
  if (maxDim) { w = Math.min(w, maxDim); h = Math.min(h, maxDim); }
  ctx.save();
  ctx.translate(rect.cx, rect.cy);
  ctx.rotate(rect.angle);
  ctx.fillStyle = fillStyle;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.45;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  return { w, h };
}

// A single ridge line down a building's long axis -- the cheapest possible
// "this rectangle has a pitched roof" signal, drawn in the same rotated
// local frame drawFootprintRect used.
function drawRoofRidge(ctx, rect, w, h, strokeStyle) {
  ctx.save();
  ctx.translate(rect.cx, rect.cy);
  ctx.rotate(rect.angle);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  if (w >= h) { ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); } else { ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2); }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Point-in-oriented-rectangle test (rect = {cx, cy, angle}, half-extents
// given separately since callers sometimes want a padded/unpadded test
// against the same rect) -- used for the castle compound's exclusion zone.
function pointInOrientedRect(px, py, rect, halfW, halfH) {
  const dx = px - rect.cx, dy = py - rect.cy;
  const cos = Math.cos(-rect.angle), sin = Math.sin(-rect.angle);
  const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
  return Math.abs(lx) <= halfW && Math.abs(ly) <= halfH;
}

// Short, winding secondary-lane network -- the dense maze of narrow alleys
// a real medieval town has, distinct from the handful of primary spokes/
// rings/branches. Each lane is a multi-segment polyline anchored on an
// existing street (or, with declining probability, on another already-
// placed lane, so the network branches organically rather than every lane
// radiating from the same few anchor points) and rejects any anchor that
// would fall inside the castle compound.
function buildLaneNetwork(rng, anchors, count, insideCastleFn) {
  const lanes = [];
  const pool = anchors.slice();
  for (let i = 0; i < count && pool.length; i++) {
    let start = null;
    for (let tries = 0; tries < 5 && !start; tries++) {
      const candidate = pool[Math.floor(rng() * pool.length)];
      if (!insideCastleFn(candidate.x, candidate.y)) start = candidate;
    }
    if (!start) continue;
    let angle = rng() * Math.PI * 2;
    let x = start.x, y = start.y;
    const segCount = 2 + Math.floor(rng() * 3);
    const points = [{ x, y }];
    for (let s = 0; s < segCount; s++) {
      angle += (rng() - 0.5) * 1.1;
      const len = 12 + rng() * 22;
      x += Math.cos(angle) * len;
      y += Math.sin(angle) * len;
      if (insideCastleFn(x, y)) break;
      points.push({ x, y });
    }
    if (points.length > 1) {
      lanes.push(points);
      if (rng() < 0.55) pool.push(points[points.length - 1]);
    }
  }
  return lanes;
}
function distToPolylines(x, y, polylines) {
  let best = Infinity;
  for (const line of polylines) {
    for (let i = 0; i < line.length - 1; i++) {
      const x1 = line[i].x, y1 = line[i].y, x2 = line[i + 1].x, y2 = line[i + 1].y;
      const dx = x2 - x1, dy = y2 - y1;
      const lenSq = dx * dx + dy * dy || 1;
      let t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t)));
    }
  }
  return best;
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
    // footprint variety, the organic boundary wobble, street jitter, POI
    // siting, the hub offset, the secondary-lane network, and the castle
    // each get their own stream so toggling/regenerating any one of them
    // never perturbs the others or the town layout itself when a theme
    // switch redraws the same seed.
    const meshRng = mulberry32(seed + 77777);
    const wallRng = mulberry32(seed + 991);
    const buildingRng = mulberry32(seed + 55555);
    const boundaryRng = mulberry32(seed + 707070);
    const streetRng = mulberry32(seed + 606060);
    const poiRng = mulberry32(seed + 838383);
    const hubRng = mulberry32(seed + 505050);
    const laneRng = mulberry32(seed + 404040);
    const castleRng = mulberry32(seed + 909090);

    const cx = canvas.width / 2, cy = canvas.height / 2;
    const R = config.radius;
    const streetWidth = Math.max(10, R * 0.045);
    const plazaR = R * 0.08;

    // Market hub: offset from the town's own geometric center -- a real
    // medieval town grew from a market street/square near a gate or river
    // crossing, not from the mathematical middle of the eventual walled
    // area. Every street, the plaza, and every POI/building distance band
    // below is relative to this hub; only the outer boundary silhouette and
    // the wall stay centered on (cx, cy), since that's what has to fit the
    // fixed canvas. Offset capped modestly (12-25% of R) so the hub stays
    // well clear of the wall in every direction.
    const hubOffsetFrac = 0.12 + hubRng() * 0.13;
    const hubAngle0 = hubRng() * Math.PI * 2;
    const hubX = cx + Math.cos(hubAngle0) * R * hubOffsetFrac;
    const hubY = cy + Math.sin(hubAngle0) * R * hubOffsetFrac;

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

    // Organic boundary: a wobbled per-angle radius instead of a hard circle.
    // Same makeRadialWobbleSampler mechanism the overworld already uses for
    // its island coastline. Clamped defensively so no tuning value can ever
    // push the wobbled wall off the fixed 700x700 canvas -- worked out for
    // city tier: R=260 -> max effectiveR ~307 -> wall radius ~322 + half
    // line width ~2.9 = ~325px, vs. 350px half-canvas-extent -- 25px margin
    // before the clamp even engages.
    const wobble = makeRadialWobbleSampler(boundaryRng, 5);
    const WOBBLE_AMP = 0.18;
    function effectiveR(theta) {
      const base = R * (1 + WOBBLE_AMP * wobble(theta)) * coastalMultiplier(theta);
      return Math.min(base, canvas.width / 2 * 0.97);
    }
    // The wall is drawn as a coarse, faceted polygon (WALL_SEGMENTS below,
    // far fewer than the 128-segment boundary silhouette) specifically so
    // it reads as straight wall-runs rather than a smooth curve. But
    // effectiveR's own wobble has real high-frequency content (harmonics up
    // to 6 cycles per revolution) and the coastal recede can itself change
    // sharply where a real coastline curves in tightly -- sampled at only
    // 48 points, either one can create a single-vertex spike that reads as
    // a wall jutting out into open water rather than a natural facet
    // (confirmed directly: an actual seed showed a ~90px radius jump across
    // one 7.5-degree wall segment). wallRAt box-averages effectiveR over a
    // window matching one wall segment's own angular width before applying
    // the 1.05 wall-vs-town-edge offset, damping anything narrower than a
    // single facet while leaving the wall's real, larger-scale shape (and
    // its coastal lean) intact. Used for every wall-radius lookup -- the
    // main stroke, its corner towers, and the gate positions/ticks -- so
    // none of them can land on a spike the others smoothed away.
    const WALL_SEGMENTS = 48;
    const wallSmoothHalfSpan = Math.PI / WALL_SEGMENTS;
    function wallRAt(theta) {
      const samples = 5;
      let sum = 0;
      for (let k = 0; k < samples; k++) {
        const a = theta - wallSmoothHalfSpan + (2 * wallSmoothHalfSpan) * (k / (samples - 1));
        sum += effectiveR(a);
      }
      return (sum / samples) * 1.05;
    }

    // Street skeleton: spokes/rings/branches, all centered on the market
    // hub now rather than the town's own geometric center. Spoke angles
    // are jittered heavily (0.45 of half-spacing) and vary in drawn length
    // rather than all reaching the wall; rings are gapped arcs, not full
    // circles; branch stubs add organic texture off the main network.
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

    const branchCount = Math.max(3, Math.floor(config.spokes * 1.2));
    const branchSegments = [];
    for (let b = 0; b < branchCount; b++) {
      let ax, ay;
      if (streetRng() < 0.6 && spokeAngles.length) {
        const si = Math.floor(streetRng() * spokeAngles.length);
        const angle = spokeAngles[si];
        const t = 0.25 + streetRng() * 0.6;
        const r = effectiveR(angle) * spokeLengthFrac[si] * t;
        ax = hubX + Math.cos(angle) * r; ay = hubY + Math.sin(angle) * r;
      } else if (ringRadii.length) {
        const ri = Math.floor(streetRng() * ringRadii.length);
        const angle = streetRng() * Math.PI * 2;
        if (inRingGap(ri, angle)) continue;
        const r = ringRadiusAt(ri, angle);
        ax = hubX + Math.cos(angle) * r; ay = hubY + Math.sin(angle) * r;
      } else continue;
      const branchAngle = streetRng() * Math.PI * 2;
      const branchLen = R * (0.08 + streetRng() * 0.14);
      branchSegments.push({ x1: ax, y1: ay, x2: ax + Math.cos(branchAngle) * branchLen, y2: ay + Math.sin(branchAngle) * branchLen });
    }
    const branchPolylines = branchSegments.map((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]);
    function distToBranches(x, y) { return distToPolylines(x, y, branchPolylines); }

    // Castle compound (city tier only): its own walled bailey with a
    // dominant keep, sited at the highest nearby ground when real backdrop
    // terrain is available (probing the same way the coastal shaping does,
    // just for elevation instead of water), otherwise a random point on the
    // boundary. Nestled into the town wall's own circuit -- its outer edge
    // sits close to the main wall rather than floating as an ordinary POI.
    let castle = null;
    if (tierKey === 'city') {
      let castleAngle;
      if (sampleGuide) {
        // Probe at TWO radii per angle (not one) and require both solidly
        // above sea level before an angle even qualifies -- a single-point
        // probe can land on a narrow headland/peninsula tip that reads as
        // "high ground" while the town's own footprint there is a thin,
        // unstable spit of land, which sited the castle half over open
        // water in practice. Requiring the inner probe too means the whole
        // area between it and the wall has to be real, solid ground.
        let bestAngle = 0, bestH = -Infinity, qualified = false;
        const probes = 16;
        const margin = 0.1;
        for (let i = 0; i < probes; i++) {
          const angle = (i / probes) * Math.PI * 2;
          const outerR = effectiveR(angle);
          const hOuter = sampleGuide((cx + Math.cos(angle) * outerR * 0.95) / canvas.width, (cy + Math.sin(angle) * outerR * 0.95) / canvas.height);
          const hInner = sampleGuide((cx + Math.cos(angle) * outerR * 0.75) / canvas.width, (cy + Math.sin(angle) * outerR * 0.75) / canvas.height);
          if (hOuter < sea + margin || hInner < sea + margin) continue;
          qualified = true;
          if (hOuter > bestH) { bestH = hOuter; bestAngle = angle; }
        }
        if (!qualified) {
          // No angle had solid ground at both radii (a very water-heavy
          // site) -- fall back to the single best outer-probe reading
          // rather than leaving the castle unplaced.
          for (let i = 0; i < probes; i++) {
            const angle = (i / probes) * Math.PI * 2;
            const r = effectiveR(angle) * 0.95;
            const h = sampleGuide((cx + Math.cos(angle) * r) / canvas.width, (cy + Math.sin(angle) * r) / canvas.height);
            if (h > bestH) { bestH = h; bestAngle = angle; }
          }
        }
        castleAngle = bestAngle;
      } else {
        castleAngle = castleRng() * Math.PI * 2;
      }
      const halfW = R * 0.14, halfH = R * 0.22;
      const outerR = effectiveR(castleAngle);
      const centerDist = outerR - halfW * 0.6;
      castle = {
        cx: cx + Math.cos(castleAngle) * centerDist,
        cy: cy + Math.sin(castleAngle) * centerDist,
        angle: castleAngle,
        halfW, halfH,
      };
    }
    function insideCastle(px, py) {
      if (!castle) return false;
      return pointInOrientedRect(px, py, castle, castle.halfW * 1.15, castle.halfH * 1.15);
    }

    // Secondary lane network: anchored on points sampled along the primary
    // spokes/rings/branches, then branching organically off itself -- the
    // dense maze of narrow alleys a real town has, distinct from the
    // handful of primary streets.
    const laneAnchors = [];
    for (let si = 0; si < spokeAngles.length; si++) {
      const angle = spokeAngles[si];
      for (const t of [0.35, 0.65, 0.9]) {
        const r = effectiveR(angle) * spokeLengthFrac[si] * t;
        laneAnchors.push({ x: hubX + Math.cos(angle) * r, y: hubY + Math.sin(angle) * r });
      }
    }
    for (let ri = 0; ri < ringRadii.length; ri++) {
      for (let s = 0; s < 8; s++) {
        const angle = (s / 8) * Math.PI * 2;
        if (inRingGap(ri, angle)) continue;
        const r = ringRadiusAt(ri, angle);
        laneAnchors.push({ x: hubX + Math.cos(angle) * r, y: hubY + Math.sin(angle) * r });
      }
    }
    const laneCount = Math.max(6, Math.round(config.cellCount / 9));
    const laneNetwork = buildLaneNetwork(laneRng, laneAnchors, laneCount, insideCastle);
    function distToLanes(x, y) { return distToPolylines(x, y, laneNetwork); }

    function distToSpokes(x, y) {
      const dx = x - hubX, dy = y - hubY;
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
    // cheap, sufficient local approximation. Skips a ring at angles inside
    // one of its own gaps, so buildings can legitimately span across a gap.
    function distToRings(x, y) {
      const dx = x - hubX, dy = y - hubY;
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
    // across the whole canvas. Falls back to today's exact flat ground fill
    // when no guide data was supplied (old bookmarked links, or a caller
    // that hasn't been updated -- see views/map-overworld.js).
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

    // Street network: spokes radiating from the hub (uneven length),
    // wobbled concentric rings around the hub (broken into arcs by their
    // own gaps), organic branch stubs, and the dense secondary-lane maze.
    ctx.strokeStyle = palette.street;
    ctx.lineWidth = streetWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let si = 0; si < spokeAngles.length; si++) {
      const angle = spokeAngles[si];
      const len = effectiveR(angle) * spokeLengthFrac[si];
      ctx.beginPath();
      ctx.moveTo(hubX + Math.cos(angle) * plazaR, hubY + Math.sin(angle) * plazaR);
      ctx.lineTo(hubX + Math.cos(angle) * len, hubY + Math.sin(angle) * len);
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
        const x = hubX + Math.cos(angle) * r, y = hubY + Math.sin(angle) * r;
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
    ctx.lineWidth = Math.max(3, streetWidth * 0.32);
    ctx.globalAlpha = 0.85;
    for (const line of laneNetwork) {
      ctx.beginPath();
      ctx.moveTo(line[0].x, line[0].y);
      for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Gate angles computed before buildings/POIs so guard-post siting can
    // require proximity to one -- purely angular, no radius dependency, so
    // wobbling the boundary above can't perturb gate placement or width.
    // Gates live on the town's own wall, so they stay center-relative.
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
    // Boundary containment (dist/eR) is relative to the town's own center
    // (cx, cy) -- that's what the wobbled silhouette is actually defined
    // against. Everything else (street avoidance, the hub-relative distance
    // band `frac` used for both POI siting and building tier) is relative
    // to the market hub, matching how a real town's density/wealth actually
    // radiates from its market rather than from the walled area's centroid.
    function eligibleForPlot(cell) {
      const dx = cell.x - cx, dy = cell.y - cy;
      const distFromCenter = Math.hypot(dx, dy);
      const angleFromCenter = Math.atan2(dy, dx);
      const eR = effectiveR(angleFromCenter);
      if (distFromCenter > eR * 0.9) return null;
      if (insideCastle(cell.x, cell.y)) return null;
      const hdx = cell.x - hubX, hdy = cell.y - hubY;
      const distFromHub = Math.hypot(hdx, hdy);
      if (distFromHub < plazaR) return null;
      if (distToSpokes(cell.x, cell.y) < streetWidth / 2) return null;
      if (distToRings(cell.x, cell.y) < streetWidth / 2) return null;
      if (distToBranches(cell.x, cell.y) < streetWidth * 0.35) return null;
      if (distToLanes(cell.x, cell.y) < streetWidth * 0.22) return null;
      if (cell.polygon.length < 3) return null;
      const frac = Math.max(0, Math.min(1, (distFromHub - plazaR) / Math.max(1, R - plazaR)));
      return { angleFromCenter, frac };
    }

    // Named districts/landmarks (lib/settlement-poi.js) -- sited before
    // ordinary buildings so their cells can be claimed and skipped by that
    // loop. A coastalOnly POI (harbor) is additionally biased toward
    // candidates on the water-facing side (per the same coastal probe used
    // for the boundary), falling back to the full candidate set if none
    // qualify.
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
        if (info.frac < poiType.band[0] || info.frac > poiType.band[1]) continue;
        if (poiType.nearGate && !nearAnyGate(info.angleFromCenter)) continue;
        candidates.push({ cell, angleFromCenter: info.angleFromCenter });
      }
      if (candidates.length === 0) continue;
      let pool = candidates;
      if (poiType.coastalOnly && coastalHeights) {
        const waterFacing = candidates.filter((c) => coastalMultiplier(c.angleFromCenter) < 0.9);
        if (waterFacing.length) pool = waterFacing;
      }
      const cells = pool.map((c) => c.cell);
      cells.sort((a, b) => cellArea(b) - cellArea(a));
      const poolSize = Math.max(1, Math.ceil(cells.length * 0.35));
      const chosen = cells[Math.floor(poiRng() * poolSize)];
      claimedCellIdx.add(chosen.index);
      const displayLabel = poiKey === 'temple' ? TEMPLE_BY_TIER[tierKey].label : poiType.label;
      poiPlaced.push({ cell: chosen, poiKey, poiType, displayLabel });
    }

    // Ordinary buildings: tiered variety (hovel/house/manor) instead of one
    // flat color/shrink range -- weighted per settlement tier, further
    // biased toward manor near the hub and hovel near the edge (wealth/
    // density radiating from the market, the classic historical pattern),
    // with fill color lerping between two hand-picked-per-theme palette
    // endpoints. Drawn as each cell's own oriented bounding rectangle
    // (minAreaRect), not its raw polygon.
    const buildingTiers = BUILDING_TIERS[tierKey] || BUILDING_TIERS.village;
    for (const cell of mesh.cells) {
      if (claimedCellIdx.has(cell.index)) continue;
      const info = eligibleForPlot(cell);
      if (!info) continue;
      const distFrac = info.frac;

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
      const dims = drawFootprintRect(ctx, rect, shrink, lerpBuildingColor(palette.buildingRich, palette.buildingPoor, distFrac), R * 0.3, palette.ink);
      drawRoofRidge(ctx, rect, dims.w, dims.h, palette.ink);
    }

    // POI footprints, drawn after ordinary buildings so they read as
    // visually distinct: a wider shrink (bigger structure), a dedicated
    // fill, an icon glyph, and a text label -- also an oriented rectangle.
    // The temple gets its tier-specific size instead of the shared default.
    ctx.font = `bold 10px ${OW_SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const p of poiPlaced) {
      const rect = minAreaRect(p.cell.polygon);
      const isTemple = p.poiKey === 'temple';
      const shrink = isTemple ? TEMPLE_BY_TIER[tierKey].shrink : 0.85;
      const maxDim = R * (isTemple ? TEMPLE_BY_TIER[tierKey].maxDimFrac : 0.35);
      const dims = drawFootprintRect(ctx, rect, shrink, palette.poiFill, maxDim, palette.ink);
      if (isTemple) drawRoofRidge(ctx, rect, dims.w, dims.h, palette.ink);
      drawSettlementPOIIcon(ctx, p.cell.x, p.cell.y - 8, p.poiType.iconKey, palette.ink);
      ctx.fillStyle = palette.ink;
      ctx.fillText(p.displayLabel, p.cell.x, p.cell.y + 6);
      // Market-day stalls: a handful of small tent triangles scattered
      // just around the square's own footprint -- the single most
      // recognizable "medieval market" visual cue.
      if (p.poiKey === 'market') {
        for (let s = 0; s < 4; s++) {
          const sAngle = (s / 4) * Math.PI * 2 + 0.4;
          const sx = p.cell.x + Math.cos(sAngle) * (dims.w * 0.55);
          const sy = p.cell.y + Math.sin(sAngle) * (dims.h * 0.55);
          ctx.fillStyle = palette.poiFill;
          ctx.globalAlpha = 0.75;
          ctx.beginPath();
          ctx.moveTo(sx - 3, sy + 3); ctx.lineTo(sx, sy - 4); ctx.lineTo(sx + 3, sy + 3);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    ctx.fillStyle = palette.plaza;
    ctx.beginPath();
    ctx.arc(hubX, hubY, plazaR, 0, Math.PI * 2);
    ctx.fill();
    // A well at the market's own center -- a ring plus a crossed bucket-
    // rope, the classic anchor of a real market square, instead of a bare
    // circle of open ground.
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hubX, hubY, plazaR * 0.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hubX - plazaR * 0.32, hubY - plazaR * 0.32); ctx.lineTo(hubX + plazaR * 0.32, hubY + plazaR * 0.32);
    ctx.moveTo(hubX + plazaR * 0.32, hubY - plazaR * 0.32); ctx.lineTo(hubX - plazaR * 0.32, hubY + plazaR * 0.32);
    ctx.stroke();

    // Kitchen-garden/orchard patches: real medieval houses backed onto a
    // garden strip, most visible near the walls where building density
    // thins out -- scattered into the bare band the 0.9 boundary-margin
    // inset already leaves open between the outermost buildings and the
    // wall, rather than a bespoke plot-subdivision system.
    const gardenRng = mulberry32(seed + 606161);
    const gardenClusterCount = Math.round(config.cellCount * 0.12);
    for (let i = 0; i < gardenClusterCount; i++) {
      const angle = gardenRng() * Math.PI * 2;
      const r = effectiveR(angle) * (0.90 + gardenRng() * 0.08);
      const gx = cx + Math.cos(angle) * r, gy = cy + Math.sin(angle) * r;
      if (insideCastle(gx, gy)) continue;
      const dots = 2 + Math.floor(gardenRng() * 3);
      ctx.fillStyle = palette.gardenFill;
      ctx.globalAlpha = 0.5;
      for (let k = 0; k < dots; k++) {
        ctx.beginPath();
        ctx.arc(gx + (gardenRng() - 0.5) * 12, gy + (gardenRng() - 0.5) * 12, 1.6 + gardenRng() * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Castle compound: its own walled bailey (courtyard fill + a distinct
    // toothed wall with corner towers) and a dominant keep -- drawn on top
    // of everything else placed so far, still inside the terrain clip so
    // it reads as sitting in the same ground as the rest of the town.
    if (castle) {
      const c = castle;
      function baileyCorners(padW, padH) {
        const cos = Math.cos(c.angle), sin = Math.sin(c.angle);
        const local = [[-padW, -padH], [padW, -padH], [padW, padH], [-padW, padH]];
        return local.map(([lx, ly]) => ({ x: c.cx + lx * cos - ly * sin, y: c.cy + lx * sin + ly * cos }));
      }
      const corners = baileyCorners(c.halfW, c.halfH);
      ctx.fillStyle = palette.castleFill || palette.plaza;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = palette.wall;
      ctx.lineWidth = Math.max(3, R * 0.02);
      ctx.stroke();
      // Corner towers -- small squares at each bailey corner, same
      // fortified-silhouette language as the main wall's towers below.
      const towerSize = Math.max(6, R * 0.045);
      for (const corner of corners) {
        ctx.fillStyle = palette.wall;
        ctx.fillRect(corner.x - towerSize / 2, corner.y - towerSize / 2, towerSize, towerSize);
      }
      // The keep: a dominant rectangle inside the bailey, set back from the
      // outer (town-wall-facing) edge toward the town side.
      const keepHalfW = c.halfW * 0.42, keepHalfH = c.halfH * 0.55;
      const inward = -c.halfW * 0.25; // pulled toward the town, away from the outer wall
      const cosA = Math.cos(c.angle), sinA = Math.sin(c.angle);
      const keepRect = { cx: c.cx + inward * cosA, cy: c.cy + inward * sinA, angle: c.angle, w: keepHalfW * 2, h: keepHalfH * 2 };
      drawFootprintRect(ctx, keepRect, 1, palette.wall);
      ctx.font = `bold 11px ${OW_SERIF}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = palette.ink;
      ctx.fillText('Castle', c.cx, c.cy + c.halfH + 6);
    }

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
      // Faceted polygon, not a smooth curve -- far fewer segments than the
      // boundary silhouette itself samples, so the wall reads as a
      // fortification with straight wall-runs and corners rather than a
      // rounded blob. Small towers at intervals reinforce that further.
      // Every radius lookup below goes through wallRAt (box-averaged, see
      // its own comment) rather than effectiveR directly, so the main
      // stroke, towers, and gate ticks all agree on the same de-spiked
      // wall line.
      ctx.strokeStyle = palette.wall;
      ctx.lineWidth = Math.max(3, R * 0.022);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      let penDown = false;
      ctx.beginPath();
      for (let i = 0; i <= WALL_SEGMENTS; i++) {
        const angle = (i / WALL_SEGMENTS) * Math.PI * 2;
        const wallR = wallRAt(angle);
        const x = cx + Math.cos(angle) * wallR, y = cy + Math.sin(angle) * wallR;
        if (nearGate(angle)) { penDown = false; continue; }
        if (!penDown) { ctx.moveTo(x, y); penDown = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      const towerEvery = 6;
      const towerSize = Math.max(5, R * 0.03);
      for (let i = 0; i < WALL_SEGMENTS; i += towerEvery) {
        const angle = (i / WALL_SEGMENTS) * Math.PI * 2;
        if (nearGate(angle)) continue;
        const wallR = wallRAt(angle);
        const tx = cx + Math.cos(angle) * wallR, ty = cy + Math.sin(angle) * wallR;
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(angle);
        ctx.fillStyle = palette.wall;
        ctx.fillRect(-towerSize / 2, -towerSize / 2, towerSize, towerSize);
        ctx.restore();
      }
      // Short perpendicular tick at each gate opening, matching the
      // dungeon generator's door-tick convention.
      ctx.lineWidth = Math.max(2, R * 0.016);
      for (const g of gateAngles) {
        const wallR = wallRAt(g);
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
      // above already reads as the town's edge.
      pathFromBoundary();
      ctx.strokeStyle = palette.ink;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Fine parchment-grain texture over the whole finished composition --
    // same helper/convention every other generator here uses (reuses this
    // theme's own overworld.grain tuning rather than inventing a settlement-
    // specific one), unclipped since it's meant to read as the physical
    // page the map is drawn on, not something confined to the town itself.
    const grainRng = mulberry32(seed + 141414);
    paintParchmentGrain(ctx, canvas, grainRng, theme.overworld.grain);

    // Notable-locations panel: plain DOM text below the canvas, not part of
    // the PNG export (matches every other generator's "canvas is the
    // export unit" convention). Regenerated every call so a theme switch
    // never leaves stale entries.
    const poiEl = container.querySelector('#st-poi');
    const panelEntries = poiPlaced.map((p) => `<p>${p.displayLabel}</p>`);
    if (castle) panelEntries.push('<p>Castle</p>');
    if (panelEntries.length) {
      poiEl.innerHTML = `<h3>Notable locations</h3>` + panelEntries.join('');
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
