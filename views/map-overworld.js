function biomeAt(h, moist, seaLevel) {
  if (h < seaLevel - 0.08) return 'deepwater';
  if (h < seaLevel) return 'shallowwater';
  if (h < seaLevel + 0.03) return 'beach';
  if (h > 0.85) return 'snow';
  if (h > 0.7) return 'mountains';
  if (h > 0.55) return 'hills';
  if (moist > 0.5) return 'forest';
  return 'plains';
}

// Per-biome decorative texture drawn on top of the flat fill, using a
// dedicated rng consumed strictly in raster (row-major) order -- so it's
// fully deterministic per seed independent of settlement/road generation,
// which happens afterward against the (already-final) biome grid. Gated by
// probability per biome so it reads as texture/iconography, not a solid
// carpet of icons.
function paintBiomeTexture(ctx, biome, cx, cy, cw, ch, rng, ink) {
  const r = rng();
  switch (biome) {
    case 'forest': {
      if (r > 0.55) return;
      const size = Math.min(cw, ch) * 0.32;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx - size * 0.7, cy + size * 0.5);
      ctx.lineTo(cx + size * 0.7, cy + size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - size * 0.08, cy + size * 0.4, size * 0.16, size * 0.35);
      ctx.globalAlpha = 1;
      break;
    }
    case 'mountains': {
      if (r > 0.75) return;
      const w = cw * 0.85, h = ch * 0.7;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - h / 2);
      ctx.lineTo(cx - w / 2, cy + h / 2);
      ctx.lineTo(cx + w / 2, cy + h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(cx, cy - h / 2);
      ctx.lineTo(cx - w * 0.12, cy - h * 0.05);
      ctx.lineTo(cx + w * 0.08, cy - h * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'hills': {
      if (r > 0.4) return;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = Math.max(1, ch * 0.06);
      ctx.beginPath();
      ctx.arc(cx, cy + ch * 0.3, cw * 0.4, Math.PI, 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'plains': {
      if (r > 0.3) return;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1;
      const lean = (rng() - 0.5) * cw * 0.3;
      ctx.beginPath();
      ctx.moveTo(cx - cw * 0.15, cy + ch * 0.3);
      ctx.lineTo(cx - cw * 0.15 + lean, cy - ch * 0.3);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'deepwater':
    case 'shallowwater': {
      if (r > 0.3) return;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - cw * 0.4, cy);
      ctx.quadraticCurveTo(cx, cy - ch * 0.35, cx + cw * 0.4, cy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'beach': {
      if (r > 0.35) return;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.6, cw * 0.08), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'snow': {
      if (r > 0.2) return;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      const s = cw * 0.14;
      ctx.beginPath();
      ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
      ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
  }
}

// Relative cost of routing a road through each biome -- plains/beach are
// cheap, forest and hills cost more, mountains and snow cost the most.
// Water isn't listed because computeRoadPath excludes water cells from the
// routable graph entirely (roads in this world don't cross open water).
const OW_TERRAIN_ROAD_COST = { beach: 1.2, plains: 1, forest: 1.3, hills: 2, mountains: 4, snow: 2.5 };

// Dijkstra shortest path over the mesh's cell-adjacency graph, weighted by
// terrain -- replaces a straight jittered curve between two settlements
// with a route that actually prefers plains over mountains, and costs
// extra (not prohibitive) to ford a river without a bridge. A simple
// linear-scan extract-min rather than a binary heap: the mesh is small
// enough (at most ~1000 cells) and this only runs once per road, not
// per frame, so the simpler implementation isn't worth the complexity.
function computeRoadPath(cells, biomeOf, nearRiverFlag, startIdx, endIdx) {
  const n = cells.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  dist[startIdx] = 0;
  for (let iter = 0; iter < n; iter++) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) { if (!visited[i] && dist[i] < best) { best = dist[i]; u = i; } }
    if (u === -1 || u === endIdx) break;
    visited[u] = 1;
    for (const v of cells[u].neighbors) {
      if (visited[v]) continue;
      const biome = biomeOf[v];
      if (biome === 'deepwater' || biome === 'shallowwater') continue;
      const d = Math.hypot(cells[u].x - cells[v].x, cells[u].y - cells[v].y);
      const terrainCost = OW_TERRAIN_ROAD_COST[biome] || 1;
      const riverPenalty = nearRiverFlag[v] > 0 ? 1.5 : 1;
      const alt = dist[u] + d * terrainCost * riverPenalty;
      if (alt < dist[v]) { dist[v] = alt; prev[v] = u; }
    }
  }
  if (dist[endIdx] === Infinity) return null;
  const path = [];
  let cur = endIdx;
  while (cur !== -1) { path.push(cur); cur = prev[cur]; }
  path.reverse();
  return path;
}

const OW_TIER_RADIUS = { village: 3.5, town: 5.5, city: 8 };
const OW_TIER_FONT = { village: '10px sans-serif', town: 'bold 11px sans-serif', city: 'bold 13px sans-serif' };

// Settlement iconography: a distinct glyph per tier instead of one filled
// circle at three sizes, so tier reads at a glance even without comparing
// marker sizes against each other. village keeps the plain dot (the
// smallest/most numerous tier reads fine as a simple point); town becomes a
// diamond; city becomes a five-pointed star, echoing the classic map-symbol
// convention for a capital.
// On-canvas legend: drawn onto the canvas itself (not just the page around
// it) so it travels with an exported/saved PNG, which is the actual
// deliverable pasted into notes -- a page-only legend wouldn't. Always the
// same fixed rows regardless of what's actually present on this particular
// map (a normal legend convention -- it documents the map's visual
// language, not an inventory of this map's contents), and deliberately a
// plain light card regardless of theme, matching how a legend box reads as
// its own neutral overlay on real maps rather than adopting the map's own
// palette.
function drawMapLegend(ctx, canvas, palette) {
  const rows = [
    { type: 'swatch', color: palette.biomes.deepwater, label: 'Deep water' },
    { type: 'swatch', color: palette.biomes.shallowwater, label: 'Shallow water' },
    { type: 'swatch', color: palette.biomes.beach, label: 'Beach' },
    { type: 'swatch', color: palette.biomes.plains, label: 'Plains' },
    { type: 'swatch', color: palette.biomes.forest, label: 'Forest' },
    { type: 'swatch', color: palette.biomes.hills, label: 'Hills' },
    { type: 'swatch', color: palette.biomes.mountains, label: 'Mountains' },
    { type: 'swatch', color: palette.biomes.snow, label: 'Snow' },
    { type: 'icon', tier: 'village', label: 'Village' },
    { type: 'icon', tier: 'town', label: 'Town' },
    { type: 'icon', tier: 'city', label: 'City' },
    { type: 'line', color: palette.river, label: 'River' },
    { type: 'line', color: palette.coastline, label: 'Coastline' },
    { type: 'line', color: palette.road, label: 'Road' },
  ];
  const rowH = 15, padding = 10, swatchSize = 11;
  const boxWidth = 130;
  const boxHeight = rows.length * rowH + padding * 2;
  const boxX = padding, boxY = canvas.height - boxHeight - padding;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  rows.forEach((row, i) => {
    const rowY = boxY + padding + i * rowH + rowH / 2;
    const iconX = boxX + padding + swatchSize / 2;
    if (row.type === 'swatch') {
      ctx.fillStyle = row.color;
      ctx.fillRect(iconX - swatchSize / 2, rowY - swatchSize / 2, swatchSize, swatchSize);
    } else if (row.type === 'icon') {
      ctx.fillStyle = '#333333';
      drawSettlementIcon(ctx, row.tier, iconX, rowY, swatchSize * 0.4);
    } else if (row.type === 'line') {
      ctx.strokeStyle = row.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(iconX - swatchSize / 2, rowY);
      ctx.lineTo(iconX + swatchSize / 2, rowY);
      ctx.stroke();
    }
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(row.label, boxX + padding + swatchSize + 6, rowY);
  });
  ctx.restore();
}

function drawSettlementIcon(ctx, tier, cx, cy, r) {
  if (tier === 'town') {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (tier === 'city') {
    const points = 5, innerR = r * 0.45;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const rad = i % 2 === 0 ? r : innerR;
      const angle = (Math.PI / points) * i - Math.PI / 2;
      const x = cx + Math.cos(angle) * rad, y = cy + Math.sin(angle) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

// Overworld/region map: a hand-rolled Voronoi mesh (lib/voronoi-mesh.js)
// gives irregular polygon cells instead of a uniform grid; height/moisture
// are sampled continuously (lib/noise.js's makeFbmSampler) at each cell's
// site rather than baked into a raster. Biome classification, settlement
// placement (scoring + min-distance filter), and roads (nearest-neighbor
// MST) work exactly as before, just against polygon-cell data instead of
// grid-index data. Settlement tiers and biome texture are purely cosmetic
// passes over that same data -- neither perturbs the underlying generation,
// so a given seed still reproduces the same land shape/settlement positions
// across themes and re-generates.
function renderOverworldMap(container) {
  container.innerHTML = `
    <h2>Overworld map generator</h2>
    <div class="map-layout">
      <div class="map-controls">
        <label>Seed <input id="ow-seed" type="number" value="${Math.floor(Math.random() * 1e6)}"></label>
        <label>Theme <select id="ow-theme"></select></label>
        <label>Cells <input id="ow-cells" type="number" value="400" min="50" max="1000"></label>
        <label>Octaves <input id="ow-oct" type="number" value="4" min="1" max="6"></label>
        <label>Sea level <input id="ow-sea" type="range" min="0" max="100" value="42"></label>
        <label><input id="ow-island" type="checkbox" checked> Island mode</label>
        <label><input id="ow-rivers" type="checkbox" checked> Rivers</label>
        <label><input id="ow-legend" type="checkbox"> Show legend</label>
        <label>Settlements <input id="ow-settle" type="number" value="6" min="0" max="20"></label>
        <button id="ow-regen">Regenerate</button>
        <hr>
        <button id="ow-export">Export PNG</button>
        <label>Save as <input id="ow-filename" placeholder="filename.png" autocomplete="off"></label>
        <label>Campaign <select id="ow-campaign"></select></label>
        <button id="ow-save">Save to campaign</button>
        <p id="ow-status" class="status-text"></p>
        <hr>
        <p id="ow-settlement-action" class="status-text"></p>
      </div>
      <canvas id="ow-canvas" width="800" height="600"></canvas>
    </div>
  `;

  populateCampaignSelect(container.querySelector('#ow-campaign'));
  populateThemeSelect(container.querySelector('#ow-theme'));

  const canvas = container.querySelector('#ow-canvas');
  // `let`, not `const` -- wireMapExportSave's high-res export temporarily
  // points this at an offscreen context so generate() redraws there instead
  // of the on-screen canvas, then restores it.
  let ctx = canvas.getContext('2d');

  // Retained across generate() calls so the click handler below (registered
  // once) can always hit-test against the settlements from the MOST RECENT
  // draw -- canvas has no native per-shape click events, so hit-testing has
  // to work from this remembered screen-position list rather than the DOM.
  let currentSeed = 0;
  let currentSettlements = [];

  function generate() {
    const seed = parseInt(container.querySelector('#ow-seed').value, 10) || 1;
    const cellCount = parseInt(container.querySelector('#ow-cells').value, 10) || 400;
    const octaves = parseInt(container.querySelector('#ow-oct').value, 10) || 4;
    const seaLevel = parseInt(container.querySelector('#ow-sea').value, 10) / 100;
    const island = container.querySelector('#ow-island').checked;
    const riversOn = container.querySelector('#ow-rivers').checked;
    const legendOn = container.querySelector('#ow-legend').checked;
    const settleCount = parseInt(container.querySelector('#ow-settle').value, 10) || 0;
    const theme = MAP_THEMES[container.querySelector('#ow-theme').value] || MAP_THEMES[MAP_THEME_DEFAULT];
    const palette = theme.overworld;

    const rng = mulberry32(seed);
    const heightSample = makeFbmSampler(rng, octaves);
    const moistureSample = makeFbmSampler(mulberry32(seed + 99991), Math.max(1, octaves - 1));
    // Dedicated rngs for every generative concern that must never perturb
    // another -- mesh geometry, biome texture, settlement names, river-curve
    // jitter -- kept separate from `rng` above (terrain) so switching
    // themes, toggling rivers, or regenerating never perturbs a different
    // pass's output. River *routing* itself needs no rng (it's a
    // deterministic function of the height field); only the cosmetic curve
    // wobble does, matching the dungeon wobble / road-curve precedent.
    const meshRng = mulberry32(seed + 77777);
    const textureRng = mulberry32(seed + 55555);
    const nameRng = mulberry32(seed + 33333);
    const riverCurveRng = mulberry32(seed + 11111);
    const regionRng = mulberry32(seed + 22222);

    const mesh = buildVoronoiMesh(meshRng, canvas.width, canvas.height, cellCount);

    // Naming regions: a handful of flood-filled zones over the same
    // adjacency graph, each biased toward one phoneme "flavor" once its
    // dominant biome is known below. Built now (region membership only
    // needs the adjacency graph, not biome/height data) but not resolved to
    // an actual phoneme category per region until the biome tally after
    // cellData exists.
    const regionCount = Math.max(2, Math.min(8, Math.round(cellCount / 60)));
    const regionOf = assignNamingRegions(mesh.cells, regionCount, regionRng);

    const cx = canvas.width / 2, cy = canvas.height / 2;
    const maxD = Math.hypot(cx, cy);

    // Pipeline order: heights -> flow/rivers -> moisture adjustment ->
    // biome classification -> settlements. Heights come first because flow
    // routing needs the full height field; biome classification comes last
    // (of these four) because river/lake presence bumps moisture, which
    // must land before biomeAt() runs, not after.
    const heights = new Float64Array(mesh.cells.length);
    mesh.cells.forEach((cell, i) => {
      let h = heightSample(cell.x / canvas.width, cell.y / canvas.height);
      if (island) {
        const d = Math.hypot(cell.x - cx, cell.y - cy) / maxD;
        h *= Math.max(0, 1 - d * d * 1.3);
      }
      heights[i] = h;
    });

    let flow = null, downhill = null, isLake = null, riverThreshold = Infinity;
    // Cells whose own flow qualifies as a river, or their direct neighbors --
    // both the moisture bump below and the settlement-scoring bonus further
    // down read this same set, so "near a river" means one consistent thing
    // everywhere in this generator.
    const nearRiver = new Float64Array(mesh.cells.length);
    if (riversOn) {
      const hydro = computeHydrology(mesh.cells, heights, seaLevel);
      flow = hydro.flow; downhill = hydro.downhill; isLake = hydro.isLake;
      const landCells = [];
      for (let i = 0; i < mesh.cells.length; i++) if (heights[i] >= seaLevel) landCells.push(i);
      riverThreshold = riverFlowThreshold(flow, landCells, 0.04, 3);
      for (let i = 0; i < mesh.cells.length; i++) {
        if (flow[i] < riverThreshold && !isLake[i]) continue;
        nearRiver[i] = Math.max(nearRiver[i], 1);
        for (const nb of mesh.cells[i].neighbors) nearRiver[nb] = Math.max(nearRiver[nb], 0.5);
      }
    }

    const cellData = mesh.cells.map((cell, i) => {
      const h = heights[i];
      let m = moistureSample(cell.x / canvas.width, cell.y / canvas.height);
      m = Math.min(1, m + nearRiver[i] * 0.3);
      return { cell, h, m, biome: biomeAt(h, m, seaLevel) };
    });

    // Resolve each naming region to a phoneme category by tallying its
    // cells' biomes and taking the majority -- a mountain-heavy region
    // reads harsher, a coastal one reads watery, purely from word choice.
    const regionBiomeTally = [];
    for (let r = 0; r < regionCount; r++) regionBiomeTally.push({});
    for (const { cell, biome } of cellData) {
      const tally = regionBiomeTally[regionOf[cell.index]];
      const category = BIOME_TO_NAME_CATEGORY[biome] || 'plains';
      tally[category] = (tally[category] || 0) + 1;
    }
    const regionCategory = regionBiomeTally.map((tally) => {
      let best = 'plains', bestCount = -1;
      for (const category in tally) {
        if (tally[category] > bestCount) { bestCount = tally[category]; best = category; }
      }
      return best;
    });

    for (const { cell, biome } of cellData) {
      const poly = cell.polygon;
      if (poly.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fillStyle = palette.biomes[biome];
      ctx.fill();
      // Stroking in the fill's own color papers over hairline seams
      // between adjacent polygons that floating-point clipping can leave.
      ctx.strokeStyle = palette.biomes[biome];
      ctx.lineWidth = 1;
      ctx.stroke();
      const r = Math.sqrt(polygonArea(poly) / Math.PI);
      paintBiomeTexture(ctx, biome, cell.x, cell.y, r * 2, r * 2, textureRng, palette.ink);
    }

    // Coastline smoothing: interior biome-to-biome boundaries deliberately
    // stay hard polygon edges (that's the visual language of this map, not
    // a bug) -- only the land/water boundary gets the extra-ink Chaikin
    // treatment, since that's the one edge worth reading as a coastline
    // rather than a biome seam. Pure deterministic post-process over
    // already-generated points, so it carries no rng/seed risk at all.
    const isLand = (i) => heights[i] >= seaLevel;
    const coastChains = extractCoastlineChains(mesh.cells, isLand);
    ctx.strokeStyle = palette.coastline;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    for (const chain of coastChains) {
      const smoothed = chaikinSmooth(chain, 2);
      ctx.beginPath();
      ctx.moveTo(smoothed[0].x, smoothed[0].y);
      for (let i = 1; i < smoothed.length; i++) ctx.lineTo(smoothed[i].x, smoothed[i].y);
      ctx.stroke();
    }

    if (riversOn) {
      const avgSpacing = Math.sqrt((canvas.width * canvas.height) / Math.max(1, cellCount));
      ctx.lineCap = 'round';
      for (let i = 0; i < mesh.cells.length; i++) {
        if (downhill[i] === -1 || flow[i] < riverThreshold) continue;
        const a = mesh.cells[i], b = mesh.cells[downhill[i]];
        ctx.strokeStyle = palette.river;
        ctx.lineWidth = Math.min(6, 1 + Math.sqrt(flow[i] / riverThreshold));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        const midX = (a.x + b.x) / 2 + (riverCurveRng() - 0.5) * avgSpacing * 0.4;
        const midY = (a.y + b.y) / 2 + (riverCurveRng() - 0.5) * avgSpacing * 0.4;
        ctx.quadraticCurveTo(midX, midY, b.x, b.y);
        ctx.stroke();
      }
      ctx.fillStyle = palette.lake;
      for (let i = 0; i < mesh.cells.length; i++) {
        if (!isLake[i] || flow[i] < 2) continue; // a local minimum with no upstream drainage isn't a meaningful lake
        const r = Math.max(3, Math.min(10, 2 + Math.sqrt(flow[i])));
        ctx.beginPath();
        ctx.arc(mesh.cells[i].x, mesh.cells[i].y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const candidates = [];
    for (const { cell, biome } of cellData) {
      if (cell.polygon.length < 3) continue;
      if (biome === 'plains' || biome === 'beach' || biome === 'hills') {
        const riverBonus = nearRiver[cell.index] > 0 ? 0.25 : 0;
        candidates.push({ x: cell.x, y: cell.y, index: cell.index, score: rng() + (biome === 'plains' ? 0.3 : 0) + riverBonus });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const minDist = Math.max(canvas.width, canvas.height) / (settleCount + 1) * 0.6;
    const settlements = [];
    for (const c of candidates) {
      if (settlements.length >= settleCount) break;
      if (settlements.every((s) => Math.hypot(s.x - c.x, s.y - c.y) >= minDist)) {
        settlements.push(c);
      }
    }

    // Rank by score to assign settlement tiers -- the greedy min-distance
    // selection above already tends to add settlements in roughly
    // descending score order, but re-sort explicitly rather than relying
    // on that as a guarantee. Tiers are cosmetic (marker size, label
    // weight, name-suffix flavor) and never feed back into placement.
    const byScore = settlements.slice().sort((a, b) => b.score - a.score);
    const cityCount = Math.max(1, Math.round(byScore.length * 0.15));
    const townCount = Math.max(0, Math.round(byScore.length * 0.35));
    byScore.forEach((s, i) => {
      s.tier = i < cityCount ? 'city' : i < cityCount + townCount ? 'town' : 'village';
      s.name = generateSettlementName(nameRng, s.tier, regionCategory[regionOf[s.index]]);
    });

    // Roads: which settlement pairs to connect still comes from a simple
    // nearest-neighbor MST over straight-line distance (a reasonable, cheap
    // heuristic for "does a road exist between these two places" -- real
    // road *networks* aren't full shortest-path meshes either). What
    // changed is how each chosen connection is drawn: instead of a single
    // jittered curve, it's an actual Dijkstra route over the mesh that
    // prefers plains/beach and avoids mountains and open water.
    ctx.strokeStyle = palette.road;
    ctx.lineWidth = 2;
    if (settlements.length > 1) {
      const biomeOf = cellData.map((d) => d.biome);
      const connected = new Set([0]);
      while (connected.size < settlements.length) {
        let best = null;
        for (const i of connected) {
          for (let j = 0; j < settlements.length; j++) {
            if (connected.has(j)) continue;
            const d = Math.hypot(settlements[i].x - settlements[j].x, settlements[i].y - settlements[j].y);
            if (!best || d < best.d) best = { i, j, d };
          }
        }
        if (!best) break;
        const a = settlements[best.i], b = settlements[best.j];
        const path = computeRoadPath(mesh.cells, biomeOf, nearRiver, a.index, b.index);
        ctx.beginPath();
        if (path && path.length > 1) {
          const pts = path.map((idx) => ({ x: mesh.cells[idx].x, y: mesh.cells[idx].y }));
          const smoothed = pts.length > 2 ? chaikinSmooth(pts, 1) : pts;
          ctx.moveTo(smoothed[0].x, smoothed[0].y);
          for (let i = 1; i < smoothed.length; i++) ctx.lineTo(smoothed[i].x, smoothed[i].y);
        } else {
          // No routable land path (e.g. the two settlements are on
          // separate islands) -- fall back to a direct line so a
          // connection still gets drawn rather than silently vanishing.
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        connected.add(best.j);
      }
    }

    for (const s of settlements) {
      const px = s.x, py = s.y;
      const r = OW_TIER_RADIUS[s.tier];
      ctx.fillStyle = palette.settlement[s.tier];
      drawSettlementIcon(ctx, s.tier, px, py, r);
      if (s.tier === 'city') {
        ctx.strokeStyle = palette.settlement[s.tier];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.font = OW_TIER_FONT[s.tier];
      ctx.fillStyle = palette.label;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(s.name, px, py + r + 3);
    }

    if (legendOn) drawMapLegend(ctx, canvas, palette);

    currentSeed = seed;
    currentSettlements = settlements;
    container.querySelector('#ow-settlement-action').innerHTML = '';
  }

  // Canvas has no native per-shape click events, so hit-testing is manual:
  // convert the click point from CSS pixels to the canvas's own internal
  // resolution (max-width:100% can scale the element down from its 800x600
  // backing store on a narrow viewport, so offsetX/offsetY alone would be
  // wrong there) and compare against each settlement's last-drawn position.
  function canvasToInternal(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
  }
  function hitTestSettlement(evt) {
    const { x, y } = canvasToInternal(evt);
    let best = null, bestIdx = -1, bestDist = Infinity;
    currentSettlements.forEach((s, i) => {
      const r = OW_TIER_RADIUS[s.tier] + 6; // a little padding makes small village markers easier to hit
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= r && d < bestDist) { best = s; bestIdx = i; bestDist = d; }
    });
    return best ? { settlement: best, idx: bestIdx } : null;
  }
  canvas.addEventListener('mousemove', (evt) => {
    canvas.style.cursor = hitTestSettlement(evt) ? 'pointer' : 'default';
  });
  canvas.addEventListener('click', (evt) => {
    const hit = hitTestSettlement(evt);
    const actionEl = container.querySelector('#ow-settlement-action');
    actionEl.innerHTML = '';
    if (!hit) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `Generate town map for ${hit.settlement.name} →`;
    btn.addEventListener('click', () => {
      const url = `#/map/settlement?seed=${currentSeed}&idx=${hit.idx}&name=${encodeURIComponent(hit.settlement.name)}&tier=${hit.settlement.tier}`;
      location.hash = url;
    });
    actionEl.appendChild(btn);
  });

  generate();
  container.querySelector('#ow-regen').addEventListener('click', generate);
  container.querySelector('#ow-theme').addEventListener('change', generate);
  wireMapExportSave(container, canvas, 'ow', (offCtx) => {
    const prevCtx = ctx;
    ctx = offCtx;
    generate();
    ctx = prevCtx;
  });
}
