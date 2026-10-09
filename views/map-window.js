// The zoom-in window (lib/map-window.js): a rectangle of an overworld map drawn at a chosen zoom.
//
// The overworld is rebuilt from the numbers in the address (or taken from the shared cache when the
// overworld page is already showing it) and the rectangle is read out of it, so the coast, hills,
// rivers, lakes, biomes, settlements, roads and wild zones are the overworld's own, in the same place,
// at higher resolution. Only fine texture is added. The terrain itself is painted by
// views/map-detail.js's renderTerrainPatch in its `win` mode; this file builds that input, adds the
// overworld's settlements/roads/landmarks on top, and wires the page.

function windowFont(font, factor) {
  return font.replace(/(\d+)px/, (m, size) => `${Math.round(size * factor)}px`);
}

const WINDOW_TIER_PRIORITY = { city: 0, town: 1, village: 2 };

// Draws the overworld's roads, settlements (with the overworld's label-collision rule), wild-zone
// landmarks and Scrying Pool that fall inside the window. Returns the settlements in view.
function drawWindowFeatures(ctx, canvas, w, world, sample, palette, zoom, seed) {
  const W = canvas.width, H = canvas.height, pad = 30;
  const inView = (p) => p.x > -pad && p.x < W + pad && p.y > -pad && p.y < H + pad;
  const roadRng = mulberry32(seed + 31337);
  const roadWidth = Math.min(8, 2.5 + zoom * 0.9);
  for (const path of world.roadPaths) {
    const pts = path.map((p) => sample.toDetail(p.x, p.y));
    if (!pts.some(inView)) continue;
    strokeOrganicRoad(ctx, pts, { color: palette.road, edgeColor: palette.ink, width: roadWidth, rng: roadRng, surface: 'stone' });
  }

  const iconScale = Math.min(3, 1 + zoom * 0.35);
  const fontScale = Math.min(1.7, 1 + zoom * 0.1);
  const visible = [];
  for (const s of world.settlements) {
    const p = sample.toDetail(s.x, s.y);
    if (!inView(p)) continue;
    const r = OW_TIER_RADIUS[s.tier] * iconScale;
    ctx.fillStyle = palette.settlement[s.tier];
    drawSettlementIcon(ctx, s.tier, p.x, p.y, r);
    if (s.tier === 'city') {
      ctx.strokeStyle = palette.settlement[s.tier];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    visible.push({ s, p, r });
  }
  // Every icon draws; a name only if it does not sit on a higher-priority one.
  const placed = [];
  visible.sort((a, b) => WINDOW_TIER_PRIORITY[a.s.tier] - WINDOW_TIER_PRIORITY[b.s.tier]);
  for (const { s, p, r } of visible) {
    const font = windowFont(OW_TIER_FONT[s.tier], fontScale);
    ctx.font = font;
    const tw = ctx.measureText(s.name).width;
    const box = { x1: p.x - tw / 2 - 2, x2: p.x + tw / 2 + 2, y1: p.y + r + 3, y2: p.y + r + 3 + 11 * fontScale };
    if (placed.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1)) continue;
    placed.push(box);
    drawHaloLabel(ctx, s.name, p.x, p.y + r + 8, undefined, undefined, { font, ink: labelColorFor(world.refBiomeOf[s.index], palette) });
  }

  if (w.wildZones) {
    for (const lm of world.landmarks) {
      const p = sample.toDetail(lm.x, lm.y);
      if (!inView(p)) continue;
      drawWildZoneIcon(ctx, p.x, p.y, lm.key, palette.ink);
      drawHaloLabel(ctx, lm.name, p.x, p.y + 14, undefined, undefined, { font: windowFont(OW_TIER_FONT.village, fontScale), ink: palette.label });
    }
    if (world.largestLakeId !== -1 && world.lakeIdOf) {
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i < world.mesh.cells.length; i++) {
        if (world.lakeIdOf[i] !== world.largestLakeId) continue;
        sx += world.mesh.cells[i].x; sy += world.mesh.cells[i].y; n++;
      }
      if (n > 0) {
        const p = sample.toDetail(sx / n, sy / n);
        if (inView(p)) drawWildZoneIcon(ctx, p.x, p.y, 'scryingPool', palette.ink);
      }
    }
  }
  return visible;
}

async function renderWindowMap(container, params, w) {
  const dim = MapWindow.canvasFor(w);
  const zoom = MapWindow.zoomOf(w);
  const zoomText = zoom.toFixed(zoom % 1 ? 1 : 0);
  const seed = deriveDetailSeed(w.seed, Math.round(w.wx * 10000), Math.round(w.wy * 10000), Math.round(w.ww * 10000));
  const tileMode = params.get('tile') === '1';

  container.innerHTML = `
    <h2 id="dt-heading">Zoomed map</h2>
    <p><a href="#/map/overworld">&larr; Back to overworld map</a></p>
    <div class="map-layout">
      <div class="map-controls">
        <label>Theme <select id="dt-theme"></select></label>
        <p class="status-text" id="dt-note"></p>
        <hr>
        <button id="dt-export">Export PNG</button>
        <label>Save as <input id="dt-filename" placeholder="filename.png" autocomplete="off"></label>
        <label>Campaign <select id="dt-campaign"></select></label>
        <button id="dt-save">Save to campaign</button>
        <p id="dt-status" class="status-text"></p>
      </div>
      <canvas id="dt-canvas" width="${MapWindow.DETAIL_W}" height="${MapWindow.DETAIL_H}"></canvas>
    </div>
  `;
  populateCampaignSelect(container.querySelector('#dt-campaign'));
  populateThemeSelect(container.querySelector('#dt-theme'));
  const canvas = container.querySelector('#dt-canvas');
  let ctx = canvas.getContext('2d');
  const noteEl = container.querySelector('#dt-note');
  const headingEl = container.querySelector('#dt-heading');
  headingEl.textContent = `Zoomed map (${zoomText}x)`;

  // Rebuilding the overworld takes seconds the first time (it is cached afterwards, and shared with
  // the overworld page), so the progress overlay goes up first.
  const progress = showGenerationProgress(canvas, 'Rebuilding the overworld…');
  await yieldToPaint();
  const world = cachedOverworldWorld(MapWindow.worldParams(w), dim.width, dim.height);
  const sample = MapWindow.sampler(world, w);
  const across = MapWindow.cellsAcross(w, world);
  noteEl.textContent = `Zoom ${zoomText}x of overworld seed ${w.seed}. The coast, hills, rivers, lakes, biomes and settlements are the overworld's own, in the same place.` +
    (zoom > MapWindow.WARN_ZOOM || across < 40 ? " This is zoomed past what the overworld recorded, so fine detail here is added texture. Raise the overworld's Cells for more real detail." : '');

  // About 1.2 detail cells per overworld cell in view, within a range the painting passes handle quickly.
  const windowCells = Math.round(w.ww * w.ww * world.cols * world.rows);
  const cellCount = Math.min(14000, Math.max(6000, Math.round(windowCells * 1.2)));
  const noiseAmp = 0.14;
  let headline = null;

  function generate() {
    const theme = MAP_THEMES[container.querySelector('#dt-theme').value] || MAP_THEMES[MAP_THEME_DEFAULT];
    const palette = theme.overworld;
    const grainRng = mulberry32(seed + 14683);
    const borderRng = mulberry32(seed + 25791);
    const win = { window: w, world, sample, cellCount, noiseAmp, forestBias: w.forestBias, ruggedBias: w.ruggedBias, wildZones: w.wildZones };
    renderTerrainPatch(ctx, canvas, { seed, sea: w.sea, targetAvgHeight: 0.5, targetAvgMoisture: 0.5, sampleGuide: sample.heightAt, zone: null, palette, win });
    const seen = drawWindowFeatures(ctx, canvas, w, world, sample, palette, zoom, seed);
    // seen is sorted city -> town -> village, so the first is the most important place in view.
    headline = seen.length ? seen[0].s.name : null;
    if (!tileMode) {
      paintParchmentGrain(ctx, canvas, grainRng, palette.grain);
      drawCompassRose(ctx, canvas.width - 50, 50, 28, palette.coastline);
      drawMapVignetteAndBorder(ctx, canvas, palette.coastline, borderRng);
    }
  }

  generate();
  progress.done();
  if (headline) headingEl.textContent = `${headline} and surroundings (${zoomText}x zoom)`;
  container.querySelector('#dt-theme').addEventListener('change', generate);
  wireMapExportSave(container, canvas, 'dt', (offCtx) => {
    const prevCtx = ctx;
    ctx = offCtx;
    generate();
    ctx = prevCtx;
  }, () => ({ route: 'map/detail', params, title: headline ? `${headline} zoomed map` : `Zoomed map ${zoomText}x`, location: '' }));
}
