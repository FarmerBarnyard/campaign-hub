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
// `variant` re-rolls the whole layout without touching the campaign's own
// seed. The service uses it when a render violates a hard rule: the map the
// player's URL points at must stay the same map, so the retry has to change
// the internal streams and nothing else. variant 0 is the identity case and
// hashes exactly as it did before this existed, so no already-generated
// settlement shifts.
function deriveSettlementSeed(overworldSeed, idx, variant) {
  const mixSeed = (overworldSeed ^ Math.imul(idx + 1, 0x9e3779b1)) >>> 0;
  const withVariant = variant ? (mixSeed ^ Math.imul(variant, 0x85ebca6b)) >>> 0 : mixSeed;
  const mixRng = mulberry32(withVariant);
  return Math.floor(mixRng() * 0xffffffff) >>> 0;
}

// Tier drives scale and density, matching the tier already assigned on the
// overworld map: village = small and sparse with no wall; town = denser
// with a wall and a couple of gates; city = densest, walled, more gates,
// and the only tier with its own castle compound.
// The settlement canvas is square and fixed-size. Named here rather than
// left as a bare literal in the markup because views/map-overworld.js
// needs it too, to convert a tier's radius (settlement pixels, below)
// into real overworld distance when checking whether a candidate site
// has enough land to hold that tier at all.
const SETTLEMENT_CANVAS_SIZE = 700;

// cellCount is the plot mesh, and it caps how many buildings a settlement can
// ever have. These were tuned back when a building could be drawn far larger
// than its own cell, so a coarse mesh still filled the map; now that
// fitRectToPolygon confines each building to its cell, a coarse mesh just
// yields a handful of oversized houses. A headless audit measured 15
// buildings in a town and 35 in a city -- against real reference maps where
// even a village shows ~20. Raised so the mesh is no longer the constraint;
// render cost is no longer a reason to keep it low now that generation runs
// server-side and is cached.
const SETTLEMENT_TIER_CONFIG = {
  // minBuildings is the floor the street-frontage filter must not push the
  // town below (the low end of RULES.md C2's per-tier band) -- see the
  // frontage/backland split in the building loop.
  // Village cell count raised again after the lobed outline landed: a 200-seed
  // audit found five villages holding only 5 buildings against a 6-20 band.
  // The cause is not the minimum-building fallback but the pool it draws from
  // -- on a tight village site, street clearance and the narrower lobes
  // between roads left fewer eligible cells in total than the floor asked
  // for, so there was nothing left to admit.
  village: { cellCount: 180, radius: 160, spokes: 4, rings: 1, wall: false, gates: 0, minBuildings: 8 },
  town: { cellCount: 320, radius: 200, spokes: 6, rings: 2, wall: true, gates: 2, minBuildings: 28 },
  city: { cellCount: 560, radius: 260, spokes: 8, rings: 3, wall: true, gates: 3, minBuildings: 65 },
};

// Building-tier variety (footprint size band + relative weight), addressing
// "buildings all look identical" -- weights differ per settlement tier
// (village skews hovel-heavy, city skews manor-heavier) and are further
// biased by distance-from-hub at draw time (see generate() below). Shrink
// ranges are deliberately tight (buildings fill most of their own cell)
// rather than the old 0.55-0.88 range that left a big gap around every
// building on all sides -- real medieval buildings pack edge-to-edge in
// dense blocks (confirmed against an actual historic town plan and a
// medieval-city generator built on real urban-form research), with the
// only real open space being the streets themselves. The thin gap that
// remains between neighbors here comes from fitRectToPolygon's own
// per-cell fit correction, not from a uniform shrink -- so it reads as a
// party wall, not a plaza around every house.
const BUILDING_TIERS = {
  village: [
    { key: 'hovel', weight: 0.60, shrink: [0.80, 0.90] },
    { key: 'house', weight: 0.38, shrink: [0.86, 0.94] },
    { key: 'manor', weight: 0.02, shrink: [0.90, 0.97] },
  ],
  town: [
    { key: 'hovel', weight: 0.40, shrink: [0.80, 0.90] },
    { key: 'house', weight: 0.50, shrink: [0.86, 0.94] },
    { key: 'manor', weight: 0.10, shrink: [0.90, 0.97] },
  ],
  city: [
    { key: 'hovel', weight: 0.30, shrink: [0.80, 0.90] },
    { key: 'house', weight: 0.52, shrink: [0.86, 0.94] },
    { key: 'manor', weight: 0.18, shrink: [0.90, 0.97] },
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

// Village's sparse-cluster ordinary buildings (see generate() below) are
// all one plain "Cottage" -- no wealth-gradient hovel/house/manor mix,
// matching a real village's own uniformity next to its handful of named
// buildings (Inn, Smithy, etc.).
const VILLAGE_COTTAGE_SHRINK = [0.82, 0.93];

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

// The bounding rectangle of `poly` when projected onto the axis pair at
// `angle` -- turns a raw, amorphous Voronoi cell polygon into an actual
// rectangle (walls/corners a viewer recognizes as a building) at
// whichever angle the caller wants it to face (e.g. "the nearest road"),
// not necessarily the cell's own area-minimizing orientation. Cheap at
// the small vertex counts (4-8) these cell polygons actually have.
function projectPolyAtAngle(poly, angle) {
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    const rx = p.x * cos - p.y * sin;
    const ry = p.x * sin + p.y * cos;
    if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
  }
  const w = maxX - minX, h = maxY - minY;
  const ccx = (minX + maxX) / 2, ccy = (minY + maxY) / 2;
  const cosB = Math.cos(angle), sinB = Math.sin(angle);
  return { area: w * h, w, h, angle, cx: ccx * cosB - ccy * sinB, cy: ccx * sinB + ccy * cosB };
}

// Named pointInPolygonXY, not pointInPolygon -- lib/terrain-grid.js already
// defines a global pointInPolygon(pt, poly) taking a point OBJECT, used by
// groupChainsIntoLoops. Every generator script shares one global namespace
// (plain <script> tags, no modules), and this file loads after terrain-
// grid.js, so a same-named function here silently overwrote that earlier
// one for every caller anywhere in the app, not just this file -- confirmed
// live: groupChainsIntoLoops crashed on `poly.length` of undefined, because
// its call passed (point, polygon) into what had quietly become THIS
// function's (x, y, polygon) signature. Not a headless-only bug -- this
// would break in the browser too, on any page load where terrain-grid's
// pointInPolygon is called after map-settlement.js has loaded, which is
// every page load in this single-page app. A distinct name is the fix, not
// a shared signature -- the two callers want different argument shapes for
// good reason (this one already has x/y unpacked from rectCornersAtScale).
function pointInPolygonXY(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function rectCornersAtScale(rect, scale) {
  const w = rect.w * scale, h = rect.h * scale;
  const cos = Math.cos(rect.angle), sin = Math.sin(rect.angle);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map(([lx, ly]) => ({ x: rect.cx + lx * cos - ly * sin, y: rect.cy + lx * sin + ly * cos }));
}

// Shrinks a building's rectangle until it lies wholly inside its OWN Voronoi
// cell. That containment is what actually guarantees buildings don't overlap:
// Voronoi cells tile the plane without overlapping, so two rects each
// contained in their own cell cannot intersect, whatever angle they were
// projected at.
//
// The previous version compared the rect's AREA against the cell's and
// scaled by the ratio, which is not the same thing and does not guarantee
// anything -- a headless audit over 12 seeds found plot overlaps on 8 of
// them, up to 14 collisions on a single city, because an area-ratio test
// says nothing about where the corners actually land. It got worse once
// rects started being projected at a road-facing angle rather than their own
// area-minimising one, since that angle can push corners much further into a
// neighbour. Binary search on the scale is exact, cheap (12 iterations of
// four point-in-polygon tests) and needs no tuning constant.
function fitRectToPolygon(rect, polygon) {
  if (!polygon || polygon.length < 3 || rect.w <= 0 || rect.h <= 0) return rect;
  const fits = (scale) => rectCornersAtScale(rect, scale).every((c) => pointInPolygonXY(c.x, c.y, polygon));
  if (fits(1)) return rect;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return { ...rect, w: rect.w * lo, h: rect.h * lo };
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
    // Alpha raised from the original 0.45 -- with buildings now packed
    // much closer together, this outline is what reads as the party-wall
    // line between neighbors, not just a soft edge on an isolated shape.
    ctx.globalAlpha = 0.6;
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
// Each lane connects one anchor to a nearby OTHER anchor with a gently
// wobbled path, rather than random-walking off from a single anchor in an
// arbitrary direction for a few segments.
//
// A random walk has no relationship to anything else on the map: it starts
// somewhere and wanders off in a direction picked independently of every
// other street, so it crosses spokes, rings, branches and other lanes
// wherever it happens to land -- confirmed directly as the cause of a
// "roads overlapping with no general reason" complaint, visible as a tangle
// of lines crossing at arbitrary angles with no junction. A path that
// actually runs FROM one real point TO another nearby one reads as an alley
// connecting two things (which is what a lane is), and is bounded by the
// distance between its two endpoints rather than open-ended, so it can't
// wander arbitrarily far off from where it started either.
// `laneChance` is a PROBABILITY per anchor, not a total lane count. A fixed
// count was tried first and made coverage worse the moment an interior
// scatter of anchors was added to fix a DIFFERENT gap (see the caller): with
// a fixed total budget, more anchors in the pool just meant each existing
// connection was drawn from a larger, more diluted set, so lanes drifted
// toward connecting scattered interior points to each other and away from
// the areas that actually needed a nearby street. A per-anchor probability
// scales naturally instead -- doubling the anchor density roughly doubles
// the number of lanes drawn, so adding anchors to cover a previously-bare
// area actually covers it, rather than spreading a constant budget thinner.
function buildLaneNetwork(rng, anchors, laneChance, insideCastleFn) {
  const lanes = [];
  if (anchors.length < 2) return lanes;
  // Visited once each, in a shuffled order (not `count` random draws WITH
  // replacement from the pool) -- so density depends only on anchor spacing
  // and laneChance, never on how many anchors happen to exist.
  const order = anchors.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
  }
  for (const idx of order) {
    if (rng() > laneChance) continue;
    const a = anchors[idx];
    if (insideCastleFn(a.x, a.y)) continue;
    // The few nearest OTHER anchors, not always the single nearest -- an
    // occasional longer connection reads as irregular rather than every
    // lane being exactly the same short length.
    const near = anchors
      .filter((p) => p !== a)
      .map((p) => ({ p, d: Math.hypot(p.x - a.x, p.y - a.y) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 5);
    if (!near.length) continue;
    const b = near[Math.floor(rng() * near.length)].p;
    if (insideCastleFn(b.x, b.y)) continue;

    const segCount = 2 + Math.floor(rng() * 2);
    const points = [{ x: a.x, y: a.y }];
    const perp = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
    for (let s = 1; s <= segCount; s++) {
      const t = s / segCount;
      const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      // Pinned exactly at 0 on the last point, so the lane actually arrives
      // at its destination anchor instead of wobbling past it.
      const wobble = s === segCount ? 0 : (rng() - 0.5) * 2 * 12;
      points.push({ x: px + Math.cos(perp) * wobble, y: py + Math.sin(perp) * wobble });
    }
    lanes.push(points);
  }
  return lanes;
}
// `withAngle` (used by the road-facing building orientation below) also
// returns the closest segment's own direction -- the road's local tangent
// at the nearest point -- so a caller can orient a building to run
// parallel/perpendicular to the road there, not just know how far away it
// is. Default (no third arg) keeps returning a plain number, so every
// existing eligibleForPlot call site is unaffected.
function distToPolylines(x, y, polylines, withAngle) {
  let best = Infinity, bestAngle = 0;
  for (const line of polylines) {
    for (let i = 0; i < line.length - 1; i++) {
      const x1 = line[i].x, y1 = line[i].y, x2 = line[i + 1].x, y2 = line[i + 1].y;
      const dx = x2 - x1, dy = y2 - y1;
      const lenSq = dx * dx + dy * dy || 1;
      let t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t));
      if (d < best) { best = d; bestAngle = Math.atan2(dy, dx); }
    }
  }
  return withAngle ? { dist: best, angle: bestAngle } : best;
}

const COMPASS_DIRS = ['East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest', 'North', 'Northeast'];

// Compass bearing of (dx, dy) from the town centre, in canvas coordinates
// where +y points down -- so North is negative dy. Used to tell apart two
// instances of the same POI type (the city's two gate guard posts).
//
// `taken` makes the result unique rather than merely likely to be: two gates
// can fall in the same octant, which would put the identical name on the map
// twice all over again. On a clash it steps out to the neighbouring octants,
// nearest first, so the name stays a truthful description of roughly where
// the building is.
function compassOf(dx, dy, taken) {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;      // 0 = East, +90 = South
  const base = (Math.round(deg / 45) + 8) % 8;
  if (!taken) return COMPASS_DIRS[base];
  for (const step of [0, 1, -1, 2, -2, 3, -3, 4]) {
    const dir = COMPASS_DIRS[(base + step + 8) % 8];
    if (!taken.has(dir)) return dir;
  }
  return COMPASS_DIRS[base];
}

function renderSettlementMap(container, params) {
  const overworldSeed = parseInt(params.get('seed'), 10) || 1;
  const idx = parseInt(params.get('idx'), 10) || 0;
  const name = params.get('name') || 'Unnamed settlement';
  const tierKey = SETTLEMENT_TIER_CONFIG[params.get('tier')] ? params.get('tier') : 'village';
  const config = SETTLEMENT_TIER_CONFIG[tierKey];
  // Set only by the render service's rule-violation retry, never by a user
  // link -- absent, this is 0 and the layout is the canonical one.
  const variant = parseInt(params.get('variant'), 10) || 0;
  const seed = deriveSettlementSeed(overworldSeed, idx, variant);

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
      <canvas id="st-canvas" width="${SETTLEMENT_CANVAS_SIZE}" height="${SETTLEMENT_CANVAS_SIZE}"></canvas>
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

  // async + yieldToPaint (lib/generation-progress.js) so the progress
  // overlay can repaint between phases -- see showGenerationProgress's own
  // header comment for why this exists.
  async function generate() {
    const progress = showGenerationProgress(canvas, 'Laying out streets…');
    const theme = MAP_THEMES[container.querySelector('#st-theme').value] || MAP_THEMES[MAP_THEME_DEFAULT];
    const palette = theme.settlement;

    // Dedicated rng streams, same isolation convention as the overworld/
    // dungeon generators: mesh geometry, wall-gate placement, building
    // footprint variety, the organic boundary wobble, street jitter, POI
    // siting, the hub offset, the secondary-lane network, and the castle
    // each get their own stream so toggling/regenerating any one of them
    // never perturbs the others or the town layout itself when a theme
    // switch redraws the same seed. roadRng is dedicated to the organic-
    // road ribbon's own cosmetic width jitter (lib/organic-roads.js),
    // isolated from streetRng's geometry rolls above it.
    const meshRng = mulberry32(seed + 77777);
    const wallRng = mulberry32(seed + 991);
    const buildingRng = mulberry32(seed + 55555);
    const boundaryRng = mulberry32(seed + 707070);
    const streetRng = mulberry32(seed + 606060);
    const poiRng = mulberry32(seed + 838383);
    const hubRng = mulberry32(seed + 505050);
    const laneRng = mulberry32(seed + 404040);
    const castleRng = mulberry32(seed + 909090);
    const roadRng = mulberry32(seed + 202020);
    const countryRng = mulberry32(seed + 313131);

    let cx = canvas.width / 2, cy = canvas.height / 2;
    const R = config.radius;
    const streetWidth = Math.max(10, R * 0.045);
    const plazaR = R * 0.08;

    // Re-center on the local land mass before anything else is laid out.
    // The overworld guarantees a settlement's own cell is land, but says
    // nothing about the land AROUND it -- a town sited on a headland or
    // just inside a bay has the canvas center sitting near the shore,
    // with usable ground only off to one side. Left uncorrected, the
    // town's circular footprint hangs half over water: before the
    // shoreline fitting below existed it simply drew over the sea, and
    // with it, the town collapses to a lopsided crescent pinned to one
    // edge. Shifting the center toward the centroid of nearby land (only
    // partway, and clamped) gives the settlement the best-fitting spot on
    // the ground it actually has. Inland towns have a centroid
    // essentially at the center already, so they don't move at all.
    if (sampleGuide) {
      const probeR = R * 1.2;
      let sumX = 0, sumY = 0, landSamples = 0;
      for (let dy = -probeR; dy <= probeR; dy += 8) {
        for (let dx = -probeR; dx <= probeR; dx += 8) {
          if (dx * dx + dy * dy > probeR * probeR) continue;
          const px = cx + dx, py = cy + dy;
          if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
          if (sampleGuide(px / canvas.width, py / canvas.height) < sea + 0.02) continue;
          sumX += px; sumY += py; landSamples++;
        }
      }
      if (landSamples > 20) {
        let ox = sumX / landSamples - cx, oy = sumY / landSamples - cy;
        const shift = Math.hypot(ox, oy), maxShift = R * 0.55;
        if (shift > maxShift) { ox = (ox / shift) * maxShift; oy = (oy / shift) * maxShift; }
        // Then clamped to keep the town's full extent on the canvas --
        // an unclamped shift toward a landmass that runs off one side
        // walks the settlement straight off the edge with its buildings
        // cut in half by the frame.
        const edgePad = R;
        cx = Math.max(edgePad, Math.min(canvas.width - edgePad, cx + ox));
        cy = Math.max(edgePad, Math.min(canvas.height - edgePad, cy + oy));
      }
    }

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

    // Shoreline fitting: march outward from the town center along a ring
    // of rays and record how far the land ACTUALLY extends before it
    // drops below sea level, then cap the town's radius at that distance
    // per angle. Replaces a coarse 16-point ring probe that only scaled
    // the radius by a smoothstepped 0.45-1.0 factor -- that was still an
    // approximation of the coastline rather than the coastline itself, so
    // a coastal town's footprint routinely ran well past the real shore
    // and had to be clipped away, leaving a lopsided half-town. Fitting
    // the radius to the measured shore distance instead means the
    // settlement SITS ON the headland/inlet it was placed in, complete,
    // at whatever size that land actually supports.
    const SHORE_PROBE_ANGLES = 64;
    const SHORE_STEP = 4;   // px per march step -- fine enough for a 160-260px radius
    const SHORE_INSET = 10; // hold the town edge just back from the waterline itself
    let shoreLimit = null;
    if (sampleGuide) {
      const maxProbe = R * 1.25;
      const raw = new Float64Array(SHORE_PROBE_ANGLES);
      for (let i = 0; i < SHORE_PROBE_ANGLES; i++) {
        const angle = (i / SHORE_PROBE_ANGLES) * Math.PI * 2;
        const ca = Math.cos(angle), sa = Math.sin(angle);
        let d = SHORE_STEP;
        while (d <= maxProbe) {
          if (sampleGuide((cx + ca * d) / canvas.width, (cy + sa * d) / canvas.height) < sea + 0.02) break;
          d += SHORE_STEP;
        }
        // Floored so a town sited right at a waterline still gets a real
        // (if small) footprint rather than collapsing to nothing.
        raw[i] = Math.max(R * 0.25, d - SHORE_INSET);
      }
      // One smoothing pass around the ring, same reasoning as wallRAt's
      // box-average below: a single narrow inlet shouldn't carve a
      // one-sample spike out of the boundary.
      shoreLimit = new Float64Array(SHORE_PROBE_ANGLES);
      for (let i = 0; i < SHORE_PROBE_ANGLES; i++) {
        const prev = raw[(i - 1 + SHORE_PROBE_ANGLES) % SHORE_PROBE_ANGLES];
        const next = raw[(i + 1) % SHORE_PROBE_ANGLES];
        shoreLimit[i] = (prev + raw[i] * 2 + next) / 4;
      }
    }
    function shoreLimitAt(theta) {
      if (!shoreLimit) return Infinity;
      const f = (((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * SHORE_PROBE_ANGLES;
      const i0 = Math.floor(f) % SHORE_PROBE_ANGLES;
      const i1 = (i0 + 1) % SHORE_PROBE_ANGLES;
      const t = f - Math.floor(f);
      return shoreLimit[i0] * (1 - t) + shoreLimit[i1] * t;
    }
    // "How much does the land run out in this direction, relative to the
    // town's nominal radius" -- 1 means open land all the way out, lower
    // means the shore cuts in. Used for water-facing POI siting (harbor).
    function waterFacingScore(theta) {
      if (!shoreLimit) return 1;
      return Math.min(1, shoreLimitAt(theta) / R);
    }

    // Organic boundary: a wobbled per-angle radius instead of a hard circle.
    // Same makeRadialWobbleSampler mechanism the overworld already uses for
    // its island coastline. Clamped defensively so no tuning value can ever
    // push the wobbled wall off the fixed 700x700 canvas -- worked out for
    // city tier: R=260 -> max effectiveR ~307 -> wall radius ~322 + half
    // line width ~2.9 = ~325px, vs. 350px half-canvas-extent -- 25px margin
    // before the clamp even engages.
    const wobble = makeRadialWobbleSampler(boundaryRng, 5);
    const WOBBLE_AMP = 0.10;

    // The town's outline is a consequence of its roads, not a wobbled circle.
    //
    // This used to be R * (1 + 0.18 * wobble) -- an 18% ripple on a disc,
    // with smooth low harmonics. A contact sheet of 24 settlements made the
    // result plain: every one of them, village through city, was the same
    // round blob, which is the single strongest "generated" tell on the map.
    // Real settlements grow OUT ALONG their approach roads and stay thin
    // between them (ribbon development), so the silhouette is lobed, and the
    // lobes line up with the streets because the streets are why they exist.
    //
    // So the growth axes are generated first and the roads are then run down
    // them, rather than a circle being drawn and spokes laid over it. This is
    // also expected to do most of the work for RULES.md B4: buildings sit in
    // the lobes because that is where the town is, and the lobes are exactly
    // where the roads are.
    // Road bearings are spaced by random gaps rather than evenly around the
    // circle. Evenly-spaced axes plus symmetric lobes produced a tidy flower:
    // the first version of this replaced "every town is a disc" with "every
    // town is a four-petal clover", which is the same fault wearing a
    // different shape. Real bearings bunch and leave wide empty quadrants.
    const rawGaps = [];
    let gapTotal = 0;
    for (let i = 0; i < config.spokes; i++) {
      const g = 0.4 + boundaryRng() * 1.6;
      rawGaps.push(g);
      gapTotal += g;
    }
    const growthAxes = [];
    let acc = boundaryRng() * Math.PI * 2;
    for (let i = 0; i < config.spokes; i++) {
      acc += (rawGaps[i] / gapTotal) * Math.PI * 2;
      growthAxes.push({
        angle: acc,
        // Roads are not equals: a couple are the trade route the town lives
        // on and reach far, the rest are lanes that peter out. Without this
        // spread the lobes come out even and it reads as a cog, not a town.
        strength: 0.30 + boundaryRng() * 0.80,
        // Asymmetric: the built-up band along a road is wider on one side
        // than the other, which is what stops each lobe reading as a petal.
        sigmaL: 0.26 + boundaryRng() * 0.34,
        sigmaR: 0.26 + boundaryRng() * 0.34,
      });
    }

    // A whole-town lean. Settlements are rarely symmetric about their market:
    // they sit downhill, downriver, or on the landward side of a harbour, and
    // this one low-frequency term does more to kill the "grown in a dish"
    // look than any amount of edge noise.
    const driftAngle = boundaryRng() * Math.PI * 2;
    const driftAmp = 0.10 + boundaryRng() * 0.14;

    const LOBE_FLOOR = 0.62;   // how far the town reaches between its roads
    function lobeFactor(theta) {
      let f = LOBE_FLOOR;
      for (const ax of growthAxes) {
        let d = (theta - ax.angle) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        const s = d >= 0 ? ax.sigmaR : ax.sigmaL;
        f = Math.max(f, LOBE_FLOOR + ax.strength * Math.exp(-(d * d) / (2 * s * s)));
      }
      return f * (1 + driftAmp * Math.cos(theta - driftAngle));
    }

    // Area normalisation, and the reason this change can't repeat the
    // starve-then-overcorrect cycle this generator has already been through
    // twice. A lobed outline encloses less than the disc it replaces, which
    // would quietly cut the buildable cell count and push building counts
    // back under their C2 bands. Scaling by the RMS of the lobe factor holds
    // the enclosed area to exactly what the old circle had, so tier density
    // is unchanged by construction rather than by retuning afterwards.
    let lobeSumSq = 0;
    const LOBE_SAMPLES = 256;
    for (let i = 0; i < LOBE_SAMPLES; i++) {
      const f = lobeFactor((i / LOBE_SAMPLES) * Math.PI * 2);
      lobeSumSq += f * f;
    }
    const lobeNorm = 1 / Math.sqrt(lobeSumSq / LOBE_SAMPLES);

    function effectiveR(theta) {
      const base = R * lobeFactor(theta) * lobeNorm * (1 + WOBBLE_AMP * wobble(theta));
      return Math.min(base, shoreLimitAt(theta), canvas.width / 2 * 0.97);
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
    // Spokes ARE the growth axes that shaped the outline above -- the road
    // came first and the town spread along it. Generating the two
    // independently (as before) is what put streets at angles unrelated to
    // the town's own shape.
    const spokeAngles = growthAxes.map((ax) => ax.angle);
    // A strong axis reached further, so its road runs the full length of the
    // lobe it created; weak ones stop short of the edge.
    const spokeLengthFrac = growthAxes.map((ax) => Math.min(1, 0.62 + ax.strength * 0.42));
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

    // Kept off the market hub's own doorstep. Every spoke converges there
    // and every ring is tightest there, so that small area is already where
    // the primary street pattern is at its densest -- branches and lanes
    // anchored that close, then flung off in a random direction, piled MORE
    // uncoordinated line-work directly on top of it. RULES.md's building
    // clearance rejects a cell within reach of ANY of the four street
    // layers, and near the hub a cell is within reach of several of them at
    // once, so nothing could ever clear all four: a render crop showed a
    // wide ring of open, textured ground immediately around the plaza with
    // not one building on it, tangled with roads crossing each other with
    // no junction. Keeping secondary infill off this band fixes both at
    // once -- less overlapping line-work, and the primary spokes/rings
    // already passing through are enough on their own to make that band
    // buildable again.
    // A village has only 4 spokes and 1 ring, so its branches and lanes are
    // doing far more of the "give a building something to front" work than
    // a city's -- which has 8 spokes and 3 rings of primary street to spare.
    // The same absolute exclusion radius that suits a dense city core costs
    // a village proportionally much more of its already-thin network, which
    // measured out as village street frontage falling well below its
    // pre-fix baseline. Smaller for smaller tiers instead.
    const hubClutterR = Math.max(plazaR * 2.5, R * (tierKey === 'village' ? 0.09 : 0.14));
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
      if (Math.hypot(ax - hubX, ay - hubY) < hubClutterR) continue;
      const branchAngle = streetRng() * Math.PI * 2;
      const branchLen = R * (0.08 + streetRng() * 0.14);
      branchSegments.push({ x1: ax, y1: ay, x2: ax + Math.cos(branchAngle) * branchLen, y2: ay + Math.sin(branchAngle) * branchLen });
    }
    const branchPolylines = branchSegments.map((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]);
    function distToBranches(x, y, withAngle) { return distToPolylines(x, y, branchPolylines, withAngle); }

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
    // Back lanes out in the flanks of each lobe.
    //
    // Every anchor above sits ON an existing street, so the lanes drawn
    // between them only ever thread the gaps near the middle of the town.
    // The buildings that fail RULES.md B4 are not there -- they are out on
    // the shoulders of each growth lobe, which had no street of any kind
    // within reach. That is the measurable half of the "same spiderweb every
    // time" complaint: one high street per lobe and nothing behind it.
    //
    // Anchoring laterally off each spoke gives the lanes somewhere to go, and
    // matches how ribbon development actually works -- a road, the frontages
    // along it, and back lanes serving the plots behind them.
    for (let si = 0; si < spokeAngles.length; si++) {
      const angle = spokeAngles[si];
      const perp = angle + Math.PI / 2;
      for (const t of [0.3, 0.55, 0.8]) {
        const r = effectiveR(angle) * spokeLengthFrac[si] * t;
        for (const side of [-1, 1]) {
          const off = r * (0.28 + laneRng() * 0.30) * side;
          const px = hubX + Math.cos(angle) * r + Math.cos(perp) * off;
          const py = hubY + Math.sin(angle) * r + Math.sin(perp) * off;
          // Only if it actually lands inside the town -- the lobes are
          // narrow between the roads, so a lateral offset can easily fall
          // outside the boundary and would drag a lane out over open ground.
          const pr = Math.hypot(px - cx, py - cy);
          if (pr < effectiveR(Math.atan2(py - cy, px - cx)) * 0.88) {
            laneAnchors.push({ x: px, y: py });
          }
        }
      }
    }

    // A scatter of anchors across the open interior, not just points sitting
    // ON an existing street. buildLaneNetwork now connects each anchor to a
    // nearby OTHER anchor rather than random-walking off in an arbitrary
    // direction (see its own header comment) -- which fixed the senseless
    // overlapping crossings, but left every lane joining two points that
    // were already close to a primary street. The interior of an open block,
    // with no anchor of its own, got no lane reaching into it at all: a
    // 24-seed audit measured street frontage falling from 67% to 42% the
    // moment the random walk (which could wander into such a gap by
    // accident) was replaced. These scattered points give the connector
    // something to reach into, so lane coverage spreads across the town's
    // open ground instead of clustering only near infrastructure that
    // already has it.
    const interiorScatter = Math.round(config.cellCount * (tierKey === 'village' ? 0.34 : 0.26));
    for (let i = 0; i < interiorScatter; i++) {
      const angle = laneRng() * Math.PI * 2;
      const r = hubClutterR + laneRng() * (R - hubClutterR) * 0.95;
      const px = hubX + Math.cos(angle) * r, py = hubY + Math.sin(angle) * r;
      const pr = Math.hypot(px - cx, py - cy);
      if (pr < effectiveR(Math.atan2(py - cy, px - cx)) * 0.88) {
        laneAnchors.push({ x: px, y: py });
      }
    }

    // See hubClutterR above -- lanes rooted this close to the hub only
    // added to the tangle sitting on top of the primary spoke/ring pattern
    // that already converges there.
    const laneAnchorsClear = laneAnchors.filter((p) => Math.hypot(p.x - hubX, p.y - hubY) >= hubClutterR);
    // A probability, not a count -- see buildLaneNetwork's own header. Tuned
    // so a typical anchor has roughly even odds of getting a lane; density
    // then comes from how many anchors there are; not from this number.
    const laneNetwork = buildLaneNetwork(laneRng, laneAnchorsClear, tierKey === 'village' ? 0.8 : 0.7, insideCastle);
    function distToLanes(x, y, withAngle) { return distToPolylines(x, y, laneNetwork, withAngle); }

    // `withAngle` returns the spoke's own direction (spokes run dead
    // straight out from the hub at that fixed angle, so it IS the road's
    // tangent at the closest point) -- used to orient a building's rect to
    // run parallel/perpendicular to whichever road it's actually nearest.
    function distToSpokes(x, y, withAngle) {
      const dx = x - hubX, dy = y - hubY;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) return withAngle ? { dist: 0, angle: 0 } : 0;
      const angle = Math.atan2(dy, dx);
      let best = Infinity, bestAngle = 0;
      for (const spokeAngle of spokeAngles) {
        let diff = Math.abs(angle - spokeAngle) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        const d = Math.abs(dist * Math.sin(diff));
        if (d < best) { best = d; bestAngle = spokeAngle; }
      }
      return withAngle ? { dist: best, angle: bestAngle } : best;
    }
    // Samples the wobbled ring radius at the query point's own angle -- a
    // cheap, sufficient local approximation. Skips a ring at angles inside
    // one of its own gaps, so buildings can legitimately span across a gap.
    // `withAngle`'s tangent to a ring (a circle centered on the hub) at a
    // given angle is perpendicular to the radius there, i.e. angle+90deg.
    function distToRings(x, y, withAngle) {
      const dx = x - hubX, dy = y - hubY;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      let best = Infinity, bestAngle = 0;
      for (let i = 0; i < ringRadii.length; i++) {
        if (inRingGap(i, angle)) continue;
        const d = Math.abs(dist - ringRadiusAt(i, angle));
        if (d < best) { best = d; bestAngle = angle + Math.PI / 2; }
      }
      return withAngle ? { dist: best, angle: bestAngle } : best;
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
    // The town's own outline, reported so rules can reason about what is
    // inside the settlement versus out in the countryside (RULES.md C1/C3).
    if (typeof isTracing === 'function' && isTracing()) {
      traceShape('boundary', { loop: townBoundaryLoop.map((p) => ({ x: p.x, y: p.y })) });
    }
    function pathFromBoundary() {
      ctx.beginPath();
      ctx.moveTo(townBoundaryLoop[0].x, townBoundaryLoop[0].y);
      for (let i = 1; i < townBoundaryLoop.length; i++) ctx.lineTo(townBoundaryLoop[i].x, townBoundaryLoop[i].y);
      ctx.closePath();
    }
    // Intersects the current clip with the REAL land contour (the same
    // beachLoops renderTerrainPatch's own isGroundAt tests against), so
    // the settlement stops exactly where the terrain does. No-op without
    // a terrain backdrop. `terrainResult` is assigned further down but
    // every call site runs after that, so the hoisted declaration is safe.
    function clipToRealLand() {
      if (!terrainResult || !terrainResult.beachLoops || !terrainResult.beachLoops.length) return;
      const landPath = new Path2D();
      for (const loop of terrainResult.beachLoops) {
        if (!loop.length) continue;
        landPath.moveTo(loop[0].x, loop[0].y);
        for (let i = 1; i < loop.length; i++) landPath.lineTo(loop[i].x, loop[i].y);
        landPath.closePath();
      }
      ctx.clip(landPath, 'evenodd');
    }

    // Surrounding terrain: reuses views/map-detail.js's renderTerrainPatch
    // exactly as views/map-landmark.js does, painting real backdrop terrain
    // across the whole canvas. Falls back to today's exact flat ground fill
    // when no guide data was supplied (old bookmarked links, or a caller
    // that hasn't been updated -- see views/map-overworld.js).
    await yieldToPaint();
    progress.update(0.3, 'Painting terrain…');
    let terrainResult = null;
    if (sampleGuide) {
      terrainResult = renderTerrainPatch(ctx, canvas, { seed, sea, targetAvgHeight, targetAvgMoisture, sampleGuide, zone: null, palette: theme.overworld });
    } else {
      ctx.fillStyle = palette.ground;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // No real backdrop terrain to hachure onto here -- renderTerrainPatch
      // (the branch above) already textures its own patch via
      // paintHachureField, per its own header comment: "EVERY square inch of
      // ground on a real WotC map carries dense ink dashes... not a flat
      // biome color with a light noise grain." This fallback path skipped
      // that entirely, leaving the countryside with nothing but this flat
      // fill and whatever paintParchmentGrain adds later. Zoomed in, that
      // grain -- tuned as a subtle FINISHING layer over busier art beneath
      // it -- was the only mark on the page out here, and with nothing to
      // blend into it read exactly like the "mold on the water" look its own
      // comment describes fixing, just by a different route. A light hachure
      // pass gives this fallback the same base ground treatment the guided
      // path already has, at lower density than the town's own so the
      // built-up interior still reads busier than open countryside.
      //
      // This is not a cosmetic-only fix: every settlement rendered through
      // the mapgen service takes this exact branch today, since nothing yet
      // reconstructs a real sampleGuide server-side (see RULES.md and the
      // Stage 4 overworld work) -- so this is what actually ships, not a
      // testing-only fallback.
      // heightAt needs a DOMINANT smooth direction, not pure noise. Hachure
      // strokes are drawn perpendicular to the local gradient, so a height
      // field built from unmodified multi-octave FBM -- which by
      // construction has many separate local peaks and troughs -- draws a
      // separate closed contour loop around every one of them: the first
      // version of this covered the whole countryside in distinct swirling
      // whirlpools, each centered on wherever the noise happened to peak.
      // The in-town hachure call just below avoids this by using a strong
      // RADIAL term (distance from the single market hub) that dominates its
      // own small noise wobble almost everywhere on the canvas, so it has
      // exactly one center. Countryside has no such landmark to radiate from,
      // so a fixed linear "wind direction" (one random angle per seed) plays
      // the same dominating role here: strokes run roughly perpendicular to
      // one consistent direction, with the noise only wobbling that gently,
      // rather than carving its own many-centered field.
      const fallbackGroundRng = mulberry32(seed + 484848);
      const fallbackWarp = makeFbmSampler(fallbackGroundRng, 3);
      const windAngle = fallbackGroundRng() * Math.PI * 2;
      const windX = Math.cos(windAngle), windY = Math.sin(windAngle);
      paintHachureField(ctx, canvas.width, canvas.height, fallbackGroundRng, palette.ink,
        (x, y) => x * windX + y * windY + fallbackWarp((x / canvas.width) * 2, (y / canvas.height) * 2) * 40,
        null, { spacing: 7, strokeLen: 5, density: 0.5, passes: 1, patchFloor: 0.5 });
    }

    // The countryside the town sits in (RULES.md C3).
    //
    // A settlement drawn on bare paper reads as a diagram, not a map. Every
    // reference idiom puts the town in a landscape: roads carrying on out of
    // frame, worked fields against the edge of the built-up area, woodland in
    // the ground between them. Without them a contact sheet of these maps
    // showed each settlement floating in blank parchment, and only 9-13% of
    // the surrounding canvas carried any detail at all on village seeds.
    //
    // Drawn here, immediately after the backdrop and before the town's own
    // ground tone, so anything that strays inside the boundary is painted
    // over rather than needing to be clipped out.
    drawCountryside();

    function outsideTown(x, y, margin) {
      const r = Math.hypot(x - cx, y - cy);
      return r > effectiveR(Math.atan2(y - cy, x - cx)) * (margin || 1.0);
    }
    // Never put fields or woodland out on open water. With a real backdrop
    // this asks the terrain directly; without one there is no water to avoid.
    function isLand(x, y) {
      if (!sampleGuide) return true;
      return sampleGuide(x / canvas.width, y / canvas.height) >= sea + 0.02;
    }

    function drawCountryside() {
      const W = canvas.width, H = canvas.height;

      // Roads out. The strongest growth axes are the routes the town grew
      // along, so they are the ones that carry on to the next place -- which
      // also means the outbound roads line up with the streets inside the
      // gates instead of arriving at unrelated angles.
      const outbound = growthAxes
        .map((ax, i) => ({ ax, i }))
        .sort((a, b) => b.ax.strength - a.ax.strength)
        .slice(0, Math.max(2, Math.round(growthAxes.length * 0.6)));

      const roadTracks = [];
      for (const { ax } of outbound) {
        const pts = [];
        const startR = effectiveR(ax.angle) * 0.98;
        const maxR = Math.hypot(W, H);
        let drift = 0;
        for (let r = startR; r < maxR; r += 26) {
          drift += (countryRng() - 0.5) * 0.10;   // a lane wanders
          const a = ax.angle + drift;
          const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
          if (!isLand(px, py)) break;             // stop at the shore
          pts.push({ x: px, y: py });
          if (px < -40 || px > W + 40 || py < -40 || py > H + 40) break;
        }
        if (pts.length >= 2) {
          roadTracks.push(pts);
          strokeOrganicRoad(ctx, pts, {
            color: palette.road || palette.plaza,
            edgeColor: palette.ink,
            width: 3.4,
            rng: countryRng,
            surface: 'dirt',
            traceKind: 'countryRoads',
          });
        }
      }

      // Worked fields, in bands hugging the edge of the town. Medieval strip
      // fields ran in parallel blocks off the approach roads, which is why
      // these are grouped and share an alignment rather than being scattered
      // quads -- a field is only legible as farmland if it has neighbours
      // lying the same way.
      // Anchored to the roads that serve them, and laid out ALONG the road
      // rather than pointing away from the town. The first version picked a
      // bearing from the town centre and ran the strips outward from it,
      // which put a ring of long rectangles radiating off the boundary --
      // the same radial-symmetry tell the settlement outline had just been
      // rebuilt to remove, and it read as green blades rather than farmland.
      // Fields belong to their access track, so that is what they follow.
      for (const track of roadTracks) {
        const blocks = 2 + Math.floor(countryRng() * 3);
        for (let b = 0; b < blocks; b++) {
          // Somewhere along the first half of the road out, where the land
          // in reach of the town actually gets worked.
          const ti = 1 + Math.floor(countryRng() * Math.max(1, Math.floor(track.length * 0.55)));
          const p = track[Math.min(ti, track.length - 1)];
          const prev = track[Math.max(0, ti - 1)];
          const roadAngle = Math.atan2(p.y - prev.y, p.x - prev.x);

          const side = countryRng() < 0.5 ? 1 : -1;
          const stripW = 11 + countryRng() * 8;
          const stripL = 26 + countryRng() * 24;
          const strips = 2 + Math.floor(countryRng() * 3);
          // Set back from the verge by half a field's depth, so the block
          // sits beside the lane instead of straddling it.
          const setback = stripL * 0.6 + 6;
          const bx = p.x + Math.cos(roadAngle + side * Math.PI / 2) * setback;
          const by = p.y + Math.sin(roadAngle + side * Math.PI / 2) * setback;

          for (let s = 0; s < strips; s++) {
            const off = (s - (strips - 1) / 2) * stripW * 1.15;
            const fx = bx + Math.cos(roadAngle) * off;
            const fy = by + Math.sin(roadAngle) * off;
            if (fx < 18 || fx > W - 18 || fy < 18 || fy > H - 18) continue;
            if (!isLand(fx, fy) || !outsideTown(fx, fy, 1.02)) continue;
            // Strips run perpendicular to the track they open off.
            drawFieldStrip(fx, fy, stripW, stripL, roadAngle + Math.PI / 2);
          }
        }
      }

      // Woodland in the ground the fields and roads leave alone -- the gaps
      // between the growth lobes, which is exactly where a real town has
      // uncleared land.
      const groves = 7 + Math.floor(countryRng() * 7);
      for (let i = 0; i < groves; i++) {
        const a = countryRng() * Math.PI * 2;
        const r = effectiveR(a) * (1.14 + countryRng() * 0.55);
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        if (px < 16 || px > W - 16 || py < 16 || py > H - 16) continue;
        if (!isLand(px, py) || !outsideTown(px, py, 1.06)) continue;
        const stand = 2 + Math.floor(countryRng() * 4);
        for (let t = 0; t < stand; t++) {
          const ta = countryRng() * Math.PI * 2, td = countryRng() * 17;
          drawTreeCluster(
            ctx, px + Math.cos(ta) * td, py + Math.sin(ta) * td,
            6 + countryRng() * 5, countryRng,
            palette.canopy || palette.gardenFill || '#5d7a3a', palette.ink
          );
        }
      }
    }

    // One field: a wobbled quad with furrow lines, boundary-hedged in ink.
    // Deliberately drawn in the same wobbled-outline, ink-edged hand as the
    // buildings and the town boundary, so the countryside doesn't read as a
    // different drawing pasted around the town.
    function drawFieldStrip(fx, fy, w, h, angle) {
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const local = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
      const quad = local.map(([lx, ly]) => ({ x: fx + lx * cos - ly * sin, y: fy + lx * sin + ly * cos }));
      const wobbled = jitterPolygon(quad, countryRng, Math.min(w, h) * 0.06, 2);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(wobbled[0].x, wobbled[0].y);
      for (let i = 1; i < wobbled.length; i++) ctx.lineTo(wobbled[i].x, wobbled[i].y);
      ctx.closePath();
      ctx.fillStyle = palette.fieldFill || '#cdbb87';
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Furrows, clipped to the field so they read as ploughing rather than
      // as loose hatching lying across the countryside.
      ctx.clip();
      ctx.strokeStyle = palette.ink;
      ctx.globalAlpha = 0.40;
      ctx.lineWidth = 0.6;
      const furrows = Math.max(3, Math.round(w / 3));
      for (let i = 1; i < furrows; i++) {
        const t = i / furrows - 0.5;
        const ox = Math.cos(angle + Math.PI / 2) * t * w;
        const oy = Math.sin(angle + Math.PI / 2) * t * w;
        ctx.beginPath();
        ctx.moveTo(fx + ox - cos * h * 0.46, fy + oy - sin * h * 0.46);
        ctx.lineTo(fx + ox + cos * h * 0.46, fy + oy + sin * h * 0.46);
        ctx.stroke();
      }
      ctx.restore();

      ctx.strokeStyle = palette.ink;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(wobbled[0].x, wobbled[0].y);
      for (let i = 1; i < wobbled.length; i++) ctx.lineTo(wobbled[i].x, wobbled[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (typeof isTracing === 'function' && isTracing()) {
        traceShape('fields', { cx: fx, cy: fy, w, h, angle, quad });
      }
    }

    // The settlement's own ground tone, matched to the biome it actually
    // sits in rather than one fixed tan for every town everywhere. The
    // flat palette.ground alone made a forest town and a barrens town
    // render identical pale discs regardless of the countryside around
    // them; blending it toward the DOMINANT land biome under this town's
    // own footprint (the same refBiomeOf grid renderTerrainPatch already
    // classified) keeps a forest town reading green-ish and a barrens
    // town dusty, so the interior belongs to its surroundings instead of
    // being a swatch dropped on top of them. Water cells are excluded
    // from the vote -- a coastal town is still a LAND settlement, and
    // letting deepwater win the count would tint the whole town blue.
    let townGroundTone = palette.ground;
    if (terrainResult) {
      const biomeVotes = {};
      const { cols: tCols, rows: tRows, cellW: tCellW, cellH: tCellH, refBiomeOf } = terrainResult;
      for (let gy = 0; gy < tRows; gy++) {
        for (let gx = 0; gx < tCols; gx++) {
          const px = (gx + 0.5) * tCellW, py = (gy + 0.5) * tCellH;
          const ddx = px - cx, ddy = py - cy;
          if (Math.hypot(ddx, ddy) > effectiveR(Math.atan2(ddy, ddx))) continue;
          const b = refBiomeOf[gy * tCols + gx];
          if (b === 'deepwater' || b === 'shallowwater') continue;
          biomeVotes[b] = (biomeVotes[b] || 0) + 1;
        }
      }
      let dominantBiome = null, bestVote = 0;
      for (const b in biomeVotes) if (biomeVotes[b] > bestVote) { bestVote = biomeVotes[b]; dominantBiome = b; }
      const biomeColor = dominantBiome && theme.overworld.biomes[dominantBiome];
      if (biomeColor) townGroundTone = lerpBuildingColor(palette.ground, biomeColor, 0.45);
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
      // ...and clipped to the REAL coastline as well, not just to the
      // town's own wobbled circle. effectiveR's shoreline fitting already
      // pulls that circle in to the measured land extent, but it's a
      // 64-ray radial probe, so fine coastline detail between rays can
      // still poke through. Intersecting the clip with renderTerrainPatch's
      // own land contour (the same beachLoops its isGroundAt uses) makes
      // the settlement's footprint end exactly where the terrain does.
      // Every later pass in this save/restore block -- river, hachure,
      // streets, buildings -- inherits this clip, so none of them can
      // land on water either.
      clipToRealLand();
      // A tint, not an opaque overwrite: a full-alpha fill here was
      // erasing the real terrain colors/texture renderTerrainPatch just
      // painted, replacing the whole town interior with one flat color --
      // called out directly as "the abrupt change to city/town," and
      // confirmed visually: a stark seam right at the wall between richly
      // varied countryside outside and a flat tan disc inside, with no
      // real reference map doing anything like it (a town is built ON its
      // terrain, not a differently-colored patch cut into it). Partial
      // alpha keeps the real ground's own color/hachure texture reading
      // through, softened toward the biome-matched tone above -- a
      // "cleared, settled" look instead of a hard material swap.
      ctx.fillStyle = townGroundTone;
      ctx.globalAlpha = 0.78;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }

    // River through the settlement: renderTerrainPatch's own river chains
    // (views/map-detail.js, additive `riverChains` return field), clipped
    // to the portion actually inside this town's wobbled boundary and
    // re-rendered as a water-toned organic ribbon now that the opaque
    // ground re-fill above would otherwise have paved right over it.
    // `distToRiver`/`riverBuildMargin` (used by eligibleForPlot further
    // down) keep buildings out of the channel; bridges are drawn once the
    // street network below has been laid out, at each street/river
    // crossing.
    let clippedRiverChains = [];
    let riverBuildMargin = 0;
    if (terrainResult && terrainResult.riverChains && terrainResult.riverChains.length) {
      const boundaryPath2D = new Path2D();
      boundaryPath2D.moveTo(townBoundaryLoop[0].x, townBoundaryLoop[0].y);
      for (let i = 1; i < townBoundaryLoop.length; i++) boundaryPath2D.lineTo(townBoundaryLoop[i].x, townBoundaryLoop[i].y);
      boundaryPath2D.closePath();
      const isInsideBoundary = (x, y) => ctx.isPointInPath(boundaryPath2D, x, y);
      const riverRng = mulberry32(seed + 232323);
      const candidates = [];
      for (const river of terrainResult.riverChains) {
        // Keep the longest contiguous run of points actually inside the
        // boundary -- a real river's total path is almost always far
        // longer than the town itself, so most of a chain sits outside it.
        const runs = [];
        let current = null;
        for (const p of river.points) {
          if (isInsideBoundary(p.x, p.y)) { if (!current) current = []; current.push(p); }
          else if (current) { runs.push(current); current = null; }
        }
        if (current) runs.push(current);
        if (!runs.length) continue;
        runs.sort((a, b) => b.length - a.length);
        if (runs[0].length < 2) continue;
        candidates.push({ points: runs[0], maxFlow: river.maxFlow });
      }
      // A real WotC town map shows ONE clean river (with maybe a
      // tributary), never a tangle of every minor stream thread the
      // hydrology sim found -- a very high-moisture spot can produce a
      // dozen+ tiny fragments here, and rejecting building plots near
      // EVERY one of them was observed to starve an entire city down to
      // 2 buildings. Keep only the top 2 by length (the real river and,
      // at most, one real tributary), discard the rest entirely --
      // fixes both the over-rejection and the visual clutter at once.
      candidates.sort((a, b) => b.points.length - a.points.length);
      for (const river of candidates.slice(0, 2)) {
        const width = Math.min(26, streetWidth * (1.4 + Math.sqrt(river.maxFlow / (terrainResult.riverThreshold || 1)) * 0.6));
        clippedRiverChains.push({ points: river.points, width });
        riverBuildMargin = Math.max(riverBuildMargin, width / 2 + 4);
        strokeOrganicRoad(ctx, river.points, { color: theme.overworld.river, edgeColor: palette.ink, width, rng: riverRng, surface: 'water' });
      }
    }

    // Contour-hachure ground texture (lib/hachure-terrain.js) -- needed
    // here even when a real backdrop was painted above, because the
    // ground re-fill just above (and the flat-fill fallback when there's
    // no backdrop at all) both paint a flat, textureless fill INSIDE the
    // town boundary, covering over whatever hachures renderTerrainPatch
    // drew underneath. There's no real elevation data inside a town's own
    // footprint to drive a gradient from, so this uses radial distance
    // from the market hub instead -- the strokes swirl in rings around
    // the hub, which reads naturally against a street layout that's
    // already ring/spoke-based, and costs nothing extra to compute.
    // Clipped to the town boundary explicitly (not relying on the outer
    // sampleGuide-gated clip above, which is a no-op when there's no
    // backdrop at all) -- without this, the no-guide fallback path
    // painted the radial hachure field across the ENTIRE canvas, well
    // past the village itself, reading as a bullseye ripple across open
    // bare ground instead of texture confined to the settlement.
    const hachureRng = mulberry32(seed + 63819);
    ctx.save();
    pathFromBoundary();
    ctx.clip();
    // The radial term alone produced perfectly concentric rings around
    // the hub, which reads as machined rather than drawn; the noise term
    // bends those contours so they wander like real ground does.
    const groundWarp = makeFbmSampler(hachureRng, 3);
    paintHachureField(ctx, canvas.width, canvas.height, hachureRng, palette.ink,
      (x, y) => -Math.hypot(x - hubX, y - hubY) + groundWarp(x / canvas.width * 2.5, y / canvas.height * 2.5) * R * 0.6,
      null, { spacing: 4, strokeLen: 5 });
    ctx.restore();

    // Street network: spokes radiating from the hub (uneven length),
    // wobbled concentric rings around the hub (broken into arcs by their
    // own gaps), organic branch stubs, and the dense secondary-lane maze.
    // Every tier draws strokeOrganicRoad (lib/organic-roads.js) instead of
    // a flat uniform-width stroke -- village gets a soft dirt-lane look
    // (surface:'dirt', wider wobble), town/city a firmer paved-street look
    // (surface:'stone').
    const mainSurface = tierKey === 'village' ? 'dirt' : 'stone';
    // Collected alongside the actual drawing below (not re-derived
    // afterward) so the river-crossing bridge pass at the end of this
    // block can test the exact same primary-street geometry against each
    // river chain, without a second, potentially-drifting copy of the
    // spoke/ring/branch math.
    const bridgeRoadSegments = [];
    for (let si = 0; si < spokeAngles.length; si++) {
      const angle = spokeAngles[si];
      const len = effectiveR(angle) * spokeLengthFrac[si];
      const pts = [
        { x: hubX + Math.cos(angle) * plazaR, y: hubY + Math.sin(angle) * plazaR },
        { x: hubX + Math.cos(angle) * len, y: hubY + Math.sin(angle) * len },
      ];
      bridgeRoadSegments.push({ a: pts[0], b: pts[1] });
      strokeOrganicRoad(ctx, pts, { color: palette.street, edgeColor: palette.ink, width: streetWidth, rng: roadRng, surface: mainSurface });
    }
    const ringSegments = 96;
    for (let i = 0; i < ringRadii.length; i++) {
      let seg = [];
      for (let s = 0; s <= ringSegments; s++) {
        const angle = (s / ringSegments) * Math.PI * 2;
        if (inRingGap(i, angle)) {
          if (seg.length > 1) strokeOrganicRoad(ctx, seg, { color: palette.street, edgeColor: palette.ink, width: streetWidth, rng: roadRng, surface: mainSurface });
          seg = [];
          continue;
        }
        const r = ringRadiusAt(i, angle);
        const pt = { x: hubX + Math.cos(angle) * r, y: hubY + Math.sin(angle) * r };
        if (seg.length) bridgeRoadSegments.push({ a: seg[seg.length - 1], b: pt });
        seg.push(pt);
      }
      if (seg.length > 1) strokeOrganicRoad(ctx, seg, { color: palette.street, edgeColor: palette.ink, width: streetWidth, rng: roadRng, surface: mainSurface });
    }
    const branchWidth = Math.max(6, streetWidth * 0.6);
    for (const seg of branchSegments) {
      bridgeRoadSegments.push({ a: { x: seg.x1, y: seg.y1 }, b: { x: seg.x2, y: seg.y2 } });
      strokeOrganicRoad(ctx, [{ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }], { color: palette.street, edgeColor: palette.ink, width: branchWidth, rng: roadRng, surface: mainSurface });
    }
    const laneWidth = Math.max(3, streetWidth * 0.32);
    ctx.save();
    ctx.globalAlpha = 0.85;
    for (const line of laneNetwork) {
      strokeOrganicRoad(ctx, line, { color: palette.street, edgeColor: palette.ink, width: laneWidth, rng: roadRng, surface: 'dirt' });
    }
    ctx.restore();

    // Bridges: a short perpendicular deck (reusing palette.wall, the same
    // "small fixed structure" convention the wall's own gate-ticks and the
    // market well use) at every point a primary street segment actually
    // crosses the river, found via straight-line segment intersection
    // against each clipped river chain's own segments. A 14px proximity
    // dedupe collapses near-duplicate hits from adjacent ring/spoke
    // segments meeting at almost the same point.
    if (clippedRiverChains.length) {
      const bridgesPlaced = [];
      function segIntersect(p1, p2, p3, p4) {
        const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
        const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
        const denom = d1x * d2y - d1y * d2x;
        if (Math.abs(denom) < 1e-9) return null;
        const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
        const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
        if (t < 0 || t > 1 || u < 0 || u > 1) return null;
        return { x: p1.x + d1x * t, y: p1.y + d1y * t, roadAngle: Math.atan2(d1y, d1x) };
      }
      for (const river of clippedRiverChains) {
        for (let i = 0; i < river.points.length - 1; i++) {
          const p1 = river.points[i], p2 = river.points[i + 1];
          for (const road of bridgeRoadSegments) {
            const hit = segIntersect(p1, p2, road.a, road.b);
            if (!hit) continue;
            if (bridgesPlaced.some((b) => Math.hypot(b.x - hit.x, b.y - hit.y) < 14)) continue;
            bridgesPlaced.push(hit);
            const deckLen = river.width + 8, deckW = Math.max(4, streetWidth * 0.6);
            ctx.save();
            ctx.translate(hit.x, hit.y);
            ctx.rotate(hit.roadAngle);
            ctx.fillStyle = palette.wall;
            ctx.fillRect(-deckLen / 2, -deckW / 2, deckLen, deckW);
            ctx.strokeStyle = palette.ink;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.moveTo(-deckLen / 2, -deckW / 2); ctx.lineTo(deckLen / 2, -deckW / 2);
            ctx.moveTo(-deckLen / 2, deckW / 2); ctx.lineTo(deckLen / 2, deckW / 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.restore();
          }
        }
      }
    }

    await yieldToPaint();
    progress.update(0.5, 'Placing buildings…');
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
    // The direction a building at (x, y) should face: the road tangent at
    // whichever of the four street/lane networks actually sits nearest,
    // not the building's own Voronoi-cell edge angle (minAreaRect's angle
    // is a geometry artifact of that cell's shape, unrelated to where the
    // street actually runs). A small per-building jitter keeps a long
    // straight run of buildings from all facing EXACTLY the same degree,
    // which reads as suspiciously mechanical next to a real street.
    function nearestRoadAngle(x, y, rng) {
      const candidates = [distToSpokes(x, y, true), distToRings(x, y, true), distToBranches(x, y, true), distToLanes(x, y, true)];
      let nearest = candidates[0];
      for (const c of candidates) if (c.dist < nearest.dist) nearest = c;
      return nearest.angle + (rng() - 0.5) * 0.2;
    }
    // Boundary containment (dist/eR) is relative to the town's own center
    // (cx, cy) -- that's what the wobbled silhouette is actually defined
    // against. Everything else (street avoidance, the hub-relative distance
    // band `frac` used for both POI siting and building tier) is relative
    // to the market hub, matching how a real town's density/wealth actually
    // radiates from its market rather than from the walled area's centroid.
    // Distance to the nearest street of any kind. The four networks are kept
    // separate for clearance (a spoke must stay clearer than an alley), but
    // for frontage any street will do -- a house on a lane fronts a street
    // just as much as one on the high road.
    function distToAnyStreet(x, y) {
      return Math.min(
        distToSpokes(x, y), distToRings(x, y),
        distToBranches(x, y), distToLanes(x, y)
      );
    }

    function eligibleForPlot(cell) {
      const dx = cell.x - cx, dy = cell.y - cy;
      const distFromCenter = Math.hypot(dx, dy);
      const angleFromCenter = Math.atan2(dy, dx);
      const eR = effectiveR(angleFromCenter);
      if (distFromCenter > eR * 0.9) return null;
      // The wobbled boundary is only ever an APPROXIMATION of the real
      // coastline (a 16-probe average, smoothed) -- on a town sited on a
      // peninsula narrower than the town's own radius, that approximation
      // isn't tight enough on its own, and buildings/POIs could still land
      // on what is actually open water in the real backdrop. When real
      // terrain data is available, check it directly here rather than
      // trusting the geometric approximation -- same "check the real data,
      // not a smooth stand-in for it" fix already applied to the detail-map
      // decoration bug earlier this project.
      if (sampleGuide && sampleGuide(cell.x / canvas.width, cell.y / canvas.height) < sea + 0.04) return null;
      if (insideCastle(cell.x, cell.y)) return null;
      const hdx = cell.x - hubX, hdy = cell.y - hubY;
      const distFromHub = Math.hypot(hdx, hdy);
      if (distFromHub < plazaR) return null;
      // These checks test the CELL's own centroid point against the
      // street network, but what actually has to stay clear of the
      // street is the drawn BUILDING's edge -- and a building can be up
      // to R*0.3 across (city tier), 60-150px+, while the old margins
      // here were a small fixed fraction of streetWidth (as little as
      // ~6px). A building whose centroid barely cleared that could still
      // visually bury the street under its own footprint, which is
      // exactly what was observed: real exported towns showed zero
      // visible street anywhere, wall-to-wall buildings with no gap.
      // Scaling the margin by this cell's own size (its buildable
      // rect's real extent is bounded by its polygon area) fixes that at
      // the source -- primary streets (spokes/rings) get the full margin
      // since they must stay clearly open; minor paths (branches/lanes)
      // get a smaller fraction since alleys are meant to weave more
      // tightly between buildings.
      // Only a modest cell-size term is needed now. This margin used to be
      // much larger because buildings could spill well outside their own
      // cell and bury the street; fitRectToPolygon now guarantees a building
      // stays inside its cell, so the clearance only has to account for a
      // cell straddling the street rather than for unbounded overflow. The
      // larger margin was starving towns of buildings (a headless audit
      // measured 12 buildings in a town that should hold 25-70, and 27 in a
      // city that should hold 60-160).
      const cellHalfSize = Math.sqrt(cellArea(cell)) * 0.5;
      if (distToSpokes(cell.x, cell.y) < streetWidth / 2 + cellHalfSize * 0.15) return null;
      if (distToRings(cell.x, cell.y) < streetWidth / 2 + cellHalfSize * 0.15) return null;
      if (distToBranches(cell.x, cell.y) < streetWidth * 0.35 + cellHalfSize * 0.1) return null;
      if (distToLanes(cell.x, cell.y) < streetWidth * 0.22 + cellHalfSize * 0.05) return null;
      // Composes with (doesn't replace) the sea-level rejection above --
      // a building can't sit in the river channel either, when this town
      // has one running through it.
      if (clippedRiverChains.length && distToPolylines(cell.x, cell.y, clippedRiverChains.map((r) => r.points)) < riverBuildMargin) return null;
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
    const poiDirsUsed = new Map();   // poiKey -> Set of compass names already given out
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
      if (poiType.coastalOnly && shoreLimit) {
        const waterFacing = candidates.filter((c) => waterFacingScore(c.angleFromCenter) < 0.9);
        if (waterFacing.length) pool = waterFacing;
      }
      const cells = pool.map((c) => c.cell);
      cells.sort((a, b) => cellArea(b) - cellArea(a));
      const poolSize = Math.max(1, Math.ceil(cells.length * 0.35));
      const chosen = cells[Math.floor(poiRng() * poolSize)];
      claimedCellIdx.add(chosen.index);
      // A city plans two guard posts, one per gate, and both used to print
      // the identical name "Guard Post" -- which an audit surfaced as a pair
      // of colliding labels reading "Guard Post / Guard Post". Two identical
      // names on one map is a defect even when they don't overlap, so any POI
      // type appearing more than once is distinguished by the compass bearing
      // of the gate it guards, which is also how a real map would name them.
      let displayLabel = poiKey === 'temple' ? TEMPLE_BY_TIER[tierKey].label : poiType.label;
      if (poiPlan.filter((k) => k === poiKey).length > 1) {
        if (!poiDirsUsed.has(poiKey)) poiDirsUsed.set(poiKey, new Set());
        const taken = poiDirsUsed.get(poiKey);
        const dir = compassOf(chosen.x - hubX, chosen.y - hubY, taken);
        taken.add(dir);
        displayLabel = `${dir} ${displayLabel}`;
      }
      poiPlaced.push({ cell: chosen, poiKey, poiType, displayLabel });
    }

    // Ordinary buildings. Every building faces its nearest road
    // (nearestRoadAngle), not minAreaRect's own cell-geometry angle --
    // re-derived via projectPolyAtAngle (not minAreaRect) before
    // fitRectToPolygon, since that anti-overlap area-ratio check is only
    // valid against the SAME angle the final rect is actually drawn at.
    function placeOrdinaryBuilding(cell, shrink, baseColor) {
      const targetAngle = nearestRoadAngle(cell.x, cell.y, buildingRng);
      const rect = fitRectToPolygon(projectPolyAtAngle(cell.polygon, targetAngle), cell.polygon);
      const maxDim = R * 0.3;
      let w = Math.max(4, rect.w * shrink), h = Math.max(4, rect.h * shrink);
      if (maxDim) { w = Math.min(w, maxDim); h = Math.min(h, maxDim); }
      drawPictorialBuilding(ctx, rect, w, h, { baseColor, ink: palette.ink, rng: buildingRng });
    }

    if (tierKey === 'village') {
      // A genuinely different, SPARSE algorithm -- not a smaller dense
      // town. Real villages are a handful of loose building clusters with
      // real gaps between them (confirmed directly against Phandalin/Red
      // Larch reference maps), not one packed disc shrunk down. Pick
      // well-separated seed cells (min-distance rejection against
      // already-picked seeds), then claim each seed's own already-
      // computed polygon neighbors (1-5 of them) as its cluster --
      // everything else stays bare ground. Its own dedicated stream so
      // reseeding the cluster layout never perturbs any other concern.
      const clusterRng = mulberry32(seed + 121212);
      const clusterPool = mesh.cells.filter((c) => !claimedCellIdx.has(c.index) && eligibleForPlot(c));
      const seedCells = [];
      const minSeedDist = R * 0.22;
      const seedTarget = 8 + Math.floor(clusterRng() * 7); // 8-14
      for (let tries = 0; tries < clusterPool.length * 3 && seedCells.length < seedTarget && clusterPool.length; tries++) {
        const idx = Math.floor(clusterRng() * clusterPool.length);
        const candidate = clusterPool[idx];
        clusterPool.splice(idx, 1);
        const tooClose = seedCells.some((s) => Math.hypot(s.x - candidate.x, s.y - candidate.y) < minSeedDist);
        if (!tooClose) seedCells.push(candidate);
      }
      const cottageShrink = () => VILLAGE_COTTAGE_SHRINK[0] + clusterRng() * (VILLAGE_COTTAGE_SHRINK[1] - VILLAGE_COTTAGE_SHRINK[0]);
      for (const seedCell of seedCells) {
        if (claimedCellIdx.has(seedCell.index)) continue;
        claimedCellIdx.add(seedCell.index);
        placeOrdinaryBuilding(seedCell, cottageShrink(), palette.buildingPoor);
        const claimCount = 1 + Math.floor(clusterRng() * 5);
        let claimed = 0;
        for (const nbrIdx of seedCell.neighbors) {
          if (claimed >= claimCount) break;
          const nbr = mesh.cells[nbrIdx];
          if (!nbr || claimedCellIdx.has(nbr.index) || !eligibleForPlot(nbr)) continue;
          claimedCellIdx.add(nbr.index);
          placeOrdinaryBuilding(nbr, cottageShrink(), palette.buildingPoor);
          claimed++;
        }
      }
    } else {
      // Town/city: tiered variety (hovel/house/manor) instead of one flat
      // color/shrink range -- weighted per settlement tier, further biased
      // toward manor near the hub and hovel near the edge (wealth/density
      // radiating from the market, the classic historical pattern), with
      // fill color lerping between two hand-picked-per-theme palette
      // endpoints, on every eligible cell (a dense packed town).
      const buildingTiers = BUILDING_TIERS[tierKey] || BUILDING_TIERS.village;

      // RULES.md B4. Filling every eligible cell put a building on any open
      // ground that merely cleared the streets, including the deep interior
      // of a block -- which is what reads as buildings sprinkled at random
      // rather than a town. An audit measured only 56-67% of them fronting a
      // street against a 75% bar.
      //
      // So cells are ranked by how close they are to a street and the ones
      // that front one are built first. The band is scaled to the cell's own
      // size for the same reason B4's check is: it has to mean the same
      // thing for a cottage plot and a cathedral plot.
      //
      // The fallback matters as much as the filter. Tightening placement has
      // twice starved this generator (a town left holding 12 buildings, a
      // city 27), so instead of a hard cutoff the back-of-block cells are
      // kept in reserve, sorted nearest-first, and admitted only if the
      // frontage cells alone don't reach the tier's minimum. Density is
      // preserved by construction and cannot regress into that failure again.
      const frontage = [], backland = [];
      for (const cell of mesh.cells) {
        if (claimedCellIdx.has(cell.index)) continue;
        const info = eligibleForPlot(cell);
        if (!info) continue;
        const d = distToAnyStreet(cell.x, cell.y);
        const reach = Math.sqrt(cellArea(cell)) * 0.75 + 6;
        (d <= reach ? frontage : backland).push({ cell, info, d });
      }
      backland.sort((a, b) => a.d - b.d);
      const minBuildings = Math.max(0, (config.minBuildings || 0) - poiPlaced.length);
      const chosenCells = frontage.concat(
        frontage.length >= minBuildings ? [] : backland.slice(0, minBuildings - frontage.length)
      );

      for (const { cell, info } of chosenCells) {
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
        placeOrdinaryBuilding(cell, shrink, lerpBuildingColor(palette.buildingRich, palette.buildingPoor, distFrac));
      }
    }

    // POI footprints, drawn after ordinary buildings so they read as
    // visually distinct: a wider shrink (bigger structure), a dedicated
    // fill, an icon glyph, and a halo-text label (lib/map-labels.js) --
    // also road-facing, same reasoning as ordinary buildings above. The
    // temple gets its tier-specific size instead of the shared default.
    // Labels are collected here and laid out in one pass after every POI and
    // the castle are drawn (see placeHaloLabels below). Drawing each one at a
    // fixed offset as it was reached meant two POIs in adjacent cells printed
    // their names on top of each other -- RULES.md L2, which a 200-seed audit
    // caught on maps the smaller sample never produced.
    const pendingLabels = [];

    for (const p of poiPlaced) {
      const poiTargetAngle = nearestRoadAngle(p.cell.x, p.cell.y, poiRng);
      const rect = fitRectToPolygon(projectPolyAtAngle(p.cell.polygon, poiTargetAngle), p.cell.polygon);
      const isTemple = p.poiKey === 'temple';
      const shrink = isTemple ? TEMPLE_BY_TIER[tierKey].shrink : 0.90;
      const maxDim = R * (isTemple ? TEMPLE_BY_TIER[tierKey].maxDimFrac : 0.35);
      let w = Math.max(4, rect.w * shrink), h = Math.max(4, rect.h * shrink);
      if (maxDim) { w = Math.min(w, maxDim); h = Math.min(h, maxDim); }
      drawPictorialBuilding(ctx, rect, w, h, { baseColor: palette.poiFill, ink: palette.ink, rng: poiRng });
      const dims = { w, h };
      drawSettlementPOIIcon(ctx, p.cell.x, p.cell.y - 8, p.poiType.iconKey, palette.ink);
      // Priority is the footprint's own size, so when two labels compete the
      // larger structure keeps the spot next to it and the smaller one moves.
      pendingLabels.push({
        text: p.displayLabel, targetX: p.cell.x, targetY: p.cell.y,
        font: `bold 10px ${OW_SERIF}`, ink: palette.ink, priority: w * h,
      });
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

    await yieldToPaint();
    progress.update(0.7, 'Raising walls…');
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
      // Corner towers -- drums with an ink outline rather than flat filled
      // squares, so they read as masonry in the same hand as everything else.
      const towerSize = Math.max(6, R * 0.045);
      for (const corner of corners) {
        ctx.fillStyle = palette.wall;
        ctx.beginPath();
        ctx.arc(corner.x, corner.y, towerSize * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = palette.ink;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
      // The keep: a dominant structure inside the bailey, set back from the
      // outer (town-wall-facing) edge toward the town side.
      //
      // This used to be drawFootprintRect -- one flat solid block of
      // palette.wall, with no roof planes, no ridge and no ink outline, while
      // every other building on the map is drawn by drawPictorialBuilding.
      // On a contact sheet the castle was consistently the worst thing in
      // frame: a plain dark rectangle at an odd angle that read as a sticker
      // pasted onto the map rather than a building standing in the town. It
      // is drawn in the same hand as everything else now, which also means it
      // picks up the map's single light direction (RULES.md B3) for free.
      const keepHalfW = c.halfW * 0.42, keepHalfH = c.halfH * 0.55;
      const inward = -c.halfW * 0.25; // pulled toward the town, away from the outer wall
      const cosA = Math.cos(c.angle), sinA = Math.sin(c.angle);
      const keepRect = { cx: c.cx + inward * cosA, cy: c.cy + inward * sinA, angle: c.angle, w: keepHalfW * 2, h: keepHalfH * 2 };
      // No explicit wallColor: drawPictorialBuilding fills the whole box with
      // it before insetting the roof, so passing palette.wall (a near-black
      // timber brown) turned the keep back into the solid dark block this
      // change set out to remove. Letting it derive a pale wash of its own
      // roof tone is what every ordinary building already does.
      // poiFill, not buildingRich. buildingRich is the darkest tone in every
      // palette (#5a3a1e on parchment) and rendering the keep in it kept it
      // reading as a black block no matter what the courtyard under it did.
      // The castle is a landmark, so it belongs in the same visual register
      // as the temple and the market hall -- which are already legible at
      // this size against this ground.
      drawPictorialBuilding(ctx, keepRect, keepHalfW * 2, keepHalfH * 2, {
        baseColor: palette.poiFill,
        ink: palette.ink,
        rng: castleRng,
      });
      // Ranked above every POI: the castle is the largest thing on the map,
      // so it is the one label that should never be the one that moves.
      pendingLabels.push({
        text: 'Castle', targetX: c.cx, targetY: c.cy + c.halfH,
        font: `bold 11px ${OW_SERIF}`, ink: palette.ink, priority: Infinity,
      });
    }

    // Bounds are the generator's own coordinate space, not canvas.width --
    // at print scale the bitmap is larger but the context is scaled to match,
    // so the drawing coordinates still run 0..SETTLEMENT_CANVAS_SIZE.
    // Any label with nowhere to go is dropped from the map; its POI is still
    // named in the side panel below, so no information is actually lost.
    placeHaloLabels(ctx, pendingLabels, {
      width: SETTLEMENT_CANVAS_SIZE, height: SETTLEMENT_CANVAS_SIZE,
    });

    ctx.restore(); // undo the terrain clip (no-op if none was applied)

    // The wall/boundary edge gets the same real-land clip the interior
    // above does -- otherwise the town's ground now correctly stops at
    // the shore while its wall carries on out across open water, which
    // reads worse than the original problem did.
    ctx.save();
    clipToRealLand();
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
    ctx.restore(); // undo the wall's own real-land clip

    // Fine parchment-grain texture over the whole finished composition --
    // same helper/convention every other generator here uses (reuses this
    // theme's own overworld.grain tuning rather than inventing a settlement-
    // specific one), unclipped since it's meant to read as the physical
    // page the map is drawn on, not something confined to the town itself.
    await yieldToPaint();
    progress.update(0.9, 'Finishing…');
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
    progress.done();
  }

  generate();
  container.querySelector('#st-theme').addEventListener('change', generate);
  wireMapExportSave(container, canvas, 'st', async (offCtx) => {
    const prevCtx = ctx;
    ctx = offCtx;
    await generate();
    ctx = prevCtx;
  });
}
