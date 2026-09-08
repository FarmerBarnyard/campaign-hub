// Local detail/"zoom in" map: drilled into from an empty-terrain click on
// the overworld map (map-overworld.js's hitTestLand/sampleLocalCharacter).
// Reuses the same terrain-generation pipeline as the overworld's own
// Standard-tier single-range path (mesh/height/erosion/hydrology/moisture/
// biome/rendering), just at a smaller, fixed local scale -- not continent-
// scale multi-range logic, and no island/coastline mask, since a click can
// land anywhere on the parent landmass, not just at its edge.
//
// The seed is *derived* from (overworldSeed, clickX, clickY) rather than
// entered by hand -- same "nothing here for the user to desync" reasoning
// as map-settlement.js's deriveSettlementSeed, and deliberately no
// Regenerate/terrain controls for the same reason. The patch's average
// height/moisture are captured from the parent map at click time (passed
// via the URL) and the generated terrain is mean-shifted/blended toward
// those numbers, so a click in hills-near-a-mountain-range reads hillier,
// a click deep in a forest reads more forested, etc., instead of being an
// unrelated random patch.
function deriveDetailSeed(overworldSeed, x, y, scaleTag) {
  const spatialHash = (Math.round(x) * 73856093) ^ (Math.round(y) * 19349663) ^ Math.imul(scaleTag, 83492791);
  const mixSeed = (overworldSeed ^ Math.imul(spatialHash, 0x9e3779b1)) >>> 0;
  return Math.floor(mulberry32(mixSeed)() * 0xffffffff) >>> 0;
}

const DETAIL_CELL_COUNT = 6000;
const DETAIL_OCTAVES = 4;
const DETAIL_CANVAS_W = 800;
const DETAIL_CANVAS_H = 600;
// How much faster the added-texture noise oscillates than a standalone
// terrain's own noise, when a real guide grid is supplying the macro shape
// (see the guide-grid height blend below) -- without this, the "detail"
// noise is just another whole-canvas-scale landform at reduced amplitude,
// competing with the guide for where the coastline actually falls. Starting
// point, tuned visually.
const DETAIL_NOISE_FREQ = 8;

// One procedurally-placed landmark per detail map (confirmed via
// AskUserQuestion: pure terrain with nothing to find felt empty). Keyed off
// lib/settlement-names.js's own BIOME_TO_NAME_CATEGORY so a landmark's
// flavor always matches the region it's placed in, the same direct
// (non-randomized) mapping that already drives settlement name phonemes.
const LANDMARK_TYPES = {
  forest: [{ key: 'shrine', label: 'Shrine' }, { key: 'ruins', label: 'Ruins' }],
  mountain: [{ key: 'watchtower', label: 'Watchtower' }, { key: 'ruins', label: 'Ruins' }],
  coastal: [{ key: 'wreck', label: 'Wreck' }, { key: 'ruins', label: 'Ruins' }],
  plains: [{ key: 'ruins', label: 'Ruins' }, { key: 'camp', label: 'Camp' }],
};

// Keys that come from the overworld's own POINT_LANDMARK_TYPES table (see
// lib/map-biome-zones.js) rather than LANDMARK_TYPES above -- when a detail
// map is opened from clicking one of these on the parent map, its icon is
// drawn via map-overworld.js's drawWildZoneIcon instead of drawLandmarkIcon.
const OVERWORLD_POI_ICON_KEYS = new Set(['leyLineNexus', 'astralScar', 'giantsGarden', 'sunkenRuins']);

// Simple canvas-path glyphs (no image assets), in the same spirit as
// drawCornerMedallion/paintRosetteTexture elsewhere in this generator.
function drawLandmarkIcon(ctx, x, y, key, ink) {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.9;
  if (key === 'ruins') {
    const colHeights = [10, 6, 8];
    colHeights.forEach((h, i) => {
      const cx = x + (i - 1) * 6;
      ctx.beginPath();
      ctx.moveTo(cx - 2, y + 4);
      ctx.lineTo(cx - 2, y + 4 - h);
      ctx.lineTo(cx + 2, y + 4 - h);
      ctx.lineTo(cx + 2, y + 4);
      ctx.stroke();
    });
  } else if (key === 'shrine') {
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 1);
    ctx.moveTo(x - 3, y - 1);
    ctx.lineTo(x, y - 5);
    ctx.lineTo(x + 3, y - 1);
    ctx.stroke();
  } else if (key === 'watchtower') {
    ctx.beginPath();
    ctx.rect(x - 3, y - 10, 6, 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 10);
    ctx.lineTo(x, y - 14);
    ctx.lineTo(x + 4, y - 10);
    ctx.stroke();
  } else if (key === 'camp') {
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 5);
    ctx.lineTo(x, y - 8);
    ctx.lineTo(x + 6, y + 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 3, y + 5);
    ctx.lineTo(x, y - 2);
    ctx.lineTo(x + 3, y + 5);
    ctx.stroke();
  } else if (key === 'wreck') {
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 3);
    ctx.lineTo(x + 7, y + 3);
    ctx.lineTo(x + 4, y + 7);
    ctx.lineTo(x - 4, y + 7);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 2, y + 3);
    ctx.lineTo(x + 3, y - 8);
    ctx.stroke();
  }
  ctx.restore();
}

function clampParam(raw, fallback) {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

// Looks up a wild-zone type by key across both of lib/map-biome-zones.js's
// tables -- the overworld click handler doesn't know (or need to know)
// which table a given key came from, it just passes the key straight
// through the URL.
function findZoneByKey(key) {
  if (!key) return null;
  return SPECIAL_ZONE_TYPES.find((z) => z.key === key) || RANGE_ZONE_TYPES.find((z) => z.key === key) || null;
}

function renderDetailMap(container, params) {
  const overworldSeed = parseInt(params.get('seed'), 10) || 1;
  const clickX = parseFloat(params.get('x')) || 0;
  const clickY = parseFloat(params.get('y')) || 0;
  const biome = params.get('biome') || 'plains';
  const targetAvgHeight = clampParam(params.get('h'), 0.5);
  const targetAvgMoisture = clampParam(params.get('m'), 0.5);
  const sea = clampParam(params.get('sea'), 0.42);
  const seed = deriveDetailSeed(overworldSeed, clickX, clickY, DETAIL_CANVAS_W);
  // Set (not just carried through) when the clicked cell was inside an
  // actual rolled wild zone -- confirmed via direct account-owner feedback
  // that clicking into e.g. a Fungal Forest patch on the overworld
  // regenerated a plain, unrelated forest detail map with no trace of what
  // was actually clicked. Applied as an overlay in generate() below, same
  // wash-then-icon-scatter pattern the overworld itself uses for the same
  // zone.
  const zone = findZoneByKey(params.get('zone'));
  const locationLabel = zone ? zone.label : biome;
  // Set when this detail map was opened from a specific, already-named
  // point-feature wild-zone landmark (Ley Line Nexus, Astral Scar, Giant's
  // Garden, Sunken Ruins -- see map-overworld.js's hitTestLandmark) rather
  // than a plain empty-terrain click. Forces that exact landmark into the
  // landmark slot below instead of rolling a fresh, unrelated one -- the
  // same "what you clicked is what you get" gap already closed for wild
  // zones and geography.
  const poiKey = params.get('poi');
  const poiLabel = params.get('poiLabel');
  const poiName = params.get('poiName');
  // The guide grid (see map-overworld.js's sampleHeightGuide) carries the
  // parent map's REAL local height shape across the route boundary -- the
  // account owner correctly pointed out that h/m/sea alone (a single
  // averaged scalar) only matched statistics, not actual geography: a
  // click near a bay produced an unrelated patch with the right average
  // elevation, not a zoomed-in view of that bay's real curve. Guarded so
  // an old/hand-built link missing these params still renders via the
  // pre-existing mean-shift fallback below.
  const guideParam = params.get('guide');
  const guideCols = parseInt(params.get('gw'), 10) || 0;
  const guideRows = parseInt(params.get('gh'), 10) || 0;
  let sampleGuide = null;
  if (guideParam && guideCols > 0 && guideRows > 0) {
    const byteStr = atob(decodeURIComponent(guideParam));
    const guideBytes = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) guideBytes[i] = byteStr.charCodeAt(i);
    // Bilinear interpolation over the guideCols x guideRows grid, treated
    // as covering the same [0,1]x[0,1] space this canvas does -- the
    // overworld sampled its window to correspond exactly to what this
    // canvas shows, so no separate offset/scale bookkeeping is needed here.
    sampleGuide = (u, v) => {
      const fx = Math.min(guideCols - 1, Math.max(0, u * guideCols - 0.5));
      const fy = Math.min(guideRows - 1, Math.max(0, v * guideRows - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(guideCols - 1, x0 + 1), y1 = Math.min(guideRows - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const sampleAt = (x, y) => guideBytes[y * guideCols + x] / 255;
      const top = sampleAt(x0, y0) * (1 - tx) + sampleAt(x1, y0) * tx;
      const bot = sampleAt(x0, y1) * (1 - tx) + sampleAt(x1, y1) * tx;
      return top * (1 - ty) + bot * ty;
    };
  }

  container.innerHTML = `
    <h2 id="dt-heading">Detail map</h2>
    <p><a href="#/map/overworld">&larr; Back to overworld map</a></p>
    <div class="map-layout">
      <div class="map-controls">
        <label>Theme <select id="dt-theme"></select></label>
        <p class="status-text">Derived from overworld seed ${overworldSeed} at this location (${locationLabel}) -- fixed, can't be reseeded independently.</p>
        <hr>
        <button id="dt-export">Export PNG</button>
        <label>Save as <input id="dt-filename" placeholder="filename.png" autocomplete="off"></label>
        <label>Campaign <select id="dt-campaign"></select></label>
        <button id="dt-save">Save to campaign</button>
        <p id="dt-status" class="status-text"></p>
      </div>
      <canvas id="dt-canvas" width="${DETAIL_CANVAS_W}" height="${DETAIL_CANVAS_H}"></canvas>
    </div>
  `;

  populateCampaignSelect(container.querySelector('#dt-campaign'));
  populateThemeSelect(container.querySelector('#dt-theme'));

  const canvas = container.querySelector('#dt-canvas');
  // `let`, not `const` -- wireMapExportSave's high-res export temporarily
  // points this at an offscreen context so generate() redraws there instead
  // of the on-screen canvas, then restores it (same convention as
  // map-settlement.js).
  let ctx = canvas.getContext('2d');

  function pathFromLoops(loops) {
    ctx.beginPath();
    for (const loop of loops) {
      ctx.moveTo(loop[0].x, loop[0].y);
      for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y);
      ctx.closePath();
    }
  }
  function fillLoopsEvenOdd(loops, fillStyle) {
    if (loops.length === 0) return;
    ctx.fillStyle = fillStyle;
    pathFromLoops(loops);
    ctx.fill('evenodd');
  }
  function clipToLoops(loops) {
    pathFromLoops(loops);
    ctx.clip('evenodd');
  }

  let lastLandmarkName = null;

  function generate() {
    const theme = MAP_THEMES[container.querySelector('#dt-theme').value] || MAP_THEMES[MAP_THEME_DEFAULT];
    const palette = theme.overworld;

    const hillsT = Math.max(sea + 0.08, 0.55);
    const mountainsT = Math.max(hillsT + 0.05, 0.7);
    const snowT = Math.max(mountainsT + 0.05, 0.85);
    const forestT = 0.5;

    const meshRng = mulberry32(seed + 71013);
    const ridgeRng = mulberry32(seed + 81523);
    const moistureRng = mulberry32(seed + 92131);
    const erosionRng = mulberry32(seed + 51947);
    const textureRng = mulberry32(seed + 56273);
    const washRng = mulberry32(seed + 45871);
    const rosetteRng = mulberry32(seed + 89241);
    const grainRng = mulberry32(seed + 14683);
    const borderRng = mulberry32(seed + 25791);
    const landmarkRng = mulberry32(seed + 63187);
    const heightRng = mulberry32(seed);

    const mesh = buildTerrainGrid(meshRng, canvas.width, canvas.height, DETAIL_CELL_COUNT);
    const { cols, rows, cellW, cellH } = mesh;

    // Height: the same single-range formula as the overworld's Standard
    // tier (no island mask, no lobes/multi-range -- a click can land
    // anywhere on the parent landmass, not just at its edge), then a
    // mean-shift so this patch's AVERAGE elevation matches what the parent
    // map showed at the clicked spot. Robust regardless of the noise
    // function's own value distribution; individual cells still vary
    // locally on top of that shift.
    const heightSample = makeFbmSampler(heightRng, DETAIL_OCTAVES);
    const ridgeAngle = ridgeRng() * Math.PI;
    const ridgedSample = makeAnisotropicSampler(makeRidgedFbmSampler(ridgeRng, Math.min(5, DETAIL_OCTAVES + 1)), ridgeAngle, 1.0, 2.8);
    const ridgeContribution = (x, y) => ridgedSample(x / canvas.width, y / canvas.height);
    // When a real guide grid is driving the macro shape below, heightSample/
    // ridgeContribution need to supply genuinely FINE texture, not another
    // whole-canvas-scale landform: each one's lowest (and heaviest-weighted)
    // octave is a single broad lobe/ridge spanning the ENTIRE canvas (see
    // lib/noise.js's 3x3 base lattice) -- confirmed directly as the actual
    // cause of a real bug, not a hypothetical one: that lobe, even knocked
    // down to 30% amplitude by detailAmp below, was still enough to redraw
    // the coastline somewhere else entirely, since land-vs-water is a hard
    // threshold right at sea level and this noise was the same characteristic
    // scale as the guide's own macro shape. Sampling at DETAIL_NOISE_FREQ x
    // the frequency turns that one giant lobe into that many smaller ripples
    // -- texture riding on top of the guide's real shape, not a second shape
    // fighting it for which coastline wins.
    const detailFreq = sampleGuide ? DETAIL_NOISE_FREQ : 1;
    const rawH = new Float64Array(mesh.cells.length);
    mesh.cells.forEach((cell, i) => {
      const u = (cell.x / canvas.width) * detailFreq, v = (cell.y / canvas.height) * detailFreq;
      rawH[i] = heightSample(u, v) * 0.5 + ridgeContribution(cell.x * detailFreq, cell.y * detailFreq) * 0.75;
    });
    let meanRaw = 0;
    for (let i = 0; i < rawH.length; i++) meanRaw += rawH[i];
    meanRaw /= rawH.length;
    const heights = new Float64Array(rawH.length);
    if (sampleGuide) {
      // The guide grid is now the dominant low-frequency shape (the real
      // parent-map geography); rawH is demoted from "the whole shape" to a
      // smaller-amplitude perturbation layered on top -- the fine detail
      // that wasn't visible at the parent's coarser resolution.
      const detailAmp = 0.2; // starting point, tuned visually -- now that the guide grid itself carries real per-cell resolution (64x48), it deserves more say over the fine noise than before
      mesh.cells.forEach((cell, i) => {
        const guideH = sampleGuide(cell.x / canvas.width, cell.y / canvas.height);
        heights[i] = Math.max(0, Math.min(1, guideH + (rawH[i] - meanRaw) * detailAmp));
      });
    } else {
      const shift = targetAvgHeight - meanRaw;
      for (let i = 0; i < rawH.length; i++) heights[i] = Math.max(0, Math.min(1, rawH[i] + shift));
    }

    fillPits(heights, cols, rows, sea);
    applyHydraulicErosion(heights, cols, rows, erosionRng, {});
    applyThermalErosion(heights, cols, rows, 3, 0.025, 0.5);
    fillPits(heights, cols, rows, sea);

    // Hydrology + moisture: mirrors the overworld's own buildWorld pipeline
    // exactly (computeHydrology -> riverFlowThreshold -> nearRiver bump ->
    // moisture blend), rivers always on -- this view has no Rivers toggle,
    // consistent with everything else here being locked.
    const hydro = computeHydrology(mesh.cells, heights, sea);
    const { flow, downhill, isLake } = hydro;
    const landCells = [];
    for (let i = 0; i < mesh.cells.length; i++) if (heights[i] >= sea) landCells.push(i);
    const riverThreshold = riverFlowThreshold(flow, landCells, 0.04, 3);
    const nearRiver = new Float64Array(mesh.cells.length);
    for (let i = 0; i < mesh.cells.length; i++) {
      if (flow[i] < riverThreshold && !isLake[i]) continue;
      nearRiver[i] = Math.max(nearRiver[i], 1);
      for (const nb of mesh.cells[i].neighbors) nearRiver[nb] = Math.max(nearRiver[nb], 0.5);
    }

    const moistureSample = makeFbmSampler(moistureRng, Math.max(1, DETAIL_OCTAVES - 1));
    const mOf = new Float64Array(mesh.cells.length);
    const refBiomeOf = new Array(mesh.cells.length);
    mesh.cells.forEach((cell, i) => {
      let m = moistureSample(cell.x / canvas.width, cell.y / canvas.height) * 0.6 + targetAvgMoisture * 0.4;
      m = Math.min(1, m + nearRiver[i] * 0.3);
      mOf[i] = m;
      refBiomeOf[i] = biomeAt(heights[i], m, sea, 0, 0);
    });

    // Wild-zone overlay setup, mirroring the overworld's own buildWorld
    // derivation exactly: wetlowlandOf is a derived flag (only computed
    // when actually needed, i.e. Bone Marsh/Feywild Bog), and Frostfell
    // overrides refBiome itself (a forced snow cap) rather than being a
    // recolor -- applied here, before the landmark candidate filter and
    // the render pipeline below, so both naturally treat this patch as
    // snow-covered.
    let wetlowlandOf = null;
    if (zone && zone.baseBiome === 'wetlowland') {
      const wetlowlandHillsT = Math.max(sea + 0.08, 0.55);
      const marshMoistureT = 0.62;
      wetlowlandOf = new Uint8Array(mesh.cells.length);
      for (let i = 0; i < mesh.cells.length; i++) {
        const rb = refBiomeOf[i];
        wetlowlandOf[i] = (rb === 'plains' || rb === 'beach') && heights[i] < wetlowlandHillsT &&
          (mOf[i] > marshMoistureT || nearRiver[i] > 0) ? 1 : 0;
      }
    }
    if (zone && zone.forcesSnow) {
      for (let i = 0; i < mesh.cells.length; i++) {
        if (heights[i] >= sea) refBiomeOf[i] = 'snow';
      }
    }

    // Landmark: one candidate biased toward the canvas center, excluded
    // from steep terrain (hills/mountains/snow) and from beach, so it
    // plausibly sits on land someone could actually walk to. Picked from
    // the closest third of candidates (by distance to center) rather than
    // the literal closest, so it isn't dead-center on every single map.
    const centerX = canvas.width / 2, centerY = canvas.height / 2;
    const candidates = [];
    mesh.cells.forEach((cell, i) => {
      if (heights[i] < sea + 0.03) return;
      const b = refBiomeOf[i];
      if (b === 'hills' || b === 'mountains' || b === 'snow') return;
      candidates.push({ i, cell, dist: Math.hypot(cell.x - centerX, cell.y - centerY) });
    });
    let landmark = null;
    if (candidates.length) {
      candidates.sort((a, b) => a.dist - b.dist);
      const pickFrom = Math.max(1, Math.floor(candidates.length / 3));
      const pick = candidates[Math.floor(landmarkRng() * pickFrom)];
      let type, name;
      if (poiKey) {
        // The account owner clicked this exact landmark on the overworld --
        // its identity is fixed, not rolled. landmarkRng isn't consumed any
        // further here (nothing downstream reads it again either way), so
        // skipping the type/name rolls doesn't desync anything else.
        type = { key: poiKey, label: poiLabel || poiKey };
        name = poiName || poiLabel || poiKey;
      } else {
        const category = BIOME_TO_NAME_CATEGORY[biome] || 'plains';
        const types = LANDMARK_TYPES[category] || LANDMARK_TYPES.plains;
        type = types[Math.floor(landmarkRng() * types.length)];
        name = `${type.label} of ${generateSettlementName(landmarkRng, 'village', category)}`;
      }
      landmark = { x: pick.cell.x, y: pick.cell.y, idx: pick.i, type, name };
    }
    lastLandmarkName = landmark ? landmark.name : null;

    // Rendering: same ordered pass sequence as the overworld's own
    // generate() (band fills -> texture scatter -> forest/highland wash +
    // rosette -> snow -> coastline -> rivers/lakes -> landmark -> grain/
    // compass/border). A deep-inland patch naturally paints zero water
    // (nothing crosses the sea threshold); a patch captured near the
    // parent coastline can naturally dip a few edge cells below `sea` and
    // paint a small shore -- no bespoke island/coastline logic needed.
    const minLoopArea = cellW * cellH * 0.5;
    const heightAt = (i) => heights[i];
    ctx.fillStyle = palette.biomes.deepwater;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    fillLoopsEvenOdd(
      extractFillableRegions(cols, rows, cellW, cellH, heightAt, sea - 0.08, canvas.width, canvas.height, minLoopArea),
      palette.biomes.shallowwater
    );
    const beachLoops = extractFillableRegions(cols, rows, cellW, cellH, heightAt, sea, canvas.width, canvas.height, minLoopArea);
    fillLoopsEvenOdd(beachLoops, palette.biomes.beach);
    const landLoops = extractFillableRegions(cols, rows, cellW, cellH, heightAt, sea + 0.03, canvas.width, canvas.height, minLoopArea);
    fillLoopsEvenOdd(landLoops, palette.biomes.plains);

    const spacing = Math.max(16, Math.min(canvas.width, canvas.height) / 24);
    function biomeAtPoint(x, y) {
      const gx = Math.min(cols - 1, Math.max(0, Math.floor(x / cellW)));
      const gy = Math.min(rows - 1, Math.max(0, Math.floor(y / cellH)));
      return refBiomeOf[gy * cols + gx];
    }
    for (let sy = spacing / 2; sy < canvas.height; sy += spacing) {
      for (let sx = spacing / 2; sx < canvas.width; sx += spacing) {
        const px = sx + (textureRng() - 0.5) * spacing * 0.6;
        const py = sy + (textureRng() - 0.5) * spacing * 0.6;
        const b = biomeAtPoint(px, py);
        if (b === 'hills' || b === 'mountains' || b === 'forest') continue;
        paintBiomeTexture(ctx, b, px, py, spacing, spacing, textureRng, palette.ink);
      }
    }

    const landForestAt = (i) => (heights[i] >= sea + 0.03 ? mOf[i] : -1);
    const forestLoops = extractFillableRegions(cols, rows, cellW, cellH, landForestAt, forestT, canvas.width, canvas.height, minLoopArea);
    if (forestLoops.length > 0) {
      ctx.save();
      clipToLoops(landLoops.length ? landLoops : beachLoops);
      for (const group of groupChainsIntoLoops(forestLoops)) {
        paintWatercolorWash(ctx, group, washRng, palette.wash.forest, palette.ink, 28);
      }
      ctx.restore();
    }

    const highlandLoops = extractFillableRegions(cols, rows, cellW, cellH, heightAt, hillsT, canvas.width, canvas.height, minLoopArea);
    for (const group of groupChainsIntoLoops(highlandLoops)) {
      paintWatercolorWash(ctx, group, washRng, palette.wash.hills, palette.ink, 28);
    }

    for (let sy = spacing / 2; sy < canvas.height; sy += spacing) {
      for (let sx = spacing / 2; sx < canvas.width; sx += spacing) {
        const px = sx + (textureRng() - 0.5) * spacing * 0.6;
        const py = sy + (textureRng() - 0.5) * spacing * 0.6;
        const b = biomeAtPoint(px, py);
        if (b === 'hills' || b === 'mountains') {
          paintRosetteTexture(ctx, px, py, spacing, spacing, rosetteRng, palette.ink, b === 'mountains');
        } else if (b === 'forest') {
          paintBiomeTexture(ctx, b, px, py, spacing, spacing, textureRng, palette.ink);
        }
      }
    }

    // Wild-zone overlay: the same "recolor + icon-scatter, additive, on top
    // of everything already painted" pattern the overworld itself uses --
    // applied across the WHOLE detail patch rather than gated to one
    // region, since a click-to-zoom into a specific zone should read as a
    // close-up of that zone throughout, not just a corner of it. Special
    // zones (has baseBiome) recolor matching cells; range zones (has
    // appliesTo instead) recolor an elevation band. Frostfell has no wash
    // of its own -- it already painted as ordinary snow above via the
    // forced refBiome override, so it's excluded here.
    if (zone && !zone.forcesSnow) {
      const zoneAt = zone.baseBiome
        ? (i) => {
            if (zone.baseBiome === 'wetlowland') return wetlowlandOf[i] ? 1 : 0;
            if (zone.baseBiome === 'any') return heights[i] >= sea ? 1 : 0;
            return refBiomeOf[i] === zone.baseBiome ? 1 : 0;
          }
        : (i) => {
            if (zone.appliesTo === 'snowOnly') return heights[i] >= snowT ? 1 : 0;
            if (zone.appliesTo === 'rangeBase') return (heights[i] >= hillsT && heights[i] < mountainsT) ? 1 : 0;
            return heights[i] >= hillsT ? 1 : 0; // 'range'
          };
      function scatterZoneIcons() {
        for (let sy = spacing / 2; sy < canvas.height; sy += spacing) {
          for (let sx = spacing / 2; sx < canvas.width; sx += spacing) {
            const px = sx + (textureRng() - 0.5) * spacing * 0.6;
            const py = sy + (textureRng() - 0.5) * spacing * 0.6;
            const gx = Math.min(cols - 1, Math.max(0, Math.floor(px / cellW)));
            const gy = Math.min(rows - 1, Math.max(0, Math.floor(py / cellH)));
            if (!zoneAt(gy * cols + gx)) continue;
            drawWildZoneIcon(ctx, px, py, zone.iconKey, palette.ink);
          }
        }
      }
      if (zone.appliesTo === 'snowOnly') {
        scatterZoneIcons();
      } else {
        const zoneLoops = extractFillableRegions(cols, rows, cellW, cellH, zoneAt, 0.5, canvas.width, canvas.height, minLoopArea);
        if (zoneLoops.length > 0) {
          for (const group of groupChainsIntoLoops(zoneLoops)) {
            paintWatercolorWash(ctx, group, washRng, palette.wash[zone.washKey], palette.ink, 24);
          }
          scatterZoneIcons();
        }
      }
    }

    fillLoopsEvenOdd(
      extractFillableRegions(cols, rows, cellW, cellH, heightAt, snowT, canvas.width, canvas.height, minLoopArea),
      palette.biomes.snow
    );

    ctx.lineJoin = 'round';
    for (const chain of beachLoops) {
      const smoothed = chaikinSmooth(chain, 3);
      ctx.beginPath();
      ctx.moveTo(smoothed[0].x, smoothed[0].y);
      for (let i = 1; i < smoothed.length; i++) ctx.lineTo(smoothed[i].x, smoothed[i].y);
      ctx.closePath();
      ctx.strokeStyle = palette.coastline;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const n = mesh.cells.length;
    const hasUpstream = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (flow[i] >= riverThreshold && downhill[i] !== -1) hasUpstream[downhill[i]] = 1;
    }
    const visitedDown = new Uint8Array(n);
    ctx.strokeStyle = palette.river;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let s = 0; s < n; s++) {
      if (flow[s] < riverThreshold || hasUpstream[s]) continue;
      const chain = [{ x: mesh.cells[s].x, y: mesh.cells[s].y }];
      let maxFlow = flow[s];
      let cur = s;
      for (;;) {
        const next = downhill[cur];
        if (next === -1) break;
        chain.push({ x: mesh.cells[next].x, y: mesh.cells[next].y });
        maxFlow = Math.max(maxFlow, flow[next]);
        if (visitedDown[next]) break;
        visitedDown[next] = 1;
        if (heights[next] < sea || flow[next] < riverThreshold) break;
        cur = next;
      }
      if (chain.length < 2) continue;
      const smoothed = chaikinSmooth(chain, 2);
      ctx.lineWidth = Math.min(6, 1 + Math.sqrt(maxFlow / riverThreshold));
      ctx.beginPath();
      ctx.moveTo(smoothed[0].x, smoothed[0].y);
      for (let i = 1; i < smoothed.length; i++) ctx.lineTo(smoothed[i].x, smoothed[i].y);
      ctx.stroke();
    }
    const lakeVal = (i) => (isLake[i] && flow[i] >= 2 ? 1 : 0);
    fillLoopsEvenOdd(
      extractFillableRegions(cols, rows, cellW, cellH, lakeVal, 0.5, canvas.width, canvas.height, minLoopArea),
      palette.lake
    );

    if (landmark) {
      // A POI-forced landmark's key comes from POINT_LANDMARK_TYPES (the
      // overworld's own wild-zone landmark table: leyLineNexus/astralScar/
      // giantsGarden/sunkenRuins) rather than this file's LANDMARK_TYPES, so
      // drawLandmarkIcon (which only knows ruins/shrine/watchtower/camp/
      // wreck) wouldn't draw anything for it. drawWildZoneIcon is the
      // function map-overworld.js already uses to draw these same icons on
      // the parent map -- loaded before this file (see index.html's script
      // order) and reused here rather than re-implementing the glyphs.
      if (OVERWORLD_POI_ICON_KEYS.has(landmark.type.key)) {
        drawWildZoneIcon(ctx, landmark.x, landmark.y, landmark.type.key, palette.ink);
      } else {
        drawLandmarkIcon(ctx, landmark.x, landmark.y, landmark.type.key, palette.ink);
      }
      ctx.font = `bold 11px ${OW_SERIF}`;
      ctx.fillStyle = labelColorFor(refBiomeOf[landmark.idx], palette);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(landmark.name, landmark.x, landmark.y + 14);
    }

    paintParchmentGrain(ctx, canvas, grainRng, palette.grain);
    drawCompassRose(ctx, canvas.width - 50, 50, 28, palette.coastline);
    drawMapVignetteAndBorder(ctx, canvas, palette.coastline, borderRng);
  }

  generate();
  container.querySelector('#dt-heading').textContent = lastLandmarkName ? `${lastLandmarkName} (${locationLabel} detail map)` : `Detail map (${locationLabel})`;
  container.querySelector('#dt-theme').addEventListener('change', generate);
  wireMapExportSave(container, canvas, 'dt', (offCtx) => {
    const prevCtx = ctx;
    ctx = offCtx;
    generate();
    ctx = prevCtx;
  });
}
